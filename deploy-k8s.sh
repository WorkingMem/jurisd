#!/bin/bash
# Deploy script for AusLaw MCP to k3s cluster
# This script deploys or updates the AusLaw MCP service on a k3s cluster

set -e

ACTION=${1:-apply}
NAMESPACE="auslaw-mcp"

echo "🚀 Deploying AusLaw MCP to Kubernetes..."
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
    echo "🗑️  Removing AusLaw MCP from cluster..."
    kubectl delete -f k8s/ --ignore-not-found=true
    echo ""
    echo "✅ AusLaw MCP removed successfully"
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
echo "✅ AusLaw MCP deployed successfully"
echo ""

# Wait for rollout
echo "⏳ Waiting for deployment to complete..."
kubectl rollout status deployment/auslaw-mcp -n ${NAMESPACE} --timeout=300s

echo ""
echo "📊 Deployment status:"
echo ""

# Show pod status
kubectl get pods -n ${NAMESPACE} -o wide

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "To view logs:"
echo "  kubectl logs -n ${NAMESPACE} -l app=auslaw-mcp -f"
echo ""
echo "To check pod status:"
echo "  kubectl get pods -n ${NAMESPACE}"
echo ""
echo "To access the service:"
echo "  kubectl port-forward -n ${NAMESPACE} service/auslaw-mcp 3000:3000"
echo ""
echo "To remove the deployment:"
echo "  ./deploy-k8s.sh delete"
echo ""
