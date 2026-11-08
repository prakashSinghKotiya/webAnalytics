import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

export async function connectprismaSQLdb() {
  try {
    await prisma.$connect();
    console.log("postgreSQL Database connected");
  } catch (err) {
    console.log(err);
    console.log("Could Not Connect to the Database");
    process.exit(1);
  }
}

//await connectprismaSQLdb()

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  console.log("Client Disconnected!");
  process.exit(0);
});