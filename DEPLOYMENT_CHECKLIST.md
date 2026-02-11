# Deployment Checklist

This checklist helps ensure successful deployment of AusLaw MCP to Docker or Kubernetes environments.

## Pre-Deployment

### Prerequisites

- [ ] Docker installed (version 20.10+)
- [ ] kubectl installed and configured (for k8s deployment)
- [ ] k3s cluster running with 2 nodes (for k8s deployment)
- [ ] Network access to Alpine repositories
- [ ] Network access to AustLII (www.austlii.edu.au)

### Configuration Review

- [ ] Review `.env.example` and create `.env` if needed
- [ ] Review `config.yaml` for default settings
- [ ] Review `k8s/configmap.yaml` for Kubernetes configuration
- [ ] Adjust resource limits in `k8s/deployment.yaml` if needed

## Docker Deployment

### Build

- [ ] Run `npm install` to ensure dependencies are up to date
- [ ] Run `npm run build` to verify TypeScript compilation
- [ ] Run `npm test` to verify tests pass (may fail in restricted network)
- [ ] Run `docker build -t auslaw-mcp:latest .` or `./build.sh`
- [ ] Verify image built successfully: `docker images auslaw-mcp`

### Test Locally

- [ ] Test with Docker: `docker run -it --rm auslaw-mcp:latest`
- [ ] Test with Docker Compose: `docker-compose up`
- [ ] Verify environment variables work: `docker run -e DEFAULT_SEARCH_LIMIT=20 -it auslaw-mcp:latest`
- [ ] Check logs for errors
- [ ] Verify Tesseract OCR is available in container

### Deploy

- [ ] Push to registry if using one: `docker push your-registry/auslaw-mcp:latest`
- [ ] Update docker-compose.yaml with registry URL if needed
- [ ] Deploy with `docker-compose up -d`
- [ ] Check container health: `docker ps`
- [ ] View logs: `docker-compose logs -f`

## Kubernetes (k3s) Deployment

### Prepare Cluster

- [ ] Verify k3s master node is running
- [ ] Verify k3s worker node is connected
- [ ] Check node status: `kubectl get nodes`
- [ ] Verify both nodes are `Ready`
- [ ] Check available resources: `kubectl top nodes` (if metrics-server installed)

### Build and Import Image

- [ ] Build image: `docker build -t auslaw-mcp:latest .`
- [ ] Export image: `docker save auslaw-mcp:latest -o auslaw-mcp.tar`
- [ ] Copy to node 1: `scp auslaw-mcp.tar node1:/tmp/`
- [ ] Copy to node 2: `scp auslaw-mcp.tar node2:/tmp/`
- [ ] Import on node 1: `ssh node1 "sudo k3s ctr images import /tmp/auslaw-mcp.tar"`
- [ ] Import on node 2: `ssh node2 "sudo k3s ctr images import /tmp/auslaw-mcp.tar"`
- [ ] Verify import: `ssh node1 "sudo k3s ctr images list | grep auslaw"`

### Deploy to Cluster

- [ ] Apply manifests: `kubectl apply -f k8s/` or `./deploy-k8s.sh`
- [ ] Verify namespace: `kubectl get namespace auslaw-mcp`
- [ ] Verify ConfigMap: `kubectl get configmap -n auslaw-mcp`
- [ ] Verify Deployment: `kubectl get deployment -n auslaw-mcp`
- [ ] Verify Service: `kubectl get service -n auslaw-mcp`
- [ ] Check rollout status: `kubectl rollout status deployment/auslaw-mcp -n auslaw-mcp`

### Verify Deployment

- [ ] Check pods are running: `kubectl get pods -n auslaw-mcp`
- [ ] Verify pods are on different nodes: `kubectl get pods -n auslaw-mcp -o wide`
- [ ] Check pod logs: `kubectl logs -n auslaw-mcp -l app=auslaw-mcp`
- [ ] Verify no error messages in logs
- [ ] Check resource usage: `kubectl top pods -n auslaw-mcp`

### Test Functionality

- [ ] Port forward to test: `kubectl port-forward -n auslaw-mcp service/auslaw-mcp 3000:3000`
- [ ] Execute test in pod: `kubectl exec -it -n auslaw-mcp <pod-name> -- node --version`
- [ ] Verify environment variables: `kubectl exec -n auslaw-mcp <pod-name> -- env | grep AUSTLII`

## Post-Deployment

### Documentation

- [ ] Document actual deployment steps taken
- [ ] Note any issues encountered and solutions
- [ ] Update team on deployment status
- [ ] Share connection details with users

### Monitoring

- [ ] Set up log aggregation (optional)
- [ ] Set up monitoring/alerting (optional)
- [ ] Create backup of ConfigMap: `kubectl get configmap auslaw-mcp-config -n auslaw-mcp -o yaml > backup-configmap.yaml`
- [ ] Schedule regular health checks

### Maintenance Plan

- [ ] Document update procedure
- [ ] Schedule regular image rebuilds
- [ ] Plan for certificate/credential rotation if needed
- [ ] Document rollback procedure

## Troubleshooting Reference

### Common Issues

#### Image Build Fails

- **Symptom**: Docker build fails during Tesseract installation
- **Solution**: Check Alpine repository connectivity, try `docker build --no-cache`

#### Pods Not Starting

- **Symptom**: Pods stuck in `Pending` or `ImagePullBackOff`
- **Solution**: Verify image imported on all nodes, check pod events with `kubectl describe pod`

#### Network Errors

- **Symptom**: "ENOTFOUND www.austlii.edu.au" errors
- **Solution**: Check cluster network policies, verify DNS resolution, check firewall rules

#### Configuration Not Applied

- **Symptom**: Environment variables not taking effect
- **Solution**: Restart pods with `kubectl rollout restart deployment/auslaw-mcp -n auslaw-mcp`

#### Resource Constraints

- **Symptom**: Pods being evicted or OOMKilled
- **Solution**: Increase resource limits in deployment.yaml, check node resources

### Recovery Procedures

#### Rollback Deployment

```bash
kubectl rollout undo deployment/auslaw-mcp -n auslaw-mcp
```

#### Restart All Pods

```bash
kubectl rollout restart deployment/auslaw-mcp -n auslaw-mcp
```

#### View Detailed Pod Status

```bash
kubectl describe pod <pod-name> -n auslaw-mcp
```

#### Access Pod Shell

```bash
kubectl exec -it <pod-name> -n auslaw-mcp -- /bin/sh
```

## Success Criteria

Deployment is considered successful when:

- [ ] All pods are in `Running` state
- [ ] Pods are distributed across both nodes
- [ ] No error messages in logs
- [ ] Environment variables are loaded correctly
- [ ] Application responds to test queries
- [ ] Resource usage is within expected limits
- [ ] Health checks are passing

## Sign-off

- Deployed by: _______________
- Date: _______________
- Environment: _______________
- Version: _______________
- Notes: _______________

