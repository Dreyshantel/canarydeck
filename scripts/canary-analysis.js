#!/usr/bin/env node
/**
 * Statistical canary analysis using Mann-Whitney U.
 *
 * Compares stable and canary revisions using:
 * 1. Error rate
 * 2. p99 latency
 *
 * Exit code 0 = promote
 * Exit code 1 = fail
 */

const http = require("http");

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";
const SAMPLE_WINDOW = "1m";
const SAMPLE_COUNT = 10;
const SAMPLE_INTERVAL_MS = 6000;

const stableHash = process.env.STABLE_HASH;
const canaryHash = process.env.CANARY_HASH;

if (!stableHash || !canaryHash) {
  console.error("STABLE_HASH and CANARY_HASH must be provided.");
  process.exit(1);
}

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

function mannWhitneyU(sampleA, sampleB) {
  const combined = [
    ...sampleA.map((v) => ({ v, group: "a" })),
    ...sampleB.map((v) => ({ v, group: "b" })),
  ].sort((x, y) => x.v - y.v);

  let i = 0;

  while (i < combined.length) {
    let j = i;

    while (j < combined.length && combined[j].v === combined[i].v) {
      j++;
    }

    const avgRank = (i + 1 + j) / 2;

    for (let k = i; k < j; k++) {
      combined[k].rank = avgRank;
    }

    i = j;
  }

  const rankSumA = combined
    .filter((c) => c.group === "a")
    .reduce((s, c) => s + c.rank, 0);

  const nA = sampleA.length;
  const nB = sampleB.length;

  const uA = rankSumA - (nA * (nA + 1)) / 2;
  const uB = nA * nB - uA;
  const u = Math.min(uA, uB);

  const meanU = (nA * nB) / 2;

  const stdU = Math.sqrt(
    (nA * nB * (nA + nB + 1)) / 12
  );

  const z = stdU === 0 ? 0 : (u - meanU) / stdU;

  return { u, z };
}

async function collectSamples(query) {
  const samples = [];

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const value = await queryPrometheus(query);

    if (value !== null) {
      samples.push(value);
    }

    await sleep(SAMPLE_INTERVAL_MS);
  }

  return samples;
}

async function main() {
  console.log(
    "Collecting stable and canary error rate and p99 latency samples..."
  );

  const stableErrorRateQuery =
    `(
      sum(rate(http_requests_total{rollouts_pod_template_hash="${stableHash}",status=~"5.."}[${SAMPLE_WINDOW}]))
      or vector(0)
    )
    /
    sum(rate(http_requests_total{rollouts_pod_template_hash="${stableHash}"}[${SAMPLE_WINDOW}]))`;

  const canaryErrorRateQuery =
    `(
      sum(rate(http_requests_total{rollouts_pod_template_hash="${canaryHash}",status=~"5.."}[${SAMPLE_WINDOW}]))
      or vector(0)
    )
    /
    sum(rate(http_requests_total{rollouts_pod_template_hash="${canaryHash}"}[${SAMPLE_WINDOW}]))`;

  const stableP99Query =
    `histogram_quantile(
      0.99,
      sum(
        rate(http_request_duration_seconds_bucket{
          rollouts_pod_template_hash="${stableHash}"
        }[${SAMPLE_WINDOW}])
      ) by (le)
    )`;

  const canaryP99Query =
    `histogram_quantile(
      0.99,
      sum(
        rate(http_request_duration_seconds_bucket{
          rollouts_pod_template_hash="${canaryHash}"
        }[${SAMPLE_WINDOW}])
      ) by (le)
    )`;

  console.log("Stable hash:", stableHash);
  console.log("Canary hash:", canaryHash);

  const [
    stableErrorSamples,
    canaryErrorSamples,
    stableP99Samples,
    canaryP99Samples,
  ] = await Promise.all([
    collectSamples(stableErrorRateQuery),
    collectSamples(canaryErrorRateQuery),
    collectSamples(stableP99Query),
    collectSamples(canaryP99Query),
  ]);

  if (
    stableErrorSamples.length < 3 ||
    canaryErrorSamples.length < 3 ||
    stableP99Samples.length < 3 ||
    canaryP99Samples.length < 3
  ) {
    console.error(
      "Not enough samples collected for error rate or p99 latency. Failing closed."
    );
    process.exit(1);
  }

  const errorRateTest = mannWhitneyU(
    stableErrorSamples,
    canaryErrorSamples
  );

  const p99Test = mannWhitneyU(
    stableP99Samples,
    canaryP99Samples
  );

  const stableErrorMean =
    stableErrorSamples.reduce((a, b) => a + b, 0) /
    stableErrorSamples.length;

  const canaryErrorMean =
    canaryErrorSamples.reduce((a, b) => a + b, 0) /
    canaryErrorSamples.length;

  const stableP99Mean =
    stableP99Samples.reduce((a, b) => a + b, 0) /
    stableP99Samples.length;

  const canaryP99Mean =
    canaryP99Samples.reduce((a, b) => a + b, 0) /
    canaryP99Samples.length;

  console.log(
    `Stable mean error rate: ${stableErrorMean.toFixed(4)}`
  );

  console.log(
    `Canary mean error rate: ${canaryErrorMean.toFixed(4)}`
  );

  console.log(
    `Error rate Mann-Whitney U: ${errorRateTest.u.toFixed(2)}, z-score: ${errorRateTest.z.toFixed(2)}`
  );

  console.log(
    `Stable mean p99 latency: ${stableP99Mean.toFixed(4)}s`
  );

  console.log(
    `Canary mean p99 latency: ${canaryP99Mean.toFixed(4)}s`
  );

  console.log(
    `p99 latency Mann-Whitney U: ${p99Test.u.toFixed(2)}, z-score: ${p99Test.z.toFixed(2)}`
  );

  const errorRateSignificant =
    Math.abs(errorRateTest.z) > 1.96;

  const errorRateWorse =
    canaryErrorMean > stableErrorMean;

  const errorRateRegression =
    errorRateSignificant && errorRateWorse;

  const p99Significant =
    Math.abs(p99Test.z) > 1.96;

  const p99Worse =
    canaryP99Mean > stableP99Mean;

  const p99Regression =
    p99Significant && p99Worse;

  console.log(`Error rate regression: ${errorRateRegression}`);
  console.log(`p99 latency regression: ${p99Regression}`);

  if (errorRateRegression || p99Regression) {
    console.error("FAIL: canary regression detected.");

    if (errorRateRegression) {
      console.error(
        "Reason: error rate is statistically significantly worse than baseline."
      );
    }

    if (p99Regression) {
      console.error(
        "Reason: p99 latency is statistically significantly worse than baseline."
      );
    }

    process.exit(1);
  }

  console.log(
    "PASS: no statistically significant regression detected in error rate or p99 latency."
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Analysis script error:", err);
  process.exit(1);
});
