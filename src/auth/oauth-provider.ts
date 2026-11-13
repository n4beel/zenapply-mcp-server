import crypto from 'node:crypto';
import { Response } from 'express';
import {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { SQLiteAuthStore } from './store.js';
import { renderConsentPage } from './consent-page.js';

export class ZenApplyOAuthProvider implements OAuthServerProvider {
  constructor(
    private readonly store: SQLiteAuthStore,
    private readonly allowedRedirectUris: string[],
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId: string) => {
        const c = this.store.getClient(clientId);
        if (!c) return undefined;
        return {
          client_id: c.client_id,
          client_secret: c.client_secret,
          client_name: c.client_name,
          redirect_uris: c.redirect_uris,
          grant_types: c.grant_types as any,
          response_types: c.response_types as any,
          token_endpoint_auth_method: c.token_endpoint_auth_method as any,
          client_id_issued_at: c.created_at,
        };
      },
      registerClient: (client) => {
        const clientId = crypto.randomUUID();
        const authMethod = client.token_endpoint_auth_method || 'none';
        const clientSecret = authMethod === 'none' ? undefined : crypto.randomBytes(32).toString('hex');
        const record = {
          client_id: clientId,
          client_secret: clientSecret,
          client_name: client.client_name,
          redirect_uris: client.redirect_uris,
          grant_types: client.grant_types || ['authorization_code', 'refresh_token'],
          response_types: client.response_types || ['code'],
          token_endpoint_auth_method: authMethod,
          created_at: Math.floor(Date.now() / 1000),
        };
        this.store.saveClient(record);
        return {
          ...record,
          client_id_issued_at: record.created_at,
        } as OAuthClientInformationFull;
      },
    };
  }

  isRedirectUriAllowed(redirectUri: string): boolean {
    try {
      const url = new URL(redirectUri);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return true;
      }
      return this.allowedRedirectUris.includes(redirectUri);
    } catch {
      return false;
    }
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    if (!this.isRedirectUriAllowed(params.redirectUri)) {
      res.status(400).send('Invalid redirect_uri.');
      return;
    }

    // Render consent page requesting enrollment code
    const html = renderConsentPage({
      clientId: client.client_id,
      clientName: client.client_name,
      redirectUri: params.redirectUri,
      state: params.state,
      codeChallenge: params.codeChallenge,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const record = this.store.getAuthCode(authorizationCode);
    if (!record) {
      throw new InvalidGrantError('invalid_grant: unknown or expired code');
    }
    return record.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.store.consumeAuthCode(authorizationCode);
    if (!record || record.client_id !== client.client_id) {
      throw new InvalidGrantError('invalid_grant: invalid or expired code');
    }

    const familyId = crypto.randomUUID();
    const accessToken = `zat_${crypto.randomBytes(32).toString('base64url')}`;
    const refreshToken = `zrt_${crypto.randomBytes(32).toString('base64url')}`;

    const now = Date.now();
    // Access token lasts 1 hour
    this.store.saveToken(accessToken, {
      client_id: client.client_id,
      credential_name: record.credential_name,
      token_type: 'access',
      family_id: familyId,
      scopes: record.scopes,
      expires_at: now + 3600 * 1000,
      revoked: false,
    });

    // Refresh token lasts 30 days
    this.store.saveToken(refreshToken, {
      client_id: client.client_id,
      credential_name: record.credential_name,
      token_type: 'refresh',
      family_id: familyId,
      scopes: record.scopes,
      expires_at: now + 30 * 24 * 3600 * 1000,
      revoked: false,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: record.scopes.join(' '),
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    _resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.store.getToken(refreshToken);
    if (!record || record.token_type !== 'refresh' || record.client_id !== client.client_id) {
      throw new InvalidGrantError('invalid_grant: invalid refresh token');
    }

    // Reuse detection: if a rotated refresh token is used, revoke the family
    if (record.revoked) {
      this.store.revokeFamily(record.family_id);
      throw new InvalidGrantError('invalid_grant: refresh token revoked or rotated');
    }

    if (record.expires_at < Date.now()) {
      throw new InvalidGrantError('invalid_grant: refresh token expired');
    }

    // Rotate refresh token: revoke current, issue new
    this.store.saveToken(refreshToken, {
      ...record,
      revoked: true,
    });

    const newAccessToken = `zat_${crypto.randomBytes(32).toString('base64url')}`;
    const newRefreshToken = `zrt_${crypto.randomBytes(32).toString('base64url')}`;
    const now = Date.now();

    this.store.saveToken(newAccessToken, {
      client_id: client.client_id,
      credential_name: record.credential_name,
      token_type: 'access',
      family_id: record.family_id,
      scopes: record.scopes,
      expires_at: now + 3600 * 1000,
      revoked: false,
    });

    this.store.saveToken(newRefreshToken, {
      client_id: client.client_id,
      credential_name: record.credential_name,
      token_type: 'refresh',
      family_id: record.family_id,
      scopes: record.scopes,
      expires_at: now + 30 * 24 * 3600 * 1000, // 30 days sliding
      revoked: false,
    });

    return {
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: record.scopes.join(' '),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.store.getToken(token);
    if (!record || record.token_type !== 'access' || record.revoked || record.expires_at < Date.now()) {
      throw new InvalidTokenError('invalid_token');
    }

    // Record stats
    this.store.recordUsage(record.credential_name);

    return {
      token,
      clientId: record.client_id,
      scopes: record.scopes,
      expiresAt: Math.floor(record.expires_at / 1000), // in seconds since epoch
      extra: {
        credentialName: record.credential_name,
      },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const record = this.store.getToken(request.token);
    if (record) {
      this.store.revokeFamily(record.family_id);
    }
  }
}
