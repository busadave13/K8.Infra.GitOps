# System Patterns

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Local Kubernetes Cluster                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   FluxCD    │───▶│   GitOps    │───▶│  Helm Releases /    │  │
│  │             │    │   Sync      │    │  Kustomizations     │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Istio Service Mesh                        │ │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │ │
│  │  │ Gateway API  │    │   istiod     │    │  Istio CNI   │   │ │
│  │  │ (Ingress)    │    │              │    │              │   │ │
│  │  └──────────────┘    └──────────────┘    └──────────────┘   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Flagger (Canary Controller)               │ │
│  │  - Manages progressive delivery                              │ │
│  │  - Creates primary/canary deployments                        │ │
│  │  - Traffic shifting via Istio VirtualServices                │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Observability Stack                       │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │ │
│  │  │Prometheus│  │ Grafana  │  │  Kiali   │  │ kube-state-  │ │ │
│  │  │          │  │          │  │          │  │   metrics    │ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Applications                              │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │ │
│  │  │ podinfo  │  │ mockery  │  │  aspire  │                   │ │
│  │  │ (canary) │  │ (canary) │  │          │                   │ │
│  │  └──────────┘  └──────────┘  └──────────┘                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## FluxCD Kustomization Dependency Chain

```
flux-system (bootstrap)
    │
    ▼
infrastructure ──────────────────────────────────────┐
    │ wait: true                                     │
    │ healthChecks:                                  │
    │   - istiod HelmRelease                         │
    │   - flagger HelmRelease                        │
    │   - prometheus HelmRelease                     │
    │   - grafana HelmRelease                        │
    │                                                │
    ▼                                                │
flagger-config ───────────────────────────────────────┤
    │ healthChecks:                                  │
    │   - flagger Deployment                         │
    │ (Creates MetricTemplates)                      │
    │                                                │
    ▼                                                │
ingress ──────────────────────────────────────────────┤
    │ (Creates Gateway)                              │
    │                                                │
    ▼                                                │
apps ─────────────────────────────────────────────────┘
    │ (Creates deployments, services, canaries)
    ▼
```

## Directory Structure Pattern

```
├── apps/
│   ├── base/                    # Base application manifests
│   │   ├── <app>/
│   │   │   ├── kustomization.yaml
│   │   │   ├── deployment.yaml / helmrelease.yaml
│   │   │   ├── service.yaml
│   │   │   ├── httproute.yaml   # Gateway API routing
│   │   │   └── canary.yaml      # Flagger canary config (optional)
│   └── dev/                     # Dev environment overlays
│       └── kustomization.yaml
│
├── infrastructure/
│   ├── base/                    # Base infrastructure
│   │   ├── flagger/
│   │   ├── grafana/
│   │   ├── istio-base/
│   │   ├── istiod/
│   │   ├── prometheus/
│   │   └── ...
│   └── dev/                     # Dev environment patches
│       └── patches/
│
└── clusters/
    └── dev/                     # Cluster-specific configs
        ├── apps.yaml            # FluxCD Kustomization for apps
        ├── infrastructure.yaml  # FluxCD Kustomization for infra
        ├── flagger-config.yaml  # MetricTemplates
        ├── ingress.yaml         # Gateway creation
        └── flux-system/         # FluxCD bootstrap
```

## Canary Deployment Pattern

When Flagger manages a deployment, it creates:

1. **Original Deployment** → Scaled to 0 (becomes template)
2. **Primary Deployment** (`<name>-primary`) → Runs stable version
3. **Canary Deployment** → Created during rollouts

Services created by Flagger:
- `<name>` → Main service (routes traffic based on weights)
- `<name>-primary` → Routes to primary deployment
- `<name>-canary` → Routes to canary deployment

## HTTPRoute Pattern

Routes must point to the Flagger-managed service (`<deployment-name>`):

```yaml
backendRefs:
  - name: <deployment-name>    # NOT the original service
    port: 80
```

## Key Configuration Patterns

### Health Checks for Dependencies
```yaml
spec:
  wait: true
  healthChecks:
    - apiVersion: helm.toolkit.fluxcd.io/v2
      kind: HelmRelease
      name: <release-name>
      namespace: flux-system
```

### Label Matching
Helm charts often set `release: <release-name>-<chart-name>` labels.
Services must match pod labels exactly:
```yaml
selector:
  app: mockery
  release: mockery-mockery    # Match Helm's release label
```

### Istio Sidecar Injection
Enabled via namespace label:
```yaml
metadata:
  labels:
    istio-injection: enabled
```

### Flagger Metric Templates
Located in `infrastructure/base/flagger/metric-templates/`:
- `request-success-rate.yaml` - Measures HTTP success rate
- `request-duration.yaml` - Measures request latency P99
