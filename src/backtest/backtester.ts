/**
 * Historical Backtester
 * 
 * Simulates breakout detection on historical data and evaluates performance
 */

import { info, warn, error as logError } from "../utils/logger.js";
import { type HistoricalCandle } from "./historicalDataFetcher.js";
import type { BreakoutSignal } from "../breakout/breakoutDetector.js";
import { calculateConfidenceScore } from "../breakout/confidenceModel.js";
import { CLASS_CONFIG } from "../breakout/breakoutClassConfig.js";
import { classifyAsset, type AssetClass } from "../assets/assetClassifier.js";

interface ProcessedCandle {
  coin: string;
  timestamp: number;
  openTime: number;
  closeTime: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  numTrades: number;
  interval: string;
}

interface BacktestResult {
  breakout: BreakoutSignal;
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

const DEFAULT_MIN_VOLUME_RATIO = 1.5;
const DEFAULT_MIN_PRICE_CHANGE = 1;
const DEFAULT_MIN_CONFIDENCE_SCORE = 50;
const DEFAULT_SUCCESS_THRESHOLD = 3;

/**
 * Calculate resistance level from recent highs
 */
function calculateResistanceLevel(candles: HistoricalCandle[]): number {
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
 * Calculate support level from recent lows (5th percentile)
 */
function calculateSupportLevel(candles: HistoricalCandle[]): number {
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
function calculateAverageVolume(candles: HistoricalCandle[], period: number = 24): number {
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
function calculateConsolidationVolatility(candles: HistoricalCandle[], period: number = 12): number {
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
 * Detect consolidation
 */
function detectConsolidation(candles: HistoricalCandle[]): number {
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

/**
 * Check sustained momentum
 */
function checkSustainedMomentum(candles: HistoricalCandle[]): boolean {
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
 * Check sustained bearish momentum
 */
function checkSustainedBearMomentum(candles: HistoricalCandle[]): boolean {
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
 * Detect breakout at a specific point in time
 */
function detectBreakoutAtTime(
  coin: string,
  allCandles: HistoricalCandle[],
  currentIndex: number
): BreakoutSignal | null {
  // Need at least 24 candles before current
  if (currentIndex < 24) {
    return null;
  }

  // Get candles up to and including current (reversed order, most recent first)
  const candlesUpToCurrent = allCandles.slice(0, currentIndex + 1).reverse();
  
  if (candlesUpToCurrent.length < 24) {
    return null;
  }

  const latestCandle = candlesUpToCurrent[0];
  
  if (!latestCandle) {
    return null;
  }

  const assetClass: AssetClass = latestCandle.assetClass ?? classifyAsset(coin);
  const provider: BreakoutSignal["provider"] = latestCandle.provider ?? "hyperliquid";
  const resistanceLevel = calculateResistanceLevel(candlesUpToCurrent);
  const avgVolume = calculateAverageVolume(candlesUpToCurrent, 24);
  const consolidationPeriod = detectConsolidation(candlesUpToCurrent);
  const sustainedMomentum = checkSustainedMomentum(candlesUpToCurrent);

  if (latestCandle.close <= resistanceLevel) {
    return null;
  }

  const volumeRatio = avgVolume > 0 ? latestCandle.volume / avgVolume : 0;
  const priceChange = ((latestCandle.close - resistanceLevel) / resistanceLevel) * 100;

  if (volumeRatio < DEFAULT_MIN_VOLUME_RATIO || priceChange < DEFAULT_MIN_PRICE_CHANGE) {
    return null;
  }

  const confidenceScore = calculateConfidenceScore(
    {
      volumeRatio,
      priceChange,
      consolidationPeriod,
      sustainedMomentum,
    },
    assetClass
  );

  const breakoutType = determineBreakoutType(confidenceScore);

  if (confidenceScore < DEFAULT_MIN_CONFIDENCE_SCORE) {
    return null;
  }

  return {
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
    breakoutType,
    provider,
  };
}

function detectShortBreakoutAtTime(
  coin: string,
  allCandles: HistoricalCandle[],
  currentIndex: number
): BreakoutSignal | null {
  if (currentIndex < 24) {
    return null;
  }

  const candlesUpToCurrent = allCandles.slice(0, currentIndex + 1).reverse();
  if (candlesUpToCurrent.length < 24) {
    return null;
  }

  const latestCandle = candlesUpToCurrent[0];
  if (!latestCandle) {
    return null;
  }

  const assetClass: AssetClass = latestCandle.assetClass ?? classifyAsset(coin);
  const provider: BreakoutSignal["provider"] = latestCandle.provider ?? "hyperliquid";
  const supportLevel = calculateSupportLevel(candlesUpToCurrent);
  if (supportLevel <= 0) {
    return null;
  }

  if (latestCandle.close >= supportLevel) {
    return null;
  }

  const avgVolume = calculateAverageVolume(candlesUpToCurrent, 24);
  const consolidationPeriod = detectConsolidation(candlesUpToCurrent);
  const sustainedBearMomentum = checkSustainedBearMomentum(candlesUpToCurrent);

  const volumeRatio = avgVolume > 0 ? latestCandle.volume / avgVolume : 0;
  const priceChange = ((supportLevel - latestCandle.close) / supportLevel) * 100;

  if (priceChange <= 0) {
    return null;
  }

  if (volumeRatio < DEFAULT_MIN_VOLUME_RATIO || priceChange < DEFAULT_MIN_PRICE_CHANGE) {
    return null;
  }

  const confidenceScore = calculateConfidenceScore(
    {
      volumeRatio,
      priceChange,
      consolidationPeriod,
      sustainedMomentum: sustainedBearMomentum,
    },
    assetClass
  );

  const breakoutType = determineBreakoutType(confidenceScore);

  if (confidenceScore < DEFAULT_MIN_CONFIDENCE_SCORE) {
    return null;
  }

  return {
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
    breakoutType,
    provider,
  };
}

/**
 * Evaluate breakout outcome
 */
function evaluateBreakoutOutcome(
  breakout: BreakoutSignal,
  allCandles: HistoricalCandle[],
  breakoutIndex: number,
  successThreshold: number = DEFAULT_SUCCESS_THRESHOLD
): BacktestResult | null {
  // Get candles after breakout
  const candlesAfterBreakout = allCandles.slice(0, breakoutIndex).reverse();
  
  if (candlesAfterBreakout.length < 24) {
    return null; // Not enough data to evaluate
  }

  const breakoutPrice = breakout.price;
  const isShort = breakout.direction === "short";
  const windows: [
    { limit: number; peakHigh: number; peakLow: number },
    { limit: number; peakHigh: number; peakLow: number },
    { limit: number; peakHigh: number; peakLow: number },
    { limit: number; peakHigh: number; peakLow: number },
  ] = [
    { limit: 1, peakHigh: breakoutPrice, peakLow: breakoutPrice },
    { limit: 4, peakHigh: breakoutPrice, peakLow: breakoutPrice },
    { limit: 12, peakHigh: breakoutPrice, peakLow: breakoutPrice },
    { limit: 24, peakHigh: breakoutPrice, peakLow: breakoutPrice },
  ];

  for (const candle of candlesAfterBreakout) {
    if (!candle) continue;

    const hoursAfter = (candle.timestamp - breakout.timestamp) / (60 * 60 * 1000);
    for (const window of windows) {
      if (hoursAfter <= window.limit) {
        window.peakHigh = Math.max(window.peakHigh, candle.high);
        window.peakLow = Math.min(window.peakLow, candle.low);
      }
    }
  }

  const gain1hLong = ((windows[0].peakHigh - breakoutPrice) / breakoutPrice) * 100;
  const gain4hLong = ((windows[1].peakHigh - breakoutPrice) / breakoutPrice) * 100;
  const gain12hLong = ((windows[2].peakHigh - breakoutPrice) / breakoutPrice) * 100;
  const gain24hLong = ((windows[3].peakHigh - breakoutPrice) / breakoutPrice) * 100;

  const gain1hShort = ((breakoutPrice - windows[0].peakLow) / breakoutPrice) * 100;
  const gain4hShort = ((breakoutPrice - windows[1].peakLow) / breakoutPrice) * 100;
  const gain12hShort = ((breakoutPrice - windows[2].peakLow) / breakoutPrice) * 100;
  const gain24hShort = ((breakoutPrice - windows[3].peakLow) / breakoutPrice) * 100;

  const gain1h = isShort ? gain1hShort : gain1hLong;
  const gain4h = isShort ? gain4hShort : gain4hLong;
  const gain12h = isShort ? gain12hShort : gain12hLong;
  const gain24h = isShort ? gain24hShort : gain24hLong;

  const assetClass: AssetClass = breakout.class ?? "crypto";
  const classConfig = CLASS_CONFIG[assetClass] ?? CLASS_CONFIG.crypto;
  const successThreshold24h = classConfig.successThreshold24h ?? successThreshold;
  const success = gain24h >= successThreshold24h;

  return {
    breakout,
    outcome: {
      peak1h: isShort ? windows[0].peakLow : windows[0].peakHigh,
      peak4h: isShort ? windows[1].peakLow : windows[1].peakHigh,
      peak12h: isShort ? windows[2].peakLow : windows[2].peakHigh,
      peak24h: isShort ? windows[3].peakLow : windows[3].peakHigh,
      gain1h,
      gain4h,
      gain12h,
      gain24h,
      success,
    },
  };
}

/**
 * Run backtest on historical data for a single coin
 */
export function backtestCoin(
  coin: string,
  candles: HistoricalCandle[]
): BacktestResult[] {
  const results: BacktestResult[] = [];
  
  // Sort candles by time (oldest to newest)
  const sortedCandles = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  
  // Iterate through candles, starting from index 24 (need history)
  for (let i = 24; i < sortedCandles.length - 24; i++) {
    const longBreakout = detectBreakoutAtTime(coin, sortedCandles, i);
    const shortBreakout = detectShortBreakoutAtTime(coin, sortedCandles, i);
    const potentialBreakouts = [longBreakout, shortBreakout].filter(
      (b): b is BreakoutSignal => b !== null
    );

    for (const breakout of potentialBreakouts) {
      const result = evaluateBreakoutOutcome(breakout, sortedCandles, i, DEFAULT_SUCCESS_THRESHOLD);
      if (result) {
        results.push(result);
      }
    }
  }
  
  return results;
}

/**
 * Run backtest on all coins
 */
export function backtestAll(
  historicalData: Map<string, HistoricalCandle[]>
): Map<string, BacktestResult[]> {
  const allResults = new Map<string, BacktestResult[]>();
  let processed = 0;
  
  console.log(`\n🔍 Analyzing ${historicalData.size} coins for breakouts...\n`);
  
  for (const [coin, candles] of historicalData) {
    if (candles.length < 50) {
      continue;
    }
    
    const results = backtestCoin(coin, candles);
    
    if (results.length > 0) {
      allResults.set(coin, results);
      console.log(`  ✓ ${coin.padEnd(10)} - Found ${results.length} breakout(s)`);
    }
    
    processed++;
    if (processed % 20 === 0) {
      const pct = ((processed / historicalData.size) * 100).toFixed(0);
      console.log(`  Progress: ${processed}/${historicalData.size} (${pct}%)`);
    }
  }
  
  console.log(`\n✓ Analysis complete: ${allResults.size} coins with breakouts detected\n`);
  
  return allResults;
}

/**
 * Calculate aggregate statistics
 */
export function calculateStatistics(results: Map<string, BacktestResult[]>): {
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
  longBreakouts: number;
  shortBreakouts: number;
  coinBreakdown: Array<{ coin: string; count: number; winRate: number; avgGain: number }>;
  topPerformers: Array<{ coin: string; gain: number; timestamp: number; confidence: number }>;
  classBreakdown: Record<AssetClass, { count: number; winRate: number; avg24h: number }>;
} {
  const allResults: BacktestResult[] = [];
  
  for (const coinResults of results.values()) {
    allResults.push(...coinResults);
  }
  
  if (allResults.length === 0) {
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
      longBreakouts: 0,
      shortBreakouts: 0,
      coinBreakdown: [],
      topPerformers: [],
      classBreakdown: {
        crypto: { count: 0, winRate: 0, avg24h: 0 },
        forex: { count: 0, winRate: 0, avg24h: 0 },
        metal: { count: 0, winRate: 0, avg24h: 0 },
        oil: { count: 0, winRate: 0, avg24h: 0 },
        us_stock: { count: 0, winRate: 0, avg24h: 0 },
        ind_stock: { count: 0, winRate: 0, avg24h: 0 },
      },
    };
  }
  
  const totalBreakouts = allResults.length;
  const successfulBreakouts = allResults.filter(r => r.outcome.success).length;
  
  const avgGain1h = allResults.reduce((sum, r) => sum + r.outcome.gain1h, 0) / totalBreakouts;
  const avgGain4h = allResults.reduce((sum, r) => sum + r.outcome.gain4h, 0) / totalBreakouts;
  const avgGain12h = allResults.reduce((sum, r) => sum + r.outcome.gain12h, 0) / totalBreakouts;
  const avgGain24h = allResults.reduce((sum, r) => sum + r.outcome.gain24h, 0) / totalBreakouts;
  
  const strongBreakouts = allResults.filter(r => r.breakout.breakoutType === "strong").length;
  const moderateBreakouts = allResults.filter(r => r.breakout.breakoutType === "moderate").length;
  const weakBreakouts = allResults.filter(r => r.breakout.breakoutType === "weak").length;
  const longBreakouts = allResults.filter(r => r.breakout.direction === "long").length;
  const shortBreakouts = allResults.filter(r => r.breakout.direction === "short").length;

  const classAccumulator: Record<AssetClass, { count: number; wins: number; totalGain: number }> = {
    crypto: { count: 0, wins: 0, totalGain: 0 },
    forex: { count: 0, wins: 0, totalGain: 0 },
    metal: { count: 0, wins: 0, totalGain: 0 },
    oil: { count: 0, wins: 0, totalGain: 0 },
    us_stock: { count: 0, wins: 0, totalGain: 0 },
    ind_stock: { count: 0, wins: 0, totalGain: 0 },
  };

  for (const result of allResults) {
    const assetClass: AssetClass = result.breakout.class ?? "crypto";
    const summary = classAccumulator[assetClass];
    summary.count += 1;
    if (result.outcome.success) {
      summary.wins += 1;
    }
    summary.totalGain += result.outcome.gain24h;
  }

  const classBreakdown = Object.entries(classAccumulator).reduce(
    (acc, [key, value]) => {
      const typedKey = key as AssetClass;
      const count = value.count;
      acc[typedKey] = {
        count,
        winRate: count > 0 ? (value.wins / count) * 100 : 0,
        avg24h: count > 0 ? value.totalGain / count : 0,
      };
      return acc;
    },
    {} as Record<AssetClass, { count: number; winRate: number; avg24h: number }>
  );
  
  // Coin breakdown
  const coinBreakdown: Array<{ coin: string; count: number; winRate: number; avgGain: number }> = [];
  
  for (const [coin, coinResults] of results) {
    const count = coinResults.length;
    const wins = coinResults.filter(r => r.outcome.success).length;
    const winRate = (wins / count) * 100;
    const avgGain = coinResults.reduce((sum, r) => sum + r.outcome.gain24h, 0) / count;
    
    coinBreakdown.push({ coin, count, winRate, avgGain });
  }
  
  coinBreakdown.sort((a, b) => b.avgGain - a.avgGain);
  
  // Top performers
  const topPerformers = allResults
    .map(r => ({
      coin: r.breakout.coin,
      gain: r.outcome.gain24h,
      timestamp: r.breakout.timestamp,
      confidence: r.breakout.confidenceScore,
    }))
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 20);
  
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
    longBreakouts,
    shortBreakouts,
    coinBreakdown,
    topPerformers,
    classBreakdown,
  };
}

