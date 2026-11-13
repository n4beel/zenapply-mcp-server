import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { createApp } from '../../src/index.js';

const mockSearchResponse = {
  jobs: [
    {
      id: 'j1',
      job_title: 'Senior TypeScript Engineer',
      company: 'Acme Global',
      location: 'Berlin, Germany',
      locations: ['Berlin, Germany', 'Munich, Germany', 'Remote'],
      locations_truncated: false,
      work_model: 'remote',
      resolved_work_model: 'remote',
      structured_work_model: 'remote',
      posted_date: '2026-11-12T08:00:00.000Z',
      posted_date_precision: 'exact',
      created_at: '2026-11-12T08:00:00.000Z',
      source: 'greenhouse',
      sources: ['greenhouse', 'linkedin'],
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      employment_type: 'Full-time',
      seniority_level: 'Senior',
      salary_range: '€80k–€100k',
    },
    {
      id: 'j2',
      job_title: 'Node.js Developer',
      company: 'TechCo',
      location: 'London, UK',
      locations: ['London, UK'],
      locations_truncated: false,
      work_model: null,
      resolved_work_model: null,
      posted_date: '2026-11-12T09:00:00.000Z',
      source: 'linkedin',
      sources: ['linkedin'],
      url: 'https://linkedin.com/jobs/view/2',
    },
  ],
  total: 2,
  page: 1,
  limit: 50,
  totalPages: 1,
  applied: {
    query: 'typescript',
  },
};

const mockJobsResponse = {
  jobs: [
    {
      id: 'j1',
      job_title: 'Senior TypeScript Engineer',
      company: 'Acme Global',
      location: 'Berlin, Germany',
      locations: ['Berlin, Germany', 'Munich, Germany', 'Remote'],
      work_model: 'remote',
      resolved_work_model: 'remote',
      posted_date: '2026-11-12T08:00:00.000Z',
      source: 'greenhouse',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      description: '## Role Overview\n\nBuild world-class TypeScript services.',
      description_format_version: 2,
      company_website_url: 'https://acme.com',
      company_linkedin_url: 'https://linkedin.com/company/acme',
      employment_type: 'Full-time',
      seniority_level: 'Senior',
      salary_range: '€80k–€100k',
    },
  ],
  not_found: ['j999'],
};

const server = setupServer(
  http.post('https://api.zenapply.app/auth/login', () => {
    return HttpResponse.json({
      access_token: 'mock-upstream-jwt-token',
      expiresIn: 3600 * 24,
    });
  }),
  http.get('https://api.zenapply.app/search/service/search', () => {
    return HttpResponse.json(mockSearchResponse);
  }),
  http.get('https://api.zenapply.app/search/service/jobs', () => {
    return HttpResponse.json(mockJobsResponse);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Integration: MCP Server with OAuth & Upstream Mocks', () => {
  it('serves health endpoints', async () => {
    const { app } = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');

    const readyRes = await request(app).get('/health/ready');
    expect(readyRes.status).toBe(200);
    expect(readyRes.body.status).toBe('ready');
  });

  it('serves RFC 8414 & RFC 9728 metadata endpoints and handles 401 with WWW-Authenticate', async () => {
    const { app } = createApp();

    // 1. Unauthenticated request to /mcp gets 401 with WWW-Authenticate header
    const unauthRes = await request(app).post('/mcp').send({});
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.headers['www-authenticate']).toContain('Bearer');
    expect(unauthRes.headers['www-authenticate']).toContain('resource_metadata=');

    // 2. Authorization server metadata discovery
    const asMeta = await request(app).get('/.well-known/oauth-authorization-server');
    expect(asMeta.status).toBe(200);
    expect(asMeta.body.issuer.replace(/\/$/, '')).toBe('http://localhost:8080');
    expect(asMeta.body.authorization_endpoint).toBe('http://localhost:8080/authorize');
    expect(asMeta.body.token_endpoint).toBe('http://localhost:8080/token');
    expect(asMeta.body.registration_endpoint).toBe('http://localhost:8080/register');
  });

  it('completes the full DCR + Consent + PKCE flow to call MCP tools', async () => {
    const { app, store } = createApp();

    // 1. DCR: Dynamic Client Registration
    const regRes = await request(app)
      .post('/register')
      .send({
        client_name: 'Claude Test Client',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    expect(regRes.status).toBe(201);
    const clientId = regRes.body.client_id;
    expect(clientId).toBeDefined();

    // 2. Mint enrollment code via CLI/store
    const enrollmentCode = 'test-enroll-123456';
    store.saveEnrollmentCode(enrollmentCode, 'claude-integration-test', 600000);

    // 3. Initiate /authorize (renders consent page)
    const codeVerifier = 'xPZBgCwGjmLuPEZSVHHav8Na.V7uv9shikTbjA0LD5x';
    const codeChallenge = 'EKHgdcr8nX0d64djfR0sKxZx1Ssmkm59w96hdyp_vQU';
    const authRes = await request(app)
      .get('/authorize')
      .query({
        client_id: clientId,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        response_type: 'code',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: 'xyzState123',
      });
    expect(authRes.status).toBe(200);
    expect(authRes.text).toContain('Authorize MCP Client');
    expect(authRes.text).toContain('Claude Test Client');

    // 4. Submit consent with enrollment code
    const consentRes = await request(app)
      .post('/authorize/consent')
      .type('form')
      .send({
        client_id: clientId,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_challenge: codeChallenge,
        state: 'xyzState123',
        enrollment_code: enrollmentCode,
      });

    expect(consentRes.status).toBe(302);
    const redirectLocation = new URL(consentRes.headers.location);
    const authCode = redirectLocation.searchParams.get('code');
    expect(authCode).toBeDefined();
    expect(redirectLocation.searchParams.get('state')).toBe('xyzState123');

    // 5. Exchange code at /token
    const tokenRes = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: authCode,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: codeVerifier,
      });

    expect(tokenRes.status).toBe(200);
    const accessToken = tokenRes.body.access_token;
    expect(accessToken).toBeDefined();

    // 6. Call /mcp with Bearer token using JSON-RPC
    // Protocol initialize
    const initRes = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'claude', version: '1.0.0' },
        },
      });

    expect(initRes.status).toBe(200);
    expect(initRes.body.result).toBeDefined();
    expect(initRes.body.result.serverInfo.name).toBe('zenapply-mcp');

    // Call tools/list
    const toolsListRes = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

    expect(toolsListRes.status).toBe(200);
    const toolNames = toolsListRes.body.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('search_jobs');
    expect(toolNames).toContain('get_job');

    // Call search_jobs
    const searchCallRes = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'search_jobs',
          arguments: {
            query: 'typescript',
            posted_after: '2026-11-11T00:00:00.000Z',
          },
        },
      });

    expect(searchCallRes.status).toBe(200);
    expect(searchCallRes.body.result.isError).toBeFalsy();
    const searchResultText = searchCallRes.body.result.content[0].text;
    const parsedSearchResult = JSON.parse(searchResultText);
    expect(parsedSearchResult.total).toBe(2);
    expect(parsedSearchResult.rows[0].title).toBe('Senior TypeScript Engineer');

    // Call get_job
    const getJobRes = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get_job',
          arguments: {
            id: 'j1',
          },
        },
      });

    expect(getJobRes.status).toBe(200);
    expect(getJobRes.body.result.isError).toBeFalsy();
    const getJobText = getJobRes.body.result.content[0].text;
    const parsedJobResult = JSON.parse(getJobText);
    expect(parsedJobResult.jobs[0].description).toContain('Build world-class TypeScript services');
    expect(parsedJobResult.jobs[0].apply_url_kind).toBe('ats_direct');
  });

  it('returns clean error for bad window or invalid tool arguments', async () => {
    const { app, store } = createApp();

    // Register & generate token directly via store
    const token = 'zat_direct_test_token';
    store.saveToken(token, {
      client_id: 'test-client',
      credential_name: 'test-direct-cred',
      token_type: 'access',
      family_id: 'family-1',
      scopes: ['read'],
      expires_at: Date.now() + 3600000,
      revoked: false,
    });

    // Call search_jobs with invalid window (posted_after older than 30 days)
    const errRes = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'search_jobs',
          arguments: {
            query: 'typescript',
            posted_after: '2026-09-01T00:00:00.000Z',
          },
        },
      });

    expect(errRes.status).toBe(200);
    expect(errRes.body.result.isError).toBe(true);
    expect(errRes.body.result.content[0].text).toContain('posted_after must be within the last 30 days');

    // Call get_job with 21 ids
    const tooManyIdsRes = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'get_job',
          arguments: {
            ids: Array.from({ length: 21 }, (_, i) => `id-${i}`),
          },
        },
      });

    expect(tooManyIdsRes.status).toBe(200);
    expect(tooManyIdsRes.body.result.isError).toBe(true);
    expect(tooManyIdsRes.body.result.content[0].text).toContain('<=20 items at ids');
  });
});
