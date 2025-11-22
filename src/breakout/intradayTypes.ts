import type { AssetClass } from "../assets/assetClassifier.js";

/**
 * Model-2: Intraday Signal Schema
 */
export type IntradayTimeframe = "5m" | "15m" | "1h";
export type IntradayPattern = "micro_breakout" | "volatility_breakout" | "liquidity_trap";
export type SignalDirection = "long" | "short";

export interface IntradaySignal {
  symbol: string;
  class: AssetClass;
  timeframe: IntradayTimeframe;
  pattern: IntradayPattern;
  direction: SignalDirection;

  price: number;
  priceChange: number;
  volumeRatio: number;
  consolidation: number;
  atrCompression: number;
  bbCompression: number;

  confidence: number;
  signalType: "intraday_model";
  timestamp: number;
}

/**
 * Candle data structure for intraday analysis
 */
export interface IntradayCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Technical indicators for intraday detection
 */
export interface IntradayIndicators {
  atr14: number;
  atrHistory: number[]; // Last 30 ATR values
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbWidth: number;
  bbWidthHistory: number[]; // Last 30 BB widths
  volumeAvg10: number;
  high20thPercentile: number;
  low20thPercentile: number;
}

/**
 * Detection context passed to pattern detectors
 */
export interface IntradayDetectionContext {
  symbol: string;
  class: AssetClass;
  timeframe: IntradayTimeframe;
  candles: IntradayCandle[];
  indicators: IntradayIndicators;
  latestCandle: IntradayCandle;
}

