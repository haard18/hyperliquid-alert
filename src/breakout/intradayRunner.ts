/**
 * Model-2: Intraday Runner (Production)
 * 
 * Runs intraday detection on live/recent data
 * Separate from Model-1, completely independent execution
 */

import { info, warn, error as logError } from "../utils/logger.js";
import { detectIntradayBreakouts } from "./intradayDetector.js";
import { storeIntradaySignal } from "../utils/intradayStorage.js";
import { notifyIntradayBreakout } from "../utils/telegramNotifier.js";
import { fetchHistoricalCandles } from "../backtest/historicalDataFetcher.js";
import type { IntradayCandle, IntradayTimeframe } from "./intradayTypes.js";

/**
 * Convert historical candles to intraday candles
 */
function convertToIntradayCandles(candles: any[]): IntradayCandle[] {
  return candles.map((c) => ({
    timestamp: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

/**
 * Fetch recent candles for a symbol
 */
async function fetchRecentCandles(
  symbol: string,
  timeframe: IntradayTimeframe,
  lookbackHours: number = 48
): Promise<IntradayCandle[]> {
  try {
    const endTime = Date.now();
    const startTime = endTime - lookbackHours * 60 * 60 * 1000;

    // Map timeframe to API interval
    const interval = timeframe === "5m" ? "5m" : timeframe === "15m" ? "15m" : "1h";

    const candles = await fetchHistoricalCandles(
      symbol,
      startTime,
      endTime,
      interval
    );

    return convertToIntradayCandles(candles);
  } catch (err) {
    logError(
      "IntradayRunner",
      `Failed to fetch candles for ${symbol} ${timeframe}`,
      err
    );
    return [];
  }
}

/**
 * Run intraday detection for a single symbol/timeframe
 */
async function detectForSymbol(
  symbol: string,
  timeframe: IntradayTimeframe
): Promise<void> {
  try {
    const candles = await fetchRecentCandles(symbol, timeframe);

    if (candles.length < 30) {
      warn(
        "IntradayRunner",
        `Insufficient candles for ${symbol} ${timeframe}: ${candles.length}`
      );
      return;
    }

    const signals = await detectIntradayBreakouts([
      { symbol, candles, timeframe },
    ]);

    for (const signal of signals) {
      // Store in Redis
      await storeIntradaySignal(signal);

      // Send notification
      await notifyIntradayBreakout(signal);

      info(
        "IntradayRunner",
        `Detected ${signal.pattern} for ${signal.symbol} on ${signal.timeframe} (conf: ${signal.confidence})`
      );
    }
  } catch (err) {
    logError(
      "IntradayRunner",
      `Error detecting for ${symbol} ${timeframe}`,
      err
    );
  }
}

/**
 * Run 5-minute detection cycle
 */
export async function run5mDetection(symbols: string[]): Promise<void> {
  info("IntradayRunner", `Running 5m detection for ${symbols.length} symbols`);

  const timeframe: IntradayTimeframe = "5m";

  for (const symbol of symbols) {
    await detectForSymbol(symbol, timeframe);
    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  info("IntradayRunner", `Completed 5m detection cycle`);
}

/**
 * Run 15-minute detection cycle
 */
export async function run15mDetection(symbols: string[]): Promise<void> {
  info("IntradayRunner", `Running 15m detection for ${symbols.length} symbols`);

  const timeframe: IntradayTimeframe = "15m";

  for (const symbol of symbols) {
    await detectForSymbol(symbol, timeframe);
    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  info("IntradayRunner", `Completed 15m detection cycle`);
}

/**
 * Run 1-hour detection cycle
 */
export async function run1hDetection(symbols: string[]): Promise<void> {
  info("IntradayRunner", `Running 1h detection for ${symbols.length} symbols`);

  const timeframe: IntradayTimeframe = "1h";

  for (const symbol of symbols) {
    await detectForSymbol(symbol, timeframe);
    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  info("IntradayRunner", `Completed 1h detection cycle`);
}

/**
 * Get default symbol list for crypto
 */
export function getDefaultCryptoSymbols(): string[] {
  return [
    "BTC",
    "ETH",
    "SOL",
    "ARB",
    "AVAX",
    "MATIC",
    "LINK",
    "UNI",
    "AAVE",
    "DOGE",
    "XRP",
    "ADA",
    "DOT",
    "ATOM",
    "APT",
  ];
}

/**
 * Get default symbol list for all asset classes
 * (For future multi-asset support)
 */
export function getAllAssetSymbols(): string[] {
  const crypto = getDefaultCryptoSymbols();
  
  // Future: Add forex, metals, stocks
  const forex = ["EURUSD=X", "GBPUSD=X"];
  const metals = ["XAUUSD=X", "XAGUSD=X"];
  
  return [...crypto]; // Currently only crypto via Hyperliquid
}

/**
 * Run full detection cycle (all timeframes)
 * Used for testing/manual runs
 */
export async function runFullDetectionCycle(): Promise<void> {
  const symbols = getDefaultCryptoSymbols();

  info("IntradayRunner", `Starting full detection cycle`);

  // Run all timeframes in sequence
  await run5mDetection(symbols);
  await run15mDetection(symbols);
  await run1hDetection(symbols);

  info("IntradayRunner", `Completed full detection cycle`);
}

/**
 * Run detection for a specific timeframe
 */
export async function runDetectionForTimeframe(
  timeframe: IntradayTimeframe
): Promise<void> {
  const symbols = getDefaultCryptoSymbols();

  switch (timeframe) {
    case "5m":
      await run5mDetection(symbols);
      break;
    case "15m":
      await run15mDetection(symbols);
      break;
    case "1h":
      await run1hDetection(symbols);
      break;
  }
}

