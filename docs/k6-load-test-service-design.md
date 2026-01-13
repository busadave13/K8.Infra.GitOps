# Design Specification: Git-Based k6 Load Test Service

## Executive Summary

This document provides a comprehensive design specification for implementing a GitOps-managed k6 load testing service integrated with Flagger canary deployments on Azure Kubernetes Service (AKS). The solution replaces the current `hey`-based load testing with a more sophisticated k6 approach, enabling version-controlled test scripts, environment-specific configurations, and advanced load testing capabilities.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Goals and Requirements](#2-goals-and-requirements)
3. [Architecture Overview](#3-architecture-overview)
4. [Component Design](#4-component-design)
5. [Repository Structure](#5-repository-structure)
6. [Kubernetes Resources](#6-kubernetes-resources)
7. [Security Design](#7-security-design)
8. [Integration with Flagger](#8-integration-with-flagger)
9. [Test Script Standards](#9-test-script-standards)
10. [Environment Configuration](#10-environment-configuration)
11. [Observability](#11-observability)
12. [Operational Procedures](#12-operational-procedures)
13. [Migration Plan](#13-migration-plan)
14. [Failure Handling](#14-failure-handling)
15. [Future Enhancements](#15-future-enhancements)

---

## 1. Introduction

### 1.1 Background

The current infrastructure uses `hey` for simple HTTP load testing during canary deployments. While functional for basic scenarios, `hey` lacks:

- Complex test scenarios (multi-step workflows)
- Threshold-based pass/fail criteria
- Reusable test libraries
- Metrics export capabilities
- Environment-specific configuration

### 1.2 Solution Overview

This design introduces a k6 webhook service that:

- Pulls test scripts from a Git repository at runtime
- Executes k6 tests as Flagger canary webhooks
- Supports environment-specific test configurations
- Integrates with Prometheus for metrics collection
- Follows GitOps principles for test management

### 1.3 Current State Analysis

| Component | Current | Proposed |
|-----------|---------|----------|
| Load Test Tool | `hey` | k6 |
| Test Storage | Inline in webhook metadata | Git repository |
| Test Management | Manual edits | GitOps (Flux) |
| Metrics | None | Prometheus export |
| Thresholds | None | k6 native thresholds |

---

## 2. Goals and Requirements

### 2.1 Functional Goals

| ID | Goal | Priority |
|----|------|----------|
| G1 | GitOps-driven management of k6 test scripts | P0 |
| G2 | Secure authentication to Azure DevOps Git | P0 |
| G3 | Native integration with Flagger canary analysis | P0 |
| G4 | Environment-specific test execution (dev/staging/prod) | P1 |
| G5 | Reusable test libraries and helpers | P1 |
| G6 | Prometheus metrics integration | P2 |
| G7 | Test result persistence and reporting | P2 |

### 2.2 Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR1 | Test script sync latency | < 60 seconds |
| NFR2 | Webhook response time | < 5 minutes |
| NFR3 | Git clone timeout | < 30 seconds |
| NFR4 | Resource usage (memory) | < 256Mi |
| NFR5 | Resource usage (CPU) | < 200m |

### 2.3 Non-Goals

- UI-based load testing management
- Manual test execution outside Flagger workflow
- Long-running soak or endurance tests (> 10 minutes)
- Performance testing for non-canary deployments
- Multi-region test orchestration (phase 1)

---

## 3. Architecture Overview

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Azure DevOps                                    │
│  ┌───────────────────────┐         ┌───────────────────────┐                │
│  │   k6-tests Repository │         │  cluster-config Repo  │                │
│  │                       │         │  (GitOps Manifests)   │                │
│  └───────────┬───────────┘         └───────────┬───────────┘                │
└──────────────┼─────────────────────────────────┼────────────────────────────┘
               │                                 │
               │ HTTPS (OIDC)                    │ HTTPS (OIDC)
               │                                 │
┌──────────────┼─────────────────────────────────┼────────────────────────────┐
│              │              AKS Cluster        │                            │
│              ▼                                 ▼                            │
│  ┌───────────────────────────────────────────────────────────┐              │
│  │                      Flux (flux-system)                    │              │
│  │  ┌─────────────────┐     ┌─────────────────┐              │              │
│  │  │ GitRepository   │     │ GitRepository   │              │              │
│  │  │ (k6-tests)      │     │ (cluster-config)│              │              │
│  │  └────────┬────────┘     └────────┬────────┘              │              │
│  └───────────┼───────────────────────┼───────────────────────┘              │
│              │                       │                                       │
│              ▼                       ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐              │
│  │                  flagger-system Namespace                  │              │
│  │                                                            │              │
│  │  ┌──────────────────────────────────────────────────────┐ │              │
│  │  │              k6-webhook Deployment                    │ │              │
│  │  │  ┌────────────────┐   ┌────────────────────────────┐ │ │              │
│  │  │  │ initContainer  │   │    k6-webhook Container    │ │ │              │
│  │  │  │ (git-clone)    │──▶│                            │ │ │              │
│  │  │  │                │   │  /scripts (emptyDir)       │ │ │              │
│  │  │  └────────────────┘   │  ├── common/               │ │ │              │
│  │  │                       │  ├── workloads/            │ │ │              │
│  │  │                       │  └── environments/         │ │ │              │
│  │  │                       └────────────────────────────┘ │ │              │
│  │  └──────────────────────────────────────────────────────┘ │              │
│  │                                                            │              │
│  │  ┌─────────────────┐     ┌─────────────────────────────┐ │              │
│  │  │     Flagger     │────▶│   MetricTemplates           │ │              │
│  │  │                 │     │   - request-success-rate    │ │              │
│  │  │                 │     │   - request-duration        │ │              │
│  │  └────────┬────────┘     └─────────────────────────────┘ │              │
│  └───────────┼────────────────────────────────────────────────┘              │
│              │                                                               │
│              │ Webhook Call                                                  │
│              ▼                                                               │
│  ┌───────────────────────────────────────────────────────────┐              │
│  │                   App Namespace (e.g., weather)            │              │
│  │  ┌─────────────────┐     ┌─────────────────────────────┐ │              │
│  │  │  Canary CRD     │     │  Deployment (weather)       │ │              │
│  │  │                 │     │  ├── primary                │ │              │
│  │  │                 │     │  └── canary                 │ │              │
│  │  └─────────────────┘     └─────────────────────────────┘ │              │
│  └───────────────────────────────────────────────────────────┘              │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────┐              │
│  │                    monitor Namespace                       │              │
│  │  ┌─────────────────────────────────────────────────────┐ │              │
│  │  │              Prometheus                              │ │              │
│  │  │  - Collects Istio metrics                           │ │              │
│  │  │  - Receives k6 metrics (remote write)               │ │              │
│  │  └─────────────────────────────────────────────────────┘ │              │
│  └───────────────────────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Request Flow Sequence

```
┌─────────┐     ┌─────────┐     ┌────────────┐     ┌─────────────┐     ┌───────────┐
│ Flagger │     │k6-webhook│    │ k6 Runtime │     │ Canary Pod  │     │Prometheus │
└────┬────┘     └────┬────┘     └─────┬──────┘     └──────┬──────┘     └─────┬─────┘
     │               │                │                   │                  │
     │  POST /       │                │                   │                  │
     │  {cmd: "k6 run..."}            │                   │                  │
     │──────────────▶│                │                   │                  │
     │               │                │                   │                  │
     │               │  spawn k6      │                   │                  │
     │               │───────────────▶│                   │                  │
     │               │                │                   │                  │
     │               │                │   HTTP requests   │                  │
     │               │                │──────────────────▶│                  │
     │               │                │   responses       │                  │
     │               │                │◀──────────────────│                  │
     │               │                │                   │                  │
     │               │                │   push metrics    │                  │
     │               │                │───────────────────┼─────────────────▶│
     │               │                │                   │                  │
     │               │  exit code     │                   │                  │
     │               │◀───────────────│                   │                  │
     │               │                │                   │                  │
     │  200 OK / 500 │                │                   │                  │
     │◀──────────────│                │                   │                  │
     │               │                │                   │                  │
     │  Continue/    │                │                   │                  │
     │  Rollback     │                │                   │                  │
     │               │                │                   │                  │
```

---

## 4. Component Design

### 4.1 k6-webhook Service

The k6-webhook is a lightweight HTTP service that receives webhook calls from Flagger and executes k6 test scripts.

#### 4.1.1 Container Image

| Property | Value |
|----------|-------|
| Image | `ghcr.io/grafana/flagger-k6-webhook:latest` |
| Alternative | Custom image with k6 + git |
| Port | 80 |
| Health Endpoint | `/healthz` |

#### 4.1.2 Lifecycle

```
Pod Start
    │
    ▼
┌───────────────────────────────────────┐
│ initContainer: git-clone              │
│ - Clone k6-tests repo                 │
│ - Mount to /scripts                   │
│ - Use Azure Workload Identity token   │
└───────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────┐
│ container: k6-webhook                 │
│ - Serve HTTP on :80                   │
│ - Execute k6 from /scripts            │
│ - Return exit code as HTTP status     │
└───────────────────────────────────────┘
```

### 4.2 Git Sync Strategy

#### Option A: Init Container (Recommended for Phase 1)

**Pros:**
- Simple implementation
- No additional sidecars
- Scripts loaded at pod start

**Cons:**
- Requires pod restart for script updates
- Slight delay on first request after deployment

#### Option B: Sidecar Git-Sync (Phase 2)

**Pros:**
- Real-time script updates
- No pod restarts needed

**Cons:**
- Additional resource overhead
- More complex deployment

### 4.3 Resource Requirements

```yaml
resources:
  requests:
    cpu: 50m
    memory: 128Mi
  limits:
    cpu: 200m
    memory: 256Mi
```

---

## 5. Repository Structure

### 5.1 k6-tests Repository

```
k6-tests/
├── README.md
├── package.json                    # For local development with k6 extensions
│
├── common/                         # Shared utilities
│   ├── auth.js                     # Authentication helpers
│   ├── checks.js                   # Reusable check functions
│   ├── helpers.js                  # Utility functions
│   ├── thresholds.js               # Standard threshold definitions
│   └── constants.js                # Shared constants
│
├── workloads/                      # Per-application test scripts
│   ├── weather/
│   │   ├── canary.js               # Canary promotion test
│   │   ├── smoke.js                # Quick smoke test
│   │   ├── load.js                 # Full load test
│   │   └── config.json             # Workload-specific config
│   │
│   ├── mockery/
│   │   ├── canary.js
│   │   ├── smoke.js
│   │   └── config.json
│   │
│   └── podinfo/
│       ├── canary.js
│       └── config.json
│
├── environments/                   # Environment-specific overrides
│   ├── dev/
│   │   ├── config.json
│   │   └── thresholds.json
│   ├── staging/
│   │   ├── config.json
│   │   └── thresholds.json
│   └── prod/
│       ├── config.json
│       └── thresholds.json
│
└── scripts/                        # CI/CD scripts
    ├── validate.sh                 # Validate k6 scripts syntax
    └── run-local.sh                # Local development helper
```

### 5.2 Cluster-Config Repository Updates

```
cluster-config/
├── infrastructure/
│   └── base/
│       └── flagger/
│           ├── k6-webhook/                 # NEW
│           │   ├── kustomization.yaml
│           │   ├── namespace.yaml
│           │   ├── deployment.yaml
│           │   ├── service.yaml
│           │   ├── serviceaccount.yaml
│           │   └── configmap.yaml
│           ├── loadtester/                 # EXISTING (phase out)
│           └── metric-templates/
│               ├── k6-http-errors.yaml     # NEW
│               ├── k6-response-time.yaml   # NEW
│               ├── request-success-rate.yaml
│               └── request-duration.yaml
│
└── apps/
    └── base/
        └── weather/
            └── canary.yaml                 # UPDATE webhooks
```

---

## 6. Kubernetes Resources

### 6.1 Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: flagger-system
  labels:
    istio-injection: enabled
    app.kubernetes.io/part-of: flagger
```

### 6.2 ServiceAccount with Workload Identity

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: k6-webhook
  namespace: flagger-system
  annotations:
    azure.workload.identity/client-id: "${AZURE_CLIENT_ID}"
  labels:
    azure.workload.identity/use: "true"
```

### 6.3 Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: k6-webhook
  namespace: flagger-system
  labels:
    app: k6-webhook
spec:
  replicas: 1
  selector:
    matchLabels:
      app: k6-webhook
  template:
    metadata:
      labels:
        app: k6-webhook
        azure.workload.identity/use: "true"
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "80"
    spec:
      serviceAccountName: k6-webhook
      
      initContainers:
        - name: git-clone
          image: alpine/git:2.43.0
          command:
            - /bin/sh
            - -c
            - |
              set -e
              echo "Cloning k6-tests repository..."
              
              # Get Azure AD token for Azure DevOps
              TOKEN=$(cat /var/run/secrets/azure/tokens/azure-identity-token)
              
              # Clone with token auth
              git clone --depth 1 \
                --single-branch \
                --branch ${GIT_BRANCH:-main} \
                https://oauth2:${TOKEN}@dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_git/k6-tests \
                /scripts
              
              echo "Clone complete. Files:"
              ls -la /scripts
          env:
            - name: ADO_ORG
              valueFrom:
                configMapKeyRef:
                  name: k6-webhook-config
                  key: ado-org
            - name: ADO_PROJECT
              valueFrom:
                configMapKeyRef:
                  name: k6-webhook-config
                  key: ado-project
            - name: GIT_BRANCH
              valueFrom:
                configMapKeyRef:
                  name: k6-webhook-config
                  key: git-branch
          volumeMounts:
            - name: scripts
              mountPath: /scripts
            - name: azure-identity-token
              mountPath: /var/run/secrets/azure/tokens
              readOnly: true
          resources:
            requests:
              cpu: 10m
              memory: 32Mi
            limits:
              cpu: 100m
              memory: 64Mi
      
      containers:
        - name: webhook
          image: ghcr.io/grafana/flagger-k6-webhook:latest
          ports:
            - containerPort: 80
              name: http
          env:
            - name: K6_PROMETHEUS_RW_SERVER_URL
              value: "http://prometheus-server.monitor.svc.cluster.local/api/v1/write"
            - name: K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM
              value: "true"
            - name: ENVIRONMENT
              valueFrom:
                configMapKeyRef:
                  name: k6-webhook-config
                  key: environment
          volumeMounts:
            - name: scripts
              mountPath: /scripts
              readOnly: true
          resources:
            requests:
              cpu: 50m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
          livenessProbe:
            httpGet:
              path: /healthz
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /healthz
              port: 80
            initialDelaySeconds: 3
            periodSeconds: 5
      
      volumes:
        - name: scripts
          emptyDir: {}
        - name: azure-identity-token
          projected:
            sources:
              - serviceAccountToken:
                  audience: api://AzureADTokenExchange
                  expirationSeconds: 3600
                  path: azure-identity-token
```

### 6.4 Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: k6-webhook
  namespace: flagger-system
  labels:
    app: k6-webhook
spec:
  type: ClusterIP
  selector:
    app: k6-webhook
  ports:
    - port: 80
      targetPort: 80
      protocol: TCP
      name: http
```

### 6.5 ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: k6-webhook-config
  namespace: flagger-system
data:
  ado-org: "your-org"
  ado-project: "your-project"
  git-branch: "main"
  environment: "dev"
```

### 6.6 HelmRelease (Alternative to Raw Manifests)

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: k6-webhook
  namespace: flux-system
spec:
  interval: 30m
  releaseName: k6-webhook
  targetNamespace: flagger-system
  dependsOn:
    - name: flagger
      namespace: flux-system
  chart:
    spec:
      chart: loadtester
      version: "0.35.0"
      sourceRef:
        kind: HelmRepository
        name: flagger
        namespace: flux-system
  values:
    replicaCount: 1
    image:
      repository: ghcr.io/grafana/flagger-k6-webhook
      tag: latest
    
    serviceAccount:
      create: true
      annotations:
        azure.workload.identity/client-id: "${AZURE_CLIENT_ID}"
    
    podLabels:
      azure.workload.identity/use: "true"
    
    cmd:
      timeout: 5m
    
    resources:
      requests:
        cpu: 50m
        memory: 128Mi
      limits:
        cpu: 200m
        memory: 256Mi
    
    # Custom init container for git clone
    extraInitContainers:
      - name: git-clone
        image: alpine/git:2.43.0
        command: ["/bin/sh", "-c"]
        args:
          - |
            git clone --depth 1 https://dev.azure.com/org/project/_git/k6-tests /scripts
        volumeMounts:
          - name: scripts
            mountPath: /scripts
    
    extraVolumes:
      - name: scripts
        emptyDir: {}
    
    extraVolumeMounts:
      - name: scripts
        mountPath: /scripts
        readOnly: true
```

### 6.7 Flux GitRepository for k6-tests

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: k6-tests
  namespace: flux-system
spec:
  interval: 1m
  url: https://dev.azure.com/your-org/your-project/_git/k6-tests
  ref:
    branch: main
  secretRef:
    name: ado-git-credentials
  ignore: |
    # Exclude files not needed in cluster
    README.md
    .github/
    scripts/
```

---

## 7. Security Design

### 7.1 Azure Workload Identity Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                               Azure AD                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    Federated Identity Credential                        ││
│  │  Subject: system:serviceaccount:flagger-system:k6-webhook               ││
│  │  Issuer: https://oidc.prod-aks.azure.com/{tenant-id}/{aks-id}          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    Managed Identity                                      ││
│  │  - Azure DevOps Reader permission                                       ││
│  │  - Client ID: ${AZURE_CLIENT_ID}                                        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ OIDC Token Exchange
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                               AKS Cluster                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    k6-webhook Pod                                        ││
│  │  ServiceAccount: k6-webhook                                             ││
│  │  Annotations:                                                           ││
│  │    azure.workload.identity/client-id: ${AZURE_CLIENT_ID}                ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ Azure AD Token
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Azure DevOps                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    k6-tests Repository                                   ││
│  │  Access: Read-only                                                      ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Security Policies

| Policy | Implementation |
|--------|----------------|
| No long-lived secrets | Azure Workload Identity with OIDC |
| Least privilege | Read-only Git access |
| Network isolation | Namespace-level NetworkPolicies |
| Pod security | Restricted PSS profile |
| Secret management | No secrets in k6 scripts |

### 7.3 NetworkPolicy

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: k6-webhook
  namespace: flagger-system
spec:
  podSelector:
    matchLabels:
      app: k6-webhook
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Allow Flagger to call webhook
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: flagger-system
          podSelector:
            matchLabels:
              app.kubernetes.io/name: flagger
      ports:
        - protocol: TCP
          port: 80
  egress:
    # Allow k6 to call canary services
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: TCP
          port: 80
        - protocol: TCP
          port: 8080
    # Allow Prometheus metrics push
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitor
      ports:
        - protocol: TCP
          port: 80
    # Allow DNS
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
```

### 7.4 PodSecurityPolicy / Pod Security Standards

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: k6-webhook
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    fsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: webhook
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop:
            - ALL
```

---

## 8. Integration with Flagger

### 8.1 Updated Canary Specification

```yaml
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: weather-canary
  namespace: weather
spec:
  provider: istio
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: weather
  progressDeadlineSeconds: 120
  
  service:
    port: 80
    targetPort: 8080
    portName: http
    trafficPolicy:
      tls:
        mode: ISTIO_MUTUAL
  
  analysis:
    interval: 1m
    threshold: 5
    maxWeight: 50
    stepWeight: 10
    
    metrics:
      # Istio-based metrics (existing)
      - name: success-rate
        templateRef:
          name: request-success-rate
          namespace: flagger-system
        thresholdRange:
          min: 99
        interval: 1m
      
      - name: latency-p99
        templateRef:
          name: request-duration
          namespace: flagger-system
        thresholdRange:
          max: 500
        interval: 1m
      
      # k6-based metrics (new)
      - name: k6-http-errors
        templateRef:
          name: k6-http-req-failed
          namespace: flagger-system
        thresholdRange:
          max: 1
        interval: 1m
    
    webhooks:
      # Pre-rollout smoke test
      - name: smoke-test
        type: pre-rollout
        url: http://k6-webhook.flagger-system/
        timeout: 2m
        metadata:
          type: cmd
          cmd: |
            k6 run \
              -e TARGET_URL=http://weather-canary.weather:80 \
              -e ENVIRONMENT=dev \
              /scripts/workloads/weather/smoke.js
      
      # Rollout load test
      - name: load-test
        type: rollout
        url: http://k6-webhook.flagger-system/
        timeout: 5m
        metadata:
          type: cmd
          cmd: |
            k6 run \
              -e TARGET_URL=http://weather-canary.weather:80 \
              -e ENVIRONMENT=dev \
              -e VUS=10 \
              -e DURATION=60s \
              --out experimental-prometheus-rw \
              /scripts/workloads/weather/canary.js
      
      # Confirm promotion
      - name: confirm-promotion
        type: confirm-promotion
        url: http://k6-webhook.flagger-system/
        timeout: 30s
        metadata:
          type: cmd
          cmd: "echo 'Canary promoted successfully'"
    
    alerts:
      - name: discord
        severity: error
        providerRef:
          name: discord
          namespace: flagger-system
```

### 8.2 Webhook Types

| Type | When Executed | Purpose |
|------|---------------|---------|
| `confirm-rollout` | Before starting analysis | Validation gate |
| `pre-rollout` | Before each analysis step | Smoke test |
| `rollout` | During each analysis step | Load test |
| `confirm-promotion` | Before promoting canary | Final validation |
| `post-rollout` | After promotion | Cleanup/notification |
| `rollback` | On rollback | Cleanup/notification |
| `event` | On any event | Monitoring |

### 8.3 k6 MetricTemplates

```yaml
# k6 HTTP Request Failure Rate
apiVersion: flagger.app/v1beta1
kind: MetricTemplate
metadata:
  name: k6-http-req-failed
  namespace: flagger-system
spec:
  provider:
    type: prometheus
    address: http://prometheus-server.monitor.svc.cluster.local
  query: |
    100 - (
      sum(rate(k6_http_reqs_total{expected_response="true"}[1m]))
      /
      sum(rate(k6_http_reqs_total[1m]))
      * 100
    )
```

```yaml
# k6 HTTP Request Duration P95
apiVersion: flagger.app/v1beta1
kind: MetricTemplate
metadata:
  name: k6-http-req-duration-p95
  namespace: flagger-system
spec:
  provider:
    type: prometheus
    address: http://prometheus-server.monitor.svc.cluster.local
  query: |
    histogram_quantile(0.95,
      sum(rate(k6_http_req_duration_seconds_bucket[1m])) by (le)
    )
```

---

## 9. Test Script Standards

### 9.1 Canary Test Template

```javascript
// /scripts/workloads/weather/canary.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Import shared utilities
import { getBaseUrl, getHeaders } from '../../common/helpers.js';
import { standardChecks } from '../../common/checks.js';
import { canaryThresholds } from '../../common/thresholds.js';

// Custom metrics
const errorRate = new Rate('errors');
const apiLatency = new Trend('api_latency');

// Configuration from environment
const TARGET_URL = __ENV.TARGET_URL || 'http://localhost:8080';
const ENVIRONMENT = __ENV.ENVIRONMENT || 'dev';
const VUS = parseInt(__ENV.VUS) || 5;
const DURATION = __ENV.DURATION || '30s';

// k6 options
export const options = {
  vus: VUS,
  duration: DURATION,
  
  thresholds: {
    // Request success rate must be > 99%
    'http_req_failed': ['rate<0.01'],
    
    // 95th percentile response time < 500ms
    'http_req_duration': ['p(95)<500'],
    
    // 99th percentile response time < 1000ms
    'http_req_duration': ['p(99)<1000'],
    
    // Custom error rate < 1%
    'errors': ['rate<0.01'],
  },
  
  // Tags for Prometheus grouping
  tags: {
    environment: ENVIRONMENT,
    test_type: 'canary',
    workload: 'weather',
  },
};

// Setup function - runs once before test
export function setup() {
  console.log(`Starting canary test against ${TARGET_URL}`);
  console.log(`Environment: ${ENVIRONMENT}, VUs: ${VUS}, Duration: ${DURATION}`);
  
  // Validate target is reachable
  const res = http.get(`${TARGET_URL}/health/ready`);
  if (res.status !== 200) {
    throw new Error(`Target not ready: ${res.status}`);
  }
  
  return { startTime: new Date().toISOString() };
}

// Main test function - runs for each VU iteration
export default function(data) {
  // Health check endpoint
  const healthRes = http.get(`${TARGET_URL}/health/ready`, {
    tags: { endpoint: 'health' },
  });
  
  check(healthRes, {
    'health check returns 200': (r) => r.status === 200,
    'health check response time < 100ms': (r) => r.timings.duration < 100,
  });
  
  // Main API endpoint
  const apiRes = http.get(`${TARGET_URL}/api/weather`, {
    tags: { endpoint: 'weather' },
    headers: getHeaders(ENVIRONMENT),
  });
  
  const apiSuccess = check(apiRes, {
    'API returns 200': (r) => r.status === 200,
    'API response time < 500ms': (r) => r.timings.duration < 500,
    'API returns valid JSON': (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch {
        return false;
      }
    },
    'API contains expected fields': (r) => {
      const body = JSON.parse(r.body);
      return body.temperature !== undefined && body.location !== undefined;
    },
  });
  
  // Record custom metrics
  errorRate.add(!apiSuccess);
  apiLatency.add(apiRes.timings.duration);
  
  // Think time between requests
  sleep(1);
}

// Teardown function - runs once after test
export function teardown(data) {
  console.log(`Canary test completed. Started at: ${data.startTime}`);
}
```

### 9.2 Shared Utilities

```javascript
// /scripts/common/helpers.js
export function getBaseUrl(environment) {
  const urls = {
    dev: 'http://localhost:8080',
    staging: 'http://staging.example.com',
    prod: 'http://api.example.com',
  };
  return urls[environment] || urls.dev;
}

export function getHeaders(environment) {
  return {
    'Content-Type': 'application/json',
    'X-Environment': environment,
    'X-Request-ID': `k6-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  };
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
```

```javascript
// /scripts/common/checks.js
import { check } from 'k6';

export function standardChecks(response, name) {
  return check(response, {
    [`${name}: status is 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${name}: response time < 1s`]: (r) => r.timings.duration < 1000,
    [`${name}: no errors in body`]: (r) => !r.body.includes('error'),
  });
}

export function jsonChecks(response, name) {
  return check(response, {
    [`${name}: valid JSON`]: (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch {
        return false;
      }
    },
  });
}
```

```javascript
// /scripts/common/thresholds.js
export const canaryThresholds = {
  http_req_failed: ['rate<0.01'],      // < 1% errors
  http_req_duration: ['p(95)<500'],    // 95th percentile < 500ms
};

export const smokeThresholds = {
  http_req_failed: ['rate<0.05'],      // < 5% errors (more lenient)
  http_req_duration: ['p(95)<1000'],   // 95th percentile < 1s
};

export const loadThresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
  http_reqs: ['rate>100'],              // Minimum throughput
};
```

### 9.3 Environment Configuration

```json
// /scripts/environments/dev/config.json
{
  "base_url": "http://localhost:8080",
  "vus": 5,
  "duration": "30s",
  "thresholds": {
    "error_rate": 0.05,
    "p95_latency": 1000
  },
  "features": {
    "prometheus_export": true,
    "detailed_logging": true
  }
}
```

```json
// /scripts/environments/prod/config.json
{
  "base_url": "http://api.example.com",
  "vus": 20,
  "duration": "60s",
  "thresholds": {
    "error_rate": 0.01,
    "p95_latency": 500
  },
  "features": {
    "prometheus_export": true,
    "detailed_logging": false
  }
}
```

---

## 10. Environment Configuration

### 10.1 Environment Strategy

| Environment | Git Branch | Test Intensity | Thresholds | Purpose |
|-------------|------------|----------------|------------|---------|
| dev | `main` | Low (5 VUs) | Relaxed | Fast feedback |
| staging | `release/*` | Medium (20 VUs) | Moderate | Pre-prod validation |
| prod | `tags/v*` | High (50 VUs) | Strict | Production gates |

### 10.2 Kustomize Overlays

```yaml
# infrastructure/dev/patches/k6-webhook-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: k6-webhook-config
  namespace: flagger-system
data:
  environment: "dev"
  git-branch: "main"
  default-vus: "5"
  default-duration: "30s"
```

```yaml
# infrastructure/staging/patches/k6-webhook-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: k6-webhook-config
  namespace: flagger-system
data:
  environment: "staging"
  git-branch: "release/current"
  default-vus: "20"
  default-duration: "60s"
```

```yaml
# infrastructure/prod/patches/k6-webhook-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: k6-webhook-config
  namespace: flagger-system
data:
  environment: "prod"
  git-branch: "tags/v1.0.0"
  default-vus: "50"
  default-duration: "120s"
```

---

## 11. Observability

### 11.1 Metrics Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Metrics Flow                                       │
│                                                                              │
│  ┌────────────┐    ┌────────────┐    ┌─────────────────────────────────┐   │
│  │ k6 Test    │───▶│ Prometheus │───▶│ Grafana                         │   │
│  │            │    │ Remote     │    │ ┌─────────────────────────────┐ │   │
│  │ Metrics:   │    │ Write      │    │ │ k6 Dashboard                │ │   │
│  │ - http_*   │    │            │    │ │ - Request rate              │ │   │
│  │ - vus      │    │            │    │ │ - Error rate                │ │   │
│  │ - data_*   │    │            │    │ │ - Response time             │ │   │
│  │ - custom   │    │            │    │ │ - VU count                  │ │   │
│  └────────────┘    └────────────┘    │ └─────────────────────────────┘ │   │
│                                       │                                 │   │
│  ┌────────────┐    ┌────────────┐    │ ┌─────────────────────────────┐ │   │
│  │ Istio      │───▶│ Prometheus │───▶│ │ Canary Dashboard            │ │   │
│  │ Envoy      │    │ Scrape     │    │ │ - Traffic split             │ │   │
│  │            │    │            │    │ │ - Success rate              │ │   │
│  │ Metrics:   │    │            │    │ │ - Latency histogram         │ │   │
│  │ - istio_*  │    │            │    │ │ - Canary status             │ │   │
│  └────────────┘    └────────────┘    │ └─────────────────────────────┘ │   │
│                                       └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Key Metrics

| Metric | Source | Description |
|--------|--------|-------------|
| `k6_http_reqs_total` | k6 | Total HTTP requests |
| `k6_http_req_failed` | k6 | Failed HTTP requests |
| `k6_http_req_duration_seconds` | k6 | Request duration histogram |
| `k6_vus` | k6 | Current virtual users |
| `k6_data_received_total` | k6 | Data received bytes |
| `k6_data_sent_total` | k6 | Data sent bytes |
| `istio_requests_total` | Istio | Total mesh requests |
| `istio_request_duration_milliseconds` | Istio | Request duration |

### 11.3 Grafana Dashboard

```yaml
# infrastructure/base/grafana/k6-canary-dashboard-configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: k6-canary-dashboard
  namespace: monitor
  labels:
    grafana_dashboard: "1"
data:
  k6-canary.json: |
    {
      "dashboard": {
        "title": "k6 Canary Load Tests",
        "panels": [
          {
            "title": "Request Rate",
            "type": "timeseries",
            "targets": [
              {
                "expr": "sum(rate(k6_http_reqs_total[1m])) by (workload)",
                "legendFormat": "{{workload}}"
              }
            ]
          },
          {
            "title": "Error Rate",
            "type": "timeseries",
            "targets": [
              {
                "expr": "sum(rate(k6_http_req_failed_total[1m])) / sum(rate(k6_http_reqs_total[1m])) * 100",
                "legendFormat": "Error %"
              }
            ]
          },
          {
            "title": "Response Time P95",
            "type": "timeseries",
            "targets": [
              {
                "expr": "histogram_quantile(0.95, sum(rate(k6_http_req_duration_seconds_bucket[1m])) by (le, workload))",
                "legendFormat": "{{workload}}"
              }
            ]
          },
          {
            "title": "Virtual Users",
            "type": "stat",
            "targets": [
              {
                "expr": "sum(k6_vus)",
                "legendFormat": "VUs"
              }
            ]
          }
        ]
      }
    }
```

### 11.4 Alerting

```yaml
# Prometheus alerting rules
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: k6-alerts
  namespace: monitor
spec:
  groups:
    - name: k6-canary
      rules:
        - alert: K6HighErrorRate
          expr: |
            sum(rate(k6_http_req_failed_total[5m])) 
            / 
            sum(rate(k6_http_reqs_total[5m])) 
            > 0.05
          for: 2m
          labels:
            severity: warning
          annotations:
            summary: "k6 test showing high error rate"
            description: "Error rate is {{ $value | humanizePercentage }}"
        
        - alert: K6HighLatency
          expr: |
            histogram_quantile(0.95, 
              sum(rate(k6_http_req_duration_seconds_bucket[5m])) by (le)
            ) > 1
          for: 2m
          labels:
            severity: warning
          annotations:
            summary: "k6 test showing high latency"
            description: "P95 latency is {{ $value }}s"
```

### 11.5 Logging

```yaml
# k6-webhook container logging
containers:
  - name: webhook
    env:
      - name: K6_LOG_OUTPUT
        value: "stdout"
      - name: K6_LOG_FORMAT
        value: "json"
```

Sample log output:
```json
{
  "level": "info",
  "msg": "Starting test",
  "test": "weather/canary.js",
  "vus": 10,
  "duration": "60s",
  "target": "http://weather-canary.weather:80",
  "timestamp": "2026-01-12T10:30:00Z"
}
```

---

## 12. Operational Procedures

### 12.1 Adding a New Workload

1. **Create test scripts in k6-tests repo:**
   ```
   k6-tests/workloads/new-app/
   ├── canary.js
   ├── smoke.js
   └── config.json
   ```

2. **Update Canary manifest:**
   ```yaml
   webhooks:
     - name: load-test
       url: http://k6-webhook.flagger-system/
       metadata:
         cmd: "k6 run /scripts/workloads/new-app/canary.js"
   ```

3. **Commit and push both repos**

4. **Flux syncs changes automatically**

### 12.2 Updating Test Scripts

1. **Modify scripts in k6-tests repo**
2. **Commit and push**
3. **Restart k6-webhook pod to pick up changes:**
   ```bash
   kubectl rollout restart deployment/k6-webhook -n flagger-system
   ```

### 12.3 Debugging Failed Tests

```bash
# View k6-webhook logs
kubectl logs -l app=k6-webhook -n flagger-system -f

# Check Flagger events
kubectl get events -n weather --field-selector reason=Synced

# Describe canary status
kubectl describe canary weather-canary -n weather

# Manual test execution
kubectl exec -it deployment/k6-webhook -n flagger-system -- \
  k6 run -e TARGET_URL=http://weather-canary.weather:80 \
  /scripts/workloads/weather/smoke.js
```

### 12.4 Rollback Procedures

| Scenario | Action |
|----------|--------|
| Bad test script | Revert Git commit, restart pod |
| k6-webhook down | Flagger falls back to timeout |
| Git clone fails | Pod fails init, stays pending |
| Prometheus down | k6 runs but no metrics export |

---

## 13. Migration Plan

### Phase 1: Parallel Deployment (Week 1-2)

1. Deploy k6-webhook alongside existing loadtester
2. Update dev canaries to use k6
3. Monitor and compare results
4. Keep `hey` as fallback

```yaml
# Dual webhooks during migration
webhooks:
  - name: k6-load-test
    url: http://k6-webhook.flagger-system/
    timeout: 5m
    metadata:
      cmd: "k6 run /scripts/workloads/weather/canary.js"
  
  - name: hey-load-test-backup
    url: http://flagger-loadtester.flagger-system/
    timeout: 5s
    metadata:
      cmd: "hey -z 1m -q 10 -c 2 http://weather-canary.weather/"
```

### Phase 2: Full Transition (Week 3-4)

1. Migrate all workloads to k6
2. Add environment-specific configurations
3. Enable Prometheus metrics export
4. Create Grafana dashboards

### Phase 3: Cleanup (Week 5)

1. Remove `hey` loadtester
2. Document operational procedures
3. Train team on k6 script development

### Migration Checklist

- [ ] Azure Workload Identity configured
- [ ] k6-tests repository created
- [ ] Flux GitRepository configured
- [ ] k6-webhook deployed
- [ ] Test scripts for all workloads
- [ ] Prometheus remote write enabled
- [ ] Grafana dashboards created
- [ ] All canaries migrated
- [ ] Old loadtester removed
- [ ] Runbooks updated

---

## 14. Failure Handling

### 14.1 Failure Scenarios and Responses

| Scenario | Detection | Response | Recovery |
|----------|-----------|----------|----------|
| k6 threshold breach | Exit code ≠ 0 | Canary rollback | Fix code, redeploy |
| Git clone failure | Init container fails | Pod stays Pending | Check credentials |
| Webhook timeout | Flagger timeout | Canary rollback | Increase timeout |
| Prometheus unavailable | Metrics export fails | Test completes (no metrics) | Restore Prometheus |
| k6-webhook OOM | Container OOMKilled | Pod restarts | Increase memory limit |
| Invalid test script | k6 parse error | Exit code ≠ 0 | Fix script, redeploy |
| Target unreachable | HTTP connection fails | Threshold breach | Check network policies |

### 14.2 Circuit Breaker Patterns

```javascript
// Example: Graceful degradation in tests
export default function() {
  try {
    const res = http.get(TARGET_URL, { timeout: '5s' });
    // ... checks
  } catch (e) {
    console.error(`Request failed: ${e.message}`);
    errorRate.add(1);
    sleep(5); // Back off on errors
  }
}
```

### 14.3 Monitoring Alerts

```yaml
# Alert when k6-webhook is unavailable
- alert: K6WebhookDown
  expr: up{job="k6-webhook"} == 0
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "k6-webhook is down"
    description: "Canary deployments will fail without load testing"
```

---

## 15. Future Enhancements

### 15.1 Short Term (3-6 months)

| Enhancement | Benefit | Effort |
|-------------|---------|--------|
| Git-sync sidecar | Real-time script updates | Medium |
| Test result archival | Historical analysis | Low |
| Custom k6 extensions | Domain-specific protocols | Medium |
| Multi-tenancy | Per-team test isolation | High |

### 15.2 Medium Term (6-12 months)

| Enhancement | Benefit | Effort |
|-------------|---------|--------|
| Distributed execution | Higher load capacity | High |
| A/B test integration | Feature flag validation | Medium |
| Chaos testing | Resilience validation | High |
| Cost attribution | Team billing | Medium |

### 15.3 Long Term (12+ months)

| Enhancement | Benefit | Effort |
|-------------|---------|--------|
| Multi-cluster fan-out | Geographic testing | Very High |
| AI-powered test generation | Reduced maintenance | High |
| Performance regression ML | Anomaly detection | High |
| Self-service portal | Developer autonomy | High |

---

## Appendix A: Command Reference

### k6 CLI Options

```bash
# Basic execution
k6 run script.js

# With environment variables
k6 run -e TARGET_URL=http://example.com -e VUS=10 script.js

# With Prometheus output
k6 run --out experimental-prometheus-rw script.js

# With custom duration
k6 run --duration 60s --vus 20 script.js

# With tags
k6 run --tag environment=dev --tag test=canary script.js
```

### Webhook Metadata Format

```yaml
webhooks:
  - name: k6-test
    url: http://k6-webhook.flagger-system/
    timeout: 5m
    metadata:
      type: cmd
      cmd: "k6 run [options] /scripts/path/to/test.js"
```

---

## Appendix B: Troubleshooting Guide

### Issue: Pod stuck in Init:0/1

**Cause:** Git clone failing

**Debug:**
```bash
kubectl logs deployment/k6-webhook -n flagger-system -c git-clone
```

**Resolution:**
- Check Azure Workload Identity configuration
- Verify Git repository URL
- Check network connectivity

### Issue: Test passes but canary fails

**Cause:** Metric template mismatch

**Debug:**
```bash
kubectl describe metrictemplate request-success-rate -n flagger-system
```

**Resolution:**
- Verify Prometheus query matches actual metrics
- Check namespace/service name in query

### Issue: High memory usage

**Cause:** Large test scripts or many concurrent tests

**Resolution:**
- Increase memory limits
- Reduce VU count
- Split tests into smaller files

---

## Appendix C: Reference Documents

- [k6 Documentation](https://k6.io/docs/)
- [Flagger Documentation](https://flagger.app/)
- [Flux GitOps Toolkit](https://fluxcd.io/docs/)
- [Azure Workload Identity](https://azure.github.io/azure-workload-identity/)
- [Istio Service Mesh](https://istio.io/docs/)

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-12 | Platform Team | Initial design |
