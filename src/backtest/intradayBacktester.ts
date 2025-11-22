/**
 * Model-2: Intraday Backtester
 * 
 * Evaluates intraday signals with multiple time horizons:
 * - 15m gain
 * - 1h gain
 * - 4h gain
 * - EOD (end-of-day) gain
 * - Trap reversal success
 */

import type {
  IntradaySignal,
  IntradayCandle,
  IntradayPattern,
  IntradayTimeframe,
} from "../breakout/intradayTypes.js";
import type { AssetClass } from "../assets/assetClassifier.js";
import {
  INTRADAY_SUCCESS_THRESHOLDS,
  type IntradaySuccessThresholds,
} from "../breakout/intradayClassConfig.js";

/**
 * Signal evaluation result
 */
export interface IntradayEvaluation {
  signal: IntradaySignal;
  gain15m: number;
  gain1h: number;
  gain4h: number;
  gainEOD: number;
  peak15m: number;
  peak1h: number;
  peak4h: number;
  success15m: boolean;
  success1h: boolean;
  success4h: boolean;
  successEOD: boolean;
  overallSuccess: boolean;
}

/**
 * Backtest statistics
 */
export interface IntradayBacktestStats {
  totalSignals: number;
  successfulSignals: number;
  successRate: number;
  avgGain15m: number;
  avgGain1h: number;
  avgGain4h: number;
  avgGainEOD: number;
  
  patternBreakdown: Array<{
    pattern: IntradayPattern;
    count: number;
    winRate: number;
    avgGain: number;
  }>;

  classBreakdown: Array<{
    class: AssetClass;
    count: number;
    winRate: number;
    avgGain: number;
  }>;

  timeframeBreakdown: Array<{
    timeframe: IntradayTimeframe;
    count: number;
    winRate: number;
    avgGain: number;
  }>;

  directionBreakdown: {
    long: { count: number; winRate: number; avgGain: number };
    short: { count: number; winRate: number; avgGain: number };
  };

  topSetups: Array<{
    symbol: string;
    pattern: IntradayPattern;
    timeframe: IntradayTimeframe;
    gain: number;
    timestamp: number;
    confidence: number;
  }>;

  evaluations: IntradayEvaluation[];
}

/**
 * Calculate gain percentage
 */
function calculateGain(entryPrice: number, exitPrice: number, direction: "long" | "short"): number {
  if (direction === "long") {
    return ((exitPrice - entryPrice) / entryPrice) * 100;
  } else {
    return ((entryPrice - exitPrice) / entryPrice) * 100;
  }
}

/**
 * Find price at specific time offset (in minutes)
 */
function findPriceAtOffset(
  candles: IntradayCandle[],
  signalTimestamp: number,
  offsetMinutes: number
): number | null {
  const targetTimestamp = signalTimestamp + offsetMinutes * 60 * 1000;
  
  // Find candle closest to target time
  let closest: IntradayCandle | null = null;
  let minDiff = Infinity;

  for (const candle of candles) {
    const diff = Math.abs(candle.timestamp - targetTimestamp);
    if (diff < minDiff) {
      minDiff = diff;
      closest = candle;
    }
  }

  return closest ? closest.close : null;
}

/**
 * Find peak price within time window
 */
function findPeakInWindow(
  candles: IntradayCandle[],
  signalTimestamp: number,
  windowMinutes: number,
  direction: "long" | "short"
): number {
  const endTimestamp = signalTimestamp + windowMinutes * 60 * 1000;
  
  const windowCandles = candles.filter(
    (c) => c.timestamp >= signalTimestamp && c.timestamp <= endTimestamp
  );

  if (windowCandles.length === 0) return 0;

  if (direction === "long") {
    return Math.max(...windowCandles.map((c) => c.high));
  } else {
    return Math.min(...windowCandles.map((c) => c.low));
  }
}

/**
 * Find end-of-day price (or last available price in data)
 */
function findEODPrice(
  candles: IntradayCandle[],
  signalTimestamp: number
): number | null {
  // Find the last candle on the same day
  const signalDate = new Date(signalTimestamp);
  signalDate.setHours(23, 59, 59, 999); // End of day
  const eodTimestamp = signalDate.getTime();

  // Find candles on the same day after signal
  const sameDayCandles = candles.filter(
    (c) => c.timestamp >= signalTimestamp && c.timestamp <= eodTimestamp
  );

  if (sameDayCandles.length === 0) return null;

  // Return the close of the last candle
  const lastCandle = sameDayCandles[sameDayCandles.length - 1];
  return lastCandle ? lastCandle.close : null;
}

/**
 * Evaluate a single intraday signal
 */
export function evaluateIntradaySignal(
  signal: IntradaySignal,
  futureCandles: IntradayCandle[]
): IntradayEvaluation {
  const entryPrice = signal.price;
  const direction = signal.direction;
  const thresholds = INTRADAY_SUCCESS_THRESHOLDS[signal.class];

  // Calculate gains at different time horizons
  const price15m = findPriceAtOffset(futureCandles, signal.timestamp, 15);
  const price1h = findPriceAtOffset(futureCandles, signal.timestamp, 60);
  const price4h = findPriceAtOffset(futureCandles, signal.timestamp, 240);
  const priceEOD = findEODPrice(futureCandles, signal.timestamp);

  const gain15m = price15m ? calculateGain(entryPrice, price15m, direction) : 0;
  const gain1h = price1h ? calculateGain(entryPrice, price1h, direction) : 0;
  const gain4h = price4h ? calculateGain(entryPrice, price4h, direction) : 0;
  const gainEOD = priceEOD ? calculateGain(entryPrice, priceEOD, direction) : 0;

  // Find peaks
  const peak15m = findPeakInWindow(futureCandles, signal.timestamp, 15, direction);
  const peak1h = findPeakInWindow(futureCandles, signal.timestamp, 60, direction);
  const peak4h = findPeakInWindow(futureCandles, signal.timestamp, 240, direction);

  const peakGain15m = peak15m ? calculateGain(entryPrice, peak15m, direction) : 0;
  const peakGain1h = peak1h ? calculateGain(entryPrice, peak1h, direction) : 0;
  const peakGain4h = peak4h ? calculateGain(entryPrice, peak4h, direction) : 0;

  // Determine success
  const success15m = gain15m >= thresholds.gain15m;
  const success1h = gain1h >= thresholds.gain1h;
  const success4h = gain4h >= thresholds.gain4h;
  const successEOD = gainEOD >= thresholds.gainEOD;

  // Overall success = 1h success (primary metric)
  const overallSuccess = success1h;

  return {
    signal,
    gain15m,
    gain1h,
    gain4h,
    gainEOD,
    peak15m: peakGain15m,
    peak1h: peakGain1h,
    peak4h: peakGain4h,
    success15m,
    success1h,
    success4h,
    successEOD,
    overallSuccess,
  };
}

/**
 * Calculate aggregate statistics
 */
export function calculateIntradayStats(
  evaluations: IntradayEvaluation[]
): IntradayBacktestStats {
  if (evaluations.length === 0) {
    return {
      totalSignals: 0,
      successfulSignals: 0,
      successRate: 0,
      avgGain15m: 0,
      avgGain1h: 0,
      avgGain4h: 0,
      avgGainEOD: 0,
      patternBreakdown: [],
      classBreakdown: [],
      timeframeBreakdown: [],
      directionBreakdown: {
        long: { count: 0, winRate: 0, avgGain: 0 },
        short: { count: 0, winRate: 0, avgGain: 0 },
      },
      topSetups: [],
      evaluations: [],
    };
  }

  const totalSignals = evaluations.length;
  const successfulSignals = evaluations.filter((e) => e.overallSuccess).length;
  const successRate = (successfulSignals / totalSignals) * 100;

  const avgGain15m =
    evaluations.reduce((sum, e) => sum + e.gain15m, 0) / totalSignals;
  const avgGain1h =
    evaluations.reduce((sum, e) => sum + e.gain1h, 0) / totalSignals;
  const avgGain4h =
    evaluations.reduce((sum, e) => sum + e.gain4h, 0) / totalSignals;
  const avgGainEOD =
    evaluations.reduce((sum, e) => sum + e.gainEOD, 0) / totalSignals;

  // Pattern breakdown
  const patternMap = new Map<
    IntradayPattern,
    { count: number; wins: number; totalGain: number }
  >();

  for (const evaluation of evaluations) {
    const pattern = evaluation.signal.pattern;
    if (!patternMap.has(pattern)) {
      patternMap.set(pattern, { count: 0, wins: 0, totalGain: 0 });
    }
    const stats = patternMap.get(pattern)!;
    stats.count++;
    if (evaluation.overallSuccess) stats.wins++;
    stats.totalGain += evaluation.gain1h;
  }

  const patternBreakdown = Array.from(patternMap.entries()).map(
    ([pattern, stats]) => ({
      pattern,
      count: stats.count,
      winRate: (stats.wins / stats.count) * 100,
      avgGain: stats.totalGain / stats.count,
    })
  );

  // Class breakdown
  const classMap = new Map<
    AssetClass,
    { count: number; wins: number; totalGain: number }
  >();

  for (const evaluation of evaluations) {
    const assetClass = evaluation.signal.class;
    if (!classMap.has(assetClass)) {
      classMap.set(assetClass, { count: 0, wins: 0, totalGain: 0 });
    }
    const stats = classMap.get(assetClass)!;
    stats.count++;
    if (evaluation.overallSuccess) stats.wins++;
    stats.totalGain += evaluation.gain1h;
  }

  const classBreakdown = Array.from(classMap.entries()).map(
    ([assetClass, stats]) => ({
      class: assetClass,
      count: stats.count,
      winRate: (stats.wins / stats.count) * 100,
      avgGain: stats.totalGain / stats.count,
    })
  );

  // Timeframe breakdown
  const timeframeMap = new Map<
    IntradayTimeframe,
    { count: number; wins: number; totalGain: number }
  >();

  for (const evaluation of evaluations) {
    const timeframe = evaluation.signal.timeframe;
    if (!timeframeMap.has(timeframe)) {
      timeframeMap.set(timeframe, { count: 0, wins: 0, totalGain: 0 });
    }
    const stats = timeframeMap.get(timeframe)!;
    stats.count++;
    if (evaluation.overallSuccess) stats.wins++;
    stats.totalGain += evaluation.gain1h;
  }

  const timeframeBreakdown = Array.from(timeframeMap.entries()).map(
    ([timeframe, stats]) => ({
      timeframe,
      count: stats.count,
      winRate: (stats.wins / stats.count) * 100,
      avgGain: stats.totalGain / stats.count,
    })
  );

  // Direction breakdown
  const longEvals = evaluations.filter((e) => e.signal.direction === "long");
  const shortEvals = evaluations.filter((e) => e.signal.direction === "short");

  const directionBreakdown = {
    long: {
      count: longEvals.length,
      winRate:
        longEvals.length > 0
          ? (longEvals.filter((e) => e.overallSuccess).length / longEvals.length) * 100
          : 0,
      avgGain:
        longEvals.length > 0
          ? longEvals.reduce((sum, e) => sum + e.gain1h, 0) / longEvals.length
          : 0,
    },
    short: {
      count: shortEvals.length,
      winRate:
        shortEvals.length > 0
          ? (shortEvals.filter((e) => e.overallSuccess).length / shortEvals.length) * 100
          : 0,
      avgGain:
        shortEvals.length > 0
          ? shortEvals.reduce((sum, e) => sum + e.gain1h, 0) / shortEvals.length
          : 0,
    },
  };

  // Top setups (by 1h gain)
  const topSetups = [...evaluations]
    .sort((a, b) => b.gain1h - a.gain1h)
    .slice(0, 10)
    .map((e) => ({
      symbol: e.signal.symbol,
      pattern: e.signal.pattern,
      timeframe: e.signal.timeframe,
      gain: e.gain1h,
      timestamp: e.signal.timestamp,
      confidence: e.signal.confidence,
    }));

  return {
    totalSignals,
    successfulSignals,
    successRate,
    avgGain15m,
    avgGain1h,
    avgGain4h,
    avgGainEOD,
    patternBreakdown,
    classBreakdown,
    timeframeBreakdown,
    directionBreakdown,
    topSetups,
    evaluations,
  };
}

/**
 * Backtest a batch of signals
 */
export function backtestIntradaySignals(
  signals: IntradaySignal[],
  candleData: Map<string, IntradayCandle[]>
): IntradayBacktestStats {
  const evaluations: IntradayEvaluation[] = [];

  for (const signal of signals) {
    const candles = candleData.get(signal.symbol);
    if (!candles) continue;

    // Get candles after signal timestamp
    const futureCandles = candles.filter((c) => c.timestamp >= signal.timestamp);
    if (futureCandles.length === 0) continue;

    const evaluation = evaluateIntradaySignal(signal, futureCandles);
    evaluations.push(evaluation);
  }

  return calculateIntradayStats(evaluations);
}

