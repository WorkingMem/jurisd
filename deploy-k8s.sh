#!/bin/bash
# Deploy script for jurisd to k3s cluster
# This script deploys or updates the jurisd service on a k3s cluster

set -e

ACTION=${1:-apply}
NAMESPACE="jurisd"

echo "🚀 Deploying jurisd to Kubernetes..."
echo "   Action: ${ACTION}"
echo "   Namespace: ${NAMESPACE}"
echo ""

# Validate kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found. Please install kubectl and configure access to your cluster."
    exit 1
fi

# Check cluster connectivity
echo "🔍 Checking cluster connectivity..."
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster. Please check your kubeconfig."
    exit 1
fi

echo "✅ Connected to cluster"
echo ""

# Apply or delete based on action
if [ "$ACTION" == "delete" ] || [ "$ACTION" == "remove" ] || [ "$ACTION" == "uninstall" ]; then
    echo "🗑️  Removing jurisd from cluster..."
    kubectl delete -f k8s/ --ignore-not-found=true
    echo ""
    echo "✅ jurisd removed successfully"
    exit 0
fi

# Apply manifests
echo "📋 Applying Kubernetes manifests..."
echo ""

kubectl apply -f k8s/namespace.yaml
echo "   ✓ Namespace created/updated"

kubectl apply -f k8s/configmap.yaml
echo "   ✓ ConfigMap created/updated"

kubectl apply -f k8s/deployment.yaml
echo "   ✓ Deployment created/updated"

kubectl apply -f k8s/service.yaml
echo "   ✓ Service created/updated"

echo ""
echo "✅ jurisd deployed successfully"
echo ""

# Wait for rollout
echo "⏳ Waiting for deployment to complete..."
kubectl rollout status deployment/jurisd -n ${NAMESPACE} --timeout=300s

echo ""
echo "📊 Deployment status:"
echo ""

# Show pod status
kubectl get pods -n ${NAMESPACE} -o wide

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "To view logs:"
echo "  kubectl logs -n ${NAMESPACE} -l app=jurisd -f"
echo ""
echo "To check pod status:"
echo "  kubectl get pods -n ${NAMESPACE}"
echo ""
echo "To access the service:"
echo "  kubectl port-forward -n ${NAMESPACE} service/jurisd 3000:3000"
echo ""
echo "To remove the deployment:"
echo "  ./deploy-k8s.sh delete"
echo ""
