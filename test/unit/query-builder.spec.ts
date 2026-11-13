import { describe, it, expect } from 'vitest';
import { buildSearchParams } from '../../src/core/query-builder.js';
import { createCursor } from '../../src/core/cursor.js';
import { ToolError } from '../../src/core/errors.js';

const SECRET = 'test-secret-at-least-16-chars-long';
const NOW = new Date('2026-11-13T12:00:00.000Z');
const VALID_POSTED_AFTER = '2026-11-11T12:00:00.000Z'; // 2 days ago

describe('buildSearchParams', () => {
  it('maps a valid query and applies defaults', () => {
    const res = buildSearchParams(
      {
        query: 'node.js, typescript',
        posted_after: VALID_POSTED_AFTER,
      },
      SECRET,
      NOW,
    );

    expect(res.upstreamParams).toMatchObject({
      q: 'node.js, typescript',
      postedFrom: VALID_POSTED_AFTER,
      postedTo: NOW.toISOString(),
      sortBy: 'date',
      sortOrder: 'desc',
      page: 1,
      limit: 50,
      grouped: 'true',
    });
    expect(res.page).toBe(1);
    expect(res.postedBefore).toBe(NOW.toISOString());
  });

  it('rejects empty query or query > 300 chars', () => {
    expect(() =>
      buildSearchParams({ query: '', posted_after: VALID_POSTED_AFTER }, SECRET, NOW),
    ).toThrow(ToolError);

    expect(() =>
      buildSearchParams({ query: 'a'.repeat(301), posted_after: VALID_POSTED_AFTER }, SECRET, NOW),
    ).toThrow(ToolError);
  });

  it('rejects posted_after older than 30 days', () => {
    const thirtyOneDaysAgo = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(() =>
      buildSearchParams({ query: 'node', posted_after: thirtyOneDaysAgo }, SECRET, NOW),
    ).toThrow('posted_after must be within the last 30 days');
  });

  it('rejects posted_after in the future', () => {
    const future = new Date(NOW.getTime() + 60000).toISOString();
    expect(() =>
      buildSearchParams({ query: 'node', posted_after: future }, SECRET, NOW),
    ).toThrow('posted_after cannot be in the future');
  });

  it('rejects posted_before <= posted_after', () => {
    expect(() =>
      buildSearchParams(
        {
          query: 'node',
          posted_after: VALID_POSTED_AFTER,
          posted_before: VALID_POSTED_AFTER,
        },
        SECRET,
        NOW,
      ),
    ).toThrow('posted_before must be strictly after posted_after');
  });

  it('joins multiple countries with | and preserves them', () => {
    const res = buildSearchParams(
      {
        query: 'node',
        posted_after: VALID_POSTED_AFTER,
        countries: ['Germany', 'AE', 'Netherlands'],
      },
      SECRET,
      NOW,
    );
    expect(res.upstreamParams.loc).toBe('Germany|AE|Netherlands');
  });

  it('rejects combining countries and location', () => {
    expect(() =>
      buildSearchParams(
        {
          query: 'node',
          posted_after: VALID_POSTED_AFTER,
          countries: ['Germany'],
          location: 'Berlin',
        },
        SECRET,
        NOW,
      ),
    ).toThrow('Cannot combine countries and location');
  });

  it('rejects more than 10 countries', () => {
    expect(() =>
      buildSearchParams(
        {
          query: 'node',
          posted_after: VALID_POSTED_AFTER,
          countries: Array(11).fill('Germany'),
        },
        SECRET,
        NOW,
      ),
    ).toThrow('countries takes at most 10 countries');
  });

  it('rejects unknown combined with work_model_confirmed_only=true', () => {
    expect(() =>
      buildSearchParams(
        {
          query: 'node',
          posted_after: VALID_POSTED_AFTER,
          work_model: ['remote', 'unknown'],
          work_model_confirmed_only: true,
        },
        SECRET,
        NOW,
      ),
    ).toThrow('"unknown" work model cannot be combined with work_model_confirmed_only=true');
  });

  it('clamps limit to 100 max and 1 min', () => {
    const resMax = buildSearchParams(
      { query: 'node', posted_after: VALID_POSTED_AFTER, limit: 150 },
      SECRET,
      NOW,
    );
    expect(resMax.upstreamParams.limit).toBe(100);

    const resMin = buildSearchParams(
      { query: 'node', posted_after: VALID_POSTED_AFTER, limit: 0 },
      SECRET,
      NOW,
    );
    expect(resMin.upstreamParams.limit).toBe(1);
  });

  it('pins posted_before and advances page when cursor is supplied', () => {
    const pinnedTime = '2026-11-13T10:00:00.000Z';
    // First build args to get hash
    const initial = buildSearchParams(
      {
        query: 'node.js',
        posted_after: VALID_POSTED_AFTER,
      },
      SECRET,
      new Date(pinnedTime),
    );

    const cursor = createCursor(
      {
        v: 1,
        args_hash: initial.argsHash,
        page: 2,
        posted_before: pinnedTime,
      },
      SECRET,
    );

    const nextRun = buildSearchParams(
      {
        query: 'node.js',
        posted_after: VALID_POSTED_AFTER,
        cursor,
      },
      SECRET,
      NOW, // Later time, but cursor should keep pinnedTime!
    );

    expect(nextRun.page).toBe(2);
    expect(nextRun.postedBefore).toBe(pinnedTime);
    expect(nextRun.upstreamParams.postedTo).toBe(pinnedTime);
    expect(nextRun.upstreamParams.page).toBe(2);
  });

  it('rejects cursor replayed with different search arguments', () => {
    const initial = buildSearchParams(
      { query: 'node.js', posted_after: VALID_POSTED_AFTER },
      SECRET,
      NOW,
    );

    const cursor = createCursor(
      {
        v: 1,
        args_hash: initial.argsHash,
        page: 2,
        posted_before: NOW.toISOString(),
      },
      SECRET,
    );

    expect(() =>
      buildSearchParams(
        { query: 'typescript', posted_after: VALID_POSTED_AFTER, cursor },
        SECRET,
        NOW,
      ),
    ).toThrow('Cursor was generated with different search parameters and cannot be reused');
  });

  it('rejects tampered cursor', () => {
    expect(() =>
      buildSearchParams(
        { query: 'node', posted_after: VALID_POSTED_AFTER, cursor: 'invalid.cursor.signature' },
        SECRET,
        NOW,
      ),
    ).toThrow('Invalid cursor format');
  });
});
