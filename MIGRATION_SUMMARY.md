# Migration Summary: Prepump → Breakout Detector

## Overview

The system has been completely transformed from a **prepump detection system** to a **high-confidence breakout detector**.

## What Changed

### ✅ Added (New Features)

**Core Breakout Detection:**
- `src/breakout/breakoutDetector.ts` - Multi-factor breakout detection engine
- `src/breakout/breakoutHistory.ts` - 3-month historical tracking and evaluation
- `src/breakout/breakoutRunner.ts` - Standalone runner for manual execution

**Key Features:**
- Volume surge detection (1.5x+ average volume)
- Resistance level calculation (95th percentile)
- Consolidation pattern detection (low volatility periods)
- Sustained momentum checking (multiple green candles)
- Confidence scoring 0-100 with three tiers (strong/moderate/weak)
- Automatic outcome evaluation at 1h, 4h, 12h, 24h horizons
- Success rate tracking (3%+ gain = success)
- Top performer identification
- Daily statistics reports

### ❌ Removed (Deprecated Features)

**Deleted Directories:**
- `src/prepump/` - All prepump detection modules
- `src/backtest/` - Old backtesting framework
- `src/backtester/` - Historical backtesting
- `src/advanced/` - Coin clustering, regime detection, liquidity analysis, weight optimization
- `src/metrics/` - Metrics computation (imbalance, volatility, spread compression)

**Deleted Files:**
- `src/prepumpRunner.ts`
- `src/demo.ts`
- `src/test1HSystem.ts`
- `src/testBacktest.ts`
- `src/signalQuality.ts`
- `src/diagnostics.ts`
- `src/clearPrepump.ts`
- `src/logViewer.ts`
- `src/cronRunner.ts`
- `src/stream/orderbookStreamer.ts`
- `src/stream/tradesAggressor.ts`
- `src/stream/candleSnapshotFetcher.ts`

**Deleted Documentation:**
- `ADVANCED_UPGRADES.md`
- `BACKTEST_README.md`
- `CANDLE_MIGRATION.md`
- `DYNAMIC_THRESHOLD_EXAMPLE.md`
- `IMPLEMENTATION_SUMMARY.md`
- `LOGGING.md`
- `MULTI_FACTOR_README.md`
- `QUICK_REFERENCE.md`
- `README_1H_SYSTEM.md`
- `TWO_TIER_BACKTEST.md`

### 🔄 Modified (Updated Files)

**Core System:**
- `src/index.ts` - Complete rewrite for breakout detection pipeline
- `README.md` - Full documentation for breakout detector
- `src/cron/discoverMarkets.ts` - Removed test code

**Unchanged (Still Used):**
- `src/stream/candleStreamer.ts` - 1h candle WebSocket streaming
- `src/utils/redisClient.ts` - Redis connection
- `src/utils/logger.ts` - Logging utilities
- `src/utils/types.ts` - Type definitions
- `package.json` - Dependencies
- `tsconfig.json` - TypeScript configuration

### 📚 New Documentation

- `README.md` - Complete breakout detector guide
- `QUICKSTART.md` - 5-minute setup guide
- `CHANGELOG.md` - Version history and migration guide
- `MIGRATION_SUMMARY.md` - This file

## Current Architecture

```
src/
├── index.ts                    # Main entry point with cron scheduling
├── breakout/
│   ├── breakoutDetector.ts    # Core detection logic
│   ├── breakoutHistory.ts     # 3-month tracking & evaluation
│   └── breakoutRunner.ts      # Standalone CLI runner
├── cron/
│   └── discoverMarkets.ts     # Market discovery
├── stream/
│   └── candleStreamer.ts      # 1h candle WebSocket
└── utils/
    ├── redisClient.ts         # Redis connection
    ├── logger.ts              # Logging utilities
    └── types.ts               # TypeScript interfaces
```

## Key Differences

### Old System (Prepump)
- Monitored orderbook data (bid/ask imbalance, spread compression)
- Used 3-minute candles
- Tracked metrics like volatility, RV20, imbalance
- Multiple complex modules (clustering, regime detection, liquidity analysis)
- Focus: Detecting early signs before price movement

### New System (Breakout)
- Monitors price action (OHLCV candles)
- Uses 1-hour candles
- Tracks breakouts with volume confirmation
- Single focused module with clear criteria
- Focus: Detecting confirmed price breakouts with high confidence

## Breakout Detection Criteria

**Minimum Requirements:**
- 1.5x average volume surge
- 1% price breakout above resistance
- 50/100 minimum confidence score

**Confidence Scoring:**
- Volume ratio: 0-40 points
- Price breakout: 0-30 points
- Consolidation: 0-20 points
- Sustained momentum: 0-10 points

**Breakout Types:**
- Strong: 75+ confidence
- Moderate: 50-74 confidence
- Weak: <50 (filtered out)

## Data Storage (Redis)

**New Keys:**
- `candles:1h:<COIN>` - Last 60 hours of candles
- `breakout:signal:<COIN>:<TIMESTAMP>` - Individual signals (7 day TTL)
- `breakout:history:<COIN>` - Coin-specific history (90 days)
- `breakout:history:all` - All breakouts (90 days)
- `breakout:outcome:<COIN>:<TIMESTAMP>` - Evaluation results (90 day TTL)
- `breakouts:active` - Currently active breakouts

**Removed Keys:**
- All `metrics:*` keys
- All `orderbook:*` keys
- All `prepump:*` keys
- All `backtest:*` keys

## Cron Schedule

**New Schedule:**
- Every 5 minutes: Discover markets
- Every hour at :05: Detect breakouts
- Every 6 hours: Evaluate outcomes
- Daily at midnight: Statistics report

**Old Schedule:**
- Every 5 minutes: Discover markets
- Every minute: Metrics computation
- Every minute: Prepump detection
- Every hour: Backtest summary

## Running the System

**Start Main Service:**
```bash
yarn build
yarn start
```

**Manual Commands:**
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

## Success Metrics

The system tracks:
- Total breakouts detected
- Success rate (3%+ gain within 24h)
- Average gains at 1h, 4h, 12h, 24h
- Breakout type distribution
- Top 10 performers

Example output:
```
Total Breakouts: 145
Successful (3%+ gain): 102 (70.3%)
Average 24h Gain: +5.61%
```

## Migration Steps (If Upgrading)

1. **Backup Redis data:**
   ```bash
   redis-cli SAVE
   ```

2. **Pull new code:**
   ```bash
   git pull origin main
   ```

3. **Clear old Redis keys:**
   ```bash
   redis-cli FLUSHDB
   ```

4. **Rebuild:**
   ```bash
   rm -rf node_modules dist
   yarn install
   yarn build
   ```

5. **Restart service:**
   ```bash
   yarn start
   ```

## Customization

Edit `src/breakout/breakoutDetector.ts` to adjust:

```typescript
// Minimum volume requirement (line 217)
if (volumeRatio < 1.5 || priceChange < 1) {
  return null;
}

// Minimum confidence (line 232)
if (confidenceScore < 50) {
  return null;
}
```

## Performance

- Detection: ~1-2ms per coin
- Memory: ~12KB per coin (60 candles × ~200 bytes)
- WebSocket: Single connection, efficient multiplexing
- Redis: Automatic cleanup with TTL and ZREMRANGEBYSCORE

## Support

- Full documentation: `README.md`
- Quick start: `QUICKSTART.md`
- Change log: `CHANGELOG.md`
- Logs: `logs/app-*.log`
- Redis data: `redis-cli`

## Future Enhancements

- [ ] Notification integrations (Telegram, Discord)
- [ ] Web dashboard
- [ ] Additional indicators (RSI, MACD, Bollinger Bands)
- [ ] Machine learning confidence scoring
- [ ] REST API
- [ ] Position sizing recommendations

---

**Migration Date:** November 17, 2025  
**Version:** 2.0.0  
**Status:** ✅ Complete

