/**
 * Backtest Runner
 * 
 * Runs historical backtest and generates comprehensive report
 */

import "dotenv/config";
import { discoverMarkets } from "../cron/discoverMarkets.js";
import { 
  fetchHistoricalCandlesForCoins, 
  getTimeRange 
} from "./historicalDataFetcher.js";
import { 
  backtestAll, 
  calculateStatistics 
} from "./backtester.js";
import { info } from "../utils/logger.js";
import { initTelegram, notifyBacktestResults } from "../utils/telegramNotifier.js";

/**
 * Print clean statistics report
 */
function printReport(stats: ReturnType<typeof calculateStatistics>): void {
  console.log("\n" + "=".repeat(80));
  console.log("BACKTEST RESULTS");
  console.log("=".repeat(80));
  
  // Summary
  console.log("\n📊 SUMMARY");
  console.log("─".repeat(80));
  const totalForPct = Math.max(stats.totalBreakouts, 1);
  console.log(`  Breakouts Found:     ${stats.totalBreakouts}`);
  console.log(`  Successful:          ${stats.successfulBreakouts} (${stats.successRate.toFixed(1)}%)`);
  console.log(`  Strong Breakouts:    ${stats.strongBreakouts} (${((stats.strongBreakouts / totalForPct) * 100).toFixed(1)}%)`);
  console.log(`  Moderate Breakouts:  ${stats.moderateBreakouts} (${((stats.moderateBreakouts / totalForPct) * 100).toFixed(1)}%)`);
  console.log(`  Long Breakouts:      ${stats.longBreakouts}`);
  console.log(`  Short Breakouts:     ${stats.shortBreakouts}`);
  
  // Performance
  console.log("\n📈 AVERAGE PERFORMANCE");
  console.log("─".repeat(80));
  console.log(`  1h:   ${stats.avgGain1h >= 0 ? '+' : ''}${stats.avgGain1h.toFixed(2)}%`);
  console.log(`  4h:   ${stats.avgGain4h >= 0 ? '+' : ''}${stats.avgGain4h.toFixed(2)}%`);
  console.log(`  12h:  ${stats.avgGain12h >= 0 ? '+' : ''}${stats.avgGain12h.toFixed(2)}%`);
  console.log(`  24h:  ${stats.avgGain24h >= 0 ? '+' : ''}${stats.avgGain24h.toFixed(2)}%`);
  
  // Top performers
  console.log("\n🏆 TOP 10 BREAKOUTS");
  console.log("─".repeat(80));
  stats.topPerformers.slice(0, 10).forEach((p, i) => {
    const date = new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    console.log(
      `  ${(i + 1).toString().padStart(2)}. ${p.coin.padEnd(8)} ` +
      `+${p.gain.toFixed(1).padStart(5)}%  ` +
      `Conf: ${p.confidence}/100  ` +
      `${date}`
    );
  });
  
  // Best coins
  console.log("\n💎 BEST PERFORMING COINS");
  console.log("─".repeat(80));
  console.log("   Coin      Breakouts  Win Rate  Avg Gain");
  console.log("─".repeat(80));
  stats.coinBreakdown.slice(0, 15).forEach(c => {
    console.log(
      `   ${c.coin.padEnd(8)}  ` +
      `${c.count.toString().padStart(9)}  ` +
      `${c.winRate.toFixed(0).padStart(7)}%  ` +
      `${c.avgGain >= 0 ? '+' : ''}${c.avgGain.toFixed(1)}%`
    );
  });
  
  // Assessment
  console.log("\n" + "=".repeat(80));
  console.log("ASSESSMENT");
  console.log("=".repeat(80));
  
  const rating: string[] = [];
  
  if (stats.successRate >= 70) {
    rating.push("✅ Excellent success rate (70%+)");
  } else if (stats.successRate >= 60) {
    rating.push("✅ Good success rate (60%+)");
  } else if (stats.successRate >= 50) {
    rating.push("⚠️  Moderate success rate (50%+)");
  } else {
    rating.push("❌ Poor success rate (<50%)");
  }
  
  if (stats.avgGain24h >= 5) {
    rating.push("✅ Excellent average gain (5%+)");
  } else if (stats.avgGain24h >= 3) {
    rating.push("✅ Good average gain (3%+)");
  } else {
    rating.push("⚠️  Moderate average gain (<3%)");
  }
  
  const strongPct = (stats.strongBreakouts / stats.totalBreakouts) * 100;
  if (strongPct >= 25) {
    rating.push(`✅ Good quality (${strongPct.toFixed(0)}% strong)`);
  } else {
    rating.push(`⚠️  Lower quality (${strongPct.toFixed(0)}% strong)`);
  }
  
  rating.forEach(r => console.log(`  ${r}`));
  
  console.log("\n" + "=".repeat(80) + "\n");
}

/**
 * Run backtest for specific coins
 */
async function runBacktest(coins: string[], months: number = 3): Promise<void> {
  const { startTime, endTime } = getTimeRange(months);
  
  console.log("\n" + "=".repeat(80));
  console.log("BREAKOUT BACKTEST");
  console.log("=".repeat(80));
  console.log(`Period:  ${new Date(startTime).toLocaleDateString()} - ${new Date(endTime).toLocaleDateString()}`);
  console.log(`Coins:   ${coins.length}`);
  console.log(`Months:  ${months}`);
  console.log("=".repeat(80) + "\n");
  
  // Fetch historical data
  const historicalData = await fetchHistoricalCandlesForCoins(
    coins, 
    startTime, 
    endTime, 
    "1h",
    3,
    1000
  );
  
  // Run backtest
  const results = backtestAll(historicalData);
  
  // Calculate statistics
  console.log("📊 Calculating performance metrics...\n");
  const stats = calculateStatistics(results);
  
  // Print report
  printReport(stats);
  
  // Save detailed results
  console.log("💾 Saving results to backtest_results.json...");
  const detailedResults: any = {
    metadata: {
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      coins: coins.length,
      months,
      totalBreakouts: stats.totalBreakouts,
      successRate: stats.successRate,
    },
    summary: stats,
    breakouts: [],
  };
  
  for (const [coin, coinResults] of results) {
    for (const result of coinResults) {
      detailedResults.breakouts.push({
        coin,
        timestamp: new Date(result.breakout.timestamp).toISOString(),
        price: result.breakout.price,
        volumeRatio: Number(result.breakout.volumeRatio.toFixed(2)),
        priceChange: Number(result.breakout.priceChange.toFixed(2)),
        consolidationPeriod: result.breakout.consolidationPeriod,
        confidenceScore: result.breakout.confidenceScore,
        breakoutType: result.breakout.breakoutType,
        direction: result.breakout.direction,
        resistanceLevel: result.breakout.resistanceLevel !== undefined
          ? Number(result.breakout.resistanceLevel.toFixed(4))
          : undefined,
        supportLevel: result.breakout.supportLevel !== undefined
          ? Number(result.breakout.supportLevel.toFixed(4))
          : undefined,
        outcome: {
          gain1h: Number(result.outcome.gain1h.toFixed(2)),
          gain4h: Number(result.outcome.gain4h.toFixed(2)),
          gain12h: Number(result.outcome.gain12h.toFixed(2)),
          gain24h: Number(result.outcome.gain24h.toFixed(2)),
          success: result.outcome.success,
        },
      });
    }
  }
  
  const fs = await import("fs");
  fs.writeFileSync(
    "backtest_results.json",
    JSON.stringify(detailedResults, null, 2)
  );
  console.log("✓ Complete!\n");
  
  // Send Telegram notification with full results including all breakouts
  await notifyBacktestResults({
    totalBreakouts: stats.totalBreakouts,
    successfulBreakouts: stats.successfulBreakouts,
    successRate: stats.successRate,
    avgGain1h: stats.avgGain1h,
    avgGain4h: stats.avgGain4h,
    avgGain12h: stats.avgGain12h,
    avgGain24h: stats.avgGain24h,
    strongBreakouts: stats.strongBreakouts,
    moderateBreakouts: stats.moderateBreakouts,
    longBreakouts: stats.longBreakouts,
    shortBreakouts: stats.shortBreakouts,
    months,
    coins: coins.length,
    topPerformers: stats.topPerformers,
    coinBreakdown: stats.coinBreakdown,
    allBreakouts: detailedResults.breakouts,
  });
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  // Initialize Telegram
  initTelegram();
  
  try {
    const command = process.argv[2] || "run";
    const months = parseInt(process.argv[3] || "3", 10);
    
    if (command === "run") {
      // Discover all active coins
      console.log("\n🔍 Discovering active markets...");
      const coins = await discoverMarkets();
      console.log(`✓ Found ${coins.length} active markets\n`);
      
      // Run backtest
      await runBacktest(coins, months);
      
      process.exit(0);
    } else {
      console.log("\nUsage:");
      console.log("  node dist/backtest/backtestRunner.js run [months]");
      console.log("\nExamples:");
      console.log("  node dist/backtest/backtestRunner.js run 3   # Last 3 months (default)");
      console.log("  node dist/backtest/backtestRunner.js run 1   # Last 1 month");
      console.log("  node dist/backtest/backtestRunner.js run 6   # Last 6 months");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Backtest failed:", error);
    process.exit(1);
  }
}

main();

