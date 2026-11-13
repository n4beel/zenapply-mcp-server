import crypto from 'node:crypto';
import Database from 'better-sqlite3';

export interface OAuthClientRecord {
  client_id: string;
  client_secret?: string;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  created_at: number;
}

export interface EnrollmentCodeRecord {
  code_hash: string;
  name: string;
  expires_at: number;
  used: boolean;
}

export interface AuthCodeRecord {
  code_hash: string;
  client_id: string;
  credential_name: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string[];
  expires_at: number;
  used: boolean;
}

export interface TokenRecord {
  token_hash: string;
  client_id: string;
  credential_name: string;
  token_type: 'access' | 'refresh';
  family_id: string;
  scopes: string[];
  expires_at: number;
  revoked: boolean;
}

export class SQLiteAuthStore {
  private db: Database.Database;

  constructor(dbPath: string, private readonly pepper: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        client_id TEXT PRIMARY KEY,
        client_secret TEXT,
        client_name TEXT,
        redirect_uris TEXT NOT NULL,
        grant_types TEXT NOT NULL,
        response_types TEXT NOT NULL,
        token_endpoint_auth_method TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS enrollment_codes (
        code_hash TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS auth_codes (
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        credential_name TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        scopes TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS tokens (
        token_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        credential_name TEXT NOT NULL,
        token_type TEXT NOT NULL,
        family_id TEXT NOT NULL,
        scopes TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS credential_stats (
        credential_name TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_used INTEGER,
        request_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(`${secret}:${this.pepper}`).digest('hex');
  }

  // Clients
  saveClient(client: OAuthClientRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO clients (client_id, client_secret, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      client.client_id,
      client.client_secret,
      client.client_name,
      JSON.stringify(client.redirect_uris),
      JSON.stringify(client.grant_types),
      JSON.stringify(client.response_types),
      client.token_endpoint_auth_method,
      client.created_at,
    );
  }

  getClient(clientId: string): OAuthClientRecord | undefined {
    const row = this.db.prepare('SELECT * FROM clients WHERE client_id = ?').get(clientId) as any;
    if (!row) return undefined;
    return {
      client_id: row.client_id,
      client_secret: row.client_secret ?? undefined,
      client_name: row.client_name ?? undefined,
      redirect_uris: JSON.parse(row.redirect_uris),
      grant_types: JSON.parse(row.grant_types),
      response_types: JSON.parse(row.response_types),
      token_endpoint_auth_method: row.token_endpoint_auth_method,
      created_at: row.created_at,
    };
  }

  // Enrollment codes
  saveEnrollmentCode(rawCode: string, name: string, ttlMs: number): void {
    const codeHash = this.hashSecret(rawCode);
    const expiresAt = Date.now() + ttlMs;
    const stmt = this.db.prepare(`
      INSERT INTO enrollment_codes (code_hash, name, expires_at, used)
      VALUES (?, ?, ?, 0)
    `);
    stmt.run(codeHash, name, expiresAt);

    // Also initialize stats
    this.db.prepare(`
      INSERT OR IGNORE INTO credential_stats (credential_name, created_at, last_used, request_count)
      VALUES (?, ?, NULL, 0)
    `).run(name, Date.now());
  }

  consumeEnrollmentCode(rawCode: string): string | null {
    const codeHash = this.hashSecret(rawCode);
    const now = Date.now();
    const row = this.db.prepare('SELECT name, expires_at, used FROM enrollment_codes WHERE code_hash = ?').get(codeHash) as any;
    if (!row || row.used === 1 || row.expires_at < now) {
      return null;
    }
    this.db.prepare('UPDATE enrollment_codes SET used = 1 WHERE code_hash = ?').run(codeHash);
    return row.name;
  }

  // Auth codes
  saveAuthCode(code: string, record: Omit<AuthCodeRecord, 'code_hash' | 'used'>): void {
    const codeHash = this.hashSecret(code);
    const stmt = this.db.prepare(`
      INSERT INTO auth_codes (code_hash, client_id, credential_name, redirect_uri, code_challenge, scopes, expires_at, used)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);
    stmt.run(
      codeHash,
      record.client_id,
      record.credential_name,
      record.redirect_uri,
      record.code_challenge,
      JSON.stringify(record.scopes),
      record.expires_at,
    );
  }

  getAuthCode(code: string): AuthCodeRecord | undefined {
    const codeHash = this.hashSecret(code);
    const row = this.db.prepare('SELECT * FROM auth_codes WHERE code_hash = ?').get(codeHash) as any;
    if (!row) return undefined;
    return {
      code_hash: row.code_hash,
      client_id: row.client_id,
      credential_name: row.credential_name,
      redirect_uri: row.redirect_uri,
      code_challenge: row.code_challenge,
      scopes: JSON.parse(row.scopes),
      expires_at: row.expires_at,
      used: Boolean(row.used),
    };
  }

  consumeAuthCode(code: string): AuthCodeRecord | undefined {
    const codeHash = this.hashSecret(code);
    const record = this.getAuthCode(code);
    if (!record || record.used || record.expires_at < Date.now()) {
      return undefined;
    }
    this.db.prepare('UPDATE auth_codes SET used = 1 WHERE code_hash = ?').run(codeHash);
    return record;
  }

  // Tokens
  saveToken(rawToken: string, record: Omit<TokenRecord, 'token_hash'>): void {
    const tokenHash = this.hashSecret(rawToken);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tokens (token_hash, client_id, credential_name, token_type, family_id, scopes, expires_at, revoked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      tokenHash,
      record.client_id,
      record.credential_name,
      record.token_type,
      record.family_id,
      JSON.stringify(record.scopes),
      record.expires_at,
      record.revoked ? 1 : 0,
    );
  }

  getToken(rawToken: string): TokenRecord | undefined {
    const tokenHash = this.hashSecret(rawToken);
    const row = this.db.prepare('SELECT * FROM tokens WHERE token_hash = ?').get(tokenHash) as any;
    if (!row) return undefined;
    return {
      token_hash: row.token_hash,
      client_id: row.client_id,
      credential_name: row.credential_name,
      token_type: row.token_type,
      family_id: row.family_id,
      scopes: JSON.parse(row.scopes),
      expires_at: row.expires_at,
      revoked: Boolean(row.revoked),
    };
  }

  revokeFamily(familyId: string): void {
    this.db.prepare('UPDATE tokens SET revoked = 1 WHERE family_id = ?').run(familyId);
  }

  revokeCredential(name: string): void {
    this.db.prepare('UPDATE tokens SET revoked = 1 WHERE credential_name = ?').run(name);
  }

  recordUsage(credentialName: string): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO credential_stats (credential_name, created_at, last_used, request_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(credential_name) DO UPDATE SET
        last_used = excluded.last_used,
        request_count = request_count + 1
    `).run(credentialName, now, now);
  }

  listCredentials(): Array<{ name: string; created_at: number; last_used: number | null; request_count: number }> {
    return this.db.prepare('SELECT credential_name as name, created_at, last_used, request_count FROM credential_stats ORDER BY created_at DESC').all() as any;
  }
}
