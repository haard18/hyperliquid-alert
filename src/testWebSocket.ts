import WebSocket from "ws";

const HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws";
const TEST_COIN = "BTC";
const CANDLE_INTERVAL = "1h";

console.log(`Connecting to ${HYPERLIQUID_WS_URL}...`);
const ws = new WebSocket(HYPERLIQUID_WS_URL);

ws.on("open", () => {
  console.log("✓ WebSocket connected");
  
  // Subscribe to BTC 1h candles
  const subscription = {
    method: "subscribe",
    subscription: {
      type: "candle",
      coin: TEST_COIN,
      interval: CANDLE_INTERVAL,
    },
  };
  
  console.log(`Subscribing to ${TEST_COIN} ${CANDLE_INTERVAL} candles...`);
  console.log("Subscription payload:", JSON.stringify(subscription, null, 2));
  ws.send(JSON.stringify(subscription));
});

ws.on("message", (data: WebSocket.Data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log("\n" + "=".repeat(70));
    console.log("Message received:");
    console.log(JSON.stringify(message, null, 2));
    console.log("=".repeat(70));
    
    if (message.channel === "candle") {
      console.log("✓ CANDLE DATA RECEIVED!");
    } else if (message.channel === "subscriptionResponse") {
      console.log("✓ Subscription response received");
    } else if (message.channel === "error") {
      console.log("❌ ERROR MESSAGE RECEIVED");
    }
  } catch (err) {
    console.error("Error parsing message:", err);
    console.log("Raw data:", data.toString());
  }
});

ws.on("error", (err: Error) => {
  console.error("WebSocket error:", err);
});

ws.on("close", () => {
  console.log("WebSocket closed");
  process.exit(0);
});

// Run for 30 seconds then close
setTimeout(() => {
  console.log("\nTest complete, closing connection...");
  ws.close();
}, 30000);

