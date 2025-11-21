/**
 * Grid Search Runner
 * 
 * Command-line interface for running parameter grid search
 */

import "dotenv/config";
import { discoverMarkets } from "../cron/discoverMarkets.js";
import { runGridSearch, type GridSearchResult } from "./gridSearch.js";
import { initTelegram, notifyCustom } from "../utils/telegramNotifier.js";
import { writeFileSync } from "fs";

/**
 * Print grid search results
 */
function printResults(results: GridSearchResult[], topN: number = 20): void {
  console.log("\n" + "=".repeat(80));
  console.log("GRID SEARCH RESULTS");
  console.log("=".repeat(80));
  console.log(`Total Combinations Tested: ${results.length}`);
  console.log(`Showing Top ${Math.min(topN, results.length)} Results\n`);

  const topResults = results.slice(0, topN);

  topResults.forEach((result, i) => {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`RANK #${i + 1} (Score: ${result.score.toFixed(2)})`);
    console.log("─".repeat(80));
    console.log("PARAMETERS:");
    console.log(`  Min Volume Ratio:      ${result.params.minVolumeRatio}x`);
    console.log(`  Min Price Change:      ${result.params.minPriceChange}%`);
    console.log(`  Min Confidence Score:  ${result.params.minConfidenceScore}/100`);
    console.log(`  Consolidation Thresholds:`);
    console.log(`    High (12h):   ${result.params.consolidationThresholds.high}`);
    console.log(`    Medium (8h):  ${result.params.consolidationThresholds.medium}`);
    console.log(`    Low (4h):     ${result.params.consolidationThresholds.low}`);
    console.log(`  Success Threshold:     ${result.params.successThreshold}%`);
    console.log("\nPERFORMANCE:");
    console.log(`  Total Breakouts:      ${result.statistics.totalBreakouts}`);
    console.log(`  Successful:           ${result.statistics.successfulBreakouts} (${result.statistics.successRate.toFixed(1)}%)`);
    console.log(`  Strong Breakouts:     ${result.statistics.strongBreakouts} (${((result.statistics.strongBreakouts / result.statistics.totalBreakouts) * 100).toFixed(1)}%)`);
    console.log(`  Total Signals:        ${result.statistics.totalSignals}`);
    console.log(`  Avg Gain 1h:          ${result.statistics.avgGain1h >= 0 ? '+' : ''}${result.statistics.avgGain1h.toFixed(2)}%`);
    console.log(`  Avg Gain 4h:          ${result.statistics.avgGain4h >= 0 ? '+' : ''}${result.statistics.avgGain4h.toFixed(2)}%`);
    console.log(`  Avg Gain 12h:         ${result.statistics.avgGain12h >= 0 ? '+' : ''}${result.statistics.avgGain12h.toFixed(2)}%`);
    console.log(`  Avg Gain 24h:         ${result.statistics.avgGain24h >= 0 ? '+' : ''}${result.statistics.avgGain24h.toFixed(2)}%`);
  });

  console.log("\n" + "=".repeat(80));
  console.log("BEST PARAMETERS");
  console.log("=".repeat(80));
  const best = results[0];
  if (best) {
    console.log(`\nRecommended Configuration:`);
    console.log(`  minVolumeRatio: ${best.params.minVolumeRatio}`);
    console.log(`  minPriceChange: ${best.params.minPriceChange}`);
    console.log(`  minConfidenceScore: ${best.params.minConfidenceScore}`);
    console.log(`  consolidationThresholds: {`);
    console.log(`    high: ${best.params.consolidationThresholds.high},`);
    console.log(`    medium: ${best.params.consolidationThresholds.medium},`);
    console.log(`    low: ${best.params.consolidationThresholds.low}`);
    console.log(`  }`);
    console.log(`  successThreshold: ${best.params.successThreshold}`);
    console.log(`\nExpected Performance:`);
    console.log(`  Success Rate: ${best.statistics.successRate.toFixed(1)}%`);
    console.log(`  Avg 24h Gain: ${best.statistics.avgGain24h >= 0 ? '+' : ''}${best.statistics.avgGain24h.toFixed(2)}%`);
    console.log(`  Total Breakouts: ${best.statistics.totalBreakouts}`);
  }
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
    const maxCombinations = process.argv[4] ? parseInt(process.argv[4], 10) : undefined;
    
    if (command === "run") {
      console.log("\n🔍 Discovering active markets...");
      const coins = await discoverMarkets();
      console.log(`✓ Found ${coins.length} active markets\n`);
      
      const results = await runGridSearch(coins, months, maxCombinations);
      
      printResults(results, 20);
      
      // Save results
      console.log("💾 Saving results to grid_search_results.json...");
      const output = {
        metadata: {
          coins: coins.length,
          months,
          totalCombinations: results.length,
          timestamp: new Date().toISOString(),
        },
        results: results.map(r => ({
          params: r.params,
          statistics: r.statistics,
          score: r.score,
        })),
      };
      
      writeFileSync("grid_search_results.json", JSON.stringify(output, null, 2));
      console.log("✓ Complete!\n");
      
      // Send Telegram notification
      if (results.length > 0 && results[0]) {
        const best = results[0];
        const message = 
          `🔍 *GRID SEARCH COMPLETE*\n\n` +
          `*Tested:* ${results.length} combinations\n` +
          `*Period:* ${months} month${months > 1 ? 's' : ''}\n` +
          `*Coins:* ${coins.length}\n\n` +
          `*BEST PARAMETERS*\n` +
          `• Vol Ratio: ${best.params.minVolumeRatio}x\n` +
          `• Price Change: ${best.params.minPriceChange}%\n` +
          `• Confidence: ${best.params.minConfidenceScore}/100\n` +
          `• Success Threshold: ${best.params.successThreshold}%\n\n` +
          `*PERFORMANCE*\n` +
          `• Success Rate: ${best.statistics.successRate.toFixed(1)}%\n` +
          `• Avg 24h Gain: ${best.statistics.avgGain24h >= 0 ? '+' : ''}${best.statistics.avgGain24h.toFixed(2)}%\n` +
          `• Total Breakouts: ${best.statistics.totalBreakouts}\n` +
          `• Strong: ${best.statistics.strongBreakouts}\n\n` +
          `*Score:* ${best.score.toFixed(2)}`;
        
        await notifyCustom(message);
        console.log("✓ Telegram notification sent!\n");
      }
      
      process.exit(0);
    } else {
      console.log("\nUsage:");
      console.log("  node dist/backtest/gridSearchRunner.js run [months] [maxCombinations]");
      console.log("\nExamples:");
      console.log("  node dist/backtest/gridSearchRunner.js run 3        # Test all combinations (3 months)");
      console.log("  node dist/backtest/gridSearchRunner.js run 1 50      # Test first 50 combinations (1 month)");
      console.log("  node dist/backtest/gridSearchRunner.js run 3 100    # Test first 100 combinations (3 months)");
      console.log("\nNote: Full grid search tests 576 combinations. Use maxCombinations to limit for faster testing.");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Grid search failed:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message);
      console.error("Stack:", error.stack);
    }
    process.exit(1);
  }
}

main();

