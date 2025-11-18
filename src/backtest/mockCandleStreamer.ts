/**
 * Mock Candle Streamer
 * 
 * Simulates the candleStreamer interface for backtesting.
 * Uses mock Redis instead of real Redis.
 */

import mockRedis from "./mockRedis.js";
import type { ProcessedCandle } from "../stream/candleStreamer.js";

const MAX_CANDLES_STORED = 60;

class MockCandleStreamer {
  /**
   * Store a candle (simulates the live system's processCandle)
   */
  async storeCandle(candle: ProcessedCandle): Promise<void> {
    const key = `candles:1h:${candle.coin}`;
    const candleJson = JSON.stringify(candle);
    
    await mockRedis.lpush(key, candleJson);
    await mockRedis.ltrim(key, 0, MAX_CANDLES_STORED - 1);
  }

  /**
   * Get recent candles for a coin (same interface as live system)
   */
  async getCandles(coin: string, limit: number = 20): Promise<ProcessedCandle[]> {
    try {
      const key = `candles:1h:${coin}`;
      const candleJsons = await mockRedis.lrange(key, 0, limit - 1);

      return candleJsons
        .filter((json) => json)
        .map((json) => JSON.parse(json as string) as ProcessedCandle);
    } catch (err) {
      return [];
    }
  }

  /**
   * Get the latest candle for a coin
   */
  async getLatestCandle(coin: string): Promise<ProcessedCandle | null> {
    const candles = await this.getCandles(coin, 1);
    return candles[0] || null;
  }

  /**
   * Clear all stored candles
   */
  clear(): void {
    mockRedis.clear();
  }
}

export default new MockCandleStreamer();

