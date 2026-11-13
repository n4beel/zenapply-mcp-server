import { z } from 'zod';
import { ZenApplyClient } from '../upstream/zenapply-client.js';
import { buildSearchParams, SearchJobsInput } from '../core/query-builder.js';
import { createCursor } from '../core/cursor.js';
import { mapSearchRow, UpstreamSearchJobRow } from '../core/map-row.js';
import { enforceSizeCap, RateLimiter } from '../core/limits.js';
import { ToolError } from '../core/errors.js';
import { logger } from '../logging.js';

export const SearchJobsSchema = {
  query: z
    .string()
    .min(1)
    .max(300)
    .describe('Search terms, comma-separated; "quoted phrases" allowed. Example: "node.js", typescript, nestjs'),
  posted_after: z
    .string()
    .describe('UTC ISO-8601. Only jobs posted at or after this instant. Must be within the last 30 days (older jobs are deleted).'),
  posted_before: z
    .string()
    .optional()
    .describe('UTC ISO-8601, exclusive. Defaults to now; the first page pins it so paging is stable.'),
  countries: z
    .array(z.string().min(2).max(60))
    .max(10)
    .optional()
    .describe('Country names or ISO-3166 alpha-2 codes, OR-ed. Includes worldwide-remote jobs. Example: ["Germany", "AE", "Netherlands"]'),
  location: z
    .string()
    .max(100)
    .optional()
    .describe('Free-text city or region (substring match), for when a country is too broad. Cannot be combined with countries.'),
  work_model: z
    .array(z.enum(['remote', 'hybrid', 'onsite', 'unknown']))
    .optional()
    .describe('Keep jobs with any of these work models. "unknown" = the source gave none and the advert doesn\'t say (about two-thirds of LinkedIn). Use ["remote", "unknown"] to include them, then check descriptions. Omit for any.'),
  work_model_confirmed_only: z
    .boolean()
    .default(false)
    .describe('true = only jobs whose work model the employer declared or the advert states. Fewer rows, much more reliable. Cannot be combined with "unknown".'),
  sources: z
    .array(z.string())
    .max(30)
    .optional()
    .describe('Source names from list_sources. Omit for all.'),
  sort: z
    .enum(['newest', 'relevance'])
    .default('newest')
    .describe('Sort order: newest first (default) or relevance.'),
  limit: z
    .number()
    .min(1)
    .max(100)
    .default(50)
    .describe('Number of results to return (max 100, default 50).'),
  cursor: z
    .string()
    .optional()
    .describe('next_cursor from a previous call with identical arguments.'),
};

export const searchJobsToolDescription =
  "Search ZenApply's job listings (aggregated from LinkedIn, ATS boards such as Greenhouse, Lever and Ashby, and job aggregators). Returns compact rows without descriptions; call get_job for full text. query uses the same syntax as the ZenApply search box: comma-separated terms, with \"quoted phrases\" kept together. Put role and technology words in query. Leave seniority words such as \"senior\" out, and judge seniority from the titles. A country filter also returns worldwide-remote jobs. Rows are newest first by default. To fetch more, pass next_cursor back unchanged with the same other arguments.";

export interface SearchJobsHandlerOptions {
  client: ZenApplyClient;
  cursorSecret: string;
  perCredentialLimiter: RateLimiter;
  globalLimiter: RateLimiter;
}

export function createSearchJobsHandler(options: SearchJobsHandlerOptions) {
  const { client, cursorSecret, perCredentialLimiter, globalLimiter } = options;

  return async (args: SearchJobsInput, extra?: { credentialName?: string }) => {
    const credKey = extra?.credentialName || 'anonymous';

    // Rate limits: 10/min per credential, 20/min global
    const globalCheck = globalLimiter.check('global_search');
    if (!globalCheck.allowed) {
      throw new ToolError(`Global search rate limit reached: retry in ${globalCheck.retryAfterSeconds}s.`);
    }

    const credCheck = perCredentialLimiter.check(credKey);
    if (!credCheck.allowed) {
      throw new ToolError(`Rate limit: retry in ${credCheck.retryAfterSeconds}s.`);
    }

    const { upstreamParams, argsHash, page, postedBefore } = buildSearchParams(
      args,
      cursorSecret,
    );

    const data = await client.request<{
      jobs: UpstreamSearchJobRow[];
      total: number;
      totalPages: number;
      truncated?: boolean;
      applied?: Record<string, unknown>;
    }>('/search/service/search', upstreamParams as any);

    const rows = (data.jobs || []).map(mapSearchRow);

    let nextCursor: string | null = null;
    if (page < data.totalPages && rows.length > 0) {
      nextCursor = createCursor(
        {
          v: 1,
          args_hash: argsHash,
          page: page + 1,
          posted_before: postedBefore,
        },
        cursorSecret,
      );
    }

    const response = {
      total: data.total,
      total_is_capped: Boolean(data.truncated),
      next_cursor: nextCursor,
      applied: {
        match: 'best',
        posted_after: upstreamParams.postedFrom,
        posted_before: upstreamParams.postedTo,
        countries: args.countries || [],
        work_model: args.work_model || [],
      },
      rows,
    };

    enforceSizeCap(response as any);

    logger.info(
      {
        credential: credKey,
        tool: 'search_jobs',
        query: args.query,
        rows: rows.length,
        total: data.total,
        page,
      },
      'search_jobs executed',
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(response, null, 2),
        },
      ],
      structuredContent: response,
    };
  };
}
