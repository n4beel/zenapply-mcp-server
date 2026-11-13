import { ToolError } from '../core/errors.js';
import { ConcurrencyLimiter } from '../core/limits.js';
import { logger } from '../logging.js';

export interface ZenApplyClientOptions {
  apiBase: string;
  email: string;
  password: string;
  timeoutMs: number;
  concurrency: number;
}

export class ZenApplyClient {
  private jwt: string | null = null;
  private jwtExpiresAt = 0;
  private loginPromise: Promise<string> | null = null;
  private limiter: ConcurrencyLimiter;

  constructor(private readonly options: ZenApplyClientOptions) {
    this.limiter = new ConcurrencyLimiter(options.concurrency);
  }

  async login(force = false): Promise<string> {
    if (!force && this.jwt && Date.now() < this.jwtExpiresAt - 60000) {
      return this.jwt;
    }

    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = (async () => {
      try {
        const url = `${this.options.apiBase.replace(/\/+$/, '')}/auth/login`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: this.options.email,
            password: this.options.password,
          }),
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          logger.error({ status: res.status, body }, 'Upstream login failed');
          throw new ToolError('Upstream authentication failed.');
        }

        const data = (await res.json()) as { access_token?: string; token?: string; expiresIn?: number };
        const token = data.access_token || data.token;
        if (!token) {
          throw new ToolError('Invalid login response from upstream: missing token.');
        }

        this.jwt = token;
        // Default to 80 days if not given (backend uses 90 days)
        const expiryMs = (data.expiresIn ? data.expiresIn * 1000 : 80 * 24 * 60 * 60 * 1000);
        this.jwtExpiresAt = Date.now() + expiryMs;
        return token;
      } finally {
        this.loginPromise = null;
      }
    })();

    return this.loginPromise;
  }

  async request<T>(path: string, searchParams?: Record<string, string | number | undefined>): Promise<T> {
    return this.limiter.run(async () => {
      const url = new URL(`${this.options.apiBase.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
      if (searchParams) {
        for (const [k, v] of Object.entries(searchParams)) {
          if (v !== undefined) {
            url.searchParams.set(k, String(v));
          }
        }
      }

      const execute = async (token: string): Promise<Response> => {
        return fetch(url.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
      };

      let token = await this.login();
      let res: Response;

      try {
        res = await execute(token);
      } catch (err: unknown) {
        const error = err as Error;
        if (error.name === 'TimeoutError') {
          throw new ToolError('Search took too long — add work_model or countries, or narrow the search window.');
        }
        // One retry on network error
        try {
          res = await execute(token);
        } catch (retryErr: unknown) {
          const retryError = retryErr as Error;
          if (retryError.name === 'TimeoutError') {
            throw new ToolError('Search took too long — add work_model or countries, or narrow the search window.');
          }
          throw new ToolError('Upstream unavailable: network connection failed.');
        }
      }

      // Handle 401: re-login once and retry
      if (res.status === 401) {
        token = await this.login(true);
        res = await execute(token);
      }

      if (res.status === 504) {
        throw new ToolError('Search took too long — add work_model or countries, or narrow the search window.');
      }

      if (res.status === 403) {
        throw new ToolError('Upstream service API is disabled for this organization.');
      }

      if (res.status === 409) {
        throw new ToolError('Upstream configuration conflict: search.posted_extended required.');
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        logger.error({ status: res.status, body: errText, url: url.toString() }, 'Upstream request failed');
        let parsedMessage = '';
        try {
          const parsed = JSON.parse(errText);
          parsedMessage = parsed.message || parsed.error || '';
        } catch {
          // ignore
        }
        throw new ToolError(parsedMessage ? `Upstream error: ${parsedMessage}` : `Upstream request failed with status ${res.status}.`);
      }

      return (await res.json()) as T;
    });
  }
}
