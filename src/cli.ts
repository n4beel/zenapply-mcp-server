#!/usr/bin/env node
import crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { SQLiteAuthStore } from './auth/store.js';

process.env.ZENAPPLY_CLI = 'true';

const config = loadConfig();
const store = new SQLiteAuthStore(config.STATE_DB_PATH, config.TOKEN_PEPPER);

const args = process.argv.slice(2);
const command = args[0];

function parseArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function parseTtl(ttlStr: string | undefined): number {
  if (!ttlStr) return 15 * 60 * 1000; // 15 mins default
  const match = ttlStr.match(/^(\d+)([smhd])$/);
  if (!match) return 15 * 60 * 1000;
  const num = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 's') return num * 1000;
  if (unit === 'm') return num * 60 * 1000;
  if (unit === 'h') return num * 60 * 60 * 1000;
  if (unit === 'd') return num * 24 * 60 * 60 * 1000;
  return 15 * 60 * 1000;
}

async function run() {
  switch (command) {
    case 'enroll': {
      const name = parseArg('--name') || parseArg('-n');
      if (!name) {
        console.error('Error: --name <credential-name> is required.');
        process.exit(1);
      }
      const ttlMs = parseTtl(parseArg('--ttl'));
      const code = crypto.randomBytes(16).toString('hex'); // 128 bits
      store.saveEnrollmentCode(code, name, ttlMs);
      console.log(`\nEnrollment code for "${name}" (valid for ${Math.round(ttlMs / 60000)}m):`);
      console.log(`\n  ${code}\n`);
      console.log('Enter this code on the OAuth consent page when adding the connector in Claude.');
      break;
    }

    case 'list': {
      const creds = store.listCredentials();
      console.log('\nRegistered MCP Credentials:');
      if (creds.length === 0) {
        console.log('  (no credentials registered yet)');
      } else {
        console.table(
          creds.map((c) => ({
            Name: c.name,
            Created: new Date(c.created_at).toISOString(),
            'Last Used': c.last_used ? new Date(c.last_used).toISOString() : 'never',
            Requests: c.request_count,
          })),
        );
      }
      break;
    }

    case 'revoke': {
      const name = args[1];
      if (!name) {
        console.error('Error: specify credential name to revoke: cli.js revoke <name>');
        process.exit(1);
      }
      store.revokeCredential(name);
      console.log(`Successfully revoked all tokens for credential "${name}".`);
      break;
    }

    default:
      console.log(`ZenApply MCP CLI

Commands:
  enroll --name <name> [--ttl 15m]  Mint a one-time 128-bit enrollment code
  list                              List all credentials, their usage, and stats
  revoke <name>                     Revoke all active tokens for a credential
`);
  }
}

run().catch((err) => {
  console.error('CLI error:', err);
  process.exit(1);
});
