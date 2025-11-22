import "dotenv/config";
import { getTimeRange } from "./historicalDataFetcher.js";
import { backtestAll, calculateStatistics } from "./backtester.js";
import {
  fetchMultiAssetHistoricalCandlesForSymbols,
  getDefaultMultiAssetSymbols,
} from "./multiAssetHistoricalFetcher.js";
import { initTelegram, notifyBacktestResults } from "../utils/telegramNotifier.js";
import { info } from "../utils/logger.js";

type Stats = ReturnType<typeof calculateStatistics>;

function printReport(stats: Stats): void {
  const totalForPct = Math.max(stats.totalBreakouts, 1);

  console.log("\n" + "=".repeat(80));
  console.log("MULTI-ASSET BACKTEST RESULTS");
  console.log("=".repeat(80));

  console.log("\n📊 SUMMARY");
  console.log("─".repeat(80));
  console.log(`  Breakouts Found:     ${stats.totalBreakouts}`);
  console.log(
    `  Successful:          ${stats.successfulBreakouts} (${stats.successRate.toFixed(1)}%)`
  );
  console.log(
    `  Strong Breakouts:    ${stats.strongBreakouts} (${(
      (stats.strongBreakouts / totalForPct) *
      100
    ).toFixed(1)}%)`
  );
  console.log(`  Long Breakouts:      ${stats.longBreakouts}`);
  console.log(`  Short Breakouts:     ${stats.shortBreakouts}`);

  console.log("\n📈 AVERAGE PERFORMANCE");
  console.log("─".repeat(80));
  console.log(`  1h:   ${stats.avgGain1h >= 0 ? "+" : ""}${stats.avgGain1h.toFixed(2)}%`);
  console.log(`  4h:   ${stats.avgGain4h >= 0 ? "+" : ""}${stats.avgGain4h.toFixed(2)}%`);
  console.log(`  12h:  ${stats.avgGain12h >= 0 ? "+" : ""}${stats.avgGain12h.toFixed(2)}%`);
  console.log(`  24h:  ${stats.avgGain24h >= 0 ? "+" : ""}${stats.avgGain24h.toFixed(2)}%`);

  console.log("\n🏦 CLASS BREAKDOWN");
  console.log("─".repeat(80));
  console.log("  Class       Breakouts  Win Rate  Avg 24h");
  Object.entries(stats.classBreakdown).forEach(([cls, summary]) => {
    console.log(
      `  ${cls.padEnd(10)}  ${summary.count.toString().padStart(9)}  ${summary.winRate
        .toFixed(1)
        .padStart(7)}%  ${summary.avg24h >= 0 ? "+" : ""}${summary.avg24h.toFixed(2)}%`
    );
  });

  console.log("\n🏆 TOP 10 BREAKOUTS");
  console.log("─".repeat(80));
  stats.topPerformers.slice(0, 10).forEach((p, i) => {
    const date = new Date(p.timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    console.log(
      `  ${(i + 1).toString().padStart(2)}. ${p.coin.padEnd(10)} +${p.gain
        .toFixed(1)
        .padStart(5)}%  Conf: ${p.confidence}/100  ${date}`
    );
  });

  console.log("\n" + "=".repeat(80));
}

function parseSymbolsArg(arg?: string): string[] {
  if (!arg || arg.toLowerCase() === "all") {
    return getDefaultMultiAssetSymbols();
  }

  return arg
    .split(",")
    .map((sym) => sym.trim().toUpperCase())
    .filter(Boolean);
}

async function runMultiAssetBacktest(symbols: string[], months: number = 3): Promise<void> {
  const { startTime, endTime } = getTimeRange(months);

  console.log("\n" + "=".repeat(80));
  console.log("MULTI-ASSET BREAKOUT BACKTEST");
  console.log("=".repeat(80));
  console.log(
    `Period:  ${new Date(startTime).toLocaleDateString()} - ${new Date(
      endTime
    ).toLocaleDateString()}`
  );
  console.log(`Symbols: ${symbols.length}`);
  console.log(`Months:  ${months}`);
  console.log("=".repeat(80) + "\n");

  const historicalData = await fetchMultiAssetHistoricalCandlesForSymbols(
    symbols,
    startTime,
    endTime
  );

  if (historicalData.size === 0) {
    throw new Error("No historical data fetched. Aborting backtest.");
  }

  const results = backtestAll(historicalData);
  info("MultiAssetBacktest", "Calculating statistics...");
  const stats = calculateStatistics(results);
  printReport(stats);

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
    coins: symbols.length,
    topPerformers: stats.topPerformers,
    coinBreakdown: stats.coinBreakdown,
    allBreakouts: [],
  });
}

async function main(): Promise<void> {
  initTelegram();

  try {
    const command = process.argv[2] || "run";
    const months = parseInt(process.argv[3] || "3", 10);
    const symbolsArg = process.argv[4];

    if (command !== "run") {
      console.log("\nUsage:");
      console.log("  node dist/backtest/multiAssetBacktestRunner.js run [months] [symbols]");
      console.log("\nExamples:");
      console.log("  node dist/backtest/multiAssetBacktestRunner.js run 3");
      console.log("  node dist/backtest/multiAssetBacktestRunner.js run 1 EURUSD=X,AAPL,CL=F");
      process.exit(1);
    }

    const symbols = parseSymbolsArg(symbolsArg);
    await runMultiAssetBacktest(symbols, months);
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Multi-asset backtest failed:", err);
    process.exit(1);
  }
}

main();

