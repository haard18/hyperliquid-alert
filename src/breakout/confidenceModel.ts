import type { AssetClass } from "../assets/assetClassifier.js";

export interface ConfidenceMetrics {
  volumeRatio: number;
  priceChange: number;
  consolidationPeriod: number;
  sustainedMomentum: boolean;
}

type WeightKey = "volume" | "price" | "consolidation" | "momentum";

const BASE_WEIGHTS: Record<WeightKey, number> = {
  volume: 0.4,
  price: 0.3,
  consolidation: 0.2,
  momentum: 0.1,
};

const STOCK_WEIGHTS: Record<WeightKey, number> = {
  volume: 0.25,
  price: 0.25,
  consolidation: 0.25,
  momentum: 0.25,
};

/**
 * Calculate raw section scores based on legacy buckets
 */
function calculateRawSectionScores(metrics: ConfidenceMetrics): Record<WeightKey, number> {
  let volume = 0;
  if (metrics.volumeRatio >= 5) volume = 40;
  else if (metrics.volumeRatio >= 3) volume = 30;
  else if (metrics.volumeRatio >= 2) volume = 20;
  else if (metrics.volumeRatio >= 1.5) volume = 10;

  let price = 0;
  if (metrics.priceChange >= 5) price = 30;
  else if (metrics.priceChange >= 3) price = 20;
  else if (metrics.priceChange >= 2) price = 15;
  else if (metrics.priceChange >= 1) price = 10;

  let consolidation = 0;
  if (metrics.consolidationPeriod >= 24) consolidation = 20;
  else if (metrics.consolidationPeriod >= 12) consolidation = 20;
  else if (metrics.consolidationPeriod >= 8) consolidation = 15;
  else if (metrics.consolidationPeriod >= 4) consolidation = 10;

  const momentum = metrics.sustainedMomentum ? 10 : 0;

  return { volume, price, consolidation, momentum };
}

/**
 * Apply asset-class-specific weighting adjustments
 */
function getWeights(assetClass: AssetClass): Record<WeightKey, number> {
  switch (assetClass) {
    case "forex":
      return normalizeWeights({
        ...BASE_WEIGHTS,
        price: BASE_WEIGHTS.price - 0.1,
        consolidation: BASE_WEIGHTS.consolidation + 0.2,
      });
    case "metal":
      return normalizeWeights({
        ...BASE_WEIGHTS,
        price: BASE_WEIGHTS.price - 0.2,
        volume: BASE_WEIGHTS.volume + 0.1,
      });
    case "oil":
      return normalizeWeights({
        ...BASE_WEIGHTS,
        volume: BASE_WEIGHTS.volume + 0.2,
      });
    case "us_stock":
    case "ind_stock":
      return { ...STOCK_WEIGHTS };
    case "crypto":
    default:
      return { ...BASE_WEIGHTS };
  }
}

function normalizeWeights(weights: Record<WeightKey, number>): Record<WeightKey, number> {
  const sanitized = { ...weights };
  (Object.keys(sanitized) as WeightKey[]).forEach((key) => {
    if (sanitized[key] < 0) {
      sanitized[key] = 0;
    }
  });

  const total = (Object.values(sanitized) as number[]).reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return { ...BASE_WEIGHTS };
  }

  return {
    volume: sanitized.volume / total,
    price: sanitized.price / total,
    consolidation: sanitized.consolidation / total,
    momentum: sanitized.momentum / total,
  };
}

/**
 * Calculate confidence score with class-aware weighting
 */
export function calculateConfidenceScore(
  metrics: ConfidenceMetrics,
  assetClass: AssetClass = "crypto"
): number {
  const rawScores = calculateRawSectionScores(metrics);
  const weights = getWeights(assetClass);

  const volumeFactor = rawScores.volume / 40;
  const priceFactor = rawScores.price / 30;
  const consolidationFactor = rawScores.consolidation / 20;
  const momentumFactor = rawScores.momentum / 10;

  const weightedScore =
    volumeFactor * weights.volume +
    priceFactor * weights.price +
    consolidationFactor * weights.consolidation +
    momentumFactor * weights.momentum;

  return Math.min(Math.round(weightedScore * 100), 100);
}

