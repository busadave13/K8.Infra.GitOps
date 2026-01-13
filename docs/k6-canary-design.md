Design Specification: GitOps-based k6 Canary Load Testing with Flagger on AKS (Azure DevOps)

1. Overview

This document defines the full design for implementing GitOps-managed k6 load testing integrated with Flagger canary deployments on Azure Kubernetes Service (AKS). The solution uses Azure DevOps (ADO) Git as the source of truth and follows cloud-native, security-first practices using Azure Workload Identity.

The system enables automated, repeatable, and version-controlled load testing that gates canary promotions based on real traffic and k6-defined quality thresholds.

⸻

2. Goals and Non-Goals

Goals
	•	GitOps-driven management of k6 tests
	•	Secure authentication to ADO Git (no long-lived secrets)
	•	Native integration with Flagger canary analysis
	•	Environment-specific test execution (dev / staging / prod)
	•	Minimal coupling between test definitions and container images

Non-Goals
	•	UI-based load testing management
	•	Manual execution of tests outside Flagger
	•	Stateful or long-running soak testing

⸻

3. High-Level Architecture

Azure DevOps Git (k6-tests repo)
        ↓
Flux (AKS)
        ↓
Kubernetes (AKS)
 ┌───────────────────────────┐
 │ k6-webhook Deployment     │
 │  ├─ initContainer (git)   │
 │  ├─ k6 webhook service    │
 │  └─ Azure Workload ID     │
 └─────────────┬─────────────┘
               ↓
        Flagger Canary
               ↓
        Canary Service (Istio)


⸻

4. Repositories

4.1 Azure DevOps Git Repositories

k6-tests (Test Definitions)

k6-tests/
├── common/
│   ├── auth.js
│   ├── checks.js
│   └── helpers.js
├── workloads/
│   ├── my-app/
│   │   ├── smoke.js
│   │   ├── canary.js
│   │   └── stress.js
│   └── payments-api/
│       └── canary.js
├── environments/
│   ├── dev/overrides.json
│   ├── staging/overrides.json
│   └── prod/overrides.json
└── README.md

cluster-config (GitOps)

cluster-config/
├── clusters/
│   ├── dev/
│   ├── staging/
│   └── prod/
├── infra/
│   ├── flagger/
│   └── istio/
└── apps/
    └── k6-webhook/


⸻

5. GitOps with Flux on AKS

5.1 Flux Responsibilities
	•	Sync Kubernetes manifests from cluster-config
	•	Authenticate securely to ADO Git
	•	Reconcile k6-webhook, Flagger, and Istio resources

5.2 GitRepository (ADO)

apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: k6-tests
  namespace: flux-system
spec:
  interval: 1m
  url: https://dev.azure.com/<org>/<project>/_git/k6-tests
  ref:
    branch: main
  secretRef:
    name: ado-auth


⸻

6. Secure Authentication (Azure DevOps)

6.1 Azure Workload Identity
	•	AKS configured with workload identity
	•	Flux service account federated with Azure AD
	•	Azure DevOps Service Connection configured for OIDC

6.2 Authentication Flow

Flux Pod
 └─ ServiceAccount (federated)
     ↓
Azure AD
     ↓
ADO Service Connection
     ↓
ADO Git Repo (read-only)

6.3 Kubernetes Secret

apiVersion: v1
kind: Secret
metadata:
  name: ado-auth
  namespace: flux-system
type: Opaque
stringData:
  username: flux
  password: ${ADO_OIDC_TOKEN}

Token is injected dynamically via workload identity.

⸻

7. k6 Webhook Deployment Design

7.1 Deployment Pattern
	•	Uses grafana/flagger-k6-webhook
	•	Git-based initContainer clones k6 tests
	•	Tests mounted via emptyDir

7.2 Deployment Spec (Simplified)

apiVersion: apps/v1
kind: Deployment
metadata:
  name: k6-webhook
  namespace: testing
spec:
  template:
    spec:
      serviceAccountName: k6-webhook
      initContainers:
        - name: git-clone
          image: alpine/git
          args:
            - clone
            - --depth=1
            - https://dev.azure.com/<org>/<project>/_git/k6-tests
            - /scripts
          volumeMounts:
            - name: scripts
              mountPath: /scripts
      containers:
        - name: webhook
          image: ghcr.io/grafana/flagger-k6-webhook:latest
          volumeMounts:
            - name: scripts
              mountPath: /scripts
      volumes:
        - name: scripts
          emptyDir: {}


⸻

8. Flagger Canary Integration

8.1 Canary Spec Example

analysis:
  interval: 30s
  threshold: 5
  stepWeight: 10
  maxWeight: 50
  webhooks:
    - name: k6-canary
      type: rollout
      url: http://k6-webhook.testing/
      timeout: 5m
      metadata:
        cmd: >
          k6 run
          -e TARGET_URL=http://my-app-canary.app/
          /scripts/workloads/my-app/canary.js

8.2 Control Flow
	1.	Flagger shifts traffic
	2.	Flagger calls k6 webhook
	3.	k6 executes test
	4.	Exit code determines success/failure
	5.	Flagger promotes or rolls back

⸻

9. Environment Strategy

Environment	Git Ref	Purpose
dev	main	Fast feedback
staging	release/*	Pre-prod validation
prod	tags	Immutable promotion

Flux controls environment selection via ref.branch or ref.tag.

⸻

10. Observability
	•	k6 logs via stdout
	•	Optional k6 Prometheus remote write
	•	Flagger metrics via Prometheus / Istio
	•	Canary events via Kubernetes events

⸻

11. Security Considerations
	•	Read-only Git access
	•	No secrets in k6 scripts
	•	Azure AD-backed identity
	•	Namespace isolation (testing, app)

⸻

12. Failure Scenarios

Scenario	Result
k6 threshold breach	Canary rollback
Git fetch failure	Canary blocked
Webhook timeout	Canary rollback
Prometheus unavailable	Canary paused


⸻

13. Future Enhancements
	•	Artifact-based test promotion (Git → Blob)
	•	Multi-cluster fan-out
	•	Test result export to Azure Monitor
	•	Per-team test ownership

⸻

14. Summary

This design provides a secure, scalable, and GitOps-native way to run k6 load tests as first-class canary gates in AKS using Azure DevOps. It cleanly separates concerns between infrastructure, testing, and rollout logic while adhering to modern Kubernetes and Azure security best practices.