const client = require("prom-client");

// This registry is what Argo Rollouts' AnalysisTemplate and Flagger both
// scrape via Prometheus (see k8s/prometheus.yaml). Without real metrics,
// a "statistical canary analysis" project has nothing to analyze, this
// file is the foundation everything in Project 1 sits on top of.

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const orderErrorsTotal = new client.Counter({
  name: "order_errors_total",
  help: "Total order processing errors",
  registers: [register],
});

function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route ? req.route.path : req.path;
    const labels = { method: req.method, route, status: res.statusCode };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, durationSeconds);
  });
  next();
}

module.exports = { register, metricsMiddleware, orderErrorsTotal };
