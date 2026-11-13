import crypto from 'node:crypto';
import { ToolError } from './errors.js';

export interface CursorPayload {
  v: 1;
  args_hash: string;
  page: number;
  posted_before: string;
}

export function hashSearchArgs(args: {
  query: string;
  posted_after: string;
  countries?: string[];
  location?: string;
  work_model?: string[];
  work_model_confirmed_only?: boolean;
  sources?: string[];
  sort?: string;
  limit?: number;
}): string {
  const norm = {
    query: args.query.trim().toLowerCase(),
    posted_after: args.posted_after,
    countries: args.countries ? [...args.countries].map((c) => c.trim().toLowerCase()).sort() : [],
    location: args.location ? args.location.trim().toLowerCase() : '',
    work_model: args.work_model ? [...args.work_model].sort() : [],
    work_model_confirmed_only: Boolean(args.work_model_confirmed_only),
    sources: args.sources ? [...args.sources].sort() : [],
    sort: args.sort || 'newest',
    limit: args.limit || 50,
  };
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 16);
}

export function createCursor(payload: CursorPayload, secret: string): string {
  const json = JSON.stringify(payload);
  const dataB64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(dataB64).digest('base64url');
  return `${dataB64}.${sig}`;
}

export function verifyCursor(cursorStr: string, secret: string, expectedArgsHash: string): CursorPayload {
  const parts = cursorStr.split('.');
  if (parts.length !== 2) {
    throw new ToolError('Invalid cursor format.');
  }
  const [dataB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(dataB64).digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    throw new ToolError('Invalid cursor signature: cursor has been tampered with or secret changed.');
  }

  try {
    const raw = Buffer.from(dataB64, 'base64url').toString('utf8');
    const payload = JSON.parse(raw) as CursorPayload;

    if (payload.v !== 1 || typeof payload.page !== 'number' || !payload.posted_before) {
      throw new ToolError('Malformed cursor data.');
    }

    if (payload.args_hash !== expectedArgsHash) {
      throw new ToolError('Cursor was generated with different search parameters and cannot be reused.');
    }

    return payload;
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError('Failed to decode cursor.');
  }
}
