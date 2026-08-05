import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createPoolConfig } from "../dist/contract.js";

const RUN_LIVE_TESTS = process.env.RUDI_CRM_LIVE_TESTS === "1";
const DATABASE_URL = process.env.RUDI_CRM_DATABASE_URL;
const liveSkipReason = !RUN_LIVE_TESTS
  ? "Set RUDI_CRM_LIVE_TESTS=1 to run live contact DB behavior tests"
  : !DATABASE_URL
    ? "RUDI_CRM_DATABASE_URL is required for live contact DB behavior tests"
    : false;

const { Pool } = pg;

async function recordObservations(client, observations) {
  const result = await client.query(
    "select record_discovery_observations($1::jsonb) as result",
    [JSON.stringify(observations)]
  );
  return result.rows[0]?.result;
}

async function promoteContact(client, overrides) {
  const result = await client.query(
    `
    select promote_contact(
      p_email := $1::text,
      p_full_name := $2::text,
      p_existing_person_id := $3::uuid,
      p_organization_id := $4::uuid,
      p_title := $5::text,
      p_phone := $6::text,
      p_role := $7::text,
      p_notes := $8::text,
      p_email_label := $9::text,
      p_source := $10::text,
      p_created_by_actor_id := $11::uuid
    ) as result
    `,
    [
      overrides.email,
      overrides.full_name,
      overrides.existing_person_id ?? null,
      overrides.organization_id ?? null,
      overrides.title ?? null,
      overrides.phone ?? null,
      overrides.role ?? null,
      overrides.notes ?? null,
      overrides.email_label ?? "work",
      overrides.source ?? "gmail",
      overrides.created_by_actor_id ?? null,
    ]
  );
  return result.rows[0]?.result;
}

test(
  "contact discovery preview and promotion are deduplicated, atomic, and rollback-safe",
  { skip: liveSkipReason },
  async () => {
    const pool = new Pool(createPoolConfig(DATABASE_URL));
    const client = await pool.connect();
    const runId = randomUUID();
    const candidateDomain = `contact-${runId}.example.invalid`;
    const candidateEmail = `candidate@${candidateDomain}`;
    const noReplyEmail = `no-reply@${candidateDomain}`;
    const aliasEmail = `alias-${runId}@example.invalid`;
    const sourcePrefix = `live-contact-test-${runId}`;
    let createdPersonId;

    try {
      const people = await client.query(
        "select id from people order by created_at, id limit 2"
      );
      assert.equal(people.rowCount, 2, "live CRM needs two existing people for collision proof");

      await client.query("begin");
      try {
        const baseObservations = [
          {
            source: "gmail",
            source_id: `${sourcePrefix}-1`,
            source_thread_id: `${sourcePrefix}-thread`,
            observed_at: "2026-08-01T09:00:00-04:00",
            address_role: "recipient",
            address: candidateEmail,
            raw: { mailbox: "synthetic-live-test" },
          },
          {
            source: "gmail",
            source_id: `${sourcePrefix}-2`,
            source_thread_id: `${sourcePrefix}-thread`,
            observed_at: "2026-08-02T09:00:00-04:00",
            address_role: "sender",
            address: candidateEmail,
            raw: { mailbox: "synthetic-live-test" },
          },
          {
            source: "gmail",
            source_id: `${sourcePrefix}-3`,
            source_thread_id: `${sourcePrefix}-automated-thread`,
            observed_at: "2026-08-03T09:00:00-04:00",
            address_role: "from",
            address: noReplyEmail,
            display_name: "Automated Sender",
            raw: { mailbox: "synthetic-live-test" },
          },
        ];

        const inserted = await recordObservations(client, baseObservations);
        assert.equal(inserted.received, 3);
        assert.equal(inserted.inserted, 3);
        assert.equal(inserted.updated, 0);

        const enriched = await recordObservations(client, [
          {
            ...baseObservations[0],
            display_name: "Synthetic Candidate",
            idempotency_key: `${sourcePrefix}-stable`,
            raw: { envelope_version: 1 },
          },
        ]);
        assert.equal(enriched.inserted, 0);
        assert.equal(enriched.duplicates, 1);
        assert.equal(enriched.updated, 1);

        await client.query("select apply_discovery_domain_heuristics()");
        const candidate = await client.query(
          `
          select *
          from v_contact_candidates
          where email = $1::text
          `,
          [candidateEmail]
        );
        assert.equal(candidate.rowCount, 1);
        assert.equal(candidate.rows[0].display_name, "Synthetic Candidate");
        assert.equal(candidate.rows[0].observation_count, 2);
        assert.equal(candidate.rows[0].message_count, 2);
        assert.equal(candidate.rows[0].thread_count, 1);
        assert.equal(candidate.rows[0].existing_person_id, null);

        const noReplyCandidate = await client.query(
          "select count(*)::integer as count from v_contact_candidates where email = $1::text",
          [noReplyEmail]
        );
        assert.equal(noReplyCandidate.rows[0]?.count, 0);

        const created = await promoteContact(client, {
          email: candidateEmail.toUpperCase(),
          full_name: "Synthetic Candidate",
        });
        assert.equal(created.status, "created");
        assert.equal(created.created_person, true);
        createdPersonId = created.person_id;

        const replay = await promoteContact(client, {
          email: candidateEmail,
          full_name: "Synthetic Candidate",
        });
        assert.equal(replay.status, "existing");
        assert.equal(replay.person_id, created.person_id);

        const exactCandidate = await client.query(
          "select existing_person_id from v_contact_candidates where email = $1::text",
          [candidateEmail]
        );
        assert.equal(exactCandidate.rows[0]?.existing_person_id, created.person_id);

        const attached = await promoteContact(client, {
          email: aliasEmail,
          full_name: "Explicit Existing Person",
          existing_person_id: people.rows[0].id,
          email_label: "alias",
        });
        assert.equal(attached.person_id, people.rows[0].id);
        assert.equal(attached.attached_email, true);

        const aliasReplay = await promoteContact(client, {
          email: aliasEmail,
          full_name: "Explicit Existing Person",
          existing_person_id: people.rows[0].id,
          email_label: "alias",
        });
        assert.equal(aliasReplay.status, "existing");

        await client.query("savepoint alias_collision");
        await assert.rejects(
          () =>
            promoteContact(client, {
              email: aliasEmail,
              full_name: "Wrong Existing Person",
              existing_person_id: people.rows[1].id,
              email_label: "alias",
            }),
          /email collision/
        );
        await client.query("rollback to savepoint alias_collision");

        const validators = await client.query(`
          select count(*)::integer as violations
          from (
            select 1 from v_validate_people_email_mirror
            union all
            select 1 from v_validate_audit_trigger_coverage
          ) violations
        `);
        assert.equal(validators.rows[0]?.violations, 0);
      } finally {
        await client.query("rollback");
      }

      const residue = await client.query(
        `
        select
          (select count(*)::integer from discovery_observations where source_id like $1::text) as observations,
          (select count(*)::integer from person_emails where email in ($2::text, $3::text)) as emails,
          (select count(*)::integer from people where id = $4::uuid) as people
        `,
        [`${sourcePrefix}%`, candidateEmail, aliasEmail, createdPersonId]
      );
      assert.equal(residue.rows[0]?.observations, 0);
      assert.equal(residue.rows[0]?.emails, 0);
      assert.equal(residue.rows[0]?.people, 0);
    } finally {
      client.release();
      await pool.end();
    }
  }
);
