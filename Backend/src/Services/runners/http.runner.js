
export const runHttpBatch = async (monitors, config = {}) => {
  if (!Array.isArray(monitors) || monitors.length === 0) {
    return [];
  }

  const endpointUrl = config.url;
  if (!endpointUrl) {
    throw new Error("HTTP runner misconfigured: 'url' is required in config");
  }

  const secretEnvName = config.secretEnv || "RUNNER_SECRET";
  const secret = process.env[secretEnvName];
  if (!secret) {
    throw new Error(
      `HTTP runner misconfigured: shared secret env var '${secretEnvName}' is not defined`
    );
  }

  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-runner-secret": secret,
    },
    body: JSON.stringify({
      monitors: monitors.map((m) => ({ id: m.id, url: m.url })),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Remote HTTP runner failed with HTTP ${response.status}: ${errorText.slice(0, 300)}`
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`Failed to parse HTTP runner JSON response: ${err.message}`);
  }

  const results = Array.isArray(data) ? data : data?.results;
  if (!Array.isArray(results)) {
    throw new Error(
      "Invalid HTTP runner response format: expected array or object with 'results' array"
    );
  }

  return results;
};

export default runHttpBatch;

