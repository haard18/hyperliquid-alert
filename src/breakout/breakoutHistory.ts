/**
 * Breakout History Tracker
 * 
 * Tracks all breakouts over the past 3 months for analysis and backtesting.
 * Provides statistics on breakout success rates, best performers, and patterns.
 */

import redis from "../utils/redisClient.js";
import { type BreakoutSignal } from "./breakoutDetector.js";
import { info, error as logError } from "../utils/logger.js";
import candleStreamer from "../stream/candleStreamer.js";

export interface BreakoutOutcome {
  signal: BreakoutSignal;
  outcome: {
    peak1h: number; // Peak price within 1 hour
    peak4h: number; // Peak price within 4 hours
    peak12h: number; // Peak price within 12 hours
    peak24h: number; // Peak price within 24 hours
    gain1h: number; // % gain at 1h
    gain4h: number; // % gain at 4h
    gain12h: number; // % gain at 12h
    gain24h: number; // % gain at 24h
    success: boolean; // Did it gain 3%+ within 24h?
    evaluatedAt: number;
  };
}

export interface BreakoutStats {
  totalBreakouts: number;
  successfulBreakouts: number;
  successRate: number;
  avgGain1h: number;
  avgGain4h: number;
  avgGain12h: number;
  avgGain24h: number;
  strongBreakouts: number;
  moderateBreakouts: number;
  weakBreakouts: number;
  topPerformers: Array<{ coin: string; gain: number; timestamp: number }>;
}

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Store a breakout signal in history
 */
export async function storeBreakoutSignal(signal: BreakoutSignal): Promise<void> {
  try {
    const key = `breakout:history:${signal.coin}`;
    const value = JSON.stringify(signal);
    
    // Add to coin-specific sorted set (sorted by timestamp)
    await redis.zadd(key, signal.timestamp, value);
    
    // Also add to global breakout history
    await redis.zadd("breakout:history:all", signal.timestamp, value);
    
    // Clean up old entries (older than 3 months)
    const threeMonthsAgo = Date.now() - THREE_MONTHS_MS;
    await redis.zremrangebyscore(key, "-inf", threeMonthsAgo);
    await redis.zremrangebyscore("breakout:history:all", "-inf", threeMonthsAgo);
    
    info("BreakoutHistory", `Stored breakout signal for ${signal.coin}`);
  } catch (err) {
    logError("BreakoutHistory", `Error storing signal for ${signal.coin}`, err);
  }
}

/**
 * Get breakout history for a specific coin
 */
export async function getBreakoutHistoryForCoin(
  coin: string,
  daysBack: number = 90
): Promise<BreakoutSignal[]> {
  try {
    const key = `breakout:history:${coin}`;
    const cutoffTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    
    const results = await redis.zrangebyscore(key, cutoffTime, "+inf");
    
    return results
      .map(r => {
        try {
          return JSON.parse(r as string) as BreakoutSignal;
        } catch {
          return null;
        }
      })
      .filter((s): s is BreakoutSignal => s !== null);
  } catch (err) {
    logError("BreakoutHistory", `Error getting history for ${coin}`, err);
    return [];
  }
}

/**
 * Get all breakouts in the last N days
 */
export async function getAllBreakouts(daysBack: number = 90): Promise<BreakoutSignal[]> {
  try {
    const cutoffTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    
    const results = await redis.zrangebyscore("breakout:history:all", cutoffTime, "+inf");
    
    return results
      .map(r => {
        try {
          return JSON.parse(r as string) as BreakoutSignal;
        } catch {
          return null;
        }
      })
      .filter((s): s is BreakoutSignal => s !== null);
  } catch (err) {
    logError("BreakoutHistory", "Error getting all breakouts", err);
    return [];
  }
}

/**
 * Evaluate breakout outcomes (to be run periodically)
 */
export async function evaluateBreakoutOutcomes(): Promise<void> {
  try {
    info("BreakoutHistory", "Evaluating breakout outcomes...");
    
    // Get all breakouts from last 7 days that haven't been evaluated yet
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    const breakouts = await getAllBreakouts(7);
    
    // Filter to only breakouts that are 24h+ old but not yet evaluated
    const toEvaluate = breakouts.filter(b => 
      b.timestamp < oneDayAgo && b.timestamp > sevenDaysAgo
    );
    
    info("BreakoutHistory", `Found ${toEvaluate.length} breakouts to evaluate`);
    
    for (const signal of toEvaluate) {
      // Check if already evaluated
      const outcomeKey = `breakout:outcome:${signal.coin}:${signal.timestamp}`;
      const existing = await redis.get(outcomeKey);
      
      if (existing) {
        continue; // Already evaluated
      }
      
      // Get candles from the breakout time onward
      const allCandles = await candleStreamer.getCandles(signal.coin, 168); // Last 7 days
      
      // Filter to candles after the breakout
      const candlesAfterBreakout = allCandles.filter(c => c.timestamp >= signal.timestamp);
      
      if (candlesAfterBreakout.length < 24) {
        continue; // Not enough data yet
      }
      
      // Calculate peaks at different time horizons
      const breakoutPrice = signal.price;
      
      let peak1h = breakoutPrice;
      let peak4h = breakoutPrice;
      let peak12h = breakoutPrice;
      let peak24h = breakoutPrice;
      const isShort = signal.direction === "short";
      
      for (let i = 0; i < candlesAfterBreakout.length; i++) {
        const candle = candlesAfterBreakout[i];
        if (!candle) continue;
        
        const hoursAfter = (candle.timestamp - signal.timestamp) / (60 * 60 * 1000);
        const comparisonValue = isShort ? candle.low : candle.high;
        
        if (hoursAfter <= 1) {
          peak1h = isShort ? Math.min(peak1h, comparisonValue) : Math.max(peak1h, comparisonValue);
        }
        if (hoursAfter <= 4) {
          peak4h = isShort ? Math.min(peak4h, comparisonValue) : Math.max(peak4h, comparisonValue);
        }
        if (hoursAfter <= 12) {
          peak12h = isShort ? Math.min(peak12h, comparisonValue) : Math.max(peak12h, comparisonValue);
        }
        if (hoursAfter <= 24) {
          peak24h = isShort ? Math.min(peak24h, comparisonValue) : Math.max(peak24h, comparisonValue);
        }
      }
      
      const gain1h = isShort
        ? ((breakoutPrice - peak1h) / breakoutPrice) * 100
        : ((peak1h - breakoutPrice) / breakoutPrice) * 100;
      const gain4h = isShort
        ? ((breakoutPrice - peak4h) / breakoutPrice) * 100
        : ((peak4h - breakoutPrice) / breakoutPrice) * 100;
      const gain12h = isShort
        ? ((breakoutPrice - peak12h) / breakoutPrice) * 100
        : ((peak12h - breakoutPrice) / breakoutPrice) * 100;
      const gain24h = isShort
        ? ((breakoutPrice - peak24h) / breakoutPrice) * 100
        : ((peak24h - breakoutPrice) / breakoutPrice) * 100;
      
      const outcome: BreakoutOutcome = {
        signal,
        outcome: {
          peak1h,
          peak4h,
          peak12h,
          peak24h,
          gain1h,
          gain4h,
          gain12h,
          gain24h,
          success: gain24h >= 3, // Consider 3%+ gain as success
          evaluatedAt: Date.now(),
        },
      };
      
      // Store outcome
      await redis.setex(outcomeKey, 90 * 24 * 60 * 60, JSON.stringify(outcome)); // Keep for 90 days
      
      info(
        "BreakoutHistory",
        `Evaluated ${signal.coin} ${signal.direction.toUpperCase()} breakout: 1h: ${gain1h >= 0 ? "+" : ""}${gain1h.toFixed(1)}%, ` +
        `4h: ${gain4h >= 0 ? "+" : ""}${gain4h.toFixed(1)}%, 12h: ${gain12h >= 0 ? "+" : ""}${gain12h.toFixed(1)}%, ` +
        `24h: ${gain24h >= 0 ? "+" : ""}${gain24h.toFixed(1)}% | Success: ${outcome.outcome.success ? "YES" : "NO"}`
      );
    }
    
    info("BreakoutHistory", "Breakout evaluation complete");
  } catch (err) {
    logError("BreakoutHistory", "Error evaluating outcomes", err);
  }
}

/**
 * Get statistics on breakout performance
 */
export async function getBreakoutStats(daysBack: number = 90): Promise<BreakoutStats> {
  try {
    const cutoffTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    
    // Get all outcomes
    const outcomeKeys = await redis.keys("breakout:outcome:*");
    
    const outcomes: BreakoutOutcome[] = [];
    
    for (const key of outcomeKeys) {
      try {
        const data = await redis.get(key);
        if (data) {
          const outcome = JSON.parse(data as string) as BreakoutOutcome;
          if (outcome.signal.timestamp >= cutoffTime) {
            outcomes.push(outcome);
          }
        }
      } catch {
        continue;
      }
    }
    
    if (outcomes.length === 0) {
      return {
        totalBreakouts: 0,
        successfulBreakouts: 0,
        successRate: 0,
        avgGain1h: 0,
        avgGain4h: 0,
        avgGain12h: 0,
        avgGain24h: 0,
        strongBreakouts: 0,
        moderateBreakouts: 0,
        weakBreakouts: 0,
        topPerformers: [],
      };
    }
    
    const totalBreakouts = outcomes.length;
    const successfulBreakouts = outcomes.filter(o => o.outcome.success).length;
    
    const avgGain1h = outcomes.reduce((sum, o) => sum + o.outcome.gain1h, 0) / totalBreakouts;
    const avgGain4h = outcomes.reduce((sum, o) => sum + o.outcome.gain4h, 0) / totalBreakouts;
    const avgGain12h = outcomes.reduce((sum, o) => sum + o.outcome.gain12h, 0) / totalBreakouts;
    const avgGain24h = outcomes.reduce((sum, o) => sum + o.outcome.gain24h, 0) / totalBreakouts;
    
    const strongBreakouts = outcomes.filter(o => o.signal.breakoutType === "strong").length;
    const moderateBreakouts = outcomes.filter(o => o.signal.breakoutType === "moderate").length;
    const weakBreakouts = outcomes.filter(o => o.signal.breakoutType === "weak").length;
    
    // Get top 10 performers
    const topPerformers = outcomes
      .map(o => ({
        coin: o.signal.coin,
        gain: o.outcome.gain24h,
        timestamp: o.signal.timestamp,
      }))
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 10);
    
    return {
      totalBreakouts,
      successfulBreakouts,
      successRate: (successfulBreakouts / totalBreakouts) * 100,
      avgGain1h,
      avgGain4h,
      avgGain12h,
      avgGain24h,
      strongBreakouts,
      moderateBreakouts,
      weakBreakouts,
      topPerformers,
    };
  } catch (err) {
    logError("BreakoutHistory", "Error calculating stats", err);
    return {
      totalBreakouts: 0,
      successfulBreakouts: 0,
      successRate: 0,
      avgGain1h: 0,
      avgGain4h: 0,
      avgGain12h: 0,
      avgGain24h: 0,
      strongBreakouts: 0,
      moderateBreakouts: 0,
      weakBreakouts: 0,
      topPerformers: [],
    };
  }
}

/**
 * Print breakout statistics
 */
export async function printBreakoutStats(daysBack: number = 90): Promise<void> {
  const stats = await getBreakoutStats(daysBack);
  
  console.log("\n" + "=".repeat(70));
  console.log(`BREAKOUT STATISTICS (Last ${daysBack} days)`);
  console.log("=".repeat(70));
  console.log(`Total Breakouts: ${stats.totalBreakouts}`);
  console.log(`Successful (3%+ gain): ${stats.successfulBreakouts} (${stats.successRate.toFixed(1)}%)`);
  console.log("");
  console.log("Average Gains:");
  console.log(`  1 Hour:  +${stats.avgGain1h.toFixed(2)}%`);
  console.log(`  4 Hours: +${stats.avgGain4h.toFixed(2)}%`);
  console.log(`  12 Hours: +${stats.avgGain12h.toFixed(2)}%`);
  console.log(`  24 Hours: +${stats.avgGain24h.toFixed(2)}%`);
  console.log("");
  console.log("Breakout Types:");
  console.log(`  Strong: ${stats.strongBreakouts}`);
  console.log(`  Moderate: ${stats.moderateBreakouts}`);
  console.log(`  Weak: ${stats.weakBreakouts}`);
  
  if (stats.topPerformers.length > 0) {
    console.log("");
    console.log("Top 10 Performers:");
    stats.topPerformers.forEach((p, i) => {
      const date = new Date(p.timestamp).toLocaleDateString();
      console.log(`  ${i + 1}. ${p.coin}: +${p.gain.toFixed(1)}% (${date})`);
    });
  }
  
  console.log("=".repeat(70) + "\n");
}

/**
 * Run breakout history tracking and evaluation
 */
export async function run(): Promise<void> {
  await evaluateBreakoutOutcomes();
  await printBreakoutStats(90);
}

