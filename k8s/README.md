# Kubernetes (k3s) Deployment Guide for jurisd

This guide covers deploying jurisd to a two-node k3s cluster.

## Prerequisites

- k3s cluster with 2 nodes set up
- `kubectl` configured to access your cluster
- Docker installed on the machine where you'll build the image
- Access to push images to your k3s cluster (or a container registry)

## Quick Start

### 1. Build Docker Image

```bash
# Build the Docker image
docker build -t jurisd:latest .

# If using a private registry, tag and push:
docker tag jurisd:latest your-registry.com/jurisd:latest
docker push your-registry.com/jurisd:latest
```

For k3s, you can import the image directly on each node:

```bash
# Save the image to a tar file
docker save jurisd:latest -o jurisd.tar

# Copy to each k3s node and import
scp jurisd.tar node1:/tmp/
scp jurisd.tar node2:/tmp/

# On each node:
ssh node1 "sudo k3s ctr images import /tmp/jurisd.tar"
ssh node2 "sudo k3s ctr images import /tmp/jurisd.tar"
```

### 2. Deploy to k3s

```bash
# Apply all Kubernetes manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

Or apply all at once:

```bash
kubectl apply -f k8s/
```

### 3. Verify Deployment

```bash
# Check namespace
kubectl get namespace jurisd

# Check pods
kubectl get pods -n jurisd

# Check deployment status
kubectl get deployment -n jurisd

# View pod logs
kubectl logs -n jurisd -l app=jurisd

# Describe deployment
kubectl describe deployment jurisd -n jurisd
```

### 4. Check Pod Distribution

Verify that pods are distributed across both nodes:

```bash
kubectl get pods -n jurisd -o wide
```

You should see pods running on different nodes due to the anti-affinity rules.

## Configuration

### Environment Variables

All configuration is managed through the ConfigMap (`k8s/configmap.yaml`). To modify settings:

1. Edit `k8s/configmap.yaml`
2. Apply changes: `kubectl apply -f k8s/configmap.yaml`
3. Restart pods: `kubectl rollout restart deployment/jurisd -n jurisd`

### Available Configuration Options

| Variable                | Default                                           | Description                  |
| ----------------------- | ------------------------------------------------- | ---------------------------- |
| `AUSTLII_SEARCH_BASE`   | `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi` | AustLII search API endpoint  |
| `AUSTLII_REFERER`       | `https://www.austlii.edu.au/forms/search1.html`   | Referer header for AustLII   |
| `AUSTLII_USER_AGENT`    | Mozilla/5.0...                                    | User agent string            |
| `AUSTLII_TIMEOUT`       | `60000`                                           | Request timeout (ms)         |
| `SOURCE_BASE_URL`         | `https://removed.invalid`                                 | removed.invalid base URL             |
| `SOURCE_USER_AGENT`       | `jurisd/0.2.0 (legal research tool)`              | removed.invalid user agent           |
| `SOURCE_TIMEOUT`          | `15000`                                           | removed.invalid request timeout (ms) |
| `DEFAULT_SEARCH_LIMIT`  | `10`                                              | Default search results       |
| `MAX_SEARCH_LIMIT`      | `50`                                              | Maximum search results       |
| `DEFAULT_OUTPUT_FORMAT` | `json`                                            | Default output format        |
| `DEFAULT_SORT_BY`       | `auto`                                            | Default sort order           |
| `LOG_LEVEL`             | `1`                                               | Logging level (0-3)          |

## Scaling

### Manual Scaling

```bash
# Scale to 3 replicas (if you add a third node)
kubectl scale deployment jurisd -n jurisd --replicas=3

# Scale down to 1 replica
kubectl scale deployment jurisd -n jurisd --replicas=1
```

### Resource Allocation

The deployment is configured with:

- **Requests**: 256Mi memory, 100m CPU
- **Limits**: 512Mi memory, 500m CPU

Adjust these in `k8s/deployment.yaml` based on your cluster capacity:

```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"
    cpu: "500m"
```

## Maintenance

### Viewing Logs

```bash
# All pods
kubectl logs -n jurisd -l app=jurisd --tail=100 -f

# Specific pod
kubectl logs -n jurisd <pod-name> -f

# Previous instance (if pod crashed)
kubectl logs -n jurisd <pod-name> --previous
```

### Updating the Application

```bash
# Rebuild and re-import image (see step 1)

# Restart deployment to use new image
kubectl rollout restart deployment/jurisd -n jurisd

# Monitor rollout status
kubectl rollout status deployment/jurisd -n jurisd

# Check rollout history
kubectl rollout history deployment/jurisd -n jurisd
```

### Rolling Back

```bash
# Rollback to previous version
kubectl rollout undo deployment/jurisd -n jurisd

# Rollback to specific revision
kubectl rollout undo deployment/jurisd -n jurisd --to-revision=2
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod status
kubectl get pods -n jurisd

# Describe pod for events
kubectl describe pod <pod-name> -n jurisd

# Check logs
kubectl logs <pod-name> -n jurisd
```

### Image Pull Issues

If you see `ImagePullBackOff`:

```bash
# Verify image is imported on all nodes
ssh node1 "sudo k3s ctr images list | grep jurisd"
ssh node2 "sudo k3s ctr images list | grep jurisd"

# Re-import if needed
docker save jurisd:latest -o jurisd.tar
scp jurisd.tar node1:/tmp/ && ssh node1 "sudo k3s ctr images import /tmp/jurisd.tar"
scp jurisd.tar node2:/tmp/ && ssh node2 "sudo k3s ctr images import /tmp/jurisd.tar"
```

### Pods Not Distributed Across Nodes

If both pods are on the same node:

```bash
# Check node labels
kubectl get nodes --show-labels

# Check pod anti-affinity
kubectl describe deployment jurisd -n jurisd | grep -A 10 Affinity
```

The deployment uses `preferredDuringSchedulingIgnoredDuringExecution`, which is a soft requirement. If resource constraints exist, both pods may end up on the same node.

### Configuration Not Applied

```bash
# Verify ConfigMap
kubectl get configmap jurisd-config -n jurisd -o yaml

# Restart pods to pick up changes
kubectl rollout restart deployment/jurisd -n jurisd
```

## Accessing the MCP Server

MCP servers communicate via stdio (standard input/output), not HTTP. To use jurisd in k8s:

### Option 1: Direct Pod Interaction

```bash
# Execute commands in a pod
kubectl exec -it -n jurisd <pod-name> -- node dist/index.js
```

### Option 2: Job-Based Execution

Create a Kubernetes Job that runs queries:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: jurisd-query
  namespace: jurisd
spec:
  template:
    spec:
      containers:
        - name: query
          image: jurisd:latest
          command: ["node", "dist/index.js"]
          envFrom:
            - configMapRef:
                name: jurisd-config
      restartPolicy: Never
```

### Option 3: Client Integration

Integrate with MCP clients (like Claude Desktop) by exposing the service or using port-forwarding:

```bash
# Port forward to local machine
kubectl port-forward -n jurisd service/jurisd 3000:3000
```

## Uninstalling

```bash
# Delete all resources
kubectl delete -f k8s/

# Or delete namespace (removes everything)
kubectl delete namespace jurisd
```

## k3s Cluster Setup

If you need to set up a k3s cluster first:

### Master Node (Node 1)

```bash
# Install k3s as master
curl -sfL https://get.k3s.io | sh -

# Get node token for worker nodes
sudo cat /var/lib/rancher/k3s/server/node-token

# Get kubeconfig
sudo cat /etc/rancher/k3s/k3s.yaml
```

### Worker Node (Node 2)

```bash
# Install k3s as worker (replace <MASTER_IP> and <TOKEN>)
curl -sfL https://get.k3s.io | K3S_URL=https://<MASTER_IP>:6443 K3S_TOKEN=<TOKEN> sh -
```

### Verify Cluster

```bash
# On master node
kubectl get nodes
```

You should see both nodes in `Ready` state.

## Security Considerations

1. **Non-root User**: Containers run as user 1001 (nodejs)
2. **Read-only Filesystem**: Config files mounted as read-only
3. **No Privileged Escalation**: Security contexts prevent privilege escalation
4. **Resource Limits**: CPU and memory limits prevent resource exhaustion
5. **Network Policies**: Consider adding NetworkPolicies for production

Example NetworkPolicy:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: jurisd-netpol
  namespace: jurisd
spec:
  podSelector:
    matchLabels:
      app: jurisd
  policyTypes:
    - Ingress
    - Egress
  egress:
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: TCP
          port: 53
        - protocol: UDP
          port: 53
    - to:
        - podSelector: {}
```

## Production Recommendations

1. **Use a Container Registry**: Instead of importing images manually, use a registry
2. **Image Tagging**: Use semantic versioning instead of `latest`
3. **Resource Monitoring**: Set up Prometheus/Grafana for monitoring
4. **Persistent Logging**: Use a logging solution like Loki or ELK
5. **Backups**: Backup ConfigMaps and deployment configs
6. **Health Checks**: Customize liveness/readiness probes based on your needs
7. **Autoscaling**: Consider HPA (Horizontal Pod Autoscaler) for dynamic scaling

## Additional Resources

- [k3s Documentation](https://docs.k3s.io/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [MCP Specification](https://modelcontextprotocol.io/)
