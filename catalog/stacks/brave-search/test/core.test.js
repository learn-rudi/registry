import assert from "node:assert/strict";
import test from "node:test";

import { BraveSearchError, createBraveSearchClient } from "../src/core.js";

test("maps Brave web results into the normalized provider contract", async () => {
  const requests = [];
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({
        web: {
          results: [
            {
              age: "Aug 25, 2026",
              description: "First snippet.",
              title: "First result",
              url: "https://example.test/first",
            },
            {
              description: "Second snippet.",
              title: "Second result",
              url: "https://example.test/second",
            },
            {
              description: "Unsafe provider row.",
              title: "Unsafe result",
              url: "javascript:alert(1)",
            },
          ],
        },
      }), { status: 200 });
    },
    now: () => new Date("2026-08-25T16:00:00.000Z"),
  });

  const result = await client.searchWeb({
    count: 3,
    freshness: "2026-08-25to2026-08-25",
    query: "AI news",
    timeout_seconds: 5,
  });

  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.origin + requestUrl.pathname, "https://api.search.brave.com/res/v1/web/search");
  assert.equal(requestUrl.searchParams.get("q"), "AI news");
  assert.equal(requestUrl.searchParams.get("count"), "3");
  assert.equal(requestUrl.searchParams.get("freshness"), "2026-08-25to2026-08-25");
  assert.equal(requests[0].options.headers["X-Subscription-Token"], "test-key");
  assert.deepEqual(result, {
    count_requested: 3,
    freshness: "2026-08-25to2026-08-25",
    provider: "brave",
    query: "AI news",
    results: [
      {
        published_at: "Aug 25, 2026",
        rank: 1,
        snippet: "First snippet.",
        title: "First result",
        url: "https://example.test/first",
      },
      {
        rank: 2,
        snippet: "Second snippet.",
        title: "Second result",
        url: "https://example.test/second",
      },
    ],
    results_skipped: 1,
    retrieved_at: "2026-08-25T16:00:00.000Z",
  });
});

test("rejects a count above Brave's single-request limit before HTTP", async () => {
  let fetchCalled = false;
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    },
  });

  await assert.rejects(
    client.searchWeb({ count: 21, query: "AI news" }),
    /count must be an integer between 1 and 20/,
  );
  assert.equal(fetchCalled, false);
});

test("rejects an overlong query before HTTP", async () => {
  let fetchCalled = false;
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    },
  });

  await assert.rejects(
    client.searchWeb({ count: 10, query: "word ".repeat(51).trim() }),
    /query must contain at most 50 words/,
  );
  assert.equal(fetchCalled, false);
});

test("rejects invalid boundary types before HTTP", async () => {
  let fetchCalled = false;
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    },
  });

  await assert.rejects(
    client.searchWeb({ count: 10, query: 123 }),
    /query must be a string/,
  );
  await assert.rejects(
    client.searchWeb({ count: "10", query: "AI news" }),
    /count must be an integer/,
  );
  assert.equal(fetchCalled, false);
});

test("rejects unknown tool arguments before HTTP", async () => {
  let fetchCalled = false;
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    },
  });

  await assert.rejects(
    client.searchWeb({ count: 10, query: "AI news", unsafe_option: true }),
    /unsupported Brave Search arguments: unsafe_option/,
  );
  assert.equal(fetchCalled, false);
});

test("rejects a reversed custom freshness range before HTTP", async () => {
  let fetchCalled = false;
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    },
  });

  await assert.rejects(
    client.searchWeb({
      count: 10,
      freshness: "2026-08-26to2026-08-25",
      query: "AI news",
    }),
    /freshness range start must not be after its end/,
  );
  assert.equal(fetchCalled, false);
});

test("retries HTTP 429 with bounded provider guidance then succeeds", async () => {
  const sleeps = [];
  const responses = [
    new Response('{"error":"rate limited"}', {
      headers: { "Retry-After": "7" },
      status: 429,
    }),
    new Response('{"web":{"results":[]}}', { status: 200 }),
  ];
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => responses.shift(),
    sleepImpl: async (seconds) => sleeps.push(seconds),
  });

  const result = await client.searchWeb({ count: 10, query: "AI news" });

  assert.deepEqual(sleeps, [7]);
  assert.deepEqual(result.results, []);
});

test("retries a transient provider outage with bounded backoff", async () => {
  const sleeps = [];
  const responses = [
    new Response('{"error":"unavailable"}', { status: 503 }),
    new Response('{"web":{"results":[]}}', { status: 200 }),
  ];
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => responses.shift(),
    sleepImpl: async (seconds) => sleeps.push(seconds),
  });

  const result = await client.searchWeb({ count: 10, query: "AI news" });

  assert.deepEqual(sleeps, [2]);
  assert.deepEqual(result.results, []);
});

test("does not retry HTTP 402 and exposes a stable billing error", async () => {
  let calls = 0;
  const sleeps = [];
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      calls += 1;
      return new Response('{"error":"payment required"}', { status: 402 });
    },
    sleepImpl: async (seconds) => sleeps.push(seconds),
  });

  await assert.rejects(
    client.searchWeb({ count: 10, query: "AI news" }),
    (error) => {
      assert.ok(error instanceof BraveSearchError);
      assert.equal(error.code, "payment_required");
      assert.equal(error.retryable, false);
      assert.equal(error.status, 402);
      assert.doesNotMatch(error.message, /payment required\"/);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("rejects a malformed Brave web result collection", async () => {
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => new Response('{"web":{"results":"not-a-list"}}', { status: 200 }),
  });

  await assert.rejects(
    client.searchWeb({ count: 10, query: "AI news" }),
    (error) => {
      assert.ok(error instanceof BraveSearchError);
      assert.equal(error.code, "invalid_provider_response");
      assert.match(error.message, /web\.results/);
      return true;
    },
  );
});

test("rejects an unsafe request timeout before HTTP", async () => {
  let fetchCalled = false;
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    },
  });

  await assert.rejects(
    client.searchWeb({ count: 10, query: "AI news", timeout_seconds: 26 }),
    /timeout_seconds must be between 0.1 and 25/,
  );
  assert.equal(fetchCalled, false);
});

test("uses one end-to-end timeout budget across retries and backoff", async () => {
  let clockSeconds = 100;
  let calls = 0;
  const sleeps = [];
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      calls += 1;
      return new Response('{"error":"unavailable"}', { status: 503 });
    },
    monotonicSeconds: () => clockSeconds,
    sleepImpl: async (seconds) => {
      sleeps.push(seconds);
      clockSeconds += seconds;
    },
  });

  await assert.rejects(
    client.searchWeb({ count: 10, query: "AI news", timeout_seconds: 5 }),
    (error) => {
      assert.ok(error instanceof BraveSearchError);
      assert.equal(error.code, "request_timeout");
      return true;
    },
  );
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2]);
});

test("stops reading a provider body once the byte limit is exceeded", async () => {
  let canceled = false;
  let readIndex = 0;
  const chunks = [new Uint8Array(1_500_000), new Uint8Array(600_001)];
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => ({
      body: {
        getReader() {
          return {
            async cancel() {
              canceled = true;
            },
            async read() {
              const value = chunks[readIndex];
              readIndex += 1;
              return value ? { done: false, value } : { done: true, value: undefined };
            },
            releaseLock() {},
          };
        },
      },
      headers: new Headers(),
      ok: true,
      status: 200,
      async text() {
        throw new Error("unbounded text buffering was used");
      },
    }),
  });

  await assert.rejects(
    client.searchWeb({ count: 10, query: "AI news" }),
    (error) => {
      assert.ok(error instanceof BraveSearchError);
      assert.equal(error.code, "invalid_provider_response");
      assert.match(error.message, /bounded response size/);
      return true;
    },
  );
  assert.equal(canceled, true);
  assert.equal(readIndex, 2);
});

test("caps an over-returning provider at the requested result count", async () => {
  const client = createBraveSearchClient({
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      web: {
        results: [
          { title: "First", url: "https://example.test/first" },
          { title: "Unexpected", url: "https://example.test/unexpected" },
        ],
      },
    }), { status: 200 }),
  });

  const result = await client.searchWeb({ count: 1, query: "AI news" });

  assert.deepEqual(result.results.map((row) => row.url), [
    "https://example.test/first",
  ]);
  assert.equal(result.results_skipped, 1);
});
