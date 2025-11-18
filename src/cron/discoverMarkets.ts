import axios from "axios";

const HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz/info";

interface PerpetualMarket {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  marginTableId: number;
  isDelisted?: boolean;
  [key: string]: any;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch all perpetual markets with retry logic
 */
export async function fetchAllPerpetualMarkets(
  maxRetries: number = 5,
  initialDelay: number = 1000
): Promise<PerpetualMarket[]> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Add delay before each attempt (except first)
      if (attempt > 0) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.log(`[DiscoverMarkets] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms delay...`);
        await sleep(delay);
      }
      
      const { data } = await axios.post(
        HYPERLIQUID_API_URL, 
        { type: "meta" },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Hyperliquid-Breakout-Detector/2.0'
          }
        }
      );

      if (!data || !Array.isArray(data.universe)) {
        throw new Error("Invalid meta response format from Hyperliquid API");
      }

      console.log(`[DiscoverMarkets] Successfully fetched ${data.universe.length} markets`);
      return data.universe;
      
    } catch (err: any) {
      lastError = err;
      
      // Check if it's a rate limit error (429)
      if (err.response?.status === 429) {
        console.log(`[DiscoverMarkets] Rate limited (429), will retry...`);
        continue;
      }
      
      // Check if it's a network error that might be temporary
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
        console.log(`[DiscoverMarkets] Network error (${err.code}), will retry...`);
        continue;
      }
      
      // For other errors, throw immediately
      throw new Error(
        `Failed to fetch perpetual markets: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  
  // All retries exhausted
  throw new Error(
    `Failed to fetch perpetual markets after ${maxRetries} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

/**
 * Filter out delisted markets
 */
export function filterActiveMarkets(markets: PerpetualMarket[]): PerpetualMarket[] {
  return markets.filter((m) => !m.isDelisted);
}

/**
 * Discover valid perpetual markets (only active)
 */
export async function discoverMarkets(): Promise<string[]> {
  // Add initial delay to avoid immediate rate limiting
  await sleep(500);
  
  const markets = await fetchAllPerpetualMarkets();
  const active = filterActiveMarkets(markets);
  
  console.log(`[DiscoverMarkets] Found ${active.length} active markets (${markets.length - active.length} delisted)`);
  
  return active.map((m) => m.name);
}
