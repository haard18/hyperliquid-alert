import axios from "axios";
import redis from "../utils/redisClient.js";
import { info, warn, error as logError } from "../utils/logger.js";
import { classifyAsset, type AssetClass } from "../assets/assetClassifier.js";

export type DataProvider = "yahoo" | "twelvedata";
export type YahooRange = "1d" | "5d" | "1mo" | "3mo";

export interface NormalizedCandle {
  symbol: string;
  class: AssetClass;
  timestamp: number;
  openTime: number;
  closeTime: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  provider: DataProvider;
}

export const FOREX_SYMBOLS = [
  "EURUSD=X",
  "GBPUSD=X",
  "USDJPY=X",
  "AUDUSD=X",
  "NZDUSD=X",
] as const;

export const METAL_SYMBOLS = ["GC=F", "SI=F"] as const;

export const OIL_SYMBOLS = ["CL=F", "BZ=F"] as const;

export const US_STOCK_SYMBOLS = ["AAPL", "TSLA", "NVDA", "META", "SPY"] as const;

export const IN_STOCK_SYMBOLS = ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS"] as const;

export const MULTI_ASSET_SYMBOLS = [
  ...FOREX_SYMBOLS,
  ...METAL_SYMBOLS,
  ...OIL_SYMBOLS,
  ...US_STOCK_SYMBOLS,
  ...IN_STOCK_SYMBOLS,
] as const;

const MAX_CANDLES_STORED = 120;
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const TWELVE_DATA_URL = "https://api.twelvedata.com/time_series";
const DEFAULT_TWELVE_DATA_KEY = "c2a4117ba23a48059eb1ffb8ecbce483";

const TWELVE_DATA_SYMBOL_MAP: Record<string, string> = {
  "EURUSD=X": "EUR/USD",
  "GBPUSD=X": "GBP/USD",
  "USDJPY=X": "USD/JPY",
  "AUDUSD=X": "AUD/USD",
  "NZDUSD=X": "NZD/USD",
  "XAUUSD=X": "XAU/USD",
  "XAGUSD=X": "XAG/USD",
  "CL=F": "CL",
  "BZ=F": "BZ",
  "AAPL": "AAPL",
  "TSLA": "TSLA",
  "NVDA": "NVDA",
  "META": "META",
  "SPY": "SPY",
  "RELIANCE.NS": "RELIANCE:NS",
  "TCS.NS": "TCS:NS",
  "HDFCBANK.NS": "HDFCBANK:NS",
  "INFY.NS": "INFY:NS",
};

interface ProviderResult {
  provider: DataProvider;
  candles: NormalizedCandle[];
}

/**
 * Fetch candles from Yahoo Finance
 */
async function fetchYahooCandles(symbol: string, range: YahooRange): Promise<NormalizedCandle[]> {
  const url = `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?interval=60m&range=${range}`;

  try {
    const { data } = await axios.get(url, { timeout: 10000 });
    const result = data?.chart?.result?.[0];

    if (!result || !Array.isArray(result.timestamp)) {
      return [];
    }

    const quote = result.indicators?.quote?.[0];
    if (!quote) {
      return [];
    }

    const assetClass = classifyAsset(symbol);
    const candles: NormalizedCandle[] = [];

    result.timestamp.forEach((ts: number, idx: number) => {
      const open = quote.open?.[idx];
      const close = quote.close?.[idx];
      const high = quote.high?.[idx];
      const low = quote.low?.[idx];
      const volume = quote.volume?.[idx];

      if (
        open === null || open === undefined ||
        close === null || close === undefined ||
        high === null || high === undefined ||
        low === null || low === undefined
      ) {
        return;
      }

      const openTime = ts * 1000;
      const closeTime = openTime + 60 * 60 * 1000;

      candles.push({
        symbol,
        class: assetClass,
        timestamp: closeTime,
        openTime,
        closeTime,
        open,
        close,
        high,
        low,
        volume: volume ?? 0,
        provider: "yahoo",
      });
    });

    return candles;
  } catch (err) {
    warn("MultiAssetIngestion", `Yahoo request failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Map Yahoo symbols to TwelveData format
 */
function mapToTwelveDataSymbol(symbol: string): string | null {
  const mapped = TWELVE_DATA_SYMBOL_MAP[symbol];
  return mapped ?? null;
}

/**
 * Fetch candles from TwelveData
 */
async function fetchTwelveDataCandles(symbol: string): Promise<NormalizedCandle[]> {
  const mappedSymbol = mapToTwelveDataSymbol(symbol);
  if (!mappedSymbol) {
    return [];
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY || DEFAULT_TWELVE_DATA_KEY;
  const url = `${TWELVE_DATA_URL}?symbol=${encodeURIComponent(mappedSymbol)}&interval=1h&apikey=${apiKey}&outputsize=${MAX_CANDLES_STORED}`;

  try {
    const { data } = await axios.get(url, { timeout: 10000 });

    if (data?.status === "error") {
      warn("MultiAssetIngestion", `TwelveData error for ${symbol}: ${data.message || "unknown error"}`);
      return [];
    }

    const values: Array<Record<string, string>> = data?.values;
    if (!Array.isArray(values)) {
      return [];
    }

    const assetClass = classifyAsset(symbol);

    return values
      .map((value) => {
        const datetime = value.datetime;
        if (!datetime) {
          return null;
        }

        const open = parseFloat(value.open ?? "0");
        const close = parseFloat(value.close ?? "0");
        const high = parseFloat(value.high ?? "0");
        const low = parseFloat(value.low ?? "0");
        const volume = parseFloat(value.volume ?? "0");

        if ([open, close, high, low].some((n) => Number.isNaN(n))) {
          return null;
        }

        const openTime = new Date(`${datetime}Z`).getTime();
        const closeTime = openTime + 60 * 60 * 1000;

        return {
          symbol,
          class: assetClass,
          timestamp: closeTime,
          openTime,
          closeTime,
          open,
          close,
          high,
          low,
          volume: Number.isNaN(volume) ? 0 : volume,
          provider: "twelvedata" as DataProvider,
        };
      })
      .filter((candle): candle is NormalizedCandle => candle !== null);
  } catch (err) {
    warn("MultiAssetIngestion", `TwelveData request failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Store normalized candles into Redis
 */
async function storeCandles(symbol: string, candles: NormalizedCandle[]): Promise<void> {
  if (candles.length === 0) {
    return;
  }

  const key = `candles:1h:${symbol}`;
  const pipeline = redis.multi();
  const ordered = [...candles].sort((a, b) => a.timestamp - b.timestamp).slice(-MAX_CANDLES_STORED);

  pipeline.del(key);
  for (const candle of ordered) {
    pipeline.lpush(key, JSON.stringify(candle));
  }
  pipeline.ltrim(key, 0, MAX_CANDLES_STORED - 1);

  await pipeline.exec();
}

/**
 * Attempt to fetch candles via Yahoo with TwelveData fallback
 */
async function fetchWithFallback(symbol: string, range: YahooRange): Promise<ProviderResult | null> {
  const yahooCandles = await fetchYahooCandles(symbol, range);
  if (yahooCandles.length > 0) {
    return { provider: "yahoo", candles: yahooCandles };
  }

  const twelveDataCandles = await fetchTwelveDataCandles(symbol);
  if (twelveDataCandles.length > 0) {
    return { provider: "twelvedata", candles: twelveDataCandles };
  }

  return null;
}

/**
 * Ingest candles for all configured multi-asset symbols
 */
export async function ingestMultiAssetCandles(
  range: YahooRange = "5d",
  symbols: readonly string[] = MULTI_ASSET_SYMBOLS
): Promise<void> {
  const uniqueSymbols = Array.from(new Set(symbols));

  for (const symbol of uniqueSymbols) {
    try {
      const result = await fetchWithFallback(symbol, range);

      if (!result) {
        warn("MultiAssetIngestion", `[Ingest] ${symbol} ${classifyAsset(symbol)} provider=none candles=0 (no data)`);
        continue;
      }

      await storeCandles(symbol, result.candles);
      info(
        "MultiAssetIngestion",
        `[Ingest] ${symbol} ${classifyAsset(symbol)} provider=${result.provider} candles=${Math.min(result.candles.length, MAX_CANDLES_STORED)}`
      );
    } catch (err) {
      logError("MultiAssetIngestion", `[Ingest] ${symbol} failed`, err);
    }
  }
}

/**
 * Retrieve stored normalized candles for a symbol
 */
export async function getStoredMultiAssetCandles(symbol: string, limit: number = 60): Promise<NormalizedCandle[]> {
  try {
    const key = `candles:1h:${symbol}`;
    const entries = await redis.lrange(key, 0, limit - 1);

    return entries
      .map((entry) => {
        try {
          return JSON.parse(entry) as NormalizedCandle;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is NormalizedCandle => entry !== null);
  } catch (err) {
    logError("MultiAssetIngestion", `Failed to read candles for ${symbol}`, err);
    return [];
  }
}

