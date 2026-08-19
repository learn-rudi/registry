import assert from "node:assert/strict";
import test from "node:test";
import { createPoolConfig } from "../dist/contract.js";
import {
  ActivityFeedInput,
  AttentionBriefInput,
  ClassifyContactAddressInput,
  ListPeopleInput,
  ListContactCandidatesInput,
  PromoteContactInput,
  RecordFinanceEventInput,
  RudiCrmObservation,
  UpsertInteractionInput,
} from "../dist/schemas.js";

test("pool config maps explicit PostgreSQL sslmode to TLS options", () => {
  const config = createPoolConfig(
    "postgresql://postgres:secret@db.example.invalid:5432/postgres?sslmode=require"
  );

  assert.equal(config.ssl.rejectUnauthorized, false);
  assert.equal(config.connectionString.includes("sslmode=require"), false);
  assert.equal(config.connectionString.startsWith("postgresql://postgres:"), true);
});

test("pool config does not infer transport policy from a database provider hostname", () => {
  const providerUrl =
    "postgresql://postgres:secret@db.example-project.supabase.co:5432/postgres";
  const localUrl = "postgresql://hoff@127.0.0.1:5432/rudi_crm";

  assert.deepEqual(createPoolConfig(providerUrl), { connectionString: providerUrl });
  assert.deepEqual(createPoolConfig(localUrl), { connectionString: localUrl });
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

test("contact discovery schemas enforce bounded preview and explicit promotion", () => {
  const preview = ListContactCandidatesInput.parse({
    min_observations: 3,
    since: "2025-08-04T00:00:00-04:00",
    address_category: "shared_inbox",
  });

  assert.equal(preview.limit, 25);
  assert.equal(preview.offset, 0);
  assert.equal(preview.include_existing, false);
  assert.equal(preview.address_category, "shared_inbox");
  assert.throws(() => ListContactCandidatesInput.parse({ min_observations: 0 }));
  assert.throws(() => ListContactCandidatesInput.parse({ limit: 101 }));
  assert.throws(() => ListContactCandidatesInput.parse({ since: "2025-08-04" }));
  assert.throws(() => ListContactCandidatesInput.parse({ address_category: "company" }));

  const promotion = PromoteContactInput.parse({
    email: "  Contact@Example.COM ",
    full_name: "Example Contact",
    source: "gmail",
  });

  assert.equal(promotion.email, "contact@example.com");
  assert.equal(promotion.source, "gmail");
  assert.throws(() =>
    PromoteContactInput.parse({ email: "not-an-email", full_name: "Example Contact" })
  );
  assert.throws(() =>
    PromoteContactInput.parse({ email: "contact@example.com", full_name: "   " })
  );
  assert.throws(() =>
    PromoteContactInput.parse({
      email: "contact@example.com",
      full_name: "Example Contact",
      existing_person_id: "not-a-uuid",
    })
  );

  const classification = ClassifyContactAddressInput.parse({
    email: "  Info@Cintrifuse.COM ",
    category: "shared_inbox",
    source: "manual",
    reason: "Organization-level inbox confirmed by the user.",
  });
  assert.equal(classification.email, "info@cintrifuse.com");
  assert.equal(classification.category, "shared_inbox");
  assert.equal(classification.source, "manual");
  assert.throws(() =>
    ClassifyContactAddressInput.parse({
      email: "not-an-email",
      category: "person",
      source: "manual",
    })
  );
  assert.throws(() =>
    ClassifyContactAddressInput.parse({
      email: "info@cintrifuse.com",
      category: "company",
      source: "manual",
    })
  );
});

test("discovery observations align source, role, timestamp, and metadata boundaries", () => {
  const observation = RudiCrmObservation.parse({
    source: "gmail",
    source_id: "message-123",
    observed_at: "2026-08-04T09:00:00-04:00",
    address_role: "recipient",
    address: " Person@Example.COM ",
    display_name: "Example Person",
    raw: { mailbox: "header-only" },
  });

  assert.equal(observation.address_role, "recipient");
  assert.equal(observation.address, "person@example.com");
  assert.throws(() => RudiCrmObservation.parse({ ...observation, source: "webhook" }));
  assert.throws(() =>
    RudiCrmObservation.parse({ ...observation, observed_at: "2026-08-04 09:00:00" })
  );
  assert.throws(() =>
    RudiCrmObservation.parse({ ...observation, display_name: "x".repeat(201) })
  );
  assert.throws(() => RudiCrmObservation.parse({ ...observation, address: "not-an-email" }));
});
