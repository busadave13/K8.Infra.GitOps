# Tech Context

## Core Technologies

### Container Orchestration
- **Kubernetes** - Local development cluster
- **Docker Desktop** - Container runtime with Kubernetes enabled

### GitOps & Deployment
- **FluxCD** - GitOps operator for Kubernetes
  - Helm Controller - Manages HelmReleases
  - Kustomize Controller - Manages Kustomizations
  - Source Controller - Manages Git/Helm repositories
- **Flagger** - Progressive delivery operator for canary deployments

### Service Mesh
- **Istio** - Service mesh with mTLS, traffic management
  - `istio-base` - CRDs and base resources
  - `istiod` - Control plane
  - `istio-cni` - CNI plugin for network configuration
- **Gateway API** - Kubernetes-native ingress (replaces traditional Ingress)
  - HTTPRoute for routing HTTP traffic
  - Gateway for listener configuration

### Observability
- **Prometheus** - Metrics collection and alerting
- **Prometheus Adapter** - Exposes Prometheus metrics to Kubernetes custom metrics API for HPA
  - Custom rules for RPS-based scaling
  - Important filters: `job="kubernetes-pods"`, `reporter="destination"` to avoid double-counting
- **Grafana** - Dashboards and visualization
- **Kiali** - Service mesh observability and topology
- **kube-state-metrics** - Kubernetes object metrics

### HPA Configuration
- **Prometheus Adapter External Metrics**:
  - `podinfo_requests_per_second` - RPS for podinfo-primary
  - `weather_requests_per_second` - RPS for weather-primary
- **HPA Targets**:
  - CPU: 70% utilization
  - RPS: 100 requests per second per replica
- **Query Filters** (to avoid double-counting):
  - `job="kubernetes-pods"` - Excludes envoy-stats job metrics
  - `reporter="destination"` - Uses only destination-side metrics

## Key Configurations

### Namespaces
```
istio-system      - Istio control plane
istio-ingress     - Istio ingress gateway
flagger-system    - Flagger controller and loadtester
prometheus        - Prometheus server
grafana           - Grafana dashboards
kiali             - Kiali service mesh UI
podinfo           - Podinfo application (canary enabled)
mockery           - Mockery application (canary enabled)
weather           - Weather application (canary enabled)
locust            - Locust load testing (master + workers)
```

### Local Domain Names
- `*.local.com` - Application endpoints (e.g., podinfo.local.com, mockery.local.com, weather.local.com)
- `*.tools.com` - Infrastructure tools (e.g., grafana.tools.com, prometheus.tools.com, locust.tools.com)

### Service Ports
| Service | Port | Target Port |
|---------|------|-------------|
| podinfo | 9898 | 9898 |
| mockery | 80 | 8080 |
| weather | 80 | 8080 |
| grafana | 80 | 3000 |
| prometheus | 9090 | 9090 |
| kiali | 20001 | 20001 |

## Flagger Configuration

### Canary Analysis Settings
```yaml
analysis:
  interval: 1m           # Check metrics every minute
  threshold: 5           # Max failed checks before rollback
  maxWeight: 50          # Max traffic to canary (50%)
  stepWeight: 10         # Increment traffic by 10% each step
```

### Metric Templates
Located in `infrastructure/base/flagger/metric-templates/`:
- **request-success-rate** - HTTP 2xx/3xx response ratio
- **request-duration** - P99 latency threshold

### Webhooks
- `flagger-loadtester` - Generates traffic during canary analysis
  - Pre-rollout acceptance tests
  - Load testing with `hey`

## Dependencies

### Helm Repositories
- **fluxcd-community** - Flagger charts
- **grafana** - Grafana charts
- **istio** - Istio charts
- **prometheus-community** - Prometheus charts
- **kiali** - Kiali charts
- **github** - Custom application charts (mockery, weather)

### Key Versions (from HelmReleases)
- Istio: 1.24.x (from istio Helm repo)
- Flagger: Latest (from fluxcd-community)
- Grafana: Latest (from grafana repo)
- Prometheus: Latest (from prometheus-community)

## Load Testing

### Locust (In-cluster)
- **Web UI**: http://locust.tools.com
- **Architecture**: Master/Worker distributed cluster
- **Location**: `infrastructure/base/locust/`
- **Pre-configured tests**:
  - MockeryUser (75% weight): 10 req/s to `/api/mock`
  - PodinfoUser (25% weight): 5 req/s to `/`, `/version`, `/env`, `/healthz`
- **Scaling**: `kubectl scale deployment locust-worker -n locust --replicas=5`

### k6 Scripts (Docker-compose)
- **Location**: `k6/`
- **Run commands**:
  ```bash
  # Combined load test (default: 5/20/25 RPS for Mockery/Weather/Podinfo)
  docker-compose run --rm k6 run /scripts/combined-load-test.js
  
  # Weather load test
  docker-compose run --rm k6 run /scripts/weather-load-test.js
  
  # Mockery load test  
  docker-compose run --rm k6 run /scripts/mockery-load-test.js
  
  # Custom settings
  docker-compose run --rm -e K6_MOCKERY_RPS=50 -e K6_WEATHER_RPS=50 -e K6_PODINFO_RPS=20 -e K6_DURATION=10m k6 run /scripts/combined-load-test.js
  
  # Detached mode
  docker-compose run -d --rm k6 run /scripts/combined-load-test.js
  ```

### k6 Scripts Available
| Script | Target | Default RPS | Header |
|--------|--------|-------------|--------|
| `combined-load-test.js` | All services | 5/20/25 (Mockery/Weather/Podinfo) | Per-service |
| `weather-load-test.js` | weather.local.com/api/weather | 200 | X-Mockery-Mocks |
| `mockery-load-test.js` | mockery.local.com/api/mock | 200 | X-Mock-ID |
| `podinfo-load-test.js` | podinfo.local.com | 10 | N/A |

### k6 Configuration
- Uses `noConnectionReuse: true` to improve load distribution across pods
- Configurable via environment variables:
  - `K6_RPS` - Requests per second (individual scripts)
  - `K6_DURATION` - Test duration
  - `K6_MOCKERY_MOCKS` - Weather sensor mocks header value
  - `K6_MOCK_ID` - Mockery mock ID header value
  - `K6_MOCKERY_RPS` - Mockery RPS (combined script)
  - `K6_WEATHER_RPS` - Weather RPS (combined script)
  - `K6_PODINFO_RPS` - Podinfo RPS (combined script)
- Combined script supports disabling services by setting RPS to 0
- Supports direct k6 CLI with `--env` flags

### Fortio (Docker CLI)
- **Location**: `fortio/`
- **Run commands**:
  ```bash
  # Test Podinfo (100 QPS default)
  ./fortio/podinfo-load-test.sh
  
  # Test Mockery (10 QPS default)
  ./fortio/mockery-load-test.sh
  
  # Test Weather (30 QPS default)
  ./fortio/weather-load-test.sh
  
  # Custom settings
  ./fortio/podinfo-load-test.sh --qps=500 --duration=5m
  ```

### Fortio Scripts Available
| Script | Service | Default QPS | Header |
|--------|---------|-------------|--------|
| `podinfo-load-test.sh` | podinfo.local.com | 100 | None |
| `mockery-load-test.sh` | mockery.local.com | 10 | X-Mock-ID |
| `weather-load-test.sh` | weather.local.com | 30 | X-Mockery-Mocks |

### Fortio Features
- 🎨 Colorful output with emojis and formatted tables
- ⏱️ Countdown timer with progress bar showing remaining time
- 📈 Response code breakdown with color-coded status (green/yellow/red)
- 📊 Latency percentiles (p50/p90/p99) in milliseconds
- Uses `-allow-initial-errors` to continue testing even with non-2xx responses

### Fortio Configuration
- Configurable via command-line flags or environment variables:
  - `--qps=N` / `QPS` - Queries per second
  - `--duration=TIME` / `DURATION` - Test duration (default: 30s)
  - `--connections=N` / `CONNECTIONS` - Concurrent connections (default: 8)
  - `--url=URL` / `URL` - Target URL
  - `--mock-id=ID` / `MOCK_ID` - X-Mock-ID header (mockery script)
  - `--mocks=MOCKS` / `MOCKERY_MOCKS` - X-Mockery-Mocks header (weather script)
- Runs via Docker (fortio/fortio image)

## Docker Compose Services

### Available Services
| Service | Port | Purpose |
|---------|------|---------|
| aspire-dashboard | 18888, 18889, 18890 | .NET Aspire Dashboard |
| k6 | N/A (CLI) | Load testing tool |

### Removed Services (2025-12-14)
- InfluxDB (was used for k6 metrics storage)
- Grafana for k6 (was used for k6 dashboards)
