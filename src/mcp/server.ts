import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZenApplyClient } from '../upstream/zenapply-client.js';
import { SQLiteAuthStore } from '../auth/store.js';
import { RateLimiter } from '../core/limits.js';
import {
  SearchJobsSchema,
  searchJobsToolDescription,
  createSearchJobsHandler,
} from '../tools/search-jobs.js';
import {
  GetJobSchema,
  getJobToolDescription,
  createGetJobHandler,
} from '../tools/get-job.js';
import { formatToolError } from '../core/errors.js';

export interface CreateServerOptions {
  client: ZenApplyClient;
  cursorSecret: string;
  store: SQLiteAuthStore;
}

export function createMcpServer(options: CreateServerOptions): McpServer {
  const { client, cursorSecret } = options;

  const server = new McpServer({
    name: 'zenapply-mcp',
    version: '1.0.0',
  });

  // Limiters: 10/min per cred search, 20/min global search
  const searchPerCredLimiter = new RateLimiter(60000, 10);
  const searchGlobalLimiter = new RateLimiter(60000, 20);

  // get_job limiter: 60/min per cred
  const getJobLimiter = new RateLimiter(60000, 60);

  const searchHandler = createSearchJobsHandler({
    client,
    cursorSecret,
    perCredentialLimiter: searchPerCredLimiter,
    globalLimiter: searchGlobalLimiter,
  });

  const getJobHandler = createGetJobHandler({
    client,
    perCredentialLimiter: getJobLimiter,
  });

  // Register tools
  server.tool(
    'search_jobs',
    searchJobsToolDescription,
    SearchJobsSchema,
    async (args: any, extra: any) => {
      try {
        const credentialName = extra?.authInfo?.extra?.credentialName;
        return await searchHandler(args, { credentialName });
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.tool(
    'get_job',
    getJobToolDescription,
    GetJobSchema,
    async (args: any, extra: any) => {
      try {
        const credentialName = extra?.authInfo?.extra?.credentialName;
        return await getJobHandler(args, { credentialName });
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  return server;
}
