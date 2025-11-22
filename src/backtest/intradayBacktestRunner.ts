/**
 * Model-2: Intraday Backtest Runner
 * 
 * Fetches intraday historical data and backtests the intraday detector
 */

import { info, warn, error as logError } from "../utils/logger.js";
import { detectIntradayBreakout } from "../breakout/intradayDetector.js";
import {
  backtestIntradaySignals,
  type IntradayBacktestStats,
} from "./intradayBacktester.js";
import type {
  IntradayCandle,
  IntradaySignal,
  IntradayTimeframe,
} from "../breakout/intradayTypes.js";
import { fetchHistoricalCandles } from "./historicalDataFetcher.js";
import { notifyIntradayBacktestResults } from "../utils/telegramNotifier.js";

/**
 * Convert interval string to minutes
 */
function intervalToMinutes(interval: IntradayTimeframe): number {
  switch (interval) {
    case "5m":
      return 5;
    case "15m":
      return 15;
    case "1h":
      return 60;
    default:
      return 60;
  }
}

/**
 * Convert timeframe to API interval format
 */
function timeframeToInterval(timeframe: IntradayTimeframe): string {
  switch (timeframe) {
    case "5m":
      return "5m";
    case "15m":
      return "15m";
    case "1h":
      return "1h";
    default:
      return "1h";
  }
}

/**
 * Aggregate candles to higher timeframe
 * E.g., aggregate 5m candles to 15m or 1h
 */
function aggregateCandles(
  candles: IntradayCandle[],
  targetMinutes: number
): IntradayCandle[] {
  if (candles.length === 0) return [];

  const aggregated: IntradayCandle[] = [];
  const msPerCandle = targetMinutes * 60 * 1000;

  // Group candles by target timeframe
  const groups = new Map<number, IntradayCandle[]>();

  for (const candle of candles) {
    const bucketTimestamp = Math.floor(candle.timestamp / msPerCandle) * msPerCandle;
    if (!groups.has(bucketTimestamp)) {
      groups.set(bucketTimestamp, []);
    }
    groups.get(bucketTimestamp)!.push(candle);
  }

  // Create aggregated candles
  for (const [timestamp, group] of groups.entries()) {
    if (group.length === 0) continue;

    const firstCandle = group[0];
    const lastCandle = group[group.length - 1];
    
    if (!firstCandle || !lastCandle) continue;
    
    const open = firstCandle.open;
    const close = lastCandle.close;
    const high = Math.max(...group.map((c) => c.high));
    const low = Math.min(...group.map((c) => c.low));
    const volume = group.reduce((sum, c) => sum + c.volume, 0);

    aggregated.push({
      timestamp: timestamp + msPerCandle, // Close time
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return aggregated.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Fetch intraday candles for backtesting
 */
async function fetchIntradayCandles(
  symbol: string,
  timeframe: IntradayTimeframe,
  startTime: number,
  endTime: number
): Promise<IntradayCandle[]> {
  try {
    // Always fetch at smallest resolution (5m for better accuracy)
    const interval = "5m";
    
    const historicalCandles = await fetchHistoricalCandles(
      symbol,
      startTime,
      endTime,
      interval
    );

    if (historicalCandles.length === 0) {
      warn("IntradayBacktest", `No candles for ${symbol}`);
      return [];
    }

    // Convert to IntradayCandle format
    const intradayCandles: IntradayCandle[] = historicalCandles.map((c) => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    // Aggregate to target timeframe if needed
    const targetMinutes = intervalToMinutes(timeframe);
    if (targetMinutes > 5) {
      return aggregateCandles(intradayCandles, targetMinutes);
    }

    return intradayCandles;
  } catch (err) {
    logError("IntradayBacktest", `Failed to fetch candles for ${symbol}`, err);
    return [];
  }
}

/**
 * Generate signals from historical data
 */
function generateSignalsFromHistory(
  symbol: string,
  candles: IntradayCandle[],
  timeframe: IntradayTimeframe,
  minCandlesForDetection: number = 30
): IntradaySignal[] {
  const signals: IntradaySignal[] = [];

  // Slide window through history
  for (let i = minCandlesForDetection; i < candles.length; i++) {
    const windowCandles = candles.slice(0, i + 1);
    const signal = detectIntradayBreakout(symbol, windowCandles, timeframe);

    if (signal) {
      // Avoid duplicate signals (same symbol/timestamp)
      const isDuplicate = signals.some(
        (s) => s.symbol === signal.symbol && s.timestamp === signal.timestamp
      );

      if (!isDuplicate) {
        signals.push(signal);
      }
    }
  }

  return signals;
}

/**
 * Run intraday backtest for a single symbol
 */
async function backtestSymbol(
  symbol: string,
  timeframe: IntradayTimeframe,
  startTime: number,
  endTime: number
): Promise<{
  signals: IntradaySignal[];
  candles: IntradayCandle[];
}> {
  info(
    "IntradayBacktest",
    `Backtesting ${symbol} on ${timeframe} from ${new Date(startTime).toISOString()}`
  );

  const candles = await fetchIntradayCandles(symbol, timeframe, startTime, endTime);

  if (candles.length === 0) {
    warn("IntradayBacktest", `No candles for ${symbol}, skipping`);
    return { signals: [], candles: [] };
  }

  const signals = generateSignalsFromHistory(symbol, candles, timeframe);

  info(
    "IntradayBacktest",
    `Generated ${signals.length} signals for ${symbol} on ${timeframe}`
  );

  return { signals, candles };
}

/**
 * Run full intraday backtest across multiple symbols and timeframes
 */
export async function runIntradayBacktest(
  symbols: string[],
  timeframes: IntradayTimeframe[],
  daysBack: number = 30
): Promise<IntradayBacktestStats> {
  info(
    "IntradayBacktest",
    `Starting backtest for ${symbols.length} symbols, ${timeframes.length} timeframes, ${daysBack} days back`
  );

  const endTime = Date.now();
  const startTime = endTime - daysBack * 24 * 60 * 60 * 1000;

  const allSignals: IntradaySignal[] = [];
  const candleData = new Map<string, IntradayCandle[]>();

  // Fetch and generate signals for each symbol/timeframe combo
  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      const { signals, candles } = await backtestSymbol(
        symbol,
        timeframe,
        startTime,
        endTime
      );

      allSignals.push(...signals);

      // Store candles for evaluation (use finest resolution available)
      const existingCandles = candleData.get(symbol) || [];
      if (candles.length > existingCandles.length) {
        candleData.set(symbol, candles);
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  info("IntradayBacktest", `Generated total of ${allSignals.length} signals`);

  // Evaluate signals
  const stats = backtestIntradaySignals(allSignals, candleData);

  // Log results
  info("IntradayBacktest", `=== BACKTEST RESULTS ===`);
  info("IntradayBacktest", `Total Signals: ${stats.totalSignals}`);
  info("IntradayBacktest", `Success Rate: ${stats.successRate.toFixed(1)}%`);
  info("IntradayBacktest", `Avg 1h Gain: ${stats.avgGain1h.toFixed(2)}%`);
  info("IntradayBacktest", `Avg 4h Gain: ${stats.avgGain4h.toFixed(2)}%`);

  info("IntradayBacktest", `\n=== PATTERN BREAKDOWN ===`);
  stats.patternBreakdown.forEach((p) => {
    info(
      "IntradayBacktest",
      `${p.pattern}: ${p.count} signals, ${p.winRate.toFixed(1)}% win, ${p.avgGain.toFixed(2)}% avg`
    );
  });

  info("IntradayBacktest", `\n=== CLASS BREAKDOWN ===`);
  stats.classBreakdown.forEach((c) => {
    info(
      "IntradayBacktest",
      `${c.class}: ${c.count} signals, ${c.winRate.toFixed(1)}% win, ${c.avgGain.toFixed(2)}% avg`
    );
  });

  info("IntradayBacktest", `\n=== TIMEFRAME BREAKDOWN ===`);
  stats.timeframeBreakdown.forEach((t) => {
    info(
      "IntradayBacktest",
      `${t.timeframe}: ${t.count} signals, ${t.winRate.toFixed(1)}% win, ${t.avgGain.toFixed(2)}% avg`
    );
  });

  return stats;
}

/**
 * Run backtest and send results to Telegram
 */
export async function runIntradayBacktestWithNotification(
  symbols: string[],
  timeframes: IntradayTimeframe[],
  daysBack: number = 30
): Promise<void> {
  try {
    const stats = await runIntradayBacktest(symbols, timeframes, daysBack);

    // Format for Telegram
    const results = {
      totalSignals: stats.totalSignals,
      successRate: stats.successRate,
      avgGain1h: stats.avgGain1h,
      avgGain4h: stats.avgGain4h,
      patternBreakdown: stats.patternBreakdown.map((p) => ({
        pattern: p.pattern,
        count: p.count,
        winRate: p.winRate,
        avgGain: p.avgGain,
      })),
      classBreakdown: stats.classBreakdown.map((c) => ({
        class: c.class,
        count: c.count,
        winRate: c.winRate,
        avgGain: c.avgGain,
      })),
      timeframeBreakdown: stats.timeframeBreakdown.map((t) => ({
        timeframe: t.timeframe,
        count: t.count,
        winRate: t.winRate,
        avgGain: t.avgGain,
      })),
      topSetups: stats.topSetups,
    };

    await notifyIntradayBacktestResults(results);
    info("IntradayBacktest", "Sent results to Telegram");
  } catch (err) {
    logError("IntradayBacktest", "Backtest failed", err);
  }
}

/**
 * Quick test runner
 */
export async function quickIntradayBacktest(): Promise<void> {
  const cryptoSymbols = ["BTC", "ETH", "SOL", "ARB"];
  const timeframes: IntradayTimeframe[] = ["5m", "15m", "1h"];
  const daysBack = 7;

  await runIntradayBacktestWithNotification(cryptoSymbols, timeframes, daysBack);
}

