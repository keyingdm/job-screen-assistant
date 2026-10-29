'use strict';

// Fictional company directories and job cards. Every request is fulfilled locally.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'https://example.invalid';
const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const job = (id, extra = {}) => ({ id, name: '虚构图片岗位' + id, degree: '本科及以上', city: '测试市', ...extra });
const imageLink = (href, className = 'apply') => '<a class="' + className + '" href="' + href + '"><img src="' + pixel + '" alt=""></a>';
const card = (record, extraLinks = '') => '<div class="job-item"><div class="jobname">' + record.name + '</div><div class="degree">' + record.degree + '</div><div class="city">' + record.city + '</div>' +
  extraLinks + imageLink(record.href ?? 'job-detail.html?jobid=' + encodeURIComponent(record.id)) + '</div>';
const pager = (page, max = 3) => '<div class="posts-nav"><div class="pre">&lt;</div><div class="page-click">' +
  Array.from({ length: max }, (_, index) => '<div' + (index + 1 === page ? ' class="active"' : '') + '>' + (index + 1) + '</div>').join('') +
  '</div><div class="next">&gt;</div><input type="text" name="page" value="' + page + '"></div>';
const filters = '<div class="job-search"><select name="city"><option value="all">全部城市</option><option value="city-a">虚构城市甲</option><option value="city-b">虚构城市乙</option></select><select name="degree"><option value="all">全部学历</option><option value="bachelor">本科</option><option value="master">硕士</option></select></div>';
const list = (records, options = {}) => '<main>' + (options.heading === false ? '' : '<h1>' + (options.heading || '虚构星图科技有限公司') + '</h1>') +
  (options.filters ? filters : '') + '<div>共' + (options.total ?? records.length) + '条</div><div class="job-list">' +
  records.map(record => card(record, options.extraLinks || '')).join('') + '</div>' + (options.page ? pager(options.page, options.max || 3) : '') + '</main>';
const directory = '<main><h1>虚构招聘单位目录</h1><div class="company-directory">' +
  ['虚构星图科技有限公司', '虚构重点实验室'].map(name => '<div class="item"><p>' + name + '</p><span>查看详情&gt;&gt;</span></div>').join('') + '</div></main>';

let browser, context, page, markup = '', passed = 0;
const failures = [];
async function check(label, run) {
  try { await run(); passed++; console.log('通过：' + label); }
  catch (error) { failures.push(label); console.error('失败：' + label + '\n' + error.stack); }
}
async function load(html, suffix = '/fictional/jobs.html') {
  markup = html;
  await page.goto('about:blank');
  await page.goto(ORIGIN + suffix);
  await page.addScriptTag({ path: path.join(ROOT, 'extension/jobs-page.js') });
}
const scan = () => page.evaluate(() => JobScreenPage.scanDocument(document, location.href));

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

  await check('图片详情入口与岗位标题为兄弟元素时仍识别真实详情地址', async () => {
    await load(list([job('image-a'), job('image-b')]));
    const result = await scan(); assert.equal(result.kind, 'list'); assert.equal(result.jobs.length, 2);
    assert.deepEqual(result.jobs.map(record => record.url), [ORIGIN + '/fictional/job-detail.html?jobid=image-a', ORIGIN + '/fictional/job-detail.html?jobid=image-b']);
    assert.ok(result.jobs.every(record => record.linkKind === 'detail'));
    assert.ok(result.jobs.every(record => !record.titleSelector));
  });

  await check('真实详情地址不会仅因图片链接名为apply就被排除', async () => {
    await load(list([job('actual-detail')]));
    assert.equal(await page.locator('a.apply').textContent(), '');
    const result = await scan(); assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].url, ORIGIN + '/fictional/job-detail.html?jobid=actual-detail');
    assert.equal(result.jobs[0].linkKind, 'detail');
  });

  for (const [label, href] of [
    ['申请提交', 'apply.html?jobid=unsafe-a'],
    ['登录', 'login.html?jobid=unsafe-a'],
    ['hash申请', '/portal#/apply?jobId=unsafe-a'],
    ['hash登录', '/portal#/login?jobId=unsafe-a'],
    ['脚本', 'javascript:void(0)']
  ]) await check('真正的' + label + '图片链接不会被当作岗位详情', async () => {
    await load(list([job('unsafe-a', { href })]));
    const result = await scan(); assert.equal(result.jobs.length, 1);
    const record = result.jobs[0]; assert.equal(record.linkKind, 'list');
    assert.equal(record.url, ORIGIN + '/fictional/jobs.html');
    assert.ok(record.titleSelector);
    const target = await page.evaluate(selector => {
      const el = document.querySelector(selector); return { tag: el?.tagName, text: el?.textContent.trim() };
    }, record.titleSelector);
    assert.equal(target.text, record.name); assert.notEqual(target.tag, 'A');
  });

  await check('多个兄弟图片链接中选择详情而不是前面的登录或申请入口', async () => {
    await load(list([job('mixed-a')], { extraLinks: imageLink('login.html?jobid=mixed-a', 'login') + imageLink('apply.html?jobid=mixed-a', 'submit') }));
    const result = await scan(); assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].url, ORIGIN + '/fictional/job-detail.html?jobid=mixed-a');
    assert.equal(result.jobs[0].linkKind, 'detail');
  });

  await check('被过滤申请地址的ARIA标题单元格不会重新成为点击入口', async () => {
    for (const href of ['/apply.html?jobId=fictional-grid', '/portal#/apply?jobId=fictional-grid']) {
      await load('<main><div role="grid"><div role="row"><div role="columnheader">职位名称</div><div role="columnheader">学历要求</div></div>' +
        '<div role="row"><a role="gridcell" href="' + href + '">虚构网格岗位</a><div role="gridcell">本科</div></div></div></main>');
      const result = await scan(); assert.equal(result.jobs.length, 1);
      const record = result.jobs[0]; assert.equal(record.name, '虚构网格岗位');
      assert.equal(record.linkKind, 'list'); assert.equal(record.url, ORIGIN + '/fictional/jobs.html');
      assert.ok(!record.titleSelector, '已确认是申请链接的源控件不应再被resolve点击');
    }
  });

  await check('学历城市与唯一公司标题分别归属各岗位且公司名不变成岗位', async () => {
    await load(list([job('meta-a'), job('meta-b', { degree: '硕士及以上', city: '虚构市' })]));
    const result = await scan(); assert.equal(result.jobs.length, 2);
    assert.deepEqual(result.jobs.map(record => record.name), ['虚构图片岗位meta-a', '虚构图片岗位meta-b']);
    assert.ok(result.jobs.every(record => record.company === '虚构星图科技有限公司'));
    assert.deepEqual(result.jobs.map(record => record.city), ['测试市', '虚构市']);
    assert.match(result.jobs[0].requirements, /本科及以上/); assert.match(result.jobs[1].requirements, /硕士及以上/);
  });

  await check('普通岗位列表标题不会被臆断为公司', async () => {
    await load(list([job('generic-a'), job('generic-b')], { heading: '岗位列表' }));
    const result = await scan(); assert.equal(result.jobs.length, 2);
    assert.ok(result.jobs.every(record => record.company === ''));
  });

  await check('纯DIV分页识别当前页和最大数字页并可推进下一页', async () => {
    await load(list([job('page-1-a')], { total: 23, page: 1, max: 3 }));
    await page.evaluate(() => {
      globalThis.nextClicks = 0; globalThis.permitCalls = 0;
      document.querySelector('.posts-nav').addEventListener('click', event => {
        if (!event.target.closest('.next')) return;
        globalThis.nextClicks++;
        const active = document.querySelector('.page-click .active'); active.classList.remove('active'); active.nextElementSibling.classList.add('active');
        document.querySelector('.posts-nav input').value = '2';
      });
    });
    const result = await scan(); assert.equal(result.pageNumber, 1); assert.equal(result.totalPages, 3);
    assert.equal(result.next, true); assert.equal(result.nextKind, 'control'); assert.equal(result.total, 23);
    assert.equal(await page.evaluate(() => JobScreenPage.advance({}, async () => { permitCalls++; })), true);
    assert.deepEqual(await page.evaluate(() => [nextClicks, permitCalls]), [1, 1]);
    assert.equal((await scan()).pageNumber, 2);
  });

  await check('中间页active数字优先于未更新的页码输入', async () => {
    await load(list([job('page-2-a')], { total: 23, page: 2, max: 3 }));
    await page.locator('.posts-nav input').fill('1');
    const result = await scan(); assert.equal(result.pageNumber, 2); assert.equal(result.totalPages, 3); assert.equal(result.next, true);
  });

  await check('末页仍保留未标disabled的next时根据页码推断结束并拒绝点击', async () => {
    await load(list([job('last-a'), job('last-b'), job('last-c')], { total: 23, page: 3, max: 3 }));
    await page.evaluate(() => {
      globalThis.nextClicks = 0;
      document.querySelector('.next').addEventListener('click', () => { nextClicks++; });
    });
    const result = await scan(); assert.equal(result.pageNumber, 3); assert.equal(result.totalPages, 3);
    assert.equal(result.next, false); assert.notEqual(result.nextKind, 'scroll');
    await assert.rejects(page.evaluate(() => JobScreenPage.advance()), /下一页/);
    assert.equal(await page.evaluate(() => nextClicks), 0);
  });

  await check('单页数字分页也不会因next外观仍在就循环翻页', async () => {
    await load(list([job('one-page')], { total: 1, page: 1, max: 1 }));
    const result = await scan(); assert.equal(result.pageNumber, 1); assert.equal(result.totalPages, 1); assert.equal(result.next, false);
  });

  await check('明确总页数大于当前数字窗口时仍允许下一页', async () => {
    await load(list([job('window-a')], { total: 100, page: 3, max: 3 }));
    await page.locator('.posts-nav').evaluate(el => {
      el.insertAdjacentHTML('beforeend', '<span>共10页</span>');
      globalThis.windowNextClicks = 0;
      el.querySelector('.next').addEventListener('click', () => { windowNextClicks++; });
    });
    const result = await scan(); assert.equal(result.pageNumber, 3); assert.equal(result.totalPages, 10);
    assert.equal(result.next, true); assert.equal(result.nextKind, 'control');
    assert.equal(await page.evaluate(() => JobScreenPage.advance()), true);
    assert.equal(await page.evaluate(() => windowNextClicks), 1);
  });

  await check('连续数字前缀窗口按总条数与当前每页数判断后续分页', async () => {
    await load(list([job('prefix-window-a')], { total: 23, page: 2, max: 2 }));
    await page.locator('.posts-nav').evaluate(el => {
      el.insertAdjacentHTML('beforeend', '<span>共23条</span><select name="pageSize" aria-label="每页条数"><option value="10" selected>10条/页</option><option value="20">20条/页</option></select>');
      globalThis.prefixNextClicks = 0;
      el.querySelector('.next').addEventListener('click', () => { prefixNextClicks++; });
    });
    const result = await scan(); assert.equal(result.total, 23); assert.equal(result.pageNumber, 2); assert.equal(result.totalPages, 3);
    assert.equal(result.next, true); assert.equal(result.nextKind, 'control');
    assert.equal(await page.evaluate(() => JobScreenPage.advance()), true);
    assert.equal(await page.evaluate(() => prefixNextClicks), 1);
  });

  await check('非form搜索容器内select的城市和学历变化均改变scope', async () => {
    await load(list([job('filter-a')], { filters: true, total: 23, page: 1 }));
    assert.equal(await page.locator('form').count(), 0);
    const first = await scan();
    await page.locator('.job-search select[name="city"]').selectOption('city-a'); const cityA = await scan();
    await page.locator('.job-search select[name="city"]').selectOption('city-b'); const cityB = await scan();
    await page.locator('.job-search select[name="degree"]').selectOption('master'); const degree = await scan();
    assert.notEqual(first.scopeURL, cityA.scopeURL); assert.notEqual(cityA.scopeURL, cityB.scopeURL); assert.notEqual(cityB.scopeURL, degree.scopeURL);
    assert.ok(degree.scopeURL.includes('city-b')); assert.ok(degree.scopeURL.includes('master'));
    assert.equal(degree.jobs.length, 1); assert.equal(degree.jobs[0].name, '虚构图片岗位filter-a');
  });

  await check('分页容器中的输入页码变化不是筛选范围变化', async () => {
    await load(list([job('scope-a')], { filters: true, total: 23, page: 1 }));
    await page.locator('.job-search select[name="city"]').selectOption('city-a');
    const before = await scan();
    await page.locator('.posts-nav input').fill('3');
    const after = await scan(); assert.equal(after.scopeURL, before.scopeURL);
    assert.ok(after.scopeURL.includes('city-a')); assert.ok(!new URL(after.scopeURL).searchParams.has('page'));
  });

  await check('非form筛选中的同名复选框组合各自形成不同scope', async () => {
    await load(list([job('checkbox-scope')]));
    await page.locator('main').evaluate(el => el.insertAdjacentHTML('afterbegin',
      '<div class="job-filter"><label><input type="checkbox" name="city" value="city-a" checked>虚构城市甲</label>' +
      '<label><input type="checkbox" name="city" value="city-b" checked>虚构城市乙</label></div>'));
    const both = (await scan()).scopeURL;
    await page.locator('input[value="city-a"]').uncheck(); const onlyB = (await scan()).scopeURL;
    await page.locator('input[value="city-a"]').check(); await page.locator('input[value="city-b"]').uncheck(); const onlyA = (await scan()).scopeURL;
    await page.locator('input[value="city-a"]').uncheck(); const none = (await scan()).scopeURL;
    assert.equal(new Set([both, onlyB, onlyA, none]).size, 4);
    assert.equal((await scan()).jobs.length, 1);
  });

  await check('筛选选项和页码数字不会增加岗位数量', async () => {
    await load(list([job('clean-a'), job('clean-b')], { filters: true, total: 23, page: 2 }));
    const result = await scan(); assert.equal(result.jobs.length, 2);
    assert.deepEqual(result.jobs.map(record => record.name), ['虚构图片岗位clean-a', '虚构图片岗位clean-b']);
  });

  await check('同一图片详情岗位跨跟踪参数变化保持相同身份', async () => {
    await load(list([job('tracking-a', { href: 'job-detail.html?jobid=tracking-a&utm_source=fictional' })]));
    const first = (await scan()).jobs[0];
    await page.locator('.job-item a').evaluate(el => { el.href = 'job-detail.html?ref=fictional&jobid=tracking-a'; });
    const second = (await scan()).jobs[0]; assert.equal(first.id, second.id); assert.equal(second.linkKind, 'detail');
  });

  await check('公司目录返回明确目录类型和入口而不是虚构岗位', async () => {
    await load(directory, '/fictional/companies.html');
    const result = await scan(); assert.equal(result.kind, 'directory'); assert.equal(result.jobs.length, 0);
    assert.equal(result.total, null); assert.equal(result.next, false);
    assert.equal(result.entries.length, 2);
    assert.deepEqual(result.entries.map(entry => entry.name), ['虚构星图科技有限公司', '虚构重点实验室']);
    assert.ok(result.entries.every(entry => entry.url || entry.selector));
  });

  await check('手动指定公司和实验室标题仍返回目录而不是岗位', async () => {
    await load(directory, '/fictional/companies.html');
    const result = await page.evaluate(() => JobScreenPage.scanDocument(document, location.href, { title: '.company-directory .item p' }));
    assert.equal(result.kind, 'directory'); assert.equal(result.jobs.length, 0); assert.equal(result.total, null); assert.equal(result.next, false);
    assert.deepEqual(result.entries.map(entry => entry.name), ['虚构星图科技有限公司', '虚构重点实验室']);
  });

  await check('collector遇目录时明确提示先进入公司岗位页且不翻页或读详情', async () => {
    await load(directory, '/fictional/companies.html');
    for (const file of ['jobs-core.js', 'jobs-access.js', 'jobs-collector.js']) await page.addScriptTag({ path: path.join(ROOT, 'extension', file) });
    const result = await page.evaluate(async () => {
      const source = JobScreenPage.scanDocument(document, location.href), session = JobScreenCollector.session(location.href);
      let nextCalls = 0, detailCalls = 0, resolveCalls = 0, message = '';
      try {
        await JobScreenCollector.collect({ session, read: async () => source,
          next: async () => { nextCalls++; throw Error('虚构测试不应翻页'); },
          resolveLink: async () => { resolveCalls++; throw Error('虚构测试不应解析岗位'); },
          readDetail: async () => { detailCalls++; throw Error('虚构测试不应读详情'); }, delay: 0 });
      } catch (error) { message = error.message; }
      return { message, nextCalls, detailCalls, resolveCalls, count: session.jobs.length, complete: session.complete };
    });
    assert.match(result.message, /(?:公司|单位).*目录/); assert.match(result.message, /(?:先|请).*(?:打开|进入).*(?:公司|岗位)/);
    assert.deepEqual([result.nextCalls, result.detailCalls, result.resolveCalls, result.count, result.complete], [0, 0, 0, 0, false]);
  });

  console.log('图片详情与目录验收：通过 ' + passed + ' 项，失败 ' + failures.length + ' 项。');
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await context?.close(); await browser?.close();
});
