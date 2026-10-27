'use strict';

// Reserved fictional URLs only. These regressions need neither a DOM nor a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ URL, URLSearchParams });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/jobs-page.js'), 'utf8'), context);
const { listScope, linkIdentity } = context.JobScreenPage;
const origin = 'https://example.invalid';
const pagination = [
  'page', 'currentPage', 'current_page', 'pageNo', 'page_no', 'pageNum', 'page_num',
  'pageIndex', 'page_index', 'pageSize', 'page_size', 'offset', 'limit', 'from'
];

for (const prefix of ['#/', '#!/']) {
  test(`${prefix} list pagination aliases share a scope without losing filters`, () => {
    const base = `${origin}/portal?tenantId=tenant-a${prefix}jobs?job_class=graduate&city=TestCity`;
    const expected = listScope(base);
    for (const key of pagination) {
      assert.equal(listScope(`${base}&${key}=1`), expected, `${key}=1`);
      assert.equal(listScope(`${base}&${key}=2`), expected, `${key}=2`);
    }
    assert.match(expected, /job_class=graduate/);
    assert.match(expected, /city=TestCity/);
    assert.match(expected, /tenantId=tenant-a/);
    assert.match(expected, /jobs\?/);
  });

  test(`${prefix} list scopes normalize outer and route query order and tracking`, () => {
    const first = `${origin}/portal?tenantId=tenant-a&utm_source=sample&currentPage=1${prefix}jobs?job_class=graduate&city=TestCity&page_no=1&trackingId=sample&ref=sample`;
    const second = `${origin}/portal?page=2&tenantId=tenant-a&tracking=another${prefix}jobs?source=another&city=TestCity&current_page=2&job_class=graduate&utm_campaign=sample`;
    assert.equal(listScope(first), listScope(second));
  });

  test(`${prefix} list scopes distinguish job class, city, route and tenant`, () => {
    const url = `${origin}/portal?tenantId=tenant-a${prefix}jobs?job_class=graduate&city=TestCity&page=1`;
    const scope = listScope(url);
    for (const changed of [
      url.replace('job_class=graduate', 'job_class=experienced'),
      url.replace('city=TestCity', 'city=OtherCity'),
      url.replace(`${prefix}jobs?`, `${prefix}positions?`),
      url.replace('tenantId=tenant-a', 'tenantId=tenant-b')
    ]) assert.notEqual(listScope(changed), scope, changed);
  });

  test(`${prefix} route job IDs remain distinct behind an outer generic tenant ID`, () => {
    for (const key of ['jobId', 'job_id']) {
      const first = `${origin}/portal?id=tenant-a${prefix}detail?${key}=job-a`;
      const second = `${origin}/portal?id=tenant-a${prefix}detail?${key}=job-b`;
      assert.notEqual(linkIdentity(first), linkIdentity(second), key);
      assert.equal(linkIdentity(first), linkIdentity(`${origin}/portal?id=tenant-a&utm_source=sample${prefix}detail?ref=sample&${key}=job-a`), key);
    }
  });

  test(`${prefix} same posting retains its tenant namespace`, () => {
    const first = `${origin}/portal?tenantId=tenant-a${prefix}detail?jobId=job-a`;
    assert.notEqual(linkIdentity(first), linkIdentity(first.replace('tenantId=tenant-a', 'tenantId=tenant-b')));
  });

  test(`${prefix} job identity uses route-specific, outer-specific and generic ID precedence`, () => {
    const make = query => `${origin}/portal${query.outer}${prefix}detail${query.route}`;
    // A route-specific job ID wins over both generic IDs and outer job IDs.
    const routeSpecific = make({ outer: '?id=tenant-a&jobId=outer-a', route: '?id=route-generic&job_id=route-a' });
    assert.equal(linkIdentity(routeSpecific), linkIdentity(routeSpecific.replace('jobId=outer-a', 'jobId=outer-b')));
    assert.equal(linkIdentity(routeSpecific), linkIdentity(routeSpecific.replace('id=route-generic', 'id=other-generic')));
    assert.notEqual(linkIdentity(routeSpecific), linkIdentity(routeSpecific.replace('job_id=route-a', 'job_id=route-b')));
    // An explicit outer posting ID wins over a route's generic ID.
    const outerSpecific = make({ outer: '?id=tenant-a&position_id=outer-a', route: '?id=route-a' });
    assert.equal(linkIdentity(outerSpecific), linkIdentity(outerSpecific.replace('id=route-a', 'id=route-b')));
    assert.notEqual(linkIdentity(outerSpecific), linkIdentity(outerSpecific.replace('position_id=outer-a', 'position_id=outer-b')));
    // With no explicit posting ID, route id wins over the outer generic id.
    const routeGeneric = make({ outer: '?id=tenant-a', route: '?id=route-a' });
    assert.notEqual(linkIdentity(routeGeneric), linkIdentity(routeGeneric.replace('id=route-a', 'id=route-b')));
    const outerGeneric = make({ outer: '?id=outer-a', route: '' });
    assert.notEqual(linkIdentity(outerGeneric), linkIdentity(outerGeneric.replace('id=outer-a', 'id=outer-b')));
  });

  test(`${prefix} route links without explicit IDs normalize query order and tracking`, () => {
    const first = `${origin}/portal?tenantId=tenant-a&utm_source=sample${prefix}detail/opaque-a?city=TestCity&job_class=graduate&trackingId=sample`;
    const second = `${origin}/portal?tracking=sample&tenantId=tenant-a${prefix}detail/opaque-a?ref=sample&job_class=graduate&city=TestCity`;
    assert.equal(linkIdentity(first), linkIdentity(second));
    assert.notEqual(linkIdentity(first), linkIdentity(first.replace('job_class=graduate', 'job_class=experienced')));
    assert.notEqual(linkIdentity(first), linkIdentity(first.replace('city=TestCity', 'city=OtherCity')));
  });

  test(`${prefix} opaque route path IDs remain case-sensitive and distinct`, () => {
    const urls = ['AbC-01_x', 'abc-01_x', 'AbC-1_x', 'AbC%2F01_x'].map(id => `${origin}/portal${prefix}detail/${id}`);
    assert.equal(new Set(urls.map(linkIdentity)).size, urls.length);
    assert.notEqual(linkIdentity(`${origin}/portal${prefix}jobs/opaque-a`), linkIdentity(`${origin}/portal${prefix}positions/opaque-a`));
  });
}

test('non-hash list scope keeps meaningful filters and removes ordinary anchors', () => {
  const first = `${origin}/jobs?city=TestCity&job_class=graduate&page=1&utm_source=sample#results`;
  const second = `${origin}/jobs?currentPage=2&job_class=graduate&city=TestCity#other`;
  assert.equal(listScope(first), listScope(second));
  assert.notEqual(listScope(first), listScope(first.replace('job_class=graduate', 'job_class=experienced')));
  assert.notEqual(listScope(first), listScope(first.replace('city=TestCity', 'city=OtherCity')));
});

test('non-hash list scope normalizes common outer pagination aliases', () => {
  const base = `${origin}/jobs?tenantId=tenant-a&job_class=graduate&city=TestCity`;
  for (const key of pagination) assert.equal(listScope(`${base}&${key}=2`), listScope(base), key);
});

test('non-hash links retain posting ID priority and ignore tracking variants', () => {
  const first = `${origin}/jobs/detail?id=tenant-a&jobId=job-a&utm_source=sample#summary`;
  const second = `${origin}/jobs/detail?trackingId=sample&jobId=job-a&id=tenant-a#requirements`;
  assert.equal(linkIdentity(first), linkIdentity(second));
  assert.notEqual(linkIdentity(first), linkIdentity(first.replace('jobId=job-a', 'jobId=job-b')));
  assert.notEqual(linkIdentity(`${origin}/jobs/detail?id=job-a`), linkIdentity(`${origin}/jobs/detail?id=job-b`));
});

test('non-hash opaque paths remain distinct while ordinary anchors and tracking normalize', () => {
  const first = `${origin}/jobs/AbC-01_x?city=TestCity&utm_source=sample#summary`;
  assert.equal(linkIdentity(first), linkIdentity(`${origin}/jobs/AbC-01_x?trackingId=sample&city=TestCity#requirements`));
  for (const changed of [
    first.replace('/AbC-01_x', '/abc-01_x'),
    first.replace('/AbC-01_x', '/AbC-1_x'),
    first.replace('/AbC-01_x', '/AbC%2F01_x')
  ]) assert.notEqual(linkIdentity(first), linkIdentity(changed), changed);
});
