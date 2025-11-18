/**
 * High-Confidence Breakout Detector
 * 
 * Detects breakouts using multiple confirmation factors:
 * - Volume surge (3x+ average)
 * - Price breakout above resistance levels
 * - Consolidation pattern (low volatility period before breakout)
 * - Sustained momentum (not just a spike)
 */

import redis from "../utils/redisClient.js";
import candleStreamer, { type ProcessedCandle } from "../stream/candleStreamer.js";
import { info, warn, error as logError } from "../utils/logger.js";
import { notifyBreakout } from "../utils/telegramNotifier.js";

export interface BreakoutSignal {
  coin: string;
  timestamp: number;
  price: number;
  volumeRatio: number; // Current volume / Average volume
  priceChange: number; // Percentage change from resistance level
  consolidationPeriod: number; // Hours of consolidation before breakout
  confidenceScore: number; // 0-100
  resistanceLevel: number;
  breakoutType: "strong" | "moderate" | "weak";
}

export interface BreakoutMetrics {
  coin: string;
  resistanceLevel: number;
  avgVolume: number;
  recentVolume: number;
  consolidationVolatility: number;
  priceChange24h: number;
}

/**
 * Calculate resistance level from recent highs
 */
function calculateResistanceLevel(candles: ProcessedCandle[]): number {
  if (candles.length < 20) {
    return 0;
  }

  // Get last 20 candles, exclude most recent 2 (for breakout comparison)
  const relevantCandles = candles.slice(2, 22);
  const highs = relevantCandles.map(c => c.high);
  
  // Use 95th percentile as resistance
  const sorted = highs.sort((a, b) => a - b);
  const index = Math.floor(sorted.length * 0.95);
  
  return sorted[index] || 0;
}

/**
 * Calculate average volume over a period
 */
function calculateAverageVolume(candles: ProcessedCandle[], period: number = 24): number {
  if (candles.length < period) {
    return 0;
  }

  const relevantCandles = candles.slice(0, period);
  const totalVolume = relevantCandles.reduce((sum, c) => sum + c.volume, 0);
  
  return totalVolume / period;
}

/**
 * Calculate volatility over consolidation period
 */
function calculateConsolidationVolatility(candles: ProcessedCandle[], period: number = 12): number {
  if (candles.length < period) {
    return 0;
  }

  const relevantCandles = candles.slice(1, period + 1); // Exclude most recent
  const prices = relevantCandles.map(c => c.close);
  
  const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  
  // Return coefficient of variation (stdDev / mean)
  return mean > 0 ? stdDev / mean : 0;
}

/**
 * Detect if recent candles show a consolidation pattern
 */
function detectConsolidation(candles: ProcessedCandle[]): number {
  if (candles.length < 12) {
    return 0;
  }

  // Check last 12 hours for consolidation (low volatility)
  const volatility = calculateConsolidationVolatility(candles, 12);
  
  // Low volatility = good consolidation
  // Return consolidation period in hours if volatility is low enough
  if (volatility < 0.02) { // Less than 2% coefficient of variation
    return 12;
  } else if (volatility < 0.03) {
    return 8;
  } else if (volatility < 0.04) {
    return 4;
  }
  
  return 0;
}

/**
 * Calculate confidence score for a breakout
 */
function calculateConfidenceScore(metrics: {
  volumeRatio: number;
  priceChange: number;
  consolidationPeriod: number;
  sustainedMomentum: boolean;
}): number {
  let score = 0;

  // Volume score (0-40 points)
  if (metrics.volumeRatio >= 5) {
    score += 40;
  } else if (metrics.volumeRatio >= 3) {
    score += 30;
  } else if (metrics.volumeRatio >= 2) {
    score += 20;
  } else if (metrics.volumeRatio >= 1.5) {
    score += 10;
  }

  // Price breakout score (0-30 points)
  if (metrics.priceChange >= 5) {
    score += 30;
  } else if (metrics.priceChange >= 3) {
    score += 20;
  } else if (metrics.priceChange >= 2) {
    score += 15;
  } else if (metrics.priceChange >= 1) {
    score += 10;
  }

  // Consolidation score (0-20 points)
  if (metrics.consolidationPeriod >= 12) {
    score += 20;
  } else if (metrics.consolidationPeriod >= 8) {
    score += 15;
  } else if (metrics.consolidationPeriod >= 4) {
    score += 10;
  }

  // Sustained momentum score (0-10 points)
  if (metrics.sustainedMomentum) {
    score += 10;
  }

  return Math.min(score, 100);
}

/**
 * Check if momentum is sustained (not just a spike)
 */
function checkSustainedMomentum(candles: ProcessedCandle[]): boolean {
  if (candles.length < 3) {
    return false;
  }

  // Check if last 2-3 candles all show upward movement
  const recent = candles.slice(0, 3);
  
  let greenCandles = 0;
  for (const candle of recent) {
    if (candle.close > candle.open) {
      greenCandles++;
    }
  }

  return greenCandles >= 2;
}

/**
 * Detect breakout for a single coin
 */
export async function detectBreakoutForCoin(coin: string): Promise<BreakoutSignal | null> {
  try {
    // Get recent candles (last 60 hours)
    const candles = await candleStreamer.getCandles(coin, 60);
    
    if (candles.length < 24) {
      return null; // Not enough data
    }

    const latestCandle = candles[0];
    
    if (!latestCandle) {
      return null; // No latest candle
    }
    
    // Calculate metrics
    const resistanceLevel = calculateResistanceLevel(candles);
    const avgVolume = calculateAverageVolume(candles, 24);
    const consolidationPeriod = detectConsolidation(candles);
    const sustainedMomentum = checkSustainedMomentum(candles);

    // Check if price broke above resistance
    if (latestCandle.close <= resistanceLevel) {
      return null; // No breakout
    }

    // Calculate breakout metrics
    const volumeRatio = avgVolume > 0 ? latestCandle.volume / avgVolume : 0;
    const priceChange = ((latestCandle.close - resistanceLevel) / resistanceLevel) * 100;

    // Require minimum volume surge and price breakout
    if (volumeRatio < 1.5 || priceChange < 1) {
      return null; // Not strong enough
    }

    // Calculate confidence score
    const confidenceScore = calculateConfidenceScore({
      volumeRatio,
      priceChange,
      consolidationPeriod,
      sustainedMomentum,
    });

    // Determine breakout type
    let breakoutType: "strong" | "moderate" | "weak";
    if (confidenceScore >= 75) {
      breakoutType = "strong";
    } else if (confidenceScore >= 50) {
      breakoutType = "moderate";
    } else {
      breakoutType = "weak";
    }

    // Only return high-confidence breakouts (50+)
    if (confidenceScore < 50) {
      return null;
    }

    const signal: BreakoutSignal = {
      coin,
      timestamp: latestCandle.timestamp,
      price: latestCandle.close,
      volumeRatio,
      priceChange,
      consolidationPeriod,
      confidenceScore,
      resistanceLevel,
      breakoutType,
    };

    return signal;
  } catch (err) {
    logError("BreakoutDetector", `Error detecting breakout for ${coin}`, err);
    return null;
  }
}

/**
 * Run breakout detection for all active coins
 */
export async function run(coins: string[]): Promise<BreakoutSignal[]> {
  info("BreakoutDetector", `Running breakout detection for ${coins.length} coins`);

  const signals: BreakoutSignal[] = [];

  for (const coin of coins) {
    try {
      const signal = await detectBreakoutForCoin(coin);
      
      if (signal) {
        // Store signal in Redis
        const key = `breakout:signal:${coin}:${signal.timestamp}`;
        await redis.setex(key, 86400 * 7, JSON.stringify(signal)); // Keep for 7 days

        // Add to active breakouts list
        await redis.zadd("breakouts:active", signal.timestamp, coin);
        
        signals.push(signal);
        
        info(
          "BreakoutDetector",
          `🚀 BREAKOUT DETECTED: ${coin} | Price: $${signal.price.toFixed(4)} | ` +
          `Volume: ${signal.volumeRatio.toFixed(1)}x | Change: +${signal.priceChange.toFixed(1)}% | ` +
          `Confidence: ${signal.confidenceScore}/100 | Type: ${signal.breakoutType.toUpperCase()}`
        );
        
        // Send Telegram notification
        await notifyBreakout(signal);
      }
    } catch (err) {
      logError("BreakoutDetector", `Error processing ${coin}`, err);
    }
  }

  info("BreakoutDetector", `Detected ${signals.length} breakouts`);

  return signals;
}

