# Docker Setup Guide

This guide explains how to run the Hyperliquid Breakout Detector using Docker.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed
- [Docker Compose](https://docs.docker.com/compose/install/) installed (usually comes with Docker Desktop)

## Quick Start

### 1. Configure Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` and add your configuration:

```dotenv
# Redis Configuration (use 'redis' as host for Docker)
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
```

**Note**: When running in Docker, use `REDIS_HOST=redis` (the service name from docker-compose.yml)

### 2. Start the Application

```bash
docker-compose up -d
```

This will:
- Start a Redis container for data storage
- Build and start the breakout detector application
- Set up automatic restarts
- Mount the logs directory for persistent logs

### 3. View Logs

```bash
# Follow all logs
docker-compose logs -f

# Follow only breakout detector logs
docker-compose logs -f breakout-detector

# Follow only Redis logs
docker-compose logs -f redis
```

### 4. Stop the Application

```bash
docker-compose down
```

To also remove volumes (Redis data):

```bash
docker-compose down -v
```

## Docker Commands

### Build and Start

```bash
# Build and start in detached mode
docker-compose up -d --build

# Start without building
docker-compose up -d

# Start and view logs
docker-compose up
```

### View Status

```bash
# Check running containers
docker-compose ps

# View resource usage
docker stats
```

### Restart Services

```bash
# Restart all services
docker-compose restart

# Restart only breakout detector
docker-compose restart breakout-detector

# Restart only Redis
docker-compose restart redis
```

### Update Application

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose up -d --build
```

### Access Redis CLI

```bash
docker-compose exec redis redis-cli
```

Example commands in Redis CLI:
```bash
# List all keys
KEYS *

# Get candle data
KEYS candles:1h:*

# View breakout signals
KEYS breakout:*

# Exit
exit
```

### View Container Shell

```bash
# Access breakout detector container
docker-compose exec breakout-detector sh

# Access Redis container
docker-compose exec redis sh
```

## Docker Architecture

### Services

1. **redis** (Port 6379)
   - Redis 7 Alpine image
   - Data persistence with appendonly mode
   - Health checks enabled
   - Volume mounted for data persistence

2. **breakout-detector**
   - Node.js 20 Alpine base
   - Multi-stage build for optimized image size
   - Runs as non-root user for security
   - Automatic restart on failure
   - Logs mounted to host for persistence

### Volumes

- **redis-data**: Persistent storage for Redis data
- **./logs**: Mounted from host for persistent application logs

### Network

All services run on a shared Docker network, allowing them to communicate using service names (e.g., `redis` instead of `localhost`).

## Production Deployment

### Environment Variables

For production, use Docker secrets or environment variable management:

```bash
# Using environment variables
export TELEGRAM_BOT_TOKEN="your_token"
export TELEGRAM_CHAT_ID="your_chat_id"
docker-compose up -d
```

### Resource Limits

Add resource limits to `docker-compose.yml`:

```yaml
breakout-detector:
  # ... other config
  deploy:
    resources:
      limits:
        cpus: '1.0'
        memory: 512M
      reservations:
        cpus: '0.5'
        memory: 256M
```

### Monitoring

Monitor container health:

```bash
# Check health status
docker inspect --format='{{.State.Health.Status}}' hyperliquid-breakout-detector

# View health check logs
docker inspect --format='{{json .State.Health}}' hyperliquid-breakout-detector | jq
```

### Logs Management

Logs are automatically rotated (max 10MB per file, 3 files):

```bash
# View log files
ls -lh logs/

# Tail logs
tail -f logs/signals-*.jsonl
tail -f logs/evaluations-*.jsonl
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose logs breakout-detector

# Check if Redis is healthy
docker-compose ps redis
```

### Redis Connection Issues

```bash
# Test Redis connection
docker-compose exec breakout-detector sh -c "nc -zv redis 6379"

# Check Redis logs
docker-compose logs redis
```

### Application Not Detecting Breakouts

1. Check if WebSocket is connected:
   ```bash
   docker-compose logs breakout-detector | grep "WebSocket"
   ```

2. Verify coins are discovered:
   ```bash
   docker-compose logs breakout-detector | grep "Discovered"
   ```

3. Check Redis for candle data:
   ```bash
   docker-compose exec redis redis-cli KEYS "candles:1h:*"
   ```

### Permission Issues

```bash
# Fix logs directory permissions
chmod -R 755 logs/

# Rebuild with correct permissions
docker-compose down
docker-compose up -d --build
```

### Out of Memory

```bash
# Check memory usage
docker stats

# Increase memory limit in docker-compose.yml
# Add under breakout-detector service:
deploy:
  resources:
    limits:
      memory: 1G
```

## Advanced Usage

### Running Backtest in Docker

Create a separate service or run one-off command:

```bash
# Build the image first
docker-compose build

# Run backtest
docker-compose run --rm breakout-detector node dist/backtest/backtestRunner.js run 3
```

### Custom Configuration

Override docker-compose settings:

```bash
# Create docker-compose.override.yml
cat > docker-compose.override.yml << EOF
version: '3.8'
services:
  breakout-detector:
    environment:
      - NODE_ENV=development
    command: node --inspect=0.0.0.0:9229 dist/index.js
    ports:
      - "9229:9229"
EOF

docker-compose up -d
```

### Multi-Architecture Builds

Build for multiple platforms (e.g., ARM and x86):

```bash
# Build for multiple architectures
docker buildx build --platform linux/amd64,linux/arm64 -t hyperliquid-breakout-detector:latest .
```

## Maintenance

### Backup Redis Data

```bash
# Create backup
docker-compose exec redis redis-cli SAVE
docker cp hyperliquid-redis:/data/dump.rdb ./backup-$(date +%Y%m%d).rdb
```

### Restore Redis Data

```bash
# Stop containers
docker-compose down

# Replace dump.rdb in volume
docker run --rm -v hyperliquid-alert_redis-data:/data -v $(pwd):/backup alpine cp /backup/dump.rdb /data/dump.rdb

# Start containers
docker-compose up -d
```

### Clean Up

```bash
# Remove all stopped containers
docker container prune

# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Complete cleanup
docker system prune -a --volumes
```

## Security Best Practices

1. **Never commit `.env`** - Keep it in `.gitignore`
2. **Use secrets management** in production (Docker secrets, Kubernetes secrets, etc.)
3. **Regular updates**: Update base images regularly
4. **Scan images**: Use `docker scan` to check for vulnerabilities
5. **Network isolation**: Use custom networks for different environments
6. **Read-only filesystem**: Where possible, mount volumes as read-only

## Performance Optimization

1. **Multi-stage builds**: Already implemented to reduce image size
2. **Layer caching**: Order Dockerfile commands to maximize cache hits
3. **Alpine base**: Using Alpine Linux for smaller image size
4. **Production dependencies only**: `npm ci --omit=dev` removes dev dependencies
5. **Health checks**: Ensure services are ready before dependent services start
