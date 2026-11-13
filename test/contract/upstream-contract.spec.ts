import { describe, it, expect } from 'vitest';
import searchFixture from '../fixtures/service-search.json';
import jobsFixture from '../fixtures/service-jobs.json';
import { mapSearchRow, mapFullJob } from '../../src/core/map-row.js';

describe('Contract: Real Upstream Response Schemas', () => {
  describe('/search/service/search response contract', () => {
    it('contains all required top-level search properties', () => {
      expect(searchFixture).toHaveProperty('total');
      expect(typeof searchFixture.total).toBe('number');
      expect(searchFixture).toHaveProperty('jobs');
      expect(Array.isArray(searchFixture.jobs)).toBe(true);
      expect(searchFixture.jobs.length).toBeGreaterThan(0);
      expect(searchFixture).toHaveProperty('applied');
    });

    it('contains every field expected by mapSearchRow on each job', () => {
      for (const rawJob of searchFixture.jobs) {
        // Essential fields mapped by mapSearchRow
        expect(rawJob).toHaveProperty('id');
        expect(typeof rawJob.id).toBe('string');
        expect(rawJob.id.length).toBeGreaterThan(0);

        expect(rawJob).toHaveProperty('job_title');
        expect(typeof rawJob.job_title).toBe('string');

        expect(rawJob).toHaveProperty('company');
        expect(typeof rawJob.company).toBe('string');

        expect(rawJob).toHaveProperty('location');
        expect(typeof rawJob.location).toBe('string');

        expect(rawJob).toHaveProperty('locations');
        expect(Array.isArray(rawJob.locations)).toBe(true);

        expect(rawJob).toHaveProperty('posted_date');
        expect(new Date(rawJob.posted_date).toString()).not.toBe('Invalid Date');

        expect(rawJob).toHaveProperty('source');
        expect(typeof rawJob.source).toBe('string');

        expect(rawJob).toHaveProperty('url');
        expect(typeof rawJob.url).toBe('string');

        // Confirm mapping runs cleanly without throwing
        const mapped = mapSearchRow(rawJob as any);
        expect(mapped.id).toBe(rawJob.id);
        expect(mapped.title).toBe(rawJob.job_title);
        expect(mapped.company).toBe(rawJob.company);
        expect(mapped.locations).toContain(rawJob.location);
      }
    });

    it('does NOT contain descriptions on search rows (compacted upstream)', () => {
      for (const rawJob of searchFixture.jobs) {
        expect(rawJob).not.toHaveProperty('description');
        expect(rawJob).not.toHaveProperty('description_format_version');
      }
    });
  });

  describe('/search/service/jobs response contract', () => {
    it('contains jobs and not_found arrays', () => {
      expect(jobsFixture).toHaveProperty('jobs');
      expect(Array.isArray(jobsFixture.jobs)).toBe(true);
      expect(jobsFixture.jobs.length).toBeGreaterThan(0);

      expect(jobsFixture).toHaveProperty('not_found');
      expect(Array.isArray(jobsFixture.not_found)).toBe(true);
      expect(jobsFixture.not_found).toContain('00000000-0000-0000-0000-000000000000');
    });

    it('contains full job descriptions and maps cleanly via mapFullJob', () => {
      for (const rawJob of jobsFixture.jobs) {
        expect(rawJob).toHaveProperty('id');
        expect(rawJob).toHaveProperty('job_title');
        expect(rawJob).toHaveProperty('company');
        expect(rawJob).toHaveProperty('description');
        expect(typeof rawJob.description).toBe('string');

        const mapped = mapFullJob(rawJob as any);
        expect(mapped.id).toBe(rawJob.id);
        expect(mapped.title).toBe(rawJob.job_title);
        expect(mapped.description).toBe(rawJob.description);
        expect(mapped.apply_url).toBeDefined();
        expect(['ats_direct', 'posting', 'unknown']).toContain(mapped.apply_url_kind);
      }
    });
  });
});
