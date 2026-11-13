import express, { Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  mcpAuthRouter,
  mcpAuthMetadataRouter,
  createOAuthMetadata,
  getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config.js';
import { logger } from './logging.js';
import { SQLiteAuthStore } from './auth/store.js';
import { ZenApplyOAuthProvider } from './auth/oauth-provider.js';
import { ZenApplyClient } from './upstream/zenapply-client.js';
import { createMcpServer } from './mcp/server.js';
import { renderConsentPage } from './auth/consent-page.js';

export function createApp() {
  const config = loadConfig();
  const app = express();

  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: true, limit: '64kb' }));

  const store = new SQLiteAuthStore(config.STATE_DB_PATH, config.TOKEN_PEPPER);
  const oauthProvider = new ZenApplyOAuthProvider(store, config.ALLOWED_REDIRECT_URIS);

  const zenapplyClient = new ZenApplyClient({
    apiBase: config.ZENAPPLY_API_BASE,
    email: config.ZENAPPLY_SERVICE_EMAIL,
    password: config.ZENAPPLY_SERVICE_PASSWORD,
    timeoutMs: config.UPSTREAM_TIMEOUT_MS,
    concurrency: config.UPSTREAM_CONCURRENCY,
  });

  const mcpServer = createMcpServer({
    client: zenapplyClient,
    cursorSecret: config.CURSOR_HMAC_SECRET,
    store,
  });

  // Health checks
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/health/ready', async (_req: Request, res: Response) => {
    try {
      // Test store query
      store.listCredentials();
      // Test upstream login
      await zenapplyClient.login();
      res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
    } catch (err: any) {
      res.status(503).json({ status: 'not_ready', error: err.message });
    }
  });

  // Support HTTP Basic Authentication for confidential client tokens (/token)
  app.use((req: Request, _res: Response, next) => {
    if (req.headers.authorization && req.headers.authorization.startsWith('Basic ')) {
      const b64 = req.headers.authorization.slice(6).trim();
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx !== -1) {
        const clientId = decodeURIComponent(decoded.slice(0, colonIdx));
        const clientSecret = decodeURIComponent(decoded.slice(colonIdx + 1));
        req.body = req.body || {};
        if (!req.body.client_id) req.body.client_id = clientId;
        if (!req.body.client_secret) req.body.client_secret = clientSecret;
      }
    }
    next();
  });

  // Default token_endpoint_auth_method to 'none' on DCR when omitted
  app.post('/register', (req: Request, _res: Response, next) => {
    if (req.body && !req.body.token_endpoint_auth_method) {
      req.body.token_endpoint_auth_method = 'none';
    }
    next();
  });

  // Serve RFC 9728 Protected Resource Metadata at both /mcp and root
  const protectedResourceMetadata = {
    resource: `${config.PUBLIC_BASE_URL.replace(/\/$/, '')}/mcp`,
    authorization_servers: [
      config.PUBLIC_BASE_URL.endsWith('/') ? config.PUBLIC_BASE_URL : `${config.PUBLIC_BASE_URL}/`,
    ],
    scopes_supported: ['read'],
    bearer_methods_supported: ['header'],
  };

  app.get(
    ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'],
    (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(protectedResourceMetadata);
    },
  );

  // Mount OAuth router
  const issuerUrl = new URL(config.PUBLIC_BASE_URL);
  const mcpUrl = new URL('/mcp', config.PUBLIC_BASE_URL);

  const oauthRouterOptions = {
    provider: oauthProvider,
    issuerUrl,
    baseUrl: issuerUrl,
    resourceServerUrl: mcpUrl,
    scopesSupported: ['read'],
  };

  app.use(mcpAuthRouter(oauthRouterOptions));

  // Consent submission endpoint (from consent page form)
  app.post('/authorize/consent', (req: Request, res: Response) => {
    const { client_id, redirect_uri, code_challenge, state, enrollment_code } = req.body;

    if (!enrollment_code || typeof enrollment_code !== 'string') {
      res.status(400).send(
        renderConsentPage({
          clientId: client_id,
          redirectUri: redirect_uri,
          codeChallenge: code_challenge,
          state,
          error: 'Enrollment code is required.',
        }),
      );
      return;
    }

    const credentialName = store.consumeEnrollmentCode(enrollment_code.trim());
    if (!credentialName) {
      res.status(400).send(
        renderConsentPage({
          clientId: client_id,
          redirectUri: redirect_uri,
          codeChallenge: code_challenge,
          state,
          error: 'Invalid, expired, or already used enrollment code.',
        }),
      );
      return;
    }

    // Generate auth code
    const authCode = `zac_${crypto.randomBytes(32).toString('base64url')}`;
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    store.saveAuthCode(authCode, {
      client_id,
      credential_name: credentialName,
      redirect_uri,
      code_challenge,
      scopes: ['read'],
      expires_at: expiresAt,
    });

    const targetUrl = new URL(redirect_uri);
    targetUrl.searchParams.set('code', authCode);
    if (state) {
      targetUrl.searchParams.set('state', state);
    }

    res.redirect(targetUrl.toString());
  });

  // Mount Streamable HTTP transport for /mcp
  // In stateless mode, each incoming request connects via a new transport instance
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpUrl);

  const mcpAuth = requireBearerAuth({
    verifier: oauthProvider,
    resourceMetadataUrl,
  });

  // Authenticate all methods on /mcp
  app.use('/mcp', mcpAuth);

  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const mcpServer = createMcpServer({
        client: zenapplyClient,
        cursorSecret: config.CURSOR_HMAC_SECRET,
        store,
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err }, 'Error handling MCP POST request');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  // Non-POST requests with valid token return 405 Method Not Allowed with Allow: POST
  app.all('/mcp', (_req: Request, res: Response) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed', error_description: 'Only POST is supported for /mcp' });
  });

  return { app, store, zenapplyClient, config };
}

if (process.env.NODE_ENV !== 'test' && !process.env.ZENAPPLY_CLI) {
  const { app, config } = createApp();
  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, url: config.PUBLIC_BASE_URL }, 'ZenApply MCP server started');
  });
}
