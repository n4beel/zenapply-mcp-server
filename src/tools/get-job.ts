import { z } from 'zod';
import { ZenApplyClient } from '../upstream/zenapply-client.js';
import { mapFullJob, UpstreamSearchJobRow } from '../core/map-row.js';
import { enforceSizeCap, RateLimiter } from '../core/limits.js';
import { ToolError } from '../core/errors.js';
import { logger } from '../logging.js';

export const GetJobSchema = {
  id: z
    .string()
    .optional()
    .describe('Stable job id (from search_jobs).'),
  ids: z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(20)
    .optional()
    .describe('List of 1–20 job ids (from search_jobs).'),
};

export const getJobToolDescription =
  'Fetch full details for 1–20 jobs by id (from search_jobs): the description as Markdown, the direct apply link when known, the company website, employment type, seniority and salary. Use it on a shortlist, not on every search row.';

export interface GetJobHandlerOptions {
  client: ZenApplyClient;
  perCredentialLimiter: RateLimiter;
}

export function createGetJobHandler(options: GetJobHandlerOptions) {
  const { client, perCredentialLimiter } = options;

  return async (args: { id?: string; ids?: string[] }, extra?: { credentialName?: string }) => {
    const credKey = extra?.credentialName || 'anonymous';

    // 60 requests per minute per credential for get_job
    const credCheck = perCredentialLimiter.check(credKey);
    if (!credCheck.allowed) {
      throw new ToolError(`Rate limit: retry in ${credCheck.retryAfterSeconds}s.`);
    }

    const requestedIds: string[] = [];
    if (args.id) requestedIds.push(args.id.trim());
    if (args.ids) {
      for (const id of args.ids) {
        if (id && id.trim()) requestedIds.push(id.trim());
      }
    }

    const uniqueIds = Array.from(new Set(requestedIds));
    if (uniqueIds.length === 0) {
      throw new ToolError('At least one job id must be provided via "id" or "ids".');
    }
    if (uniqueIds.length > 20) {
      throw new ToolError('get_job accepts at most 20 job ids per call.');
    }

    const data = await client.request<{
      jobs: UpstreamSearchJobRow[];
      not_found?: string[];
    }>('/search/service/jobs', {
      ids: uniqueIds.join(','),
    });

    const mappedJobs = (data.jobs || []).map((j) => mapFullJob(j));
    const notFound = data.not_found || [];

    const response = {
      jobs: mappedJobs,
      not_found: notFound,
    };

    enforceSizeCap(response);

    logger.info(
      {
        credential: credKey,
        tool: 'get_job',
        requested: uniqueIds.length,
        found: mappedJobs.length,
        notFound: notFound.length,
      },
      'get_job executed',
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
