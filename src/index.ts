import "dotenv/config";
import cron from "node-cron";
import { discoverMarkets } from "./cron/discoverMarkets.js";
import candleStreamer from "./stream/candleStreamer.js";
import { run as detectBreakouts } from "./breakout/breakoutDetector.js";
import { storeBreakoutSignal, run as evaluateBreakoutHistory, printBreakoutStats } from "./breakout/breakoutHistory.js";
import redis from "./utils/redisClient.js";
import { info, warn, error } from "./utils/logger.js";
import { initTelegram, isTelegramEnabled } from "./utils/telegramNotifier.js";

let activatedCoins: string[] = [];

/**
 * Initialize WebSocket and subscribe to all discovered coins
 */
async function initializeStreaming(): Promise<void> {
  try {
    info("Main", "Initializing WebSocket streaming (1h candles)...");
    await candleStreamer.connect();
    info("Main", "Candle WebSocket connected");
  } catch (err) {
    error("Main", "Failed to initialize streaming", err);
    throw err;
  }
}

/**
 * Discover new markets and update subscription list
 */
async function discoverAndSubscribe(): Promise<void> {
  try {
    const coins = await discoverMarkets();
    info("Main", `Discovered ${coins.length} active perpetual markets`);

    // Update the full list of available coins
    // The candleStreamer will automatically manage subscriptions (limited to MAX_ACTIVE_SUBSCRIPTIONS)
    candleStreamer.setAvailableCoins(coins);
    
    activatedCoins = coins;
    
    // Log subscription stats
    const stats = candleStreamer.getSubscriptionStats();
    info("Main", `Subscription stats: ${stats.confirmed}/${stats.subscribed} active (of ${stats.total} total markets)`);
  } catch (err) {
    error("Main", "Error during market discovery", err);
  }
}

/**
 * Run breakout detection for all active coins
 */
async function runBreakoutDetection(): Promise<void> {
  try {
    console.log(`\n${"+".repeat(70)}`);
    console.log(`BREAKOUT DETECTION - ${new Date().toISOString()}`);
    console.log(`Analyzing ${activatedCoins.length} coins...`);
    console.log(`${"+".repeat(70)}\n`);
    
    const startTime = Date.now();
    
    // Detect breakouts
    const signals = await detectBreakouts(activatedCoins);
    
    // Store signals in history
    for (const signal of signals) {
      await storeBreakoutSignal(signal);
    }
    
    const duration = Date.now() - startTime;
    const message = `Breakout detection completed in ${duration}ms. Found ${signals.length} breakout${signals.length !== 1 ? 's' : ''}`;
    console.log(`[Main] ${message}\n`);
    console.log(`${"+".repeat(70)}\n`);
    
    // Send Telegram notification about detection run
    const { notifyCustom } = await import("./utils/telegramNotifier.js");
    if (signals.length === 0) {
      await notifyCustom(
        `🔍 *Detection Complete*\n\n` +
        `Analyzed: ${activatedCoins.length} coins\n` +
        `Duration: ${duration}ms\n` +
        `Result: No breakouts detected\n` +
        `Time: ${new Date().toLocaleString()}`
      );
    } else {
      await notifyCustom(
        `✅ *Detection Complete*\n\n` +
        `Analyzed: ${activatedCoins.length} coins\n` +
        `Duration: ${duration}ms\n` +
        `Found: ${signals.length} breakout${signals.length !== 1 ? 's' : ''}\n` +
        `Time: ${new Date().toLocaleString()}`
      );
    }
  } catch (err) {
    error("Main", "Error in breakout detection", err);
  }
}

/**
 * Evaluate historical breakout outcomes
 */
async function evaluateBreakouts(): Promise<void> {
  try {
    console.log("\n[Main] Evaluating historical breakout outcomes");
    await evaluateBreakoutHistory();
    console.log("[Main] Breakout evaluation completed\n");
  } catch (err) {
    error("Main", "Error evaluating breakouts", err);
  }
}

/**
 * Main startup sequence
 */
async function start(): Promise<void> {
  try {
    console.log("=".repeat(70));
    console.log("HYPERLIQUID BREAKOUT DETECTOR");
    console.log("=".repeat(70));
    console.log("");

    // Initialize Telegram notifications
    initTelegram();
    if (isTelegramEnabled()) {
      console.log("✓ Telegram notifications enabled");
    } else {
      console.log("⚠ Telegram notifications disabled (no credentials configured)");
    }
    console.log("");

    // Initial setup
    await initializeStreaming();
    await discoverAndSubscribe();
    
    info("Main", `Monitoring ${activatedCoins.length} coins for breakouts`);
    
    // Wait for snapshot candles to load, then run initial detection
    console.log(`⏳ Waiting 30 seconds for all snapshot candles to load...`);
    setTimeout(async () => {
      console.log(`\n🔍 Running initial detection with snapshot data...\n`);
      await runBreakoutDetection();
      
      // Show next expected live candle time
      const nextHourTime = new Date();
      nextHourTime.setHours(nextHourTime.getHours() + 1, 0, 0, 0);
      const minutesUntilNext = Math.ceil((nextHourTime.getTime() - Date.now()) / 60000);
      console.log(`\n⏰ Waiting for next hourly candles...`);
      console.log(`   Expected at: ${nextHourTime.toLocaleTimeString()} (in ${minutesUntilNext} minutes)`);
      console.log(`   ${activatedCoins.length} coins subscribed and ready\n`);
    }, 30000); // 30 seconds to allow all snapshots to be fetched
    
    // Log status showing system is waiting for hourly candles
    const now = new Date();
    const currentMinute = now.getMinutes();
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    
    console.log(`📥 Fetching most recent completed candles for all ${activatedCoins.length} coins...`);
    console.log(`⏰ Next live candles expected at: ${nextHour.toLocaleTimeString()}`);
    console.log(`📊 WebSocket subscriptions active - will receive candles automatically`);
    console.log(`🔍 Detection will run automatically when new hourly candles arrive\n`);

    // Schedule breakout detection at 1 minute past each hour (after hourly candles arrive)
    cron.schedule("1 * * * *", async () => {
      if (activatedCoins.length > 0) {
        info("Main", "Running scheduled hourly breakout detection...");
        await runBreakoutDetection();
      }
    });

    // Schedule market discovery every 5 minutes
    cron.schedule("*/5 * * * *", async () => {
      info("Main", "Running scheduled market discovery...");
      await discoverAndSubscribe();
    });

    // Schedule hourly status log (at :55 to remind candles coming soon)
    cron.schedule("55 * * * *", () => {
      const now = new Date();
      const nextHour = new Date(now);
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
      const stats = candleStreamer.getSubscriptionStats();
      console.log(`\n${"-".repeat(70)}`);
      console.log(`⏰ SYSTEM STATUS - ${now.toLocaleString()}`);
      console.log(`${"-".repeat(70)}`);
      console.log(`   Total markets: ${stats.total} coins`);
      console.log(`   Active subscriptions: ${stats.confirmed} coins (confirmed)`);
      console.log(`   WebSocket: ${candleStreamer.isConnected() ? 'Connected' : 'Disconnected'}`);
      console.log(`   Next candles: ${nextHour.toLocaleTimeString()} (~5 minutes)`);
      console.log(`   Detection: Will trigger automatically when candles arrive`);
      console.log(`${"-".repeat(70)}\n`);
    });

    // Schedule breakout evaluation every 6 hours
    cron.schedule("0 */6 * * *", async () => {
      if (activatedCoins.length > 0) {
        await evaluateBreakouts();
      }
    });

    // Schedule statistics report every 24 hours
    cron.schedule("0 0 * * *", async () => {
      console.log("\n" + "=".repeat(70));
      console.log("DAILY BREAKOUT STATISTICS REPORT");
      console.log("=".repeat(70) + "\n");
      
      await printBreakoutStats(90); // Last 90 days
      
      console.log("=".repeat(70) + "\n");
    });

    console.log("\n✓ Hyperliquid Breakout Detector started successfully");
    console.log("  - Monitoring 1-hour candles for high-confidence breakouts");
    console.log("  - Real-time detection: Runs automatically when new candles arrive");
    console.log("  - Tracking 3-month historical breakout data");
    console.log("  - Telegram notifications for all detection runs");
    console.log("");
  } catch (error) {
    console.error("Fatal error during startup:", error);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown(): Promise<void> {
  console.log("\nShutting down Hyperliquid Breakout Detector...");
  
  candleStreamer.close();
  await redis.quit();
  console.log("✓ Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});