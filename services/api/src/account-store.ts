import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import type { AppDatabase } from "./database.js";

export type AccountRole = "customer" | "delivery";

export interface StoredAccount {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: AccountRole;
}

export interface AccountStore {
  readonly kind: "postgresql" | "local";
  readonly ready: Promise<void>;
  findByEmail(email: string): Promise<StoredAccount | undefined>;
  create(account: StoredAccount): Promise<void>;
  close(): Promise<void>;
}

function mirrorAccount(db: AppDatabase, account: StoredAccount) {
  const existing = db.prepare(`
    SELECT id FROM users WHERE email = ?
  `).get(account.email) as { id: string } | undefined;
  if (existing) {
    db.prepare(`
      UPDATE users
      SET name = ?, password_hash = ?, role = ?
      WHERE id = ?
    `).run(account.name, account.passwordHash, account.role, existing.id);
    return { ...account, id: existing.id };
  }
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role)
    VALUES (@id, @name, @email, @passwordHash, @role)
  `).run(account);
  return account;
}

function createPostgresPool(connectionString: string): Pool {
  return new PgPool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    application_name: "viggy-mart-api",
  });
}

async function initializePostgres(pool: Pool, db: AppDatabase) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viggy_mart_accounts (
      id UUID PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(16) NOT NULL CHECK (role IN ('customer', 'delivery')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS viggy_mart_accounts_email_idx
    ON viggy_mart_accounts (LOWER(email))
  `);

  const legacyAccounts = db.prepare(`
    SELECT id, name, email, password_hash AS "passwordHash", role
    FROM users
  `).all() as StoredAccount[];
  for (const account of legacyAccounts) {
    await pool.query(`
      INSERT INTO viggy_mart_accounts (id, name, email, password_hash, role)
      VALUES ($1, $2, LOWER($3), $4, $5)
      ON CONFLICT (email) DO NOTHING
    `, [account.id, account.name, account.email, account.passwordHash, account.role]);
  }
}

export function createAccountStore(db: AppDatabase, connectionString?: string): AccountStore {
  if (!connectionString?.trim()) {
    return {
      kind: "local",
      ready: Promise.resolve(),
      async findByEmail(email) {
        return db.prepare(`
          SELECT id, name, email, password_hash AS passwordHash, role
          FROM users WHERE email = ?
        `).get(email) as StoredAccount | undefined;
      },
      async create(account) {
        db.prepare(`
          INSERT INTO users (id, name, email, password_hash, role)
          VALUES (@id, @name, @email, @passwordHash, @role)
        `).run(account);
      },
      async close() {},
    };
  }

  const pool = createPostgresPool(connectionString);
  const ready = initializePostgres(pool, db);
  return {
    kind: "postgresql",
    ready,
    async findByEmail(email) {
      await ready;
      const { rows } = await pool.query<{
        id: string; name: string; email: string; password_hash: string; role: AccountRole;
      }>(`
        SELECT id, name, email, password_hash, role
        FROM viggy_mart_accounts WHERE LOWER(email) = LOWER($1)
      `, [email]);
      const account = rows[0];
      if (!account) return undefined;
      const stored: StoredAccount = {
        id: account.id,
        name: account.name,
        email: account.email,
        passwordHash: account.password_hash,
        role: account.role,
      };
      return mirrorAccount(db, stored);
    },
    async create(account) {
      await ready;
      await pool.query(`
        INSERT INTO viggy_mart_accounts (id, name, email, password_hash, role)
        VALUES ($1, $2, LOWER($3), $4, $5)
      `, [account.id, account.name, account.email, account.passwordHash, account.role]);
      mirrorAccount(db, account);
    },
    async close() {
      await pool.end();
    },
  };
}
