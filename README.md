# ZenApply MCP Server

Read-only Model Context Protocol (MCP) server for searching ZenApply job listings and retrieving full job descriptions.

Connects Claude (Claude.ai Pro / Team custom connector) and machine clients directly to ZenApply's service search API.

## Features

- **OAuth 2.1 Authorization Server**: Implements Dynamic Client Registration (DCR), PKCE (`S256`), and one-time enrollment code verification.
- **Streamable HTTP Transport**: Stateless Streamable HTTP transport (`/mcp`) according to the official MCP specification.
- **Tools**:
  - `search_jobs`: Search ZenApply's aggregated listings with strict parameter validation, HMAC-signed cursors for pagination, and upstream rate limiting.
  - `get_job`: Fetch full markdown descriptions, direct apply links (ATS), seniority, and salary for 1–20 job IDs.
- **Security & Hygiene**:
  - No database credentials or application secrets shared with the main application.
  - SQLite token and credential store storing only hashed secrets.
  - Full redaction in structured JSON logs (Pino).
  - Strict rate limits and upstream single-concurrency guardrails.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build TypeScript
npm run build
```

## CLI Runbook

Mint a one-time 128-bit enrollment code:
```bash
npm run cli -- enroll --name claude-nabeel --ttl 15m
```

List registered credentials and usage statistics:
```bash
npm run cli -- list
```

Revoke all active tokens for a credential:
```bash
npm run cli -- revoke <credential-name>
```

## License

ISC
