import { Redis } from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  db: parseInt(process.env.REDIS_DB || "0", 10),
});

redis.on("error", (err: Error) => {
  console.error("Redis Client Error:", err);
});

redis.on("connect", () => {
  console.log("Redis Client Connected");
});

export default redis;
