# Historical Backtest Guide

## Overview

The historical backtester simulates the breakout detection system on past data to evaluate its real-world performance. It fetches 3 months of 1-hour candles, runs the detection algorithm at each point in time, and measures the outcomes.

## Quick Start

### Run Backtest for Last 3 Months

```bash
node dist/backtest/backtestRunner.js run
```

This will:
1. Discover all active Hyperliquid perpetual markets
2. Fetch 3 months of historical 1h candle data
3. Run breakout detection at each hourly interval
4. Evaluate outcomes (1h, 4h, 12h, 24h gains)
5. Generate comprehensive statistics report
6. Save detailed results to `backtest_results.json`

### Custom Time Periods

```bash
# Last 1 month
node dist/backtest/backtestRunner.js run 1

# Last 6 months
node dist/backtest/backtestRunner.js run 6

# Last 12 months (may take longer)
node dist/backtest/backtestRunner.js run 12
```

## What the Backtest Does

### 1. Historical Data Fetching

For each coin, the system fetches:
- All 1-hour candles for the specified time period
- OHLCV data (Open, High, Low, Close, Volume)
- Number of trades per candle

**Rate Limiting:**
- Fetches 5 coins per batch
- 200ms delay between batches to respect API limits
- Progress shown in real-time

### 2. Breakout Detection Simulation

At each hourly candle (starting from hour 24 to ensure sufficient history):
- Calculates resistance level from previous 20 candles
- Measures average volume over previous 24 hours
- Detects consolidation patterns (low volatility)
- Checks for sustained momentum (green candles)
- Calculates confidence score (0-100)
- Identifies breakouts with 50+ confidence

### 3. Outcome Evaluation

For each detected breakout, tracks:
- **Peak 1h**: Highest price in next 1 hour
- **Peak 4h**: Highest price in next 4 hours
- **Peak 12h**: Highest price in next 12 hours
- **Peak 24h**: Highest price in next 24 hours
- **Gains**: Percentage gain at each horizon
- **Success**: Whether 24h gain exceeded 3%

### 4. Statistical Analysis

Generates comprehensive statistics:
- Total breakouts detected
- Success rate (3%+ gain in 24h)
- Average gains by time horizon
- Breakout quality distribution (strong/moderate/weak)
- Per-coin performance breakdown
- Top 20 best performers
- Bottom 10 worst performers

## Example Output

```
================================================================================
HISTORICAL BACKTEST RESULTS - LAST 3 MONTHS
================================================================================

📊 OVERALL PERFORMANCE
--------------------------------------------------------------------------------
Total Breakouts Detected: 247
Successful (3%+ gain in 24h): 173
Success Rate: 70.0%

📈 AVERAGE GAINS BY TIME HORIZON
--------------------------------------------------------------------------------
  1 Hour:   +1.23%
  4 Hours:  +2.87%
  12 Hours: +4.45%
  24 Hours: +5.89%

🎯 BREAKOUT QUALITY DISTRIBUTION
--------------------------------------------------------------------------------
  Strong (75+ confidence):   74 (30.0%)
  Moderate (50-74):          173 (70.0%)
  Weak (<50, filtered):      0

🏆 TOP 20 BEST BREAKOUTS
--------------------------------------------------------------------------------
   1. SOL        +34.56% | Conf: 82/100 | 10/15/2025 14:05:00
   2. AVAX       +28.34% | Conf: 78/100 | 10/22/2025 09:05:00
   3. ETH        +24.12% | Conf: 85/100 | 11/03/2025 16:05:00
   ...

💰 COIN BREAKDOWN (Top 20 by Avg Gain)
--------------------------------------------------------------------------------
Coin        | Breakouts | Win Rate | Avg 24h Gain
--------------------------------------------------------------------------------
SOL         |         8 |    87.5% | +12.34%
AVAX        |         6 |    83.3% | +10.23%
ETH         |        12 |    75.0% | +8.45%
...

================================================================================
KEY INSIGHTS
================================================================================
✅ EXCELLENT: Success rate above 70% - strategy is highly effective
✅ EXCELLENT: Average 24h gain above 5%
✅ GOOD: 30% of breakouts are strong (75+ confidence)

💡 RECOMMENDATIONS:
  Strategy is performing well. Consider:
  - Focus on strong breakouts for higher conviction trades
  - Monitor per-coin performance to identify best performers

================================================================================
```

## Output Files

### backtest_results.json

Contains detailed results for every breakout:

```json
{
  "metadata": {
    "startTime": "2025-08-17T00:00:00.000Z",
    "endTime": "2025-11-17T00:00:00.000Z",
    "coins": 184,
    "dataPointsAnalyzed": 331200
  },
  "summary": {
    "totalBreakouts": 247,
    "successRate": 70.0,
    "avgGain24h": 5.89,
    ...
  },
  "breakouts": [
    {
      "coin": "BTC",
      "timestamp": "2025-10-15T14:05:00.000Z",
      "price": 43250.50,
      "volumeRatio": 3.2,
      "priceChange": 4.5,
      "consolidationPeriod": 12,
      "confidenceScore": 82,
      "breakoutType": "strong",
      "resistanceLevel": 41450.00,
      "outcome": {
        "peak1h": 43450.00,
        "peak4h": 44200.00,
        "peak12h": 45100.00,
        "peak24h": 45800.00,
        "gain1h": 0.46,
        "gain4h": 2.19,
        "gain12h": 4.28,
        "gain24h": 5.89,
        "success": true
      }
    },
    ...
  ]
}
```

## Performance Interpretation

### Success Rate

- **70%+**: Excellent - Strategy is highly effective
- **60-70%**: Good - Strategy is profitable
- **50-60%**: Moderate - Strategy is viable
- **<50%**: Poor - Consider adjusting parameters

### Average 24h Gain

- **5%+**: Excellent performance
- **3-5%**: Good performance
- **1-3%**: Moderate performance
- **<1%**: Poor performance

### Strong Breakout Percentage

- **30%+**: Good filtering - high quality signals
- **20-30%**: Moderate - consider stricter criteria
- **<20%**: Too noisy - tighten filters

## Optimization Tips

### If Success Rate < 60%

Increase filtering:

```typescript
// In src/breakout/breakoutDetector.ts

// Line 217: Increase minimum requirements
if (volumeRatio < 2.0 || priceChange < 2) {  // Was 1.5 and 1
  return null;
}

// Line 232: Increase confidence threshold
if (confidenceScore < 65) {  // Was 50
  return null;
}
```

### If Average Gain < 3%

Require stronger signals:

```typescript
// Require longer consolidation
if (consolidationPeriod < 8) {
  return null;
}

// Require higher volume
if (volumeRatio < 2.5) {
  return null;
}
```

### Focus on Strong Breakouts Only

```typescript
// Line 232: Only allow strong breakouts
if (breakoutType !== "strong") {
  return null;
}
```

## Limitations

### Data Quality
- Historical data depends on Hyperliquid API availability
- Some older coins may have incomplete data
- Very new coins (< 3 months old) excluded automatically

### Execution Assumptions
- Backtest assumes perfect execution at breakout price
- No slippage or fees included
- No position sizing or risk management

### Market Conditions
- Past performance ≠ future results
- Market regimes change over time
- What worked in past 3 months may not work in next 3 months

## Troubleshooting

### "No data returned for coin"

Some coins may not have historical data available. This is normal and they'll be skipped.

### Rate Limiting Errors

If you get rate limited:
- Increase delay between batches (line 107 in historicalDataFetcher.ts)
- Decrease batch size (line 85 in historicalDataFetcher.ts)
- Run backtest for fewer months

### Out of Memory

For very long backtests (12+ months, 200+ coins):
- Reduce time period
- Process fewer coins at once
- Increase Node.js memory: `NODE_OPTIONS=--max-old-space-size=4096 node dist/backtest/backtestRunner.js run`

## Advanced Usage

### Backtest Specific Coins

Edit `backtestRunner.ts` to test specific coins:

```typescript
// Instead of discovering all coins
const coins = await discoverMarkets();

// Use specific coins
const coins = ["BTC", "ETH", "SOL", "AVAX"];
```

### Custom Success Criteria

Edit `backtester.ts` line 255:

```typescript
// Default: 3% gain = success
success: gain24h >= 3

// More aggressive: 5% gain = success
success: gain24h >= 5

// More lenient: 2% gain = success
success: gain24h >= 2
```

### Export to CSV

Add to `backtestRunner.ts`:

```typescript
// After generating results
const csv = detailedResults.breakouts.map(b => 
  `${b.coin},${b.timestamp},${b.price},${b.confidenceScore},${b.outcome.gain24h}`
).join('\n');

fs.writeFileSync('backtest_results.csv', 
  'Coin,Timestamp,Price,Confidence,Gain24h\n' + csv
);
```

## Time Estimates

Approximate runtime for 180 coins:

- **1 month**: 5-10 minutes
- **3 months**: 15-20 minutes
- **6 months**: 30-40 minutes
- **12 months**: 60+ minutes

Times vary based on:
- Network speed
- Number of active coins
- API response times
- System resources

## Next Steps

After reviewing backtest results:

1. **Adjust Parameters**: Based on statistics, tune thresholds
2. **Focus on Best Coins**: Identify top performers
3. **Optimize Confidence Scoring**: Review weight distribution
4. **Paper Trade**: Test adjusted parameters in real-time
5. **Iterate**: Re-run backtest after changes

## Command Reference

```bash
# Run 3-month backtest (default)
node dist/backtest/backtestRunner.js run

# Run 1-month backtest
node dist/backtest/backtestRunner.js run 1

# Run 6-month backtest
node dist/backtest/backtestRunner.js run 6

# Build before running
yarn build && node dist/backtest/backtestRunner.js run
```

---

**Note**: Always build (`yarn build`) after making changes to TypeScript files before running the backtest.

