import type { AssetClass } from "../assets/assetClassifier.js";
import type { IntradayPattern } from "./intradayTypes.js";

/**
 * Model-2: Intraday Confidence Scoring
 * 
 * Weighted components:
 * - Breakout Strength: 35%
 * - Volume Spike: 25%
 * - Compression Strength: 20%
 * - Momentum Streak: 20%
 * 
 * Output: 0-100 score
 */

interface ConfidenceInputs {
  priceChange: number;
  volumeRatio: number;
  atrCompression: number; // 0-100, lower = more compressed
  bbCompression: number; // 0-100, lower = more compressed
  momentumStreak: number; // 0-3, green candles in last 3
  consolidationStrength: number; // 0-1, how tight the consolidation
  pattern: IntradayPattern;
  assetClass: AssetClass;
}

/**
 * Calculate breakout strength score (0-100)
 * Higher price change relative to asset class = higher score
 */
function calculateBreakoutStrength(
  priceChange: number,
  assetClass: AssetClass
): number {
  const thresholds: Record<AssetClass, number> = {
    crypto: 0.3, // Min threshold for crypto
    forex: 0.1,
    metal: 0.15,
    oil: 0.2,
    us_stock: 0.25,
    ind_stock: 0.25,
  };

  const minThreshold = thresholds[assetClass];
  const maxThreshold = minThreshold * 5; // 5x threshold = 100 score

  const absPriceChange = Math.abs(priceChange);
  const normalized = Math.min(
    (absPriceChange - minThreshold) / (maxThreshold - minThreshold),
    1
  );

  return Math.max(0, normalized * 100);
}

/**
 * Calculate volume spike score (0-100)
 * Volume ratio relative to expected norms
 */
function calculateVolumeScore(
  volumeRatio: number,
  assetClass: AssetClass
): number {
  const thresholds: Record<AssetClass, number> = {
    crypto: 1.1,
    forex: 1.05,
    metal: 1.05,
    oil: 1.15,
    us_stock: 1.1,
    ind_stock: 1.1,
  };

  const minThreshold = thresholds[assetClass];
  const maxThreshold = minThreshold * 2.5; // 2.5x = 100 score

  const normalized = Math.min(
    (volumeRatio - minThreshold) / (maxThreshold - minThreshold),
    1
  );

  return Math.max(0, normalized * 100);
}

/**
 * Calculate compression strength score (0-100)
 * Combines ATR compression and BB compression
 */
function calculateCompressionScore(
  atrCompression: number,
  bbCompression: number
): number {
  // Both should be low (compressed) for high score
  // Invert the values: low compression % = high score
  const atrScore = Math.max(0, 100 - atrCompression);
  const bbScore = Math.max(0, 100 - bbCompression);

  // Average of both
  return (atrScore + bbScore) / 2;
}

/**
 * Calculate momentum streak score (0-100)
 * Based on number of green candles in last 3
 */
function calculateMomentumScore(
  momentumStreak: number,
  consolidationStrength: number
): number {
  // momentumStreak: 0-3
  const streakScore = (momentumStreak / 3) * 70; // Max 70 from streak

  // consolidationStrength: 0-1
  const consolidationScore = consolidationStrength * 30; // Max 30 from consolidation

  return streakScore + consolidationScore;
}

/**
 * Pattern-specific bonus/penalty
 */
function getPatternModifier(pattern: IntradayPattern): number {
  switch (pattern) {
    case "volatility_breakout":
      return 1.1; // 10% bonus for volatility breakouts
    case "liquidity_trap":
      return 1.05; // 5% bonus for trap reversals
    case "micro_breakout":
      return 1.0; // No modifier
    default:
      return 1.0;
  }
}

/**
 * Main confidence calculation
 * Returns score 0-100
 */
export function calculateIntradayConfidence(
  inputs: ConfidenceInputs
): number {
  const breakoutScore = calculateBreakoutStrength(
    inputs.priceChange,
    inputs.assetClass
  );
  const volumeScore = calculateVolumeScore(
    inputs.volumeRatio,
    inputs.assetClass
  );
  const compressionScore = calculateCompressionScore(
    inputs.atrCompression,
    inputs.bbCompression
  );
  const momentumScore = calculateMomentumScore(
    inputs.momentumStreak,
    inputs.consolidationStrength
  );

  // Weighted average
  const baseScore =
    breakoutScore * 0.35 +
    volumeScore * 0.25 +
    compressionScore * 0.2 +
    momentumScore * 0.2;

  // Apply pattern modifier
  const patternModifier = getPatternModifier(inputs.pattern);
  const finalScore = Math.min(100, baseScore * patternModifier);

  return Math.round(finalScore);
}

/**
 * Quick validation: does signal meet minimum confidence?
 */
export function meetsMinimumConfidence(
  confidence: number,
  assetClass: AssetClass
): boolean {
  const minThresholds: Record<AssetClass, number> = {
    crypto: 45,
    forex: 40,
    metal: 40,
    oil: 50,
    us_stock: 50,
    ind_stock: 50,
  };

  return confidence >= minThresholds[assetClass];
}

