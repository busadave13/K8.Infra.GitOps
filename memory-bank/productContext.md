# Product Context

## Purpose
K8.Local.Dev.Environment is a local Kubernetes development environment designed to simulate a production-like infrastructure setup using FluxCD, Istio, Flagger, and other cloud-native tools.

## Problems Solved
- Enables local development and testing of Kubernetes deployments with GitOps workflows
- Provides canary deployment capabilities using Flagger with Istio service mesh
- Offers observability stack with Prometheus, Grafana, and Kiali
- Allows testing of Gateway API HTTPRoutes locally

## User Experience
Developers can:
1. Deploy applications via GitOps (FluxCD) to a local Kubernetes cluster
2. Test canary deployments with automated traffic shifting
3. Monitor application metrics and mesh traffic through dashboards
4. Access services via local domain names (*.local.com, *.tools.com)

## Key Features
- FluxCD for GitOps-based deployments
- Istio service mesh with Gateway API support
- Flagger for progressive delivery (canary deployments)
- Grafana dashboards for Istio and Flagger metrics
- Prometheus for metrics collection
- Kiali for service mesh visualization
