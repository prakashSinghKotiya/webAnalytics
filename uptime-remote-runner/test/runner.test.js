import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { app, verifySecret } from "../server.js";

describe("uptime-remote-runner HTTP server", () => {
  let server;
  let baseUrl;
  const TEST_SECRET = "super_secure_test_secret_12345";

  before(async () => {
    process.env.RUNNER_SECRET = TEST_SECRET;
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("verifySecret performs accurate constant-time matching", () => {
    assert.equal(verifySecret(TEST_SECRET, TEST_SECRET), true);
    assert.equal(verifySecret("wrong_secret", TEST_SECRET), false);
    assert.equal(verifySecret("", TEST_SECRET), false);
    assert.equal(verifySecret(undefined, TEST_SECRET), false);
    assert.equal(verifySecret("super_secure_test_secret_1234", TEST_SECRET), false);
  });

  test("GET /health returns status ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "ok");
    assert.equal(data.runner, "http");
  });

  test("POST /run-checks returns 401 without x-runner-secret", async () => {
    const res = await fetch(`${baseUrl}/run-checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monitors: [{ id: 1, url: "https://example.com" }] }),
    });
    assert.equal(res.status, 401);
  });

  test("POST /run-checks returns 401 with invalid x-runner-secret", async () => {
    const res = await fetch(`${baseUrl}/run-checks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-runner-secret": "invalid_secret_token",
      },
      body: JSON.stringify({ monitors: [{ id: 1, url: "https://example.com" }] }),
    });
    assert.equal(res.status, 401);
  });

  test("POST /run-checks returns 400 when monitors payload is not an array", async () => {
    const res = await fetch(`${baseUrl}/run-checks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-runner-secret": TEST_SECRET,
      },
      body: JSON.stringify({ monitors: "invalid" }),
    });
    assert.equal(res.status, 400);
  });

  test("POST /run-checks executes checks and returns results", async () => {
    const res = await fetch(`${baseUrl}/run-checks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-runner-secret": TEST_SECRET,
      },
      body: JSON.stringify({
        monitors: [
          { id: 10, url: "https://httpbin.org/status/200" },
          { id: 20, url: "https://httpbin.org/status/502" },
        ],
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert(Array.isArray(data.results));
    assert.equal(data.results.length, 2);

    const r1 = data.results.find((r) => r.monitorId === 10);
    const r2 = data.results.find((r) => r.monitorId === 20);

    assert(r1 && r1.result);
    assert.equal(r1.result.status, "UP");

    assert(r2 && r2.result);
    assert.equal(r2.result.status, "DOWN");
  });
});

