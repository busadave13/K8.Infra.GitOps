#!/bin/bash
# Test Canary Failure Script
# This script triggers a canary failure to test Discord alerts

set -e

# Configuration (can be overridden via environment variables or flags)
NAMESPACE=${NAMESPACE:-mockery}
DEPLOYMENT=${DEPLOYMENT:-mockery}
CANARY_NAME=${CANARY_NAME:-mockery-canary}
CONTAINER_NAME=${CONTAINER_NAME:-mockery}
BAD_IMAGE=${BAD_IMAGE:-"ghcr.io/busadave13/mockery:0.0.0-doesnotexist"}
TIMEOUT=${TIMEOUT:-180}
SKIP_RESTORE=${SKIP_RESTORE:-false}
AUTO_CONFIRM=${AUTO_CONFIRM:-false}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
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

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Show help
show_help() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Test canary failure alerts by deploying a bad image and watching for rollback.

OPTIONS:
    -n, --namespace NAME      Kubernetes namespace (default: mockery)
    -d, --deployment NAME     Deployment name (default: mockery)
    -c, --canary NAME         Canary resource name (default: mockery-canary)
    --container NAME          Container name in the deployment (default: mockery)
    -i, --image IMAGE         Bad image to deploy (default: ghcr.io/busadave13/mockery:0.0.0-doesnotexist)
    -t, --timeout SECONDS     Timeout waiting for failure (default: 180)
    --skip-restore            Don't restore the original image after test
    -y, --yes                 Auto-confirm prompts (non-interactive mode)
    -h, --help                Show this help message

ENVIRONMENT VARIABLES:
    NAMESPACE                 Same as -n, --namespace
    DEPLOYMENT                Same as -d, --deployment
    CANARY_NAME               Same as -c, --canary
    CONTAINER_NAME            Same as --container
    BAD_IMAGE                 Same as -i, --image
    TIMEOUT                   Same as -t, --timeout
    SKIP_RESTORE              Set to 'true' to skip restore
    AUTO_CONFIRM              Set to 'true' for non-interactive mode

EXAMPLES:
    # Run with defaults (mockery namespace)
    $(basename "$0")

    # Test a different deployment
    $(basename "$0") -n weather -d weather -c weather-canary

    # Non-interactive mode for CI/CD
    $(basename "$0") -y --timeout 120

    # Using environment variables
    NAMESPACE=podinfo DEPLOYMENT=podinfo $(basename "$0")

WHAT THIS SCRIPT DOES:
    1. Saves the current image from the deployment
    2. Deploys a non-existent image tag to trigger failure
    3. Watches the canary status until it fails (~1-2 minutes)
    4. Restores the original image (unless --skip-restore)
    5. Triggers Flux reconciliation to recover

VERIFYING ALERTS:
    After running, check your Discord/Slack channel for failure notifications.
    If no alert received, check:
      - AlertProvider: kubectl get alertprovider -n flagger-system
      - Secret: kubectl get secret discord-webhook -n flagger-system
      - Flagger logs: kubectl logs -n flagger-system deployment/flagger --tail=50

EOF
    exit 0
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -n|--namespace)
                NAMESPACE="$2"
                shift 2
                ;;
            -d|--deployment)
                DEPLOYMENT="$2"
                shift 2
                ;;
            -c|--canary)
                CANARY_NAME="$2"
                shift 2
                ;;
            --container)
                CONTAINER_NAME="$2"
                shift 2
                ;;
            -i|--image)
                BAD_IMAGE="$2"
                shift 2
                ;;
            -t|--timeout)
                TIMEOUT="$2"
                shift 2
                ;;
            --skip-restore)
                SKIP_RESTORE=true
                shift
                ;;
            -y|--yes)
                AUTO_CONFIRM=true
                shift
                ;;
            -h|--help)
                show_help
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
}

# Get current image
get_current_image() {
    kubectl get deployment "$DEPLOYMENT" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[?(@.name=="'"$CONTAINER_NAME"'")].image}'
}

# Get canary status
get_canary_status() {
    kubectl get canary "$CANARY_NAME" -n "$NAMESPACE" -o jsonpath='{.status.phase}'
}

# Wait for canary to be in a specific state
wait_for_canary_state() {
    local target_state=$1
    local timeout=${2:-300}
    local interval=5
    local elapsed=0
    
    echo -n "Waiting for canary to reach '$target_state' state"
    while [ $elapsed -lt $timeout ]; do
        local current_state=$(get_canary_status)
        if [ "$current_state" == "$target_state" ]; then
            echo ""
            return 0
        fi
        echo -n "."
        sleep $interval
        elapsed=$((elapsed + interval))
    done
    echo ""
    return 1
}

# Main script
main() {
    print_header "Canary Failure Test"
    
    # Check prerequisites
    if ! kubectl get canary "$CANARY_NAME" -n "$NAMESPACE" &>/dev/null; then
        print_error "Canary '$CANARY_NAME' not found in namespace '$NAMESPACE'"
        exit 1
    fi
    
    # Get current image for restoration
    CURRENT_IMAGE=$(get_current_image)
    print_info "Current image: $CURRENT_IMAGE"
    print_info "Bad image: $BAD_IMAGE"
    
    # Check current canary status
    CURRENT_STATUS=$(get_canary_status)
    print_info "Current canary status: $CURRENT_STATUS"
    
    if [ "$CURRENT_STATUS" == "Progressing" ]; then
        print_warning "Canary is currently progressing. This test will interrupt it."
        if [ "$AUTO_CONFIRM" != "true" ]; then
            read -p "Continue? (y/N) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                print_info "Aborted."
                exit 0
            fi
        else
            print_info "Auto-confirm enabled, continuing..."
        fi
    fi
    
    # Deploy bad image
    print_header "Deploying Bad Image"
    kubectl -n "$NAMESPACE" set image "deployment/$DEPLOYMENT" "$CONTAINER_NAME=$BAD_IMAGE"
    print_success "Bad image deployed"
    
    # Watch canary status
    print_header "Watching Canary Status"
    print_info "The canary should fail within 1-2 minutes..."
    print_info "Check your Discord channel for failure alerts!"
    echo ""
    
    # Monitor for up to TIMEOUT seconds
    local iterations=$((TIMEOUT / 10))
    for i in $(seq 1 $iterations); do
        STATUS=$(get_canary_status)
        PODS=$(kubectl get pods -n "$NAMESPACE" -l app="$DEPLOYMENT" --no-headers 2>/dev/null | head -3 | awk '{print $1": "$3}' | tr '\n' ' ')
        echo "[$(date +%H:%M:%S)] Status: $STATUS | Pods: $PODS"
        
        if [ "$STATUS" == "Failed" ]; then
            print_error "Canary FAILED! (This is expected)"
            print_success "You should receive a Discord notification!"
            break
        fi
        
        sleep 10
    done
    
    # Restore original image
    if [ "$SKIP_RESTORE" != "true" ]; then
        print_header "Restoring Original Image"
        kubectl -n "$NAMESPACE" set image "deployment/$DEPLOYMENT" "$CONTAINER_NAME=$CURRENT_IMAGE"
        print_success "Original image restored: $CURRENT_IMAGE"
        
        # Wait for recovery
        print_header "Waiting for Recovery"
        print_info "Waiting for Flux to reconcile and start new canary..."
        
        sleep 10
        flux reconcile ks apps --with-source 2>/dev/null || true
    else
        print_warning "Skipping image restore (--skip-restore enabled)"
        print_info "To restore manually: kubectl -n $NAMESPACE set image deployment/$DEPLOYMENT $CONTAINER_NAME=$CURRENT_IMAGE"
    fi
    
    # Final status
    print_header "Final Status"
    kubectl get canary "$CANARY_NAME" -n "$NAMESPACE"
    echo ""
    kubectl get pods -n "$NAMESPACE" -l app="$DEPLOYMENT"
    
    print_header "Test Complete"
    print_info "If you received a Discord notification about the failure, the alerts are working!"
    print_info "If not, check:"
    echo "  1. AlertProvider exists: kubectl get alertprovider -n flagger-system"
    echo "  2. Secret exists: kubectl get secret discord-webhook -n flagger-system"
    echo "  3. Flagger logs: kubectl logs -n flagger-system deployment/flagger --tail=50"
}

# Parse arguments and run main function
parse_args "$@"
main
