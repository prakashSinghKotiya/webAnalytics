import "dotenv/config";
import pg from "pg";

const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});


try {
  await client.connect();

  console.log("Starting database cleanup...");

  // Execute CALL as a standalone statement.
  await client.query(
  "SELECT public.cleanup_expired_rows(10000)"
);

  console.log("Database cleanup completed successfully.");
} catch (error) {
  console.error("Database cleanup failed:", error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}