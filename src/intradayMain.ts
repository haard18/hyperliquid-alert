/**
 * Model-2: Intraday Detection System - Standalone Entry Point
 * 
 * This is a completely independent system from Model-1.
 * Run this to start the intraday breakout detection system.
 * 
 * Usage:
 *   npm run intraday:start        # Start all timeframes
 *   npm run intraday:5m           # Only 5m
 *   npm run intraday:15m          # Only 15m
 *   npm run intraday:1h           # Only 1h
 *   npm run intraday:backtest     # Run backtest
 */

import "dotenv/config";
import { info, error as logError } from "./utils/logger.js";
import { initTelegram } from "./utils/telegramNotifier.js";
import {
  startIntradayCron,
  stopIntradayCron,
  startTimeframeCron,
  getIntradayCronStatus,
} from "./cron/intradayScheduler.js";
import {
  runFullDetectionCycle,
  runDetectionForTimeframe,
} from "./breakout/intradayRunner.js";
import {
  quickIntradayBacktest,
  runIntradayBacktestWithNotification,
} from "./backtest/intradayBacktestRunner.js";
import type { IntradayTimeframe } from "./breakout/intradayTypes.js";

/**
 * Parse command line arguments
 */
function parseArgs(): {
  mode: "start" | "backtest" | "test";
  timeframe?: IntradayTimeframe | undefined;
} {
  const args = process.argv.slice(2);
  const mode = args[0] || "start";
  const timeframe = args[1] as IntradayTimeframe | undefined;

  return {
    mode: mode as "start" | "backtest" | "test",
    timeframe: timeframe || undefined,
  };
}

/**
 * Start the intraday detection system
 */
async function startIntraday(timeframe?: IntradayTimeframe): Promise<void> {
  info("IntradayMain", "=== STARTING MODEL-2: INTRADAY DETECTION SYSTEM ===");

  // Initialize Telegram
  initTelegram();
  info("IntradayMain", "Telegram initialized");

  if (timeframe) {
    info("IntradayMain", `Starting detection for ${timeframe} only`);
    startTimeframeCron(timeframe);
  } else {
    info("IntradayMain", "Starting all timeframes (5m, 15m, 1h)");
    startIntradayCron();
  }

  // Log status
  const status = getIntradayCronStatus();
  info("IntradayMain", `5m job: ${status.job5m.scheduled ? "ACTIVE" : "INACTIVE"}`);
  info("IntradayMain", `15m job: ${status.job15m.scheduled ? "ACTIVE" : "INACTIVE"}`);
  info("IntradayMain", `1h job: ${status.job1h.scheduled ? "ACTIVE" : "INACTIVE"}`);

  info("IntradayMain", "✓ Intraday detection system is running");
  info("IntradayMain", "Press Ctrl+C to stop");

  // Keep process alive
  process.on("SIGINT", () => {
    info("IntradayMain", "Received SIGINT, shutting down...");
    stopIntradayCron();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    info("IntradayMain", "Received SIGTERM, shutting down...");
    stopIntradayCron();
    process.exit(0);
  });
}

/**
 * Run a single test cycle
 */
async function runTestCycle(timeframe?: IntradayTimeframe): Promise<void> {
  info("IntradayMain", "=== RUNNING TEST CYCLE ===");

  initTelegram();

  if (timeframe) {
    info("IntradayMain", `Testing ${timeframe} detection`);
    await runDetectionForTimeframe(timeframe);
  } else {
    info("IntradayMain", "Testing all timeframes");
    await runFullDetectionCycle();
  }

  info("IntradayMain", "✓ Test cycle completed");
  process.exit(0);
}

/**
 * Run backtest
 */
async function runBacktest(): Promise<void> {
  info("IntradayMain", "=== RUNNING INTRADAY BACKTEST ===");

  initTelegram();

  // Get backtest parameters from env or use defaults
  const daysBack = parseInt(process.env.BACKTEST_DAYS || "30", 10);
  const symbols = process.env.BACKTEST_SYMBOLS?.split(",") || [
    "BTC",
    "ETH",
    "SOL",
    "ARB",
    "AVAX",
  ];
  const timeframes: IntradayTimeframe[] = ["5m", "15m", "1h"];

  info(
    "IntradayMain",
    `Backtesting ${symbols.length} symbols over ${daysBack} days`
  );

  await runIntradayBacktestWithNotification(symbols, timeframes, daysBack);

  info("IntradayMain", "✓ Backtest completed");
  process.exit(0);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { mode, timeframe } = parseArgs();

  try {
    switch (mode) {
      case "start":
        await startIntraday(timeframe);
        break;
      case "test":
        await runTestCycle(timeframe);
        break;
      case "backtest":
        await runBacktest();
        break;
      default:
        console.error(`Unknown mode: ${mode}`);
        console.error("Usage: node intradayMain.js [start|test|backtest] [5m|15m|1h]");
        process.exit(1);
    }
  } catch (err) {
    logError("IntradayMain", "Fatal error", err);
    process.exit(1);
  }
}

// Run main
main();

