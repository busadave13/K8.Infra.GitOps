# K8.Local.Dev.Environment

A FluxCD GitOps repository for deploying a fully-featured local Kubernetes development environment using Docker Desktop.

## Overview

This repository provides an automated, reproducible local Kubernetes environment with:

- **Service Mesh**: Istio in **sidecar mode** with Gateway API for traffic management
- **Progressive Delivery**: Flagger for automated canary deployments
- **Observability**: Prometheus, Grafana, and Kiali
- **Developer Tools**: .NET Aspire Dashboard
- **GitOps**: FluxCD for declarative infrastructure management

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Desktop Kubernetes                     │
├─────────────────────────────────────────────────────────────────┤
│  FluxCD (GitOps)  │  Istio (Sidecar)  │  Flagger (Canary)       │
├─────────────────────────────────────────────────────────────────┤
│     Observability (Prometheus, Grafana, Kiali)                  │
├─────────────────────────────────────────────────────────────────┤
│              Gateway API (*.tools.com → Services)                │
└─────────────────────────────────────────────────────────────────┘
```

### Istio Sidecar Mode

This environment uses Istio's **sidecar proxy injection** mode where:
- Each pod gets an Envoy proxy sidecar container injected automatically
- Namespaces with `istio-injection: enabled` label have automatic injection
- Proxies handle mTLS, traffic routing, load balancing, and observability
- Metrics are collected from sidecar proxies on port 15090 (`/stats/prometheus`)
- istio-cni handles network setup without requiring elevated privileges

### Key Components

| Component | Purpose |
|-----------|---------|
| **istiod** | Istio control plane - manages proxy configuration and certificates |
| **istio-cni** | CNI plugin for pod network setup during sidecar injection |
| **istio-proxy** | Envoy sidecar injected into each application pod |
| **Gateway API** | Kubernetes-native ingress with Istio implementation |

## Repository Structure

```
├── clusters/          # Cluster-specific entry points
│   └── dev/          # Development cluster configuration
├── infrastructure/    # Platform infrastructure
│   ├── base/         # Base configurations (shared)
│   │   ├── istio-base/      # Istio CRDs
│   │   ├── istio-cni/       # Istio CNI plugin
│   │   ├── istiod/          # Istio control plane
│   │   ├── gateway-api/     # Gateway + HPA + PDB
│   │   ├── flagger/         # Flagger + loadtester + metric-templates
│   │   ├── prometheus/      # Metrics with sidecar scraping
│   │   ├── grafana/         # Dashboards (Istio Mesh, Istio Canary)
│   │   └── kiali/           # Service mesh visualization
│   └── dev/          # Dev-specific overlays
├── apps/             # Application deployments
│   ├── base/         # Base app configurations
│   │   └── podinfo/  # Example app with canary deployment
│   └── dev/          # Dev-specific overlays
└── scripts/          # Testing and verification scripts
    ├── test-canary.sh        # Canary deployment test
    ├── k6-load-test.js       # k6 load testing script
    └── verify-sidecar-mode.sh # Sidecar mode verification
```

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with Kubernetes enabled
- [FluxCD CLI](https://fluxcd.io/flux/installation/) (`flux`)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [k6](https://k6.io/docs/getting-started/installation/) (for load testing)
- GitHub account with repository access

## Quick Start

### 1. Configure Local Hosts

Add to your hosts file (`C:\Windows\System32\drivers\etc\hosts` on Windows, `/etc/hosts` on Linux/Mac):

```
127.0.0.1 prometheus.tools.com
127.0.0.1 alertmanager.tools.com
127.0.0.1 kiali.tools.com
127.0.0.1 grafana.tools.com
127.0.0.1 aspire.tools.com
127.0.0.1 podinfo.local.com
127.0.0.1 mockery.local.com
127.0.0.1 weather.local.com
127.0.0.1 locust.tools.com
```

### 2. Create SSH Deploy Key

```bash
ssh-keygen -t ed25519 -C "flux-local-dev" -f $env:USERPROFILE\.ssh\flux-local-dev-deploy-key
```

Add the public key to your GitHub repository as a deploy key with write access.

### 3. Bootstrap FluxCD

```bash
flux bootstrap github \
  --owner=busadave13 \
  --repository=K8.Local.Dev.Environment \
  --branch=dev \
  --path=./clusters/dev \
  --private-key-file=$env:USERPROFILE\.ssh\flux-local-dev-deploy-key
```

### 4. Configure Slack Alerts (Optional)

```bash
kubectl create secret generic slack-url \
  --from-literal=address=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK \
  -n flux-system
```

### 5. Verify Sidecar Mode

After deployment, verify that sidecar mode is properly configured:

```bash
# Run verification script
./scripts/verify-sidecar-mode.sh

# Or manually check pods have 2/2 containers
kubectl get pods -n podinfo
```

### 6. Access Services

Once deployed, access the tools via browser:

| Service | URL |
|---------|-----|
| Prometheus | http://prometheus.tools.com |
| Grafana | http://grafana.tools.com |
| Kiali | http://kiali.tools.com |
| Aspire Dashboard | http://aspire.tools.com |
| Podinfo (Example App) | http://podinfo.tools.com |

## Deployed Components

### Infrastructure
| Component | Description |
|-----------|-------------|
| Istio Base | Service mesh CRDs |
| Istiod | Istio control plane (sidecar mode) |
| Istio CNI | Network plugin for sidecar injection |
| Gateway API | Kubernetes-native ingress with Istio |
| Flagger | Progressive delivery and canary deployments |
| Flagger Loadtester | Load testing for canary analysis |
| Metrics Server | Resource metrics for HPA |
| kube-state-metrics | Kubernetes object metrics |
| Prometheus | Metrics collection with Istio sidecar scraping (port 15090) |
| Grafana | Dashboards and visualization |
| Kiali | Service mesh observability |
| Aspire | .NET microservices dashboard |

### Applications
| Component | Description |
|-----------|-------------|
| HTTPRoutes | Traffic routing for all tools |
| FluxCD Alerts | Slack notifications for deployments |
| Mockery | API mocking service |
| Weather | Weather API with sensor mocking |
| Podinfo | Example app with canary deployment |

## Canary Deployments

### How Canary Works with Flagger

1. Flagger watches the `podinfo` Deployment
2. When the image or configuration changes, Flagger creates a canary version
3. Traffic is gradually shifted from primary to canary (10% steps up to 50%)
4. Metrics are evaluated at each step using Prometheus (success rate ≥99%, latency P99 <500ms)
5. If metrics pass thresholds, canary is promoted; otherwise, it's rolled back

### Metric Templates

Flagger uses custom MetricTemplates for canary analysis:

| Metric | Description | Threshold |
|--------|-------------|-----------|
| `request-success-rate` | Percentage of successful requests (non-5xx) | ≥ 99% |
| `request-duration` | P99 request latency | < 500ms |

These metrics use `reporter="destination"` to query sidecar proxy telemetry.

### Trigger a Canary Deployment

```bash
# Using the test script
./scripts/test-canary.sh

# Or manually update the image
kubectl set image deployment/podinfo -n podinfo podinfod=ghcr.io/stefanprodan/podinfo:6.1.0
```

### Monitor Canary Progress

```bash
# Watch canary status
kubectl get canary podinfo -n podinfo -w

# Check Flagger logs
kubectl logs -n flagger-system deploy/flagger -f

# View in Grafana
# Access http://grafana.tools.com and select "Istio Canary" dashboard
```

## Load Testing

### Locust (Web UI)

Locust is a distributed load testing tool with a web-based UI deployed in-cluster. It allows you to define user behavior in Python and run tests with real-time monitoring.

**Web UI**: http://locust.tools.com

#### Architecture

```
┌─────────────────────────────────────────────────┐
│              Locust Cluster                      │
├─────────────────────────────────────────────────┤
│   ┌──────────────────┐                          │
│   │   Locust Master  │  ◀─── Web UI             │
│   │   (port 8089)    │       locust.tools.com   │
│   └────────┬─────────┘                          │
│            │ coordinates                         │
│   ┌────────┴─────────┐                          │
│   │  Locust Workers  │  (2 replicas default)    │
│   │   (scalable)     │                          │
│   └──────────────────┘                          │
│            │                                     │
│            ▼ HTTP requests                       │
│   ┌──────────────────────────────────────────┐  │
│   │  Target Services (mockery, podinfo)       │  │
│   └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

#### Quick Start

1. **Access the Web UI**: http://locust.tools.com
2. **Start a test**: Enter number of users and spawn rate, click "Start swarming"
3. **Monitor in real-time**: Request statistics, response time charts, failures

#### Pre-configured Tests

The deployment includes a test script with two user classes:

| User Class | Host | Endpoints | Rate | Weight |
|------------|------|-----------|------|--------|
| MockeryUser | mockery.mockery.svc | `/api/mock`, `/health` | 10 req/s | 3 (~75%) |
| PodinfoUser | podinfo.podinfo.svc:9898 | `/`, `/version`, `/env`, `/healthz` | 5 req/s | 1 (~25%) |

#### Scaling Workers

```bash
# Scale to 5 workers for higher load
kubectl scale deployment locust-worker -n locust --replicas=5

# Scale to 10 workers
kubectl scale deployment locust-worker -n locust --replicas=10

# Check worker status
kubectl get pods -n locust -l component=worker
```

#### Custom Test Scripts

Edit the ConfigMap and restart:

```bash
kubectl edit configmap locust-scripts -n locust
kubectl rollout restart deployment locust-master locust-worker -n locust
```

Example custom user class:

```python
from locust import HttpUser, task, between

class CustomUser(HttpUser):
    host = "http://your-service.namespace.svc.cluster.local"
    wait_time = between(1, 3)
    
    @task(5)
    def main_endpoint(self):
        self.client.get("/api/v1/resource")
    
    @task(1)
    def health(self):
        self.client.get("/health")
```

#### CLI Usage

```bash
# Run a headless test
kubectl exec -n locust deploy/locust-master -- \
  locust --headless -u 100 -r 10 -t 5m \
  --host http://mockery.mockery.svc.cluster.local \
  -f /scripts/locustfile.py
```

#### Troubleshooting Locust

```bash
# Workers not connecting to master
kubectl get svc locust-master -n locust
kubectl logs -n locust -l component=worker --tail=20

# Test script errors
kubectl logs -n locust deploy/locust-master

# Test connectivity from worker
kubectl exec -n locust deploy/locust-worker -- \
  curl -s http://mockery.mockery.svc.cluster.local/health
```

### k6 (CLI)

k6 is a JavaScript-based load testing tool. Note: k6 uses HTTP/2 connection reuse by default, which may cause uneven load distribution. The scripts have `noConnectionReuse: true` configured.

**Available Scripts** (located in `k6/` directory):
| Script | Default RPS | Target |
|--------|-------------|--------|
| `combined-load-test.js` | 5/20/25 (Mockery/Weather/Podinfo) | All services |
| `weather-load-test.js` | 200 | weather.local.com |
| `mockery-load-test.js` | 200 | mockery.local.com |
| `podinfo-load-test.js` | 10 | podinfo.local.com |

```bash
# Run combined load test (5/20/25 RPS for Mockery/Weather/Podinfo)
docker-compose run --rm k6 run /scripts/combined-load-test.js

# Run weather load test (200 RPS for 30 minutes)
docker-compose run --rm k6 run /scripts/weather-load-test.js

# Run mockery load test
docker-compose run --rm k6 run /scripts/mockery-load-test.js

# With custom settings
docker-compose run --rm -e K6_MOCKERY_RPS=50 -e K6_WEATHER_RPS=50 -e K6_PODINFO_RPS=20 -e K6_DURATION=10m k6 run /scripts/combined-load-test.js

# Run in detached mode
docker-compose run -d --rm k6 run /scripts/combined-load-test.js
```

See [k6/README.md](k6/README.md) for detailed documentation.

### Using Flagger Loadtester

The Flagger loadtester is deployed automatically and runs during canary analysis:

```bash
# Check loadtester status
kubectl get pods -n flagger-system -l app=loadtester

# Manually trigger load test
kubectl exec -n flagger-system deploy/flagger-loadtester -- \
  hey -z 1m -q 10 -c 2 http://podinfo.podinfo:9898/
```

## Common Commands

### FluxCD Status

```bash
# Check all Kustomizations
flux get kustomizations

# Check all HelmReleases
flux get helmreleases -A

# Reconcile from Git
flux reconcile source git flux-system

# Watch reconciliation
flux get kustomizations --watch
```

### Kubernetes

```bash
# Verify context
kubectl config current-context  # Should show: docker-desktop

# Check all pods
kubectl get pods -A

# Check Gateway API resources
kubectl get gateway,httproute -A

# Verify sidecar injection (should show 2 containers per pod)
kubectl get pods -n podinfo -o jsonpath='{.items[*].spec.containers[*].name}'
```

### Flagger Operations

```bash
# Check canary deployments
kubectl get canary -A
kubectl describe canary podinfo -n podinfo

# Check metric templates
kubectl get metrictemplates -n flagger-system

# Verify Flagger status
flux get helmrelease flagger -n flux-system

# Trigger canary deployment (update image version)
kubectl set image deployment/podinfo -n podinfo podinfod=ghcr.io/stefanprodan/podinfo:6.1.0

# Watch canary progress
kubectl get canary podinfo -n podinfo -w
```

### Observability

```bash
# Port-forward Prometheus
kubectl port-forward -n monitor svc/prometheus-server 9090:80

# Port-forward Grafana
kubectl port-forward -n monitor svc/grafana 8080:8080

# Port-forward Kiali
kubectl port-forward -n istio-system svc/kiali 20001:20001

# Check Istio sidecar metrics in Prometheus
kubectl exec -n monitor deploy/prometheus-server -c prometheus-server -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=istio_requests_total{reporter="destination"}'
```

### Debugging

```bash
# HelmRelease status
kubectl describe helmrelease <name> -n flux-system

# FluxCD logs
flux logs --level=error

# Pod logs
kubectl logs -n <namespace> <pod-name>

# Sidecar proxy logs
kubectl logs -n podinfo <pod-name> -c istio-proxy

# Check sidecar proxy config
kubectl exec -n podinfo <pod-name> -c istio-proxy -- pilot-agent request GET config_dump
```

## Troubleshooting

### Pods Not Getting Sidecar

```bash
# Check namespace labels (must have istio-injection: enabled)
kubectl get namespace podinfo -o yaml | grep istio-injection

# Restart deployment to trigger injection
kubectl rollout restart deployment/podinfo -n podinfo

# Check injection webhook
kubectl get mutatingwebhookconfigurations | grep istio

# Verify istiod is running
kubectl get pods -n istio-system -l app=istiod
```

### HelmRelease Stuck in "Pending"

```bash
# Check for dependency issues
kubectl get helmrelease -A

# Force reconciliation
flux reconcile helmrelease <name> -n flux-system --force
```

### Gateway Not Responding

```bash
# Check Gateway status
kubectl get gateway -n istio-ingress

# Check Istio ingress pods
kubectl get pods -n istio-ingress

# Verify HTTPRoutes
kubectl get httproute -A
```

### FluxCD Not Syncing

```bash
# Check source status
flux get sources git

# Check for errors
flux logs --level=error --since=10m
```

### Flagger Issues

**Canary not progressing:**

```bash
# Check Flagger controller logs
kubectl logs -n flagger-system deploy/flagger

# Verify MetricTemplates exist
kubectl get metrictemplates -n flagger-system

# Check Prometheus metrics availability
kubectl exec -n monitor deploy/prometheus-server -c prometheus-server -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=istio_requests_total{destination_workload="podinfo-primary",reporter="destination"}'
```

**Metrics not available:**

- Ensure Prometheus is scraping Istio sidecar metrics (port 15090)
- Verify workload has `app` and `version` labels in deployment metadata
- Check sidecar injection is enabled: `kubectl get namespace <namespace> -o yaml`
- Verify pods have 2 containers (app + istio-proxy): `kubectl get pods -n podinfo`
- Ensure traffic is flowing to generate metrics

**Dashboard showing no data:**

```bash
# Check Grafana datasource configuration
kubectl get configmap -n monitor | grep datasources

# Verify Prometheus is receiving Istio metrics
kubectl exec -n monitor deploy/prometheus-server -c prometheus-server -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=istio_requests_total{destination_workload="podinfo-primary"}'

# Check Grafana dashboards are loaded
kubectl get configmap -n monitor | grep dashboard
```

## Grafana Dashboards

The following dashboards are pre-configured:

| Dashboard | Description |
|-----------|-------------|
| Istio Mesh Dashboard | Overall mesh health, request rates, latencies |
| Istio Gateway Dashboard | Gateway/Ingress traffic metrics, requests by hostname and destination |
| Istio Service Dashboard | Per-service request volume, success rate, latency (P50/P90/P99) |
| Istio Workload Dashboard | Per-workload inbound/outbound metrics and source tracking |
| Istio Performance Dashboard | Istiod control plane metrics (xDS pushes, CPU/memory, proxy sync) |
| Istio Canary | Flagger canary deployment metrics (success rate, duration, traffic weight) |
| Kubernetes HPA | Horizontal Pod Autoscaler metrics (replicas, CPU utilization) |
| Kubernetes Pod Health | Pod health & readiness (active pods, restarts, termination reasons) |
| Kubernetes App Metrics | Container metrics (request rate, error rate, CPU/memory usage) |
| Prometheus Alertmanager | Alertmanager monitoring (alerts, silences, notifications) |

### Dashboard Details

#### Istio Gateway Dashboard
- Gateway request volume (total requests through ingress)
- Gateway success rate (non-5xx responses)
- Gateway P99 latency
- Number of backend services being routed to
- Requests by response code over time
- Request duration percentiles (P50, P90, P99)
- Requests by destination service
- P99 latency by destination
- Requests by hostname (*.tools.com routes)

#### Istio Service Dashboard
- Request volume by service
- Success rate (percentage of non-5xx responses)
- Request duration percentiles (P50, P90, P99)
- Requests by response code
- Incoming requests by source workload

#### Istio Workload Dashboard
- Inbound/Outbound request volume and success rates
- Inbound requests by response code
- Inbound request duration
- Outbound requests by destination service
- Outbound request duration by destination

#### Istio Performance Dashboard
- Total CDS/EDS pushes from istiod
- Number of connected proxies
- Configuration conflicts
- xDS push rate by type
- xDS push time percentiles
- Istiod CPU and memory usage
- Proxy convergence time distribution

### Istio Canary Dashboard Panels

The Istio Canary dashboard includes:
- **Request Success Rate**: Primary vs Canary success rates
- **Request Duration (P99)**: Latency comparison
- **Request Volume**: Requests per second
- **Canary Weight**: Current traffic split percentage
- **CPU/Memory Usage**: Resource consumption (requires cAdvisor metrics)

## Contributing

1. Make changes in a feature branch
2. Commit and push to trigger FluxCD reconciliation
3. Verify changes with `flux get kustomizations`
4. Create pull request for review

## License

See [LICENSE](LICENSE) file for details.
