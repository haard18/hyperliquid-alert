# 🚀 Production Deployment Guide

## Overview

This guide covers deploying both Model-1 and Model-2 to production using pre-built Docker images from Docker Hub.

**Image:** `hardy18/breakout-watcher:latest`

---

## 📦 Quick Deploy (3 Steps)

### 1. Build and Push Image

```bash
# Build for production (linux/amd64)
docker buildx build --platform linux/amd64 \
  -t hardy18/breakout-watcher:latest \
  --push \
  --progress=plain .
```

### 2. Deploy on Production Server

```bash
# Create .env file
cat > .env << EOF
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
EOF

# Start containers
docker-compose -f docker-compose.prod.yml up -d
```

### 3. Verify

```bash
# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

**Done!** 🎉

---

## 🛠️ Using the Deployment Script (Recommended)

### Installation

```bash
# Make script executable (one time)
chmod +x deploy.sh
```

### Commands

```bash
# Complete workflow (build + push + deploy)
./deploy.sh full

# Build and push only
./deploy.sh build

# Deploy only (pull latest + restart)
./deploy.sh deploy

# View logs
./deploy.sh logs

# Check status
./deploy.sh status

# Rollback to previous version
./deploy.sh rollback 20241122-143000

# Clean old images
./deploy.sh cleanup

# Help
./deploy.sh help
```

---

## 📋 Complete Production Workflow

### Step 1: Local Development

```bash
# Test locally first
npm run build
npm run intraday:test
npm run intraday:backtest
```

### Step 2: Build and Push

```bash
# Option A: Using deploy script (recommended)
./deploy.sh build

# Option B: Manual
docker buildx build --platform linux/amd64 \
  -t hardy18/breakout-watcher:latest \
  -t hardy18/breakout-watcher:$(date +%Y%m%d-%H%M%S) \
  --push \
  --progress=plain .
```

### Step 3: Deploy to Server

```bash
# SSH to production server
ssh your-server

# Pull latest image
docker pull hardy18/breakout-watcher:latest

# Update containers
docker-compose -f docker-compose.prod.yml up -d

# Verify
docker-compose -f docker-compose.prod.yml ps
```

### Step 4: Monitor

```bash
# Real-time logs
docker-compose -f docker-compose.prod.yml logs -f

# Resource usage
docker stats hyperliquid-redis hyperliquid-model1 hyperliquid-model2

# Check Redis
docker exec hyperliquid-redis redis-cli INFO stats
```

---

## 🏗️ Production Architecture

```
┌─────────────────────────────────────────┐
│      Production Server (linux/amd64)    │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │   Docker Network (172.25.0.0/16)  │ │
│  │                                    │ │
│  │  ┌──────────────┐                 │ │
│  │  │    Redis     │                 │ │
│  │  │  (256MB RAM) │                 │ │
│  │  └──────┬───────┘                 │ │
│  │         │                          │ │
│  │    ┌────┴────┬──────────────┐    │ │
│  │    │         │              │     │ │
│  │  ┌─┴──────┐ ┌┴───────────┐ │     │ │
│  │  │Model-1 │ │  Model-2   │ │     │ │
│  │  │(512MB) │ │  (768MB)   │ │     │ │
│  │  │1h      │ │5m/15m/1h   │ │     │ │
│  │  └────────┘ └────────────┘ │     │ │
│  │                              │     │ │
│  └──────────────────────────────┘     │
│                                        │
└────────────────┬───────────────────────┘
                 │
            ┌────┴─────┐
            │ Telegram │
            └──────────┘
```

---

## 📁 Files Structure

```
production-server/
├── .env                        # Environment variables
├── docker-compose.prod.yml     # Production compose file
└── logs/                       # Container logs (mounted)
    ├── app-2025-11-22.log
    └── ...
```

---

## ⚙️ Configuration

### Environment Variables (`.env`)

```bash
# Required
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=-1001234567890

# Optional (defaults shown)
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0
NODE_ENV=production
TZ=UTC
BACKTEST_DAYS=30
BACKTEST_SYMBOLS=BTC,ETH,SOL,ARB,AVAX
```

### Resource Limits

**Redis:**
- CPU: 0.25-0.5 cores
- Memory: 256-512MB
- Disk: Persistent volume

**Model-1:**
- CPU: 0.5-1.0 cores
- Memory: 256-512MB
- Runs: Hourly

**Model-2:**
- CPU: 0.75-1.5 cores
- Memory: 384-768MB
- Runs: Every 5/15/60 minutes

### Network

- Internal bridge network: `172.25.0.0/16`
- Redis port: `6379` (accessible from host)
- No external ports for models (security)

---

## 🔒 Security Best Practices

### 1. Environment Variables

```bash
# Never commit .env to git
echo ".env" >> .gitignore

# Use strong secrets
TELEGRAM_BOT_TOKEN=$(openssl rand -hex 32)
```

### 2. Network Isolation

```yaml
# In docker-compose.prod.yml
networks:
  hyperliquid-network:
    driver: bridge
    # Internal only - no internet access (optional)
    internal: false
```

### 3. Resource Limits

All containers have CPU and memory limits to prevent resource exhaustion.

### 4. Log Rotation

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"  # Max 10MB per log file
    max-file: "5"    # Keep 5 files (50MB total)
```

### 5. Health Checks

All containers have health checks with automatic restart on failure.

### 6. Non-Root User

Containers run as non-root user `nodejs` (UID 1001).

---

## 📊 Monitoring

### Container Health

```bash
# Check all containers
docker-compose -f docker-compose.prod.yml ps

# Check specific container health
docker inspect hyperliquid-model2 --format='{{.State.Health.Status}}'
```

### Logs

```bash
# Real-time logs (all)
docker-compose -f docker-compose.prod.yml logs -f

# Model-1 only
docker-compose -f docker-compose.prod.yml logs -f model1-breakout

# Model-2 only
docker-compose -f docker-compose.prod.yml logs -f model2-intraday

# Last 100 lines
docker-compose -f docker-compose.prod.yml logs --tail=100

# Filter for signals
docker-compose -f docker-compose.prod.yml logs | grep "SIGNAL\|BREAKOUT"
```

### Resource Usage

```bash
# Real-time stats
docker stats

# Specific containers
docker stats hyperliquid-redis hyperliquid-model1 hyperliquid-model2

# One-time snapshot
docker stats --no-stream
```

### Redis Monitoring

```bash
# Redis CLI
docker exec -it hyperliquid-redis redis-cli

# Check memory
docker exec hyperliquid-redis redis-cli INFO memory

# Check stats
docker exec hyperliquid-redis redis-cli INFO stats

# Count signals
docker exec hyperliquid-redis redis-cli DBSIZE

# Model-1 signals
docker exec hyperliquid-redis redis-cli KEYS "breakout:*"

# Model-2 signals
docker exec hyperliquid-redis redis-cli KEYS "intraday:signal:*"
```

### Application Metrics

```bash
# Check signal counts
docker exec hyperliquid-redis redis-cli KEYS "intraday:signal:*" | wc -l
docker exec hyperliquid-redis redis-cli KEYS "breakout:*" | wc -l

# View recent signals
docker exec hyperliquid-redis redis-cli --scan --pattern "intraday:signal:*" | head -10
```

---

## 🔄 Updates and Rollbacks

### Update to Latest

```bash
# Option 1: Using script
./deploy.sh deploy

# Option 2: Manual
docker pull hardy18/breakout-watcher:latest
docker-compose -f docker-compose.prod.yml up -d
```

### Update with Downtime

```bash
docker-compose -f docker-compose.prod.yml down
docker pull hardy18/breakout-watcher:latest
docker-compose -f docker-compose.prod.yml up -d
```

### Zero-Downtime Update (Single Model)

```bash
# Update Model-2 only
docker-compose -f docker-compose.prod.yml up -d --no-deps model2-intraday

# Update Model-1 only
docker-compose -f docker-compose.prod.yml up -d --no-deps model1-breakout
```

### Rollback to Specific Version

```bash
# Option 1: Using script
./deploy.sh rollback 20241122-143000

# Option 2: Manual
# Edit docker-compose.prod.yml, change:
# image: hardy18/breakout-watcher:latest
# to:
# image: hardy18/breakout-watcher:20241122-143000

docker-compose -f docker-compose.prod.yml up -d
```

### View Available Tags

```bash
# List images on Docker Hub
docker search hardy18/breakout-watcher

# List local images
docker images hardy18/breakout-watcher
```

---

## 🐛 Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs model2-intraday

# Check if Redis is healthy
docker inspect hyperliquid-redis --format='{{.State.Health.Status}}'

# Restart Redis
docker-compose -f docker-compose.prod.yml restart redis

# Full restart
docker-compose -f docker-compose.prod.yml restart
```

### No Signals Generated

```bash
# Check if Model-2 is running
docker-compose -f docker-compose.prod.yml ps

# Check logs for errors
docker-compose -f docker-compose.prod.yml logs -f model2-intraday | grep ERROR

# Check Redis connection
docker exec hyperliquid-model2 sh -c "redis-cli -h redis ping"

# Manual test
docker-compose -f docker-compose.prod.yml exec model2-intraday \
  node dist/intradayMain.js test
```

### High Memory Usage

```bash
# Check current usage
docker stats --no-stream

# Increase limits in docker-compose.prod.yml:
deploy:
  resources:
    limits:
      memory: 1G  # Increase if needed

# Apply changes
docker-compose -f docker-compose.prod.yml up -d
```

### Redis Connection Errors

```bash
# Test Redis
docker exec hyperliquid-redis redis-cli ping

# Check Redis logs
docker-compose -f docker-compose.prod.yml logs redis

# Restart Redis
docker-compose -f docker-compose.prod.yml restart redis

# Test from Model-2
docker exec hyperliquid-model2 sh -c "nc -zv redis 6379"
```

### Image Pull Fails

```bash
# Login to Docker Hub
docker login

# Pull manually
docker pull hardy18/breakout-watcher:latest

# Check if image exists
docker images | grep breakout-watcher
```

### Disk Space Issues

```bash
# Check disk usage
df -h

# Clean up Docker
docker system prune -a --volumes

# Clean old images only
./deploy.sh cleanup
```

---

## 💾 Backup and Recovery

### Backup Redis Data

```bash
# Manual backup
docker exec hyperliquid-redis redis-cli SAVE
docker cp hyperliquid-redis:/data/dump.rdb ./backups/redis-$(date +%Y%m%d).rdb

# Automated backup (add to cron)
# 0 2 * * * /path/to/backup-redis.sh
```

### Restore Redis Data

```bash
# Stop containers
docker-compose -f docker-compose.prod.yml down

# Restore data
docker cp ./backups/redis-20241122.rdb hyperliquid-redis:/data/dump.rdb

# Start containers
docker-compose -f docker-compose.prod.yml up -d
```

### Backup Logs

```bash
# Archive logs
tar -czf logs-backup-$(date +%Y%m%d).tar.gz logs/

# Move to backup location
mv logs-backup-*.tar.gz /path/to/backups/
```

---

## 🔧 Advanced Configuration

### Scale Model-2 Instances

```bash
# Run multiple Model-2 containers
docker-compose -f docker-compose.prod.yml up -d --scale model2-intraday=3
```

### Separate Timeframes

Create separate containers for each timeframe:

```yaml
services:
  model2-5m:
    image: hardy18/breakout-watcher:latest
    command: ["node", "dist/intradayMain.js", "start", "5m"]
    # ... other config ...

  model2-15m:
    image: hardy18/breakout-watcher:latest
    command: ["node", "dist/intradayMain.js", "start", "15m"]
    # ... other config ...

  model2-1h:
    image: hardy18/breakout-watcher:latest
    command: ["node", "dist/intradayMain.js", "start", "1h"]
    # ... other config ...
```

### Custom Symbol List

```yaml
environment:
  - BACKTEST_SYMBOLS=BTC,ETH,SOL,ARB,AVAX,MATIC,LINK,UNI
```

---

## 📈 Performance Tuning

### Redis Optimization

```yaml
command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru --save 900 1 --save 300 10
```

### Node.js Optimization

```yaml
environment:
  - NODE_OPTIONS="--max-old-space-size=512"
```

### Network Optimization

```yaml
networks:
  hyperliquid-network:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.name: br-hyperliquid
```

---

## 📝 Maintenance Tasks

### Weekly

- [ ] Check logs for errors
- [ ] Verify signal generation
- [ ] Check Telegram notifications
- [ ] Review resource usage
- [ ] Backup Redis data

### Monthly

- [ ] Update Docker images
- [ ] Clean old images: `./deploy.sh cleanup`
- [ ] Review and archive logs
- [ ] Check disk space
- [ ] Update dependencies (rebuild)

### Quarterly

- [ ] Review performance metrics
- [ ] Optimize configurations
- [ ] Update documentation
- [ ] Disaster recovery test

---

## 🚀 CI/CD Integration

### GitHub Actions

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build and push
        run: |
          docker buildx build --platform linux/amd64 \
            -t hardy18/breakout-watcher:latest \
            --push .
      
      - name: Deploy
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.HOST }}
          username: ${{ secrets.USERNAME }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /opt/hyperliquid
            docker-compose -f docker-compose.prod.yml pull
            docker-compose -f docker-compose.prod.yml up -d
```

---

## 📞 Support Checklist

If something goes wrong:

1. ✅ Check container status: `docker-compose -f docker-compose.prod.yml ps`
2. ✅ View logs: `docker-compose -f docker-compose.prod.yml logs`
3. ✅ Check Redis: `docker exec hyperliquid-redis redis-cli ping`
4. ✅ Check resources: `docker stats`
5. ✅ Test manually: `docker exec hyperliquid-model2 node dist/intradayMain.js test`
6. ✅ Restart services: `docker-compose -f docker-compose.prod.yml restart`
7. ✅ Check Telegram bot token validity

---

## 🎯 Quick Reference

```bash
# Build and push
./deploy.sh build

# Deploy to production
./deploy.sh deploy

# Full workflow
./deploy.sh full

# View logs
./deploy.sh logs

# Check status
./deploy.sh status

# Rollback
./deploy.sh rollback <tag>

# Cleanup
./deploy.sh cleanup
```

---

## ✅ Production Checklist

Before going live:

- [ ] `.env` file created with valid credentials
- [ ] Docker image built and pushed
- [ ] Containers started successfully
- [ ] Health checks passing
- [ ] Redis data persisting
- [ ] Logs being written
- [ ] Telegram notifications working
- [ ] Resource limits appropriate
- [ ] Monitoring set up
- [ ] Backup strategy in place

---

**🎉 You're ready for production!**

For local development, see `DOCKER_QUICKSTART.md`  
For dual-model details, see `DOCKER_DUAL_MODEL.md`  
For Model-2 guide, see `MODEL2_INTRADAY_GUIDE.md`

