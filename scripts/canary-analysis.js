#!/usr/bin/env node
/**
 * Statistical canary analysis, the actual method behind Project 1, not a
 * simple "error rate under 5%" threshold. This mirrors what Kayenta
 * (Netflix/Google's open source canary tool) does: pull metric samples
 * for the baseline and the canary, run the Mann-Whitney U test to ask
 * "are these two distributions actually different," and only then decide.
 *
 * A threshold check answers "is the canary bad in isolation." A
 * statistical test answers "is the canary different from the baseline
 * right now," which is the question that actually matters, since
 * "acceptable" error rate varies by time of day, load, and a dozen other
 * factors a fixed threshold cannot see.
 *
 * Exit code 0 = promote, exit code 1 = fail. Argo Rollouts' Job provider
 * reads this exit code directly (see k8s/argo-rollouts/analysistemplate.yaml).
 */

const http = require("http");

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";
const SAMPLE_WINDOW = "1m";
const SAMPLE_COUNT = 10;
const SAMPLE_INTERVAL_MS = 6000; // 10 samples over ~1 minute

function queryPrometheus(query) {
  return new Promise((resolve, reject) => {
    const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            const value = parsed?.data?.result?.[0]?.value?.[1];
            resolve(value !== undefined ? parseFloat(value) : null);
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mann-Whitney U test. Ranks the combined samples, sums ranks for the
 * first group, derives U, and returns a z-score. This is a real
 * implementation, not a stub, matching the test Kayenta itself uses.
 */
function mannWhitneyU(sampleA, sampleB) {
  const combined = [
    ...sampleA.map((v) => ({ v, group: "a" })),
    ...sampleB.map((v) => ({ v, group: "b" })),
  ].sort((x, y) => x.v - y.v);

  // Assign ranks, averaging ties.
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j < combined.length && combined[j].v === combined[i].v) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) combined[k].rank = avgRank;
    i = j;
  }

  const rankSumA = combined.filter((c) => c.group === "a").reduce((s, c) => s + c.rank, 0);
  const nA = sampleA.length;
  const nB = sampleB.length;
  const uA = rankSumA - (nA * (nA + 1)) / 2;
  const uB = nA * nB - uA;
  const u = Math.min(uA, uB);

  const meanU = (nA * nB) / 2;
  const stdU = Math.sqrt((nA * nB * (nA + nB + 1)) / 12);
  const z = stdU === 0 ? 0 : (u - meanU) / stdU;

  return { u, z };
}

async function collectSamples(query) {
  const samples = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const value = await queryPrometheus(query);
    if (value !== null) samples.push(value);
    await sleep(SAMPLE_INTERVAL_MS);
  }
  return samples;
}

async function main() {
  console.log("Collecting baseline (stable) and canary error rate samples...");

  const stableErrorRateQuery =
    'sum(rate(http_requests_total{app="canarydeck-argo-stable",status=~"5.."}[' +
    SAMPLE_WINDOW +
    '])) / sum(rate(http_requests_total{app="canarydeck-argo-stable"}[' +
    SAMPLE_WINDOW +
    "]))";
  const canaryErrorRateQuery =
    'sum(rate(http_requests_total{app="canarydeck-argo-canary",status=~"5.."}[' +
    SAMPLE_WINDOW +
    '])) / sum(rate(http_requests_total{app="canarydeck-argo-canary"}[' +
    SAMPLE_WINDOW +
    "]))";

  const [stableSamples, canarySamples] = await Promise.all([
    collectSamples(stableErrorRateQuery),
    collectSamples(canaryErrorRateQuery),
  ]);

  if (stableSamples.length < 3 || canarySamples.length < 3) {
    console.error("Not enough samples collected to run a meaningful test. Failing closed.");
    process.exit(1);
  }

  const { u, z } = mannWhitneyU(stableSamples, canarySamples);
  const canaryMean = canarySamples.reduce((a, b) => a + b, 0) / canarySamples.length;
  const stableMean = stableSamples.reduce((a, b) => a + b, 0) / stableSamples.length;

  console.log(`Stable mean error rate: ${stableMean.toFixed(4)}`);
  console.log(`Canary mean error rate: ${canaryMean.toFixed(4)}`);
  console.log(`Mann-Whitney U: ${u.toFixed(2)}, z-score: ${z.toFixed(2)}`);

  // |z| > 1.96 corresponds to p < 0.05, a statistically significant
  // difference. The canary only fails if it is significantly WORSE, not
  // merely different, an improvement should never fail a canary.
  const significantlyDifferent = Math.abs(z) > 1.96;
  const canaryIsWorse = canaryMean > stableMean;

  if (significantlyDifferent && canaryIsWorse) {
    console.error("FAIL: canary error rate is statistically significantly worse than baseline.");
    process.exit(1);
  }

  console.log("PASS: no statistically significant regression detected.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Analysis script error:", err);
  process.exit(1);
});
