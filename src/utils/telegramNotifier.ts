/**
 * Telegram Notifier
 * 
 * Sends alerts to Telegram for breakout signals and backtest results
 */

import TelegramBot from "node-telegram-bot-api";
import { info, warn, error as logError } from "./logger.js";
import type { BreakoutSignal } from "../breakout/breakoutDetector.js";
import type { IntradaySignal } from "../breakout/intradayTypes.js";

let bot: TelegramBot | null = null;
let chatId: string | null = null;
let isEnabled = false;

/**
 * Initialize Telegram bot
 */
export function initTelegram(): void {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !telegramChatId) {
    warn("TelegramNotifier", "Telegram credentials not configured. Notifications disabled.");
    isEnabled = false;
    return;
  }

  try {
    bot = new TelegramBot(botToken, { polling: false });
    chatId = telegramChatId;
    isEnabled = true;
    info("TelegramNotifier", "Telegram bot initialized successfully");
  } catch (err) {
    logError("TelegramNotifier", "Failed to initialize Telegram bot", err);
    isEnabled = false;
  }
}

/**
 * Check if Telegram is enabled
 */
export function isTelegramEnabled(): boolean {
  return isEnabled;
}

/**
 * Send a Telegram message
 */
async function sendMessage(message: string, parseMode: "Markdown" | "HTML" = "Markdown"): Promise<void> {
  if (!isEnabled || !bot || !chatId) {
    return;
  }

  try {
    await bot.sendMessage(chatId, message, { parse_mode: parseMode });
  } catch (err) {
    logError("TelegramNotifier", "Failed to send Telegram message", err);
  }
}

/**
 * Format breakout signal for Telegram
 */
function formatBreakoutMessage(signal: BreakoutSignal): string {
  const icon = signal.breakoutType === "strong" ? "🚀" : signal.breakoutType === "moderate" ? "📈" : "⚡";
  const timestamp = new Date(signal.timestamp).toLocaleString();
  const isShort = signal.direction === "short";
  const levelLabel = isShort ? "Support" : "Resistance";
  const referenceLevel = isShort ? signal.supportLevel : signal.resistanceLevel;
  const levelValue = referenceLevel ?? signal.price;
  const priceChangePrefix = isShort ? "-" : "+";
  const directionLabel = isShort ? "SHORT ⬇️" : "LONG ⬆️";
  
  return `${icon} *BREAKOUT DETECTED*\n\n` +
    `*Coin:* ${signal.coin}\n` +
    `*Direction:* ${directionLabel}\n` +
    `*Type:* ${signal.breakoutType.toUpperCase()}\n` +
    `*Confidence:* ${signal.confidenceScore}/100\n\n` +
    `*Price:* $${signal.price.toFixed(4)}\n` +
    `*Price Change:* ${priceChangePrefix}${signal.priceChange.toFixed(2)}%\n` +
    `*Volume Ratio:* ${signal.volumeRatio.toFixed(1)}x\n` +
    `*${levelLabel}:* $${levelValue.toFixed(4)}\n` +
    `*Consolidation:* ${signal.consolidationPeriod}h\n\n` +
    `*Time:* ${timestamp}`;
}

/**
 * Send breakout notification
 */
export async function notifyBreakout(signal: BreakoutSignal): Promise<void> {
  if (!isEnabled) {
    return;
  }

  const message = formatBreakoutMessage(signal);
  await sendMessage(message);
  info("TelegramNotifier", `Sent breakout notification for ${signal.coin}`);
}

/**
 * Send all breakouts in batched messages
 */
export async function notifyAllBreakouts(breakouts: Array<{
  coin: string;
  timestamp: string;
  price: number;
  volumeRatio: number;
  priceChange: number;
  confidenceScore: number;
  breakoutType: string;
  direction: "long" | "short";
  outcome: {
    gain24h: number;
    success: boolean;
  };
}>): Promise<void> {
  if (!isEnabled || breakouts.length === 0) {
    return;
  }

  info("TelegramNotifier", `Sending ${breakouts.length} breakouts in batches...`);

  // Send in batches of 50 to avoid message limits
  const batchSize = 50;
  const totalBatches = Math.ceil(breakouts.length / batchSize);

  for (let i = 0; i < totalBatches; i++) {
    const start = i * batchSize;
    const end = Math.min(start + batchSize, breakouts.length);
    const batch = breakouts.slice(start, end);

    let message = `📋 *ALL BREAKOUTS (${start + 1}-${end} of ${breakouts.length})*\n\n`;
    message += `\`\`\`\n`;
    message += `Coin     Dir Date          Time     Price  Vol Conf 24h\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    batch.forEach(b => {
      const timestamp = new Date(b.timestamp);
      const coin = b.coin.padEnd(8);
      const dir = (b.direction === "short" ? "S" : "L").padEnd(3);
      const date = timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).padEnd(9);
      const time = timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }).padEnd(8);
      const price = `$${b.price.toFixed(2)}`.padEnd(6);
      const vol = `${b.volumeRatio.toFixed(1)}x`.padEnd(4);
      const conf = b.confidenceScore.toString().padStart(3);
      const gain = `${b.outcome.gain24h >= 0 ? '+' : ''}${b.outcome.gain24h.toFixed(0)}%`.padEnd(5);
      const status = b.outcome.success ? '✓' : '✗';
      
      message += `${coin} ${dir} ${date} ${time} ${price} ${vol} ${conf}  ${gain} ${status}\n`;
    });

    message += `\`\`\``;

    await sendMessage(message);
    
    // Small delay between batches to avoid rate limiting
    if (i < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  info("TelegramNotifier", `Sent all ${breakouts.length} breakouts in ${totalBatches} batches`);
}

/**
 * Send backtest results notification with full details
 */
export async function notifyBacktestResults(stats: {
  totalBreakouts: number;
  successfulBreakouts: number;
  successRate: number;
  avgGain1h: number;
  avgGain4h: number;
  avgGain12h: number;
  avgGain24h: number;
  strongBreakouts: number;
  moderateBreakouts: number;
  longBreakouts?: number;
  shortBreakouts?: number;
  months: number;
  coins: number;
  topPerformers: Array<{ coin: string; gain: number; timestamp: number; confidence: number }>;
  coinBreakdown: Array<{ coin: string; count: number; winRate: number; avgGain: number }>;
  allBreakouts?: Array<{
    coin: string;
    timestamp: string;
    price: number;
    volumeRatio: number;
    priceChange: number;
    confidenceScore: number;
    breakoutType: string;
    direction: "long" | "short";
    resistanceLevel?: number;
    supportLevel?: number;
    outcome: {
      gain24h: number;
      success: boolean;
    };
  }>;
}): Promise<void> {
  if (!isEnabled) {
    return;
  }

  const rating = stats.successRate >= 70 ? "🟢 Excellent" : 
                 stats.successRate >= 60 ? "🟡 Good" : 
                 stats.successRate >= 50 ? "🟠 Moderate" : "🔴 Poor";
  const longCount = stats.longBreakouts ?? 0;
  const shortCount = stats.shortBreakouts ?? 0;
  const totalForPct = Math.max(stats.totalBreakouts, 1);

  // Summary message
  let message = `📊 *BACKTEST COMPLETED*\n\n` +
    `*Period:* ${stats.months} month${stats.months > 1 ? 's' : ''}\n` +
    `*Coins Analyzed:* ${stats.coins}\n\n` +
    `*SUMMARY*\n` +
    `• Total Breakouts: ${stats.totalBreakouts}\n` +
    `• Successful: ${stats.successfulBreakouts} (${stats.successRate.toFixed(1)}%)\n` +
    `• Strong: ${stats.strongBreakouts} (${((stats.strongBreakouts / totalForPct) * 100).toFixed(1)}%)\n` +
    `• Moderate: ${stats.moderateBreakouts} (${((stats.moderateBreakouts / totalForPct) * 100).toFixed(1)}%)\n` +
    `• Long Signals: ${longCount}\n` +
    `• Short Signals: ${shortCount}\n\n` +
    `*AVERAGE PERFORMANCE*\n` +
    `• 1h:  ${stats.avgGain1h >= 0 ? '+' : ''}${stats.avgGain1h.toFixed(2)}%\n` +
    `• 4h:  ${stats.avgGain4h >= 0 ? '+' : ''}${stats.avgGain4h.toFixed(2)}%\n` +
    `• 12h: ${stats.avgGain12h >= 0 ? '+' : ''}${stats.avgGain12h.toFixed(2)}%\n` +
    `• 24h: ${stats.avgGain24h >= 0 ? '+' : ''}${stats.avgGain24h.toFixed(2)}%\n\n` +
    `*Rating:* ${rating}`;

  await sendMessage(message);

  // Top performers message
  if (stats.topPerformers.length > 0) {
    const topCount = Math.min(10, stats.topPerformers.length);
    let topMessage = `🏆 *TOP ${topCount} BREAKOUTS*\n\n`;
    
    stats.topPerformers.slice(0, topCount).forEach((p, i) => {
      const timestamp = new Date(p.timestamp);
      const dateStr = timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timeStr = timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      topMessage += `${i + 1}. ${p.coin} +${p.gain.toFixed(1)}% (${p.confidence}/100) ${dateStr} ${timeStr}\n`;
    });

    await sendMessage(topMessage);
  }

  // Best coins message
  if (stats.coinBreakdown.length > 0) {
    const coinCount = Math.min(15, stats.coinBreakdown.length);
    let coinMessage = `💎 *TOP ${coinCount} PERFORMING COINS*\n\n`;
    coinMessage += `\`\`\`\n`;
    coinMessage += `Coin     Signals  WinRate  AvgGain\n`;
    coinMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    stats.coinBreakdown.slice(0, coinCount).forEach(c => {
      const coin = c.coin.padEnd(8);
      const count = c.count.toString().padStart(7);
      const winRate = `${c.winRate.toFixed(0)}%`.padStart(7);
      const avgGain = `${c.avgGain >= 0 ? '+' : ''}${c.avgGain.toFixed(1)}%`;
      coinMessage += `${coin} ${count} ${winRate}  ${avgGain}\n`;
    });
    
    coinMessage += `\`\`\``;

    await sendMessage(coinMessage);
  }

  // Send all breakouts if provided
  if (stats.allBreakouts && stats.allBreakouts.length > 0) {
    await notifyAllBreakouts(stats.allBreakouts);
  }

  info("TelegramNotifier", "Sent complete backtest results notification");
}

/**
 * Send custom notification
 */
export async function notifyCustom(message: string): Promise<void> {
  if (!isEnabled) {
    return;
  }

  await sendMessage(message);
  info("TelegramNotifier", "Sent custom notification");
}

/**
 * Format intraday signal for Telegram (Model-2)
 */
function formatIntradayMessage(signal: IntradaySignal): string {
  const patternIcons = {
    micro_breakout: "⚡",
    volatility_breakout: "💥",
    liquidity_trap: "🎯",
  };

  const icon = patternIcons[signal.pattern] || "📊";
  const directionLabel = signal.direction === "long" ? "LONG ⬆️" : "SHORT ⬇️";
  const timestamp = new Date(signal.timestamp).toLocaleString();
  const patternName = signal.pattern.replace(/_/g, " ").toUpperCase();

  return (
    `${icon} *INTRADAY BREAKOUT*\n\n` +
    `*Symbol:* ${signal.symbol}\n` +
    `*Class:* ${signal.class.toUpperCase()}\n` +
    `*Timeframe:* ${signal.timeframe}\n` +
    `*Pattern:* ${patternName}\n` +
    `*Direction:* ${directionLabel}\n` +
    `*Confidence:* ${signal.confidence}/100\n\n` +
    `*Price:* $${signal.price.toFixed(4)}\n` +
    `*Price Change:* ${signal.priceChange >= 0 ? "+" : ""}${signal.priceChange.toFixed(2)}%\n` +
    `*Volume Ratio:* ${signal.volumeRatio.toFixed(2)}x\n` +
    `*Consolidation:* ${signal.consolidation} candles\n` +
    `*ATR Compression:* ${signal.atrCompression.toFixed(0)}%\n` +
    `*BB Compression:* ${signal.bbCompression.toFixed(0)}%\n\n` +
    `*Time:* ${timestamp}`
  );
}

/**
 * Send intraday breakout notification (Model-2)
 */
export async function notifyIntradayBreakout(
  signal: IntradaySignal
): Promise<void> {
  if (!isEnabled) {
    return;
  }

  const message = formatIntradayMessage(signal);
  await sendMessage(message);
  info(
    "TelegramNotifier",
    `Sent intraday notification for ${signal.symbol} ${signal.pattern}`
  );
}

/**
 * Send batch of intraday signals (summary format)
 */
export async function notifyIntradayBatch(
  signals: IntradaySignal[]
): Promise<void> {
  if (!isEnabled || signals.length === 0) {
    return;
  }

  let message = `📊 *INTRADAY SIGNALS BATCH* (${signals.length})\n\n`;
  message += "```\n";
  message += "Symbol   TF  Pattern         Conf Dir\n";
  message += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";

  signals.forEach((s) => {
    const symbol = s.symbol.substring(0, 8).padEnd(8);
    const tf = s.timeframe.padEnd(3);
    const pattern = s.pattern
      .substring(0, 14)
      .replace(/_/g, " ")
      .padEnd(14);
    const conf = s.confidence.toString().padStart(4);
    const dir = s.direction === "long" ? "L" : "S";

    message += `${symbol} ${tf} ${pattern} ${conf} ${dir}\n`;
  });

  message += "```";

  await sendMessage(message);
  info("TelegramNotifier", `Sent batch of ${signals.length} intraday signals`);
}

/**
 * Send intraday backtest results (Model-2)
 */
export async function notifyIntradayBacktestResults(results: {
  totalSignals: number;
  successRate: number;
  avgGain1h: number;
  avgGain4h: number;
  patternBreakdown: Array<{
    pattern: string;
    count: number;
    winRate: number;
    avgGain: number;
  }>;
  classBreakdown: Array<{
    class: string;
    count: number;
    winRate: number;
    avgGain: number;
  }>;
  timeframeBreakdown: Array<{
    timeframe: string;
    count: number;
    winRate: number;
    avgGain: number;
  }>;
  topSetups: Array<{
    symbol: string;
    pattern: string;
    timeframe: string;
    gain: number;
    timestamp: number;
  }>;
}): Promise<void> {
  if (!isEnabled) {
    return;
  }

  const rating =
    results.successRate >= 55
      ? "🟢 Excellent"
      : results.successRate >= 50
        ? "🟡 Good"
        : results.successRate >= 45
          ? "🟠 Moderate"
          : "🔴 Poor";

  // Summary message
  let message =
    `📊 *INTRADAY BACKTEST RESULTS (Model-2)*\n\n` +
    `*SUMMARY*\n` +
    `• Total Signals: ${results.totalSignals}\n` +
    `• Success Rate: ${results.successRate.toFixed(1)}%\n` +
    `• Avg 1h Gain: ${results.avgGain1h >= 0 ? "+" : ""}${results.avgGain1h.toFixed(2)}%\n` +
    `• Avg 4h Gain: ${results.avgGain4h >= 0 ? "+" : ""}${results.avgGain4h.toFixed(2)}%\n\n` +
    `*Rating:* ${rating}`;

  await sendMessage(message);

  // Pattern breakdown
  if (results.patternBreakdown.length > 0) {
    let patternMsg = `🎯 *PATTERN PERFORMANCE*\n\n\`\`\`\n`;
    patternMsg += "Pattern            Count  Win%   Avg\n";
    patternMsg += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";

    results.patternBreakdown.forEach((p) => {
      const pattern = p.pattern.replace(/_/g, " ").substring(0, 18).padEnd(18);
      const count = p.count.toString().padStart(5);
      const winRate = `${p.winRate.toFixed(0)}%`.padStart(5);
      const avgGain = `${p.avgGain >= 0 ? "+" : ""}${p.avgGain.toFixed(1)}%`;
      patternMsg += `${pattern} ${count} ${winRate} ${avgGain}\n`;
    });

    patternMsg += "```";
    await sendMessage(patternMsg);
  }

  // Class breakdown
  if (results.classBreakdown.length > 0) {
    let classMsg = `💎 *ASSET CLASS PERFORMANCE*\n\n\`\`\`\n`;
    classMsg += "Class       Count  Win%   Avg\n";
    classMsg += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";

    results.classBreakdown.forEach((c) => {
      const className = c.class.padEnd(11);
      const count = c.count.toString().padStart(5);
      const winRate = `${c.winRate.toFixed(0)}%`.padStart(5);
      const avgGain = `${c.avgGain >= 0 ? "+" : ""}${c.avgGain.toFixed(1)}%`;
      classMsg += `${className} ${count} ${winRate} ${avgGain}\n`;
    });

    classMsg += "```";
    await sendMessage(classMsg);
  }

  // Timeframe breakdown
  if (results.timeframeBreakdown.length > 0) {
    let tfMsg = `⏱ *TIMEFRAME PERFORMANCE*\n\n\`\`\`\n`;
    tfMsg += "TF   Count  Win%   Avg\n";
    tfMsg += "━━━━━━━━━━━━━━━━━━━━━━━━━\n";

    results.timeframeBreakdown.forEach((t) => {
      const tf = t.timeframe.padEnd(4);
      const count = t.count.toString().padStart(5);
      const winRate = `${t.winRate.toFixed(0)}%`.padStart(5);
      const avgGain = `${t.avgGain >= 0 ? "+" : ""}${t.avgGain.toFixed(1)}%`;
      tfMsg += `${tf} ${count} ${winRate} ${avgGain}\n`;
    });

    tfMsg += "```";
    await sendMessage(tfMsg);
  }

  // Top setups
  if (results.topSetups.length > 0) {
    const topCount = Math.min(10, results.topSetups.length);
    let topMsg = `🏆 *TOP ${topCount} SETUPS*\n\n`;

    results.topSetups.slice(0, topCount).forEach((s, i) => {
      const timestamp = new Date(s.timestamp);
      const dateStr = timestamp.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const patternName = s.pattern.replace(/_/g, " ");
      topMsg += `${i + 1}. ${s.symbol} ${s.timeframe} ${patternName} +${s.gain.toFixed(1)}% (${dateStr})\n`;
    });

    await sendMessage(topMsg);
  }

  info("TelegramNotifier", "Sent intraday backtest results");
}
