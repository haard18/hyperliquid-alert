# Candle Types and Breakout Detection Strategy

## Three Types of Candles

### 1. 📸 **Snapshot Candles** (Historical Data)
**Source:** REST API (`candleSnapshot` endpoint)  
**When:** Fetched once when subscription starts  
**Purpose:** Bootstrap historical data to build baseline for analysis

```typescript
// Fetched via REST API for last 3 hours
const response = await axios.post("https://api.hyperliquid.xyz/info", {
  type: "candleSnapshot",
  req: {
    coin: "BTC",
    interval: "1h",
    startTime: now - 3_hours,
    endTime: now
  }
});
```

**Stored in Redis:** ✅ Yes - added to candle history  
**Triggers Detection:** ❌ No - just historical context  
**Example:** When you subscribe to BTC at 2:30 PM, you get snapshots for 12:00 PM, 1:00 PM, 2:00 PM (completed hours)

---

### 2. 📊 **Live Updates** (Real-Time Current Hour)
**Source:** WebSocket subscription  
**When:** Continuously during the current hour  
**Purpose:** Real-time price/volume tracking (not for detection)

```typescript
// Received every few seconds during current hour
{
  t: 1763456400000,  // 2:00 PM (hour start)
  T: 1763459999999,  // 2:59:59 PM (hour end)
  s: "BTC",
  close: "91250.0",  // Current price (keeps updating)
  volume: "1234",    // Volume so far this hour (keeps growing)
  ...
}
```

**Stored in Redis:** ✅ Yes - overwrites previous live update  
**Triggers Detection:** ❌ No - hour not complete yet  
**Example:** At 2:15 PM, 2:30 PM, 2:45 PM you get updates showing the 2:00-3:00 PM candle building

**Detection Logic:**
```typescript
const now = Date.now();
const isCompletedCandle = processed.closeTime < now;

if (!isCompletedCandle) {
  // This is a live update - just log it, don't trigger detection
  info("CandleStreamer", `📊 Live update ${coin}`);
  return; // Don't trigger detection
}
```

---

### 3. ✅ **Completed Candles** (New Hourly Candle)
**Source:** WebSocket subscription  
**When:** At the start of a new hour (3:00 PM, 4:00 PM, etc.)  
**Purpose:** **THIS IS WHAT TRIGGERS BREAKOUT DETECTION**

```typescript
// Received at 3:00:00 PM for the 2:00-3:00 PM hour
{
  t: 1763456400000,  // 2:00 PM (hour start)
  T: 1763459999999,  // 2:59:59 PM (hour end)
  s: "BTC",
  close: "91350.0",  // Final closing price
  volume: "1879",    // Total volume for the hour
  ...
}
```

**Stored in Redis:** ✅ Yes - added as newest candle  
**Triggers Detection:** ✅ **YES - This triggers breakout analysis**  
**Example:** At exactly 3:00:00 PM, you receive the completed 2:00-3:00 PM candle

**Detection Logic:**
```typescript
const now = Date.now();
const isCompletedCandle = processed.closeTime < now; // closeTime is 2:59:59 PM, now is 3:00:00 PM

if (isCompletedCandle) {
  console.log("✅ COMPLETED CANDLE - Triggering detection!");
  this.candlesReceivedThisHour.add(coin);
  
  // Call callback to trigger breakout detection
  if (this.onCandleCallback) {
    this.onCandleCallback(coin, processed);
  }
}
```

---

## How Breakout Detection Works

### Step 1: Candle Collection (Redis Storage)
All three types are stored in Redis for each coin:

```typescript
const key = `candles:1h:${coin}`;  // e.g., "candles:1h:BTC"
await redis.lpush(key, candleJson); // Add to front of list
await redis.ltrim(key, 0, 59);      // Keep last 60 candles
```

**Redis List Structure:**
```
candles:1h:BTC = [
  { closeTime: 3:00 PM (most recent) },    // Live update OR completed
  { closeTime: 2:00 PM (completed) },      // Completed candle
  { closeTime: 1:00 PM (completed) },      // Snapshot
  { closeTime: 12:00 PM (completed) },     // Snapshot
  ... (up to 60 candles)
]
```

### Step 2: Detection Trigger (Only for Completed Candles)
When a **completed candle** arrives at 3:00 PM:

```typescript
// In index.ts
candleStreamer.onCandle((coin, candle) => {
  console.log(`📊 Completed candle received: ${coin}`);
  candlesReceivedThisHour.add(coin);
  
  // Wait 10 seconds for all coins' candles to arrive
  setTimeout(async () => {
    await runBreakoutDetection();  // Analyze ALL coins
  }, 10000);
});
```

### Step 3: Breakout Analysis
The detector reads from Redis (contains all 3 candle types mixed together):

```typescript
// In breakoutDetector.ts
async function detectBreakoutForCoin(coin: string) {
  // Get last 60 hours of candles (snapshots + completed + latest live update)
  const candles = await candleStreamer.getCandles(coin, 60);
  
  const latestCandle = candles[0];  // Most recent candle
  
  // Calculate historical metrics using ALL stored candles
  const resistanceLevel = calculateResistanceLevel(candles);     // Uses candles[2:22]
  const avgVolume = calculateAverageVolume(candles, 24);         // Uses candles[0:24]
  const consolidationPeriod = detectConsolidation(candles);      // Uses candles[1:13]
  
  // Compare latest candle against historical baseline
  if (latestCandle.close > resistanceLevel) {
    const volumeRatio = latestCandle.volume / avgVolume;
    const priceChange = ((latestCandle.close - resistanceLevel) / resistanceLevel) * 100;
    
    if (volumeRatio >= 1.5 && priceChange >= 1) {
      return breakoutSignal;  // 🚀 BREAKOUT DETECTED!
    }
  }
  
  return null;  // No breakout
}
```

---

## Current Issue & Fix

### Problem
Live updates (📊) were triggering detection during the current hour, causing false signals.

### Solution
Added `isCompletedCandle` check:

```typescript
const now = Date.now();
const isCompletedCandle = processed.closeTime < now;

if (isCompletedCandle) {
  // Only completed candles trigger detection
  this.onCandleCallback(coin, processed);
}
```

---

## Timeline Example: BTC at 2:45 PM

```
Current Time: 2:45 PM

Redis: candles:1h:BTC
┌──────────────────────────────────────┐
│ candles[0]: 2:59:59 PM (Live Update) │ ← Updates every few seconds
│ candles[1]: 1:59:59 PM (Completed)   │ ← Historical (snapshot or previous completed)
│ candles[2]: 12:59:59 PM (Snapshot)   │ ← Fetched via REST API
│ candles[3]: 11:59:59 AM (Snapshot)   │
│ ...                                   │
└──────────────────────────────────────┘

🔍 Detection Status: ❌ WAITING (current hour not complete)
```

**At 3:00:00 PM:**
```
✅ COMPLETED CANDLE ARRIVES!

Redis: candles:1h:BTC (updated)
┌──────────────────────────────────────┐
│ candles[0]: 2:59:59 PM (Completed)   │ ← NEW! Just received
│ candles[1]: 1:59:59 PM (Completed)   │
│ candles[2]: 12:59:59 PM (Snapshot)   │
│ ...                                   │
└──────────────────────────────────────┘

🔍 Detection Status: ✅ TRIGGERED!
```

---

## Summary

| Candle Type | Stored in Redis | Triggers Detection | Purpose |
|-------------|----------------|-------------------|---------|
| 📸 Snapshot | ✅ Yes | ❌ No | Bootstrap historical data |
| 📊 Live Update | ✅ Yes (overwrites) | ❌ No | Real-time monitoring |
| ✅ Completed | ✅ Yes | ✅ **YES** | **Breakout detection** |

**Key Point:** Detection uses ALL candle types from Redis for analysis, but only **completed candles** trigger the detection to run.
