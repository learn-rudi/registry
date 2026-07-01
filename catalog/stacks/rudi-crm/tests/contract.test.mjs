import assert from "node:assert/strict";
import test from "node:test";
import { createPoolConfig } from "../dist/contract.js";
import {
  ActivityFeedInput,
  AttentionBriefInput,
  ListPeopleInput,
  RecordFinanceEventInput,
  UpsertInteractionInput,
} from "../dist/schemas.js";

test("pool config forces Supabase connections through explicit TLS options", () => {
  const config = createPoolConfig(
    "postgresql://postgres:secret@db.example-project.supabase.co:5432/postgres?sslmode=require"
  );

  assert.equal(config.ssl.rejectUnauthorized, false);
  assert.equal(config.connectionString.includes("sslmode=require"), false);
  assert.equal(config.connectionString.startsWith("postgresql://postgres:"), true);
});

test("upsert interaction schema validates normalized connector payloads", () => {
  const payload = {
    source: "gmail",
    source_id: "message-123",
    channel: "email",
    direction: "inbound",
    occurred_at: "2026-06-27T15:00:00Z",
    subject: "Follow up",
    summary: "Client replied with next steps.",
    engagement_id: "550e8400-e29b-41d4-a716-446655440000",
  };

  assert.equal(UpsertInteractionInput.parse(payload).source_id, "message-123");
  assert.throws(() => UpsertInteractionInput.parse({ ...payload, direction: "sideways" }));
  assert.throws(() => UpsertInteractionInput.parse({ ...payload, occurred_at: "not-a-date" }));
  assert.throws(() => UpsertInteractionInput.parse({ ...payload, engagement_id: "not-a-uuid" }));
});

test("tier one read schemas validate bounded filters", () => {
  const peopleInput = ListPeopleInput.parse({
    search: "phil",
    has_email: true,
    limit: 100,
    offset: 0,
  });

  assert.equal(peopleInput.limit, 100);
  assert.equal(peopleInput.offset, 0);
  assert.throws(() => ListPeopleInput.parse({ limit: 101 }));
  assert.throws(() => ListPeopleInput.parse({ offset: -1 }));

  const feedInput = ActivityFeedInput.parse({
    direction: "inbound",
    since: "2026-06-27T15:00:00Z",
  });

  assert.equal(feedInput.direction, "inbound");
  assert.throws(() => ActivityFeedInput.parse({ direction: "sideways" }));
  assert.throws(() => ActivityFeedInput.parse({ since: "2026-06-27T15:00:00" }));

  const briefInput = AttentionBriefInput.parse({ as_of: "2026-06-27" });

  assert.equal(briefInput.stale_days, 14);
  assert.equal(briefInput.limit, 25);
  assert.throws(() => AttentionBriefInput.parse({ as_of: "06/27/2026" }));
});

test("record finance event schema enforces money + source contract", () => {
  const base = {
    engagement_id: "550e8400-e29b-41d4-a716-446655440000",
    event_type: "invoice",
    amount: 2500,
    occurred_at: "2026-06-27T15:00:00Z",
    source: "manual",
  };

  const parsed = RecordFinanceEventInput.parse(base);
  assert.equal(parsed.direction, "positive");
  assert.equal(parsed.currency, "USD");
  assert.equal(parsed.amount, 2500);

  // non-manual sources must carry a stable source_id (idempotency key)
  assert.throws(() => RecordFinanceEventInput.parse({ ...base, source: "gmail" }));
  assert.equal(
    RecordFinanceEventInput.parse({ ...base, source: "gmail", source_id: "msg-1" }).source_id,
    "msg-1"
  );

  // bounded enums + non-negative money + offset-aware timestamp
  assert.throws(() => RecordFinanceEventInput.parse({ ...base, event_type: "donation" }));
  assert.throws(() => RecordFinanceEventInput.parse({ ...base, amount: -5 }));
  assert.throws(() => RecordFinanceEventInput.parse({ ...base, currency: "usd" }));
  assert.throws(() => RecordFinanceEventInput.parse({ ...base, direction: "sideways" }));
  assert.throws(() => RecordFinanceEventInput.parse({ ...base, occurred_at: "2026-06-27" }));
});
