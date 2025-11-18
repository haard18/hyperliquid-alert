# Changelog

## v2.0.0 - Breakout Detection System (November 2025)

### 🚀 Complete System Overhaul

**Breaking Changes:**
- Completely redesigned from prepump detection to breakout detection
- Removed all prepump, backtest, and advanced modules
- Now focuses on high-confidence price breakouts

### ✨ New Features

**Breakout Detection Engine:**
- Multi-factor confidence scoring (0-100)
- Volume surge detection (1.5x+ average)
- Resistance level calculation using 95th percentile
- Consolidation pattern detection (low volatility periods)
- Sustained momentum checking (multiple green candles)
- Breakout classification: Strong (75+), Moderate (50-74), Weak (<50)

**Historical Tracking:**
- 3-month breakout data storage and analysis
- Automatic outcome evaluation at 1h, 4h, 12h, 24h horizons
- Success rate tracking (3%+ gain within 24h)
- Top performer identification
- Comprehensive statistics reporting

**Data Streaming:**
- Hyperliquid 1-hour candle WebSocket integration
- Automatic market discovery and subscription
- Efficient data storage with Redis TTL
- Automatic reconnection with exponential backoff

### 🗑️ Removed Features

- Prepump detection modules
- Orderbook streaming
- Trades aggregation
- Backtesting framework
- Advanced modules (coin clustering, regime detection, liquidity analysis, weight optimization)
- Metrics computation (imbalance, volatility, spread compression)
- Multi-timeframe aggregation
- Trend detection
- Score persistence
- Confidence calculation (old system)

### 📚 Documentation

- Complete README rewrite with breakout focus
- New quickstart guide (QUICKSTART.md)
- Detailed API documentation
- Troubleshooting guide
- Configuration examples
- Customization instructions

### 🔧 Technical Improvements

- Simplified architecture with fewer dependencies
- Type-safe TypeScript with strict checks
- Redis-based data storage with automatic cleanup
- Cron-based scheduling (hourly detection, 6-hour evaluation, daily stats)
- Comprehensive logging with timestamps and colors
- Graceful shutdown handling

### 📊 Monitoring & Analytics

- Real-time breakout alerts
- Success rate tracking
- Average gain calculation across time horizons
- Breakout type distribution analysis
- Historical performance metrics

### 🎯 Key Metrics

**Detection Criteria:**
- Minimum volume ratio: 1.5x
- Minimum price breakout: 1%
- Minimum confidence: 50/100
- Consolidation detection: <4% volatility
- Sustained momentum: 2+ green candles

**Evaluation Windows:**
- 1 hour peak gain
- 4 hour peak gain
- 12 hour peak gain
- 24 hour peak gain
- Success threshold: 3%+ within 24h

### 🔄 Migration Guide

If upgrading from v1.x (prepump system):

1. **Backup your data:**
   ```bash
   redis-cli SAVE
   ```

2. **Clear old Redis keys:**
   ```bash
   redis-cli FLUSHDB
   ```

3. **Remove old dependencies:**
   ```bash
   rm -rf node_modules dist
   yarn install
   yarn build
   ```

4. **Update scripts:**
   - Old: `node dist/prepumpRunner.js`
   - New: `node dist/breakout/breakoutRunner.js`

5. **Update environment:**
   - No new environment variables required
   - Same Redis connection settings

### 📈 Performance

- Detection: ~1-2ms per coin
- Memory: ~12KB per coin (60 candles)
- WebSocket: Single connection, multiple subscriptions
- Redis: All data with TTL or automatic cleanup

### 🐛 Bug Fixes

- Fixed WebSocket reconnection logic
- Fixed candle data parsing edge cases
- Fixed Redis key expiration
- Fixed TypeScript strict mode errors

### 🔮 Future Roadmap

- [ ] Telegram/Discord notification integrations
- [ ] Real-time dashboard (web UI)
- [ ] Additional technical indicators (RSI, MACD, Bollinger Bands)
- [ ] Machine learning-based confidence scoring
- [ ] Backtesting framework for custom strategies
- [ ] REST API for external integrations
- [ ] Position sizing recommendations
- [ ] Risk management alerts

---

## v1.0.0 - Prepump Detection System (Legacy)

**Note:** This version has been deprecated and completely replaced by v2.0.0.

Features included prepump detection, orderbook analysis, multi-factor scoring, and advanced modules. See git history for details.

