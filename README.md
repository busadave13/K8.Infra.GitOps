# K8.Infra.GitOps

A FluxCD GitOps repository for deploying a fully-featured local Kubernetes development environment using Docker Desktop.

## Overview

This repository provides an automated, reproducible local Kubernetes environment with:

- **Service Mesh**: Istio in **sidecar mode** with Gateway API for traffic management
- **Progressive Delivery**: Flagger for automated canary deployments
- **Observability**: Prometheus and Grafana
- **Developer Tools**: .NET Aspire Dashboard
- **GitOps**: FluxCD for declarative infrastructure management

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Desktop Kubernetes                     │
├─────────────────────────────────────────────────────────────────┤
│  FluxCD (GitOps)  │  Istio (Sidecar)  │  Flagger (Canary)       │
├─────────────────────────────────────────────────────────────────┤
│           Observability (Prometheus, Grafana)                    │
├─────────────────────────────────────────────────────────────────┤
│   Gateway API (*.tools.com, *.local.com → Services)             │
└─────────────────────────────────────────────────────────────────┘
```

### Istio Sidecar Mode

This environment uses Istio's **sidecar proxy injection** mode where:
- Each pod gets an Envoy proxy sidecar container injected automatically
- Namespaces with `istio-injection: enabled` label have automatic injection
- Proxies handle mTLS, traffic routing, load balancing, and observability
- Metrics are collected from sidecar proxies on port 15090 (`/stats/prometheus`)

### Key Components

| Component | Purpose |
|-----------|---------|
| **istiod** | Istio control plane - manages proxy configuration and certificates |
| **istio-proxy** | Envoy sidecar injected into each application pod |
| **Gateway API** | Kubernetes-native ingress with Istio implementation |

## Repository Structure

```
├── clusters/          # Cluster-specific entry points
│   └── dev/          # Development cluster configuration
├── infrastructure/    # Platform infrastructure
│   ├── base/         # Base configurations (shared)
│   │   ├── aspire/          # .NET Aspire Dashboard
│   │   ├── crds/            # Custom Resource Definitions (Gateway API)
│   │   ├── flagger/         # Flagger + loadtester + metric-templates
│   │   ├── gateway-api/     # Gateway + HPA + PDB
│   │   ├── grafana/         # Dashboards (Istio Mesh, Istio Canary)
│   │   ├── istio-base/      # Istio CRDs
│   │   ├── istiod/          # Istio control plane
│   │   ├── kube-state-metrics/ # Kubernetes state metrics
│   │   ├── metrics-server/  # Resource metrics for HPA
│   │   ├── namespaces/      # Namespace definitions
│   │   ├── prometheus/      # Metrics with sidecar scraping
│   │   └── repos/           # Helm repositories
│   └── dev/          # Dev-specific overlays
├── apps/             # Application deployments
│   ├── base/         # Base app configurations
│   │   ├── fluxcd/   # FluxCD alerts and providers (Discord)
│   │   ├── mockery/  # API mocking service
│   │   ├── podinfo/  # Example app with canary deployment
│   │   ├── repos/    # App Helm repositories
│   │   └── weather/  # Weather API with canary deployment
│   └── dev/          # Dev-specific overlays
├── docker-compose.yml # Docker Compose for local development tools
└── test-canary.sh    # Canary deployment test script
```

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with Kubernetes enabled
- [FluxCD CLI](https://fluxcd.io/flux/installation/) (`flux`)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- GitHub account with repository access

## Quick Start

### 1. Configure Local Hosts

Add to your hosts file (`/etc/hosts` on macOS/Linux, `C:\Windows\System32\drivers\etc\hosts` on Windows):

```
127.0.0.1 prometheus.tools.com
127.0.0.1 alertmanager.tools.com
127.0.0.1 grafana.tools.com
127.0.0.1 aspire.tools.com
127.0.0.1 podinfo.local.com
127.0.0.1 mockery.local.com
127.0.0.1 weather.local.com
```

### 2. Create SSH Deploy Key

```bash
ssh-keygen -t ed25519 -C "flux-gitops" -f ~/.ssh/flux-gitops-deploy-key
```

Add the public key to your GitHub repository as a deploy key with write access.

### 3. Bootstrap FluxCD

```bash
flux bootstrap github \
  --owner=<your-github-username> \
  --repository=K8.Infra.GitOps \
  --branch=dev \
  --path=./clusters/dev \
  --private-key-file=~/.ssh/flux-gitops-deploy-key
```

### 4. Configure Discord Alerts (Optional)

Create secrets for Discord notifications:

```bash
# For Flagger canary notifications
kubectl create secret generic discord-webhook \
  --from-literal=address=https://discord.com/api/webhooks/YOUR/WEBHOOK \
  -n flagger-system

# For FluxCD notifications
kubectl create secret generic discord-flux-webhook \
  --from-literal=address=https://discord.com/api/webhooks/YOUR/WEBHOOK \
  -n flux-system

# For Prometheus Alertmanager
kubectl create secret generic alertmanager-discord \
  --from-literal=webhook-url=https://discord.com/api/webhooks/YOUR/WEBHOOK \
  -n monitor
```

### 5. Verify Sidecar Mode

After deployment, verify that sidecar mode is properly configured:

```bash
# Check pods have 2/2 containers (app + istio-proxy)
kubectl get pods -n podinfo
kubectl get pods -n weather
```

### 6. Access Services

Once deployed, access the tools via browser:

| Service | URL |
|---------|-----|
| Prometheus | http://prometheus.tools.com |
| Alertmanager | http://alertmanager.tools.com |
| Grafana | http://grafana.tools.com |
| Aspire Dashboard | http://aspire.tools.com |
| Podinfo | http://podinfo.local.com |
| Weather API | http://weather.local.com |
| Mockery | http://mockery.local.com |

## Deployed Components

### Infrastructure
| Component | Description |
|-----------|-------------|
| Istio Base | Service mesh CRDs |
| Istiod | Istio control plane (sidecar mode) |
| Gateway API | Kubernetes-native ingress with Istio |
| Flagger | Progressive delivery and canary deployments |
| Flagger Loadtester | Load testing for canary analysis |
| Metrics Server | Resource metrics for HPA |
| kube-state-metrics | Kubernetes object metrics |
| Prometheus | Metrics collection with Istio sidecar scraping (port 15090) |
| Grafana | Dashboards and visualization |
| Aspire | .NET microservices dashboard |

### Applications
| Component | Description |
|-----------|-------------|
| Podinfo | Example app with canary deployment |
| Weather | Weather API with canary deployment and rate limiting |
| Mockery | API mocking service |
| FluxCD Alerts | Discord notifications for deployments |

## Canary Deployments

### How Canary Works with Flagger

1. Flagger watches Deployments with a Canary resource (podinfo, weather)
2. When the image or configuration changes, Flagger creates a canary version
3. Traffic is gradually shifted from primary to canary (10% steps)
4. Metrics are evaluated at each step using Prometheus (success rate ≥99%, latency P99 <500ms)
5. If metrics pass thresholds, canary is promoted; otherwise, it's rolled back

### Canary Configurations

| App | Max Weight | Step Weight | Analysis Interval |
|-----|------------|-------------|-------------------|
| Podinfo | 100% | 10% | 1m |
| Weather | 50% | 10% | 1m |

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
./test-canary.sh

# Or manually update the deployment
kubectl set image deployment/podinfo -n podinfo podinfod=ghcr.io/stefanprodan/podinfo:6.1.0
```

### Monitor Canary Progress

```bash
# Watch canary status
kubectl get canary -A -w

# Check Flagger logs
kubectl logs -n flagger-system deploy/flagger -f

# View in Grafana
# Access http://grafana.tools.com and select "Istio Canary" dashboard
```

## Load Testing

### Using Flagger Loadtester

The Flagger loadtester is deployed automatically and runs during canary analysis:

```bash
# Check loadtester status
kubectl get pods -n flagger-system -l app=loadtester

# Manually trigger load test
kubectl exec -n flagger-system deploy/flagger-loadtester -- \
  hey -z 1m -q 10 -c 2 http://podinfo.podinfo:9898/

# Load test weather service
kubectl exec -n flagger-system deploy/flagger-loadtester -- \
  hey -z 1m -q 10 -c 2 http://weather-canary.weather/
```

### Using Docker Compose

The repository includes a `docker-compose.yml` for running local development tools.

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
| Istio Canary | Flagger canary deployment metrics (success rate, duration, traffic weight) |
| Istio Canary Overview | Overview of all canary deployments across namespaces |
| Istio Gateway API | Gateway/Ingress traffic metrics, requests by hostname and destination |
| Istio Throttling | Rate limiting and throttling metrics |
| Istio Workload | Per-workload inbound/outbound metrics and source tracking |
| Kubernetes App Metrics | Container metrics (request rate, error rate, CPU/memory usage) |
| Kubernetes HPA | Horizontal Pod Autoscaler metrics (replicas, CPU utilization) |
| Kubernetes Pod Health | Pod health & readiness (active pods, restarts, termination reasons) |
| Prometheus Alertmanager | Alertmanager monitoring (alerts, silences, notifications) |

### Dashboard Details

#### Istio Gateway API Dashboard
- Gateway request volume (total requests through ingress)
- Gateway success rate (non-5xx responses)
- Gateway P99 latency
- Number of backend services being routed to
- Requests by response code over time
- Request duration percentiles (P50, P90, P99)
- Requests by destination service
- P99 latency by destination
- Requests by hostname (*.tools.com, *.local.com routes)

#### Istio Workload Dashboard
- Inbound/Outbound request volume and success rates
- Inbound requests by response code
- Inbound request duration
- Outbound requests by destination service
- Outbound request duration by destination

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
