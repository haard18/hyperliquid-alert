import type { AssetClass } from "../assets/assetClassifier.js";

/**
 * Model-2: Intraday Breakout Configuration
 * More aggressive thresholds for higher frequency signals
 */
export interface IntradayConfig {
  minVolumeRatio: number;
  minPriceChange: number;
  minConfidence: number;
  atrCompressionPercentile: number; // Bottom X% = compressed
  bbCompressionThreshold: number; // % of average width
  targetStyle: string;
}

export const INTRADAY_CLASS_CONFIG: Record<AssetClass, IntradayConfig> = {
  crypto: {
    minVolumeRatio: 1.1,
    minPriceChange: 0.3,
    minConfidence: 45,
    atrCompressionPercentile: 20,
    bbCompressionThreshold: 8,
    targetStyle: "high freq",
  },
  forex: {
    minVolumeRatio: 1.05,
    minPriceChange: 0.1,
    minConfidence: 40,
    atrCompressionPercentile: 15,
    bbCompressionThreshold: 6,
    targetStyle: "low vol",
  },
  metal: {
    minVolumeRatio: 1.05,
    minPriceChange: 0.15,
    minConfidence: 40,
    atrCompressionPercentile: 18,
    bbCompressionThreshold: 7,
    targetStyle: "breakout",
  },
  oil: {
    minVolumeRatio: 1.15,
    minPriceChange: 0.2,
    minConfidence: 50,
    atrCompressionPercentile: 25,
    bbCompressionThreshold: 10,
    targetStyle: "volatile",
  },
  us_stock: {
    minVolumeRatio: 1.1,
    minPriceChange: 0.25,
    minConfidence: 50,
    atrCompressionPercentile: 22,
    bbCompressionThreshold: 8,
    targetStyle: "intraday",
  },
  ind_stock: {
    minVolumeRatio: 1.1,
    minPriceChange: 0.25,
    minConfidence: 50,
    atrCompressionPercentile: 22,
    bbCompressionThreshold: 8,
    targetStyle: "intraday",
  },
};

/**
 * Success thresholds for backtesting evaluation
 */
export interface IntradaySuccessThresholds {
  gain15m: number;
  gain1h: number;
  gain4h: number;
  gainEOD: number;
  trapReversal: number;
}

export const INTRADAY_SUCCESS_THRESHOLDS: Record<
  AssetClass,
  IntradaySuccessThresholds
> = {
  crypto: {
    gain15m: 0.3,
    gain1h: 0.8,
    gain4h: 1.5,
    gainEOD: 2.0,
    trapReversal: 0.4,
  },
  forex: {
    gain15m: 0.05,
    gain1h: 0.2,
    gain4h: 0.4,
    gainEOD: 0.5,
    trapReversal: 0.15,
  },
  metal: {
    gain15m: 0.1,
    gain1h: 0.2,
    gain4h: 0.5,
    gainEOD: 0.8,
    trapReversal: 0.2,
  },
  oil: {
    gain15m: 0.15,
    gain1h: 0.3,
    gain4h: 0.7,
    gainEOD: 1.0,
    trapReversal: 0.3,
  },
  us_stock: {
    gain15m: 0.2,
    gain1h: 0.5,
    gain4h: 1.0,
    gainEOD: 1.5,
    trapReversal: 0.3,
  },
  ind_stock: {
    gain15m: 0.2,
    gain1h: 0.5,
    gain4h: 1.0,
    gainEOD: 1.5,
    trapReversal: 0.3,
  },
};

