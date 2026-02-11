# Docker Deployment Guide

This guide covers building and running AusLaw MCP as a Docker container.

## Prerequisites

- Docker installed (version 20.10 or later)
- Docker Compose (optional, for easier local testing)

## Building the Image

### Quick Build

```bash
docker build -t auslaw-mcp:latest .
```

### Build with Custom Tag

```bash
docker build -t auslaw-mcp:v0.1.0 .
```

### Build for Registry

```bash
docker build -t your-registry.com/auslaw-mcp:latest .
docker push your-registry.com/auslaw-mcp:latest
```

## Running with Docker

### Basic Run

```bash
docker run -it --rm auslaw-mcp:latest
```

### Run with Custom Environment Variables

```bash
docker run -it --rm \
  -e AUSTLII_SEARCH_BASE=https://www.austlii.edu.au/cgi-bin/sinosrch.cgi \
  -e DEFAULT_SEARCH_LIMIT=20 \
  -e OCR_LANGUAGE=eng \
  auslaw-mcp:latest
```

### Run with Environment File

Create a `.env` file (or copy from `.env.example`):

```bash
cp .env.example .env
# Edit .env with your settings
```

Then run:

```bash
docker run -it --rm --env-file .env auslaw-mcp:latest
```

### Run with Volume Mount for Config

```bash
docker run -it --rm \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  auslaw-mcp:latest
```

## Running with Docker Compose

Docker Compose simplifies running with all configuration:

### Start the Service

```bash
docker-compose up
```

### Start in Detached Mode

```bash
docker-compose up -d
```

### View Logs

```bash
docker-compose logs -f
```

### Stop the Service

```bash
docker-compose down
```

### Rebuild and Restart

```bash
docker-compose up --build
```

## Configuration

### Environment Variables

All configuration can be set via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node environment |
| `AUSTLII_SEARCH_BASE` | `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi` | AustLII search endpoint |
| `AUSTLII_REFERER` | `https://www.austlii.edu.au/forms/search1.html` | Referer header |
| `AUSTLII_USER_AGENT` | Mozilla/5.0... | User agent string |
| `AUSTLII_TIMEOUT` | `60000` | Request timeout (ms) |
| `OCR_LANGUAGE` | `eng` | Tesseract language |
| `OCR_OEM` | `1` | OCR Engine Mode |
| `OCR_PSM` | `3` | Page Segmentation Mode |
| `DEFAULT_SEARCH_LIMIT` | `10` | Default results limit |
| `MAX_SEARCH_LIMIT` | `50` | Maximum results limit |
| `DEFAULT_OUTPUT_FORMAT` | `json` | Default format |
| `DEFAULT_SORT_BY` | `auto` | Default sort order |

### Config File

The `config.yaml` file provides default values that can be overridden by environment variables. See `config.yaml` for the full structure.

## Troubleshooting

### Image Build Fails

If the build fails, check:

1. **Docker version**: Ensure Docker is up to date
2. **Network connectivity**: Ensure you can reach Docker Hub and Alpine repositories
3. **Disk space**: Ensure sufficient disk space

```bash
docker system df
docker system prune -a  # Clean up if needed
```

### Tesseract OCR Issues

If Tesseract installation fails during build, you may need to adjust the Alpine package names. Check available packages:

```bash
docker run --rm node:20-alpine apk update && apk search tesseract
```

### Container Exits Immediately

MCP servers communicate via stdio. To keep the container running for testing:

```bash
docker run -it auslaw-mcp:latest /bin/sh
```

### Permission Issues

The container runs as non-root user (uid 1001). If you mount volumes, ensure permissions:

```bash
chmod 644 config.yaml
```

## Image Details

### Base Image

- **Stage 1 (Builder)**: `node:20-alpine` - Builds TypeScript code
- **Stage 2 (Runtime)**: `node:20-alpine` - Minimal runtime with Tesseract OCR

### Image Size

The multi-stage build keeps the final image size minimal:

```bash
docker images auslaw-mcp
```

### Security Features

- Non-root user (uid 1001, gid 1001)
- Minimal Alpine Linux base
- Production-only dependencies
- No unnecessary packages

### Layers

```
1. Base Node.js Alpine image
2. Tesseract OCR installation
3. Production npm dependencies
4. Compiled application code
5. Non-root user setup
```

## Advanced Usage

### Custom Entrypoint

Override the entrypoint for debugging:

```bash
docker run -it --rm --entrypoint /bin/sh auslaw-mcp:latest
```

### Resource Limits

Limit container resources:

```bash
docker run -it --rm \
  --memory="512m" \
  --cpus="0.5" \
  auslaw-mcp:latest
```

### Health Checks

Check container health:

```bash
docker inspect --format='{{.State.Health.Status}}' <container-id>
```

### Export/Import Images

Export for offline deployment:

```bash
# Export
docker save auslaw-mcp:latest -o auslaw-mcp.tar

# Import on another machine
docker load -i auslaw-mcp.tar
```

## Integration with MCP Clients

### Claude Desktop

MCP servers typically run on the local machine. To use a containerized version:

1. **Option 1**: Run container locally and configure as usual
2. **Option 2**: Use docker-compose with volume mounts
3. **Option 3**: Deploy to k8s and use port-forwarding (see k8s/README.md)

Example Claude Desktop config:

```json
{
  "mcpServers": {
    "auslaw-mcp": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "auslaw-mcp:latest"]
    }
  }
}
```

## Next Steps

- For Kubernetes deployment, see [k8s/README.md](../k8s/README.md)
- For k3s-specific instructions, see the k8s deployment guide
- For development, see the main [README.md](../README.md)

## Support

For issues with Docker deployment:

1. Check logs: `docker logs <container-id>`
2. Inspect container: `docker inspect <container-id>`
3. Check GitHub Issues: https://github.com/russellbrenner/auslaw-mcp/issues
