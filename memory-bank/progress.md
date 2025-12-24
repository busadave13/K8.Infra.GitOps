# Progress

## Completed Tasks

### 2025-12-24

1. **Configured Flagger for Azure Managed Prometheus (Staging)**
   - Issue: Flagger HelmRelease failed with "helmreleases.helm.toolkit.fluxcd.io 'prometheus' not found"
   - Root cause: Flagger had dependency on self-managed Prometheus HelmRelease which doesn't exist in staging (uses Azure Managed Prometheus)
   - Additional issues encountered during deployment:
     - HelmRepository "flagger" not found - needed to add flagger-helm.yaml to repository kustomization
     - `secret "discord-webhook" not found` - needed to create the secret in flagger-system namespace
   - Solution: Created staging-specific Flagger configuration with Azure Managed Prometheus integration
   - Files created:
     - `infrastructure/staging/flagger/kustomization.yaml` - Patches base Flagger for staging
     - `infrastructure/staging/flagger/helmrelease-patch.yaml` - Removes Prometheus dependency, configures Azure endpoint
     - `infrastructure/staging/flagger/serviceaccount.yaml` - ServiceAccount with Workload Identity annotations
     - `infrastructure/staging/flagger/metric-templates/kustomization.yaml` - Staging metric templates
     - `infrastructure/staging/flagger/metric-templates/request-success-rate.yaml` - Points to Azure Managed Prometheus
     - `infrastructure/staging/flagger/metric-templates/request-duration.yaml` - Points to Azure Managed Prometheus
   - Files modified:
     - `infrastructure/staging/kustomization.yaml` - Added flagger to resources
     - `clusters/staging/flagger-config.yaml` - Updated path to staging metric templates
     - `infrastructure/base/repository/kustomization.yaml` - Added flagger-helm.yaml
   - Configuration:
     - Azure Managed Prometheus endpoint: `https://amw-azr-staging-wus2-apa7cuf8ddhwhrfr.westus2.prometheus.monitor.azure.com`
     - ServiceAccount: `flagger-sa` with Azure Workload Identity
     - Requires Azure Managed Identity with "Monitoring Data Reader" role
   - Status: **Flagger and flagger-loadtester pods running successfully**
   - Azure Setup Required (manual):
     - Create Managed Identity for Flagger
     - Assign "Monitoring Data Reader" role on Azure Monitor Workspace
     - Create Federated Credential for `flagger-system:flagger-sa`
     - Update `<FLAGGER_MANAGED_IDENTITY_CLIENT_ID>` placeholder in serviceaccount.yaml

### 2025-12-23

1. **Configured Staging Gateway API for AKS with Static IP**
   - Created staging-specific Gateway API configuration for AKS
   - Files created:
     - `infrastructure/staging/gateway-api/gateway.yaml` - Gateway with AKS LoadBalancer annotations
     - `infrastructure/staging/gateway-api/kustomization.yaml` - Includes gateway, HPA, and PDB
     - `infrastructure/staging/gateway-api/horizontalpodautoscaler.yaml` - HPA for gateway pods
     - `infrastructure/staging/gateway-api/poddisruptionbudget.yaml` - PDB for gateway pods
   - Configuration:
     - Static IP: `4.155.149.229`
     - Resource Group: `rg-xpci-staging-wus2`
     - Hostname: `davhar.westus2.cloudapp.azure.com` (exact match)
     - HTTP listener on port 80
   - Used Gateway API `infrastructure.annotations` field (Istio 1.22+) to configure LoadBalancer service annotations
   - Updated `clusters/staging/ingress.yaml` to point to `./infrastructure/staging/gateway-api` instead of base

### 2025-12-22

1. **Fixed Istio HelmRepository Namespace Issue**
   - Issue: Flux reconciliation failed with "HelmRepository/istio namespace not specified"
   - Root cause: `infrastructure/staging/kustomization.yaml` directly referenced `../base/repository/istio-helm.yaml` instead of through the parent kustomization, bypassing the namespace setting
   - Fix: Added `namespace: flux-system` explicitly to `infrastructure/base/repository/istio-helm.yaml` metadata
   - File modified: `infrastructure/base/repository/istio-helm.yaml`

2. **Added Timeout Settings to Istio HelmReleases**
   - Issue: istiod installation failed with "context deadline exceeded" (default 5m timeout)
   - Fix: Added `timeout: 10m` to install and upgrade sections of both Istio HelmReleases
   - Files modified:
     - `infrastructure/base/istio-base/helmrelease.yaml` - Added 10m timeout
     - `infrastructure/base/istiod/helmrelease.yaml` - Added 10m timeout
   - Rationale: Istio components can take longer to initialize (CRDs, webhooks, image pulls)

3. **Added Explicit releaseName to Istio HelmReleases**
   - Issue: Helm releases were created with namespace-prefixed names (`istio-system-istiod`) instead of simple names
   - This caused confusion and made rollbacks fail with "MissingRollbackTarget"
   - Fix: Added `releaseName` field to explicitly control Helm release names
   - Files modified:
     - `infrastructure/base/istio-base/helmrelease.yaml` - Added `releaseName: istio-base`
     - `infrastructure/base/istiod/helmrelease.yaml` - Added `releaseName: istiod`

4. **Resolved Staging Cluster Pod Capacity Issue**
   - Issue: istiod pod stuck in Pending with "Too many pods" (30/30 pods on single node)
   - Root cause: AKS staging cluster had only 1 node with maxPods=30
   - Resolution: Scaled nodepool from 1 to 2 nodes
   - Command used: `az aks nodepool scale --resource-group rg-xpci-staging-wus2 --cluster-name aks-xpci-staging-wus2 --name system --node-count 2`
   - Result: All HelmReleases and Kustomizations now Ready

### 2025-12-21

1. **Added Staging Environment to GitOps Cluster**
   - Created `clusters/staging/` directory with:
     - `apps.yaml` - Kustomization for apps/staging
     - `infrastructure.yaml` - Kustomization for infrastructure/staging
     - `flagger-config.yaml` - Flagger metric templates
     - `ingress.yaml` - Gateway API configuration
   - Created `infrastructure/staging/` directory with:
     - `kustomization.yaml` - Minimal infrastructure (namespaces, CRDs, istio-base, istiod)
     - `patches/istio-ingress-patch.yaml` - Resource limits for staging
   - Created `apps/staging/kustomization.yaml` - All apps enabled (fluxcd, weather, mockery, podinfo)

2. **Fixed Staging Configuration Issues**
   - Fixed YAML indentation in `infrastructure/staging/kustomization.yaml`
   - Commented out healthChecks for disabled HelmReleases in `clusters/staging/infrastructure.yaml`
   - Fixed incorrect Gateway healthCheck in `clusters/staging/apps.yaml`:
     - Changed from `name: waypoint, namespace: podinfo` (non-existent)
     - To `name: gateway-api, namespace: istio-ingress` (actual Gateway)
   - Also fixed same Gateway healthCheck issue in `clusters/dev/apps.yaml` for consistency

3. **Verified All Kustomize Builds Pass**
   - `kubectl kustomize infrastructure/staging` ✅
   - `kubectl kustomize apps/staging` ✅
   - `kubectl kustomize infrastructure/base/gateway-api` ✅
   - `kubectl kustomize infrastructure/base/flagger/metric-templates` ✅

### 2025-12-16

1. **Added Vertical Pod Autoscaler (VPA) Support**
   - Created `infrastructure/base/.repositories/vpa-helm.yaml` (Fairwinds Stable Helm repo)
   - Updated `infrastructure/base/.repositories/kustomization.yaml` to include VPA repo
   - Created `infrastructure/base/vpa/helmrelease.yaml` with:
     - VPA Recommender enabled (analyzes resource usage)
     - VPA Updater disabled (Off mode - no automatic updates)
     - VPA Admission Controller disabled (Off mode)
   - Created `infrastructure/base/vpa/kustomization.yaml`
   - Updated `infrastructure/base/kustomization.yaml` to include VPA
   - Created `apps/base/podinfo/verticalpodautoscaler.yaml`:
     - Targets `podinfo-primary` deployment (Flagger-managed)
     - Mode: `Off` (recommendations only)
     - Container: `podinfod`
     - CPU bounds: 50m - 2 cores
     - Memory bounds: 32Mi - 1Gi
   - Removed `apps/base/podinfo/horizontalpodautoscaler.yaml` (replaced with VPA)
   - Updated `apps/base/podinfo/kustomization.yaml` to use VPA instead of HPA
   - Created `infrastructure/base/grafana/vpa-dashboard-configmap.yaml`:
     - VPA Overview: Containers monitored, update mode, total VPAs
     - CPU Recommendations: Target, lower/upper bounds, current request, actual usage
     - Memory Recommendations: Target, lower/upper bounds, current request, actual usage
     - All VPAs Overview table
     - Dropdown filters: Namespace, VPA, Container, Target Deployment
   - Updated `infrastructure/base/grafana/kustomization.yaml` to include VPA dashboard
   - Access at: http://grafana.tools.com → Dashboards → Kubernetes / Vertical Pod Autoscaler
   - View recommendations: `kubectl get vpa podinfo-vpa -n podinfo -o yaml`

2. **Added Alertmanager Web UI HTTPRoute**
   - Created `infrastructure/base/prometheus/alertmanager-httproute.yaml`
   - Routes `alertmanager.tools.com` to `prometheus-alertmanager` service on port 9093
   - Updated `infrastructure/base/prometheus/kustomization.yaml` to include new HTTPRoute
   - Updated `README.md` hosts file section with `alertmanager.tools.com`
   - Access at: http://alertmanager.tools.com (after adding to hosts file)

2. **Added Prometheus Alertmanager Dashboard**
   - Downloaded and adapted Grafana dashboard ID 24109
   - Created `infrastructure/base/grafana/prometheus-alertmanager-dashboard-configmap.yaml`
   - Features:
     - **General Info**: Instance count, versions, uptime, cluster size
     - **Alert States**: Active alerts, suppressed alerts, silences count
     - **Notifications**: Notifications sent per integration, notification durations
     - **Received Alerts**: Alert status breakdown
   - Added Alertmanager scrape config to Prometheus:
     - Job: `prometheus-alertmanager`
     - Target: `prometheus-alertmanager.monitor.svc.cluster.local:9093`
   - Fixed datasource references (`${DS_DS_PROMETHEUS}` → `Prometheus`)
   - Updated `infrastructure/base/grafana/kustomization.yaml`
   - Removed old `alertmanager-dashboard-configmap.yaml`
   - Access at: http://grafana.tools.com → Dashboards → Prometheus Alertmanager

2. **Added Kubernetes App Metrics Dashboard**
   - Downloaded and adapted Grafana dashboard ID 1471
   - Created `infrastructure/base/grafana/kubernetes-app-metrics-dashboard-configmap.yaml`
   - Features:
     - **Dropdown Filters**: Namespace and Container selection
     - **Request Rate**: HTTP requests by response code (native, nginx, haproxy)
     - **Error Rate**: 5xx error percentage
     - **Response Time Percentiles**: p50, p90, p99 latency
     - **Pod Count**: Pods and hosts over time
     - **CPU Usage**: Relative to request, relative to limit, per pod, avg per pod, total
     - **Memory Usage**: Relative to limit, per pod, avg per pod, total
   - Updated `infrastructure/base/grafana/kustomization.yaml`
   - Access at: http://grafana.tools.com → Dashboards → Kubernetes App Metrics

### 2025-12-15 (continued)

8. **Added Kubernetes Pod Health & Readiness Dashboard**
   - Created `infrastructure/base/grafana/kubernetes-pod-health-dashboard-configmap.yaml`
   - Features:
     - **Dropdown Filters**: Namespace and Workload selection
     - **Overview Stats**: Active Pods, Not Ready Pods, Total Restarts, Pods with Restarts
     - **Pod Details Table**: Pod name, namespace, phase, ready status, restarts, age
     - **Restart Analysis**: Container restarts over time graph, termination reasons pie chart
     - **Readiness Tracking**: Ready vs Not Ready pods over time (stacked area chart)
     - **Container States**: Containers in waiting state table, last termination reason & restarts table
     - **All Namespaces Summary**: Aggregated view by namespace
   - Key metrics used:
     - `kube_pod_status_ready` - Pod readiness condition
     - `kube_pod_container_status_restarts_total` - Container restart count
     - `kube_pod_container_status_last_terminated_reason` - Why container was killed
     - `kube_pod_container_status_waiting_reason` - Why container is waiting
     - `kube_pod_created` - Pod age calculation
   - Updated `infrastructure/base/grafana/kustomization.yaml`
   - Access at: http://grafana.tools.com → Dashboards → Kubernetes / Pod Health & Readiness


7. **Fixed Istio Workload Dashboard Double-Counting RPS**
   - Issue: Dashboard showed ~41 RPS when k6 was sending only 10 RPS (4x discrepancy)
   - Root causes identified:
     - Metrics scraped by both `envoy-stats` and `kubernetes-pods` jobs (2x)
     - User had 2 k6 containers running simultaneously (2x)
   - Fix: Added `job="kubernetes-pods"` filter to all queries in the dashboard
   - File modified: `infrastructure/base/grafana/istio-workload-dashboard-configmap.yaml`
   - All panels updated: Inbound/Outbound Request Volume, Success Rate, Response Codes, Duration
   - Result: Dashboard now shows correct RPS (~10.6 RPS matching k6's 10 RPS target)


### 2025-12-14

1. **Removed Fortio Load Testing**
   - Deleted `infrastructure/base/fortio/` directory (deployment, service, httproute, kustomization)
   - Deleted `fortio/` directory (README, PowerShell scripts)
   - Removed fortio namespace from `infrastructure/base/namespaces/namespaces.yaml`
   - Updated `infrastructure/base/kustomization.yaml` to remove fortio
   - Updated `README.md` to remove Fortio references

2. **Added Locust Load Testing**
   - Created distributed Locust cluster with master/worker architecture
   - Files created:
     - `infrastructure/base/locust/configmap.yaml` - Python test script
     - `infrastructure/base/locust/master-deployment.yaml` - Locust master
     - `infrastructure/base/locust/worker-deployment.yaml` - 2 worker replicas
     - `infrastructure/base/locust/service.yaml` - Master service
     - `infrastructure/base/locust/httproute.yaml` - Routes locust.tools.com
     - `infrastructure/base/locust/kustomization.yaml`
   - Added locust namespace to `infrastructure/base/namespaces/namespaces.yaml`
   - Access: http://locust.tools.com
   - Pre-configured tests for MockeryUser (75%) and PodinfoUser (25%)

3. **Fixed Locust DNS Resolution**
   - Issue: "Name or service not known" error for mockery service
   - Root cause: Service name was incorrect
   - Fix: Updated configmap, master-deployment, and worker-deployment with correct service name

4. **Merged Locust Documentation**
   - Deleted standalone `locust/README.md` folder
   - Merged full Locust documentation into main README.md
   - Includes architecture diagram, pre-configured tests, scaling, custom scripts, CLI usage, troubleshooting

5. **Added Weather App Configuration**
   - Created `apps/base/weather/` directory with:
     - `helmrelease.yaml` - Deploys from github HelmRepository
     - `httproute.yaml` - Routes to weather.local.com
     - `canary.yaml` - Flagger canary with load test webhook
     - `serviceaccount.yaml` - Service account for weather app
     - `kustomization.yaml` - Includes all resources
   - Added weather namespace with `istio-injection: enabled`
   - Added weather to `apps/base/kustomization.yaml`

6. **Created Weather Load Test (k6)**
   - New script: `k6/scripts/weather-load-test.js`
   - URL: `http://weather.local.com/api/weather`
   - Header: `X-Mockery-Mocks: windsensor/success, windsensor/success-2, temperaturesensor/success, precipitationsensor/success`
   - Configurable via `K6_MOCKERY_MOCKS` environment variable
   - Default: 200 RPS for 30 minutes

7. **Simplified k6 Setup (Removed InfluxDB/Grafana)**
   - Removed from `docker-compose.yml`:
     - `influxdb` service
     - `grafana` service (k6-specific)
     - Related volumes (`influxdb_data`, `grafana_data`)
     - InfluxDB dependency from k6
   - Added `weather.local.com` to k6 extra_hosts
   - Deleted `k6/grafana/` directory (provisioning, dashboards)
   - Updated `k6/scripts/mockery-load-test.js` to remove InfluxDB references
   - Simplified `k6/README.md` with CLI-only usage

8. **Updated Documentation**
   - Added weather.local.com to hosts file section in README.md
   - Added Weather app to Applications table
   - Updated k6 section with simplified commands
   - Updated memory bank files (activeContext.md, progress.md, techContext.md)

### 2025-12-13

1. **Fixed Bootstrap Dependency Chain**
   - Issue: `flagger-config` failed with "MetricTemplate CRD not found" on fresh bootstraps
   - Root cause: Infrastructure kustomization reported Ready before HelmReleases were actually deployed
   - Fix: Added `wait: true` and `healthChecks` to both `infrastructure.yaml` and `flagger-config.yaml`
   - Files modified:
     - `clusters/dev/infrastructure.yaml` - Added healthChecks for istiod, flagger, prometheus, grafana
     - `clusters/dev/flagger-config.yaml` - Added healthCheck for Flagger deployment

2. **Fixed Mockery HelmRelease Failure**
   - Issue: Helm upgrade failed with "nil pointer evaluating .Values.service.targetPort"
   - Root cause: Chart version 0.1.27 added requirement for service.targetPort value
   - Fix: Added `values.service.port` and `values.service.targetPort` to `apps/base/mockery/helmrelease.yaml`

3. **Fixed Mockery Service (503 Error)**
   - Issue: Service selector `release: mockery` didn't match pod labels `release: mockery-mockery`
   - Fix: Updated `apps/base/mockery/service.yaml` selector to `release: mockery-mockery`
   - Result: Service now has endpoints, routing works

4. **Added Canary Support for Mockery**
   - Created `apps/base/mockery/canary.yaml` with Flagger configuration
   - Updated `apps/base/mockery/kustomization.yaml` to include canary
   - Updated `apps/base/mockery/httproute.yaml` to route to `mockery` (Flagger-managed)
   - Status: Initialized and ready for deployments

5. **Fixed Flagger Canary Overview Dashboard**
   - Issue: Dashboard showed no data for Primary/Canary metrics
   - Cause: Regex match (`=~`) was matching both primary and canary workloads
   - Fix: Changed to exact match (`=`) in `infrastructure/base/grafana/flagger-canary-overview-configmap.yaml`
   - Primary queries now match `$workload-primary`, Canary queries match `$workload`

6. **Created k6 Load Testing Stack**
   - Added `k6/` directory with docker-compose stack
   - Created `k6/scripts/mockery-load-test.js` - 200 RPS constant rate
   - Created `k6/scripts/podinfo-load-test.js` - 10 RPS constant rate
   - Scripts use `noConnectionReuse: true` to improve load distribution

## Known Issues

1. **Flagger Canary Status Metric**
   - `flagger_canary_status` shows 0 (Unknown) even when canary is progressing
   - This appears to be a Flagger metrics issue, not a configuration problem
   - Workaround: Use `kubectl get canary` to check actual status

2. **k6 Load Distribution**
   - k6 uses HTTP/2 connection reuse by default, causing uneven pod distribution
   - Mitigation: Use `noConnectionReuse: true` in k6 options
   - Alternative: Use Locust for better load distribution

### 2025-12-15

1. **Added HPA for Podinfo**
   - Created `apps/base/podinfo/horizontalpodautoscaler.yaml`
   - Targets `podinfo-primary` deployment (Flagger-managed)
   - Settings: minReplicas=1, maxReplicas=5, CPU target=70%
   - Updated `apps/base/podinfo/kustomization.yaml` to include HPA

2. **Added Kubernetes HPA Dashboard to Grafana**
   - Created `infrastructure/base/grafana/kubernetes-hpa-dashboard-configmap.yaml`
   - Based on Grafana Labs dashboard ID 17125
   - Features:
     - Stat panels for Desired/Current/Min/Max replicas
     - Time series graph showing replicas over time
     - CPU utilization vs target chart
     - All HPAs overview table
   - Dropdown filters for Namespace, HPA, and Deployment
   - Updated `infrastructure/base/grafana/kustomization.yaml`
   - Access at: http://grafana.tools.com → Dashboards → Kubernetes / Horizontal Pod Autoscaler

3. **Created Combined k6 Load Test**
   - New script: `k6/scripts/combined-load-test.js`
   - Tests all three services (Mockery, Weather, Podinfo) simultaneously
   - Uses k6 scenarios for independent RPS control per service
   - Default RPS: 100/100/10 (Mockery/Weather/Podinfo)
   - Supports disabling services by setting RPS to 0
   - Per-service metrics and thresholds
   - Configurable via environment variables or k6 CLI --env flags
   - Updated k6/README.md with full documentation

2. **Fixed Flagger Canary Overview Dashboard Traffic Weights**
   - Issue: Dashboard showed 100% Primary / 0% Canary even when canary was actively progressing at 40%
   - Root cause: The OR query created duplicate entries for actively progressing canaries:
     - `flagger_canary_weight{workload="podinfo"}` returned 40 (actual weight)
     - `flagger_canary_status{name="podinfo"} * 0` returned 0 (fallback)
     - Grafana's `seriesToColumns` transformation picked the wrong value (0)
   - Solution: Added `max by (name, exported_namespace)` aggregation to the query
     - This ensures the actual weight value takes precedence over the 0 fallback
   - File modified: `infrastructure/base/grafana/flagger-canary-overview-configmap.yaml`

2. **Fixed Istio Canary Dashboard Dropdown Filters**
   - Issue: Both Primary and Canary dropdowns showed all workloads, causing Canary dropdown to incorrectly show `*-primary` workloads
   - Root cause: Both dropdowns used the same query without any filtering
   - Solution: 
     - Primary dropdown now filters to only show workloads matching `.*-primary`
     - Canary dropdown now filters to exclude workloads matching `.*-primary`
   - File modified: `infrastructure/base/grafana/flagger-dashboard-configmap.yaml`

3. **Fixed Flux Cluster Stats Dashboard**
   - Issue: Dashboard showed "No data" for Cluster Reconcilers, Failing Reconcilers, Kubernetes Manifests Sources, Failing Sources
   - Root cause: Dashboard queries `gotk_reconcile_condition` metric which is no longer exposed by FluxCD v2.0+ controllers directly
   - Solution: Configured kube-state-metrics to generate `gotk_reconcile_condition` metrics from FluxCD CRD status conditions
   - Files modified:
     - `infrastructure/base/kube-state-metrics/helmrelease.yaml` - Added custom resource state configuration for FluxCD CRDs
     - `infrastructure/base/prometheus/helmrelease.yaml` - Added scrape job for kube-state-metrics service
   - Metrics now available: HelmRelease, Kustomization, GitRepository, HelmRepository, HelmChart status conditions

2. **Renamed mockery-dep to mockery**
   - Renamed Flagger target deployment from `mockery-dep` to `mockery`
   - Updated files:
     - `apps/base/mockery/canary.yaml` - targetRef.name and webhook URL
     - `apps/base/mockery/httproute.yaml` - backendRef name
     - `infrastructure/base/locust/configmap.yaml` - MOCKERY_HOST default
     - `infrastructure/base/locust/master-deployment.yaml` - MOCKERY_HOST env
     - `infrastructure/base/locust/worker-deployment.yaml` - MOCKERY_HOST env
     - `README.md` - Documentation references
   - Flagger will now create services: `mockery`, `mockery-primary`, `mockery-canary`

3. **Added Fortio Load Testing**
   - Created `fortio/` directory with bash-based load testing scripts
   - Scripts created:
     - `fortio/podinfo-load-test.sh` - Tests podinfo.local.com (100 QPS default)
     - `fortio/mockery-load-test.sh` - Tests mockery.local.com (10 QPS default)
     - `fortio/weather-load-test.sh` - Tests weather.local.com (30 QPS default)
   - Features:
     - 🎨 Colorful output with emojis and formatted tables
     - ⏱️ Countdown timer with progress bar showing remaining time
     - 📈 Response code breakdown with color-coded status (green/yellow/red)
     - 📊 Latency percentiles (p50/p90/p99) in milliseconds
     - 📊 True RPS calculation (requests / duration) displayed alongside Requested QPS
     - ⚙️ Configurable via command-line flags or environment variables
   - Options: `--qps=N`, `--duration=TIME`, `--connections=N`, `--url=URL`
   - Uses `-allow-initial-errors` flag to continue testing even with non-2xx responses
   - Created `fortio/README.md` - Full documentation with sample output

4. **Added Prometheus Adapter for RPS-based HPA Scaling**
   - Created `infrastructure/base/prometheus-adapter/` directory:
     - `helmrelease.yaml` - Deploys prometheus-adapter chart with custom RPS rules
     - `kustomization.yaml` - Includes helmrelease
   - Updated `infrastructure/base/kustomization.yaml` to include prometheus-adapter
   - Custom metrics exposed:
     - `istio_requests_per_second` - Generic RPS per pod for Istio workloads
     - `podinfo_requests_per_second` - Specific RPS metric for podinfo-primary
   - Updated `apps/base/podinfo/horizontalpodautoscaler.yaml`:
     - Added External metric `podinfo_requests_per_second` with target 100 RPS
     - Added scale behavior configuration (5m stabilization for scale-down, immediate scale-up)
     - Kept existing CPU utilization metric (70% target)

5. **Fixed Prometheus Adapter Double-Counting RPS Metrics**
   - Issue: RPS metrics showed ~20 RPS when k6 was sending only 10 RPS
   - Root causes identified:
     - Metrics scraped by both `envoy-stats` and `kubernetes-pods` jobs
     - Metrics reported from both source (gateway) and destination (podinfo) sides
   - Fix: Added filters to prometheus-adapter HelmRelease:
     - `job="kubernetes-pods"` - Use only kubernetes-pods job metrics
     - `reporter="destination"` - Use only destination-side metrics
   - File modified: `infrastructure/base/prometheus-adapter/helmrelease.yaml`
   - Result: HPA now shows correct RPS (~10.6 RPS matching k6's 10 RPS target)

6. **Added Weather HPA with RPS-based Scaling**
   - Created `apps/base/weather/horizontalpodautoscaler.yaml`:
     - Targets `weather-primary` deployment (Flagger-managed)
     - Scales based on CPU (70%) OR RPS (100 per replica)
     - Same scale behavior as podinfo (5m stabilization for scale-down)
   - Added `weather_requests_per_second` external metric to prometheus-adapter
   - Updated `apps/base/weather/kustomization.yaml` to include HPA

8. **Reorganized k6 Scripts Structure**
   - Moved scripts from `k6/scripts/` to `k6/`:
     - `combined-load-test.js`
     - `mockery-load-test.js`
     - `podinfo-load-test.js`
     - `weather-load-test.js`
   - Deleted `k6/scripts/` folder
   - Updated `docker-compose.yml` volume mount: `./k6:/scripts`
   - Updated `k6/README.md` with new directory structure
   - Updated script header comments

9. **Fixed Istio Gateway Dashboard Double-Counting RPS**
   - Issue: Dashboard showed ~299 req/s when k6 was sending 100 RPS
   - Root cause: Metrics scraped by multiple Prometheus jobs
   - Fix: Added `job="kubernetes-pods"` filter to all queries
   - File modified: `infrastructure/base/grafana/istio-gateway-dashboard-configmap.yaml`
   - All panels updated: Gateway Request Volume, Success Rate, P99 Latency, etc.
   - Result: Dashboard now shows correct RPS (~100 RPS matching k6's target)

## Pending Tasks

- [ ] Deploy weather app and verify canary initialization
- [ ] Test weather canary deployment by updating Helm chart version
- [ ] Add weather app to Locust tests
- [ ] Add canary support for other applications (aspire, etc.)

### 2025-12-24 (continued)

2. **Fixed Flagger PodMonitor CRD Error**
   - Issue: Helm upgrade failed with "no matches for kind 'PodMonitor' in version 'monitoring.coreos.com/v1'"
   - Root cause: Staging patch at `infrastructure/staging/flagger/helmrelease-patch.yaml` had `podMonitor.enabled: true`, which requires Prometheus Operator CRDs (using Azure Managed Prometheus instead)
   - Solution: Removed/commented out the staging Flagger patch and now using base configuration directly
   - Base configuration already correct:
     - `podMonitor.enabled: false` - prevents PodMonitor resource creation
     - `podAnnotations` for Azure Managed Prometheus scraping:
       - `prometheus.io/scrape: "true"`
       - `prometheus.io/port: "8080"`
       - `prometheus.io/path: "/metrics"`
   - File modified: `infrastructure/staging/kustomization.yaml` - commented out flagger helmrelease-patch.yaml
   - Result: Flagger HelmRelease now deploys successfully using base configuration

3. **Added Canary Support for Podinfo**
   - Created `apps/base/podinfo/canary.yaml` with Flagger configuration
   - Configuration:
     - Provider: Istio
     - Target: podinfo Deployment
     - Service port: 9898 (matches podinfo container port)
     - Analysis: 1m interval, 5 threshold, 10% step weight up to 50%
     - Metrics: success-rate (99% min), latency-p99 (500ms max)
     - Load test webhook using Flagger loadtester
   - Updated `apps/base/podinfo/kustomization.yaml` to include canary.yaml
   - Flagger will create services: `podinfo`, `podinfo-primary`, `podinfo-canary`
