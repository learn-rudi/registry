import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { createPoolConfig } from "../dist/contract.js";
import { applyMigrations, validateDatabaseUrl } from "../dist/migrate.js";

const RUN_TESTS = process.env.RUDI_CRM_DISCOVERY_SECURITY_TESTS === "1";
const ADMIN_DATABASE_URL =
  process.env.RUDI_CRM_TEST_ADMIN_URL ?? "postgresql://127.0.0.1:5432/postgres";
const skipReason = RUN_TESTS
  ? false
  : "Set RUDI_CRM_DISCOVERY_SECURITY_TESTS=1 to run isolated privilege/replay tests";
const { Pool } = pg;

const RECORD_FUNCTION =
  "public.record_discovery_page(text,text,text,text,text,integer,text,timestamp with time zone,jsonb)";
const FINALIZE_FUNCTION =
  "public.finalize_discovery_run(text,text,text,text,text,timestamp with time zone,integer,integer)";

function hash(character) {
  return character.repeat(64);
}

function databaseUrl(adminUrl, databaseName, user, applicationName) {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  if (user) url.username = user;
  url.password = "";
  if (applicationName) url.searchParams.set("application_name", applicationName);
  return url.toString();
}

function recordParams(overrides = {}) {
  return [
    overrides.schema_version ?? "1",
    overrides.source ?? "gmail",
    overrides.account_scope ?? "owner@example.com",
    overrides.calendar_scope ?? null,
    overrides.run_key ?? hash("a"),
    overrides.page_number ?? 1,
    overrides.page_key ?? hash("b"),
    overrides.cutoff ?? "2026-08-01T00:00:00Z",
    JSON.stringify(
      overrides.observations ?? [
        {
          resource_key: hash("c"),
          observed_at: "2026-07-01T12:00:00Z",
          address_role: "from",
          address: "no-reply@example.com",
        },
      ]
    ),
  ];
}

function finalizeParams(overrides = {}) {
  return [
    overrides.schema_version ?? "1",
    overrides.source ?? "gmail",
    overrides.account_scope ?? "owner@example.com",
    overrides.calendar_scope ?? null,
    overrides.run_key ?? hash("a"),
    overrides.cutoff ?? "2026-08-01T00:00:00Z",
    overrides.expected_pages ?? 1,
    overrides.expected_records ?? 1,
  ];
}

test(
  "discovery database profile denies promotion and direct DML while page/finalize replay safely",
  { skip: skipReason },
  async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const databaseName = `rudi_crm_discovery_${suffix}`;
    const groupRole = `rudi_crm_discovery_${suffix}`;
    const loginRole = `rudi_crm_discovery_login_${suffix}`;
    for (const identifier of [databaseName, groupRole, loginRole]) {
      assert.match(identifier, /^[a-z0-9_]+$/);
    }

    const adminPool = new Pool(createPoolConfig(validateDatabaseUrl(ADMIN_DATABASE_URL)));
    let targetPool;
    let discoveryPool;
    try {
      await adminPool.query(`create database "${databaseName}"`);
      await applyMigrations({
        databaseUrl: databaseUrl(ADMIN_DATABASE_URL, databaseName),
        directory: process.env.RUDI_CRM_TEST_MIGRATION_DIR || undefined,
      });
      targetPool = new Pool(
        createPoolConfig(databaseUrl(ADMIN_DATABASE_URL, databaseName))
      );

      await adminPool.query(`create role "${groupRole}" nologin`);
      await adminPool.query(`create role "${loginRole}" login`);
      await adminPool.query(`grant "${groupRole}" to "${loginRole}"`);
      await targetPool.query(`grant usage on schema public to "${groupRole}"`);
      await targetPool.query(`grant execute on function ${RECORD_FUNCTION} to "${groupRole}"`);
      await targetPool.query(`grant execute on function ${FINALIZE_FUNCTION} to "${groupRole}"`);

      discoveryPool = new Pool(
        createPoolConfig(
          databaseUrl(
            ADMIN_DATABASE_URL,
            databaseName,
            loginRole,
            "rudi-crm-discovery-security-test"
          )
        )
      );

      const identity = await discoveryPool.query(
        "select session_user as session_user_name, current_user as current_user_name"
      );
      assert.deepEqual(identity.rows[0], {
        session_user_name: loginRole,
        current_user_name: loginRole,
      });
      await assert.rejects(
        discoveryPool.query("select * from public.discovery_runs"),
        /permission denied/
      );
      await assert.rejects(
        discoveryPool.query(
          "insert into public.discovery_runs default values"
        ),
        /permission denied/
      );
      await assert.rejects(
        discoveryPool.query(
          "select public.promote_contact($1,$2)",
          ["person@example.com", "Person"]
        ),
        /permission denied/
      );

      const privileges = await targetPool.query(
        `
        select
          has_function_privilege($1, $2, 'EXECUTE') as can_record,
          has_function_privilege($1, $3, 'EXECUTE') as can_finalize,
          has_function_privilege(
            $1,
            'public.promote_contact(text,text,uuid,uuid,text,text,text,text,text,text,uuid)',
            'EXECUTE'
          ) as can_promote,
          has_function_privilege(
            $1,
            'public.classify_contact_address(text,text,text,text,uuid)',
            'EXECUTE'
          ) as can_classify
        `,
        [loginRole, RECORD_FUNCTION, FINALIZE_FUNCTION]
      );
      assert.deepEqual(privileges.rows[0], {
        can_record: true,
        can_finalize: true,
        can_promote: false,
        can_classify: false,
      });

      const first = await discoveryPool.query(
        `select ${RECORD_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
        recordParams()
      );
      assert.deepEqual(first.rows[0].result, { accepted: true, replayed: false });
      const replay = await discoveryPool.query(
        `select ${RECORD_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
        recordParams()
      );
      assert.deepEqual(replay.rows[0].result, { accepted: true, replayed: true });
      const cutoffInclusive = await discoveryPool.query(
        `select ${RECORD_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
        recordParams({
          run_key: hash("6"),
          page_key: hash("7"),
          observations: [{
            resource_key: hash("8"),
            observed_at: "2026-08-01T00:00:00Z",
            address_role: "from",
            address: "cutoff@example.com",
          }],
        })
      );
      assert.deepEqual(cutoffInclusive.rows[0].result, {
        accepted: true,
        replayed: false,
      });
      await assert.rejects(
        discoveryPool.query(
          `select ${RECORD_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          recordParams({
            observations: [{
              resource_key: hash("c"),
              observed_at: "2026-07-01T12:00:00Z",
              address_role: "from",
              address: "changed@example.com",
            }],
          })
        ),
        /page replay content mismatch/
      );
      await assert.rejects(
        discoveryPool.query(
          `select ${RECORD_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          recordParams({
            run_key: hash("d"),
            page_key: hash("e"),
            observations: [{
              resource_key: hash("f"),
              observed_at: "2026-07-01T12:00:00Z",
              address_role: "from",
              address: "person@example.com",
              subject: "forbidden content",
            }],
          })
        ),
        /observation schema is closed/
      );

      const otherAccount = await discoveryPool.query(
        `select ${RECORD_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
        recordParams({
          account_scope: "other@example.com",
          observations: [],
        })
      );
      assert.deepEqual(otherAccount.rows[0].result, {
        accepted: true,
        replayed: false,
      });

      await assert.rejects(
        discoveryPool.query(
          `select ${FINALIZE_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8)`,
          finalizeParams({ expected_pages: 2 })
        ),
        /expected page or record set is incomplete/
      );
      const finalized = await discoveryPool.query(
        `select ${FINALIZE_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8) as result`,
        finalizeParams()
      );
      assert.deepEqual(finalized.rows[0].result, { finalized: true, replayed: false });
      const pageReplayAfterFinalize = await discoveryPool.query(
        `select ${RECORD_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
        recordParams()
      );
      assert.deepEqual(pageReplayAfterFinalize.rows[0].result, {
        accepted: true,
        replayed: true,
      });
      const finalizeReplay = await discoveryPool.query(
        `select ${FINALIZE_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8) as result`,
        finalizeParams()
      );
      assert.deepEqual(finalizeReplay.rows[0].result, {
        finalized: true,
        replayed: true,
      });

      const noPromotionRun = {
        run_key: hash("1"),
        page_key: hash("2"),
        observations: [],
      };
      const snapshotPerson = await targetPool.query(
        `
        insert into public.people (full_name, created_at, updated_at)
        values ('Snapshot Person', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        returning *
        `
      );
      await discoveryPool.query(
        `select ${RECORD_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        recordParams(noPromotionRun)
      );
      await targetPool.query(
        "update public.people set full_name = 'Same Count Mutation' where id = $1",
        [snapshotPerson.rows[0].id]
      );
      await assert.rejects(
        discoveryPool.query(
          `select ${FINALIZE_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8)`,
          finalizeParams({
            run_key: noPromotionRun.run_key,
            expected_records: 0,
          })
        ),
        /no-promotion invariant failed/
      );
      await targetPool.query("delete from public.people where id = $1", [
        snapshotPerson.rows[0].id,
      ]);
      const snapshot = snapshotPerson.rows[0];
      await targetPool.query(
        `
        insert into public.people (
          id, organization_id, full_name, email, title, phone, role, notes,
          created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          snapshot.id,
          snapshot.organization_id,
          snapshot.full_name,
          snapshot.email,
          snapshot.title,
          snapshot.phone,
          snapshot.role,
          snapshot.notes,
          snapshot.created_at,
          snapshot.updated_at,
        ]
      );
      const invariantFinalized = await discoveryPool.query(
        `select ${FINALIZE_FUNCTION.split("(")[0]}($1,$2,$3,$4,$5,$6,$7,$8) as result`,
        finalizeParams({
          run_key: noPromotionRun.run_key,
          expected_records: 0,
        })
      );
      assert.deepEqual(invariantFinalized.rows[0].result, {
        finalized: true,
        replayed: false,
      });
      await targetPool.query("delete from public.people where id = $1", [
        snapshotPerson.rows[0].id,
      ]);

      const hardening = await targetPool.query(`
        select
          bool_and(c.relrowsecurity) filter (
            where c.relname in (
              'contact_address_classifications',
              'discovery_runs',
              'discovery_pages',
              'discovery_run_observations',
              'discovery_run_audit'
            )
          ) as rls_enabled,
          not exists (
            select 1
            from pg_namespace n
            cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
            where n.nspname in ('public', 'private') and acl.grantee = 0
          ) as no_public_schema_acl,
          not exists (
            select 1
            from pg_class relation
            join pg_namespace n on n.oid = relation.relnamespace
            cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
            where n.nspname in ('public', 'private') and acl.grantee = 0
          ) as no_public_relation_acl,
          not exists (
            select 1
            from pg_proc procedure
            join pg_namespace n on n.oid = procedure.pronamespace
            cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
            where n.nspname in ('public', 'private') and acl.grantee = 0
          ) as no_public_function_acl
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
      `);
      assert.deepEqual(hardening.rows[0], {
        rls_enabled: true,
        no_public_schema_acl: true,
        no_public_relation_acl: true,
        no_public_function_acl: true,
      });

      const functions = await targetPool.query(`
        select procedure.proname, procedure.prosecdef, procedure.proconfig
        from pg_proc procedure
        join pg_namespace n on n.oid = procedure.pronamespace
        where n.nspname = 'public'
          and procedure.proname in (
            'record_discovery_page',
            'finalize_discovery_run',
            'promote_contact',
            'classify_contact_address'
          )
        order by procedure.proname
      `);
      assert.equal(functions.rows.length, 4);
      for (const row of functions.rows) {
        assert.equal(row.prosecdef, true, `${row.proname} must be SECURITY DEFINER`);
        assert(
          row.proconfig.includes("search_path=pg_catalog, public"),
          `${row.proname} must have a fixed search_path`
        );
      }

      const audit = await targetPool.query(`
        select action, page_count, record_count, noise_record_count,
               session_user_name, application_name
        from public.discovery_run_audit
        where run_id = (
          select id from public.discovery_runs
          where account_scope = 'owner@example.com' and run_key = $1
        )
        order by occurred_at, action
      `, [hash("a")]);
      assert.deepEqual(audit.rows, [
        {
          action: "record_page",
          page_count: 1,
          record_count: 1,
          noise_record_count: 0,
          session_user_name: loginRole,
          application_name: "rudi-crm-discovery-security-test",
        },
        {
          action: "finalize",
          page_count: 1,
          record_count: 1,
          noise_record_count: 1,
          session_user_name: loginRole,
          application_name: "rudi-crm-discovery-security-test",
        },
      ]);
      assert.doesNotMatch(
        JSON.stringify(audit.rows),
        /@example\.com|resource|display|subject|body|snippet|location/i
      );
    } finally {
      if (discoveryPool) await discoveryPool.end();
      if (targetPool) await targetPool.end();
      await adminPool.query(`drop database if exists "${databaseName}" with (force)`);
      await adminPool.query(`drop role if exists "${loginRole}"`);
      await adminPool.query(`drop role if exists "${groupRole}"`);
      await adminPool.end();
    }
  }
);
