import WebSocket from "ws";

const HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws";

/**
 * Test subscribing to multiple coins to see limits
 */
async function testMultiCoinSubscription() {
  console.log("🧪 Testing Multi-Coin Candle Subscription\n");
  console.log(`Connecting to: ${HYPERLIQUID_WS_URL}\n`);

  const ws = new WebSocket(HYPERLIQUID_WS_URL);
  
  let messageCount = 0;
  const confirmedSubscriptions = new Set<string>();
  const receivedCandles = new Set<string>();
  const subscriptionResponses: any[] = [];

  // Test with 50 popular coins
  const testCoins = [
    "BTC", "ETH", "SOL", "ARB", "OP", "MATIC", "AVAX", "DOT", "ATOM", "LINK",
    "UNI", "AAVE", "CRV", "LDO", "MKR", "SNX", "SUSHI", "COMP", "YFI", "BAL",
    "1INCH", "ENJ", "MANA", "SAND", "AXS", "GALA", "APE", "DYDX", "IMX", "GMT",
    "FTM", "NEAR", "ALGO", "XLM", "VET", "FIL", "THETA", "ICP", "ETC", "XMR",
    "LTC", "BCH", "EOS", "TRX", "XTZ", "EGLD", "FLOW", "HBAR", "APT", "SUI"
  ];

  ws.on("open", () => {
    console.log("✓ WebSocket connected\n");
    
    console.log(`📡 Subscribing to 1h candles for ${testCoins.length} coins...\n`);
    
    let subscribeCount = 0;
    const subscribeInterval = setInterval(() => {
      if (subscribeCount >= testCoins.length) {
        clearInterval(subscribeInterval);
        console.log(`\n✓ All ${testCoins.length} subscription requests sent\n`);
        console.log("⏳ Waiting for responses (will run for 90 seconds)...\n");
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
      subscribeCount++;
      
      if (subscribeCount % 10 === 0) {
        console.log(`   → Sent ${subscribeCount}/${testCoins.length} subscription requests...`);
      }
    }, 100); // 100ms between subscriptions
  });

  ws.on("message", (data: WebSocket.Data) => {
    messageCount++;
    
    try {
      const message = JSON.parse(data.toString());
      
      if (message.channel === "candle") {
        const coin = message.data.s;
        receivedCandles.add(coin);
        
        if (receivedCandles.size <= 5 || receivedCandles.size % 10 === 0) {
          console.log(`\n📊 Candle received from: ${coin} (total: ${receivedCandles.size} unique coins)`);
        }
      }
      
      if (message.channel === "subscriptionResponse") {
        const data = message.data as any;
        if (data?.method === "subscribe" && data?.subscription?.coin) {
          const coin = data.subscription.coin;
          confirmedSubscriptions.add(coin);
          subscriptionResponses.push(data);
          
          if (confirmedSubscriptions.size <= 10 || confirmedSubscriptions.size % 10 === 0) {
            console.log(`✓ Subscription confirmed: ${coin} (${confirmedSubscriptions.size}/${testCoins.length})`);
          }
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

  ws.on("close", () => {
    console.log("\n🔌 WebSocket closed");
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
    
    const unconfirmed = testCoins.filter(coin => !confirmedSubscriptions.has(coin));
    if (unconfirmed.length > 0) {
      console.log(`\n⚠️  Unconfirmed subscriptions (${unconfirmed.length}):`);
      console.log(unconfirmed.slice(0, 20).join(", ") + (unconfirmed.length > 20 ? "..." : ""));
    }
    
    const noCandles = testCoins.filter(coin => confirmedSubscriptions.has(coin) && !receivedCandles.has(coin));
    if (noCandles.length > 0) {
      console.log(`\n⚠️  Confirmed but no candles yet (${noCandles.length}):`);
      console.log(noCandles.slice(0, 20).join(", ") + (noCandles.length > 20 ? "..." : ""));
    }
    
    console.log("\n" + "=".repeat(70));
  }

  // Run for 90 seconds then close
  setTimeout(() => {
    console.log("\n\n⏱️  90 seconds elapsed. Closing connection...");
    ws.close();
  }, 90000);
}

// Run the test
testMultiCoinSubscription().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
