# Active Context

## Current Focus
Maintaining and improving the local Kubernetes development environment with GitOps, canary deployments, and observability.

## Recently Completed

### 2025-12-16
1. **Added Alertmanager Web UI HTTPRoute**
   - Created `infrastructure/base/prometheus/alertmanager-httproute.yaml`
   - Routes to `alertmanager.tools.com` on port 80
   - Backend: `prometheus-alertmanager` service on port 9093
   - Access at: http://alertmanager.tools.com
   - Features: Silence alerts, view active alerts, manage alert routing

1. **Added Prometheus Alertmanager Dashboard**
   - New Grafana dashboard (ID 24109) for Alertmanager monitoring
   - Shows: Instance count/versions, active alerts, suppressed alerts, silences
   - Notifications sent per integration, notification durations
   - Added Alertmanager scrape config to Prometheus
   - Access at: http://grafana.tools.com → Dashboards → Prometheus Alertmanager

2. **Added Kubernetes App Metrics Dashboard**
   - New Grafana dashboard (ID 1471) for container-level metrics
   - Filters by Namespace and Container
   - Shows: Request rate, error rate, response time percentiles
   - Pod count, CPU usage, Memory usage (multiple views)
   - Access at: http://grafana.tools.com → Dashboards → Kubernetes App Metrics

### 2025-12-15
1. **Added Kubernetes Pod Health & Readiness Dashboard**
   - New Grafana dashboard for monitoring pod health
   - Filters by Namespace and Workload
   - Shows: Active pods, Not Ready pods, Restarts, Age
   - Tracks container termination reasons (OOMKilled, Error, etc.)
   - Access at: http://grafana.tools.com → Dashboards → Kubernetes / Pod Health & Readiness

2. **Added Fortio Load Testing Scripts**
   - Created `fortio/` directory with bash-based load testing
   - Scripts: `podinfo-load-test.sh`, `mockery-load-test.sh`, `weather-load-test.sh`
   - Features:
     - 🎨 Colorful output with emojis
     - ⏱️ Countdown timer with progress bar
     - 📈 Response code breakdown (green/yellow/red)
     - 📊 Latency percentiles (p50/p90/p99)
   - Updated `fortio/README.md` with full documentation

2. **Added Prometheus Adapter for RPS-based HPA**
   - Deployed prometheus-adapter HelmRelease
   - Configured custom metrics rules for Istio RPS
   - Updated podinfo HPA with External metric `podinfo_requests_per_second`
   - HPA scales on: CPU (70%) OR RPS (100 per replica)

3. **Fixed Prometheus Adapter Double-Counting RPS Metrics**
   - Issue: RPS showed ~20 RPS when k6 sent only 10 RPS
   - Root causes: Metrics scraped by both jobs AND both source/destination sides
   - Fix: Added filters `job="kubernetes-pods"` and `reporter="destination"`
   - Result: HPA now shows correct RPS (~10.6 RPS matching k6's 10 RPS)

4. **Added Weather HPA with RPS-based Scaling**
   - Created `apps/base/weather/horizontalpodautoscaler.yaml`
   - Targets `weather-primary` (Flagger-managed)
   - Scales on CPU (70%) OR RPS (100 per replica)
   - Added `weather_requests_per_second` external metric

### 2025-12-14
1. **Added Weather App Configuration**
   - Created `apps/base/weather/` with HelmRelease, HTTPRoute, Canary, ServiceAccount
   - Added weather namespace with `istio-injection: enabled`
   - Routes to `weather.local.com`
   - Canary configured with Flagger for progressive delivery

2. **Added Locust Load Testing** 
   - Deployed distributed Locust cluster with master/worker architecture
   - Web UI accessible at http://locust.tools.com
   - Pre-configured tests for MockeryUser (75%) and PodinfoUser (25%)

## Active Applications with Canary Support
| Application | Namespace | Status | HTTPRoute |
|-------------|-----------|--------|-----------|
| podinfo | podinfo | Initialized | podinfo.local.com |
| mockery | mockery | Initialized | mockery.local.com |
| weather | weather | Pending | weather.local.com |

## Load Testing Tools
| Tool | Type | Best For |
|------|------|----------|
| Fortio | Docker, CLI | Quick CLI tests, pretty bash output, countdown timer |
| Locust | In-cluster, Web UI | Distributed testing, real-time monitoring |
| k6 | Docker-compose, CLI | JavaScript scripting, console output |
| Flagger Loadtester | In-cluster | Canary analysis traffic |

## Fortio Scripts Available
| Script | Service | Default QPS | Header |
|--------|---------|-------------|--------|
| podinfo-load-test.sh | podinfo.local.com | 100 | None |
| mockery-load-test.sh | mockery.local.com | 10 | X-Mock-ID |
| weather-load-test.sh | weather.local.com | 30 | X-Mockery-Mocks |

## k6 Scripts Available
Scripts are located in `k6/` directory (moved from `k6/scripts/`).

| Script | Target | Default RPS | Header |
|--------|--------|-------------|--------|
| combined-load-test.js | All services | 5/20/25 (Mockery/Weather/Podinfo) | Per-service |
| weather-load-test.js | weather.local.com/api/weather | 200 | X-Mockery-Mocks |
| mockery-load-test.js | mockery.local.com/api/mock | 200 | X-Mock-ID |
| podinfo-load-test.js | podinfo.local.com | 10 | N/A |

**Run commands:**
```bash
# Combined (default 5/20/25 RPS)
docker-compose run --rm k6 run /scripts/combined-load-test.js

# With custom RPS
docker-compose run --rm -e K6_MOCKERY_RPS=50 -e K6_WEATHER_RPS=50 -e K6_PODINFO_RPS=20 k6 run /scripts/combined-load-test.js

# Detached mode
docker-compose run -d --rm k6 run /scripts/combined-load-test.js
```

## Infrastructure Health Checks
The following HelmReleases are monitored for infrastructure readiness:
- `istiod` - Istio control plane
- `flagger` - Canary controller
- `prometheus` - Metrics collection
- `grafana` - Dashboards
- `locust` - Load testing tool

## Known Issues
- `flagger_canary_status` metric shows 0 (Unknown) even when canary is progressing - Flagger metrics issue
- k6 uses HTTP/2 connection reuse causing uneven pod distribution - use `noConnectionReuse: true`

## Next Steps
- Deploy weather app and verify canary initialization
- Test weather canary deployment
- Add weather app to Locust tests
