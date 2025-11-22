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
import { calculateConfidenceScore } from "../breakout/confidenceModel.js";
import type { AssetClass } from "../assets/assetClassifier.js";
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
    longBreakouts: number;
    shortBreakouts: number;
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

function calculateSupportLevel(candles: ProcessedCandle[]): number {
  if (candles.length < 20) {
    return 0;
  }
  const relevantCandles = candles.slice(2, 22);
  const lows = relevantCandles.map(c => c.low);
  const sorted = lows.sort((a, b) => a - b);
  const index = Math.max(0, Math.floor(sorted.length * 0.05));
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

function checkSustainedBearMomentum(candles: ProcessedCandle[]): boolean {
  if (candles.length < 3) {
    return false;
  }
  const recent = candles.slice(0, 3);
  let redCandles = 0;
  for (const candle of recent) {
    if (candle.close < candle.open) {
      redCandles++;
    }
  }
  return redCandles >= 2;
}

/**
 * Calculate confidence score
 */

function determineBreakoutType(confidenceScore: number): "strong" | "moderate" | "weak" {
  if (confidenceScore >= 75) {
    return "strong";
  }
  if (confidenceScore >= 50) {
    return "moderate";
  }
  return "weak";
}

/**
 * Detect breakout with custom parameters
 */
async function detectBreakoutWithParams(
  coin: string,
  candles: ProcessedCandle[],
  latestCandle: ProcessedCandle,
  params: GridSearchParams
): Promise<BreakoutSignal[]> {
  if (candles.length < 24) {
    return [];
  }

  const signals: BreakoutSignal[] = [];
  const assetClass: AssetClass = "crypto";
  const provider: BreakoutSignal["provider"] = "hyperliquid";
  const resistanceLevel = calculateResistanceLevel(candles);
  const supportLevel = calculateSupportLevel(candles);
  const avgVolume = calculateAverageVolume(candles, 24);
  const consolidationPeriod = detectConsolidation(candles, params.consolidationThresholds);
  const sustainedBullMomentum = checkSustainedMomentum(candles);
  const sustainedBearMomentum = checkSustainedBearMomentum(candles);
  const volumeRatio = avgVolume > 0 ? latestCandle.volume / avgVolume : 0;

  if (latestCandle.close > resistanceLevel && resistanceLevel > 0) {
    const priceChange = ((latestCandle.close - resistanceLevel) / resistanceLevel) * 100;
    if (volumeRatio >= params.minVolumeRatio && priceChange >= params.minPriceChange) {
      const confidenceScore = calculateConfidenceScore(
        {
          volumeRatio,
          priceChange,
          consolidationPeriod,
          sustainedMomentum: sustainedBullMomentum,
        },
        assetClass
      );

      if (confidenceScore >= params.minConfidenceScore) {
        signals.push({
          coin,
          symbol: coin,
          class: assetClass,
          timestamp: latestCandle.timestamp,
          price: latestCandle.close,
          volumeRatio,
          priceChange,
          consolidationPeriod,
          consolidationHours: consolidationPeriod,
          confidenceScore,
          confidence: confidenceScore,
          resistanceLevel,
          direction: "long",
          breakoutType: determineBreakoutType(confidenceScore),
          provider,
        });
      }
    }
  }

  if (supportLevel > 0 && latestCandle.close < supportLevel) {
    const priceChange = ((supportLevel - latestCandle.close) / supportLevel) * 100;
    if (
      priceChange > 0 &&
      volumeRatio >= params.minVolumeRatio &&
      priceChange >= params.minPriceChange
    ) {
      const confidenceScore = calculateConfidenceScore(
        {
          volumeRatio,
          priceChange,
          consolidationPeriod,
          sustainedMomentum: sustainedBearMomentum,
        },
        assetClass
      );

      if (confidenceScore >= params.minConfidenceScore) {
        signals.push({
          coin,
          symbol: coin,
          class: assetClass,
          timestamp: latestCandle.timestamp,
          price: latestCandle.close,
          volumeRatio,
          priceChange,
          consolidationPeriod,
          consolidationHours: consolidationPeriod,
          confidenceScore,
          confidence: confidenceScore,
          supportLevel,
          direction: "short",
          breakoutType: determineBreakoutType(confidenceScore),
          provider,
        });
      }
    }
  }

  return signals;
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
  const isShort = signal.direction === "short";
  
  for (const candle of candlesAfter) {
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
  let longBreakouts = 0;
  let shortBreakouts = 0;
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
          const signalsDetected = await detectBreakoutWithParams(coin, candles, latestCandle, params);
          
          for (const signal of signalsDetected) {
            detectedBreakouts.push(signal);
            if (signal.direction === "short") {
              shortBreakouts++;
            } else {
              longBreakouts++;
            }
            
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
  const strongRatio = totalBreakouts > 0 ? strongBreakouts / totalBreakouts : 0;

  const score = 
    (successRate * 0.4) +                    // 40% weight on success rate
    (Math.min(avgGain24h, 20) * 2) +         // 20% weight on avg gain (capped at 20%)
    (Math.min(totalBreakouts / 100, 1) * 20) + // 20% weight on signal count (normalized)
    (Math.min(strongRatio, 1) * 20); // 20% weight on quality

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
      longBreakouts,
      shortBreakouts,
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

