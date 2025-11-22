/**
 * Historical Data Fetcher
 * 
 * Fetches historical 1h candle data from Hyperliquid API
 */

import axios from "axios";
import { info, warn, error as logError } from "../utils/logger.js";
import type { AssetClass } from "../assets/assetClassifier.js";
import type { DataProvider } from "../ingestion/multiAssetIngestion.js";

const HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz/info";

export interface HistoricalCandle {
  coin: string;
  timestamp: number;
  openTime: number;
  closeTime: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  numTrades: number;
  assetClass?: AssetClass;
  provider?: DataProvider | "hyperliquid";
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch historical candles for a coin with retry logic
 */
export async function fetchHistoricalCandles(
  coin: string,
  startTime: number,
  endTime: number,
  interval: string = "1h",
  maxRetries: number = 3
): Promise<HistoricalCandle[]> {
  let lastError: any = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = 1000 * Math.pow(2, attempt);
        await sleep(delay);
      }

      const response = await axios.post(
        HYPERLIQUID_API_URL, 
        {
          type: "candleSnapshot",
          req: {
            coin: coin,
            interval: interval,
            startTime: startTime,
            endTime: endTime,
          },
        },
        {
          timeout: 15000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Hyperliquid-Breakout-Detector/2.0'
          }
        }
      );

      if (!response.data || !Array.isArray(response.data)) {
        warn("HistoricalFetcher", `No data returned for ${coin}`);
        return [];
      }

      const candles: HistoricalCandle[] = response.data.map((c: any) => ({
        coin,
        timestamp: c.T, // Close time
        openTime: c.t,
        closeTime: c.T,
        open: parseFloat(c.o),
        close: parseFloat(c.c),
        high: parseFloat(c.h),
        low: parseFloat(c.l),
        volume: parseFloat(c.v),
        numTrades: c.n || 0,
        assetClass: "crypto",
        provider: "hyperliquid",
      }));

      return candles;
      
    } catch (err: any) {
      lastError = err;
      
      // Rate limit or network error - retry
      if (err.response?.status === 429 || 
          err.code === 'ECONNRESET' || 
          err.code === 'ETIMEDOUT' ||
          err.code === 'ECONNREFUSED') {
        if (attempt < maxRetries - 1) {
          warn("HistoricalFetcher", `Temporary error for ${coin}, retrying...`);
          continue;
        }
      }
      
      // Other errors or exhausted retries
      logError("HistoricalFetcher", `Failed to fetch candles for ${coin} after ${attempt + 1} attempts`, err);
      return [];
    }
  }
  
  logError("HistoricalFetcher", `Failed to fetch candles for ${coin} after ${maxRetries} attempts`, lastError);
  return [];
}

/**
 * Fetch historical candles for multiple coins with improved rate limiting
 */
export async function fetchHistoricalCandlesForCoins(
  coins: string[],
  startTime: number,
  endTime: number,
  interval: string = "1h",
  batchSize: number = 3,
  delayMs: number = 1000
): Promise<Map<string, HistoricalCandle[]>> {
  const results = new Map<string, HistoricalCandle[]>();

  console.log(`📥 Fetching historical data for ${coins.length} coins...`);
  console.log(`   (${batchSize} coins per batch, ${delayMs}ms delay)\n`);

  for (let i = 0; i < coins.length; i += batchSize) {
    const batch = coins.slice(i, i + batchSize);
    
    // Fetch sequentially within batch to further reduce rate limiting
    for (const coin of batch) {
      const candles = await fetchHistoricalCandles(coin, startTime, endTime, interval);
      if (candles.length > 0) {
        results.set(coin, candles);
        process.stdout.write('.');
      } else {
        process.stdout.write('x');
      }
      
      await sleep(300);
    }

    const progress = Math.min(i + batchSize, coins.length);
    const percentage = ((progress / coins.length) * 100).toFixed(0);
    
    if (progress % 30 === 0 || progress === coins.length) {
      console.log(` ${progress}/${coins.length} (${percentage}%)`);
    }

    // Longer delay between batches
    if (i + batchSize < coins.length) {
      await sleep(delayMs);
    }
  }

  console.log(`\n✓ Fetched data for ${results.size}/${coins.length} coins\n`);
  return results;
}

/**
 * Get time range for last N months
 */
export function getTimeRange(months: number): { startTime: number; endTime: number } {
  const endTime = Date.now();
  const startTime = endTime - (months * 30 * 24 * 60 * 60 * 1000);
  
  return { startTime, endTime };
}

