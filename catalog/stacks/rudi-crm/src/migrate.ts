import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { createPoolConfig } from "./contract.js";

const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
const MIGRATION_LOCK = "rudi-crm-schema-migrations-v1";
const DEFAULT_MIGRATION_DIRECTORY = fileURLToPath(
  new URL("../sql/migrations/", import.meta.url)
);

type Migration = {
  filename: string;
  checksum: string;
  sql: string;
};

type MigrationSummary = {
  database_name: string;
  postgres_version: string;
  applied: string[];
  skipped: string[];
};

export function validateDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("RUDI_CRM_DATABASE_URL environment variable not set");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("RUDI_CRM_DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("RUDI_CRM_DATABASE_URL must use the postgres or postgresql protocol");
  }
  if (!parsed.hostname || parsed.pathname === "" || parsed.pathname === "/") {
    throw new Error("RUDI_CRM_DATABASE_URL must identify a host and database");
  }

  return value;
}

export async function loadMigrations(
  directory = DEFAULT_MIGRATION_DIRECTORY
): Promise<Migration[]> {
  const filenames = (await readdir(directory))
    .filter((filename) => MIGRATION_FILE_PATTERN.test(filename))
    .sort();

  if (filenames.length === 0) {
    throw new Error(`No CRM migrations found in ${directory}`);
  }

  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(path.join(directory, filename), "utf8");
      if (sql.trim().length === 0) {
        throw new Error(`CRM migration is empty: ${filename}`);
      }
      return {
        filename,
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    })
  );
}

async function ensureMigrationLedger(client: PoolClient): Promise<void> {
  await client.query(`
    create table if not exists public.rudi_crm_schema_migrations (
      filename text primary key,
      checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz not null default now()
    )
  `);
  await client.query(
    "alter table public.rudi_crm_schema_migrations enable row level security"
  );
  await client.query(
    "revoke all on public.rudi_crm_schema_migrations from public"
  );
}

export async function applyMigrations(args: {
  databaseUrl: string;
  directory?: string;
}): Promise<MigrationSummary> {
  const databaseUrl = validateDatabaseUrl(args.databaseUrl);
  const migrations = await loadMigrations(args.directory);
  const pool = new Pool(createPoolConfig(databaseUrl));
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query("select pg_advisory_lock(hashtext($1::text))", [MIGRATION_LOCK]);
    await ensureMigrationLedger(client);

    const existingResult = await client.query<{
      filename: string;
      checksum_sha256: string;
    }>(
      "select filename, checksum_sha256 from public.rudi_crm_schema_migrations order by filename"
    );
    const existing = new Map(
      existingResult.rows.map((row) => [row.filename, row.checksum_sha256])
    );

    for (const migration of migrations) {
      const priorChecksum = existing.get(migration.filename);
      if (priorChecksum) {
        if (priorChecksum !== migration.checksum) {
          throw new Error(`CRM migration checksum drift detected: ${migration.filename}`);
        }
        skipped.push(migration.filename);
        continue;
      }

      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          `
          insert into public.rudi_crm_schema_migrations (filename, checksum_sha256)
          values ($1::text, $2::text)
          `,
          [migration.filename, migration.checksum]
        );
        await client.query("commit");
        applied.push(migration.filename);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    const status = await client.query<{
      database_name: string;
      postgres_version: string;
    }>(
      "select current_database() as database_name, version() as postgres_version"
    );

    return {
      database_name: status.rows[0]?.database_name ?? "unknown",
      postgres_version: status.rows[0]?.postgres_version ?? "unknown",
      applied,
      skipped,
    };
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext($1::text))", [MIGRATION_LOCK]);
    } finally {
      client.release();
      await pool.end();
    }
  }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-postgresql-url]");
}

async function main(): Promise<void> {
  const summary = await applyMigrations({
    databaseUrl: validateDatabaseUrl(process.env.RUDI_CRM_DATABASE_URL),
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`RUDI CRM migration failed: ${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
