# 🐳 Docker Quick Start - Both Models

## Fastest Way to Run Both Models

### Option 1: Using npm Scripts (Easiest) ⭐

```bash
# Start both Model-1 and Model-2
npm run docker:dual:up

# View logs
npm run docker:dual:logs

# Stop both
npm run docker:dual:down

# Rebuild and restart
npm run docker:dual:build
```

---

### Option 2: Using Shell Script (Recommended) ⭐⭐

```bash
# Make script executable (one time)
chmod +x docker-dual.sh

# Start both models
./docker-dual.sh start

# View logs
./docker-dual.sh logs

# Check status
./docker-dual.sh status

# Stop both
./docker-dual.sh stop

# See all commands
./docker-dual.sh help
```

---

### Option 3: Using Docker Compose Directly

```bash
# Start
docker-compose -f docker-compose.dual-model.yml up -d

# Logs
docker-compose -f docker-compose.dual-model.yml logs -f

# Stop
docker-compose -f docker-compose.dual-model.yml down
```

---

## 🚀 Complete Setup (First Time)

```bash
# 1. Create .env file
cat > .env << EOF
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
EOF

# 2. Build and start
./docker-dual.sh build

# 3. Check status
./docker-dual.sh status

# 4. View logs
./docker-dual.sh logs
```

**That's it!** Both models are now running. 🎉

---

## 📊 What's Running?

After starting, you'll have **3 containers:**

| Container | Purpose | Ports |
|-----------|---------|-------|
| `hyperliquid-redis` | Shared Redis storage | 6379 |
| `hyperliquid-model1` | Model-1 (daily breakouts) | - |
| `hyperliquid-model2` | Model-2 (intraday 5m/15m/1h) | - |

---

## 📋 Common Commands

### Using Shell Script

```bash
./docker-dual.sh start        # Start both models
./docker-dual.sh stop         # Stop both models
./docker-dual.sh restart      # Restart both
./docker-dual.sh logs         # View all logs
./docker-dual.sh logs-m1      # Model-1 logs only
./docker-dual.sh logs-m2      # Model-2 logs only
./docker-dual.sh status       # Container status
./docker-dual.sh stats        # Resource usage
./docker-dual.sh test-m2      # Test Model-2
./docker-dual.sh backtest     # Backtest Model-2
```

### Using npm Scripts

```bash
npm run docker:dual:up        # Start
npm run docker:dual:down      # Stop
npm run docker:dual:logs      # Logs
npm run docker:dual:build     # Rebuild
```

---

## 🔍 Monitoring

### View Live Logs

```bash
# All containers
./docker-dual.sh logs

# Model-1 only
./docker-dual.sh logs-m1

# Model-2 only
./docker-dual.sh logs-m2

# Filter for signals
./docker-dual.sh logs | grep "SIGNAL"
./docker-dual.sh logs | grep "BREAKOUT"
```

### Check Status

```bash
# Container status
./docker-dual.sh status

# Resource usage
./docker-dual.sh stats

# Redis connection
docker exec hyperliquid-redis redis-cli ping
```

---

## 🧪 Testing

```bash
# Test Model-2 (one cycle)
./docker-dual.sh test-m2

# Run Model-2 backtest
./docker-dual.sh backtest

# Check Redis data
./docker-dual.sh redis
> KEYS intraday:signal:*
> KEYS breakout:*
> exit
```

---

## 🛠️ Maintenance

### Restart After Code Changes

```bash
# Option 1: Rebuild everything
./docker-dual.sh build

# Option 2: Rebuild specific service
docker-compose -f docker-compose.dual-model.yml up -d --build model2-intraday
```

### Clean Up

```bash
# Stop and remove containers
./docker-dual.sh down

# Stop and remove everything (including data)
./docker-dual.sh clean
```

### Update Configuration

```bash
# Edit .env file
nano .env

# Restart to apply
./docker-dual.sh restart
```

---

## 🐛 Troubleshooting

### Container Won't Start

```bash
# Check logs
./docker-dual.sh logs

# Check status
./docker-dual.sh status

# Rebuild
./docker-dual.sh build
```

### No Signals

```bash
# Check if containers are running
./docker-dual.sh status

# View Model-2 logs
./docker-dual.sh logs-m2

# Test manually
./docker-dual.sh test-m2
```

### Redis Connection Issues

```bash
# Test Redis
docker exec hyperliquid-redis redis-cli ping

# Restart Redis
docker-compose -f docker-compose.dual-model.yml restart redis
```

---

## 🎯 Production Tips

### 1. Check Logs Regularly

```bash
# Watch in real-time
./docker-dual.sh logs | tee logs/docker-$(date +%Y-%m-%d).log
```

### 2. Monitor Resources

```bash
# Resource usage
./docker-dual.sh stats

# Add limits if needed (edit docker-compose.dual-model.yml):
deploy:
  resources:
    limits:
      memory: 512M
```

### 3. Backup Redis Data

```bash
# Manual backup
docker exec hyperliquid-redis redis-cli SAVE
docker cp hyperliquid-redis:/data/dump.rdb ./backup/

# Or use automatic backups (already enabled with appendonly yes)
```

### 4. Auto-Restart

Containers are configured with `restart: unless-stopped`, so they'll automatically restart if they crash or the server reboots.

---

## 📈 Expected Behavior

### Model-1 (hyperliquid-model1)
- Checks hourly for 1h candle breakouts
- Conservative (70%+ win rate)
- Low frequency (5-15 signals/day)
- Logs: `"Detected breakout for..."`

### Model-2 (hyperliquid-model2)
- Checks every 5/15/60 minutes
- Aggressive (48-55% win rate)
- High frequency (20-60 signals/day)
- Logs: `"IntradayRunner"`, `"Detected volatility_breakout..."`

### Redis
- Stores signals from both models
- Model-1 keys: `breakout:*`
- Model-2 keys: `intraday:signal:*`
- Persistent storage with AOF

---

## 🔐 Security Checklist

- [ ] `.env` file not committed to git
- [ ] Strong Telegram bot token
- [ ] Redis port not exposed publicly (only internal)
- [ ] Containers run as non-root user
- [ ] Log rotation enabled
- [ ] Resource limits configured

---

## 📚 More Information

- **Full Docker Guide:** `DOCKER_DUAL_MODEL.md`
- **Model-2 Guide:** `MODEL2_INTRADAY_GUIDE.md`
- **Implementation Details:** `MODEL2_IMPLEMENTATION_SUMMARY.md`

---

## 🎉 You're All Set!

Both models are now running in Docker. Check Telegram for alerts!

**Quick health check:**
```bash
./docker-dual.sh status
./docker-dual.sh stats
./docker-dual.sh logs | head -50
```

If you see logs scrolling and containers showing "Up", you're good to go! 🚀

