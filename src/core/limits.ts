import { ToolError } from './errors.js';
import { MappedFullJob } from './map-row.js';

export class ConcurrencyLimiter {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export class RateLimiter {
  private timestamps = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number,
  ) {}

  check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const list = this.timestamps.get(key) || [];
    const valid = list.filter((t) => now - t < this.windowMs);

    if (valid.length >= this.maxRequests) {
      const oldest = valid[0];
      const retryAfterSeconds = Math.ceil((this.windowMs - (now - oldest)) / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    valid.push(now);
    this.timestamps.set(key, valid);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function enforceSizeCap(
  responseObj: { jobs?: MappedFullJob[]; [key: string]: unknown },
  maxBytes = 262144, // 256 KB
): void {
  const jsonStr = JSON.stringify(responseObj);
  if (Buffer.byteLength(jsonStr, 'utf8') <= maxBytes) {
    return;
  }

  // If get_job, shrink descriptions proportionally
  if (responseObj.jobs && Array.isArray(responseObj.jobs) && responseObj.jobs.length > 0) {
    let currentBytes = Buffer.byteLength(JSON.stringify(responseObj), 'utf8');
    let maxChar = 10000;
    while (currentBytes > maxBytes && maxChar > 200) {
      maxChar = Math.floor(maxChar * 0.7);
      for (const job of responseObj.jobs) {
        if (job.description && job.description.length > maxChar) {
          job.description = job.description.slice(0, maxChar) + '\n\n[Description truncated to fit response size limit...]';
          job.description_truncated = true;
        }
      }
      currentBytes = Buffer.byteLength(JSON.stringify(responseObj), 'utf8');
    }
    if (currentBytes <= maxBytes) {
      return;
    }
  }

  throw new ToolError('Response size exceeded 256 KB limit even after truncation. Please narrow your query or request fewer jobs.');
}
