# Model-2: Intraday Breakout Detection System

## Overview

Model-2 is a **completely independent** intraday detection engine that runs in parallel with Model-1 (the daily breakout system). It generates high-frequency signals across multiple timeframes and asset classes.

### Key Differences from Model-1

| Feature | Model-1 | Model-2 |
|---------|---------|---------|
| Timeframe | 1h candles | 5m, 15m, 1h |
| Signal Frequency | Low (conservative) | High (20-60+ per day) |
| Min Price Change | 1.5% crypto | 0.3% crypto |
| Min Volume Ratio | 1.2x | 1.1x |
| Success Threshold | 70%+ | 48-55% (realistic intraday) |
| Detection Patterns | 1 (volume + consolidation) | 3 (micro, volatility, trap) |

---

## 🎯 Detection Patterns

### 1. Micro-Breakout (Level-1)
**Most frequent pattern**

**Conditions:**
- Price closes above 80th percentile high (last 20 candles)
- Volume ratio ≥ 1.1x (class-specific)
- Price change ≥ 0.3% (crypto) / 0.1% (forex)
- Consolidation: 2-6 candles
- Momentum: 2+ green candles out of last 3

**Use case:** Quick intraday moves, scalping, momentum continuation

---

### 2. Volatility Compression Breakout
**Highest confidence pattern**

**Conditions:**
- ATR(14) compressed to bottom 20% of last 30 values
- Bollinger Band width < 8% of average
- Volume flat before breakout (±20% of 10-candle avg)
- Breakout: close above/below last 10 highs/lows
- Volume spike ≥ 1.2x on breakout

**Use case:** High-probability squeeze plays, range breakouts

---

### 3. Liquidity Sweep / Trap Detection
**Reversal pattern**

**Bull Trap:**
- Price sweeps previous high by ≥0.2%
- Closes **below** prior high
- Volume spike + compression prior
- **Signal direction:** SHORT (trap reversal)

**Bear Trap:**
- Inverted conditions
- **Signal direction:** LONG (trap reversal)

**Use case:** Fakeout reversals, stop-hunt plays

---

## 🔧 Configuration

### Class-Specific Thresholds

| Asset Class | Min VR | Min PC | Min Conf | ATR Compression | Signals/Day |
|-------------|--------|--------|----------|-----------------|-------------|
| Crypto      | 1.1    | 0.3%   | 45       | 20%             | 20-60       |
| Forex       | 1.05   | 0.1%   | 40       | 15%             | 10-20       |
| Metal       | 1.05   | 0.15%  | 40       | 18%             | 3-8         |
| Oil         | 1.15   | 0.20%  | 50       | 25%             | 5-10        |
| US Stock    | 1.10   | 0.25%  | 50       | 22%             | 15-30       |
| IN Stock    | 1.10   | 0.25%  | 50       | 22%             | 15-30       |

---

## 🚀 Quick Start

### Installation

Model-2 uses the same dependencies as Model-1. If you've already set up the project, you're ready to go.

```bash
# Install dependencies (if not done)
npm install

# Build TypeScript
npm run build
```

### Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Optional (backtesting)
BACKTEST_DAYS=30
BACKTEST_SYMBOLS=BTC,ETH,SOL,ARB
```

---

## 📊 Running Model-2

### Option 1: Production Mode (All Timeframes)

```bash
npm run intraday:start
```

This starts cron jobs for:
- **5m detection:** Every 5 minutes (`*/5 * * * *`)
- **15m detection:** Every 15 minutes (`*/15 * * * *`)
- **1h detection:** Every hour (`0 * * * *`)

### Option 2: Single Timeframe

```bash
# Only 5m
npm run intraday:5m

# Only 15m
npm run intraday:15m

# Only 1h
npm run intraday:1h
```

### Option 3: Test Run (One Cycle)

```bash
# Run detection once for all timeframes
npm run intraday:test

# Test single timeframe
npm run intraday:test 5m
```

### Option 4: Backtest

```bash
# Run full backtest (default: 30 days, 5 symbols)
npm run intraday:backtest
```

---

## 📡 Signal Format

Signals are stored in Redis with key pattern:
```
intraday:signal:{symbol}:{timestamp}
```

### Signal Schema

```typescript
{
  symbol: "BTC",
  class: "crypto",
  timeframe: "5m",
  pattern: "volatility_breakout",
  direction: "long",
  
  price: 43250.5,
  priceChange: 0.45,
  volumeRatio: 1.35,
  consolidation: 4,
  atrCompression: 18.2,
  bbCompression: 6.5,
  
  confidence: 68,
  signalType: "intraday_model",
  timestamp: 1700000000000
}
```

---

## 📬 Telegram Notifications

### Signal Alert Format

```
⚡ INTRADAY BREAKOUT

Symbol: BTC
Class: CRYPTO
Timeframe: 5m
Pattern: VOLATILITY BREAKOUT
Direction: LONG ⬆️
Confidence: 72/100

Price: $43,250.50
Price Change: +0.45%
Volume Ratio: 1.35x
Consolidation: 4 candles
ATR Compression: 18%
BB Compression: 7%

Time: Nov 22, 2025, 10:35:00 AM
```

---

## 🧪 Backtesting

### Running a Backtest

```bash
npm run intraday:backtest
```

### Evaluation Windows

For each signal, we measure:
- **15m gain** (quick scalp)
- **1h gain** (primary metric)
- **4h gain** (swing)
- **EOD gain** (end of day)

### Success Criteria (1h gains)

| Asset Class | Success Threshold |
|-------------|------------------|
| Crypto      | ≥ +0.8%          |
| Forex       | ≥ +0.2%          |
| Metal       | ≥ +0.2%          |
| Oil         | ≥ +0.3%          |
| Stocks      | ≥ +0.5%          |

### Results Format

The backtest produces:
- **Win rate** by pattern, class, timeframe, direction
- **Average gains** at 15m, 1h, 4h, EOD
- **Top 10 setups** ranked by performance
- **Pattern breakdown** (which patterns work best)
- **Class breakdown** (best asset classes)
- **Timeframe breakdown** (5m vs 15m vs 1h)

---

## 📈 Expected Performance (Realistic)

### Crypto (5m/15m)
- **Signals/day:** 20-60
- **Win rate:** 48-55%
- **Avg 1h gain:** 0.4-1.2%
- **Avg 4h gain:** 1-3%

### Forex
- **Signals/day:** 10-20
- **Win rate:** 45-52%
- **Avg 1h gain:** 0.1-0.25%

### Metals (Gold/Silver)
- **Signals/day:** 3-8
- **Win rate:** 50-60% (very stable)
- **Avg 1h gain:** 0.2-0.5%

### Oil
- **Signals/day:** 5-10
- **Win rate:** 45-52%
- **Avg 1h gain:** 0.3-0.7%

### US/Indian Stocks
- **Signals/day:** 15-30
- **Win rate:** 48-55%
- **Avg 1h gain:** 0.5-1.0%

---

## 🛠️ Architecture

### File Structure

```
src/
├── breakout/
│   ├── intradayDetector.ts          # Core detection logic
│   ├── intradayRunner.ts            # Production runner
│   ├── intradayClassConfig.ts       # Thresholds per asset class
│   ├── intradayConfidenceModel.ts   # Confidence scoring
│   └── intradayTypes.ts             # Type definitions
├── backtest/
│   ├── intradayBacktester.ts        # Backtesting engine
│   └── intradayBacktestRunner.ts    # Backtest orchestration
├── cron/
│   └── intradayScheduler.ts         # Cron job definitions
├── utils/
│   ├── intradayStorage.ts           # Redis storage
│   └── telegramNotifier.ts          # (extended for Model-2)
└── intradayMain.ts                  # Entry point
```

### Key Components

1. **Detector:** Runs pattern detection algorithms
2. **Confidence Model:** Scores signals 0-100 with weighted factors
3. **Storage:** Redis with 24h TTL for signals
4. **Scheduler:** Node-cron for 5m/15m/1h cycles
5. **Backtester:** Historical evaluation with multiple time horizons

---

## 🔍 Confidence Scoring

### Weighted Components
- **Breakout Strength:** 35%
- **Volume Spike:** 25%
- **Compression Strength:** 20%
- **Momentum Streak:** 20%

### Pattern Modifiers
- **Volatility Breakout:** +10% bonus
- **Liquidity Trap:** +5% bonus
- **Micro-Breakout:** No modifier

---

## 🚨 Important Notes

### ✅ DO
- Run Model-2 independently from Model-1
- Use for intraday/scalping strategies
- Monitor multiple timeframes
- Backtest before live trading
- Adjust thresholds per your risk tolerance

### ❌ DON'T
- Mix Model-1 and Model-2 signals
- Expect Model-1 success rates (70%+)
- Overtrade on every signal
- Ignore asset class differences
- Run without backtesting first

---

## 🔧 Customization

### Change Detection Frequency

Edit `src/cron/intradayScheduler.ts`:

```typescript
// Every 3 minutes instead of 5
const job5m = cron.schedule("*/3 * * * *", ...);
```

### Add New Symbols

Edit `src/breakout/intradayRunner.ts`:

```typescript
export function getDefaultCryptoSymbols(): string[] {
  return [
    "BTC", "ETH", "SOL",
    "YOUR_NEW_SYMBOL"
  ];
}
```

### Adjust Thresholds

Edit `src/breakout/intradayClassConfig.ts`:

```typescript
crypto: {
  minVolumeRatio: 1.2,  // More conservative
  minPriceChange: 0.5,  // Bigger moves only
  minConfidence: 55,    // Higher confidence
  ...
}
```

---

## 📞 Support & Troubleshooting

### Common Issues

**No signals generated:**
- Check if data is being fetched (logs)
- Verify thresholds aren't too strict
- Ensure symbols are valid

**Too many signals:**
- Increase `minConfidence` thresholds
- Increase `minVolumeRatio` or `minPriceChange`
- Filter by pattern type

**Backtest fails:**
- Check Hyperliquid API rate limits
- Verify date range isn't too large
- Ensure symbols have historical data

### Logs

Check application logs:
```bash
tail -f logs/app-$(date +%Y-%m-%d).log
```

---

## 🎯 Next Steps

1. **Run a backtest** to understand baseline performance
2. **Start with test mode** to see live signals without commitment
3. **Monitor 5m timeframe** first (highest frequency)
4. **Compare results** across patterns and asset classes
5. **Adjust thresholds** based on your strategy

---

## 📝 Version

**Model-2 Version:** 1.0.0  
**Last Updated:** November 22, 2025  
**Compatibility:** Works alongside Model-1 with zero conflicts

