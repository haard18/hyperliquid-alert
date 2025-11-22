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
import { classifyAsset, type AssetClass } from "../assets/assetClassifier.js";
import { CLASS_CONFIG, type BreakoutConfig } from "./breakoutClassConfig.js";
import {
  MULTI_ASSET_SYMBOLS,
  getStoredMultiAssetCandles,
  type NormalizedCandle,
} from "../ingestion/multiAssetIngestion.js";
import { calculateConfidenceScore } from "./confidenceModel.js";

export type BreakoutDirection = "long" | "short";

export interface BreakoutSignal {
  coin: string;
  symbol: string;
  class: AssetClass;
  timestamp: number;
  price: number;
  volumeRatio: number; // Current volume / Average volume
  priceChange: number; // Percentage change from resistance level
  consolidationPeriod: number; // Hours of consolidation before breakout
  consolidationHours: number;
  confidenceScore: number; // 0-100
  confidence: number;
  resistanceLevel?: number;
  supportLevel?: number;
  direction: BreakoutDirection;
  breakoutType: "strong" | "moderate" | "weak";
  provider: "yahoo" | "twelvedata" | "hyperliquid";
}

export interface BreakoutMetrics {
  coin: string;
  resistanceLevel?: number;
  supportLevel?: number;
  avgVolume: number;
  recentVolume: number;
  consolidationVolatility: number;
  priceChange24h: number;
}

const DEFAULT_MIN_VOLUME_RATIO = 1.5;
const DEFAULT_MIN_PRICE_CHANGE = 1;
const DEFAULT_MIN_CONFIDENCE_SCORE = 50;

type CandleData = {
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  timestamp: number;
};

interface ConsolidationThreshold {
  hours: number;
  maxVolatility: number;
}

const DEFAULT_CONSOLIDATION_THRESHOLDS: ConsolidationThreshold[] = [
  { hours: 12, maxVolatility: 0.02 },
  { hours: 8, maxVolatility: 0.03 },
  { hours: 4, maxVolatility: 0.04 },
];

const EXTENDED_CONSOLIDATION_THRESHOLDS: ConsolidationThreshold[] = [
  { hours: 24, maxVolatility: 0.015 },
  ...DEFAULT_CONSOLIDATION_THRESHOLDS,
];

interface BreakoutRunOptions {
  includeMultiAsset?: boolean;
  skipCrypto?: boolean;
  multiAssetSymbols?: readonly string[];
}

/**
 * Calculate resistance level from recent highs
 */
function calculateResistanceLevel<T extends CandleData>(candles: T[]): number {
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
 * Calculate support level from recent lows (5th percentile)
 */
function calculateSupportLevel<T extends CandleData>(candles: T[]): number {
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
 * Calculate average volume over a period
 */
function calculateAverageVolume<T extends CandleData>(candles: T[], period: number = 24): number {
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
function calculateConsolidationVolatility<T extends CandleData>(candles: T[], period: number = 12): number {
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
function detectConsolidation<T extends CandleData>(
  candles: T[],
  thresholds: ConsolidationThreshold[] = DEFAULT_CONSOLIDATION_THRESHOLDS
): number {
  for (const threshold of thresholds) {
    if (candles.length < threshold.hours) {
      continue;
    }

    const volatility = calculateConsolidationVolatility(candles, threshold.hours);
    if (volatility < threshold.maxVolatility) {
      return threshold.hours;
    }
  }
  
  return 0;
}

function getConsolidationThresholdsForClass(assetClass: AssetClass): ConsolidationThreshold[] {
  const required = CLASS_CONFIG[assetClass]?.consolidationHours ?? 12;
  return required >= 24 ? EXTENDED_CONSOLIDATION_THRESHOLDS : DEFAULT_CONSOLIDATION_THRESHOLDS;
}

function meetsConsolidationRequirement(actualHours: number, requiredHours: number): boolean {
  if (requiredHours <= 0) {
    return true;
  }
  return actualHours >= requiredHours;
}

function logRejection(symbol: string, assetClass: AssetClass, reason: string): void {
  info("BreakoutDetector", `[Reject] ${symbol} ${assetClass} reason=${reason}`);
}

function createBreakoutSignal(params: {
  symbol: string;
  assetClass: AssetClass;
  provider: BreakoutSignal["provider"];
  direction: BreakoutDirection;
  timestamp: number;
  price: number;
  volumeRatio: number;
  priceChange: number;
  consolidationPeriod: number;
  confidenceScore: number;
  resistanceLevel?: number;
  supportLevel?: number;
}): BreakoutSignal {
  const baseSignal: BreakoutSignal = {
    coin: params.symbol,
    symbol: params.symbol,
    class: params.assetClass,
    timestamp: params.timestamp,
    price: params.price,
    volumeRatio: params.volumeRatio,
    priceChange: params.priceChange,
    consolidationPeriod: params.consolidationPeriod,
    consolidationHours: params.consolidationPeriod,
    confidenceScore: params.confidenceScore,
    confidence: params.confidenceScore,
    direction: params.direction,
    breakoutType: determineBreakoutType(params.confidenceScore),
    provider: params.provider,
  };

  if (params.resistanceLevel !== undefined) {
    baseSignal.resistanceLevel = params.resistanceLevel;
  }

  if (params.supportLevel !== undefined) {
    baseSignal.supportLevel = params.supportLevel;
  }

  return baseSignal;
}

function evaluateMultiAssetLong(
  symbol: string,
  assetClass: AssetClass,
  provider: BreakoutSignal["provider"],
  config: BreakoutConfig,
  latestCandle: NormalizedCandle,
  volumeRatio: number,
  consolidationPeriod: number,
  sustainedMomentum: boolean,
  resistanceLevel: number
): BreakoutSignal | null {
  if (resistanceLevel <= 0) {
    logRejection(symbol, assetClass, "no_resistance_level");
    return null;
  }

  if (latestCandle.close <= resistanceLevel) {
    logRejection(symbol, assetClass, "long_price_below_resistance");
    return null;
  }

  const priceChange = ((latestCandle.close - resistanceLevel) / resistanceLevel) * 100;
  if (priceChange < config.minPriceChange) {
    logRejection(symbol, assetClass, `long_price_change_below_threshold(${priceChange.toFixed(2)}%)`);
    return null;
  }

  if (volumeRatio < config.minVolumeRatio) {
    logRejection(symbol, assetClass, `long_volume_ratio_below_threshold(${volumeRatio.toFixed(2)}x)`);
    return null;
  }

  if (!sustainedMomentum) {
    logRejection(symbol, assetClass, "long_no_sustained_momentum");
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

  if (confidenceScore < config.minConfidence) {
    logRejection(symbol, assetClass, `long_low_confidence(${confidenceScore.toFixed(1)})`);
    return null;
  }

  info(
    "BreakoutDetector",
    `[BreakoutLong] ${symbol} ${assetClass} conf=${confidenceScore.toFixed(1)} price=${latestCandle.close.toFixed(4)} ` +
      `vr=${volumeRatio.toFixed(2)} change=+${priceChange.toFixed(2)}% provider=${provider}`
  );

  return createBreakoutSignal({
    symbol,
    assetClass,
    provider,
    direction: "long",
    timestamp: latestCandle.timestamp,
    price: latestCandle.close,
    volumeRatio,
    priceChange,
    consolidationPeriod,
    confidenceScore,
    resistanceLevel,
  });
}

function evaluateMultiAssetShort(
  symbol: string,
  assetClass: AssetClass,
  provider: BreakoutSignal["provider"],
  config: BreakoutConfig,
  latestCandle: NormalizedCandle,
  volumeRatio: number,
  consolidationPeriod: number,
  sustainedBearMomentum: boolean,
  supportLevel: number
): BreakoutSignal | null {
  if (supportLevel <= 0) {
    logRejection(symbol, assetClass, "no_support_level");
    return null;
  }

  if (latestCandle.close >= supportLevel) {
    logRejection(symbol, assetClass, "short_price_above_support");
    return null;
  }

  const priceChange = ((supportLevel - latestCandle.close) / supportLevel) * 100;
  if (priceChange <= 0) {
    logRejection(symbol, assetClass, "short_no_downside_break");
    return null;
  }

  if (priceChange < config.minPriceChange) {
    logRejection(symbol, assetClass, `short_price_change_below_threshold(${priceChange.toFixed(2)}%)`);
    return null;
  }

  if (volumeRatio < config.minVolumeRatio) {
    logRejection(symbol, assetClass, `short_volume_ratio_below_threshold(${volumeRatio.toFixed(2)}x)`);
    return null;
  }

  if (!sustainedBearMomentum) {
    logRejection(symbol, assetClass, "short_no_sustained_bearish_momentum");
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

  if (confidenceScore < config.minConfidence) {
    logRejection(symbol, assetClass, `short_low_confidence(${confidenceScore.toFixed(1)})`);
    return null;
  }

  info(
    "BreakoutDetector",
    `[BreakoutShort] ${symbol} ${assetClass} conf=${confidenceScore.toFixed(1)} price=${latestCandle.close.toFixed(4)} ` +
      `vr=${volumeRatio.toFixed(2)} change=-${priceChange.toFixed(2)}% provider=${provider}`
  );

  return createBreakoutSignal({
    symbol,
    assetClass,
    provider,
    direction: "short",
    timestamp: latestCandle.timestamp,
    price: latestCandle.close,
    volumeRatio,
    priceChange,
    consolidationPeriod,
    confidenceScore,
    supportLevel,
  });
}

async function detectBreakoutsForNonCryptoSymbol(symbol: string): Promise<BreakoutSignal[]> {
  const candles = await getStoredMultiAssetCandles(symbol, 60);
  if (candles.length === 0) {
    logRejection(symbol, classifyAsset(symbol), "no_candles");
    return [];
  }

  const latestCandle = candles[0]!;
  const detectedSignals: BreakoutSignal[] = [];
  const resolvedClass = latestCandle.class ?? classifyAsset(symbol);
  const config = CLASS_CONFIG[resolvedClass] ?? CLASS_CONFIG.crypto;

  if (candles.length < 24) {
    logRejection(symbol, resolvedClass, `insufficient_data(${candles.length})`);
    return [];
  }

  const thresholds = getConsolidationThresholdsForClass(resolvedClass);
  const consolidationPeriod = detectConsolidation(candles, thresholds);
  if (!meetsConsolidationRequirement(consolidationPeriod, config.consolidationHours)) {
    logRejection(
      symbol,
      resolvedClass,
      `low_consolidation(${consolidationPeriod}h<${config.consolidationHours}h)`
    );
    return [];
  }

  const avgVolume = calculateAverageVolume(candles, 24);
  let volumeRatio = avgVolume > 0 ? latestCandle.volume / avgVolume : 1;
  if (!Number.isFinite(volumeRatio) || volumeRatio <= 0) {
    volumeRatio = 1;
  }

  const sustainedMomentum = checkSustainedMomentum(candles);
  const sustainedBearMomentum = checkSustainedBearMomentum(candles);
  const resistanceLevel = calculateResistanceLevel(candles);
  const supportLevel = calculateSupportLevel(candles);
  const provider = latestCandle.provider ?? "yahoo";

  const longSignal = evaluateMultiAssetLong(
    symbol,
    resolvedClass,
    provider,
    config,
    latestCandle,
    volumeRatio,
    consolidationPeriod,
    sustainedMomentum,
    resistanceLevel
  );
  if (longSignal) {
    detectedSignals.push(longSignal);
  }

  const shortSignal = evaluateMultiAssetShort(
    symbol,
    resolvedClass,
    provider,
    config,
    latestCandle,
    volumeRatio,
    consolidationPeriod,
    sustainedBearMomentum,
    supportLevel
  );
  if (shortSignal) {
    detectedSignals.push(shortSignal);
  }

  return detectedSignals;
}

async function detectMultiAssetBreakouts(
  symbols: readonly string[] = MULTI_ASSET_SYMBOLS
): Promise<BreakoutSignal[]> {
  const signals: BreakoutSignal[] = [];

  for (const symbol of symbols) {
    try {
      const perSymbolSignals = await detectBreakoutsForNonCryptoSymbol(symbol);
      signals.push(...perSymbolSignals);
    } catch (err) {
      logError("BreakoutDetector", `Error processing multi-asset symbol ${symbol}`, err);
    }
  }

  return signals;
}


/**
 * Check if momentum is sustained (not just a spike)
 */
function checkSustainedMomentum<T extends CandleData>(candles: T[]): boolean {
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
 * Check if recent candles show sustained bearish momentum
 */
function checkSustainedBearMomentum<T extends CandleData>(candles: T[]): boolean {
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
 * Map confidence score to breakout classification
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
 * Detect breakout for a single coin
 */
export async function detectBreakoutForCoin(coin: string): Promise<BreakoutSignal | null> {
  try {
    // Get recent candles (last 60 hours)
    const candles = await candleStreamer.getCandles(coin, 60);
    
    if (candles.length < 24) {
      info("BreakoutDetector", `${coin}: Insufficient data (${candles.length} candles, need 24+)`);
      return null; // Not enough data
    }

    const latestCandle = candles[0];
    
    if (!latestCandle) {
      warn("BreakoutDetector", `${coin}: No latest candle available`);
      return null; // No latest candle
    }
    
    const assetClass: AssetClass = "crypto";
    const provider: BreakoutSignal["provider"] = "hyperliquid";
    
    // Calculate metrics
    const resistanceLevel = calculateResistanceLevel(candles);
    const avgVolume = calculateAverageVolume(candles, 24);
    const consolidationPeriod = detectConsolidation(candles);
    const sustainedMomentum = checkSustainedMomentum(candles);

    info(
      "BreakoutDetector",
      `${coin}: price=${latestCandle.close.toFixed(4)} resistance=${resistanceLevel.toFixed(4)} ` +
      `vol=${latestCandle.volume.toFixed(0)} avgVol=${avgVolume.toFixed(0)} ` +
      `consolidation=${consolidationPeriod}h momentum=${sustainedMomentum}`
    );

    // Check if price broke above resistance
    if (latestCandle.close <= resistanceLevel) {
      info("BreakoutDetector", `${coin}: No breakout (price below resistance)`);
      return null; // No breakout
    }

    // Calculate breakout metrics
    const volumeRatio = avgVolume > 0 ? latestCandle.volume / avgVolume : 0;
    const priceChange = ((latestCandle.close - resistanceLevel) / resistanceLevel) * 100;

    info(
      "BreakoutDetector",
      `${coin}: PRICE BREAKOUT! volRatio=${volumeRatio.toFixed(2)}x priceChange=+${priceChange.toFixed(2)}%`
    );

    // Require minimum volume surge and price breakout
    if (volumeRatio < 1.5 || priceChange < 1) {
      info("BreakoutDetector", `${coin}: Breakout too weak (volRatio < 1.5x or priceChange < 1%)`);
      return null; // Not strong enough
    }

    // Calculate confidence score
    const confidenceScore = calculateConfidenceScore(
      {
      volumeRatio,
      priceChange,
      consolidationPeriod,
      sustainedMomentum,
      },
      assetClass
    );

    // Determine breakout type
    const breakoutType = determineBreakoutType(confidenceScore);

    info(
      "BreakoutDetector",
      `${coin}: Confidence score = ${confidenceScore}/100 (${breakoutType})`
    );

    // Only return high-confidence breakouts (50+)
    if (confidenceScore < DEFAULT_MIN_CONFIDENCE_SCORE) {
      info("BreakoutDetector", `${coin}: Confidence too low (< 50), skipping`);
      return null;
    }

    const signal: BreakoutSignal = {
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

    return signal;
  } catch (err) {
    logError("BreakoutDetector", `Error detecting breakout for ${coin}`, err);
    return null;
  }
}

/**
 * Detect short-side breakout for a single coin
 */
async function detectShortBreakoutForCoin(coin: string): Promise<BreakoutSignal | null> {
  try {
    const candles = await candleStreamer.getCandles(coin, 60);

    if (candles.length < 24) {
      info("BreakoutDetector", `[ShortBreakout] REJECTED ${coin} reason=insufficient_data (${candles.length} candles)`);
      return null;
    }

    const latestCandle = candles[0];

    if (!latestCandle) {
      warn("BreakoutDetector", `[ShortBreakout] REJECTED ${coin} reason=no_latest_candle`);
      return null;
    }

    const assetClass: AssetClass = "crypto";
    const provider: BreakoutSignal["provider"] = "hyperliquid";

    const supportLevel = calculateSupportLevel(candles);
    if (supportLevel <= 0) {
      info("BreakoutDetector", `[ShortBreakout] REJECTED ${coin} reason=no_support_level`);
      return null;
    }

    if (latestCandle.close >= supportLevel) {
      info("BreakoutDetector", `[ShortBreakout] REJECTED ${coin} reason=price_above_support`);
      return null;
    }

    const avgVolume = calculateAverageVolume(candles, 24);
    const consolidationPeriod = detectConsolidation(candles);
    const sustainedBearMomentum = checkSustainedBearMomentum(candles);
    const volumeRatio = avgVolume > 0 ? latestCandle.volume / avgVolume : 0;
    const priceChange = ((supportLevel - latestCandle.close) / supportLevel) * 100;

    info(
      "BreakoutDetector",
      `[ShortBreakout] ${coin}: price=${latestCandle.close.toFixed(4)} support=${supportLevel.toFixed(4)} ` +
      `vol=${latestCandle.volume.toFixed(0)} avgVol=${avgVolume.toFixed(0)} ` +
      `consolidation=${consolidationPeriod}h momentum=${sustainedBearMomentum}`
    );

    if (priceChange <= 0) {
      info("BreakoutDetector", `[ShortBreakout] REJECTED ${coin} reason=no_downside_break`);
      return null;
    }

    if (volumeRatio < DEFAULT_MIN_VOLUME_RATIO || priceChange < DEFAULT_MIN_PRICE_CHANGE) {
      info(
        "BreakoutDetector",
        `[ShortBreakout] REJECTED ${coin} reason=thresholds volumeRatio=${volumeRatio.toFixed(2)} ` +
        `priceChange=${priceChange.toFixed(2)}%`
      );
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

    if (confidenceScore < DEFAULT_MIN_CONFIDENCE_SCORE) {
      info("BreakoutDetector", `[ShortBreakout] REJECTED ${coin} reason=low_confidence (${confidenceScore.toFixed(1)})`);
      return null;
    }

    const breakoutType = determineBreakoutType(confidenceScore);

    info(
      "BreakoutDetector",
      `[ShortBreakout] DETECTED ${coin} price=${latestCandle.close.toFixed(4)} ` +
      `support=${supportLevel.toFixed(4)} vr=${volumeRatio.toFixed(2)} change=${priceChange.toFixed(2)}%`
    );

    const signal: BreakoutSignal = {
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

    return signal;
  } catch (err) {
    logError("BreakoutDetector", `Error detecting short breakout for ${coin}`, err);
    return null;
  }
}

/**
 * Run breakout detection for all active coins
 */
export async function run(
  coins: string[],
  options: BreakoutRunOptions = {}
): Promise<BreakoutSignal[]> {
  const signals: BreakoutSignal[] = [];
  const shouldProcessCrypto = !options.skipCrypto;

  if (shouldProcessCrypto) {
    info("BreakoutDetector", `Running breakout detection for ${coins.length} coins`);

  for (const coin of coins) {
    try {
      const [longSignal, shortSignal] = await Promise.all([
        detectBreakoutForCoin(coin),
        detectShortBreakoutForCoin(coin),
      ]);

      const detectedSignals = [longSignal, shortSignal].filter(
        (s): s is BreakoutSignal => s !== null
      );

      for (const signal of detectedSignals) {
        const keyBase = `breakout:signal:${coin}:${signal.timestamp}`;
        const key = signal.direction === "long" ? keyBase : `${keyBase}:short`;
        await redis.setex(key, 86400 * 7, JSON.stringify(signal));

        await redis.zadd("breakouts:active", signal.timestamp, `${coin}:${signal.direction}`);
        
        signals.push(signal);
        
        info(
          "BreakoutDetector",
          `🚀 BREAKOUT DETECTED (${signal.direction.toUpperCase()}): ${coin} | Price: $${signal.price.toFixed(4)} | ` +
          `Volume: ${signal.volumeRatio.toFixed(1)}x | Change: ${signal.direction === "short" ? "-" : "+"}${signal.priceChange.toFixed(1)}% | ` +
          `Confidence: ${signal.confidenceScore}/100 | Type: ${signal.breakoutType.toUpperCase()}`
        );
        
        await notifyBreakout(signal);
      }
    } catch (err) {
      logError("BreakoutDetector", `Error processing ${coin}`, err);
      }
    }
  } else {
    info("BreakoutDetector", "Skipping crypto breakout detection (skipCrypto=true)");
  }

  if (options.includeMultiAsset) {
    const symbols = options.multiAssetSymbols ?? MULTI_ASSET_SYMBOLS;
    info("BreakoutDetector", `Running multi-asset detection for ${symbols.length} symbols`);
    const multiSignals = await detectMultiAssetBreakouts(symbols);

    for (const signal of multiSignals) {
      const keyBase = `breakout:signal:${signal.symbol}:${signal.timestamp}`;
      const key = signal.direction === "long" ? keyBase : `${keyBase}:short`;
      await redis.setex(key, 86400 * 7, JSON.stringify(signal));
      await redis.zadd("breakouts:active", signal.timestamp, `${signal.symbol}:${signal.direction}`);
      signals.push(signal);
      await notifyBreakout(signal);
    }
  }

  info("BreakoutDetector", `Detected ${signals.length} breakouts`);

  return signals;
}

