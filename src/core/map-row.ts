import { formatDescription } from './description.js';

export interface UpstreamSearchJobRow {
  id: string;
  job_title: string;
  company: string;
  location: string;
  locations?: string[];
  locations_truncated?: boolean;
  work_model?: string | null;
  resolved_work_model?: string | null;
  structured_work_model?: string | null;
  posted_date: string | Date;
  posted_date_precision?: 'exact' | 'hour' | 'date';
  created_at?: string | Date;
  source: string;
  sources?: string[];
  url: string;
  external_apply_url?: string;
  company_website_url?: string;
  company_linkedin_url?: string;
  employment_type?: string;
  seniority_level?: string;
  salary_range?: string;
  description?: string;
  description_format_version?: number;
  group_size?: number;
}

export interface MappedSearchRow {
  id: string;
  title: string;
  company: string;
  locations: string[];
  location_count: number;
  location_text: string;
  work_model: 'remote' | 'hybrid' | 'onsite' | null;
  work_model_confirmed: boolean;
  posted_at: string;
  posted_at_precision?: 'exact' | 'hour' | 'date';
  first_seen_at: string;
  source: string;
  also_on: string[];
  url: string;
}

export interface MappedFullJob extends MappedSearchRow {
  description: string;
  description_truncated: boolean;
  apply_url: string | null;
  apply_url_kind: 'ats_direct' | 'posting' | 'unknown';
  company_website: string | null;
  company_linkedin: string | null;
  employment_type: string | null;
  seniority: string | null;
  salary_text: string | null;
}

const ATS_SOURCES = new Set([
  'lever',
  'greenhouse',
  'workable',
  'smartrecruiters',
  'recruitee',
  'breezy',
  'bamboohr',
  'ashby',
]);

export function mapSearchRow(row: UpstreamSearchJobRow): MappedSearchRow {
  // Deduplicate locations and make sure primary row's location is first
  const locSet = new Set<string>();
  if (row.location) {
    locSet.add(row.location);
  }
  if (row.locations && Array.isArray(row.locations)) {
    for (const l of row.locations) {
      if (l) locSet.add(l);
    }
  }
  const locations = Array.from(locSet).slice(0, 25);

  // Work model determination
  // resolved_work_model is grounded. Fall back to work_model
  const rawModel = (row.resolved_work_model || row.work_model || '').toLowerCase().trim();
  let work_model: 'remote' | 'hybrid' | 'onsite' | null = null;
  if (rawModel === 'remote' || rawModel === 'hybrid' || rawModel === 'onsite') {
    work_model = rawModel;
  }

  // work_model_confirmed is true when resolved_work_model is set or structured_work_model exists
  const work_model_confirmed = Boolean(row.resolved_work_model || row.structured_work_model);

  const postedDate = typeof row.posted_date === 'string' ? row.posted_date : new Date(row.posted_date).toISOString();
  const createdAt = row.created_at
    ? typeof row.created_at === 'string'
      ? row.created_at
      : new Date(row.created_at).toISOString()
    : postedDate;

  // Other sources
  const otherSources = (row.sources || []).filter((s) => s.toLowerCase() !== row.source.toLowerCase());

  return {
    id: row.id,
    title: row.job_title,
    company: row.company,
    locations,
    location_count: locations.length,
    location_text: row.location || '',
    work_model,
    work_model_confirmed,
    posted_at: postedDate,
    ...(row.posted_date_precision ? { posted_at_precision: row.posted_date_precision } : {}),
    first_seen_at: createdAt,
    source: row.source,
    also_on: otherSources,
    url: row.url,
  };
}

export function mapFullJob(row: UpstreamSearchJobRow, maxLength = 20000): MappedFullJob {
  const base = mapSearchRow(row);
  const { description, description_truncated } = formatDescription(
    row.description,
    row.description_format_version,
    maxLength,
  );

  const sourceLower = (row.source || '').toLowerCase();
  let apply_url: string | null = null;
  let apply_url_kind: 'ats_direct' | 'posting' | 'unknown' = 'unknown';

  if (row.external_apply_url) {
    apply_url = row.external_apply_url;
    apply_url_kind = ATS_SOURCES.has(sourceLower) ? 'ats_direct' : 'posting';
  } else if (ATS_SOURCES.has(sourceLower) && row.url) {
    apply_url = row.url;
    apply_url_kind = 'ats_direct';
  } else if (row.url) {
    apply_url = row.url;
    apply_url_kind = 'posting';
  }

  return {
    ...base,
    description,
    description_truncated,
    apply_url,
    apply_url_kind,
    company_website: row.company_website_url ?? null,
    company_linkedin: row.company_linkedin_url ?? null,
    employment_type: row.employment_type ?? null,
    seniority: row.seniority_level ?? null,
    salary_text: row.salary_range ?? null,
  };
}
