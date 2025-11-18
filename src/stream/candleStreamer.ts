import WebSocket from "ws";
import redis from "../utils/redisClient.js";
import type { HyperliquidWSMessage } from "../utils/types.js";
import { info, warn, error as logError } from "../utils/logger.js";

/**
 * Hyperliquid Native 1-Hour Candle Streamer
 * Uses official candle subscription for accurate, stable 1H mega-run signals
 */

const HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws";
const CANDLE_INTERVAL = "1h";
const MAX_CANDLES_STORED = 60; // Keep last 60 candles (60 hours of data)
const MAX_ACTIVE_SUBSCRIPTIONS = 190; // Tested: Connection closes after ~18 subscriptions, so keep it at 15 for safety

export interface HyperliquidCandle {
  t: number; // Open time (ms)
  T: number; // Close time (ms)
  s: string; // Symbol (coin)
  i: string; // Interval
  o: string; // Open price
  c: string; // Close price
  h: string; // High price
  l: string; // Low price
  v: string; // Volume
  n: number; // Number of trades
}

export interface ProcessedCandle {
  coin: string;
  timestamp: number; // Close time
  openTime: number;
  closeTime: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  numTrades: number;
  interval: string;
}

class CandleStreamer {
  private ws: WebSocket | null = null;
  private activeCoins: Set<string> = new Set();
  private subscribedCoins: Set<string> = new Set(); // Coins with confirmed subscriptions
  private allAvailableCoins: string[] = []; // Full list of coins to monitor
  private subscriptionQueue: string[] = [];
  private isSubscribing = false;
  private readonly BATCH_SUBSCRIBE_DELAY = 150; // ms between subscriptions (slower to avoid connection drops)
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private onCandleCallback: ((coin: string, candle: ProcessedCandle) => void) | null = null;
  private candlesReceivedThisHour: Set<string> = new Set();
  private detectionTriggerTimer: NodeJS.Timeout | null = null;
  private restApiQueue: string[] = [];
  private isProcessingRestApi = false;
  private readonly REST_API_DELAY = 100; // ms between REST API calls to avoid rate limiting
  private rotationTimer: NodeJS.Timeout | null = null;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        info("CandleStreamer", `Connecting to Hyperliquid WebSocket (${CANDLE_INTERVAL} candles)...`);
        console.log(`🔌 Connecting to WebSocket: ${HYPERLIQUID_WS_URL}`);
        this.ws = new WebSocket(HYPERLIQUID_WS_URL);

        this.ws.on("open", () => {
          info("CandleStreamer", "WebSocket connected successfully");
          console.log("✅ WebSocket connection established");
          this.reconnectAttempts = 0;
          resolve();
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on("error", (err: Error) => {
          logError("CandleStreamer", "WebSocket error", err);
          reject(err);
        });

        this.ws.on("close", () => {
          warn("CandleStreamer", "WebSocket closed, attempting reconnect...");
          this.attemptReconnect();
        });
      } catch (err) {
        logError("CandleStreamer", "Connection failed", err);
        reject(err);
      }
    });
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      logError("CandleStreamer", "Max reconnect attempts reached, giving up");
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    info("CandleStreamer", `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        // Re-subscribe to all active coins
        const coins = Array.from(this.activeCoins);
        this.activeCoins.clear();
        this.subscriptionQueue = [];
        
        for (const coin of coins) {
          await this.subscribe(coin);
        }
      } catch (err) {
        logError("CandleStreamer", "Reconnect failed", err);
      }
    }, delay);
  }

  /**
   * Queue a coin for REST API snapshot fetch
   */
  private queueRestApiFetch(coin: string): void {
    if (!this.restApiQueue.includes(coin)) {
      this.restApiQueue.push(coin);
      this.processRestApiQueue();
    }
  }

  /**
   * Process REST API queue with rate limiting
   */
  private async processRestApiQueue(): Promise<void> {
    if (this.isProcessingRestApi || this.restApiQueue.length === 0) {
      return;
    }

    this.isProcessingRestApi = true;
    const axios = (await import("axios")).default;

    while (this.restApiQueue.length > 0) {
      const coin = this.restApiQueue.shift();
      if (!coin) continue;

      try {
        const currentHourStart = new Date();
        currentHourStart.setMinutes(0, 0, 0);
        
        const endTime = currentHourStart.getTime();
        const startTime = endTime - (3 * 60 * 60 * 1000);

        const response = await axios.post("https://api.hyperliquid.xyz/info", {
          type: "candleSnapshot",
          req: {
            coin: coin,
            interval: CANDLE_INTERVAL,
            startTime: startTime,
            endTime: endTime,
          },
        });

        if (response.data && Array.isArray(response.data) && response.data.length > 0) {
          const mostRecentCandle = response.data[response.data.length - 1];
          
          const candle: HyperliquidCandle = {
            t: parseInt(mostRecentCandle.t),
            T: parseInt(mostRecentCandle.T),
            s: mostRecentCandle.s,
            i: mostRecentCandle.i,
            o: mostRecentCandle.o,
            c: mostRecentCandle.c,
            h: mostRecentCandle.h,
            l: mostRecentCandle.l,
            v: mostRecentCandle.v,
            n: mostRecentCandle.n,
          };

          await this.processCandle(candle, true);
        }
      } catch (err: any) {
        if (err?.response?.status === 429) {
          warn("CandleStreamer", `Rate limit hit for ${coin}, will retry later`);
          // Re-queue the coin for later
          this.restApiQueue.push(coin);
          // Wait longer before continuing
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          logError("CandleStreamer", `Error fetching candle for ${coin}`, err);
        }
      }

      // Rate limiting delay
      await new Promise((resolve) => setTimeout(resolve, this.REST_API_DELAY));
    }

    this.isProcessingRestApi = false;
    info("CandleStreamer", `REST API queue processed. Fetched snapshots for initial data.`);
  }

  /**
   * Set the list of all available coins (for rotation)
   */
  setAvailableCoins(coins: string[]): void {
    this.allAvailableCoins = coins;
    info("CandleStreamer", `Updated available coins list: ${coins.length} total coins`);
    
    // Subscribe to first batch immediately
    if (this.activeCoins.size === 0) {
      info("CandleStreamer", `Initial subscription - will subscribe to ${Math.min(MAX_ACTIVE_SUBSCRIPTIONS, coins.length)} coins`);
      this.rotateSubscriptions();
    }
    
    // Start rotation timer (rotate every hour to monitor different coins)
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }
    this.rotationTimer = setInterval(() => {
      info("CandleStreamer", "Hourly rotation timer triggered");
      this.rotateSubscriptions();
    }, 60 * 60 * 1000); // Rotate every hour
  }

  /**
   * Rotate subscriptions to monitor different coins
   */
  private async rotateSubscriptions(): Promise<void> {
    if (this.allAvailableCoins.length === 0) {
      info("CandleStreamer", "No coins available for subscription");
      return;
    }

    const coinsToSubscribe = this.selectCoinsForSubscription();
    info("CandleStreamer", `Rotating subscriptions: ${coinsToSubscribe.length} coins selected from ${this.allAvailableCoins.length} available`);
    info("CandleStreamer", `First few coins: ${coinsToSubscribe.slice(0, 5).join(", ")}...`);
    
    // Unsubscribe from coins not in the new list
    const coinsToUnsubscribe = Array.from(this.activeCoins).filter(coin => !coinsToSubscribe.includes(coin));
    if (coinsToUnsubscribe.length > 0) {
      info("CandleStreamer", `Unsubscribing from ${coinsToUnsubscribe.length} coins`);
      for (const coin of coinsToUnsubscribe) {
        await this.unsubscribe(coin);
      }
    }

    // Subscribe to new coins
    const coinsToAdd = coinsToSubscribe.filter(coin => !this.activeCoins.has(coin));
    if (coinsToAdd.length > 0) {
      info("CandleStreamer", `Adding ${coinsToAdd.length} new coin subscriptions`);
      for (const coin of coinsToAdd) {
        await this.subscribe(coin);
      }
    } else {
      info("CandleStreamer", "All selected coins already subscribed");
    }
  }

  /**
   * Select which coins to subscribe to (prioritize by volume/activity)
   */
  private selectCoinsForSubscription(): string[] {
    // For now, just take the first MAX_ACTIVE_SUBSCRIPTIONS coins
    // TODO: Could prioritize by volume, market cap, or recent activity
    return this.allAvailableCoins.slice(0, MAX_ACTIVE_SUBSCRIPTIONS);
  }

  /**
   * Subscribe to a coin's candle updates
   */
  async subscribe(coin: string): Promise<void> {
    if (!this.activeCoins.has(coin)) {
      this.activeCoins.add(coin);
      this.subscriptionQueue.push(coin);
      this.processSubscriptionQueue();
    }
  }

  /**
   * Process subscription queue with rate limiting
   */
  private async processSubscriptionQueue(): Promise<void> {
    if (this.isSubscribing || this.subscriptionQueue.length === 0 || !this.ws) {
      return;
    }

    this.isSubscribing = true;
    console.log(`\n📡 Subscribing to ${this.subscriptionQueue.length} coins (max: ${MAX_ACTIVE_SUBSCRIPTIONS})...`);
    info("CandleStreamer", `Processing subscription queue (${this.subscriptionQueue.length} coins)`);

    while (this.subscriptionQueue.length > 0) {
      const coin = this.subscriptionQueue.shift();
      if (coin) {
        try {
          const subscription = {
            method: "subscribe",
            subscription: {
              type: "candle",
              coin: coin,
              interval: CANDLE_INTERVAL,
            },
          };
          this.ws?.send(JSON.stringify(subscription));
          console.log(`   → Subscribing to ${coin}...`);
          info("CandleStreamer", `Subscribed to ${coin} ${CANDLE_INTERVAL} candles`);
          
          // Queue the REST API fetch (rate-limited)
          this.queueRestApiFetch(coin);
        } catch (err) {
          logError("CandleStreamer", `Error subscribing to ${coin}`, err);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, this.BATCH_SUBSCRIBE_DELAY));
    }

    this.isSubscribing = false;
    console.log(`\n✅ Subscription requests sent. Requested: ${this.activeCoins.size}, Confirmed: ${this.subscribedCoins.size}`);
    info("CandleStreamer", `Subscription queue processed. Requested: ${this.activeCoins.size}, Confirmed: ${this.subscribedCoins.size}`);
    
    // Log any coins that were requested but not confirmed
    setTimeout(() => {
      const unconfirmed = Array.from(this.activeCoins).filter(coin => !this.subscribedCoins.has(coin));
      if (unconfirmed.length > 0) {
        warn("CandleStreamer", `${unconfirmed.length} subscriptions not confirmed yet: ${unconfirmed.slice(0, 5).join(', ')}${unconfirmed.length > 5 ? '...' : ''}`);
        console.log(`⚠️  ${unconfirmed.length} subscriptions not confirmed yet`);
      } else {
        console.log(`✅ All ${this.activeCoins.size} subscriptions confirmed!\n`);
      }
    }, 5000); // Wait 5 seconds for confirmations
  }

  /**
   * Unsubscribe from a coin's candles
   */
  async unsubscribe(coin: string): Promise<void> {
    if (!this.ws) {
      return;
    }

    info("CandleStreamer", `Unsubscribing from ${coin}`);
    const unsubscription = {
      method: "unsubscribe",
      subscription: {
        type: "candle",
        coin: coin,
        interval: CANDLE_INTERVAL,
      },
    };

    this.ws.send(JSON.stringify(unsubscription));
    this.activeCoins.delete(coin);
    this.subscribedCoins.delete(coin);
    info("CandleStreamer", `Unsubscribed from ${coin}. Remaining: ${this.activeCoins.size}`);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as HyperliquidWSMessage;

      if (message.channel === "candle" && message.data) {
        // Candle data can come as a single object or an array
        const candleData = message.data as unknown;
        const candles = Array.isArray(candleData) ? candleData : [candleData];
        
        for (const candle of candles) {
          this.processCandle(candle as HyperliquidCandle);
        }
      } else if (message.channel === "subscriptionResponse") {
        const data = message.data as any;
        if (data?.method === "subscribe") {
          const coin = data.subscription?.coin || 'unknown';
          this.subscribedCoins.add(coin);
          info("CandleStreamer", `✓ Subscription confirmed: ${coin} ${CANDLE_INTERVAL} (${this.subscribedCoins.size}/${this.activeCoins.size})`);
        }
      } else if (message.channel === "error") {
        // Log error details with full message
        const errorData = message.data as any;
        logError("CandleStreamer", `WebSocket error response`, errorData);
      } else {
        // Log other message types for debugging (with full data and raw message)
        warn("CandleStreamer", `Unknown WebSocket message [${message.channel}]`, { 
          channel: message.channel, 
          data: message.data,
          fullMessage: message 
        });
      }
    } catch (err) {
      logError("CandleStreamer", "Error processing message", err);
    }
  }

  /**
   * Process and store candle data
   */
  private async processCandle(candle: HyperliquidCandle, isSnapshot: boolean = false): Promise<void> {
    try {
      const coin = candle.s;

      if (!this.activeCoins.has(coin)) {
        return;
      }

      const processed: ProcessedCandle = {
        coin,
        timestamp: candle.T, // Use close time as primary timestamp
        openTime: candle.t,
        closeTime: candle.T,
        open: parseFloat(candle.o),
        close: parseFloat(candle.c),
        high: parseFloat(candle.h),
        low: parseFloat(candle.l),
        volume: parseFloat(candle.v),
        numTrades: candle.n,
        interval: candle.i,
      };

      // Store in Redis
      const key = `candles:1h:${coin}`;
      const candleJson = JSON.stringify(processed);

      await redis.lpush(key, candleJson);
      await redis.ltrim(key, 0, MAX_CANDLES_STORED - 1);

      const candleTime = new Date(processed.closeTime);
      const timeStr = candleTime.toLocaleTimeString();
      const now = Date.now();
      const isCompletedCandle = processed.closeTime < now; // Candle is from a completed hour
      
      if (isSnapshot) {
        info(
          "CandleStreamer",
          `[1H] 📸 Snapshot stored ${coin} @ ${timeStr}: close=${processed.close.toFixed(4)} vol=${processed.volume.toFixed(0)} trades=${processed.numTrades}`
        );
      } else if (isCompletedCandle) {
        // This is a completed candle from a previous hour - this is what we want!
        console.log(`\n✅ [${timeStr}] COMPLETED CANDLE: ${coin} | Close: ${processed.close.toFixed(4)} | Vol: ${processed.volume.toFixed(0)} | Trades: ${processed.numTrades}`);
        info(
          "CandleStreamer",
          `[1H] ✅ Completed candle ${coin} @ ${timeStr}: close=${processed.close.toFixed(4)} vol=${processed.volume.toFixed(0)} trades=${processed.numTrades}`
        );
      } else {
        // This is a real-time update of the current hour's candle (not completed yet)
        info(
          "CandleStreamer",
          `[1H] 📊 Live update ${coin} @ ${timeStr}: close=${processed.close.toFixed(4)} vol=${processed.volume.toFixed(0)} trades=${processed.numTrades}`
        );

        // Only trigger detection for COMPLETED candles (not real-time updates)
        if (isCompletedCandle) {
          // Track that we received a candle this hour
          this.candlesReceivedThisHour.add(coin);

          // Call the callback if registered (only for completed candles)
          if (this.onCandleCallback) {
            this.onCandleCallback(coin, processed);
          }

          // Schedule batch detection after a short delay (to collect all coins' candles)
          if (this.detectionTriggerTimer) {
            clearTimeout(this.detectionTriggerTimer);
          }
          
          this.detectionTriggerTimer = setTimeout(() => {
            const coinsReceived = Array.from(this.candlesReceivedThisHour);
            console.log(`\n🔍 Triggering detection for ${coinsReceived.length} coins with completed candles\n`);
            info("CandleStreamer", `Received ${coinsReceived.length} completed candles, triggering detection`);
            this.candlesReceivedThisHour.clear();
          }, 10000); // Wait 10 seconds for all completed candles to arrive
        }
      }

    } catch (err) {
      logError("CandleStreamer", `Error processing candle for ${candle.s}`, err);
    }
  }

  /**
   * Get recent candles for a coin
   */
  async getCandles(coin: string, limit: number = 20): Promise<ProcessedCandle[]> {
    try {
      const key = `candles:1h:${coin}`;
      const candleJsons = await redis.lrange(key, 0, limit - 1);

      return candleJsons
        .filter((json) => json)
        .map((json) => JSON.parse(json as string) as ProcessedCandle);
    } catch (err) {
      logError("CandleStreamer", `Error retrieving candles for ${coin}`, err);
      return [];
    }
  }

  /**
   * Get the latest candle for a coin
   */
  async getLatestCandle(coin: string): Promise<ProcessedCandle | null> {
    const candles = await this.getCandles(coin, 1);
    return candles[0] || null;
  }

  /**
   * Register callback to be called when a new candle arrives
   */
  onCandle(callback: (coin: string, candle: ProcessedCandle) => void): void {
    this.onCandleCallback = callback;
  }

  /**
   * Close WebSocket connection
   */
  close(): void {
    if (this.detectionTriggerTimer) {
      clearTimeout(this.detectionTriggerTimer);
      this.detectionTriggerTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.activeCoins.clear();
    this.subscribedCoins.clear();
    this.subscriptionQueue = [];
  }

  /**
   * Get active coins (subscribed)
   */
  getActiveCoins(): string[] {
    return Array.from(this.activeCoins);
  }

  /**
   * Get confirmed subscriptions
   */
  getSubscribedCoins(): string[] {
    return Array.from(this.subscribedCoins);
  }

  /**
   * Get subscription stats
   */
  getSubscriptionStats(): { total: number, subscribed: number, confirmed: number } {
    return {
      total: this.allAvailableCoins.length,
      subscribed: this.activeCoins.size,
      confirmed: this.subscribedCoins.size
    };
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export default new CandleStreamer();
