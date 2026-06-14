#!/bin/bash
# Build and package script for jurisd
# This script builds the Docker image and optionally exports it for k3s deployment

set -euo pipefail

VERSION=${1:-latest}
IMAGE_NAME="jurisd:${VERSION}"
EXPORT_TAR="jurisd-${VERSION}.tar"

echo "🏗️  Building jurisd Docker image..."
echo "   Image: ${IMAGE_NAME}"
echo ""

# Build the Docker image
docker build -t "${IMAGE_NAME}" .

echo ""
echo "✅ Image built successfully: ${IMAGE_NAME}"
echo ""

# Ask if user wants to export for k3s
read -p "Export image for k3s deployment? (y/n) " -n 1 -r
echo ""

if [[ ${REPLY:-} =~ ^[Yy]$ ]]; then
    echo "📦 Exporting image to ${EXPORT_TAR}..."
    docker save "${IMAGE_NAME}" -o "${EXPORT_TAR}"
    echo ""
    echo "✅ Image exported to ${EXPORT_TAR}"
    echo ""
    echo "To import on k3s nodes:"
    echo "  scp ${EXPORT_TAR} node1:/tmp/"
    echo "  ssh node1 'sudo k3s ctr images import /tmp/${EXPORT_TAR}'"
    echo ""
fi

echo "🚀 Next steps:"
echo ""
echo "  Local testing with Docker:"
echo "    docker run -it --rm ${IMAGE_NAME}"
echo ""
echo "  Local testing with Docker Compose:"
echo "    docker-compose up"
echo ""
echo "  Deploy to Kubernetes:"
echo "    kubectl apply -f k8s/"
echo ""
echo "For more information, see:"
echo "  - docs/DOCKER.md (Docker deployment)"
echo "  - k8s/README.md (Kubernetes deployment)"
echo ""
