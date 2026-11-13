#!/usr/bin/env node
import { loadConfig } from '../../src/config.js';
import { ZenApplyClient } from '../../src/upstream/zenapply-client.js';
import { mapSearchRow, mapFullJob } from '../../src/core/map-row.js';

const config = loadConfig();
const client = new ZenApplyClient({
  apiBase: config.ZENAPPLY_API_BASE,
  email: config.ZENAPPLY_SERVICE_EMAIL,
  password: config.ZENAPPLY_SERVICE_PASSWORD,
  timeoutMs: config.UPSTREAM_TIMEOUT_MS,
  concurrency: config.UPSTREAM_CONCURRENCY,
});

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${msg}`);
    process.exit(1);
  }
}

async function run() {
  console.log('🚀 Running Post-Deploy Smoke Test against live prod API...');
  const t0 = Date.now();
  const postedFrom = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

  // 1. Authenticate upstream
  console.log('1. Checking upstream authentication...');
  const token = await client.login();
  assert(typeof token === 'string' && token.length > 50, 'Token must be valid');
  console.log('   Authenticated successfully.');

  // 2. Sample A: Remote Node.js / TypeScript
  console.log('\n2. Testing Sample A: remote Node/TypeScript...');
  const sampleA = await client.request<{ jobs: any[]; total: number }>('/search/service/search', {
    q: '"node.js", typescript, nestjs',
    workModels: 'remote',
    postedFrom,
    limit: 50,
  });
  console.log(`   Sample A returned ${sampleA.jobs?.length} rows (total matching: ${sampleA.total})`);
  assert(sampleA.total > 0, 'Sample A total must be > 0');
  assert(Array.isArray(sampleA.jobs) && sampleA.jobs.length > 0, 'Sample A jobs array must not be empty');

  // Verify contract on live rows
  for (const rawJob of sampleA.jobs) {
    assert(rawJob.id && typeof rawJob.id === 'string', 'Job must have id');
    assert(rawJob.job_title && typeof rawJob.job_title === 'string', 'Job must have job_title');
    assert(rawJob.company && typeof rawJob.company === 'string', 'Job must have company');
    assert(rawJob.locations && Array.isArray(rawJob.locations), 'Job must have locations array');
    assert(rawJob.posted_date, 'Job must have posted_date');
    assert(!rawJob.description, 'Search response job must omit description');

    const mapped = mapSearchRow(rawJob);
    assert(mapped.id === rawJob.id, 'Mapped id must match');
    assert(mapped.locations.length > 0, 'Mapped locations must not be empty');
  }

  // 3. get_job on top 3 jobs from Sample A
  const sampleJobIds = sampleA.jobs.slice(0, 3).map((j) => j.id);
  console.log(`\n3. Testing get_job on top ${sampleJobIds.length} jobs...`);
  const jobsRes = await client.request<{ jobs: any[]; not_found: string[] }>('/search/service/jobs', {
    ids: sampleJobIds.join(','),
  });
  assert(jobsRes.jobs?.length === sampleJobIds.length, `Expected ${sampleJobIds.length} full jobs returned`);

  for (const fullJob of jobsRes.jobs) {
    assert(typeof fullJob.description === 'string' && fullJob.description.length > 0, 'Full job must have description string');
    const mappedFull = mapFullJob(fullJob);
    assert(mappedFull.description.length > 0, 'Mapped full job must have description');
    assert(['ats_direct', 'posting', 'unknown'].includes(mappedFull.apply_url_kind), 'apply_url_kind must be valid enum');
  }
  console.log('   Full jobs retrieved and mapped successfully.');

  // 4. Sample B: Germany, UAE, Netherlands
  console.log('\n4. Testing Sample B: Germany | AE | Netherlands...');
  const sampleB = await client.request<{ jobs: any[]; total: number }>('/search/service/search', {
    q: '"backend engineer", "full stack", typescript',
    loc: 'Germany|AE|Netherlands',
    postedFrom,
    limit: 20,
  });
  console.log(`   Sample B returned ${sampleB.jobs?.length} rows (total matching: ${sampleB.total})`);
  assert(sampleB.total > 0, 'Sample B total must be > 0');

  // 5. Sample C: Pakistan (no work model)
  console.log('\n5. Testing Sample C: Pakistan (no work model)...');
  const sampleC = await client.request<{ jobs: any[]; total: number }>('/search/service/search', {
    q: '"node.js", typescript',
    loc: 'Pakistan',
    postedFrom,
    limit: 20,
  });
  console.log(`   Sample C returned ${sampleC.jobs?.length} rows (total matching: ${sampleC.total})`);

  // 6. Sample D: Remote + Unknown comparison
  console.log('\n6. Testing Sample D: ["remote", "unknown"] >= ["remote"] alone...');
  const sampleD = await client.request<{ jobs: any[]; total: number }>('/search/service/search', {
    q: '"node.js", typescript, nestjs',
    workModels: 'remote,unknown',
    postedFrom,
    limit: 50,
  });
  console.log(`   Sample D total: ${sampleD.total} vs Sample A total: ${sampleA.total}`);
  assert(sampleD.total >= sampleA.total, 'Sample D total must be >= Sample A total');

  console.log(`\n✅ Post-deploy live smoke test passed in ${(Date.now() - t0) / 1000}s!`);
}

run().catch((err) => {
  console.error('❌ Smoke test failed:', err);
  process.exit(1);
});
