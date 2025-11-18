/**
 * Historical Backtester
 * 
 * Simulates breakout detection on historical data and evaluates performance
 */

import { info, warn, error as logError } from "../utils/logger.js";
import { type HistoricalCandle } from "./historicalDataFetcher.js";

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

interface BacktestBreakout {
  coin: string;
  timestamp: number;
  price: number;
  volumeRatio: number;
  priceChange: number;
  consolidationPeriod: number;
  confidenceScore: number;
  resistanceLevel: number;
  breakoutType: "strong" | "moderate" | "weak";
}

interface BacktestResult {
  breakout: BacktestBreakout;
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
 * Detect breakout at a specific point in time
 */
function detectBreakoutAtTime(
  coin: string,
  allCandles: HistoricalCandle[],
  currentIndex: number
): BacktestBreakout | null {
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

  const resistanceLevel = calculateResistanceLevel(candlesUpToCurrent);
  const avgVolume = calculateAverageVolume(candlesUpToCurrent, 24);
  const consolidationPeriod = detectConsolidation(candlesUpToCurrent);
  const sustainedMomentum = checkSustainedMomentum(candlesUpToCurrent);

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
 * Evaluate breakout outcome
 */
function evaluateBreakoutOutcome(
  breakout: BacktestBreakout,
  allCandles: HistoricalCandle[],
  breakoutIndex: number
): BacktestResult | null {
  // Get candles after breakout
  const candlesAfterBreakout = allCandles.slice(0, breakoutIndex).reverse();
  
  if (candlesAfterBreakout.length < 24) {
    return null; // Not enough data to evaluate
  }

  const breakoutPrice = breakout.price;
  
  let peak1h = breakoutPrice;
  let peak4h = breakoutPrice;
  let peak12h = breakoutPrice;
  let peak24h = breakoutPrice;
  
  for (const candle of candlesAfterBreakout) {
    if (!candle) continue;
    
    const hoursAfter = (candle.timestamp - breakout.timestamp) / (60 * 60 * 1000);
    
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
    breakout,
    outcome: {
      peak1h,
      peak4h,
      peak12h,
      peak24h,
      gain1h,
      gain4h,
      gain12h,
      gain24h,
      success: gain24h >= 3,
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
    // Check for breakout at this point
    const breakout = detectBreakoutAtTime(coin, sortedCandles, i);
    
    if (breakout) {
      // Evaluate the outcome
      const result = evaluateBreakoutOutcome(breakout, sortedCandles, i);
      
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
  coinBreakdown: Array<{ coin: string; count: number; winRate: number; avgGain: number }>;
  topPerformers: Array<{ coin: string; gain: number; timestamp: number; confidence: number }>;
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
      coinBreakdown: [],
      topPerformers: [],
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
    coinBreakdown,
    topPerformers,
  };
}

