# Running Both Models with Docker

## 🐳 Quick Start (Recommended)

### Option 1: Dual Model Docker Compose (Both Models)

Run both Model-1 and Model-2 together as separate containers:

```bash
# Start both models
docker-compose -f docker-compose.dual-model.yml up -d

# View logs
docker-compose -f docker-compose.dual-model.yml logs -f

# Check status
docker-compose -f docker-compose.dual-model.yml ps

# Stop both
docker-compose -f docker-compose.dual-model.yml down
```

This creates **3 containers:**
- `hyperliquid-redis` - Shared Redis instance
- `hyperliquid-model1` - Model-1 (daily breakouts, 1h candles)
- `hyperliquid-model2` - Model-2 (intraday, 5m/15m/1h)

---

## 📊 Container Architecture

```
┌─────────────────────────────────────────┐
│         Docker Network                   │
│                                          │
│  ┌──────────────┐                       │
│  │    Redis     │                       │
│  │   (shared)   │                       │
│  └──────┬───────┘                       │
│         │                                │
│    ┌────┴────┬──────────────┐          │
│    │         │              │           │
│  ┌─┴──────┐ ┌┴───────────┐ │           │
│  │Model-1 │ │  Model-2   │ │           │
│  │(1h)    │ │(5m/15m/1h) │ │           │
│  │index.js│ │intraday.js │ │           │
│  └────────┘ └────────────┘ │           │
│                              │           │
└──────────────────────────────┼──────────┘
                               │
                          ┌────┴─────┐
                          │ Telegram │
                          └──────────┘
```

---

## 🚀 Deployment Options

### Option A: Both Models (Production)

**Use case:** Full system, maximum signal coverage

```bash
# Using dedicated dual-model compose
docker-compose -f docker-compose.dual-model.yml up -d

# Or with rebuild
docker-compose -f docker-compose.dual-model.yml up -d --build
```

**What runs:**
- Model-1: Hourly detection (conservative, 70%+ win rate)
- Model-2: 5m/15m/1h detection (aggressive, 48-55% win rate)

---

### Option B: Model-1 Only (Conservative)

**Use case:** Daily breakouts only, lower frequency

```bash
docker-compose up -d
```

This uses the original `docker-compose.yml` and only runs Model-1.

---

### Option C: Model-2 Only (Intraday Trading)

**Use case:** High-frequency intraday signals only

```bash
docker-compose -f docker-compose.dual-model.yml up -d redis model2-intraday
```

---

### Option D: Selective Timeframes

**Model-2 with only 1h timeframe:**

Create `docker-compose.override.yml`:
```yaml
version: '3.8'
services:
  model2-intraday:
    command: ["node", "dist/intradayMain.js", "start", "1h"]
```

Then run:
```bash
docker-compose -f docker-compose.dual-model.yml -f docker-compose.override.yml up -d
```

---

## ⚙️ Configuration

### Environment Variables

Create or update `.env` file:

```bash
# Required for both models
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# Redis (auto-configured in Docker)
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0

# Optional: Model-2 backtest config
BACKTEST_DAYS=30
BACKTEST_SYMBOLS=BTC,ETH,SOL,ARB,AVAX

# Optional: Node environment
NODE_ENV=production
```

---

## 🔧 Advanced Configurations

### Scale Model-2 for Different Timeframes

Run separate containers for each timeframe:

```yaml
version: '3.8'
services:
  redis:
    # ... (same as above)

  model1-breakout:
    # ... (same as above)

  model2-5m:
    # ... (same base config)
    container_name: hyperliquid-model2-5m
    command: ["node", "dist/intradayMain.js", "start", "5m"]

  model2-15m:
    container_name: hyperliquid-model2-15m
    command: ["node", "dist/intradayMain.js", "start", "15m"]

  model2-1h:
    container_name: hyperliquid-model2-1h
    command: ["node", "dist/intradayMain.js", "start", "1h"]
```

---

## 📋 Management Commands

### Start/Stop Services

```bash
# Start all
docker-compose -f docker-compose.dual-model.yml up -d

# Start specific model
docker-compose -f docker-compose.dual-model.yml up -d model1-breakout
docker-compose -f docker-compose.dual-model.yml up -d model2-intraday

# Stop all
docker-compose -f docker-compose.dual-model.yml down

# Stop specific model (keeps Redis running)
docker-compose -f docker-compose.dual-model.yml stop model2-intraday
```

### View Logs

```bash
# All containers
docker-compose -f docker-compose.dual-model.yml logs -f

# Specific model
docker-compose -f docker-compose.dual-model.yml logs -f model1-breakout
docker-compose -f docker-compose.dual-model.yml logs -f model2-intraday

# Last 100 lines
docker-compose -f docker-compose.dual-model.yml logs --tail=100 model2-intraday

# Filter for specific patterns
docker-compose -f docker-compose.dual-model.yml logs -f | grep "IntradayRunner"
docker-compose -f docker-compose.dual-model.yml logs -f | grep "SIGNAL"
```

### Check Status

```bash
# Container status
docker-compose -f docker-compose.dual-model.yml ps

# Resource usage
docker stats hyperliquid-model1 hyperliquid-model2

# Health checks
docker inspect hyperliquid-model1 | grep -A 5 Health
docker inspect hyperliquid-model2 | grep -A 5 Health
```

### Restart Services

```bash
# Restart all
docker-compose -f docker-compose.dual-model.yml restart

# Restart specific model
docker-compose -f docker-compose.dual-model.yml restart model2-intraday

# Rebuild and restart
docker-compose -f docker-compose.dual-model.yml up -d --build
```

---

## 🔍 Monitoring

### Real-time Monitoring

```bash
# Watch all logs
docker-compose -f docker-compose.dual-model.yml logs -f

# Watch Model-1 signals
docker-compose -f docker-compose.dual-model.yml logs -f | grep "BREAKOUT"

# Watch Model-2 signals
docker-compose -f docker-compose.dual-model.yml logs -f | grep "Intraday"

# Watch Redis activity
docker exec hyperliquid-redis redis-cli MONITOR
```

### Check Signal Counts

```bash
# Model-1 signals
docker exec hyperliquid-redis redis-cli KEYS "breakout:*" | wc -l

# Model-2 signals
docker exec hyperliquid-redis redis-cli KEYS "intraday:signal:*" | wc -l

# All keys
docker exec hyperliquid-redis redis-cli DBSIZE
```

### Access Container Shell

```bash
# Model-1
docker exec -it hyperliquid-model1 sh

# Model-2
docker exec -it hyperliquid-model2 sh

# Redis CLI
docker exec -it hyperliquid-redis redis-cli
```

---

## 🧪 Testing in Docker

### Run Backtest in Docker

```bash
# Build first
docker-compose -f docker-compose.dual-model.yml build

# Run backtest (temporary container)
docker-compose -f docker-compose.dual-model.yml run --rm model2-intraday \
  node dist/intradayMain.js backtest

# Or with custom parameters
docker run --rm \
  -e TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN \
  -e TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID \
  -e BACKTEST_DAYS=7 \
  -e BACKTEST_SYMBOLS=BTC,ETH,SOL \
  hyperliquid-model2 \
  node dist/intradayMain.js backtest
```

### Run Test Cycle

```bash
# Single detection cycle
docker-compose -f docker-compose.dual-model.yml run --rm model2-intraday \
  node dist/intradayMain.js test

# Test specific timeframe
docker-compose -f docker-compose.dual-model.yml run --rm model2-intraday \
  node dist/intradayMain.js test 5m
```

---

## 🐛 Troubleshooting

### Issue: Container Won't Start

```bash
# Check logs
docker-compose -f docker-compose.dual-model.yml logs model2-intraday

# Check if Redis is healthy
docker-compose -f docker-compose.dual-model.yml ps redis

# Restart Redis
docker-compose -f docker-compose.dual-model.yml restart redis
```

### Issue: No Signals Generated

```bash
# Check if container is running
docker-compose -f docker-compose.dual-model.yml ps

# View real-time logs
docker-compose -f docker-compose.dual-model.yml logs -f model2-intraday

# Check Redis connection
docker exec hyperliquid-model2 sh -c "nc -zv redis 6379"

# Manual test
docker-compose -f docker-compose.dual-model.yml exec model2-intraday \
  node dist/intradayMain.js test
```

### Issue: High Memory Usage

```bash
# Check resource usage
docker stats hyperliquid-model1 hyperliquid-model2

# Add memory limits in docker-compose.dual-model.yml:
services:
  model2-intraday:
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
```

### Issue: Redis Connection Errors

```bash
# Check Redis logs
docker-compose -f docker-compose.dual-model.yml logs redis

# Test Redis from container
docker exec hyperliquid-model2 sh -c "redis-cli -h redis ping"

# Restart Redis
docker-compose -f docker-compose.dual-model.yml restart redis
```

---

## 📊 Resource Usage

### Expected Resource Consumption

| Container | CPU (avg) | Memory | Disk I/O |
|-----------|-----------|--------|----------|
| Redis | 1-2% | 50-100MB | Low |
| Model-1 | 2-5% | 100-200MB | Low |
| Model-2 (all TF) | 5-10% | 150-300MB | Medium |
| Model-2 (1h only) | 2-4% | 100-200MB | Low |

---

## 🔐 Security Best Practices

### 1. Use Environment Files

```bash
# Don't commit .env to git
echo ".env" >> .gitignore

# Use docker secrets for production
docker secret create telegram_token ./telegram_token.txt
```

### 2. Network Isolation

```yaml
services:
  redis:
    networks:
      - internal
  model1-breakout:
    networks:
      - internal
  model2-intraday:
    networks:
      - internal

networks:
  internal:
    driver: bridge
    internal: true  # No external access
```

### 3. Read-Only Filesystem

```yaml
services:
  model2-intraday:
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - ./logs:/app/logs  # Only logs writable
```

---

## 🚀 Production Deployment

### Docker Stack (Swarm Mode)

```bash
# Convert to stack format
docker-compose -f docker-compose.dual-model.yml config > stack.yml

# Deploy
docker stack deploy -c stack.yml hyperliquid

# Scale Model-2
docker service scale hyperliquid_model2-intraday=3
```

### Kubernetes (Advanced)

See separate `k8s/` directory for Kubernetes manifests.

---

## 📖 Quick Reference

### Most Common Commands

```bash
# Start both models
docker-compose -f docker-compose.dual-model.yml up -d

# View logs
docker-compose -f docker-compose.dual-model.yml logs -f

# Restart after code changes
docker-compose -f docker-compose.dual-model.yml up -d --build

# Stop everything
docker-compose -f docker-compose.dual-model.yml down

# Clean up (including volumes)
docker-compose -f docker-compose.dual-model.yml down -v
```

---

## 🎯 Recommended Setup

**For most users:**

```bash
# 1. Create .env file
cat > .env << EOF
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id
EOF

# 2. Start both models
docker-compose -f docker-compose.dual-model.yml up -d

# 3. Monitor
docker-compose -f docker-compose.dual-model.yml logs -f

# 4. Check signals in Telegram
```

---

## 📞 Support

If containers aren't working:
1. Check logs: `docker-compose -f docker-compose.dual-model.yml logs`
2. Verify Redis: `docker exec hyperliquid-redis redis-cli ping`
3. Test manually: `docker-compose -f docker-compose.dual-model.yml exec model2-intraday node dist/intradayMain.js test`
4. Rebuild: `docker-compose -f docker-compose.dual-model.yml up -d --build`

---

**That's it!** You now have both models running in Docker. 🎉

