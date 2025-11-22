import type { AssetClass } from "../assets/assetClassifier.js";

export interface BreakoutConfig {
  minVolumeRatio: number;
  minPriceChange: number;
  minConfidence: number;
  consolidationHours: number;
  successThreshold24h: number;
}

export const CLASS_CONFIG: Record<AssetClass, BreakoutConfig> = {
  crypto: {
    minVolumeRatio: 1.2,
    minPriceChange: 1.5,
    minConfidence: 70,
    consolidationHours: 12,
    successThreshold24h: 2,
  },
  forex: {
    minVolumeRatio: 1.1,
    minPriceChange: 0.2,
    minConfidence: 60,
    consolidationHours: 24,
    successThreshold24h: 0.5,
  },
  metal: {
    minVolumeRatio: 1.2,
    minPriceChange: 0.3,
    minConfidence: 65,
    consolidationHours: 24,
    successThreshold24h: 1,
  },
  oil: {
    minVolumeRatio: 1.5,
    minPriceChange: 0.5,
    minConfidence: 70,
    consolidationHours: 12,
    successThreshold24h: 2,
  },
  us_stock: {
    minVolumeRatio: 1.3,
    minPriceChange: 1.0,
    minConfidence: 70,
    consolidationHours: 24,
    successThreshold24h: 2,
  },
  ind_stock: {
    minVolumeRatio: 1.5,
    minPriceChange: 1.2,
    minConfidence: 75,
    consolidationHours: 24,
    successThreshold24h: 2,
  },
};

