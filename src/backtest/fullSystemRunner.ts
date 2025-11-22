/**
 * Full-System Backtest Runner
 * 
 * Command-line interface for running the full-system historical backtester
 */

import "dotenv/config";
import { discoverMarkets } from "../cron/discoverMarkets.js";
import { runFullSystemBacktest } from "./fullSystemBacktester.js";
import { initTelegram, notifyBacktestResults } from "../utils/telegramNotifier.js";
import { writeFileSync } from "fs";

/**
 * Print comprehensive results report
 */
function printResults(
  results: Awaited<ReturnType<typeof runFullSystemBacktest>>,
  topPerformers: Array<{ signal: { coin: string; timestamp: number; confidenceScore: number }; outcome: { gain24h: number } }>,
  coinBreakdown: Array<{ coin: string; count: number; winRate: number; avgGain: number }>
): void {
  console.log("\n" + "=".repeat(80));
  console.log("FULL-SYSTEM BACKTEST RESULTS");
  console.log("=".repeat(80));
  
  console.log("\n📊 METADATA");
  console.log("─".repeat(80));
  console.log(`  Period:     ${new Date(results.metadata.startTime).toLocaleDateString()} - ${new Date(results.metadata.endTime).toLocaleDateString()}`);
  console.log(`  Coins:       ${results.metadata.coins}`);
  console.log(`  Total Hours: ${results.metadata.totalHours}`);
  console.log(`  Breakouts:   ${results.metadata.breakoutsDetected}`);
  
  console.log("\n📈 PERFORMANCE STATISTICS");
  console.log("─".repeat(80));
  const strongPct = results.statistics.totalBreakouts > 0
    ? (results.statistics.strongBreakouts / results.statistics.totalBreakouts) * 100
    : 0;
  const moderatePct = results.statistics.totalBreakouts > 0
    ? (results.statistics.moderateBreakouts / results.statistics.totalBreakouts) * 100
    : 0;
  console.log(`  Total Breakouts:      ${results.statistics.totalBreakouts}`);
  console.log(`  Successful (3%+):     ${results.statistics.successfulBreakouts} (${results.statistics.successRate.toFixed(1)}%)`);
  console.log(`  Strong Breakouts:     ${results.statistics.strongBreakouts} (${strongPct.toFixed(1)}%)`);
  console.log(`  Moderate Breakouts:   ${results.statistics.moderateBreakouts} (${moderatePct.toFixed(1)}%)`);
  console.log(`  Long Breakouts:       ${results.statistics.longBreakouts}`);
  console.log(`  Short Breakouts:      ${results.statistics.shortBreakouts}`);
  
  console.log("\n💰 AVERAGE GAINS BY HORIZON");
  console.log("─".repeat(80));
  console.log(`  1 Hour:   ${results.statistics.avgGain1h >= 0 ? '+' : ''}${results.statistics.avgGain1h.toFixed(2)}%`);
  console.log(`  4 Hours:  ${results.statistics.avgGain4h >= 0 ? '+' : ''}${results.statistics.avgGain4h.toFixed(2)}%`);
  console.log(`  12 Hours: ${results.statistics.avgGain12h >= 0 ? '+' : ''}${results.statistics.avgGain12h.toFixed(2)}%`);
  console.log(`  24 Hours: ${results.statistics.avgGain24h >= 0 ? '+' : ''}${results.statistics.avgGain24h.toFixed(2)}%`);
  
  // Top performers
  if (topPerformers.length > 0) {
    console.log("\n🏆 TOP 20 BREAKOUTS");
    console.log("─".repeat(80));
    topPerformers.forEach((b, i) => {
      const timestamp = new Date(b.signal.timestamp);
      const dateStr = timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timeStr = timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      console.log(
        `  ${(i + 1).toString().padStart(2)}. ${b.signal.coin.padEnd(8)} ` +
        `+${b.outcome.gain24h.toFixed(1).padStart(5)}%  ` +
        `Conf: ${b.signal.confidenceScore}/100  ` +
        `${dateStr} ${timeStr}`
      );
    });
  }
  
  // Coin breakdown
  if (coinBreakdown.length > 0) {
    console.log("\n💎 TOP PERFORMING COINS");
    console.log("─".repeat(80));
    console.log("   Coin      Breakouts  Win Rate  Avg Gain");
    console.log("─".repeat(80));
    coinBreakdown.forEach(c => {
      console.log(
        `   ${c.coin.padEnd(8)}  ` +
        `${c.count.toString().padStart(9)}  ` +
        `${c.winRate.toFixed(0).padStart(7)}%  ` +
        `${c.avgGain >= 0 ? '+' : ''}${c.avgGain.toFixed(1)}%`
      );
    });
  }
  
  // Assessment
  console.log("\n" + "=".repeat(80));
  console.log("ASSESSMENT");
  console.log("=".repeat(80));
  
  const assessments: string[] = [];
  
  if (results.statistics.successRate >= 70) {
    assessments.push("✅ Excellent success rate (70%+)");
  } else if (results.statistics.successRate >= 60) {
    assessments.push("✅ Good success rate (60%+)");
  } else if (results.statistics.successRate >= 50) {
    assessments.push("⚠️  Moderate success rate (50%+)");
  } else {
    assessments.push("❌ Poor success rate (<50%)");
  }
  
  if (results.statistics.avgGain24h >= 5) {
    assessments.push("✅ Excellent average gain (5%+)");
  } else if (results.statistics.avgGain24h >= 3) {
    assessments.push("✅ Good average gain (3%+)");
  } else {
    assessments.push("⚠️  Moderate average gain (<3%)");
  }
  
  const strongShare = results.statistics.totalBreakouts > 0
    ? (results.statistics.strongBreakouts / results.statistics.totalBreakouts) * 100
    : 0;
  if (strongShare >= 25) {
    assessments.push(`✅ Good quality (${strongShare.toFixed(0)}% strong)`);
  } else {
    assessments.push(`⚠️  Lower quality (${strongShare.toFixed(0)}% strong)`);
  }
  
  assessments.forEach(a => console.log(`  ${a}`));
  
  console.log("\n" + "=".repeat(80) + "\n");
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  try {
    initTelegram();
    
    const command = process.argv[2] || "run";
    const months = parseInt(process.argv[3] || "3", 10);
    
    if (command === "run") {
      console.log("\n🔍 Discovering active markets...");
      const coins = await discoverMarkets();
      console.log(`✓ Found ${coins.length} active markets\n`);
      
      const results = await runFullSystemBacktest(coins, months);
      
      // Calculate top performers and coin breakdown for both display and Telegram
      const topPerformers = [...results.breakouts]
        .sort((a, b) => b.outcome.gain24h - a.outcome.gain24h)
        .slice(0, 20);
      
      const coinStats = new Map<string, { count: number; wins: number; totalGain: number }>();
      for (const breakout of results.breakouts) {
        const stats = coinStats.get(breakout.signal.coin) || { count: 0, wins: 0, totalGain: 0 };
        stats.count++;
        if (breakout.outcome.success) stats.wins++;
        stats.totalGain += breakout.outcome.gain24h;
        coinStats.set(breakout.signal.coin, stats);
      }
      
      const coinBreakdown = Array.from(coinStats.entries())
        .map(([coin, stats]) => ({
          coin,
          count: stats.count,
          winRate: (stats.wins / stats.count) * 100,
          avgGain: stats.totalGain / stats.count,
        }))
        .sort((a, b) => b.avgGain - a.avgGain)
        .slice(0, 20);
      
      printResults(results, topPerformers, coinBreakdown);
      
      // Save detailed results
      console.log("💾 Saving results to backtest_results.json...");
      const output = {
        ...results,
        breakouts: results.breakouts.map(b => ({
          coin: b.signal.coin,
          timestamp: new Date(b.signal.timestamp).toISOString(),
          price: b.signal.price,
          volumeRatio: Number(b.signal.volumeRatio.toFixed(2)),
          priceChange: Number(b.signal.priceChange.toFixed(2)),
          consolidationPeriod: b.signal.consolidationPeriod,
          confidenceScore: b.signal.confidenceScore,
          breakoutType: b.signal.breakoutType,
          direction: b.signal.direction,
          ...(b.signal.resistanceLevel !== undefined
            ? { resistanceLevel: Number(b.signal.resistanceLevel.toFixed(4)) }
            : {}),
          ...(b.signal.supportLevel !== undefined
            ? { supportLevel: Number(b.signal.supportLevel.toFixed(4)) }
            : {}),
          outcome: {
            gain1h: Number(b.outcome.gain1h.toFixed(2)),
            gain4h: Number(b.outcome.gain4h.toFixed(2)),
            gain12h: Number(b.outcome.gain12h.toFixed(2)),
            gain24h: Number(b.outcome.gain24h.toFixed(2)),
            success: b.outcome.success,
          },
        })),
      };
      
      writeFileSync("backtest_results.json", JSON.stringify(output, null, 2));
      console.log("✓ Complete!\n");
      
      // Send Telegram notification with full results
      console.log("📱 Sending backtest summary to Telegram...");
      await notifyBacktestResults({
        totalBreakouts: results.statistics.totalBreakouts,
        successfulBreakouts: results.statistics.successfulBreakouts,
        successRate: results.statistics.successRate,
        avgGain1h: results.statistics.avgGain1h,
        avgGain4h: results.statistics.avgGain4h,
        avgGain12h: results.statistics.avgGain12h,
        avgGain24h: results.statistics.avgGain24h,
        strongBreakouts: results.statistics.strongBreakouts,
        moderateBreakouts: results.statistics.moderateBreakouts,
        longBreakouts: results.statistics.longBreakouts,
        shortBreakouts: results.statistics.shortBreakouts,
        months: months,
        coins: coins.length,
        topPerformers: topPerformers.map(b => ({
          coin: b.signal.coin,
          gain: b.outcome.gain24h,
          timestamp: b.signal.timestamp,
          confidence: b.signal.confidenceScore,
        })),
        coinBreakdown: coinBreakdown,
        allBreakouts: output.breakouts,
      });
      console.log("✓ Telegram notification sent!\n");
      
      process.exit(0);
    } else {
      console.log("\nUsage:");
      console.log("  node dist/backtest/fullSystemRunner.js run [months]");
      console.log("\nExamples:");
      console.log("  node dist/backtest/fullSystemRunner.js run 3   # Last 3 months (default)");
      console.log("  node dist/backtest/fullSystemRunner.js run 1   # Last 1 month");
      console.log("  node dist/backtest/fullSystemRunner.js run 6   # Last 6 months");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Backtest failed:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message);
      console.error("Stack:", error.stack);
    }
    process.exit(1);
  }
}

main();

