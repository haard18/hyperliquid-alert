/**
 * validateBreakouts.js
 *
 * Usage:
 *  TWELVEDATA_API_KEY=your_key node validateBreakouts.js
 *
 * Input: change the `breakouts` array below to include objects:
 *  { symbol: "SI=F", date: "2025-11-14", direction: "long", entryPrice: 1.0, successThresholdPercent: 2 }
 *
 * Output: prints verification (peak/trough and whether success threshold met)
 */

import axios from "axios";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

const TD_KEY = process.env.TWELVEDATA_API_KEY || "c2a4117ba23a48059eb1ffb8ecbce483"; // get free key from https://twelvedata.com

// Replace / append your breakouts here
const breakouts = [
  { symbol: "SI=F", date: "2025-11-14", direction: "long", entryPrice: null, successThresholdPercent: 2 },
  { symbol: "NVDA", date: "2025-11-06", direction: "long", entryPrice: null, successThresholdPercent: 2 },
  { symbol: "GC=F", date: "2025-11-14", direction: "long", entryPrice: null, successThresholdPercent: 2 },
  { symbol: "CL=F", date: "2025-11-14", direction: "long", entryPrice: null, successThresholdPercent: 2 },
  { symbol: "TSLA", date: "2025-10-03", direction: "long", entryPrice: null, successThresholdPercent: 2 },
  // add other entries...
];

// helper: epoch seconds for day start / day end (UTC)
function epochRangeForCheck(dateStr, beforeDays = 1, afterDays = 2) {
  const start = dayjs(dateStr).utc().subtract(beforeDays, "day").startOf("day").unix();
  const end = dayjs(dateStr).utc().add(afterDays, "day").endOf("day").unix();
  return { start, end };
}

// primary: TwelveData time_series (minute or hourly/daily). We'll request 1h or 1day depending.
async function fetchTdCandles(symbol, startEpoch, endEpoch, interval = "1h") {
  if (!TD_KEY) throw new Error("TwelveData API key not set (TWELVEDATA_API_KEY)");
  // TwelveData expects ISO timestamps or "start_date" param - we'll use 'start_date' and 'end_date' string format
  const startISO = new Date(startEpoch * 1000).toISOString();
  const endISO = new Date(endEpoch * 1000).toISOString();

  const params = {
    symbol,
    interval,
    start_date: startISO,
    end_date: endISO,
    timezone: "UTC",
    apikey: TD_KEY,
    outputsize: 5000,
  };

  try {
    const url = `https://api.twelvedata.com/time_series`;
    const resp = await axios.get(url, { params, timeout: 15000 });
    if (resp.data && resp.data.values) {
      // values list is reverse-chronological in some responses — normalize to ascending by timestamp
      const values = resp.data.values.slice().reverse().map(v => ({
        datetime: v.datetime,
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        volume: Number(v.volume ?? 0),
      }));
      return values;
    }
    return null;
  } catch (err) {
    // bubble up for fallback
    throw err;
  }
}

// fallback: Yahoo finance chart (daily). Might be blocked sometimes but still useful as fallback.
async function fetchYahooDaily(symbol, startEpoch, endEpoch) {
  // convert symbol to Yahoo style (passed by user probably already correct)
  // build URL with period1/period2 seconds
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${startEpoch}&period2=${endEpoch}`;
  const resp = await axios.get(url, { timeout: 15000 });
  if (resp.data && resp.data.chart && resp.data.chart.result && resp.data.chart.result[0]) {
    const r = resp.data.chart.result[0];
    const { timestamp, indicators } = r;
    if (!timestamp || !indicators || !indicators.quote || !indicators.quote[0]) return null;
    const quotes = indicators.quote[0];
    return timestamp.map((t, i) => ({
      datetime: new Date(t * 1000).toISOString(),
      open: quotes.open[i],
      high: quotes.high[i],
      low: quotes.low[i],
      close: quotes.close[i],
      volume: quotes.volume[i],
    })).filter(q => q.open !== null); // drop nulls
  }
  return null;
}

// compute peak/trough windows (hoursWindow = 24 for 24h)
function computeOutcome(valuesAsc, breakoutTimestampISO, direction, hoursWindow = 24) {
  // valuesAsc: chronological ascending array of {datetime, high, low, close}
  // find index of breakout candle (closest timestamp <= breakoutTimestamp)
  const breakoutTime = new Date(breakoutTimestampISO).getTime();
  let idx = valuesAsc.findIndex(v => new Date(v.datetime).getTime() >= breakoutTime);
  if (idx === -1) {
    // fallback: use first element >= date, or last index
    idx = valuesAsc.findIndex(v => new Date(v.datetime).getTime() > breakoutTime) - 1;
    if (idx < 0) idx = 0;
  }
  const start = idx;
  const endTime = breakoutTime + hoursWindow * 3600 * 1000;
  let peakHigh = valuesAsc[idx].close;
  let troughLow = valuesAsc[idx].close;

  for (let i = idx; i < valuesAsc.length; i++) {
    const t = new Date(valuesAsc[i].datetime).getTime();
    if (t > endTime) break;
    const high = Number(valuesAsc[i].high);
    const low = Number(valuesAsc[i].low);
    if (!isNaN(high) && high > peakHigh) peakHigh = high;
    if (!isNaN(low) && low < troughLow) troughLow = low;
  }

  if (direction === "long") {
    const gain = ((peakHigh - valuesAsc[idx].close) / valuesAsc[idx].close) * 100;
    return { peakHigh, gain };
  } else {
    const drop = ((valuesAsc[idx].close - troughLow) / valuesAsc[idx].close) * 100;
    return { troughLow, drop };
  }
}

async function validateOne(b) {
  const { start, end } = epochRangeForCheck(b.date, 1, 2);
  const interval = "1h"; // hourly checks, ok for daily breakouts — adjust to 1d if you want daily bars
  let values = null;
  try {
    values = await fetchTdCandles(b.symbol, start, end, interval);
  } catch (err) {
    console.warn(`[WARN] TwelveData fetch failed for ${b.symbol} on ${b.date}: ${err.message || err}`);
    try {
      values = await fetchYahooDaily(b.symbol, start, end);
    } catch (err2) {
      console.warn(`[WARN] Yahoo fallback failed for ${b.symbol}: ${err2.message || err2}`);
    }
  }
  if (!values || values.length === 0) {
    console.log(`${b.symbol} ${b.date} — NO DATA`);
    return;
  }

  // determine breakout candle time: choose the first completed candle whose close date equals b.date
  // find the candle whose datetime date == b.date
  const breakoutCandle = values.find(v => v.datetime.startsWith(b.date));
  const breakoutCandleUsed = breakoutCandle || values[values.length - 1]; // fallback

  const outcome24 = computeOutcome(values, breakoutCandleUsed.datetime, b.direction, 24);
  const success24 = b.direction === "long"
    ? outcome24.gain >= (b.successThresholdPercent || 2)
    : outcome24.drop >= (b.successThresholdPercent || 2);

  console.log("------------------------------------------------------------");
  console.log(`${b.symbol}  ${b.date}  dir=${b.direction.toUpperCase()}  confThresh=${b.successThresholdPercent}%`);
  console.log(`  Entry candle: ${breakoutCandleUsed.datetime} close=${breakoutCandleUsed.close}`);
  if (b.direction === "long") {
    console.log(`  24h peak: ${outcome24.peakHigh}  gain=${outcome24.gain.toFixed(2)}%  => ${success24 ? "WIN ✅" : "LOSS ❌"}`);
  } else {
    console.log(`  24h trough: ${outcome24.troughLow}  drop=${outcome24.drop.toFixed(2)}%  => ${success24 ? "WIN ✅" : "LOSS ❌"}`);
  }
  // optionally return object
  return { symbol: b.symbol, date: b.date, success24 };
}

(async function main(){
  for (const b of breakouts) {
    try {
      await validateOne(b);
    } catch (err) {
      console.error("Error validating", b, err.message || err);
    }
  }
})();
