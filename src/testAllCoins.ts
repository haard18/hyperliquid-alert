import WebSocket from "ws";

const HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws";
const CANDLE_INTERVAL = "1h";
const SUBSCRIPTION_DELAY = 100; // 100ms = 10 subscriptions/second = 600/minute (well under 2000/min limit)

// All 184+ coins from Hyperliquid
const ALL_COINS = [
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
  "BAT", "DASH", "COMP", "ZEC", "QTUM", "ICX", "ONT", "ZEN", "DGB", "RVN",
  "SC", "WAVES", "LSK", "STEEM", "ARDR", "REP", "KMD", "DCR", "XEM", "STRAT",
  "WLD", "ARK", "POWR", "LOOM", "FUN", "KNC", "POLY", "MTL", "STORJ", "MITH",
  "KEY", "DATA", "DOCK", "WAN", "FUEL", "MBOX", "ALICE", "TLM", "SLP", "DEGO",
  "INJ", "DUSK", "REEF", "OGN", "NKN", "SXP", "COSM", "CTSI", "HARD", "DNT",
  "STMX", "FOR", "POLS", "OM", "UNFI", "FRONT", "ROSE", "AVA", "XVS", "BEL",
  "WING", "CREAM", "UMA", "NBS", "OXT", "SUN", "AVAX", "HNT", "IOTX", "XVG",
  "SRM", "LINA", "IRIS", "LIT", "ATA", "GTC", "TORN", "BAKE", "KEEP", "TKO",
  "ERN", "KLAY", "PHA", "BOND"
];

console.log("=".repeat(70));
console.log("HYPERLIQUID WEBSOCKET SUBSCRIPTION TEST");
console.log("=".repeat(70));
console.log(`Testing with ${ALL_COINS.length} coins`);
console.log(`Rate limit: 2000 messages/minute (official limit)`);
console.log(`Our rate: ${SUBSCRIPTION_DELAY}ms delay = ${1000/SUBSCRIPTION_DELAY}/sec = ${60000/SUBSCRIPTION_DELAY}/min`);
console.log(`Expected completion time: ${(ALL_COINS.length * SUBSCRIPTION_DELAY / 1000).toFixed(1)} seconds`);
console.log("=".repeat(70));
console.log("");

const ws = new WebSocket(HYPERLIQUID_WS_URL);

let subscriptionsSent = 0;
let subscriptionsConfirmed = 0;
let candlesReceived = 0;
let errorCount = 0;

const confirmedCoins = new Set<string>();
const startTime = Date.now();

ws.on("open", () => {
  console.log("✓ WebSocket connected");
  console.log(`⏳ Subscribing to ${ALL_COINS.length} coins...`);
  console.log("");
  
  const connectionTime = Date.now();
  
  // Subscribe with proper delay
  ALL_COINS.forEach((coin, index) => {
    setTimeout(() => {
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
        
        // Progress updates every 20 coins
        if (subscriptionsSent % 20 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`  📤 Sent ${subscriptionsSent}/${ALL_COINS.length} requests (${elapsed}s elapsed, ${subscriptionsConfirmed} confirmed)`);
        }
      } catch (err) {
        console.error(`  ❌ Failed to send subscription for ${coin}:`, err);
      }
    }, index * SUBSCRIPTION_DELAY);
  });
  
  // Final status check
  setTimeout(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("");
    console.log(`  ✓ All ${subscriptionsSent} subscription requests sent in ${elapsed}s`);
    console.log(`  ⏳ Waiting for confirmations...`);
  }, (ALL_COINS.length + 1) * SUBSCRIPTION_DELAY);
});

ws.on("message", (data: WebSocket.Data) => {
  try {
    const message = JSON.parse(data.toString());
    
    if (message.channel === "candle") {
      candlesReceived++;
      
      // Show first few candles
      if (candlesReceived <= 3) {
        console.log(`  📊 [Candle #${candlesReceived}] ${message.data.s}: $${message.data.c} (vol: ${parseFloat(message.data.v).toFixed(0)})`);
      } else if (candlesReceived === 4) {
        console.log(`  📊 ... (receiving live candles, count: ${candlesReceived})`);
      }
    } else if (message.channel === "subscriptionResponse") {
      const coin = message.data?.subscription?.coin || 'unknown';
      confirmedCoins.add(coin);
      subscriptionsConfirmed++;
      
      // Progress updates every 20 confirmations
      if (subscriptionsConfirmed % 20 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = ((subscriptionsConfirmed / subscriptionsSent) * 100).toFixed(1);
        console.log(`  ✅ Confirmed ${subscriptionsConfirmed}/${subscriptionsSent} (${rate}%, ${elapsed}s)`);
      }
    } else if (message.channel === "error") {
      errorCount++;
      console.log("");
      console.log(`  ❌ ERROR #${errorCount}:`);
      console.log(JSON.stringify(message.data, null, 2));
      console.log("");
    } else {
      // Unexpected message type
      if (message.channel !== "subscriptionResponse") {
        console.log(`  ⚠️  Unknown message type: ${message.channel}`);
      }
    }
  } catch (err) {
    console.error("  ❌ Error parsing message:", err);
  }
});

ws.on("error", (err: Error) => {
  console.error("\n❌ WebSocket error:", err);
});

ws.on("close", (code, reason) => {
  console.log(`\n⚠️  WebSocket closed (code: ${code}, reason: ${reason.toString()})`);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successRate = subscriptionsSent > 0 ? ((subscriptionsConfirmed / subscriptionsSent) * 100) : 0;
  
  console.log("");
  console.log("=".repeat(70));
  console.log("FINAL RESULTS");
  console.log("=".repeat(70));
  console.log(`  Total time: ${elapsed} seconds`);
  console.log(`  Subscription requests sent: ${subscriptionsSent}/${ALL_COINS.length}`);
  console.log(`  Subscriptions confirmed: ${subscriptionsConfirmed}/${subscriptionsSent}`);
  console.log(`  Success rate: ${successRate.toFixed(1)}%`);
  console.log(`  Errors received: ${errorCount}`);
  console.log(`  Candle updates received: ${candlesReceived}`);
  console.log(`  Average confirmation time: ${(parseFloat(elapsed) / Math.max(subscriptionsConfirmed, 1)).toFixed(2)}s per coin`);
  console.log("");
  
  if (successRate >= 95) {
    console.log("  ✅ EXCELLENT! All subscriptions successful!");
  } else if (successRate >= 80) {
    console.log("  ⚠️  GOOD: Most subscriptions successful, but some failed");
  } else if (successRate >= 50) {
    console.log("  ⚠️  MODERATE: Many subscriptions failed - may be hitting rate limits");
  } else {
    console.log("  ❌ POOR: Most subscriptions failed - likely rate limited");
  }
  console.log("");
  
  console.log("  First 20 confirmed coins:");
  console.log("  " + Array.from(confirmedCoins).slice(0, 20).join(", "));
  
  if (confirmedCoins.size < subscriptionsSent) {
    const unconfirmed = ALL_COINS.filter(coin => !confirmedCoins.has(coin));
    console.log("");
    console.log(`  Unconfirmed coins (${unconfirmed.length}):`);
    console.log("  " + unconfirmed.slice(0, 20).join(", ") + (unconfirmed.length > 20 ? "..." : ""));
  }
  
  console.log("=".repeat(70));
  console.log("");
  
  process.exit(successRate >= 95 ? 0 : 1);
});

// Run for 40 seconds (enough time for all subscriptions + confirmations)
const TEST_DURATION = Math.max(40000, (ALL_COINS.length * SUBSCRIPTION_DELAY) + 10000);
console.log(`Test will run for ${(TEST_DURATION / 1000).toFixed(0)} seconds...\n`);

setTimeout(() => {
  console.log("\n⏱️  Test duration complete, closing connection...\n");
  ws.close();
}, TEST_DURATION);

