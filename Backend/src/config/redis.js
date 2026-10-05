import Redis from "ioredis";

const connection = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
};

export const sharedRedisConnection = new Redis({
    ...connection,
    maxRetriesPerRequest: 20,
});

sharedRedisConnection.on("connect", () => {
      console.error("redis connected ");
    })
sharedRedisConnection.on("error", (err) => {
      console.error("[Redis] Shared client error:", err.message);
    })

    

export const sharedWorkerRedisConnection = new Redis({
    ...connection,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});


export default connection;


// import Redis from "ioredis";

// const connection = {
//   host: process.env.REDIS_HOST || "127.0.0.1",
//   port: Number(process.env.REDIS_PORT || process.env.REDIS_port || 6379),
//   username: process.env.REDIS_USERNAME || undefined,
//   password: process.env.REDIS_PASSWORD || undefined,
//   maxRetriesPerRequest: null,
//   enableReadyCheck: false,
// };

// // Shared Redis client for BullMQ Queue instances (producers)
// // BullMQ allows non-blocking Queue producers to share a single Redis client connection.
// let sharedRedisInstance = null;

// export const getSharedRedisClient = () => {
//   if (!sharedRedisInstance) {
//     sharedRedisInstance = new Redis(connection);

//     sharedRedisInstance.on("error", (err) => {
//       console.error("[Redis] Shared client error:", err.message);
//     });
//   }
//   return sharedRedisInstance;
// };

// export const sharedRedisConnection = getSharedRedisClient();




// export default connection;
