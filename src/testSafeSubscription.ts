import WebSocket from "ws";

const HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws";

/**
 * Test subscribing to 15 coins (safe limit)
 */
async function testSafeSubscription() {
  console.log("🧪 Testing Safe Multi-Coin Subscription (15 coins)\n");
  console.log(`Connecting to: ${HYPERLIQUID_WS_URL}\n`);

  const ws = new WebSocket(HYPERLIQUID_WS_URL);
  
  let messageCount = 0;
  const confirmedSubscriptions = new Set<string>();
  const receivedCandles = new Set<string>();

  // Test with 15 popular coins
  const testCoins = [
    "BTC", "ETH", "SOL", "ARB", "OP", "MATIC", "AVAX", "DOT", 
    "ATOM", "LINK", "UNI", "AAVE", "CRV", "LDO", "MKR"
  ];

  ws.on("open", () => {
    console.log("✓ WebSocket connected\n");
    
    console.log(`📡 Subscribing to 1h candles for ${testCoins.length} coins...\n`);
    
    let subscribeCount = 0;
    const subscribeInterval = setInterval(() => {
      if (subscribeCount >= testCoins.length) {
        clearInterval(subscribeInterval);
        console.log(`\n✓ All ${testCoins.length} subscription requests sent\n`);
        console.log("⏳ Waiting for candles (will run for 2 minutes)...\n");
        console.log("=" .repeat(70));
        return;
      }

      const coin = testCoins[subscribeCount];
      const subscription = {
        method: "subscribe",
        subscription: {
          type: "candle",
          coin: coin,
          interval: "1h",
        },
      };
      
      ws.send(JSON.stringify(subscription));
      console.log(`   → Subscribed to ${coin} (${subscribeCount + 1}/${testCoins.length})`);
      subscribeCount++;
    }, 150); // 150ms between subscriptions (conservative)
  });

  ws.on("message", (data: WebSocket.Data) => {
    messageCount++;
    
    try {
      const message = JSON.parse(data.toString());
      
      if (message.channel === "candle") {
        const coin = message.data.s;
        const wasNew = !receivedCandles.has(coin);
        receivedCandles.add(coin);
        
        if (wasNew) {
          const candleTime = new Date(message.data.T).toLocaleTimeString();
          console.log(`\n📊 [${candleTime}] First candle from: ${coin} | Close: ${message.data.c} | Vol: ${message.data.v} (${receivedCandles.size}/${confirmedSubscriptions.size})`);
        }
      }
      
      if (message.channel === "subscriptionResponse") {
        const data = message.data as any;
        if (data?.method === "subscribe" && data?.subscription?.coin) {
          const coin = data.subscription.coin;
          confirmedSubscriptions.add(coin);
          console.log(`✓ Subscription confirmed: ${coin} (${confirmedSubscriptions.size}/${testCoins.length})`);
        }
      }
      
      if (message.channel === "error") {
        console.log("\n❌ ERROR received:", JSON.stringify(message.data, null, 2));
      }
    } catch (err) {
      // Ignore non-JSON messages
    }
  });

  ws.on("error", (err: Error) => {
    console.error("\n❌ WebSocket error:", err);
  });

  ws.on("close", (code, reason) => {
    console.log(`\n🔌 WebSocket closed (code: ${code}, reason: ${reason})`);
    printSummary();
    process.exit(0);
  });

  function printSummary() {
    console.log("\n" + "=".repeat(70));
    console.log("TEST SUMMARY");
    console.log("=".repeat(70));
    console.log(`Total coins tested: ${testCoins.length}`);
    console.log(`Subscriptions confirmed: ${confirmedSubscriptions.size} (${((confirmedSubscriptions.size / testCoins.length) * 100).toFixed(1)}%)`);
    console.log(`Unique coins with candles: ${receivedCandles.size}`);
    console.log(`Total messages received: ${messageCount}`);
    console.log("=".repeat(70));
    
    if (confirmedSubscriptions.size === testCoins.length) {
      console.log("\n✅ SUCCESS! All subscriptions confirmed!");
    } else {
      const unconfirmed = testCoins.filter(coin => !confirmedSubscriptions.has(coin));
      console.log(`\n⚠️  Unconfirmed subscriptions (${unconfirmed.length}): ${unconfirmed.join(", ")}`);
    }
    
    console.log("\n" + "=".repeat(70));
  }

  // Run for 2 minutes then close
  setTimeout(() => {
    console.log("\n\n⏱️  2 minutes elapsed. Closing connection...");
    ws.close();
  }, 120000);
}

// Run the test
testSafeSubscription().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
