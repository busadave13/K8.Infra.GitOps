#!/bin/bash
# GitOps Canary Deployment Test Script
# This script triggers a canary deployment by updating the deployment in Git

set -e

# Configuration
NAMESPACE=${NAMESPACE:-podinfo}
DEPLOYMENT=${DEPLOYMENT:-podinfo}
DEPLOYMENT_FILE="apps/base/podinfo/deployment.yaml"
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")

# Available podinfo versions for testing
VERSIONS=("6.0.0" "6.0.1" "6.1.0" "6.1.1" "6.2.0" "6.3.0")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Get current version from deployment file
get_current_version() {
    grep "image: ghcr.io/stefanprodan/podinfo:" "$REPO_ROOT/$DEPLOYMENT_FILE" | head -1 | sed 's/.*podinfo:\([0-9.]*\).*/\1/'
}

# Get next version (cycle through versions)
get_next_version() {
    local current=$1
    local found=0
    for i in "${!VERSIONS[@]}"; do
        if [ "${VERSIONS[$i]}" == "$current" ]; then
            local next_index=$(( (i + 1) % ${#VERSIONS[@]} ))
            echo "${VERSIONS[$next_index]}"
            return
        fi
    done
    # If current version not in list, use first version
    echo "${VERSIONS[0]}"
}

# Show usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "GitOps-based canary deployment trigger for podinfo"
    echo ""
    echo "Options:"
    echo "  -v, --version VERSION   Specify target version (e.g., 6.1.0)"
    echo "  -n, --next              Automatically use next version in cycle"
    echo "  -l, --list              List available versions"
    echo "  -s, --status            Show current canary status only"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Available versions: ${VERSIONS[*]}"
    echo ""
    echo "Examples:"
    echo "  $0 --next           # Deploy next version in cycle"
    echo "  $0 -v 6.1.0         # Deploy specific version"
    echo "  $0 --status         # Check current status"
}

# Update deployment file with new version
update_deployment() {
    local new_version=$1
    local file="$REPO_ROOT/$DEPLOYMENT_FILE"
    
    echo "Updating $DEPLOYMENT_FILE to version $new_version..."
    
    # Update image tag
    sed -i "s|image: ghcr.io/stefanprodan/podinfo:[0-9.]*|image: ghcr.io/stefanprodan/podinfo:$new_version|g" "$file"
    
    # Update version labels
    sed -i "s|version: [0-9.]*|version: $new_version|g" "$file"
    
    print_success "Updated deployment file to version $new_version"
}

# Commit and push changes
commit_and_push() {
    local version=$1
    
    echo "Committing changes to Git..."
    cd "$REPO_ROOT"
    
    git add "$DEPLOYMENT_FILE"
    git commit -m "chore(podinfo): Update to version $version for canary test"
    
    echo "Pushing to remote..."
    git push
    
    print_success "Changes pushed to Git"
}

# Trigger Flux reconciliation
trigger_flux_reconcile() {
    echo "Triggering Flux reconciliation..."
    
    # Reconcile source first, then apps
    flux reconcile source git flux-system 2>/dev/null || true
    sleep 2
    flux reconcile kustomization apps 2>/dev/null || true
    
    print_success "Flux reconciliation triggered"
}

# Monitor canary progress
monitor_canary() {
    echo ""
    print_header "Monitoring Canary Progress"
    echo "Press Ctrl+C to stop monitoring..."
    echo ""
    
    local last_status=""
    local last_weight=""
    
    while true; do
        local status=$(kubectl get canary $DEPLOYMENT -n $NAMESPACE -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
        local weight=$(kubectl get canary $DEPLOYMENT -n $NAMESPACE -o jsonpath='{.status.canaryWeight}' 2>/dev/null || echo "0")
        local failed_checks=$(kubectl get canary $DEPLOYMENT -n $NAMESPACE -o jsonpath='{.status.failedChecks}' 2>/dev/null || echo "0")
        local iterations=$(kubectl get canary $DEPLOYMENT -n $NAMESPACE -o jsonpath='{.status.iterations}' 2>/dev/null || echo "0")
        
        # Only print if status or weight changed
        if [ "$status" != "$last_status" ] || [ "$weight" != "$last_weight" ]; then
            local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
            printf "[%s] Status: %-15s | Weight: %3s%% | Iterations: %s | Failed: %s\n" \
                "$timestamp" "$status" "$weight" "$iterations" "$failed_checks"
            
            last_status="$status"
            last_weight="$weight"
        fi
        
        case "$status" in
            "Succeeded")
                echo ""
                print_success "Canary deployment succeeded!"
                kubectl get canary $DEPLOYMENT -n $NAMESPACE
                return 0
                ;;
            "Failed")
                echo ""
                print_error "Canary deployment failed!"
                echo ""
                echo "Recent events:"
                kubectl describe canary $DEPLOYMENT -n $NAMESPACE | tail -15
                return 1
                ;;
        esac
        
        sleep 10
    done
}

# Show current status
show_status() {
    print_header "Current Canary Status"
    kubectl get canary -n $NAMESPACE -o wide 2>/dev/null || echo "No canaries found in namespace $NAMESPACE"
    echo ""
    
    print_header "Current Deployment Version"
    local current_version=$(get_current_version)
    echo "Git version: $current_version"
    
    local running_version=$(kubectl get deployment $DEPLOYMENT -n $NAMESPACE -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null | sed 's/.*://')
    echo "Running version: $running_version"
}

# Main logic
main() {
    local target_version=""
    local auto_next=false
    local show_status_only=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--version)
                target_version="$2"
                shift 2
                ;;
            -n|--next)
                auto_next=true
                shift
                ;;
            -l|--list)
                echo "Available versions: ${VERSIONS[*]}"
                exit 0
                ;;
            -s|--status)
                show_status_only=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
    
    # Show status only mode
    if [ "$show_status_only" = true ]; then
        show_status
        exit 0
    fi
    
    # Determine target version
    local current_version=$(get_current_version)
    
    if [ -n "$target_version" ]; then
        # Use specified version
        :
    elif [ "$auto_next" = true ]; then
        target_version=$(get_next_version "$current_version")
    else
        # Interactive mode - show options
        print_header "GitOps Canary Deployment Test"
        echo ""
        echo "Current version in Git: $current_version"
        echo ""
        echo "Available versions:"
        for i in "${!VERSIONS[@]}"; do
            if [ "${VERSIONS[$i]}" == "$current_version" ]; then
                echo "  $((i+1)). ${VERSIONS[$i]} (current)"
            else
                echo "  $((i+1)). ${VERSIONS[$i]}"
            fi
        done
        echo ""
        read -p "Select version number (1-${#VERSIONS[@]}) or press Enter for next: " selection
        
        if [ -z "$selection" ]; then
            target_version=$(get_next_version "$current_version")
        else
            local idx=$((selection - 1))
            if [ $idx -ge 0 ] && [ $idx -lt ${#VERSIONS[@]} ]; then
                target_version="${VERSIONS[$idx]}"
            else
                print_error "Invalid selection"
                exit 1
            fi
        fi
    fi
    
    # Validate version change
    if [ "$target_version" == "$current_version" ]; then
        print_warning "Target version ($target_version) is same as current version. No changes needed."
        exit 0
    fi
    
    # Confirm
    print_header "Canary Deployment Configuration"
    echo "Namespace:       $NAMESPACE"
    echo "Deployment:      $DEPLOYMENT"
    echo "Current version: $current_version"
    echo "Target version:  $target_version"
    echo ""
    
    read -p "Proceed with canary deployment? (y/N) " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi
    
    echo ""
    
    # Execute GitOps workflow
    print_header "Step 1: Update Deployment File"
    update_deployment "$target_version"
    
    echo ""
    print_header "Step 2: Commit and Push to Git"
    commit_and_push "$target_version"
    
    echo ""
    print_header "Step 3: Trigger Flux Reconciliation"
    trigger_flux_reconcile
    
    echo ""
    echo "Waiting for canary to initialize..."
    sleep 15
    
    # Monitor the canary
    monitor_canary
}

main "$@"
