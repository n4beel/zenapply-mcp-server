import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(8080),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Upstream
  ZENAPPLY_API_BASE: z.string().url().default('https://api.zenapply.app'),
  ZENAPPLY_SERVICE_EMAIL: z.string().email().default('service@zenapply.app'),
  ZENAPPLY_SERVICE_PASSWORD: z.string().min(1).default('dummy-password-for-local-slice'),

  // Secrets
  CURSOR_HMAC_SECRET: z.string().min(16).default('development-secret-cursor-hmac-min16chars'),
  TOKEN_PEPPER: z.string().min(16).default('development-secret-token-pepper-min16chars'),

  // State
  STATE_DB_PATH: z.string().default(':memory:'),

  // Limits
  UPSTREAM_TIMEOUT_MS: z.coerce.number().default(25000),
  UPSTREAM_CONCURRENCY: z.coerce.number().default(1),
  MAX_RESPONSE_BYTES: z.coerce.number().default(262144), // 256 KB

  // Redirect URIs
  ALLOWED_REDIRECT_URIS: z
    .string()
    .default('https://claude.ai/api/mcp/auth_callback')
    .transform((val) => val.split(',').map((u) => u.trim()).filter(Boolean)),

  // Ops
  SENTRY_DSN: z.string().optional(),
  DISCORD_OPS_WEBHOOK_URL: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env = process.env): Config {
  return ConfigSchema.parse(env);
}

export const config = loadConfig();
