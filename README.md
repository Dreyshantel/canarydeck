# CanaryDeck

A small order processing API. Built as Product A for the Expadox
Portfolio DevOps track, covering Projects 1 to 3: Statistical Automated
Canary Analysis, Build Integrity and Policy Gates, and Expand-Contract
Database Migrations in CD.

Full product spec lives in the companion doc
`canarydeck-spec-and-deploy-readme.md`. This README covers the code and
walks through getting it running.

---

## What it is
- Create, list, and view orders
- Mark an order fulfilled or cancelled
- `/healthz` (checks the database, reports the deployed version)
- `/metrics` (Prometheus format, the real signal every project in this
  product depends on)

Two parallel delivery setups exist side by side on purpose:
- `k8s/argo-rollouts/` — the app run as an Argo Rollouts `Rollout`, with
  a real statistical canary analysis (`scripts/canary-analysis.js`)
- `k8s/flagger/` — the same app, run as a plain `Deployment` managed by
  Flagger's `Canary` resource, a different controller and mental model
  doing the same job

Comparing the two directly is Project 1's actual point, not a detail to
skip past.

---

## Tech stack
Node.js/Express, Postgres (in-cluster StatefulSet), Prometheus
(in-cluster, minimal), Argo Rollouts, Flagger, n8n, OPA/Conftest, Gitea
Actions alongside GitHub Actions. Everything free, everything either
self-hosted or open source. No managed cloud service anywhere in this
product, unlike the Product Security track, this track's work needs a
real cluster, so it runs on a free local one instead of paying for a
managed one.

---

## Local setup

### 1. Cluster
```bash
k3d cluster create canarydeck --agents 2
```

### 2. Database and Prometheus
```bash
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/prometheus.yaml
```

### 3. Run migrations
```bash
npm install
DATABASE_URL="postgresql://canarydeck:canarydeck_dev_password@localhost:5432/canarydeck" \
  npm run migrate
```
(Port-forward Postgres first: `kubectl port-forward svc/postgres 5432:5432`)

### 4. Build and load the image
```bash
docker build -t canarydeck:0.1.0 --build-arg APP_VERSION=0.1.0 .
k3d image import canarydeck:0.1.0 -c canarydeck
```

### 5. Deploy one or both delivery setups
```bash
# Argo Rollouts path
kubectl create namespace argo-rollouts
kubectl apply -n argo-rollouts -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml
kubectl create configmap canary-analysis-script --from-file=scripts/canary-analysis.js -o yaml --dry-run=client | kubectl apply -f -
kubectl apply -f k8s/argo-rollouts/

# Flagger path (needs a service mesh or ingress controller Flagger can drive,
# see Flagger's own docs for mesh setup, out of scope for this repo's zero-overhead claim)
kubectl apply -f k8s/flagger/
```

Note the `kubectl create configmap ... --from-file` step for the analysis
script, this loads the real file from `scripts/`, rather than
duplicating its contents inside the YAML manifest, so there is exactly
one copy of the analysis logic to maintain.

### 6. Notifications
```bash
docker run -d -p 5678:5678 n8nio/n8n
```
Import `n8n/rollout-decision-workflow.json` via the n8n UI, then wire
its webhook URL into your rollout's analysis or Flagger's webhook config.

---

## Where the DevOps work actually lives
- `scripts/canary-analysis.js` — the real Mann-Whitney U statistical
  test, not a threshold check. Project 1's actual deliverable is
  understanding and extending this, not treating it as a black box.
- `k8s/argo-rollouts/analysistemplate.yaml` — wires the script above into
  Argo Rollouts via the Job provider, which reads the script's exit code
  directly.
- `policy/*.rego` — three real OPA policies (no root containers, require
  resource limits, no `:latest` tag), enforced as a hard CI gate in both
  `.github/workflows/ci.yml` and `.gitea/workflows/ci.yml`.
- `scripts/hermetic-build-check.sh` — builds the same commit twice,
  independently, and diffs the result. A real reproducibility check, not
  a description of one.
- `migrations/0001_create_orders.sql` — deliberately just the baseline
  schema. The actual expand-contract migration (Project 3's deliverable)
  is not pre-built here on purpose.

## Known simplifications
- Postgres runs as a single-replica StatefulSet with no automated
  backup in this repo, Velero (GridState, Project 5) is where backup and
  restore gets covered properly.
- The Flagger path assumes a service mesh or ingress controller capable
  of traffic shifting is already present, standing one up is outside
  this repo's scope and genuinely varies by cluster setup.
- `n8n` and Prometheus both run with no authentication in this local
  setup, acceptable for a laptop-only demo, called out explicitly rather
  than left implicit.
