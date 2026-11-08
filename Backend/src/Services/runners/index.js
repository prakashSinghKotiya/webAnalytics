import { prisma } from "../../config/db.prismaSQL.js";
import { runLocalBatch } from "./local.runner.js";
import { runLambdaBatch } from "./lambda.runner.js";
import { runHttpBatch } from "./http.runner.js";

export const RUNNERS = {
  local: runLocalBatch,
  lambda: runLambdaBatch,
  http: runHttpBatch,
};

export const BUILTIN_LOCAL_RUNNER = Object.freeze({
  id: 0,
  name: "Main Server",
  type: "local",
  config: {},
  isActive: true,
  isDefault: true,
});

const CACHE_TTL_MS = 30_000; // 30 seconds
const RETRY_DELAY_MS = 500; // Short retry delay for failed runners

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let cachedDefaultRunner = null;
let defaultRunnerExpiresAt = 0;
const cachedRunnersById = new Map();

/**
 * Clears all in-memory runner caches (both the default runner and individual runners by ID).
 *
 * NOTE: Caches are in-memory and per-process. In a multi-process or clustered deployment
 * (e.g. separate scheduler and worker processes), caches in other processes may be up to
 * 30 seconds stale after an update until their TTL expires.
 */
export const clearRunnerCache = () => {
  cachedDefaultRunner = null;
  defaultRunnerExpiresAt = 0;
  cachedRunnersById.clear();
};

/**
 * Retrieves a runner by its numeric ID with a 30-second in-memory cache.
 *
 * @param {number|string} id - Database ID of the runner
 * @returns {Promise<{ id: number, name: string, type: 'local'|'lambda'|'http', config: object, isActive: boolean, isDefault: boolean }|null>}
 */
export const getRunnerById = async (id) => {
  if (id === null || id === undefined) return null;
  const numericId = Number(id);
  if (Number.isNaN(numericId)) return null;

  const now = Date.now();
  const cached = cachedRunnersById.get(numericId);
  if (cached && now < cached.expiresAt) {
    return cached.runner;
  }

  const runner = await prisma.uptimeRunner.findUnique({
    where: { id: numericId },
  });

  if (runner) {
    cachedRunnersById.set(numericId, {
      runner,
      expiresAt: now + CACHE_TTL_MS,
    });
  }

  return runner;
};

/**
 * Retrieves the currently configured default runner from the database with a 30-second cache.
 * If no default runner exists in the database, returns the built-in LOCAL runner object.
 *
 * @returns {Promise<{ id: number, name: string, type: 'local'|'lambda'|'http', config: object, isActive: boolean, isDefault: boolean }>}
 */
export const getDefaultRunner = async () => {
  const now = Date.now();
  if (cachedDefaultRunner && now < defaultRunnerExpiresAt) {
    return cachedDefaultRunner;
  }

  const defaultRunner = await prisma.uptimeRunner.findFirst({
    where: { isDefault: true },
  });

  const runner = defaultRunner || BUILTIN_LOCAL_RUNNER;

  cachedDefaultRunner = runner;
  defaultRunnerExpiresAt = now + CACHE_TTL_MS;

  return runner;
};

/**
 * Ensures at least one default runner exists in the database.
 * If no runner with isDefault=true exists, looks for a local runner or creates "Local Server (Main)".
 *
 * @returns {Promise<{ id: number, name: string, type: string, isActive: boolean, isDefault: boolean }>}
 */
export const ensureDefaultRunner = async () => {
  let defaultRunner = await prisma.uptimeRunner.findFirst({
    where: { isDefault: true },
  });

  if (!defaultRunner) {
    const mainRunner = await prisma.uptimeRunner.findFirst({
      where: { name: "Main Server" },
    });
    if (mainRunner) {
      defaultRunner = await prisma.uptimeRunner.update({
        where: { id: mainRunner.id },
        data: { isDefault: true, isActive: true },
      });
    } else {
      defaultRunner = await prisma.uptimeRunner.create({
        data: {
          name: "Main Server",
          type: "local",
          config: {},
          isActive: true,
          isDefault: true,
        },
      });
    }
    clearRunnerCache();
  }
  return defaultRunner;
};

/**
 * Deprecated alias for getDefaultRunner(). Maintained for backward compatibility.
 *
 * @deprecated Use getDefaultRunner() instead.
 * @returns {Promise<{ id: number, name: string, type: 'local'|'lambda'|'http', config: object, isActive: boolean, isDefault: boolean }>}
 */
export const getActiveRunner = async () => {
  return getDefaultRunner();
};

/**
 * Executes a batch of monitor checks using an explicit runner or the default runner.
 *
 * Failure handling:
 * 1. If the runner fails, it is retried once after a short delay (500ms).
 * 2. If the runner still fails and is NOT the default runner, it falls back to the DEFAULT runner
 *    (provided RUNNER_FALLBACK_LOCAL !== 'false').
 * 3. The result is tagged with `<runnerName>->fallback`.
 * 4. If the default runner itself fails, the error is rethrown.
 *
 * @param {Array<{ id: number|string, url: string }>} monitors - Batch of monitors to check
 * @param {object|number|string|null} [explicitRunner=null] - Specific runner object or runner ID to use
 * @returns {Promise<{ runnerName: string, results: Array<{ monitorId: number|string, result: object }> }>}
 */
export const runBatch = async (monitors, explicitRunner = null) => {
  if (!Array.isArray(monitors) || monitors.length === 0) {
    return { runnerName: "none", results: [] };
  }

  let runner = explicitRunner;
  if (typeof runner === "number" || typeof runner === "string") {
    runner = await getRunnerById(runner);
  }
  if (!runner) {
    runner = await getDefaultRunner();
  }

  const runnerFn = RUNNERS[runner.type];
  if (!runnerFn) {
    throw new Error(
      `Unsupported runner type '${runner.type}' configured for runner '${runner.name}'`
    );
  }

  // Helper for single retry execution
  const executeWithRetry = async (r, fn) => {
    try {
      return await fn(monitors, r.config);
    } catch (firstErr) {
      console.warn(
        `[Uptime Runners] Runner '${r.name}' (${r.type}) failed initial attempt: ${firstErr.message}. Retrying once after ${RETRY_DELAY_MS}ms...`
      );
      await sleep(RETRY_DELAY_MS);
      return await fn(monitors, r.config);
    }
  };

  try {
    const results = await executeWithRetry(runner, runnerFn);
    return {
      runnerName: runner.name || "Main Server",
      results,
    };
  } catch (runnerErr) {
    console.warn(
      `[Uptime Runners] Runner '${runner.name}' (${runner.type}) failed after retry:`,
      runnerErr.message
    );

    const defaultRunner = await getDefaultRunner();
    const isTargetDefault =
      Boolean(runner.isDefault) ||
      (runner.id !== undefined && runner.id !== null && runner.id === defaultRunner.id) ||
      (runner.id === 0 && defaultRunner.id === 0);

    // If the default runner itself failed, throw immediately
    if (isTargetDefault) {
      console.error(
        `[Uptime Runners] Default runner '${runner.name}' (${runner.type}) failed. No secondary fallback available.`
      );
      throw runnerErr;
    }

    const isFallbackEnabled = process.env.RUNNER_FALLBACK_LOCAL !== "false";
    if (!isFallbackEnabled) {
      throw runnerErr;
    }

    const fallbackRunnerName = `${runner.name}->fallback`;
    console.warn(
      `[Uptime Runners] Triggering fallback to default runner '${defaultRunner.name}' (${fallbackRunnerName}) for ${monitors.length} monitor(s)...`
    );

    const defaultRunnerFn = RUNNERS[defaultRunner.type];
    if (!defaultRunnerFn) {
      throw new Error(
        `Unsupported default runner type '${defaultRunner.type}' for fallback runner '${defaultRunner.name}'`
      );
    }

    try {
      const fallbackResults = await defaultRunnerFn(monitors, defaultRunner.config);
      return {
        runnerName: fallbackRunnerName,
        results: fallbackResults,
      };
    } catch (fallbackErr) {
      console.error(
        `[Uptime Runners] Default fallback also failed for runner '${runner.name}':`,
        fallbackErr.message
      );
      throw fallbackErr;
    }
  }
};

export default {
  RUNNERS,
  BUILTIN_LOCAL_RUNNER,
  getRunnerById,
  getDefaultRunner,
  getActiveRunner,
  clearRunnerCache,
  runBatch,
};

