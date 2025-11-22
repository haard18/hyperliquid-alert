/**
 * Model-2: Intraday Detection Scheduler
 * 
 * Cron scheduling for intraday breakout detection
 * - 5m: every 5 minutes
 * - 15m: every 15 minutes
 * - 1h: every hour on the hour
 */

import cron from "node-cron";
import { info, warn, error as logError } from "../utils/logger.js";
import {
  run5mDetection,
  run15mDetection,
  run1hDetection,
  getDefaultCryptoSymbols,
} from "../breakout/intradayRunner.js";

// Track running jobs to prevent overlaps
let is5mRunning = false;
let is15mRunning = false;
let is1hRunning = false;

// Track if cron jobs are scheduled
let is5mScheduled = false;
let is15mScheduled = false;
let is1hScheduled = false;

/**
 * 5-minute detection job
 */
const job5m = cron.schedule(
  "*/5 * * * *",
  async () => {
    if (is5mRunning) {
      warn("IntradayCron", "5m job already running, skipping this cycle");
      return;
    }

    is5mRunning = true;
    try {
      info("IntradayCron", "Starting 5m detection cycle");
      const symbols = getDefaultCryptoSymbols();
      await run5mDetection(symbols);
      info("IntradayCron", "Completed 5m detection cycle");
    } catch (err) {
      logError("IntradayCron", "5m detection failed", err);
    } finally {
      is5mRunning = false;
    }
  }
);
// Stop immediately - we'll start manually
job5m.stop();

/**
 * 15-minute detection job
 */
const job15m = cron.schedule(
  "*/15 * * * *",
  async () => {
    if (is15mRunning) {
      warn("IntradayCron", "15m job already running, skipping this cycle");
      return;
    }

    is15mRunning = true;
    try {
      info("IntradayCron", "Starting 15m detection cycle");
      const symbols = getDefaultCryptoSymbols();
      await run15mDetection(symbols);
      info("IntradayCron", "Completed 15m detection cycle");
    } catch (err) {
      logError("IntradayCron", "15m detection failed", err);
    } finally {
      is15mRunning = false;
    }
  }
);
// Stop immediately - we'll start manually
job15m.stop();

/**
 * 1-hour detection job
 */
const job1h = cron.schedule(
  "0 * * * *",
  async () => {
    if (is1hRunning) {
      warn("IntradayCron", "1h job already running, skipping this cycle");
      return;
    }

    is1hRunning = true;
    try {
      info("IntradayCron", "Starting 1h detection cycle");
      const symbols = getDefaultCryptoSymbols();
      await run1hDetection(symbols);
      info("IntradayCron", "Completed 1h detection cycle");
    } catch (err) {
      logError("IntradayCron", "1h detection failed", err);
    } finally {
      is1hRunning = false;
    }
  }
);
// Stop immediately - we'll start manually
job1h.stop();

/**
 * Start all intraday cron jobs
 */
export function startIntradayCron(): void {
  info("IntradayCron", "Starting intraday detection cron jobs");
  
  job5m.start();
  is5mScheduled = true;
  info("IntradayCron", "5m job scheduled: */5 * * * *");
  
  job15m.start();
  is15mScheduled = true;
  info("IntradayCron", "15m job scheduled: */15 * * * *");
  
  job1h.start();
  is1hScheduled = true;
  info("IntradayCron", "1h job scheduled: 0 * * * *");
}

/**
 * Stop all intraday cron jobs
 */
export function stopIntradayCron(): void {
  info("IntradayCron", "Stopping intraday detection cron jobs");
  
  job5m.stop();
  is5mScheduled = false;
  
  job15m.stop();
  is15mScheduled = false;
  
  job1h.stop();
  is1hScheduled = false;
}

/**
 * Start only specific timeframe
 */
export function startTimeframeCron(timeframe: "5m" | "15m" | "1h"): void {
  switch (timeframe) {
    case "5m":
      job5m.start();
      is5mScheduled = true;
      info("IntradayCron", "Started 5m job");
      break;
    case "15m":
      job15m.start();
      is15mScheduled = true;
      info("IntradayCron", "Started 15m job");
      break;
    case "1h":
      job1h.start();
      is1hScheduled = true;
      info("IntradayCron", "Started 1h job");
      break;
  }
}

/**
 * Stop only specific timeframe
 */
export function stopTimeframeCron(timeframe: "5m" | "15m" | "1h"): void {
  switch (timeframe) {
    case "5m":
      job5m.stop();
      is5mScheduled = false;
      info("IntradayCron", "Stopped 5m job");
      break;
    case "15m":
      job15m.stop();
      is15mScheduled = false;
      info("IntradayCron", "Stopped 15m job");
      break;
    case "1h":
      job1h.stop();
      is1hScheduled = false;
      info("IntradayCron", "Stopped 1h job");
      break;
  }
}

/**
 * Get status of all jobs
 */
export function getIntradayCronStatus(): {
  job5m: { scheduled: boolean; isJobRunning: boolean };
  job15m: { scheduled: boolean; isJobRunning: boolean };
  job1h: { scheduled: boolean; isJobRunning: boolean };
} {
  return {
    job5m: { scheduled: is5mScheduled, isJobRunning: is5mRunning },
    job15m: { scheduled: is15mScheduled, isJobRunning: is15mRunning },
    job1h: { scheduled: is1hScheduled, isJobRunning: is1hRunning },
  };
}

