# Quickstart Guide

Get the Hyperliquid Breakout Detector running in 5 minutes.

## Prerequisites

- Node.js 18+
- Redis running on localhost:6379
- Terminal/Command Line

## Installation

```bash
# 1. Install dependencies
yarn install

# 2. Build the project
yarn build

# 3. Start Redis (if not already running)
# macOS with Homebrew:
brew services start redis

# Linux:
sudo systemctl start redis

# Docker:
docker run -d -p 6379:6379 redis:latest

# 4. Start the detector
yarn start
```

## What Happens Next

The detector will:

1. **Connect** to Hyperliquid WebSocket
2. **Discover** all active perpetual markets
3. **Subscribe** to 1-hour candles for each market
4. **Monitor** continuously for breakouts

## Breakout Detection Schedule

- **Every 5 minutes**: Discover new markets
- **Every hour at :05**: Detect breakouts
- **Every 6 hours**: Evaluate historical outcomes
- **Daily at midnight**: Print statistics report

## Expected Output

```
======================================================================
HYPERLIQUID BREAKOUT DETECTOR
======================================================================

[INFO] Initializing WebSocket streaming (1h candles)...
[INFO] Candle WebSocket connected
[INFO] Discovered 184 active perpetual markets
[INFO] Subscribed to BTC (1h candles)
[INFO] Subscribed to ETH (1h candles)
...

✓ Hyperliquid Breakout Detector started successfully
  - Monitoring 1-hour candles for high-confidence breakouts
  - Tracking 3-month historical breakout data
  - Detection runs every hour at :05 minutes
```

## Viewing Breakouts

When a breakout is detected, you'll see:

```
🚀 BREAKOUT DETECTED: SOL | Price: $125.45 | Volume: 3.2x | 
Change: +4.2% | Confidence: 78/100 | Type: STRONG
```

## Manual Commands

Run detection manually:

```bash
# Detect breakouts now
node dist/breakout/breakoutRunner.js detect

# Show statistics
node dist/breakout/breakoutRunner.js stats

# Evaluate outcomes
node dist/breakout/breakoutRunner.js evaluate

# Run everything
node dist/breakout/breakoutRunner.js all
```

## View Data in Redis

```bash
# Connect to Redis CLI
redis-cli

# List all coins being monitored
> KEYS candles:1h:*

# View BTC candles
> LRANGE candles:1h:BTC 0 9

# View all breakouts
> ZRANGE breakout:history:all 0 -1

# Exit
> quit
```

## Troubleshooting

### "Cannot connect to Redis"

```bash
# Check if Redis is running
redis-cli ping
# Should return: PONG

# If not running, start it
brew services start redis  # macOS
sudo systemctl start redis  # Linux
```

### "No breakouts detected"

This is normal! Breakouts require:
- Volume surge (1.5x+ average)
- Price breaking resistance
- Minimum 50/100 confidence score

Breakouts don't happen every hour. The detector is working correctly if you see:

```
[INFO] Breakout detection completed. Found 0 breakouts
```

### "WebSocket disconnected"

The system automatically reconnects. You'll see:

```
[WARN] WebSocket closed, attempting reconnect...
[INFO] Reconnecting in 1000ms (attempt 1)
```

## Configuration

### Environment Variables

```bash
# Redis connection (defaults shown)
export REDIS_HOST=localhost
export REDIS_PORT=6379
export REDIS_DB=0
```

### Adjust Sensitivity

Edit `src/breakout/breakoutDetector.ts`:

```typescript
// Line 217: Adjust minimum requirements
if (volumeRatio < 1.5 || priceChange < 1) {
  return null;
}

// Lower values = more breakouts (but lower quality)
// Higher values = fewer breakouts (but higher quality)
```

### Adjust Confidence Threshold

```typescript
// Line 232: Adjust minimum confidence score
if (confidenceScore < 50) {
  return null;
}

// Default: 50/100 (moderate and strong only)
// Try: 65/100 (strong only)
// Try: 40/100 (all types including weak)
```

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Add notification integrations (Telegram, Discord, etc.)
- Customize breakout criteria for your strategy
- Implement risk management and position sizing

## Support

- Check logs: `tail -f logs/app-*.log`
- View Redis data: `redis-cli`
- Rebuild after changes: `yarn build`
- Restart service: `yarn start`

Happy trading! 🚀

