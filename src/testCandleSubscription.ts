import WebSocket from "ws";

const HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws";

/**
 * Test candle subscription to diagnose why candles aren't arriving
 */
async function testCandleSubscription() {
  console.log("🧪 Testing Hyperliquid Candle Subscription\n");
  console.log(`Connecting to: ${HYPERLIQUID_WS_URL}\n`);

  const ws = new WebSocket(HYPERLIQUID_WS_URL);
  
  let messageCount = 0;
  const receivedChannels = new Set<string>();

  ws.on("open", () => {
    console.log("✓ WebSocket connected\n");
    
    // Try subscribing to a few popular coins
    const testCoins = ["BTC", "ETH", "SOL"];
    
    console.log(`📡 Subscribing to 1h candles for: ${testCoins.join(", ")}\n`);
    
    for (const coin of testCoins) {
      const subscription = {
        method: "subscribe",
        subscription: {
          type: "candle",
          coin: coin,
          interval: "1h",
        },
      };
      
      ws.send(JSON.stringify(subscription));
      console.log(`   → Sent subscription request for ${coin}`);
    }
    
    console.log("\n⏳ Waiting for messages (will run for 60 seconds)...\n");
    console.log("=" .repeat(70));
  });

  ws.on("message", (data: WebSocket.Data) => {
    messageCount++;
    
    try {
      const message = JSON.parse(data.toString());
      const timestamp = new Date().toISOString();
      
      receivedChannels.add(message.channel || "unknown");
      
      console.log(`\n[${timestamp}] Message #${messageCount}`);
      console.log(`Channel: ${message.channel || "NO CHANNEL"}`);
      console.log(`Data:`, JSON.stringify(message, null, 2));
      console.log("=" .repeat(70));
      
      // If we get a candle, that's great!
      if (message.channel === "candle") {
        console.log("\n✅ SUCCESS! Received candle data!");
      }
      
      // If we get subscription response, that's progress
      if (message.channel === "subscriptionResponse") {
        console.log("\n✓ Subscription response received");
      }
      
      // If we get an error, show it clearly
      if (message.channel === "error") {
        console.log("\n❌ ERROR received from WebSocket!");
      }
    } catch (err) {
      console.log(`\n[${new Date().toISOString()}] Raw message (not JSON):`);
      console.log(data.toString());
      console.log("=" .repeat(70));
    }
  });

  ws.on("error", (err: Error) => {
    console.error("\n❌ WebSocket error:", err);
  });

  ws.on("close", () => {
    console.log("\n🔌 WebSocket closed");
    console.log("\n" + "=".repeat(70));
    console.log("TEST SUMMARY");
    console.log("=".repeat(70));
    console.log(`Total messages received: ${messageCount}`);
    console.log(`Channels seen: ${Array.from(receivedChannels).join(", ") || "none"}`);
    console.log("=".repeat(70));
    process.exit(0);
  });

  // Run for 60 seconds then close
  setTimeout(() => {
    console.log("\n\n⏱️  60 seconds elapsed. Closing connection...");
    ws.close();
  }, 60000);
}

// Run the test
testCandleSubscription().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
