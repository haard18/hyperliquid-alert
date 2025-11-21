import WebSocket from "ws";

const HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws";
const CANDLE_INTERVAL = "1h";
const SUBSCRIPTION_DELAY = 150; // Increased to 150ms to be extra safe (400/min, well under 2000/min)

// First 150 coins (our target limit)
const COINS_TO_TEST = [
  "BTC", "ETH", "SOL", "ATOM", "BNB", "ARB", "OP", "MATIC", "AVAX", "DOGE",
  "WIF", "BONK", "PEPE", "SHIB", "FLOKI", "LINK", "UNI", "AAVE", "CRV", "LDO",
  "FTM", "ALGO", "XLM", "ADA", "DOT", "NEAR", "APT", "SUI", "SEI", "TIA",
  "INJ", "RUNE", "OSMO", "JUNO", "EVMOS", "KAVA", "KUJI", "SCRT", "LUNA", "AXL",
  "STX", "CFX", "FET", "AGIX", "RNDR", "GRT", "IMX", "SAND", "MANA", "AXS",
  "GMT", "APE", "GAL", "LTC", "BCH", "ETC", "XRP", "TRX", "FIL", "HBAR",
  "VET", "ICP", "EOS", "XTZ", "THETA", "AERO", "PENDLE", "MKR", "SNX", "COMP",
  "YFI", "1INCH", "ENS", "BAL", "SUSHI", "ZRX", "STORJ", "ANKR", "CVC", "NMR",
  "LRC", "BAND", "OCEAN", "RSR", "RLC", "MINA", "JASMY", "AUDIO", "C98", "HIGH",
  "PERP", "TRB", "SPELL", "DYDX", "ENJ", "CHZ", "HOT", "ZIL", "ONE", "CELO",
  "BAT", "DASH", "ZEC", "QTUM", "ICX", "ONT", "ZEN", "DGB", "RVN", "SC",
  "WAVES", "LSK", "STEEM", "ARDR", "REP", "KMD", "DCR", "XEM", "STRAT", "WLD",
  "ARK", "POWR", "LOOM", "FUN", "KNC", "POLY", "MTL", "MITH", "KEY", "DATA",
  "DOCK", "WAN", "FUEL", "MBOX", "ALICE", "TLM", "SLP", "DEGO", "DUSK", "REEF",
  "OGN", "NKN", "SXP", "COSM", "CTSI", "HARD", "DNT", "STMX", "FOR", "POLS"
];

console.log("=".repeat(70));
console.log("HYPERLIQUID ROBUST SUBSCRIPTION TEST");
console.log("=".repeat(70));
console.log(`Testing with ${COINS_TO_TEST.length} coins`);
console.log(`Subscription delay: ${SUBSCRIPTION_DELAY}ms = ${(60000/SUBSCRIPTION_DELAY).toFixed(0)}/min`);
console.log(`Expected completion: ${(COINS_TO_TEST.length * SUBSCRIPTION_DELAY / 1000).toFixed(1)}s`);
console.log("=".repeat(70) + "\n");

const ws = new WebSocket(HYPERLIQUID_WS_URL);

let subscriptionsSent = 0;
let subscriptionsConfirmed = 0;
let candlesReceived = 0;
let errorCount = 0;
let connectionClosed = false;

const confirmedCoins = new Set<string>();
const startTime = Date.now();

ws.on("open", () => {
  console.log("✓ WebSocket connected\n");
  
  // Subscribe with proper delay and check connection state
  COINS_TO_TEST.forEach((coin, index) => {
    setTimeout(() => {
      // Check if connection is still open
      if (ws.readyState !== WebSocket.OPEN) {
        console.log(`\n⚠️  Connection closed after ${subscriptionsSent} subscriptions sent`);
        return;
      }
      
      const subscription = {
        method: "subscribe",
        subscription: {
          type: "candle",
          coin: coin,
          interval: CANDLE_INTERVAL,
        },
      };
      
      try {
        ws.send(JSON.stringify(subscription));
        subscriptionsSent++;
        
        if (subscriptionsSent % 25 === 0 || subscriptionsSent === COINS_TO_TEST.length) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`📤 Sent: ${subscriptionsSent}/${COINS_TO_TEST.length} | Confirmed: ${subscriptionsConfirmed} | Time: ${elapsed}s`);
        }
      } catch (err) {
        console.error(`❌ Failed to send subscription for ${coin}:`, err);
      }
    }, index * SUBSCRIPTION_DELAY);
  });
});

ws.on("message", (data: WebSocket.Data) => {
  try {
    const message = JSON.parse(data.toString());
    
    if (message.channel === "candle") {
      candlesReceived++;
      if (candlesReceived <= 5) {
        console.log(`📊 Candle: ${message.data.s} = $${message.data.c}`);
      }
    } else if (message.channel === "subscriptionResponse") {
      const coin = message.data?.subscription?.coin || 'unknown';
      confirmedCoins.add(coin);
      subscriptionsConfirmed++;
    } else if (message.channel === "error") {
      errorCount++;
      console.log(`\n❌ ERROR #${errorCount}:`, JSON.stringify(message.data));
    }
  } catch (err) {
    console.error("❌ Parse error:", err);
  }
});

ws.on("error", (err: Error) => {
  console.error("\n❌ WebSocket error:", err);
});

ws.on("close", (code, reason) => {
  if (connectionClosed) return;
  connectionClosed = true;
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successRate = subscriptionsSent > 0 ? ((subscriptionsConfirmed / subscriptionsSent) * 100) : 0;
  
  console.log(`\n⚠️  Connection closed: code=${code}, reason="${reason.toString() || 'none'}"\n`);
  console.log("=".repeat(70));
  console.log("RESULTS");
  console.log("=".repeat(70));
  console.log(`Time elapsed: ${elapsed}s`);
  console.log(`Subscriptions sent: ${subscriptionsSent}/${COINS_TO_TEST.length}`);
  console.log(`Confirmations received: ${subscriptionsConfirmed}`);
  console.log(`Success rate: ${successRate.toFixed(1)}%`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Candles received: ${candlesReceived}`);
  console.log("");
  
  if (successRate >= 95) {
    console.log("✅ EXCELLENT! Ready for production");
  } else if (successRate >= 80) {
    console.log("⚠️  GOOD but could be better");
  } else {
    console.log("❌ TOO MANY FAILURES - increase delay or reduce count");
  }
  
  console.log("\nConfirmed coins:");
  const confirmed = Array.from(confirmedCoins);
  for (let i = 0; i < confirmed.length; i += 10) {
    console.log("  " + confirmed.slice(i, i + 10).join(", "));
  }
  console.log("=".repeat(70) + "\n");
  
  process.exit(successRate >= 90 ? 0 : 1);
});

// Run for sufficient time
const TEST_DURATION = Math.max(60000, (COINS_TO_TEST.length * SUBSCRIPTION_DELAY) + 15000);
setTimeout(() => {
  if (!connectionClosed) {
    console.log(`\n⏱️  Test complete after ${(TEST_DURATION / 1000).toFixed(0)}s\n`);
    ws.close();
  }
}, TEST_DURATION);



