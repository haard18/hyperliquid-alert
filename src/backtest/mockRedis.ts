/**
 * In-Memory Redis Simulator
 * 
 * Simulates Redis operations used by the live system for backtesting.
 * This allows us to use the exact same detection code without needing Redis.
 */

import type { ProcessedCandle } from "../stream/candleStreamer.js";
import type { BreakoutSignal } from "../breakout/breakoutDetector.js";

class MockRedis {
  private data: Map<string, any> = new Map();
  private sortedSets: Map<string, Array<{ score: number; value: string }>> = new Map();
  private expirations: Map<string, number> = new Map();

  /**
   * Simulate LPUSH - add to front of list
   */
  async lpush(key: string, ...values: string[]): Promise<number> {
    const list = this.data.get(key) || [];
    values.reverse().forEach(v => list.unshift(v));
    this.data.set(key, list);
    return list.length;
  }

  /**
   * Simulate LTRIM - keep only first N elements
   */
  async ltrim(key: string, start: number, stop: number): Promise<"OK"> {
    const list = this.data.get(key) || [];
    const trimmed = list.slice(start, stop + 1);
    this.data.set(key, trimmed);
    return "OK";
  }

  /**
   * Simulate LRANGE - get range of list elements
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.data.get(key) || [];
    return list.slice(start, stop + 1);
  }

  /**
   * Simulate SETEX - set with expiration
   */
  async setex(key: string, seconds: number, value: string): Promise<"OK"> {
    this.data.set(key, value);
    this.expirations.set(key, Date.now() + seconds * 1000);
    return "OK";
  }

  /**
   * Simulate GET - get value
   */
  async get(key: string): Promise<string | null> {
    const expiration = this.expirations.get(key);
    if (expiration && Date.now() > expiration) {
      this.data.delete(key);
      this.expirations.delete(key);
      return null;
    }
    return this.data.get(key) || null;
  }

  /**
   * Simulate ZADD - add to sorted set
   */
  async zadd(key: string, score: number, value: string): Promise<number> {
    let set = this.sortedSets.get(key);
    if (!set) {
      set = [];
      this.sortedSets.set(key, set);
    }
    
    // Remove existing entry with same value
    const existingIndex = set.findIndex(e => e.value === value);
    if (existingIndex >= 0) {
      set.splice(existingIndex, 1);
    }
    
    // Add new entry
    set.push({ score, value });
    set.sort((a, b) => a.score - b.score);
    
    return set.length;
  }

  /**
   * Simulate ZRANGEBYSCORE - get range by score
   */
  async zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]> {
    const set = this.sortedSets.get(key) || [];
    const minScore = min === "-inf" ? -Infinity : (typeof min === "string" ? parseFloat(min) : min);
    const maxScore = max === "+inf" ? Infinity : (typeof max === "string" ? parseFloat(max) : max);
    
    return set
      .filter(e => e.score >= minScore && e.score <= maxScore)
      .map(e => e.value);
  }

  /**
   * Simulate ZREMRANGEBYSCORE - remove range by score
   */
  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    const set = this.sortedSets.get(key);
    if (!set) return 0;
    
    const minScore = min === "-inf" ? -Infinity : (typeof min === "string" ? parseFloat(min) : min);
    const maxScore = max === "+inf" ? Infinity : (typeof max === "string" ? parseFloat(max) : max);
    
    const originalLength = set.length;
    const filtered = set.filter(e => !(e.score >= minScore && e.score <= maxScore));
    this.sortedSets.set(key, filtered);
    
    return originalLength - filtered.length;
  }

  /**
   * Simulate KEYS - get all keys matching pattern
   */
  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    const allKeys = Array.from(this.data.keys());
    return allKeys.filter(key => regex.test(key));
  }

  /**
   * Clear all data (for resetting between backtests)
   */
  clear(): void {
    this.data.clear();
    this.sortedSets.clear();
    this.expirations.clear();
  }

  /**
   * Get current time for the backtest (can be overridden)
   */
  getCurrentTime(): number {
    return Date.now();
  }

  /**
   * Set current time for the backtest (allows time travel)
   */
  setCurrentTime(time: number): void {
    // Store in a special key
    this.data.set("__current_time__", time.toString());
  }

  /**
   * Get stored current time
   */
  getStoredTime(): number {
    const stored = this.data.get("__current_time__");
    return stored ? parseInt(stored, 10) : Date.now();
  }
}

export default new MockRedis();

