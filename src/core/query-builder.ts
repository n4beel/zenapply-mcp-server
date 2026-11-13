import { ToolError } from './errors.js';
import { hashSearchArgs, verifyCursor } from './cursor.js';

export interface SearchJobsInput {
  query: string;
  posted_after: string;
  posted_before?: string;
  countries?: string[];
  location?: string;
  work_model?: Array<'remote' | 'hybrid' | 'onsite' | 'unknown'>;
  work_model_confirmed_only?: boolean;
  sources?: string[];
  sort?: 'newest' | 'relevance';
  limit?: number;
  cursor?: string;
}

export interface UpstreamSearchParams {
  q: string;
  loc?: string;
  sources?: string;
  workModels?: string;
  confirmedWorkModel?: string;
  postedFrom: string;
  postedTo?: string;
  sortBy: 'date' | 'relevance';
  sortOrder: 'asc' | 'desc';
  page: number;
  limit: number;
  grouped: string;
}

export function buildSearchParams(
  input: SearchJobsInput,
  cursorSecret: string,
  now: Date = new Date(),
): {
  upstreamParams: UpstreamSearchParams;
  argsHash: string;
  page: number;
  postedBefore: string;
} {
  const query = input.query.trim();
  if (!query) {
    throw new ToolError('query cannot be empty.');
  }
  if (query.length > 300) {
    throw new ToolError('query is limited to 300 characters.');
  }

  // Window validation
  const postedAfterDate = new Date(input.posted_after);
  if (Number.isNaN(postedAfterDate.getTime())) {
    throw new ToolError('posted_after must be a valid ISO-8601 timestamp.');
  }

  // 30 days retention check
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (postedAfterDate.getTime() < thirtyDaysAgo.getTime()) {
    throw new ToolError('posted_after must be within the last 30 days (older jobs are deleted).');
  }

  if (postedAfterDate.getTime() > now.getTime()) {
    throw new ToolError('posted_after cannot be in the future.');
  }

  // Location vs Countries
  if (input.countries && input.countries.length > 0 && input.location) {
    throw new ToolError('Cannot combine countries and location filters; choose one.');
  }

  if (input.countries && input.countries.length > 10) {
    throw new ToolError('countries takes at most 10 countries.');
  }

  // Work model
  const workModelList = input.work_model || [];
  const hasUnknown = workModelList.includes('unknown');
  const confirmedOnly = Boolean(input.work_model_confirmed_only);

  if (hasUnknown && confirmedOnly) {
    throw new ToolError('"unknown" work model cannot be combined with work_model_confirmed_only=true: unknown rows are by definition unconfirmed.');
  }

  // Compute args hash
  const argsHash = hashSearchArgs({
    query,
    posted_after: input.posted_after,
    countries: input.countries,
    location: input.location,
    work_model: input.work_model,
    work_model_confirmed_only: input.work_model_confirmed_only,
    sources: input.sources,
    sort: input.sort,
    limit: input.limit,
  });

  let page = 1;
  let postedBefore = input.posted_before || now.toISOString();

  if (input.cursor) {
    const payload = verifyCursor(input.cursor, cursorSecret, argsHash);
    page = payload.page;
    postedBefore = payload.posted_before;
  }

  const postedBeforeDate = new Date(postedBefore);
  if (Number.isNaN(postedBeforeDate.getTime())) {
    throw new ToolError('posted_before must be a valid ISO-8601 timestamp.');
  }

  if (postedBeforeDate.getTime() <= postedAfterDate.getTime()) {
    throw new ToolError('posted_before must be strictly after posted_after.');
  }

  // Clamp limit
  const rawLimit = input.limit !== undefined ? input.limit : 50;
  const limit = Math.min(Math.max(rawLimit, 1), 100);

  // Build loc
  let locParam: string | undefined;
  if (input.countries && input.countries.length > 0) {
    locParam = input.countries.map((c) => c.trim()).filter(Boolean).join('|');
  } else if (input.location) {
    locParam = input.location.trim();
  }

  // Build workModels
  let workModelsParam: string | undefined;
  if (workModelList.length > 0) {
    workModelsParam = workModelList.join(',');
  }

  const sortBy = input.sort === 'relevance' ? 'relevance' : 'date';
  const sortOrder = sortBy === 'relevance' ? 'desc' : 'desc';

  const upstreamParams: UpstreamSearchParams = {
    q: query,
    postedFrom: postedAfterDate.toISOString(),
    postedTo: postedBeforeDate.toISOString(),
    sortBy,
    sortOrder,
    page,
    limit,
    grouped: 'true',
  };

  if (locParam) upstreamParams.loc = locParam;
  if (workModelsParam) upstreamParams.workModels = workModelsParam;
  if (confirmedOnly) upstreamParams.confirmedWorkModel = 'true';
  if (input.sources && input.sources.length > 0) {
    upstreamParams.sources = input.sources.join(',');
  }

  return {
    upstreamParams,
    argsHash,
    page,
    postedBefore,
  };
}
