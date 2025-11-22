import axios from "axios";
import { info, warn, error as logError } from "../utils/logger.js";
import { classifyAsset } from "../assets/assetClassifier.js";
import type { HistoricalCandle } from "./historicalDataFetcher.js";
import type { DataProvider } from "../ingestion/multiAssetIngestion.js";
import { MULTI_ASSET_SYMBOLS } from "../ingestion/multiAssetIngestion.js";

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const TWELVE_DATA_URL = "https://api.twelvedata.com/time_series";
const DEFAULT_TWELVE_DATA_KEY = "c2a4117ba23a48059eb1ffb8ecbce483";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTwelveDataDate(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").replace("Z", "");
}

function buildHistoricalCandle(
  symbol: string,
  provider: DataProvider,
  data: {
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }
): HistoricalCandle {
  return {
    coin: symbol,
    timestamp: data.closeTime,
    openTime: data.openTime,
    closeTime: data.closeTime,
    open: data.open,
    close: data.close,
    high: data.high,
    low: data.low,
    volume: data.volume,
    numTrades: 0,
    assetClass: classifyAsset(symbol),
    provider,
  };
}

async function fetchYahooHistoricalCandles(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<HistoricalCandle[]> {
  const url = `${YAHOO_CHART_URL}/${encodeURIComponent(
    symbol
  )}?interval=60m&period1=${Math.floor(startTime / 1000)}&period2=${Math.floor(endTime / 1000)}`;

  const { data } = await axios.get(url, { timeout: 15000 });
  const result = data?.chart?.result?.[0];

  if (!result || !Array.isArray(result.timestamp)) {
    return [];
  }

  const quote = result.indicators?.quote?.[0];
  if (!quote) {
    return [];
  }

  const candles: HistoricalCandle[] = [];

  result.timestamp.forEach((ts: number, idx: number) => {
    const open = quote.open?.[idx];
    const close = quote.close?.[idx];
    const high = quote.high?.[idx];
    const low = quote.low?.[idx];
    const volume = quote.volume?.[idx] ?? 0;

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

    candles.push(
      buildHistoricalCandle(symbol, "yahoo", {
        openTime,
        closeTime,
        open,
        high,
        low,
        close,
        volume,
      })
    );
  });

  return candles;
}

async function fetchTwelveDataHistoricalCandles(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<HistoricalCandle[]> {
  const apiKey = process.env.TWELVE_DATA_API_KEY || DEFAULT_TWELVE_DATA_KEY;
  const start = formatTwelveDataDate(startTime);
  const end = formatTwelveDataDate(endTime);

  const url = `${TWELVE_DATA_URL}?symbol=${encodeURIComponent(
    symbol
  )}&interval=1h&start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(
    end
  )}&apikey=${apiKey}&order=ASC&timezone=UTC`;

  const { data } = await axios.get(url, { timeout: 15000 });

  if (data?.status === "error" || !Array.isArray(data?.values)) {
    return [];
  }

  return data.values
    .map((value: Record<string, string>) => {
      const datetime = value.datetime;
      if (!datetime) {
        return null;
      }

      const open = parseFloat(value.open ?? "0");
      const close = parseFloat(value.close ?? "0");
      const high = parseFloat(value.high ?? "0");
      const low = parseFloat(value.low ?? "0");
      const volume = parseFloat(value.volume ?? "0") || 0;

      if ([open, close, high, low].some((n) => Number.isNaN(n))) {
        return null;
      }

      const openTime = new Date(`${datetime}Z`).getTime();
      const closeTime = openTime + 60 * 60 * 1000;

      return buildHistoricalCandle(symbol, "twelvedata", {
        openTime,
        closeTime,
        open,
        high,
        low,
        close,
        volume,
      });
    })
    .filter((candle: HistoricalCandle | null): candle is HistoricalCandle => candle !== null);
}

export async function fetchMultiAssetHistoricalCandles(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<HistoricalCandle[]> {
  try {
    const yahooCandles = await fetchYahooHistoricalCandles(symbol, startTime, endTime);
    if (yahooCandles.length > 0) {
      return yahooCandles;
    }
  } catch (err) {
    warn("MultiAssetHistoricalFetcher", `Yahoo fetch failed for ${symbol}`, err);
  }

  try {
    const twelveDataCandles = await fetchTwelveDataHistoricalCandles(symbol, startTime, endTime);
    if (twelveDataCandles.length > 0) {
      return twelveDataCandles;
    }
  } catch (err) {
    warn("MultiAssetHistoricalFetcher", `TwelveData fetch failed for ${symbol}`, err);
  }

  warn("MultiAssetHistoricalFetcher", `No historical data available for ${symbol}`);
  return [];
}

export async function fetchMultiAssetHistoricalCandlesForSymbols(
  symbols: string[],
  startTime: number,
  endTime: number,
  batchSize: number = 2,
  delayMs: number = 750
): Promise<Map<string, HistoricalCandle[]>> {
  const uniqueSymbols = Array.from(new Set(symbols));
  const results = new Map<string, HistoricalCandle[]>();

  info(
    "MultiAssetHistoricalFetcher",
    `Fetching historical data for ${uniqueSymbols.length} symbols (${batchSize}/batch)`
  );

  for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
    const batch = uniqueSymbols.slice(i, i + batchSize);

    for (const symbol of batch) {
      try {
        const candles = await fetchMultiAssetHistoricalCandles(symbol, startTime, endTime);
        if (candles.length > 0) {
          results.set(symbol, candles);
          process.stdout.write(".");
        } else {
          process.stdout.write("x");
        }
      } catch (err) {
        process.stdout.write("x");
        logError(
          "MultiAssetHistoricalFetcher",
          `Unexpected error fetching history for ${symbol}`,
          err
        );
      }

      await sleep(300);
    }

    const fetched = Math.min(i + batchSize, uniqueSymbols.length);
    const pct = ((fetched / uniqueSymbols.length) * 100).toFixed(0);
    info("MultiAssetHistoricalFetcher", `Progress: ${fetched}/${uniqueSymbols.length} (${pct}%)`);

    if (i + batchSize < uniqueSymbols.length) {
      await sleep(delayMs);
    }
  }

  info(
    "MultiAssetHistoricalFetcher",
    `Completed fetching historical data for ${results.size}/${uniqueSymbols.length} symbols`
  );

  return results;
}

export function getDefaultMultiAssetSymbols(): string[] {
  return Array.from(MULTI_ASSET_SYMBOLS);
}

