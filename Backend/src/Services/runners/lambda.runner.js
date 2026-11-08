
export const runLambdaBatch = async (monitors, config = {}) => {
  if (!Array.isArray(monitors) || monitors.length === 0) {
    return [];
  }

  const endpoint = process.env.UPTIME_LAMBDA_URL;

  const secret = process.env.UPTIME_LAMBDA_SECRET;

  if (!endpoint || !secret) {
    throw new Error("Lambda URL or secret is missing");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-runner-secret": secret,
    },
    body: JSON.stringify({
      monitors: monitors.map(({ id, url }) => ({ id, url })),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(
      `Lambda runner failed: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  const results = Array.isArray(data)
    ? data
    : data.results;

  if (!Array.isArray(results)) {
    throw new Error("Invalid Lambda response format");
  }

  return results;
};

export default runLambdaBatch;