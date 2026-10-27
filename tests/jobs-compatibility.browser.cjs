'use strict';

// Fictional DOM fixtures only. The isolated context fulfills every document locally.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://example.invalid';
const columns = [
  ['name', '职位名称'], ['company', '公司名称'], ['department', '组织名称'],
  ['count', '招聘人数'], ['city', '工作城市'], ['experience', '工作年限'],
  ['degree', '学历要求'], ['published', '发布时间']
];
const record = (suffix, extra = {}) => ({
  name: '虚构表格岗位' + suffix, company: '虚构单位' + suffix + '公司',
  department: '虚构组织' + suffix, count: '2', city: '测试市',
  experience: '无经验要求', degree: '本科及以上', published: '2099-01-01', ...extra
});
const headers = keys => '<div class="table-header">' + keys.map(key =>
  '<div class="table-header-cell" col-key="' + key + '">' + columns.find(col => col[0] === key)[1] + '</div>'
).join('') + '</div>';
const gridRow = (job, index, keys, attrs = '') => '<div class="table-row" row-index="' + index + '" ' + attrs + '>' +
  keys.map(key => '<div class="table-cell" col-key="' + key + '"><div class="cell-content">' + job[key] + '</div></div>').join('') + '</div>';
const grid = (jobs, options = {}) => {
  const fixed = options.fixed || [], flex = columns.map(col => col[0]).filter(key => !fixed.includes(key));
  return '<main><div>招聘职位 (' + (options.total ?? jobs.length) + ')</div><div class="hc-list-grid-new">' +
    '<div class="fix-content">' + headers(fixed) + jobs.map((job, index) => gridRow(job, index, fixed)).join('') + '</div>' +
    '<div class="flex-content">' + headers(flex) + jobs.map((job, index) => gridRow(job, index, flex, options.attrs?.[index] || '')).join('') + '</div>' +
    '</div>' + (options.footer || '') + '</main>';
};
const nativeTable = jobs => '<main><table><thead><tr>' + columns.map(col => '<th>' + col[1] + '</th>').join('') +
  '</tr></thead><tbody>' + jobs.map(job => '<tr>' + columns.map(col => '<td><div>' + job[col[0]] + '</div></td>').join('') + '</tr>').join('') + '</tbody></table></main>';
const ariaGrid = jobs => '<main><div role="grid"><div role="row">' + columns.map((col, index) =>
  '<div role="columnheader" aria-colindex="' + (index + 1) + '">' + col[1] + '</div>').join('') + '</div>' +
  jobs.map(job => '<div role="row">' + columns.map((col, index) => '<div role="gridcell" aria-colindex="' + (index + 1) + '">' + job[col[0]] + '</div>').join('') + '</div>').join('') + '</div></main>';
const footer = (page, disabled = '', totalPages = 4) => '<div class="hc-paging"><div class="paging-box">' +
  '<span>第</span><input type="number" ng-model="paging.current_page" value="' + page + '"><span>页</span>' +
  '<div class="icon-box ' + disabled + '" ng-click="onPagingClick(\'next\')"><div class="icon icon-hcm-arrow-right"></div></div>' +
  '<span>共' + totalPages + '页</span></div></div>';

let browser, context, page, markup = '', passed = 0;
const failures = [];
async function check(label, run) {
  try { await run(); passed++; console.log('PASS ' + label); }
  catch (error) { failures.push(label); console.error('FAIL ' + label + '\n' + error.stack); }
}
async function load(html, suffix = '/portal#/jobs?job_class=fictional') {
  markup = html;
  await page.goto('about:blank');
  await page.goto(ORIGIN + suffix);
  await page.addScriptTag({ path: path.join(ROOT, 'extension/jobs-page.js') });
}
async function scan(rule = {}, detailOnly = false) {
  return page.evaluate(({ rule, detailOnly }) => JobScreenPage.scanDocument(document, location.href, rule, detailOnly), { rule, detailOnly });
}

(async () => {
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true
  });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === ORIGIN
    ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: markup })
    : route.abort());
  page = await context.newPage();

  await check('plain div grid rows with empty fixed placeholders expose fictional jobs and field labels', async () => {
    await load(grid([record('A'), record('B')]));
    const result = await scan();
    assert.equal(result.kind, 'list'); assert.equal(result.jobs.length, 2);
    assert.deepEqual(result.jobs.map(job => job.name), ['虚构表格岗位A', '虚构表格岗位B']);
    assert.equal(result.jobs[0].company, '虚构单位A公司'); assert.equal(result.jobs[0].city, '测试市');
    assert.match(result.jobs[0].requirements, /本科及以上/);
    assert.match(result.jobs[0].requirements, /无经验要求/);
    assert.equal(result.jobs[0].linkKind, 'list');
  });

  await check('nonempty fixed and flex panels merge by row and column keys without duplicate jobs', async () => {
    await load(grid([record('A'), record('B')], { fixed: ['name', 'company'] }));
    const result = await scan(); assert.equal(result.jobs.length, 2);
    assert.deepEqual(result.jobs.map(job => [job.name, job.company, job.city]), [
      ['虚构表格岗位A', '虚构单位A公司', '测试市'], ['虚构表格岗位B', '虚构单位B公司', '测试市']
    ]);
    assert.ok(result.jobs.every(job => /本科及以上/.test(job.requirements)));
  });

  await check('delegated title click target works without href or inline event attributes', async () => {
    await load(grid([record('A')]));
    await page.evaluate(() => {
      globalThis.clickedTitle = '';
      document.querySelector('.flex-content').addEventListener('click', event => {
        const row = event.target.closest('.table-row');
        if (row) globalThis.clickedTitle = row.querySelector('[col-key="name"]').textContent.trim();
      });
    });
    const result = await scan(), job = result.jobs[0]; assert.ok(job?.titleSelector);
    const target = await page.evaluate(selector => {
      const node = document.querySelector(selector);
      return { exists: Boolean(node), text: node?.textContent.trim(), href: node?.getAttribute('href'), onclick: node?.getAttribute('onclick') };
    }, job.titleSelector);
    assert.equal(target.exists, true); assert.ok(target.text.includes(job.name));
    assert.equal(target.href, null); assert.equal(target.onclick, null);
    await page.locator(job.titleSelector).click();
    assert.equal(await page.evaluate(() => clickedTitle), job.name);
  });

  await check('native HTML tables map job names and metadata using column headers', async () => {
    await load(nativeTable([record('原生A'), record('原生B', { degree: '硕士及以上' })]));
    const result = await scan(); assert.equal(result.jobs.length, 2);
    assert.equal(result.jobs[0].name, '虚构表格岗位原生A');
    assert.equal(result.jobs[1].company, '虚构单位原生B公司');
    assert.match(result.jobs[1].requirements, /硕士及以上/);
  });

  await check('mixed linked and plain job titles retain every table row without duplicating the linked job', async () => {
    const linked = record('混合链接'), plain = record('混合纯文本', { degree: '硕士及以上' });
    const html = nativeTable([linked, plain]).replace('<div>' + linked.name + '</div>',
      '<a href="/detail?jobId=fictional-mixed-a">' + linked.name + '</a>');
    await load(html);
    const result = await scan(); assert.equal(result.jobs.length, 2);
    assert.equal(new Set(result.jobs.map(job => job.id)).size, 2);
    assert.deepEqual(result.jobs.map(job => job.name).sort(), [linked.name, plain.name].sort());
    const linkedJob = result.jobs.find(job => job.name === linked.name), plainJob = result.jobs.find(job => job.name === plain.name);
    assert.equal(linkedJob.url, ORIGIN + '/detail?jobId=fictional-mixed-a');
    assert.equal(linkedJob.company, linked.company); assert.equal(plainJob.company, plain.company);
    assert.match(plainJob.requirements, /硕士及以上/);
  });

  await check('ARIA grids map columnheader and gridcell values using aria-colindex', async () => {
    await load(ariaGrid([record('ARIA-A'), record('ARIA-B', { city: '虚构市' })]));
    const result = await scan(); assert.equal(result.jobs.length, 2);
    assert.equal(result.jobs[1].name, '虚构表格岗位ARIA-B'); assert.equal(result.jobs[1].city, '虚构市');
    assert.match(result.jobs[0].requirements, /本科及以上/);
  });

  await check('unkeyed column headers still map keyed grid cells by their visible column positions', async () => {
    const job = record('单侧列键');
    await load('<main><div role="grid"><div role="row">' + columns.map(col =>
      '<div role="columnheader">' + col[1] + '</div>').join('') + '</div><div role="row">' + columns.map(col =>
      '<div role="gridcell" data-field="' + col[0] + '">' + job[col[0]] + '</div>').join('') + '</div></div></main>');
    const result = await scan(); assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].name, job.name); assert.equal(result.jobs[0].company, job.company);
    assert.equal(result.jobs[0].city, job.city);
    assert.match(result.jobs[0].requirements, /本科及以上/); assert.match(result.jobs[0].requirements, /无经验要求/);
  });

  await check('ordinary inventory tables do not become job lists from company and count columns', async () => {
    await load('<main><table><thead><tr><th>名称</th><th>公司名称</th><th>数量</th><th>日期</th></tr></thead><tbody><tr><td>虚构材料A</td><td>虚构材料公司</td><td>2</td><td>2099-01-01</td></tr></tbody></table></main>');
    assert.equal((await scan()).jobs.length, 0);
  });

  await check('staff ARIA tables with education and city but no job-name column are excluded', async () => {
    await load('<main><div role="grid"><div role="row"><div role="columnheader">姓名</div><div role="columnheader">部门</div><div role="columnheader">学历</div><div role="columnheader">工作城市</div></div><div role="row"><div role="gridcell">虚构人员甲</div><div role="gridcell">虚构组织</div><div role="gridcell">本科</div><div role="gridcell">测试市</div></div></div></main>');
    assert.equal((await scan()).jobs.length, 0);
  });

  await check('display-none hidden and aria-hidden grid rows cannot introduce jobs', async () => {
    await load(grid([record('可见'), record('隐藏A'), record('隐藏B'), record('隐藏C')], {
      attrs: ['', 'style="display:none"', 'hidden', 'aria-hidden="true"']
    }));
    const result = await scan(); assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].name, '虚构表格岗位可见');
  });

  await check('matching job titles at different fictional companies retain distinct identities', async () => {
    await load(grid([record('A', { name: '虚构同名岗位' }), record('B', { name: '虚构同名岗位' })]));
    const result = await scan(); assert.equal(result.jobs.length, 2);
    assert.equal(new Set(result.jobs.map(job => job.id)).size, 2);
    assert.deepEqual(result.jobs.map(job => job.company), ['虚构单位A公司', '虚构单位B公司']);
  });

  await check('icon-only next is recognized and advance clicks its delegated control', async () => {
    await load(grid([record('A')], { total: 199, footer: footer(2) }));
    await page.evaluate(() => {
      globalThis.nextClicks = 0; globalThis.permitCalls = 0;
      document.querySelector('.hc-paging').addEventListener('click', event => {
        if (event.target.closest('[ng-click]')) {
          globalThis.nextClicks++;
          document.querySelector('input[type="number"]').value = '3';
        }
      });
    });
    const result = await scan(); assert.equal(result.next, true); assert.equal(result.nextKind, 'control');
    const advanced = await page.evaluate(() => JobScreenPage.advance({}, async () => { globalThis.permitCalls++; }));
    assert.equal(advanced, true);
    assert.deepEqual(await page.evaluate(() => [nextClicks, permitCalls]), [1, 1]);
    assert.equal((await scan()).pageNumber, 3);
  });

  await check('an application aria-label cannot masquerade as next-page navigation or be clicked by an explicit rule', async () => {
    const action = '<div class="pagination"><button id="fictional-apply-next" aria-label="下一步申请" ' +
      'ng-click="onPagingClick(\'next\')" onclick="globalThis.fixtureApplyClicks++"></button></div>';
    await load(grid([record('安全分页')], { footer: action }));
    await page.evaluate(() => { globalThis.fixtureApplyClicks = 0; globalThis.fixturePermitCalls = 0; });
    const result = await scan(); assert.equal(result.next, false); assert.notEqual(result.nextKind, 'control');
    const attempts = await page.evaluate(async () => {
      const permit = async () => { globalThis.fixturePermitCalls++; };
      const rejected = [];
      for (const rule of [{}, { next: '#fictional-apply-next' }]) {
        try { await JobScreenPage.advance(rule, permit); rejected.push(false); }
        catch { rejected.push(true); }
      }
      return { rejected, clicks: fixtureApplyClicks, permits: fixturePermitCalls };
    });
    assert.deepEqual(attempts, { rejected: [true, true], clicks: 0, permits: 0 });
  });

  await check('singular disable class prevents an icon-only last-page click and advance rejects', async () => {
    await load(grid([record('A')], { footer: footer(4, 'disable') }));
    const result = await scan(); assert.equal(result.next, false); assert.notEqual(result.nextKind, 'control');
    await assert.rejects(page.evaluate(() => JobScreenPage.advance()), /下一页/);
  });

  await check('a disabled last-page control never falls back to scrolling when the total exceeds this page size', async () => {
    await load(grid([record('末页A'), record('末页B')], { total: 8, footer: footer(4, 'disable', 4) }));
    await page.evaluate(() => {
      globalThis.fixtureLastPage = { scrolls: 0, clicks: 0, permits: 0 };
      window.scrollTo = () => { fixtureLastPage.scrolls++; };
      Element.prototype.scrollIntoView = () => { fixtureLastPage.scrolls++; };
      document.querySelector('.hc-paging').addEventListener('click', () => { fixtureLastPage.clicks++; });
    });
    const result = await scan(); assert.equal(result.total, 8); assert.equal(result.jobs.length, 2);
    assert.equal(result.pageNumber, 4); assert.equal(result.totalPages, 4);
    assert.equal(result.next, false); assert.notEqual(result.nextKind, 'scroll');
    await assert.rejects(page.evaluate(() => JobScreenPage.advance({}, async () => { fixtureLastPage.permits++; })), /下一页/);
    assert.deepEqual(await page.evaluate(() => fixtureLastPage), { scrolls: 0, clicks: 0, permits: 0 });
  });

  await check('aria-disabled also blocks icon-only pagination', async () => {
    await load(grid([record('A')], { footer: footer(4).replace('class="icon-box "', 'aria-disabled="true" class="icon-box "') }));
    assert.equal((await scan()).next, false);
  });

  await check('numeric current-page input supplies the page number', async () => {
    await load(grid([record('A')], { footer: footer(7, 'disable', 7) }));
    const result = await scan(); assert.equal(result.pageNumber, 7); assert.equal(result.totalPages, 7);
  });

  await check('parenthesized recruitment-position count supplies the total without a prefix 共', async () => {
    await load(grid([record('A')], { total: 199 }));
    assert.equal((await scan()).total, 199);
  });

  const detail = '<div class="detail-shell"><div class="portal-job-title"><div class="portal-job-title-bold"><span>虚构分栏详情岗位</span><span class="title-nav-border">/</span><span>虚构岗位类别</span><span class="title-nav-border">/</span><span>虚构研发组织</span></div><div class="portal-job-info"><span class="job-detail-tip">测试市</span><span class="job-detail-tip">校园招聘</span><span class="job-detail-tip">本科及以上</span></div></div><div class="job-detail-content"><div class="hc-form-field"><div class="hc-form-label">专业要求</div><div class="hc-form-control"><span class="text">虚构信息学、虚构工程学</span></div></div><div class="hc-form-group"><div class="title"><span class="label">任职要求</span></div><div class="content"><p>具有良好的虚构项目沟通能力。</p></div></div><div class="hc-form-group"><div class="title"><span class="label">工作职责</span></div><div class="content"><p>完成虚构研发任务。</p></div></div></div></div>';

  await check('hyphenated job title is read separately from category and department decoration', async () => {
    await load(detail, '/portal#/detail?id=fictional-job-a');
    const result = await scan({}, true); assert.equal(result.jobs.length, 1);
    const job = result.jobs[0];
    assert.deepEqual({ name: job.name, city: job.city, degree: /本科及以上/.test(job.requirements), major: /虚构信息学、虚构工程学/.test(job.requirements) },
      { name: '虚构分栏详情岗位', city: '测试市', degree: true, major: true });
  });

  await check('a selected qualification body merges visible header education city and title', async () => {
    await load(detail, '/portal#/detail?id=fictional-job-a');
    const result = await scan({ area: '.job-detail-content' }, true); assert.equal(result.jobs.length, 1);
    const job = result.jobs[0];
    assert.deepEqual({ name: job.name, city: job.city, degree: /本科及以上/.test(job.requirements), major: /虚构信息学、虚构工程学/.test(job.requirements), duties: /完成虚构研发任务/.test(job.description) },
      { name: '虚构分栏详情岗位', city: '测试市', degree: true, major: true, duties: true });
  });

  await check('a plain div detail title and rich field contents preserve every qualification branch and extra condition', async () => {
    const professional = [
      '本科：虚构信息学、虚构工程学等相关专业。',
      '硕士及以上：虚构智能系统、虚构自动化等相关专业。',
      '其他要求：具有虚构交叉项目经历者，须提供完整课程说明。'
    ];
    const requirements = ['具备严谨的虚构项目记录习惯。', '能够清晰说明虚构方案的验证过程。'];
    const duties = '负责虚构研发项目，编写并维护技术资料。';
    const html = '<div class="job-detail-view"><div class="top-banner"><div class="name">虚构通用研发岗位</div>' +
      '<div class="content">虚构技术类别</div><div class="company-name">虚构科研公司</div>' +
      '<div>工作地点：测试市</div><div>本科及以上</div></div><div class="detail-body">' +
      '<div class="field"><div class="field-label">专业要求</div><div class="field-content">' +
      professional.map(value => '<p>' + value.replace(/^([^：]+：)/, '<strong>$1</strong>') + '</p>').join('') + '</div></div>' +
      '<div class="field"><div class="field-label">任职要求</div><div class="field-content">' +
      requirements.map(value => '<p>' + value + '</p>').join('') + '</div></div>' +
      '<div class="field"><div class="field-label">工作职责</div><div class="field-content"><p>' + duties + '</p></div></div>' +
      '</div></div>';
    await load(html, '/portal#/detail?id=fictional-rich-qualification');
    for (const rule of [{}, { area: '.detail-body' }]) {
      const result = await scan(rule, true); assert.equal(result.kind, 'detail'); assert.equal(result.jobs.length, 1);
      const job = result.jobs[0]; assert.equal(job.name, '虚构通用研发岗位');
      assert.equal(job.company, '虚构科研公司'); assert.equal(job.city, '测试市');
      assert.match(job.requirements, /本科及以上/);
      for (const value of professional) { assert.ok(job.majorRequirements.includes(value)); assert.ok(job.requirements.includes(value)); }
      for (const value of requirements) assert.ok(job.requirements.includes(value));
      assert.ok(job.description.includes(duties));
    }
  });

  console.log('Compatibility checks passed: ' + passed + '; failed: ' + failures.length);
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await context?.close(); await browser?.close();
});
