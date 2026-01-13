Design Specification: GitOps-based k6 Canary Load Testing with Flagger on AKS (GitHub)

1. Overview

This document defines the full design for implementing GitOps-managed k6 load testing integrated with Flagger canary deployments on Azure Kubernetes Service (AKS). The solution uses GitHub as the source of truth and follows cloud-native, security-first practices using GitHub App authentication or deploy keys.

The system enables automated, repeatable, and version-controlled load testing that gates canary promotions based on real traffic and k6-defined quality thresholds.

⸻

2. Goals and Non-Goals

Goals
	•	GitOps-driven management of k6 tests
	•	Secure authentication to GitHub (no long-lived secrets)
	•	Native integration with Flagger canary analysis
	•	Environment-specific test execution (dev / staging / prod)
	•	Minimal coupling between test definitions and container images

Non-Goals
	•	UI-based load testing management
	•	Manual execution of tests outside Flagger
	•	Stateful or long-running soak testing

⸻

3. High-Level Architecture

GitHub (k6-tests repo)
        ↓
Flux (AKS)
        ↓
Kubernetes (AKS)
 ┌───────────────────────────┐
 │ k6-webhook Deployment     │
 │  ├─ initContainer (git)   │
 │  ├─ k6 webhook service    │
 │  └─ GitHub App Auth       │
 └─────────────┬─────────────┘
               ↓
        Flagger Canary
               ↓
        Canary Service (Istio)


⸻

4. Repositories

4.1 GitHub Repositories

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
	•	Authenticate securely to GitHub
	•	Reconcile k6-webhook, Flagger, and Istio resources

5.2 GitRepository (GitHub)

apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: k6-tests
  namespace: flux-system
spec:
  interval: 1m
  url: https://github.com/<org>/k6-tests
  ref:
    branch: main
  secretRef:
    name: github-auth


⸻

6. Secure Authentication (GitHub)

6.1 GitHub App Authentication
	•	GitHub App installed on the repository
	•	App generates short-lived installation tokens
	•	Flux uses token for read-only repository access

6.2 Alternative: Deploy Keys
	•	SSH deploy key with read-only access
	•	Key stored as Kubernetes Secret
	•	Simpler setup for single-repo access

6.3 Authentication Flow

Flux Pod
 └─ ServiceAccount
     ↓
GitHub App / Deploy Key
     ↓
GitHub API
     ↓
GitHub Repo (read-only)

6.4 Kubernetes Secret (GitHub App)

apiVersion: v1
kind: Secret
metadata:
  name: github-auth
  namespace: flux-system
type: Opaque
stringData:
  username: x-access-token
  password: ${GITHUB_APP_TOKEN}

Token is generated via GitHub App installation access token.

6.5 Kubernetes Secret (Deploy Key - SSH)

apiVersion: v1
kind: Secret
metadata:
  name: github-auth
  namespace: flux-system
type: Opaque
stringData:
  identity: ${SSH_PRIVATE_KEY}
  known_hosts: ${GITHUB_KNOWN_HOSTS}


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
            - https://github.com/<org>/k6-tests
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
	•	GitHub App or deploy key authentication
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
	•	Test result export to GitHub Actions or external monitoring
	•	Per-team test ownership
	•	GitHub Actions integration for CI/CD pipelines

⸻

14. Summary

This design provides a secure, scalable, and GitOps-native way to run k6 load tests as first-class canary gates in AKS using GitHub. It cleanly separates concerns between infrastructure, testing, and rollout logic while adhering to modern Kubernetes and GitHub security best practices.
