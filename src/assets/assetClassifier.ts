export type AssetClass =
  | "crypto"
  | "forex"
  | "metal"
  | "oil"
  | "us_stock"
  | "ind_stock";

const FOREX_SYMBOLS = new Set([
  "EURUSD=X",
  "GBPUSD=X",
  "USDJPY=X",
  "AUDUSD=X",
  "NZDUSD=X",
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "AUD/USD",
  "NZD/USD",
]);

const METAL_SYMBOLS = new Set([
  "XAUUSD=X",
  "XAGUSD=X",
  "XAU/USD",
  "XAG/USD",
]);

const OIL_SYMBOLS = new Set(["CL=F", "BZ=F", "WTI", "BRENT"]);

const US_STOCK_SYMBOLS = new Set(["AAPL", "TSLA", "NVDA", "META", "SPY"]);

const INDIAN_STOCK_SYMBOLS = new Set([
  "RELIANCE.NS",
  "TCS.NS",
  "HDFCBANK.NS",
  "INFY.NS",
]);

/**
 * Normalize symbol string to uppercase for matching
 */
function normalizeSymbol(symbol: string): string {
  return symbol?.trim().toUpperCase();
}

/**
 * Determine the asset class for a given symbol
 */
export function classifyAsset(symbol: string): AssetClass {
  const normalized = normalizeSymbol(symbol);

  if (METAL_SYMBOLS.has(normalized)) {
    return "metal";
  }

  if (OIL_SYMBOLS.has(normalized)) {
    return "oil";
  }

  if (FOREX_SYMBOLS.has(normalized)) {
    return "forex";
  }

  if (US_STOCK_SYMBOLS.has(normalized)) {
    return "us_stock";
  }

  if (INDIAN_STOCK_SYMBOLS.has(normalized) || normalized.endsWith(".NS")) {
    return "ind_stock";
  }

  return "crypto";
}

