import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'authorization',
      'headers.authorization',
      'cookie',
      'headers.cookie',
      'code',
      'refresh_token',
      'access_token',
      'password',
      'client_secret',
      'jwt',
      'token',
      'ZENAPPLY_SERVICE_PASSWORD',
      'CURSOR_HMAC_SECRET',
      'TOKEN_PEPPER',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
