import { describe, it, expect, beforeEach } from 'vitest';
import { SQLiteAuthStore } from '../../src/auth/store.js';
import { ZenApplyOAuthProvider } from '../../src/auth/oauth-provider.js';

describe('OAuth Server and Token Lifecycle', () => {
  let store: SQLiteAuthStore;
  let provider: ZenApplyOAuthProvider;

  beforeEach(() => {
    store = new SQLiteAuthStore(':memory:', 'test-pepper-123456');
    provider = new ZenApplyOAuthProvider(store, ['https://claude.ai/api/mcp/auth_callback']);
  });

  it('handles client registration (DCR)', async () => {
    const client = await provider.clientsStore.registerClient!({
      client_name: 'Claude Test Client',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });

    expect(client.client_id).toBeDefined();
    expect(client.client_name).toBe('Claude Test Client');

    const fetched = await provider.clientsStore.getClient(client.client_id);
    expect(fetched?.client_id).toBe(client.client_id);
  });

  it('requires single-use enrollment code to issue auth code and exchange tokens', async () => {
    // 1. Register client
    const client = await provider.clientsStore.registerClient!({
      client_name: 'Claude Pro',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });

    // 2. Mint enrollment code via store (as CLI does)
    const rawCode = 'enroll-code-secret-123';
    store.saveEnrollmentCode(rawCode, 'claude-nabeel', 15 * 60 * 1000);

    // 3. Consume enrollment code
    const consumedName = store.consumeEnrollmentCode(rawCode);
    expect(consumedName).toBe('claude-nabeel');

    // Attempting to consume again fails (single-use)
    expect(store.consumeEnrollmentCode(rawCode)).toBeNull();

    // 4. Save auth code with PKCE challenge
    const authCode = 'zac_test_auth_code_123';
    const codeChallenge = 'test-s256-code-challenge';
    store.saveAuthCode(authCode, {
      client_id: client.client_id,
      credential_name: consumedName!,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: codeChallenge,
      scopes: ['read'],
      expires_at: Date.now() + 60000,
    });

    // 5. Challenge retrieval for PKCE validation
    const storedChallenge = await provider.challengeForAuthorizationCode(client, authCode);
    expect(storedChallenge).toBe(codeChallenge);

    // 6. Token exchange
    const tokens = await provider.exchangeAuthorizationCode(client, authCode);
    expect(tokens.access_token).toBeDefined();
    expect(tokens.refresh_token).toBeDefined();

    // Consuming same auth code again fails
    await expect(provider.exchangeAuthorizationCode(client, authCode)).rejects.toThrow('invalid_grant');

    // 7. Verify access token
    const authInfo = await provider.verifyAccessToken(tokens.access_token);
    expect(authInfo.clientId).toBe(client.client_id);
    expect(authInfo.extra?.credentialName).toBe('claude-nabeel');

    // 8. Refresh token rotation
    const refreshed = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
    expect(refreshed.access_token).toBeDefined();
    expect(refreshed.refresh_token).toBeDefined();
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);

    // 9. Reusing old rotated refresh token triggers reuse detection and revokes family!
    await expect(provider.exchangeRefreshToken(client, tokens.refresh_token!)).rejects.toThrow('invalid_grant');

    // After family revocation, even the newest tokens are revoked!
    await expect(provider.exchangeRefreshToken(client, refreshed.refresh_token!)).rejects.toThrow('invalid_grant');
    await expect(provider.verifyAccessToken(refreshed.access_token)).rejects.toThrow('invalid_token');
  });

  it('revoking a credential immediately rejects verification and refresh', async () => {
    const client = await provider.clientsStore.registerClient!({
      redirect_uris: ['http://localhost/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });

    store.saveAuthCode('code-1', {
      client_id: client.client_id,
      credential_name: 'test-user',
      redirect_uri: 'http://localhost/callback',
      code_challenge: 'pkce',
      scopes: ['read'],
      expires_at: Date.now() + 60000,
    });

    const tokens = await provider.exchangeAuthorizationCode(client, 'code-1');
    expect(await provider.verifyAccessToken(tokens.access_token)).toBeDefined();

    // Revoke
    store.revokeCredential('test-user');

    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow('invalid_token');
    await expect(provider.exchangeRefreshToken(client, tokens.refresh_token!)).rejects.toThrow('invalid_grant');
  });
});
