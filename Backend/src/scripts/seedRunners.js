import { prisma } from "../config/db.prismaSQL.js";

/**
 * Seeds or updates the default local runner in the database.
 * Enforces that the Main Server (local) is active and configured as the default runner.
 */
export const seedDefaultRunner = async () => {
  try {
    const runner = await prisma.uptimeRunner.upsert({
      where: { name: "Main Server" },
      update: {
        type: "local",
        isActive: true,
        isDefault: true,
      },
      create: {
        name: "Main Server",
        type: "local",
        isActive: true,
        isDefault: true,
        config: {},
      },
    });

    console.log(`[Seed Runners] Default runner configured:`, {
      id: runner.id,
      name: runner.name,
      type: runner.type,
      isActive: runner.isActive,
      isDefault: runner.isDefault,
    });

    return runner;
  } catch (err) {
    console.error("[Seed Runners] Error seeding default runner:", err);
    throw err;
  }
};

// Execute if run directly from CLI
if (process.argv[1]?.endsWith("seedRunners.js")) {
  seedDefaultRunner()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export default seedDefaultRunner;

