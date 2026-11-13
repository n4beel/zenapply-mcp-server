import { describe, it, expect } from 'vitest';
import { mapSearchRow, mapFullJob, UpstreamSearchJobRow } from '../../src/core/map-row.js';

describe('mapSearchRow', () => {
  it('deduplicates locations and ensures primary location is first', () => {
    const upstream: UpstreamSearchJobRow = {
      id: 'job-1',
      job_title: 'Staff Backend Engineer',
      company: 'Acme Corp',
      location: 'Berlin, Germany',
      locations: ['Munich, Germany', 'Berlin, Germany', 'Remote'],
      posted_date: '2026-11-12T10:00:00.000Z',
      source: 'greenhouse',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
    };

    const row = mapSearchRow(upstream);
    expect(row.id).toBe('job-1');
    expect(row.title).toBe('Staff Backend Engineer');
    expect(row.company).toBe('Acme Corp');
    expect(row.location_text).toBe('Berlin, Germany');
    expect(row.locations[0]).toBe('Berlin, Germany');
    expect(row.locations).toEqual(['Berlin, Germany', 'Munich, Germany', 'Remote']);
    expect(row.location_count).toBe(3);
  });

  it('determines work_model and work_model_confirmed correctly', () => {
    // Case 1: ungrounded remote
    const ungrounded = mapSearchRow({
      id: 'j1',
      job_title: 'Engineer',
      company: 'Co',
      location: 'Remote',
      work_model: 'remote',
      posted_date: '2026-11-12T10:00:00.000Z',
      source: 'linkedin',
      url: 'https://linkedin.com/jobs/1',
    });
    expect(ungrounded.work_model).toBe('remote');
    expect(ungrounded.work_model_confirmed).toBe(false);

    // Case 2: grounded remote (resolved_work_model)
    const grounded = mapSearchRow({
      id: 'j2',
      job_title: 'Engineer',
      company: 'Co',
      location: 'Remote',
      work_model: 'remote',
      resolved_work_model: 'remote',
      posted_date: '2026-11-12T10:00:00.000Z',
      source: 'ashby',
      url: 'https://jobs.ashbyhq.com/co/1',
    });
    expect(grounded.work_model).toBe('remote');
    expect(grounded.work_model_confirmed).toBe(true);

    // Case 3: unknown work model
    const unknown = mapSearchRow({
      id: 'j3',
      job_title: 'Engineer',
      company: 'Co',
      location: 'New York',
      work_model: null,
      resolved_work_model: null,
      posted_date: '2026-11-12T10:00:00.000Z',
      source: 'linkedin',
      url: 'https://linkedin.com/jobs/3',
    });
    expect(unknown.work_model).toBeNull();
    expect(unknown.work_model_confirmed).toBe(false);
  });

  it('computes also_on excluding the primary source', () => {
    const row = mapSearchRow({
      id: 'j4',
      job_title: 'Engineer',
      company: 'Co',
      location: 'Remote',
      posted_date: '2026-11-12T10:00:00.000Z',
      source: 'linkedin',
      sources: ['linkedin', 'jobright', 'adzuna'],
      url: 'https://linkedin.com/jobs/4',
    });
    expect(row.source).toBe('linkedin');
    expect(row.also_on).toEqual(['jobright', 'adzuna']);
  });
});

describe('mapFullJob', () => {
  it('maps ATS source URLs correctly to ats_direct', () => {
    const greenhouseJob: UpstreamSearchJobRow = {
      id: 'j5',
      job_title: 'Software Engineer',
      company: 'Acme',
      location: 'Remote',
      posted_date: '2026-11-12T10:00:00.000Z',
      source: 'greenhouse',
      url: 'https://boards.greenhouse.io/acme/jobs/5',
      description: '# Software Engineer\n\nMust know TypeScript.',
      description_format_version: 2,
    };

    const mapped = mapFullJob(greenhouseJob);
    expect(mapped.apply_url).toBe('https://boards.greenhouse.io/acme/jobs/5');
    expect(mapped.apply_url_kind).toBe('ats_direct');
    expect(mapped.description).toBe('# Software Engineer\n\nMust know TypeScript.');
    expect(mapped.description_truncated).toBe(false);
  });

  it('maps aggregator sources to posting or ats_direct if external_apply_url exists', () => {
    const linkedinJob: UpstreamSearchJobRow = {
      id: 'j6',
      job_title: 'Software Engineer',
      company: 'Acme',
      location: 'Remote',
      posted_date: '2026-11-12T10:00:00.000Z',
      source: 'linkedin',
      url: 'https://www.linkedin.com/jobs/view/6',
      external_apply_url: 'https://jobs.lever.co/acme/6',
      description: '<p>Legacy HTML description</p>',
    };

    const mapped = mapFullJob(linkedinJob);
    expect(mapped.apply_url).toBe('https://jobs.lever.co/acme/6');
    expect(mapped.apply_url_kind).toBe('posting'); // Not an ATS source directly, but external apply url exists
    expect(mapped.description).toBe('Legacy HTML description');
    expect(mapped.description_truncated).toBe(false);
  });
});
