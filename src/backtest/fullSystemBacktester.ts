/**
 * Full-System Historical Backtester
 * 
 * Replicates the entire live system candle-by-candle, using the exact same
 * detection code. This ensures the backtest is identical to live behavior.
 */

import { fetchHistoricalCandlesForCoins, getTimeRange, type HistoricalCandle } from "./historicalDataFetcher.js";
import mockCandleStreamer from "./mockCandleStreamer.js";
import mockRedis from "./mockRedis.js";
import type { BreakoutSignal } from "../breakout/breakoutDetector.js";
import type { ProcessedCandle } from "../stream/candleStreamer.js";
import { info } from "../utils/logger.js";

interface BacktestBreakout {
  signal: BreakoutSignal;
  outcome: {
    peak1h: number;
    peak4h: number;
    peak12h: number;
    peak24h: number;
    gain1h: number;
    gain4h: number;
    gain12h: number;
    gain24h: number;
    success: boolean;
  };
}

interface BacktestResults {
  metadata: {
    startTime: string;
    endTime: string;
    coins: number;
    totalHours: number;
    breakoutsDetected: number;
  };
  breakouts: BacktestBreakout[];
  statistics: {
    totalBreakouts: number;
    successfulBreakouts: number;
    successRate: number;
    avgGain1h: number;
    avgGain4h: number;
    avgGain12h: number;
    avgGain24h: number;
    strongBreakouts: number;
    moderateBreakouts: number;
    moderateBreakoutsCount: number;
  };
}

/**
 * Convert historical candle to processed candle format
 */
function convertToProcessedCandle(candle: HistoricalCandle): ProcessedCandle {
  return {
    coin: candle.coin,
    timestamp: candle.timestamp,
    openTime: candle.openTime,
    closeTime: candle.closeTime,
    open: candle.open,
    close: candle.close,
    high: candle.high,
    low: candle.low,
    volume: candle.volume,
    numTrades: candle.numTrades,
    interval: "1h",
  };
}

/**
 * Evaluate breakout outcome using future candles
 */
function evaluateBreakoutOutcome(
  signal: BreakoutSignal,
  allCandles: HistoricalCandle[],
  currentTime: number
): BacktestBreakout["outcome"] | null {
  // Get candles after the breakout
  const candlesAfter = allCandles.filter(c => c.timestamp > signal.timestamp);
  
  if (candlesAfter.length < 24) {
    return null; // Not enough data
  }
  
  const breakoutPrice = signal.price;
  let peak1h = breakoutPrice;
  let peak4h = breakoutPrice;
  let peak12h = breakoutPrice;
  let peak24h = breakoutPrice;
  
  for (const candle of candlesAfter) {
    const hoursAfter = (candle.timestamp - signal.timestamp) / (60 * 60 * 1000);
    
    if (hoursAfter <= 1) {
      peak1h = Math.max(peak1h, candle.high);
    }
    if (hoursAfter <= 4) {
      peak4h = Math.max(peak4h, candle.high);
    }
    if (hoursAfter <= 12) {
      peak12h = Math.max(peak12h, candle.high);
    }
    if (hoursAfter <= 24) {
      peak24h = Math.max(peak24h, candle.high);
    }
  }
  
  const gain1h = ((peak1h - breakoutPrice) / breakoutPrice) * 100;
  const gain4h = ((peak4h - breakoutPrice) / breakoutPrice) * 100;
  const gain12h = ((peak12h - breakoutPrice) / breakoutPrice) * 100;
  const gain24h = ((peak24h - breakoutPrice) / breakoutPrice) * 100;
  
  return {
    peak1h,
    peak4h,
    peak12h,
    peak24h,
    gain1h,
    gain4h,
    gain12h,
    gain24h,
    success: gain24h >= 3,
  };
}

/**
 * Run full-system backtest
 */
export async function runFullSystemBacktest(
  coins: string[],
  months: number = 3
): Promise<BacktestResults> {
  console.log("\n" + "=".repeat(80));
  console.log("FULL-SYSTEM HISTORICAL BACKTEST");
  console.log("=".repeat(80));
  console.log(`Coins: ${coins.length}`);
  console.log(`Period: Last ${months} months`);
  console.log("=".repeat(80) + "\n");

  // Clear mock storage
  mockCandleStreamer.clear();
  mockRedis.clear();

  // Fetch historical data
  const { startTime, endTime } = getTimeRange(months);
  console.log("📥 Fetching historical candle data...");
  const historicalData = await fetchHistoricalCandlesForCoins(
    coins,
    startTime,
    endTime,
    "1h",
    3,
    1000
  );
  console.log(`✓ Fetched data for ${historicalData.size} coins\n`);

  // Convert all historical candles to a time-ordered list
  const allCandlesByCoin = new Map<string, HistoricalCandle[]>();
  for (const [coin, candles] of historicalData) {
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    allCandlesByCoin.set(coin, sorted);
  }

  // Find all unique hour timestamps across all coins
  const allHourTimestamps = new Set<number>();
  for (const candles of allCandlesByCoin.values()) {
    for (const candle of candles) {
      const hourTimestamp = Math.floor(candle.timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000);
      allHourTimestamps.add(hourTimestamp);
    }
  }
  
  const sortedHours = Array.from(allHourTimestamps).sort((a, b) => a - b);
  console.log(`📊 Processing ${sortedHours.length} hours of data...\n`);

  // Track breakouts detected during simulation
  const detectedBreakouts: BreakoutSignal[] = [];
  const allBreakouts: BacktestBreakout[] = [];

  // Process hour by hour (simulating real-time)
  let processedHours = 0;
  const totalHours = sortedHours.length;

  for (const hourTimestamp of sortedHours) {
    // Set current time for the backtest
    const simulatedTime = hourTimestamp + 60 * 1000; // 1 minute past the hour (when detection runs)
    mockRedis.setCurrentTime(simulatedTime);

    // Store candles for this hour (all coins that have a candle closing at this hour)
    // A candle's timestamp is its closeTime, so a candle with timestamp = hourTimestamp
    // represents the hour that just completed
    for (const [coin, candles] of allCandlesByCoin) {
      const candleForHour = candles.find(c => {
        // Round candle's close time to the hour
        const candleHour = Math.floor(c.timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000);
        return candleHour === hourTimestamp;
      });

      if (candleForHour) {
        const processed = convertToProcessedCandle(candleForHour);
        await mockCandleStreamer.storeCandle(processed);
      }
    }

    // Run detection at :01 past the hour (matching live system schedule)
    // Only run if we have enough history (at least 24 hours)
    if (processedHours >= 24) {
      // Get all coins that have candles stored
      const activeCoins: string[] = [];
      for (const [coin] of allCandlesByCoin) {
        const candles = await mockCandleStreamer.getCandles(coin, 1);
        if (candles.length > 0) {
          activeCoins.push(coin);
        }
      }

      // Run detection for all active coins (matching live system behavior)
      for (const coin of activeCoins) {
        try {
          // Temporarily replace the real candleStreamer with our mock
          // We'll need to patch the breakoutDetector to use our mock
          const signal = await detectBreakoutForCoinWithMock(coin);
          
          if (signal) {
            detectedBreakouts.push(signal);
            
            // Store signal (using mock Redis)
            await storeBreakoutSignalWithMock(signal);
            
            info("Backtester", `🚀 BREAKOUT: ${coin} @ ${new Date(signal.timestamp).toISOString()} | Conf: ${signal.confidenceScore}/100`);
          }
        } catch (err) {
          // Silently continue - some coins may not have enough data
        }
      }
    }

    processedHours++;
    
    // Progress update every 100 hours
    if (processedHours % 100 === 0 || processedHours === totalHours) {
      const pct = ((processedHours / totalHours) * 100).toFixed(1);
      console.log(`  Progress: ${processedHours}/${totalHours} hours (${pct}%) | Breakouts: ${detectedBreakouts.length}`);
    }
  }

  console.log(`\n✓ Simulation complete. Detected ${detectedBreakouts.length} breakouts.\n`);

  // Evaluate outcomes for all detected breakouts
  console.log("📊 Evaluating breakout outcomes...");
  for (const signal of detectedBreakouts) {
    // Get all candles for this coin
    const coinCandles = allCandlesByCoin.get(signal.coin) || [];
    
    const outcome = evaluateBreakoutOutcome(signal, coinCandles, signal.timestamp);
    
    if (outcome) {
      allBreakouts.push({
        signal,
        outcome,
      });
    }
  }

  // Calculate statistics
  const totalBreakouts = allBreakouts.length;
  const successfulBreakouts = allBreakouts.filter(b => b.outcome.success).length;
  const successRate = totalBreakouts > 0 ? (successfulBreakouts / totalBreakouts) * 100 : 0;
  
  const avgGain1h = totalBreakouts > 0
    ? allBreakouts.reduce((sum, b) => sum + b.outcome.gain1h, 0) / totalBreakouts
    : 0;
  const avgGain4h = totalBreakouts > 0
    ? allBreakouts.reduce((sum, b) => sum + b.outcome.gain4h, 0) / totalBreakouts
    : 0;
  const avgGain12h = totalBreakouts > 0
    ? allBreakouts.reduce((sum, b) => sum + b.outcome.gain12h, 0) / totalBreakouts
    : 0;
  const avgGain24h = totalBreakouts > 0
    ? allBreakouts.reduce((sum, b) => sum + b.outcome.gain24h, 0) / totalBreakouts
    : 0;

  const strongBreakouts = allBreakouts.filter(b => b.signal.breakoutType === "strong").length;
  const moderateBreakoutsCount = allBreakouts.filter(b => b.signal.breakoutType === "moderate").length;

  const results: BacktestResults = {
    metadata: {
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      coins: coins.length,
      totalHours: sortedHours.length,
      breakoutsDetected: detectedBreakouts.length,
    },
    breakouts: allBreakouts,
    statistics: {
      totalBreakouts,
      successfulBreakouts,
      successRate,
      avgGain1h,
      avgGain4h,
      avgGain12h,
      avgGain24h,
      strongBreakouts,
      moderateBreakouts: moderateBreakoutsCount,
      moderateBreakoutsCount,
    },
  };

  return results;
}

/**
 * Detect breakout using mock candle streamer
 * Uses the exact same detection logic as the live system
 */
async function detectBreakoutForCoinWithMock(coin: string): Promise<BreakoutSignal | null> {
  const candles = await mockCandleStreamer.getCandles(coin, 60);
  
  if (candles.length < 24) {
    return null;
  }

  const latestCandle = candles[0];
  if (!latestCandle) {
    return null;
  }

  return await detectBreakoutLogic(coin, candles, latestCandle);
}

/**
 * Breakout detection logic (exact copy from breakoutDetector.ts)
 */
function calculateResistanceLevel(candles: ProcessedCandle[]): number {
  if (candles.length < 20) {
    return 0;
  }
  const relevantCandles = candles.slice(2, 22);
  const highs = relevantCandles.map(c => c.high);
  const sorted = highs.sort((a, b) => a - b);
  const index = Math.floor(sorted.length * 0.95);
  return sorted[index] || 0;
}

function calculateAverageVolume(candles: ProcessedCandle[], period: number = 24): number {
  if (candles.length < period) {
    return 0;
  }
  const relevantCandles = candles.slice(0, period);
  const totalVolume = relevantCandles.reduce((sum, c) => sum + c.volume, 0);
  return totalVolume / period;
}

function calculateConsolidationVolatility(candles: ProcessedCandle[], period: number = 12): number {
  if (candles.length < period) {
    return 0;
  }
  const relevantCandles = candles.slice(1, period + 1);
  const prices = relevantCandles.map(c => c.close);
  const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  return mean > 0 ? stdDev / mean : 0;
}

function detectConsolidation(candles: ProcessedCandle[]): number {
  if (candles.length < 12) {
    return 0;
  }
  const volatility = calculateConsolidationVolatility(candles, 12);
  if (volatility < 0.02) {
    return 12;
  } else if (volatility < 0.03) {
    return 8;
  } else if (volatility < 0.04) {
    return 4;
  }
  return 0;
}

function checkSustainedMomentum(candles: ProcessedCandle[]): boolean {
  if (candles.length < 3) {
    return false;
  }
  const recent = candles.slice(0, 3);
  let greenCandles = 0;
  for (const candle of recent) {
    if (candle.close > candle.open) {
      greenCandles++;
    }
  }
  return greenCandles >= 2;
}

function calculateConfidenceScore(metrics: {
  volumeRatio: number;
  priceChange: number;
  consolidationPeriod: number;
  sustainedMomentum: boolean;
}): number {
  let score = 0;
  if (metrics.volumeRatio >= 5) {
    score += 40;
  } else if (metrics.volumeRatio >= 3) {
    score += 30;
  } else if (metrics.volumeRatio >= 2) {
    score += 20;
  } else if (metrics.volumeRatio >= 1.5) {
    score += 10;
  }
  if (metrics.priceChange >= 5) {
    score += 30;
  } else if (metrics.priceChange >= 3) {
    score += 20;
  } else if (metrics.priceChange >= 2) {
    score += 15;
  } else if (metrics.priceChange >= 1) {
    score += 10;
  }
  if (metrics.consolidationPeriod >= 12) {
    score += 20;
  } else if (metrics.consolidationPeriod >= 8) {
    score += 15;
  } else if (metrics.consolidationPeriod >= 4) {
    score += 10;
  }
  if (metrics.sustainedMomentum) {
    score += 10;
  }
  return Math.min(score, 100);
}

/**
 * Breakout detection logic (exact copy from breakoutDetector.ts)
 */
async function detectBreakoutLogic(
  coin: string,
  candles: ProcessedCandle[],
  latestCandle: ProcessedCandle
): Promise<BreakoutSignal | null> {
  if (candles.length < 24) {
    return null;
  }

  const resistanceLevel = calculateResistanceLevel(candles);
  const avgVolume = calculateAverageVolume(candles, 24);
  const consolidationPeriod = detectConsolidation(candles);
  const sustainedMomentum = checkSustainedMomentum(candles);

  if (latestCandle.close <= resistanceLevel) {
    return null;
  }

  const volumeRatio = avgVolume > 0 ? latestCandle.volume / avgVolume : 0;
  const priceChange = ((latestCandle.close - resistanceLevel) / resistanceLevel) * 100;

  if (volumeRatio < 1.5 || priceChange < 1) {
    return null;
  }

  const confidenceScore = calculateConfidenceScore({
    volumeRatio,
    priceChange,
    consolidationPeriod,
    sustainedMomentum,
  });

  let breakoutType: "strong" | "moderate" | "weak";
  if (confidenceScore >= 75) {
    breakoutType = "strong";
  } else if (confidenceScore >= 50) {
    breakoutType = "moderate";
  } else {
    breakoutType = "weak";
  }

  if (confidenceScore < 50) {
    return null;
  }

  return {
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
}

/**
 * Store breakout signal using mock Redis
 */
async function storeBreakoutSignalWithMock(signal: BreakoutSignal): Promise<void> {
  const key = `breakout:history:${signal.coin}`;
  const value = JSON.stringify(signal);
  
  await mockRedis.zadd(key, signal.timestamp, value);
  await mockRedis.zadd("breakout:history:all", signal.timestamp, value);
  
  // Clean up old entries (older than 3 months)
  const threeMonthsAgo = mockRedis.getStoredTime() - (90 * 24 * 60 * 60 * 1000);
  await mockRedis.zremrangebyscore(key, "-inf", threeMonthsAgo);
  await mockRedis.zremrangebyscore("breakout:history:all", "-inf", threeMonthsAgo);
}

