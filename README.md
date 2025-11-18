# Hyperliquid Breakout Detector

A TypeScript service for detecting high-confidence price breakouts on Hyperliquid perpetual markets.

## Overview

This system monitors real-time 1-hour candle data from Hyperliquid and detects breakouts using multiple confirmation factors:

- **Volume Surge**: 1.5x+ average volume (higher for better signals)
- **Price Breakout**: Price breaks above resistance levels
- **Consolidation Pattern**: Low volatility period before breakout
- **Sustained Momentum**: Multiple confirming candles

## Architecture

```
src/
├── index.ts                          # Main orchestration and scheduling
├── breakout/
│   ├── breakoutDetector.ts          # Core breakout detection logic
│   ├── breakoutHistory.ts           # 3-month historical tracking & evaluation
│   └── breakoutRunner.ts            # Standalone runner for manual execution
├── cron/
│   └── discoverMarkets.ts           # Active market discovery
├── stream/
│   └── candleStreamer.ts            # 1h candle WebSocket streaming
└── utils/
    ├── redisClient.ts               # Redis connection
    ├── logger.ts                    # Logging utilities
    └── types.ts                     # TypeScript interfaces
```

## Features

### 1. High-Confidence Breakout Detection

Each breakout is scored 0-100 based on:

- **Volume Ratio** (0-40 points): Current volume vs 24h average
  - 5x+ volume: 40 points
  - 3x+ volume: 30 points
  - 2x+ volume: 20 points
  - 1.5x+ volume: 10 points

- **Price Breakout** (0-30 points): Percentage above resistance
  - 5%+ breakout: 30 points
  - 3%+ breakout: 20 points
  - 2%+ breakout: 15 points
  - 1%+ breakout: 10 points

- **Consolidation** (0-20 points): Hours of low volatility before breakout
  - 12h+ consolidation: 20 points
  - 8h+ consolidation: 15 points
  - 4h+ consolidation: 10 points

- **Sustained Momentum** (0-10 points): Multiple green candles
  - 2+ consecutive green candles: 10 points

**Breakout Types:**
- **Strong**: 75+ confidence score
- **Moderate**: 50-74 confidence score
- **Weak**: <50 (filtered out)

Only breakouts with 50+ confidence are reported.

### 2. 3-Month Historical Tracking

All breakouts are automatically:
- Stored in Redis for 90 days
- Evaluated at multiple time horizons (1h, 4h, 12h, 24h)
- Analyzed for success rate (3%+ gain within 24h)

Statistics include:
- Total breakouts detected
- Success rate
- Average gains at each time horizon
- Top 10 best performers
- Breakdown by breakout type

### 3. Real-Time Monitoring

- Subscribes to 1h candles from Hyperliquid WebSocket
- Monitors all active perpetual markets
- Runs detection every hour at :05 minutes
- Evaluates outcomes every 6 hours
- Daily statistics report at midnight

## Installation

### Prerequisites

- Node.js 18+
- Redis server (localhost:6379)
- Yarn or npm

### Setup

```bash
# Install dependencies
yarn install

# Build TypeScript
yarn build

# Start the detector
yarn start
```

### Environment Variables

```bash
export REDIS_HOST=localhost
export REDIS_PORT=6379
export REDIS_DB=0
```

## Usage

### Main Service

Start the continuous monitoring service:

```bash
yarn start
# or
node dist/index.js
```

This will:
- Connect to Hyperliquid WebSocket
- Subscribe to all active perpetual markets
- Run breakout detection every hour
- Evaluate historical outcomes every 6 hours
- Print daily statistics report

### Manual Commands

Run standalone commands using the breakout runner:

```bash
# Detect breakouts now
node dist/breakout/breakoutRunner.js detect

# Evaluate historical outcomes
node dist/breakout/breakoutRunner.js evaluate

# Show statistics (last 90 days)
node dist/breakout/breakoutRunner.js stats

# Show statistics for specific period
node dist/breakout/breakoutRunner.js stats 30

# Run everything
node dist/breakout/breakoutRunner.js all
```

## Data Storage

### Redis Keys

**Candle Data:**
- `candles:1h:<COIN>` - Last 60 hours of candles (Redis List)

**Breakout Signals:**
- `breakout:signal:<COIN>:<TIMESTAMP>` - Individual signal data (7 day TTL)
- `breakout:history:<COIN>` - Coin-specific breakout history (Sorted Set, 90 days)
- `breakout:history:all` - All breakouts (Sorted Set, 90 days)

**Breakout Outcomes:**
- `breakout:outcome:<COIN>:<TIMESTAMP>` - Evaluation results (90 day TTL)

**Active Tracking:**
- `breakouts:active` - Currently active breakouts (Sorted Set)

## Breakout Detection Algorithm

### Step 1: Calculate Resistance Level
- Use last 20 candles (excluding most recent 2)
- Calculate 95th percentile of highs
- This becomes the resistance level

### Step 2: Calculate Average Volume
- Average volume over last 24 hours
- Used as baseline for volume surge detection

### Step 3: Detect Consolidation
- Check last 12 hours for low volatility
- Calculate coefficient of variation (stdDev / mean)
- <2% = 12h consolidation, <3% = 8h, <4% = 4h

### Step 4: Check for Breakout
- Current price must exceed resistance level
- Minimum 1.5x volume surge required
- Minimum 1% price breakout required

### Step 5: Calculate Confidence
- Sum scores from all factors
- Require minimum 50/100 score
- Classify as strong/moderate/weak

### Step 6: Store & Track
- Store signal in Redis
- Add to history for later evaluation
- Log to console with full details

## Example Output

### Breakout Detection

```
🚀 BREAKOUT DETECTED: BTC | Price: $43250.50 | Volume: 4.2x | 
Change: +3.5% | Confidence: 82/100 | Type: STRONG
```

### Statistics Report

```
======================================================================
BREAKOUT STATISTICS (Last 90 days)
======================================================================
Total Breakouts: 145
Successful (3%+ gain): 102 (70.3%)

Average Gains:
  1 Hour:  +1.45%
  4 Hours: +2.87%
  12 Hours: +4.23%
  24 Hours: +5.61%

Breakout Types:
  Strong: 42
  Moderate: 103
  Weak: 0

Top 10 Performers:
  1. SOL: +24.5% (11/10/2025)
  2. ETH: +18.2% (11/05/2025)
  3. AVAX: +16.8% (11/12/2025)
  ...
======================================================================
```

## Scheduling

The main service runs these cron jobs:

- **Every 5 minutes**: Discover new markets
- **Every hour at :05**: Run breakout detection
- **Every 6 hours**: Evaluate historical outcomes
- **Daily at midnight**: Print statistics report

## API Endpoints Used

### Hyperliquid Info API

```
POST https://api.hyperliquid.xyz/info
{
  "type": "meta"
}
```

Returns all perpetual markets in the `universe` field.

### Hyperliquid WebSocket

```
wss://api.hyperliquid.xyz/ws
```

Subscribe message:
```json
{
  "method": "subscribe",
  "subscription": {
    "type": "candle",
    "coin": "BTC",
    "interval": "1h"
  }
}
```

Receives candle updates with OHLCV data.

## Performance Considerations

- **Memory**: ~60 candles × ~200 bytes per coin = ~12KB per coin
- **WebSocket**: Single connection with multiple subscriptions (efficient)
- **Detection**: Linear O(n) over active coins, ~1-2ms per coin
- **Redis**: All data stored with TTL or ZREMRANGEBYSCORE for cleanup

## Monitoring & Debugging

### View Candles (Redis CLI)

```bash
redis-cli
> LRANGE candles:1h:BTC 0 9
```

### View Breakout History

```bash
redis-cli
> ZRANGE breakout:history:all 0 -1 WITHSCORES
```

### View Outcomes

```bash
redis-cli
> KEYS breakout:outcome:*
> GET breakout:outcome:BTC:1699xxxxxxx
```

### Logs

All logs are written to:
- Console (colored output)
- `logs/app-YYYY-MM-DD.log` (JSON lines)

## Advanced Tuning

### Adjust Confidence Thresholds

Edit `src/breakout/breakoutDetector.ts`:

```typescript
// Require minimum confidence score (default: 50)
if (confidenceScore < 50) {
  return null;
}
```

### Adjust Volume Requirements

```typescript
// Require minimum volume surge (default: 1.5x)
if (volumeRatio < 1.5 || priceChange < 1) {
  return null;
}
```

### Adjust Success Criteria

Edit `src/breakout/breakoutHistory.ts`:

```typescript
// Consider 3%+ gain as success (adjustable)
success: gain24h >= 3
```

## Backtesting

The system automatically evaluates all historical breakouts:

1. **Signal Generation**: Breakout detected and stored
2. **Wait Period**: 24+ hours pass
3. **Evaluation**: System retrieves candles after breakout
4. **Outcome Calculation**: Measures peak gains at 1h, 4h, 12h, 24h
5. **Success Determination**: 3%+ gain within 24h = success
6. **Statistics**: Aggregate metrics across all evaluated breakouts

Access backtesting results:

```bash
node dist/breakout/breakoutRunner.js stats
```

## Customization

### Add Custom Indicators

Extend `detectBreakoutForCoin()` in `breakoutDetector.ts`:

```typescript
// Example: Add RSI indicator
const rsi = calculateRSI(candles, 14);
if (rsi > 70) {
  // Overbought - reduce confidence
  confidenceScore -= 10;
}
```

### Add Notification System

Hook into signal generation in `index.ts`:

```typescript
const signals = await detectBreakouts(activatedCoins);

for (const signal of signals) {
  await storeBreakoutSignal(signal);
  
  // Add your notification here
  if (signal.confidenceScore >= 75) {
    await sendTelegramAlert(signal);
  }
}
```

### Custom Time Horizons

Modify evaluation periods in `breakoutHistory.ts`:

```typescript
// Add 48h evaluation
let peak48h = breakoutPrice;
if (hoursAfter <= 48) {
  peak48h = Math.max(peak48h, candle.high);
}
```

## Troubleshooting

### No breakouts detected

- Check if coins are subscribed: `redis-cli KEYS candles:1h:*`
- Verify candle data exists: `redis-cli LRANGE candles:1h:BTC 0 0`
- Lower minimum confidence threshold temporarily
- Check logs for errors: `tail -f logs/app-*.log`

### WebSocket disconnections

The system automatically reconnects with exponential backoff (up to 5 attempts).
Check logs for connection status.

### Redis connection errors

Ensure Redis is running:
```bash
redis-cli ping
# Should return "PONG"
```

### High false positive rate

Increase minimum thresholds:
```typescript
// Increase volume requirement
if (volumeRatio < 2.0) return null;

// Increase minimum confidence
if (confidenceScore < 65) return null;
```

## Contributing

This is a production-ready breakout detection system. Feel free to:
- Add new indicators
- Tune thresholds for your strategy
- Add notification integrations
- Implement risk management layers

## License

MIT

## Support

For issues or questions:
- Check logs in `logs/` directory
- Review Redis keys with `redis-cli`
- Enable debug logging in `logger.ts`
