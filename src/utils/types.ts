/**
 * L2 orderbook level from Hyperliquid
 */
export interface OrderbookLevel {
  px: string; // price
  sz: string; // size
  n: number; // number of orders
}

/**
 * L2 orderbook snapshot from WebSocket
 */
export interface L2Book {
  coin: string;
  time: number;
  levels: [OrderbookLevel[], OrderbookLevel[]]; // [bids, asks]
}

/**
 * Aggregated 1-minute candle for a coin's orderbook
 */
export interface OrderbookCandle {
  coin: string;
  timestamp: number;
  avgMidPrice: number;
  avgSpread: number;
  totalBidSize: number;
  totalAskSize: number;
  bidAskImbalance: number; // ratio of bid size to total size
}

/**
 * Computed metrics for a coin
 */
export interface CoinMetrics {
  coin: string;
  timestamp: number;
  avgImbalance: number;
  volatility: number;
  spreadCompression: number;
}

/**
 * WebSocket message from Hyperliquid
 */
export interface HyperliquidWSMessage {
  channel: string;
  data?: {
    coin?: string;
    time?: number;
    levels?: [OrderbookLevel[], OrderbookLevel[]];
  } & Record<string, unknown>;
}

/**
 * Perpetual coin metadata from Hyperliquid
 */
export interface PerpetualCoin {
  name: string;
  launchTs: number; // Timestamp in milliseconds
  onChain?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Pre-pump signal event
 */
export interface PrepumpSignal {
  ts: number; // timestamp when signal was generated
  score: number; // prepump score (0-3)
  price: number; // price at signal time
  imbalance: number;
  volatility: number;
  compression: number;
  rv20: number; // 20-minute realized volatility baseline
}

/**
 * Signal evaluation result
 */
export interface SignalEvaluation {
  signalTs: number; // original signal timestamp
  evalTs: number; // evaluation timestamp
  score: number;
  entryPrice: number;
  exitPrice: number;
  forwardReturn: number;
  holdTimeMinutes: number;
  rv20: number; // realized volatility at signal time
  winThreshold: number; // dynamic win threshold (3 × rv20)
  isWin: boolean; // whether return exceeded threshold
}

/**
 * Trade from WebSocket
 */
export interface WsTrade {
  coin: string;
  side: string; // "A" (ask/sell) or "B" (bid/buy)
  px: string; // price
  sz: string; // size
  time: number; // timestamp
  tid: number; // trade id
}

/**
 * Score persistence data
 */
export interface ScorePersistence {
  persistence: number; // 0-1, rolling average of last 5 scores
  lastScores: number[]; // last 5 scores
  timestamp: number;
}

/**
 * Trend analysis result
 */
export interface TrendAnalysis {
  priceTrendUp: boolean;
  spreadTightening: boolean;
  imbalanceRising: boolean;
  priceSlope: number;
  spreadSlope: number;
  imbalanceSlope: number;
  timestamp: number;
}

/**
 * Trade aggression metrics
 */
export interface TradeAggression {
  buyVolume: number;
  sellVolume: number;
  aggressiveBuyRatio: number; // 0-1
  timestamp: number;
}

/**
 * Multi-timeframe metrics
 */
export interface MultiTimeframeMetrics {
  m1Score: number; // 1-minute score
  m3Imbalance: number; // 3-minute avg imbalance
  m5TrendSlope: number; // 5-minute price trend
  priceAcceleration: number; // second derivative
  volatilityCluster: number; // volatility increase ratio
  timestamp: number;
}

/**
 * Prepump confidence score
 */
export interface PrepumpConfidence {
  confidence: number; // 0-1 overall confidence
  persistenceScore: number;
  trendStrength: number;
  aggressionScore: number;
  mtfConfirmation: number;
  timestamp: number;
}

/**
 * Confirmed prepump signal (1H mega-run system)
 */
export interface ConfirmedPrepump {
  coin: string;
  timestamp: number;
  confidence: number;
  score: number;
  price: number;
  rv20: number;
  winThreshold: number;
  cluster: string; // "major", "midcap", "meme"
  // Raw features
  persistence: number;
  trend: TrendAnalysis;
  aggression: TradeAggression;
  mtf: MultiTimeframeMetrics;
  // Current metrics
  imbalance: number;
  volatility: number;
  compression: number;
  volume24h: number; // 24h volume
}

/**
 * Multi-horizon evaluation result (24h, 72h, 7d)
 */
export interface MultiHorizonEvaluation {
  coin: string;
  signalTs: number; // timestamp when signal was generated
  evalTs: number; // evaluation timestamp
  horizon: "24h" | "72h" | "7d"; // evaluation window
  cluster: string; // coin cluster
  confidence: number;
  score: number;
  entryPrice: number;
  exitPrice: number;
  forwardReturn: number;
  rv20: number; // realized volatility at signal time
  winThreshold: number; // dynamic win threshold
  isWin: boolean; // whether return exceeded threshold
}

/**
 * 1H Candle data (from candleSnapshot or live stream)
 */
export interface Candle1H {
  coin: string;
  timestamp: number; // Close time (ms)
  openTime: number; // Open time (ms)
  closeTime: number; // Close time (ms)
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  numTrades: number;
  interval: string; // "1h"
}

/**
 * CandleSnapshot request
 */
export interface CandleSnapshotRequest {
  type: "candleSnapshot";
  req: {
    coin: string;
    interval: "1h";
    startTime: number; // epoch ms
    endTime: number; // epoch ms
  };
}

/**
 * CandleSnapshot response
 */
export interface CandleSnapshotResponse {
  channel: string;
  data: Array<{
    t: number; // open time ms
    T: number; // close time ms
    s: string; // symbol
    i: string; // interval
    o: string; // open
    c: string; // close
    h: string; // high
    l: string; // low
    v: string; // volume
    n: number; // number of trades
  }>;
}
