import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../index.js";

describe("uptime-lambda handler", () => {
  test("throws error if monitors array is missing", async () => {
    await assert.rejects(
      async () => {
        await handler({});
      },
      {
        message: "Invalid payload: 'monitors' must be an array of { id, url }",
      }
    );
  });

  test("processes batch of monitors and returns results array", async () => {
    const event = {
      monitors: [
        { id: 1, url: "https://httpbin.org/status/200" },
        { id: 2, url: "https://httpbin.org/status/503" },
      ],
    };

    const response = await handler(event);
    assert(response && Array.isArray(response.results));
    assert.equal(response.results.length, 2);

    const r1 = response.results.find((r) => r.monitorId === 1);
    const r2 = response.results.find((r) => r.monitorId === 2);

    assert(r1 && r1.result);
    assert.equal(r1.result.status, "UP");

    assert(r2 && r2.result);
    assert.equal(r2.result.status, "DOWN");
  });

  test("caps batch at 100 monitors", async () => {
    const monitors = Array.from({ length: 120 }, (_, i) => ({
      id: i + 1,
      url: "https://example.com",
    }));

    // Mock checkUrl to avoid making 100 network requests in unit test
    const event = { monitors };
    const response = await handler(event);
    assert.equal(response.results.length, 100);
  });
});

