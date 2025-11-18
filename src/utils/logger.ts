import fs from "fs";
import path from "path";

/**
 * Logging utility with file persistence
 */

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, `app-${new Date().toISOString().split("T")[0]}.log`);
const SIGNALS_FILE = path.join(LOG_DIR, `signals-${new Date().toISOString().split("T")[0]}.jsonl`);
const CONFIRMED_FILE = path.join(LOG_DIR, `confirmed-${new Date().toISOString().split("T")[0]}.jsonl`);
const EVALUATIONS_FILE = path.join(LOG_DIR, `evaluations-${new Date().toISOString().split("T")[0]}.jsonl`);

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  module: string;
  message: string;
  data?: any;
}

interface SignalLogEntry {
  timestamp: string;
  type: "baseline" | "confirmed";
  coin: string;
  score: number;
  price: number;
  imbalance: number;
  volatility: number;
  compression: number;
  rv20?: number;
  confidence?: number;
  persistence?: number;
  buyRatio?: number;
  totalVolume?: number;
}

interface EvaluationLogEntry {
  timestamp: string;
  type: "baseline" | "confirmed";
  coin: string;
  entryPrice: number;
  exitPrice: number;
  forwardReturn: number;
  threshold: number;
  isWin: boolean;
  confidence?: number;
  holdTimeMs: number;
}

/**
 * Write log entry to file
 */
function writeToFile(filePath: string, content: string): void {
  try {
    fs.appendFileSync(filePath, content + "\n", "utf8");
  } catch (error) {
    console.error(`Failed to write to ${filePath}:`, error);
  }
}

/**
 * Format timestamp
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Main log function
 */
export function log(
  level: "INFO" | "WARN" | "ERROR" | "DEBUG",
  module: string,
  message: string,
  data?: any
): void {
  const entry: LogEntry = {
    timestamp: getTimestamp(),
    level,
    module,
    message,
    data,
  };

  // Console output with color
  const colors = {
    INFO: "\x1b[36m",    // Cyan
    WARN: "\x1b[33m",    // Yellow
    ERROR: "\x1b[31m",   // Red
    DEBUG: "\x1b[90m",   // Gray
  };
  const reset = "\x1b[0m";
  const color = colors[level];

  const consoleMsg = `${color}[${entry.timestamp}] [${level}] [${module}]${reset} ${message}`;
  console.log(consoleMsg);
  if (data) {
    console.log(data);
  }

  // File output
  writeToFile(LOG_FILE, JSON.stringify(entry));
}

/**
 * Log baseline signal
 */
export function logBaselineSignal(
  coin: string,
  score: number,
  price: number,
  imbalance: number,
  volatility: number,
  compression: number,
  rv20: number
): void {
  const entry: SignalLogEntry = {
    timestamp: getTimestamp(),
    type: "baseline",
    coin,
    score,
    price,
    imbalance,
    volatility,
    compression,
    rv20,
  };

  writeToFile(SIGNALS_FILE, JSON.stringify(entry));
  log("INFO", "BaselineSignal", `${coin} score=${score} price=${price.toFixed(4)}`);
}

/**
 * Log confirmed prepump signal
 */
export function logConfirmedSignal(
  coin: string,
  score: number,
  price: number,
  imbalance: number,
  volatility: number,
  compression: number,
  rv20: number,
  confidence: number,
  persistence: number,
  buyRatio: number,
  totalVolume: number
): void {
  const entry: SignalLogEntry = {
    timestamp: getTimestamp(),
    type: "confirmed",
    coin,
    score,
    price,
    imbalance,
    volatility,
    compression,
    rv20,
    confidence,
    persistence,
    buyRatio,
    totalVolume,
  };

  writeToFile(SIGNALS_FILE, JSON.stringify(entry));
  writeToFile(CONFIRMED_FILE, JSON.stringify(entry));
  log(
    "INFO",
    "ConfirmedSignal",
    `${coin} conf=${(confidence * 100).toFixed(1)}% vol=${totalVolume.toFixed(0)} buyRatio=${(buyRatio * 100).toFixed(0)}%`,
    { score, price, persistence: (persistence * 100).toFixed(1) + "%" }
  );
}

/**
 * Log baseline evaluation
 */
export function logBaselineEvaluation(
  coin: string,
  entryPrice: number,
  exitPrice: number,
  forwardReturn: number,
  threshold: number,
  isWin: boolean,
  holdTimeMs: number
): void {
  const entry: EvaluationLogEntry = {
    timestamp: getTimestamp(),
    type: "baseline",
    coin,
    entryPrice,
    exitPrice,
    forwardReturn,
    threshold,
    isWin,
    holdTimeMs,
  };

  writeToFile(EVALUATIONS_FILE, JSON.stringify(entry));
  
  const result = isWin ? "✅ WIN" : "❌ LOSS";
  log(
    isWin ? "INFO" : "WARN",
    "BaselineEval",
    `${coin} ${result} return=${(forwardReturn * 100).toFixed(2)}% threshold=${(threshold * 100).toFixed(2)}%`
  );
}

/**
 * Log confirmed evaluation
 */
export function logConfirmedEvaluation(
  coin: string,
  entryPrice: number,
  exitPrice: number,
  forwardReturn: number,
  threshold: number,
  isWin: boolean,
  confidence: number,
  holdTimeMs: number
): void {
  const entry: EvaluationLogEntry = {
    timestamp: getTimestamp(),
    type: "confirmed",
    coin,
    entryPrice,
    exitPrice,
    forwardReturn,
    threshold,
    isWin,
    confidence,
    holdTimeMs,
  };

  writeToFile(EVALUATIONS_FILE, JSON.stringify(entry));
  
  const result = isWin ? "✅ WIN" : "❌ LOSS";
  log(
    isWin ? "INFO" : "WARN",
    "ConfirmedEval",
    `${coin} ${result} conf=${(confidence * 100).toFixed(1)}% return=${(forwardReturn * 100).toFixed(2)}% threshold=${(threshold * 100).toFixed(2)}%`
  );
}

/**
 * Log cycle summary
 */
export function logCycleSummary(
  activeCoins: number,
  baselineSignals: number,
  confirmedSignals: number,
  rejectedByVolume: number,
  rejectedByBuyRatio: number
): void {
  log(
    "INFO",
    "CycleSummary",
    `Coins: ${activeCoins}, Baseline: ${baselineSignals}, Confirmed: ${confirmedSignals}, Rejected: ${rejectedByVolume + rejectedByBuyRatio}`,
    {
      rejectedByVolume,
      rejectedByBuyRatio,
      filterEfficiency: `${(((rejectedByVolume + rejectedByBuyRatio) / Math.max(baselineSignals, 1)) * 100).toFixed(1)}%`,
    }
  );
}

/**
 * Log hourly comparison
 */
export function logHourlyComparison(
  baselineWinRate: number,
  baselineAvgReturn: number,
  baselineTotal: number,
  confirmedWinRate: number,
  confirmedAvgReturn: number,
  confirmedTotal: number
): void {
  const improvement = confirmedWinRate - baselineWinRate;
  const improvementPct = baselineWinRate > 0 ? ((improvement / baselineWinRate) * 100) : 0;

  log(
    "INFO",
    "HourlyComparison",
    `Baseline: ${(baselineWinRate * 100).toFixed(1)}% (${baselineTotal}) vs Confirmed: ${(confirmedWinRate * 100).toFixed(1)}% (${confirmedTotal})`,
    {
      baseline: {
        winRate: `${(baselineWinRate * 100).toFixed(1)}%`,
        avgReturn: `${(baselineAvgReturn * 100).toFixed(2)}%`,
        total: baselineTotal,
      },
      confirmed: {
        winRate: `${(confirmedWinRate * 100).toFixed(1)}%`,
        avgReturn: `${(confirmedAvgReturn * 100).toFixed(2)}%`,
        total: confirmedTotal,
      },
      improvement: {
        winRateDelta: `${improvement > 0 ? "+" : ""}${(improvement * 100).toFixed(1)}%`,
        relativeDelta: `${improvementPct > 0 ? "+" : ""}${improvementPct.toFixed(1)}%`,
      },
    }
  );
}

/**
 * Export shorthand functions
 */
export const info = (module: string, message: string, data?: any) => log("INFO", module, message, data);
export const warn = (module: string, message: string, data?: any) => log("WARN", module, message, data);
export const error = (module: string, message: string, data?: any) => log("ERROR", module, message, data);
export const debug = (module: string, message: string, data?: any) => log("DEBUG", module, message, data);
