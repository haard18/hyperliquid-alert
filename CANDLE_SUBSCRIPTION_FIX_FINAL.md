# Candle Subscription Fix - November 18, 2025

## Problem
The application was not receiving candles from the WebSocket subscription despite being connected and subscribed to markets.

## Root Cause
The Hyperliquid WebSocket has a **hard limit of approximately 15-18 simultaneous candle subscriptions per connection**. When we tried to subscribe to more than this limit:
- The connection would close silently
- No error messages were provided
- Subscriptions appeared to succeed but candles never arrived

## Testing Results
Through systematic testing, we found:
- **3 coins**: ✅ All subscriptions work, candles arrive
- **50 coins**: ❌ Connection closes after ~18 confirmations
- **15 coins**: ✅ All subscriptions confirmed, candles arrive reliably

## Fix Applied

### 1. Updated Subscription Limit
```typescript
const MAX_ACTIVE_SUBSCRIPTIONS = 15; // Down from 50
```

### 2. Slowed Subscription Rate
```typescript
private readonly BATCH_SUBSCRIBE_DELAY = 150; // Up from 100ms
```

### 3. Improved Logging
Added console output to show:
- When subscriptions are being sent
- Confirmation status
- When live candles arrive
- Clear indication of subscription success/failure

## Current Behavior
The system now:
1. Discovers all 184 active markets
2. Subscribes to the **top 15 coins** only
3. Rotates subscriptions every hour to monitor different coins
4. Successfully receives candles for all subscribed coins
5. Triggers breakout detection when new hourly candles arrive

## Verification
Run the test scripts to verify:

```bash
# Test single simple subscription (3 coins)
npx tsx src/testCandleSubscription.ts

# Test safe subscription limit (15 coins)
npx tsx src/testSafeSubscription.ts

# Test over-subscription failure (50 coins)
npx tsx src/testMultiCoinSubscription.ts
```

## Future Improvements
To monitor all 184 markets, we could:
1. **Multiple WebSocket connections**: Create 12-13 connections (184÷15)
2. **Faster rotation**: Rotate subscriptions more frequently (every 15-30 minutes)
3. **Priority-based monitoring**: Keep high-volume coins always subscribed, rotate others
4. **REST API polling**: Use REST API for coins not actively subscribed

## Expected Output
When working correctly, you should see:
```
🔌 Connecting to WebSocket: wss://api.hyperliquid.xyz/ws
✅ WebSocket connection established

📡 Subscribing to 15 coins (max: 15)...
   → Subscribing to BTC...
   → Subscribing to ETH...
   [... more subscriptions ...]

✅ Subscription requests sent. Requested: 15, Confirmed: 0
✓ Subscription confirmed: BTC 1h (1/15)
✓ Subscription confirmed: ETH 1h (2/15)
[... more confirmations ...]

✅ All 15 subscriptions confirmed!

[At the top of each hour]
📊 [9:00:00 AM] LIVE CANDLE: BTC | Close: 91347.0 | Vol: 1823 | Trades: 26436
📊 [9:00:00 AM] LIVE CANDLE: ETH | Close: 3064.0 | Vol: 30637 | Trades: 11308
[... candles from all 15 coins ...]

🔍 Triggering detection for 15 coins with new candles
```

## Notes
- The 15-coin limit is a Hyperliquid API limitation, not a bug in our code
- Candles arrive at the **top of each hour** (8:00, 9:00, 10:00, etc.)
- The WebSocket sends **real-time updates** during the hour (updating volume/price)
- Detection only triggers on **completed hourly candles**
