import { classifyAsset, type AssetClass } from "../assets/assetClassifier.js";
import {
  INTRADAY_CLASS_CONFIG,
  type IntradayConfig,
} from "./intradayClassConfig.js";
import {
  calculateIntradayConfidence,
  meetsMinimumConfidence,
} from "./intradayConfidenceModel.js";
import type {
  IntradayCandle,
  IntradaySignal,
  IntradayDetectionContext,
  IntradayIndicators,
  IntradayTimeframe,
  IntradayPattern,
  SignalDirection,
} from "./intradayTypes.js";

/**
 * Model-2: Intraday Breakout Detector
 * 
 * Three detection patterns:
 * 1. Micro-breakout (Level-1)
 * 2. Volatility Compression Breakout
 * 3. Liquidity Sweep / Trap Detection
 */

// ============================================================================
// TECHNICAL INDICATORS
// ============================================================================

/**
 * Calculate True Range for ATR
 */
function calculateTrueRange(candles: IntradayCandle[], index: number): number {
  const candle = candles[0];
  if (!candle) return 0;
  if (index === 0) return candle.high - candle.low;

  const current = candles[index];
  const previous = candles[index - 1];
  
  if (!current || !previous) return 0;

  return Math.max(
    current.high - current.low,
    Math.abs(current.high - previous.close),
    Math.abs(current.low - previous.close)
  );
}

/**
 * Calculate ATR (Average True Range) over N periods
 */
function calculateATR(candles: IntradayCandle[], period: number = 14): number {
  if (candles.length < period) return 0;

  const trueRanges: number[] = [];
  for (let i = Math.max(0, candles.length - period); i < candles.length; i++) {
    trueRanges.push(calculateTrueRange(candles, i));
  }

  return trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
}

/**
 * Calculate ATR history for compression detection
 */
function calculateATRHistory(
  candles: IntradayCandle[],
  lookback: number = 30
): number[] {
  const atrValues: number[] = [];
  const minCandles = 14; // ATR period

  for (let i = minCandles; i < candles.length && i < lookback + minCandles; i++) {
    const subset = candles.slice(0, i + 1);
    atrValues.push(calculateATR(subset, 14));
  }

  return atrValues;
}

/**
 * Calculate Bollinger Bands (20 period, 2 std dev)
 */
function calculateBollingerBands(
  candles: IntradayCandle[],
  period: number = 20
): { upper: number; middle: number; lower: number; width: number } {
  if (candles.length < period) {
    return { upper: 0, middle: 0, lower: 0, width: 0 };
  }

  const closes = candles.slice(-period).map((c) => c.close);
  const sma = closes.reduce((sum, c) => sum + c, 0) / closes.length;

  const variance =
    closes.reduce((sum, c) => sum + Math.pow(c - sma, 2), 0) / closes.length;
  const stdDev = Math.sqrt(variance);

  const upper = sma + 2 * stdDev;
  const lower = sma - 2 * stdDev;
  const width = ((upper - lower) / sma) * 100; // % width

  return { upper, middle: sma, lower, width };
}

/**
 * Calculate BB width history for compression detection
 */
function calculateBBWidthHistory(
  candles: IntradayCandle[],
  lookback: number = 30
): number[] {
  const widths: number[] = [];
  const minCandles = 20; // BB period

  for (let i = minCandles; i < candles.length && i < lookback + minCandles; i++) {
    const subset = candles.slice(0, i + 1);
    const bb = calculateBollingerBands(subset, 20);
    widths.push(bb.width);
  }

  return widths;
}

/**
 * Calculate percentile of array
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  const value = sorted[Math.max(0, index)];
  return value ?? 0;
}

/**
 * Build all technical indicators for detection
 */
function buildIndicators(candles: IntradayCandle[]): IntradayIndicators {
  const atr14 = calculateATR(candles, 14);
  const atrHistory = calculateATRHistory(candles, 30);
  const bb = calculateBollingerBands(candles, 20);
  const bbWidthHistory = calculateBBWidthHistory(candles, 30);

  const last20Candles = candles.slice(-20);
  const high20thPercentile = percentile(
    last20Candles.map((c) => c.high),
    80
  );
  const low20thPercentile = percentile(
    last20Candles.map((c) => c.low),
    20
  );

  const last10Volumes = candles.slice(-10).map((c) => c.volume);
  const volumeAvg10 =
    last10Volumes.reduce((sum, v) => sum + v, 0) / last10Volumes.length;

  return {
    atr14,
    atrHistory,
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    bbWidth: bb.width,
    bbWidthHistory,
    volumeAvg10,
    high20thPercentile,
    low20thPercentile,
  };
}

// ============================================================================
// PATTERN DETECTORS
// ============================================================================

/**
 * Pattern 1: Micro-breakout (Level-1)
 * 
 * Conditions:
 * - Price closes above 80th percentile high (last 20 candles)
 * - Volume ratio ≥ 1.1x (class-specific)
 * - Price change ≥ 0.3% (crypto) / 0.1% (forex/metals)
 * - Consolidation 2-6 candles
 * - Momentum streak: 2 green candles out of last 3
 */
function detectMicroBreakout(
  ctx: IntradayDetectionContext,
  config: IntradayConfig
): IntradaySignal | null {
  const { symbol, class: assetClass, timeframe, candles, indicators, latestCandle } = ctx;

  // Check price breakout above 80th percentile
  const priceBreakout = latestCandle.close > indicators.high20thPercentile;
  if (!priceBreakout) return null;

  // Calculate price change
  const priceChange =
    ((latestCandle.close - latestCandle.open) / latestCandle.open) * 100;
  if (Math.abs(priceChange) < config.minPriceChange) return null;

  // Volume ratio
  const volumeRatio = latestCandle.volume / indicators.volumeAvg10;
  if (volumeRatio < config.minVolumeRatio) return null;

  // Check consolidation (2-6 candles)
  const consolidation = calculateConsolidation(candles.slice(-7, -1));
  if (consolidation < 2 || consolidation > 6) return null;

  // Momentum streak: 2+ green candles in last 3
  const last3 = candles.slice(-3);
  const greenCandles = last3.filter((c) => c.close > c.open).length;
  if (greenCandles < 2) return null;

  // Calculate confidence
  const atrCompression = calculateATRCompression(indicators);
  const bbCompression = calculateBBCompression(indicators);

  const confidence = calculateIntradayConfidence({
    priceChange,
    volumeRatio,
    atrCompression,
    bbCompression,
    momentumStreak: greenCandles,
    consolidationStrength: Math.min(consolidation / 6, 1),
    pattern: "micro_breakout",
    assetClass,
  });

  if (!meetsMinimumConfidence(confidence, assetClass)) return null;

  const direction: SignalDirection = priceChange > 0 ? "long" : "short";

  return {
    symbol,
    class: assetClass,
    timeframe,
    pattern: "micro_breakout",
    direction,
    price: latestCandle.close,
    priceChange,
    volumeRatio,
    consolidation,
    atrCompression,
    bbCompression,
    confidence,
    signalType: "intraday_model",
    timestamp: latestCandle.timestamp,
  };
}

/**
 * Pattern 2: Volatility Compression Breakout
 * 
 * Conditions:
 * - ATR(14) compressed to bottom 20% of last 30 ATR values
 * - Bollinger Band width < 8% of average width
 * - Volume flat (within ±20% of 10-candle avg)
 * - Breakout: candle closes above last 10 highs
 * - Volume ratio ≥ 1.2
 */
function detectVolatilityBreakout(
  ctx: IntradayDetectionContext,
  config: IntradayConfig
): IntradaySignal | null {
  const { symbol, class: assetClass, timeframe, candles, indicators, latestCandle } = ctx;

  // Check ATR compression
  const atrCompression = calculateATRCompression(indicators);
  if (atrCompression > config.atrCompressionPercentile) return null;

  // Check BB compression
  const bbCompression = calculateBBCompression(indicators);
  if (bbCompression > config.bbCompressionThreshold) return null;

  // Check volume was flat before breakout
  const last10Volumes = candles.slice(-11, -1).map((c) => c.volume);
  const avgVolume =
    last10Volumes.reduce((sum, v) => sum + v, 0) / last10Volumes.length;
  const volumeStability = last10Volumes.every(
    (v) => Math.abs(v - avgVolume) / avgVolume <= 0.2
  );
  if (!volumeStability) return null;

  // Check breakout above last 10 highs
  const last10Highs = candles.slice(-10).map((c) => c.high);
  const maxHigh = Math.max(...last10Highs);
  const breakoutHigh = latestCandle.close > maxHigh;

  // OR breakout below last 10 lows (for shorts)
  const last10Lows = candles.slice(-10).map((c) => c.low);
  const minLow = Math.min(...last10Lows);
  const breakoutLow = latestCandle.close < minLow;

  if (!breakoutHigh && !breakoutLow) return null;

  // Volume spike on breakout
  const volumeRatio = latestCandle.volume / avgVolume;
  if (volumeRatio < 1.2) return null;

  // Calculate price change
  const priceChange =
    ((latestCandle.close - latestCandle.open) / latestCandle.open) * 100;
  if (Math.abs(priceChange) < config.minPriceChange) return null;

  // Momentum streak
  const last3 = candles.slice(-3);
  const greenCandles = last3.filter((c) => c.close > c.open).length;

  // Calculate confidence
  const consolidation = calculateConsolidation(candles.slice(-10, -1));

  const confidence = calculateIntradayConfidence({
    priceChange,
    volumeRatio,
    atrCompression,
    bbCompression,
    momentumStreak: greenCandles,
    consolidationStrength: Math.min(consolidation / 6, 1),
    pattern: "volatility_breakout",
    assetClass,
  });

  if (!meetsMinimumConfidence(confidence, assetClass)) return null;

  const direction: SignalDirection = breakoutHigh ? "long" : "short";

  return {
    symbol,
    class: assetClass,
    timeframe,
    pattern: "volatility_breakout",
    direction,
    price: latestCandle.close,
    priceChange,
    volumeRatio,
    consolidation,
    atrCompression,
    bbCompression,
    confidence,
    signalType: "intraday_model",
    timestamp: latestCandle.timestamp,
  };
}

/**
 * Pattern 3: Liquidity Sweep / Trap Detection
 * 
 * Bull Trap:
 * - Price sweeps previous high by ≥0.2%
 * - But closes BELOW prior high
 * - Volume spike + compression prior
 * 
 * Bear Trap: Inverted
 * 
 * Signal direction = trap reversal
 */
function detectLiquidityTrap(
  ctx: IntradayDetectionContext,
  config: IntradayConfig
): IntradaySignal | null {
  const { symbol, class: assetClass, timeframe, candles, indicators, latestCandle } = ctx;

  if (candles.length < 15) return null;

  // Get previous high/low (excluding latest)
  const previousCandles = candles.slice(-15, -1);
  const previousHigh = Math.max(...previousCandles.map((c) => c.high));
  const previousLow = Math.min(...previousCandles.map((c) => c.low));

  // Check for bull trap
  const sweepHighBy =
    ((latestCandle.high - previousHigh) / previousHigh) * 100;
  const closedBelowHigh = latestCandle.close < previousHigh;
  const isBullTrap = sweepHighBy >= 0.2 && closedBelowHigh;

  // Check for bear trap
  const sweepLowBy = ((previousLow - latestCandle.low) / previousLow) * 100;
  const closedAboveLow = latestCandle.close > previousLow;
  const isBearTrap = sweepLowBy >= 0.2 && closedAboveLow;

  if (!isBullTrap && !isBearTrap) return null;

  // Volume spike required
  const volumeRatio = latestCandle.volume / indicators.volumeAvg10;
  if (volumeRatio < config.minVolumeRatio) return null;

  // Check compression prior to trap
  const atrCompression = calculateATRCompression(indicators);
  const bbCompression = calculateBBCompression(indicators);

  // Need some compression for valid trap
  if (atrCompression > 50 && bbCompression > 50) return null;

  // Calculate price change (reversal direction)
  const priceChange =
    ((latestCandle.close - latestCandle.open) / latestCandle.open) * 100;

  // Momentum
  const last3 = candles.slice(-3);
  const greenCandles = last3.filter((c) => c.close > c.open).length;

  const consolidation = calculateConsolidation(candles.slice(-10, -1));

  const confidence = calculateIntradayConfidence({
    priceChange: Math.abs(priceChange),
    volumeRatio,
    atrCompression,
    bbCompression,
    momentumStreak: greenCandles,
    consolidationStrength: Math.min(consolidation / 6, 1),
    pattern: "liquidity_trap",
    assetClass,
  });

  if (!meetsMinimumConfidence(confidence, assetClass)) return null;

  // Direction is the REVERSAL direction
  const direction: SignalDirection = isBullTrap ? "short" : "long";

  return {
    symbol,
    class: assetClass,
    timeframe,
    pattern: "liquidity_trap",
    direction,
    price: latestCandle.close,
    priceChange,
    volumeRatio,
    consolidation,
    atrCompression,
    bbCompression,
    confidence,
    signalType: "intraday_model",
    timestamp: latestCandle.timestamp,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate consolidation strength (number of tight candles)
 */
function calculateConsolidation(candles: IntradayCandle[]): number {
  if (candles.length === 0) return 0;

  const avgRange =
    candles.reduce((sum, c) => sum + (c.high - c.low), 0) / candles.length;

  let consolidating = 0;
  for (const candle of candles) {
    const range = candle.high - candle.low;
    if (range <= avgRange * 0.7) {
      // Tight candle
      consolidating++;
    }
  }

  return consolidating;
}

/**
 * Calculate ATR compression percentile
 * Returns 0-100 (lower = more compressed)
 */
function calculateATRCompression(indicators: IntradayIndicators): number {
  if (indicators.atrHistory.length === 0) return 100;

  const currentATR = indicators.atr14;
  const sorted = [...indicators.atrHistory].sort((a, b) => a - b);
  const position = sorted.findIndex((atr) => atr >= currentATR);

  if (position === -1) return 100;

  return (position / sorted.length) * 100;
}

/**
 * Calculate BB compression relative to average
 * Returns 0-100 (lower = more compressed)
 */
function calculateBBCompression(indicators: IntradayIndicators): number {
  if (indicators.bbWidthHistory.length === 0) return 100;

  const currentWidth = indicators.bbWidth;
  const avgWidth =
    indicators.bbWidthHistory.reduce((sum, w) => sum + w, 0) /
    indicators.bbWidthHistory.length;

  const ratio = (currentWidth / avgWidth) * 100;
  return Math.min(100, ratio);
}

// ============================================================================
// MAIN DETECTION ORCHESTRATOR
// ============================================================================

/**
 * Main detection function
 * Runs all pattern detectors and returns first valid signal
 */
export function detectIntradayBreakout(
  symbol: string,
  candles: IntradayCandle[],
  timeframe: IntradayTimeframe
): IntradaySignal | null {
  // Need minimum candles for analysis
  if (candles.length < 30) return null;

  const assetClass = classifyAsset(symbol);
  const config = INTRADAY_CLASS_CONFIG[assetClass];
  const latestCandle = candles[candles.length - 1];
  
  if (!latestCandle) return null;
  
  const indicators = buildIndicators(candles);

  const ctx: IntradayDetectionContext = {
    symbol,
    class: assetClass,
    timeframe,
    candles,
    indicators,
    latestCandle,
  };

  // Try each pattern detector in priority order
  // Volatility breakout has highest priority
  const volatilitySignal = detectVolatilityBreakout(ctx, config);
  if (volatilitySignal) return volatilitySignal;

  // Liquidity trap second priority
  const trapSignal = detectLiquidityTrap(ctx, config);
  if (trapSignal) return trapSignal;

  // Micro-breakout last
  const microSignal = detectMicroBreakout(ctx, config);
  if (microSignal) return microSignal;

  return null;
}

/**
 * Batch detection across multiple symbols
 */
export async function detectIntradayBreakouts(
  symbolsWithCandles: Array<{
    symbol: string;
    candles: IntradayCandle[];
    timeframe: IntradayTimeframe;
  }>
): Promise<IntradaySignal[]> {
  const signals: IntradaySignal[] = [];

  for (const { symbol, candles, timeframe } of symbolsWithCandles) {
    const signal = detectIntradayBreakout(symbol, candles, timeframe);
    if (signal) {
      signals.push(signal);
    }
  }

  return signals;
}

