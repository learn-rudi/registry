import { Pool } from "pg";
import { RunValidatorsInput, parseToolArgs } from "./schemas.js";

let pool: Pool | null = null;

const EXPECTED_TABLES = [
  "organizations",
  "people",
  "person_emails",
  "users",
  "agents",
  "actors",
  "engagements",
  "threads",
  "interactions",
  "deliverables",
  "next_actions",
  "engagement_finance_events",
  "discovery_domains",
  "discovery_observations",
  "ingest_batches",
  "audit_events",
  "engagement_people",
  "interaction_participants",
  "deliverable_people",
] as const;

const EXPECTED_FUNCTIONS = [
  "record_discovery_observations",
  "log_ingest_batch",
  "record_audit_event",
  "set_audit_context",
  "upsert_interaction",
  "record_finance_event",
  "refresh_thread_rollups",
  "resolve_person_by_email",
  "apply_discovery_domain_heuristics",
  "get_unknown_discovery_domains",
  "promote_contact",
] as const;

export const VALIDATOR_VIEWS = [
  "v_validate_thread_org",
  "v_validate_interaction_engagement",
  "v_validate_thread_rollup",
  "v_validate_dupe_source",
  "v_validate_people_email_mirror",
  "v_validate_user_login_email",
  "v_validate_finance_event_links",
  "v_validate_audit_trigger_coverage",
] as const;

const EXPECTED_VIEWS = [
  ...VALIDATOR_VIEWS,
  "v_triage_queue",
  "v_people_missing_email",
  "v_engagement_financial_summary",
  "v_contact_candidates",
] as const;

type SetupCheck = {
  name: string;
  ok: boolean;
  details?: unknown;
};

function connectionString(): string {
  const value = process.env.RUDI_CRM_DATABASE_URL;
  if (!value) {
    throw new Error("RUDI_CRM_DATABASE_URL environment variable not set");
  }
  return value;
}

function shouldUseExplicitSsl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const sslMode = parsed.searchParams.get("sslmode");
    return sslMode === "require" || sslMode === "no-verify";
  } catch {
    return value.includes("sslmode=require");
  }
}

export function createPoolConfig(value: string): {
  connectionString: string;
  ssl?: { rejectUnauthorized: false };
} {
  if (!shouldUseExplicitSsl(value)) {
    return { connectionString: value };
  }

  try {
    const parsed = new URL(value);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("uselibpqcompat");
    return {
      connectionString: parsed.toString(),
      ssl: { rejectUnauthorized: false },
    };
  } catch {
    return {
      connectionString: value,
      ssl: { rejectUnauthorized: false },
    };
  }
}

export function getPool(): Pool {
  if (!pool) {
    const value = connectionString();
    pool = new Pool(createPoolConfig(value));
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export function getConfigStatus() {
  return {
    database_url_configured: Boolean(process.env.RUDI_CRM_DATABASE_URL),
    required_secret: "RUDI_CRM_DATABASE_URL",
    boundary: "controlled CRM write/read contract",
    raw_sql_enabled: false,
    expected_database_functions: [
      "record_discovery_observations",
      "log_ingest_batch",
      "record_audit_event",
      "set_audit_context",
      "upsert_interaction",
      "promote_contact",
      "refresh_thread_rollups",
    ],
    validator_views: VALIDATOR_VIEWS,
  };
}

function missingNames(items: Array<{ name: string; present: boolean }>): string[] {
  return items.filter((item) => !item.present).map((item) => item.name);
}

export async function getSetupStatus() {
  const databaseUrlConfigured = Boolean(process.env.RUDI_CRM_DATABASE_URL);
  const base = {
    database_url_configured: databaseUrlConfigured,
    required_secret: "RUDI_CRM_DATABASE_URL",
    raw_sql_enabled: false,
  };

  if (!databaseUrlConfigured) {
    return {
      ...base,
      ok: false,
      missing: ["RUDI_CRM_DATABASE_URL"],
      checks: [
        {
          name: "database_secret",
          ok: false,
          details: "RUDI_CRM_DATABASE_URL is not configured",
        },
      ],
    };
  }

  try {
    const databaseResult = await getPool().query(
      "select current_database() as database_name, current_schema() as schema_name, version() as postgres_version"
    );
    const contractResult = await getPool().query(
      `
      with expected_tables(name) as (
        select unnest($1::text[])
      ),
      expected_functions(name) as (
        select unnest($2::text[])
      ),
      expected_views(name) as (
        select unnest($3::text[])
      )
      select jsonb_build_object(
        'tables', (
          select jsonb_agg(
            jsonb_build_object('name', e.name, 'present', t.table_name is not null)
            order by e.name
          )
          from expected_tables e
          left join information_schema.tables t
            on t.table_schema = 'public'
           and t.table_name = e.name
        ),
        'functions', (
          select jsonb_agg(
            jsonb_build_object(
              'name',
              e.name,
              'present',
              exists (
                select 1
                from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and p.proname = e.name
              )
            )
            order by e.name
          )
          from expected_functions e
        ),
        'views', (
          select jsonb_agg(
            jsonb_build_object('name', e.name, 'present', v.table_name is not null)
            order by e.name
          )
          from expected_views e
          left join information_schema.views v
            on v.table_schema = 'public'
           and v.table_name = e.name
        )
      ) as contract
      `,
      [[...EXPECTED_TABLES], [...EXPECTED_FUNCTIONS], [...EXPECTED_VIEWS]]
    );
    const validatorStatus = await runValidators({ include_rows: false });
    const contract = contractResult.rows[0]?.contract ?? {};
    const tables = (contract.tables ?? []) as Array<{ name: string; present: boolean }>;
    const functions = (contract.functions ?? []) as Array<{ name: string; present: boolean }>;
    const views = (contract.views ?? []) as Array<{ name: string; present: boolean }>;
    const missingTables = missingNames(tables);
    const missingFunctions = missingNames(functions);
    const missingViews = missingNames(views);
    const validatorsOk = validatorStatus.ok === true;
    const checks: SetupCheck[] = [
      { name: "database_secret", ok: true },
      { name: "database_connection", ok: true, details: databaseResult.rows[0] ?? null },
      { name: "tables", ok: missingTables.length === 0, details: { missing: missingTables } },
      {
        name: "functions",
        ok: missingFunctions.length === 0,
        details: { missing: missingFunctions },
      },
      { name: "views", ok: missingViews.length === 0, details: { missing: missingViews } },
      { name: "validators", ok: validatorsOk, details: validatorStatus.validators },
    ];

    return {
      ...base,
      ok: checks.every((check) => check.ok),
      missing: [...missingTables, ...missingFunctions, ...missingViews],
      checks,
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      missing: [],
      checks: [
        { name: "database_secret", ok: true },
        { name: "database_connection", ok: false, details: crmErrorMessage(error) },
      ],
    };
  }
}

export async function runValidators(args: unknown) {
  const input = parseToolArgs(RunValidatorsInput, args);
  const results = [];

  for (const view of VALIDATOR_VIEWS) {
    const countResult = await getPool().query(
      `select count(*)::integer as violations from ${view}`
    );
    const violations = Number(countResult.rows[0]?.violations ?? 0);
    const result: Record<string, unknown> = {
      view,
      violations,
      ok: violations === 0,
    };

    if ((input.include_rows ?? false) && violations > 0) {
      const rowsResult = await getPool().query(`select * from ${view} limit 25`);
      result.rows = rowsResult.rows;
    }

    results.push(result);
  }

  return {
    ok: results.every((result) => result.ok === true),
    validators: results,
  };
}

export function crmErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
