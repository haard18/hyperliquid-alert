/**
 * Grid Search for Breakout Detection Parameters
 * 
 * Tests different parameter combinations to find optimal settings
 */

import { discoverMarkets } from "../cron/discoverMarkets.js";
import { fetchHistoricalCandlesForCoins, getTimeRange, type HistoricalCandle } from "./historicalDataFetcher.js";
import mockCandleStreamer from "./mockCandleStreamer.js";
import mockRedis from "./mockRedis.js";
import type { BreakoutSignal } from "../breakout/breakoutDetector.js";
import type { ProcessedCandle } from "../stream/candleStreamer.js";
import { info } from "../utils/logger.js";

export interface GridSearchParams {
  minVolumeRatio: number;
  minPriceChange: number;
  minConfidenceScore: number;
  consolidationThresholds: {
    high: number;  // 12h consolidation threshold
    medium: number; // 8h consolidation threshold
    low: number;   // 4h consolidation threshold
  };
  successThreshold: number; // % gain to consider success
}

export interface GridSearchResult {
  params: GridSearchParams;
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
    totalSignals: number; // Total signals before filtering
  };
  score: number; // Combined score for ranking
}

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
 * Calculate resistance level from recent highs
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

/**
 * Calculate average volume
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
 * Calculate consolidation volatility
 */
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

/**
 * Detect consolidation with custom thresholds
 */
function detectConsolidation(
  candles: ProcessedCandle[],
  thresholds: GridSearchParams["consolidationThresholds"]
): number {
  if (candles.length < 12) {
    return 0;
  }
  const volatility = calculateConsolidationVolatility(candles, 12);
  
  if (volatility < thresholds.high) {
    return 12;
  } else if (volatility < thresholds.medium) {
    return 8;
  } else if (volatility < thresholds.low) {
    return 4;
  }
  return 0;
}

/**
 * Check sustained momentum
 */
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

/**
 * Calculate confidence score
 */
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
 * Detect breakout with custom parameters
 */
async function detectBreakoutWithParams(
  coin: string,
  candles: ProcessedCandle[],
  latestCandle: ProcessedCandle,
  params: GridSearchParams
): Promise<BreakoutSignal | null> {
  if (candles.length < 24) {
    return null;
  }

  const resistanceLevel = calculateResistanceLevel(candles);
  const avgVolume = calculateAverageVolume(candles, 24);
  const consolidationPeriod = detectConsolidation(candles, params.consolidationThresholds);
  const sustainedMomentum = checkSustainedMomentum(candles);

  if (latestCandle.close <= resistanceLevel) {
    return null;
  }

  const volumeRatio = avgVolume > 0 ? latestCandle.volume / avgVolume : 0;
  const priceChange = ((latestCandle.close - resistanceLevel) / resistanceLevel) * 100;

  // Apply custom thresholds
  if (volumeRatio < params.minVolumeRatio || priceChange < params.minPriceChange) {
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

  // Apply custom confidence threshold
  if (confidenceScore < params.minConfidenceScore) {
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
 * Evaluate breakout outcome
 */
function evaluateBreakoutOutcome(
  signal: BreakoutSignal,
  allCandles: HistoricalCandle[],
  successThreshold: number
): BacktestBreakout["outcome"] | null {
  const candlesAfter = allCandles.filter(c => c.timestamp > signal.timestamp);
  
  if (candlesAfter.length < 24) {
    return null;
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
    success: gain24h >= successThreshold,
  };
}

/**
 * Run backtest with specific parameters
 */
async function runBacktestWithParams(
  coins: string[],
  historicalData: Map<string, HistoricalCandle[]>,
  params: GridSearchParams,
  months: number
): Promise<GridSearchResult> {
  // Clear mock storage
  mockCandleStreamer.clear();
  mockRedis.clear();

  // Convert all historical candles to a time-ordered list
  const allCandlesByCoin = new Map<string, HistoricalCandle[]>();
  for (const [coin, candles] of historicalData) {
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    allCandlesByCoin.set(coin, sorted);
  }

  // Find all unique hour timestamps
  const allHourTimestamps = new Set<number>();
  for (const candles of allCandlesByCoin.values()) {
    for (const candle of candles) {
      const hourTimestamp = Math.floor(candle.timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000);
      allHourTimestamps.add(hourTimestamp);
    }
  }
  
  const sortedHours = Array.from(allHourTimestamps).sort((a, b) => a - b);

  const detectedBreakouts: BreakoutSignal[] = [];
  const allBreakouts: BacktestBreakout[] = [];
  let totalSignals = 0;

  // Process hour by hour
  let processedHours = 0;
  for (const hourTimestamp of sortedHours) {
    const simulatedTime = hourTimestamp + 60 * 1000;
    mockRedis.setCurrentTime(simulatedTime);

    // Store candles for this hour
    for (const [coin, candles] of allCandlesByCoin) {
      const candleForHour = candles.find(c => {
        const candleHour = Math.floor(c.timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000);
        return candleHour === hourTimestamp;
      });

      if (candleForHour) {
        const processed = convertToProcessedCandle(candleForHour);
        await mockCandleStreamer.storeCandle(processed);
      }
    }

    // Run detection at :01 past the hour
    if (processedHours >= 24) {
      const activeCoins: string[] = [];
      for (const [coin] of allCandlesByCoin) {
        const candles = await mockCandleStreamer.getCandles(coin, 1);
        if (candles.length > 0) {
          activeCoins.push(coin);
        }
      }

      for (const coin of activeCoins) {
        try {
          const candles = await mockCandleStreamer.getCandles(coin, 60);
          if (candles.length < 24) continue;
          
          const latestCandle = candles[0];
          if (!latestCandle) continue;

          totalSignals++;
          const signal = await detectBreakoutWithParams(coin, candles, latestCandle, params);
          
          if (signal) {
            detectedBreakouts.push(signal);
            
            const coinCandles = allCandlesByCoin.get(coin) || [];
            const outcome = evaluateBreakoutOutcome(signal, coinCandles, params.successThreshold);
            
            if (outcome) {
              allBreakouts.push({ signal, outcome });
            }
          }
        } catch (err) {
          // Continue
        }
      }
    }

    processedHours++;
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
  const moderateBreakouts = allBreakouts.filter(b => b.signal.breakoutType === "moderate").length;

  // Calculate composite score (weighted combination of metrics)
  // Higher is better
  const score = 
    (successRate * 0.4) +                    // 40% weight on success rate
    (Math.min(avgGain24h, 20) * 2) +         // 20% weight on avg gain (capped at 20%)
    (Math.min(totalBreakouts / 100, 1) * 20) + // 20% weight on signal count (normalized)
    (Math.min(strongBreakouts / totalBreakouts, 1) * 20); // 20% weight on quality

  return {
    params,
    statistics: {
      totalBreakouts,
      successfulBreakouts,
      successRate,
      avgGain1h,
      avgGain4h,
      avgGain12h,
      avgGain24h,
      strongBreakouts,
      moderateBreakouts,
      totalSignals,
    },
    score,
  };
}

/**
 * Generate parameter combinations for grid search
 */
export function generateParameterGrid(): GridSearchParams[] {
  const combinations: GridSearchParams[] = [];

  // Define parameter ranges
  const minVolumeRatios = [1.2, 1.5, 2.0, 2.5];
  const minPriceChanges = [0.5, 1.0, 1.5, 2.0];
  const minConfidenceScores = [40, 50, 60, 70];
  const consolidationThresholds = [
    { high: 0.015, medium: 0.025, low: 0.035 },
    { high: 0.020, medium: 0.030, low: 0.040 },
    { high: 0.025, medium: 0.035, low: 0.045 },
  ];
  const successThresholds = [2.0, 3.0, 4.0];

  // Generate all combinations
  for (const volRatio of minVolumeRatios) {
    for (const priceChange of minPriceChanges) {
      for (const confidence of minConfidenceScores) {
        for (const thresholds of consolidationThresholds) {
          for (const success of successThresholds) {
            combinations.push({
              minVolumeRatio: volRatio,
              minPriceChange: priceChange,
              minConfidenceScore: confidence,
              consolidationThresholds: thresholds,
              successThreshold: success,
            });
          }
        }
      }
    }
  }

  return combinations;
}

/**
 * Run grid search
 */
export async function runGridSearch(
  coins: string[],
  months: number = 3,
  maxCombinations?: number
): Promise<GridSearchResult[]> {
  console.log("\n" + "=".repeat(80));
  console.log("GRID SEARCH FOR OPTIMAL PARAMETERS");
  console.log("=".repeat(80));
  console.log(`Coins: ${coins.length}`);
  console.log(`Period: Last ${months} months`);
  console.log("=".repeat(80) + "\n");

  // Fetch historical data once
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

  // Generate parameter combinations
  const allCombinations = generateParameterGrid();
  const combinationsToTest = maxCombinations 
    ? allCombinations.slice(0, maxCombinations)
    : allCombinations;

  console.log(`🔍 Testing ${combinationsToTest.length} parameter combinations...\n`);

  const results: GridSearchResult[] = [];
  let completed = 0;

  for (const params of combinationsToTest) {
    completed++;
    const pct = ((completed / combinationsToTest.length) * 100).toFixed(1);
    
    process.stdout.write(
      `\r  Testing ${completed}/${combinationsToTest.length} (${pct}%) - ` +
      `Vol:${params.minVolumeRatio} Price:${params.minPriceChange} Conf:${params.minConfidenceScore}`
    );

    const result = await runBacktestWithParams(coins, historicalData, params, months);
    results.push(result);
  }

  console.log(`\n\n✓ Grid search complete! Tested ${results.length} combinations\n`);

  // Sort by score (best first)
  results.sort((a, b) => b.score - a.score);

  return results;
}

