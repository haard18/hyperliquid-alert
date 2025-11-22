/**
 * Model-2: Intraday Signal Storage
 * 
 * Redis storage utilities for intraday signals
 * Key pattern: intraday:signal:{symbol}:{timestamp}
 */

import redis from "./redisClient.js";
import { info, warn } from "./logger.js";
import type { IntradaySignal } from "../breakout/intradayTypes.js";

/**
 * Store intraday signal in Redis
 */
export async function storeIntradaySignal(
  signal: IntradaySignal
): Promise<void> {
  const key = `intraday:signal:${signal.symbol}:${signal.timestamp}`;

  try {
    await redis.setex(key, 86400, JSON.stringify(signal)); // 24h TTL
    info("IntradayStorage", `Stored signal for ${signal.symbol} ${signal.pattern}`);
  } catch (err) {
    warn("IntradayStorage", `Failed to store signal: ${err}`);
  }
}

/**
 * Get recent intraday signals for a symbol
 */
export async function getRecentIntradaySignals(
  symbol: string,
  limit: number = 10
): Promise<IntradaySignal[]> {
  try {
    const pattern = `intraday:signal:${symbol}:*`;
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return [];

    // Sort by timestamp (extracted from key)
    keys.sort((a, b) => {
      const timestampA = parseInt(a.split(":")[3] || "0", 10);
      const timestampB = parseInt(b.split(":")[3] || "0", 10);
      return timestampB - timestampA; // Descending
    });

    const recentKeys = keys.slice(0, limit);
    const values = await redis.mget(...recentKeys);

    const signals: IntradaySignal[] = [];
    for (const value of values) {
      if (value) {
        try {
          signals.push(JSON.parse(value));
        } catch {
          // Skip invalid JSON
        }
      }
    }

    return signals;
  } catch (err) {
    warn("IntradayStorage", `Failed to get signals: ${err}`);
    return [];
  }
}

/**
 * Get all intraday signals within a timeframe
 */
export async function getAllIntradaySignals(
  startTime: number,
  endTime: number
): Promise<IntradaySignal[]> {
  try {
    const pattern = "intraday:signal:*";
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return [];

    const values = await redis.mget(...keys);

    const signals: IntradaySignal[] = [];
    for (const value of values) {
      if (value) {
        try {
          const signal = JSON.parse(value) as IntradaySignal;
          if (signal.timestamp >= startTime && signal.timestamp <= endTime) {
            signals.push(signal);
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    // Sort by timestamp
    signals.sort((a, b) => b.timestamp - a.timestamp);

    return signals;
  } catch (err) {
    warn("IntradayStorage", `Failed to get all signals: ${err}`);
    return [];
  }
}

/**
 * Check if a signal already exists (deduplication)
 */
export async function signalExists(
  symbol: string,
  timestamp: number,
  pattern: string
): Promise<boolean> {
  const key = `intraday:signal:${symbol}:${timestamp}`;

  try {
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (err) {
    warn("IntradayStorage", `Failed to check signal existence: ${err}`);
    return false;
  }
}

/**
 * Get signal count by pattern
 */
export async function getSignalCountByPattern(): Promise<
  Record<string, number>
> {
  try {
    const pattern = "intraday:signal:*";
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return {};

    const values = await redis.mget(...keys);
    const counts: Record<string, number> = {
      micro_breakout: 0,
      volatility_breakout: 0,
      liquidity_trap: 0,
    };

    for (const value of values) {
      if (value) {
        try {
          const signal = JSON.parse(value) as IntradaySignal;
          counts[signal.pattern] = (counts[signal.pattern] || 0) + 1;
        } catch {
          // Skip
        }
      }
    }

    return counts;
  } catch (err) {
    warn("IntradayStorage", `Failed to get pattern counts: ${err}`);
    return {};
  }
}

/**
 * Get signal count by asset class
 */
export async function getSignalCountByClass(): Promise<Record<string, number>> {
  try {
    const pattern = "intraday:signal:*";
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return {};

    const values = await redis.mget(...keys);
    const counts: Record<string, number> = {};

    for (const value of values) {
      if (value) {
        try {
          const signal = JSON.parse(value) as IntradaySignal;
          counts[signal.class] = (counts[signal.class] || 0) + 1;
        } catch {
          // Skip
        }
      }
    }

    return counts;
  } catch (err) {
    warn("IntradayStorage", `Failed to get class counts: ${err}`);
    return {};
  }
}

/**
 * Clear old signals (cleanup)
 */
export async function clearOldIntradaySignals(
  olderThanMs: number = 86400000
): Promise<number> {
  try {
    const pattern = "intraday:signal:*";
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return 0;

    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const key of keys) {
      const timestamp = parseInt(key.split(":")[3] || "0", 10);
      if (now - timestamp > olderThanMs) {
        keysToDelete.push(key);
      }
    }

    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
      info(
        "IntradayStorage",
        `Deleted ${keysToDelete.length} old intraday signals`
      );
    }

    return keysToDelete.length;
  } catch (err) {
    warn("IntradayStorage", `Failed to clear old signals: ${err}`);
    return 0;
  }
}

