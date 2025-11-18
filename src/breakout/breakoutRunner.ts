/**
 * Breakout Detection Runner
 * 
 * Orchestrates breakout detection and history tracking
 */

import "dotenv/config";
import redis from "../utils/redisClient.js";
import { discoverMarkets } from "../cron/discoverMarkets.js";
import { run as detectBreakouts } from "./breakoutDetector.js";
import { storeBreakoutSignal, run as evaluateHistory, printBreakoutStats } from "./breakoutHistory.js";
import { info } from "../utils/logger.js";
import { initTelegram } from "../utils/telegramNotifier.js";

/**
 * Get list of active coins from Redis
 */
async function getActiveCoins(): Promise<string[]> {
  try {
    // Try to get from candle keys first
    const candleKeys = await redis.keys("candles:1h:*");
    if (candleKeys.length > 0) {
      return candleKeys.map(k => k.replace("candles:1h:", ""));
    }
    
    // Fallback to market discovery
    return await discoverMarkets();
  } catch (error) {
    console.error("Error getting active coins:", error);
    return [];
  }
}

/**
 * Run breakout detection cycle
 */
export async function runBreakoutDetection(): Promise<void> {
  info("BreakoutRunner", "Starting breakout detection cycle");
  
  const coins = await getActiveCoins();
  
  if (coins.length === 0) {
    console.log("⚠ No active coins found");
    return;
  }
  
  info("BreakoutRunner", `Analyzing ${coins.length} coins for breakouts`);
  
  // Detect breakouts
  const signals = await detectBreakouts(coins);
  
  // Store signals in history
  for (const signal of signals) {
    await storeBreakoutSignal(signal);
  }
  
  info("BreakoutRunner", `Detection cycle complete. Found ${signals.length} breakouts`);
}

/**
 * Run history evaluation and stats
 */
export async function runHistoryEvaluation(): Promise<void> {
  info("BreakoutRunner", "Running history evaluation");
  await evaluateHistory();
  info("BreakoutRunner", "History evaluation complete");
}

/**
 * Show statistics
 */
export async function showStats(days: number = 90): Promise<void> {
  await printBreakoutStats(days);
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const command = process.argv[2] || "detect";
  
  // Initialize Telegram
  initTelegram();
  
  try {
    console.log(`Breakout Runner - Command: ${command}`);
    console.log("=".repeat(70));
    
    switch (command) {
      case "detect":
        await runBreakoutDetection();
        break;
        
      case "evaluate":
        await runHistoryEvaluation();
        break;
        
      case "stats":
        const days = parseInt(process.argv[3] || "90", 10);
        await showStats(days);
        break;
        
      case "all":
        await runBreakoutDetection();
        await runHistoryEvaluation();
        await showStats(90);
        break;
        
      default:
        console.log("\nUsage:");
        console.log("  node dist/breakout/breakoutRunner.js [command]");
        console.log("\nCommands:");
        console.log("  detect   - Run breakout detection (default)");
        console.log("  evaluate - Evaluate historical breakout outcomes");
        console.log("  stats [days] - Show breakout statistics (default: 90 days)");
        console.log("  all      - Run all tasks");
        process.exit(1);
    }
    
    console.log("\n✓ Command completed successfully");
    await redis.quit();
    process.exit(0);
  } catch (error) {
    console.error("\n✗ Command failed:", error);
    await redis.quit();
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down breakout runner...");
  await redis.quit();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down breakout runner...");
  await redis.quit();
  process.exit(0);
});

main();

