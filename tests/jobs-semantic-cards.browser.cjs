'use strict';

// Fictional DOM fixtures: no portal snapshots, real companies, accounts or requests.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'https://example.invalid';
const record = (suffix, extra = {}) => ({
  name: '虚构字段岗位' + suffix, company: '虚构总部有限公司', subunit: '虚构下属甲公司',
  department: '虚构研发部', city: '测试市', degree: '本科及以上',
  major: '虚构信息学、虚构工程学', applicants: 19, ...extra
});
const card = (job, attrs = '') => '<div class="tile_abc" ' + attrs + '>' +
  '<div class="row-top"><span class="caption_7">' + job.name + '</span><div class="operations"><button>申 请</button><button>收 藏</button></div></div>' +
  '<div class="region">' + job.city + '</div><div class="summary_m">2099届 | 全职 | ' + job.degree + ' | 经验不限</div>' +
  '<div class="line_c2"><span>招聘单位：</span><span>' + [job.company, job.subunit, job.department].join(' | ') + '</span></div>' +
  '<div class="line_c2"><span>专业要求：</span><span>' + job.major + '</span></div>' +
  '<div class="line_c2"><span>申请人数：</span><span>' + job.applicants + '人</span></div></div>';
const listing = (jobs, total = jobs.length, options = {}) => '<main><h1>虚构招聘岗位列表</h1><div id="fictional-total">共' + total + '个岗位</div>' +
  '<div class="tiles-wrap"' + (options.busy ? ' aria-busy="true"' : '') + '>' + jobs.map(job => card(job)).join('') + '</div></main>';
const loading = '<main><h1>虚构招聘岗位列表</h1><div id="fictional-total">共0个岗位</div><div class="tiles-wrap" aria-busy="true"><div role="progressbar" aria-label="正在加载岗位">正在加载岗位</div></div></main>';
const preferredDetail = '<main><div class="job-name">虚构优选专业岗位</div><div class="metadata"><p>学历要求：本科及以上</p><p>工作地点：测试市</p></div>' +
  '<section class="posting-copy"><div class="section-head"><span>优选专业</span></div><div class="section-copy"><p>虚构信息学、虚构工程学</p></div></section></main>';
const separateDetail = '<main><div class="detail-layout"><div class="intro"><div class="position-name"><span>虚构图景分析岗位</span><span class="salary">15K-25K</span></div><p>学历要求：硕士及以上</p><p>工作地点：虚构市</p></div>' +
  '<section class="posting-copy"><div class="heading-wrap"><h2>任职要求</h2></div><div class="prose-body"><p>具备虚构系统设计能力。</p><p>虚构信息学相关专业。</p></div></section>' +
  '<section class="employer-panel"><h2>公司介绍</h2><div class="company-name">虚构云舟技术有限公司</div><p>从事虚构技术研发。</p></section></div></main>';

let browser, context, page, markup = '', passed = 0;
const failures = [];
async function check(label, run) {
  try { await run(); passed++; console.log('通过：' + label); }
  catch (error) { failures.push(label); console.error('失败：' + label + '\n' + error.stack); }
}
async function load(html, suffix = '/fictional/positions') {
  markup = html;
  await page.goto('about:blank'); await page.goto(ORIGIN + suffix);
  await page.addScriptTag({ path: path.join(ROOT, 'extension/jobs-page.js') });
}
async function scan(rule = {}, detailOnly = false) {
  return page.evaluate(({ rule, detailOnly }) => JobScreenPage.scanDocument(document, location.href, rule, detailOnly), { rule, detailOnly });
}
async function addCollector() {
  for (const file of ['jobs-major-data.js', 'jobs-majors.js', 'jobs-core.js', 'jobs-access.js', 'jobs-collector.js']) await page.addScriptTag({ path: path.join(ROOT, 'extension', file) });
  await page.evaluate(() => { if (!globalThis.JobScreen?.normalize) throw Error('虚构测试依赖初始化失败'); });
}

(async () => {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === ORIGIN
    ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: markup }) : route.abort());
  page = await context.newPage();

  await check('无标题属性和链接的重复字段卡片可发现20个岗位', async () => {
    const jobs = Array.from({ length: 20 }, (_, index) => record(String(index + 1)));
    await load(listing(jobs, 368));
    const result = await scan(); assert.equal(result.kind, 'list'); assert.equal(result.jobs.length, 20); assert.equal(result.total, 368);
    assert.deepEqual(result.jobs.map(job => job.name), jobs.map(job => job.name));
    assert.ok(result.jobs.every(job => job.identityKind === 'text' && job.linkKind === 'list' && job.titleSelector));
  });

  await check('字段卡片保留城市管道摘要学历和专业内容', async () => {
    await load(listing([record('甲'), record('乙', { city: '虚构市', degree: '硕士及以上', major: '虚构测绘学' })]));
    const result = await scan(); assert.equal(result.jobs.length, 2);
    assert.deepEqual(result.jobs.map(job => job.city), ['测试市', '虚构市']);
    assert.match(result.jobs[0].requirements, /本科及以上/); assert.match(result.jobs[1].requirements, /硕士及以上/);
    assert.match(result.jobs[0].majorRequirements + '\n' + result.jobs[0].requirements, /虚构信息学、虚构工程学/);
    assert.match(result.jobs[1].majorRequirements + '\n' + result.jobs[1].requirements, /虚构测绘学/);
    assert.ok(result.jobs.every(job => !/申请人数|申\s*请|收\s*藏/.test(job.name)));
  });

  await check('同名岗位在不同下属公司保留两条且可辨认单位', async () => {
    await load(listing([record('甲', { name: '虚构同名设计岗位' }), record('乙', { name: '虚构同名设计岗位', subunit: '虚构下属乙公司' })]));
    const result = await scan(); assert.equal(result.jobs.length, 2); assert.equal(new Set(result.jobs.map(job => job.id)).size, 2);
    assert.match(result.jobs[0].company, /虚构下属甲公司/); assert.match(result.jobs[1].company, /虚构下属乙公司/);
    assert.ok(result.jobs.every(job => !/专业要求|申请人数/.test(job.company)));
  });

  await check('同页文字完全相同的无链接卡片先保留独立候选和选择器', async () => {
    const identical = record('完全相同');
    await load(listing([identical, identical]));
    const result = await scan(); assert.equal(result.jobs.length, 2);
    assert.equal(new Set(result.jobs.map(job => job.id)).size, 2);
    assert.equal(new Set(result.jobs.map(job => job.titleSelector)).size, 2);
    assert.ok(result.jobs.every(job => job.identityKind === 'text' && job.linkKind === 'list'));
    for (const job of result.jobs) {
      const target = page.locator(job.titleSelector); assert.equal(await target.count(), 1);
      assert.equal((await target.textContent()).trim(), identical.name);
    }
  });

  await check('完全相同候选解析同一详情时合并不同详情时保留两条', async () => {
    const identical = record('完全相同');
    for (const distinct of [false, true]) {
      await load(listing([identical, identical])); await addCollector();
      const result = await page.evaluate(async distinct => {
        const source = JobScreenPage.scanDocument(document, location.href), session = JobScreenCollector.session(location.href);
        const resolvedSelectors = [], detailURLs = [];
        await JobScreenCollector.collect({ session, read: async () => source,
          next: async () => { throw Error('虚构单页不应翻页'); },
          resolveLink: async selector => {
            resolvedSelectors.push(selector);
            return 'https://example.invalid/fictional/detail?jobId=' + (distinct ? resolvedSelectors.length : 1);
          },
          readDetail: async url => {
            detailURLs.push(url);
            return { requirements: '本科及以上，专业不限。', completeness: 'detail', detailStatus: 'loaded' };
          }, delay: 0 });
        return { count: session.jobs.length, ids: session.jobs.map(job => job.id), urls: session.jobs.map(job => job.url), resolvedSelectors, detailURLs };
      }, distinct);
      const expected = distinct ? 2 : 1;
      assert.equal(result.count, expected); assert.equal(new Set(result.ids).size, expected);
      assert.equal(new Set(result.urls).size, expected); assert.equal(result.resolvedSelectors.length, 2);
      assert.equal(new Set(result.resolvedSelectors).size, 2); assert.equal(result.detailURLs.length, expected);
    }
  });

  await check('跨页相同文字候选仍逐个解析并按实际详情链接合并', async () => {
    const identical = record('跨页完全相同');
    const paged = number => listing([identical, identical], 4).replace('</main>',
      '<nav class="pagination"><span aria-current="page">' + number + '</span><button class="next"' + (number === 2 ? ' disabled' : '') + '>下一页</button></nav></main>');
    for (const distinct of [false, true]) {
      await load(paged(1)); await addCollector();
      const result = await page.evaluate(async ({ distinct, secondPage }) => {
        const session = JobScreenCollector.session(location.href), snapshots = [], resolutions = [], detailURLs = [];
        const read = async () => {
          const result = JobScreenPage.scanDocument(document, location.href);
          snapshots.push({ page: result.pageNumber, ids: result.jobs.map(job => job.id), signature: result.signature });
          return result;
        };
        let nextCalls = 0;
        await JobScreenCollector.collect({ session, read,
          next: async () => { nextCalls++; document.body.innerHTML = secondPage; return read(); },
          resolveLink: async (selector, job) => {
            const number = Number(document.querySelector('[aria-current=page]').textContent);
            resolutions.push({ page: number, selector, id: job.id });
            return 'https://example.invalid/fictional/detail?jobId=' + (distinct ? number : 1);
          },
          readDetail: async url => {
            detailURLs.push(url);
            return { requirements: '本科及以上，专业不限。', completeness: 'detail', detailStatus: 'loaded' };
          }, delay: 0 });
        return { count: session.jobs.length, ids: session.jobs.map(job => job.id), urls: session.jobs.map(job => job.url), snapshots, resolutions, detailURLs, nextCalls, pages: session.pages };
      }, { distinct, secondPage: paged(2) });
      const expected = distinct ? 2 : 1;
      assert.equal(result.count, expected); assert.equal(new Set(result.urls).size, expected); assert.equal(new Set(result.ids).size, expected);
      assert.equal(result.nextCalls, 1); assert.equal(result.pages, 2);
      assert.deepEqual(result.resolutions.map(item => item.page), [1, 1, 2, 2]);
      assert.equal(new Set(result.resolutions.map(item => item.id)).size, 4);
      assert.equal(new Set(result.snapshots.map(item => item.signature)).size, 2);
      assert.equal(result.detailURLs.length, expected);
    }
  });

  await check('申请人数变化不改变岗位身份或增加记录', async () => {
    await load(listing([record('甲'), record('乙')]));
    const before = await scan();
    await page.evaluate(() => {
      for (const card of document.querySelectorAll('.tile_abc')) card.lastElementChild.lastElementChild.textContent = '999人';
    });
    const after = await scan(); assert.equal(after.jobs.length, 2);
    assert.deepEqual(after.jobs.map(job => job.id), before.jobs.map(job => job.id));
    assert.equal(after.signature, before.signature);
  });

  await check('匿名标题前的急聘徽标不是岗位名或点击目标', async () => {
    const jobs = [record('徽标甲'), record('徽标乙')];
    await load(listing(jobs).replaceAll('<div class="row-top">', '<div class="row-top"><span class="badge">急聘</span>'));
    const result = await scan(); assert.equal(result.jobs.length, 2);
    assert.deepEqual(result.jobs.map(job => job.name), jobs.map(job => job.name));
    for (const job of result.jobs) {
      const target = await page.locator(job.titleSelector).textContent();
      assert.equal(target.trim(), job.name); assert.notEqual(target.trim(), '急聘');
    }
  });

  await check('委托点击命中纯岗位标题且不会触发申请或收藏', async () => {
    await load(listing([record('甲'), record('乙')]));
    await page.evaluate(() => {
      globalThis.titleClicks = 0; globalThis.applyClicks = 0; globalThis.favoriteClicks = 0;
      document.querySelector('.tiles-wrap').addEventListener('click', event => {
        const button = event.target.closest('button');
        if (button) {
          const action = button.textContent.replace(/\s/g, '');
          if (action === '申请') applyClicks++;
          if (action === '收藏') favoriteClicks++;
          return;
        }
        const title = event.target.closest('.caption_7');
        if (title) { titleClicks++; history.pushState({}, '', '#/fictional-detail/' + encodeURIComponent(title.textContent)); }
      });
    });
    const result = await scan(), job = result.jobs[0]; assert.ok(job?.titleSelector);
    const target = await page.evaluate(selector => {
      const el = document.querySelector(selector); return { text: el?.textContent.trim(), tag: el?.tagName, semanticAttrs: ['href', 'onclick', 'title', 'name', 'role'].map(key => el?.getAttribute(key)) };
    }, job.titleSelector);
    assert.equal(target.text, job.name); assert.equal(target.tag, 'SPAN'); assert.deepEqual(target.semanticAttrs, [null, null, null, null, null]);
    await page.locator(job.titleSelector).click();
    assert.deepEqual(await page.evaluate(() => [titleClicks, applyClicks, favoriteClicks]), [1, 0, 0]);
    assert.match(page.url(), /#\/fictional-detail\//);
  });

  await check('隐藏的同结构字段卡片不会混入结果', async () => {
    await load('<main><div>共2个岗位</div><div class="tiles-wrap">' + card(record('可见甲')) + card(record('可见乙')) + card(record('隐藏'), 'style="display:none"') + '</div></main>');
    const result = await scan(); assert.equal(result.jobs.length, 2); assert.deepEqual(result.jobs.map(job => job.name), ['虚构字段岗位可见甲', '虚构字段岗位可见乙']);
  });

  await check('筛选标签与公司专业选项不是岗位卡片', async () => {
    await load('<main><h1>筛选条件</h1><div class="filters"><div class="tile_abc"><span class="caption_7">招聘单位：</span><span>全部</span><span>虚构总部有限公司</span></div><div class="tile_abc"><span class="caption_7">专业要求：</span><span>全部</span><span>虚构信息学</span></div><div class="tile_abc"><span class="caption_7">学历要求：</span><span>本科</span><span>硕士</span></div></div></main>');
    assert.equal((await scan()).jobs.length, 0);
  });

  await check('公司目录保持目录类型并且公司名称不计作岗位', async () => {
    await load('<main><h1>虚构单位目录</h1><div class="directory">' + ['虚构星图有限公司', '虚构远航有限公司'].map(company => '<div class="item"><p>' + company + '</p><span>查看详情&gt;&gt;</span></div>').join('') + '</div></main>');
    const result = await scan(); assert.equal(result.kind, 'directory'); assert.equal(result.jobs.length, 0); assert.equal(result.entries.length, 2);
  });

  await check('普通商品卡片的名称厂家价格和地区不会被当作岗位', async () => {
    await load('<main><h1>虚构设备商品</h1><div class="tiles-wrap">' + ['甲', '乙'].map(suffix => '<div class="tile_abc"><div class="row-top"><span class="caption_7">虚构光学设备' + suffix + '</span><button>购 买</button><button>收 藏</button></div><div class="region">测试市</div><div class="summary_m">通用版本 | 199元</div><div class="line_c2"><span>生产单位：</span><span>虚构设备公司</span></div><div class="line_c2"><span>适用范围：</span><span>虚构测量实验</span></div></div>').join('') + '</div></main>');
    assert.equal((await scan()).jobs.length, 0);
  });

  for (const titleClass of ['job-name', 'position-name']) await check(titleClass + '连字符标题候选可识别岗位', async () => {
    await load('<main><div>共2个岗位</div>' + ['甲', '乙'].map(suffix => '<article><div class="' + titleClass + '">虚构连字符岗位' + suffix + '</div><p>招聘单位：虚构研发有限公司</p><p>工作地点：测试市</p><p>学历要求：本科及以上</p><button>查看详情</button></article>').join('') + '</main>');
    const result = await scan(); assert.equal(result.jobs.length, 2); assert.deepEqual(result.jobs.map(job => job.name), ['虚构连字符岗位甲', '虚构连字符岗位乙']);
  });

  await check('role heading而非h标签的标题候选可识别岗位', async () => {
    await load('<main><div>共2个岗位</div>' + ['甲', '乙'].map(suffix => '<article><div role="heading" aria-level="3">虚构无级别标签岗位' + suffix + '</div><p>招聘单位：虚构研发有限公司</p><p>工作地点：测试市</p><p>学历要求：本科及以上</p><button>查看详情</button></article>').join('') + '</main>');
    const result = await scan(); assert.equal(result.jobs.length, 2); assert.deepEqual(result.jobs.map(job => job.name), ['虚构无级别标签岗位甲', '虚构无级别标签岗位乙']);
  });

  await check('优选专业标签与兄弟正文同时保留且不丢失偏好原文', async () => {
    await load(preferredDetail, '/fictional/detail?id=preferred-a');
    const result = await scan({}, true); assert.equal(result.jobs.length, 1);
    const job = result.jobs[0];
    assert.deepEqual({ name: job.name, preferred: /优选专业/.test(job.requirements), majors: /虚构信息学、虚构工程学/.test(job.requirements), degree: /本科及以上/.test(job.requirements) },
      { name: '虚构优选专业岗位', preferred: true, majors: true, degree: true });
  });

  await check('默认扫描可直接导入只有优选专业而无任职要求章节的岗位详情', async () => {
    await load(preferredDetail, '/fictional/detail?id=preferred-default');
    const result = await scan(); assert.equal(result.kind, 'detail'); assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].name, '虚构优选专业岗位');
    assert.match(result.jobs[0].requirements, /优选专业/); assert.match(result.jobs[0].requirements, /虚构信息学、虚构工程学/);
    assert.match(result.jobs[0].requirements, /本科及以上/);
  });

  await check('普通h1介绍页加专业标签不会自动导入岗位详情', async () => {
    const introduction = preferredDetail.replace('<div class="job-name">虚构优选专业岗位</div>', '<h1>虚构专业介绍</h1>');
    await load(introduction, '/fictional/overview');
    const result = await scan(); assert.notEqual(result.kind, 'detail'); assert.equal(result.jobs.length, 0);
  });

  await check('有下一页的专业摘要页面不会被默认详情入口吞入', async () => {
    const paged = preferredDetail.replace('</main>', '<nav class="pagination"><span class="active">1</span><button class="next">下一页</button></nav></main>');
    await load(paged, '/fictional/paged-list');
    const result = await scan(); assert.notEqual(result.kind, 'detail'); assert.equal(result.jobs.length, 0);
    assert.equal(result.next, true); assert.equal(result.nextKind, 'control');
  });

  await check('末页禁用下一页的专业摘要仍不是默认岗位详情', async () => {
    const lastPage = preferredDetail.replace('</main>', '<nav class="pagination"><button class="next" disabled>下一页</button></nav></main>');
    await load(lastPage, '/fictional/last-list-page');
    const result = await scan(); assert.notEqual(result.kind, 'detail'); assert.equal(result.jobs.length, 0);
    assert.equal(result.next, false);
  });

  await check('只有明确当前页码而无下一页控件的专业摘要不是默认详情', async () => {
    const lastPage = preferredDetail.replace('</main>', '<nav class="pagination"><span aria-current="page">7</span></nav></main>');
    await load(lastPage, '/fictional/numbered-list-page');
    const result = await scan(); assert.notEqual(result.kind, 'detail'); assert.equal(result.jobs.length, 0);
    assert.equal(result.pageNumber, 7);
  });

  await check('专业标题旁的折叠控件不会使兄弟专业正文丢失', async () => {
    const decorated = preferredDetail.replace('<div class="section-head"><span>优选专业</span></div>',
      '<div class="section-head"><span>优选专业</span><button aria-label="折叠">⌄</button></div>');
    await load(decorated, '/fictional/detail?id=preferred-decorated');
    const result = await scan({}, true); assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].name, '虚构优选专业岗位');
    assert.match(result.jobs[0].requirements, /优选专业/); assert.match(result.jobs[0].requirements, /虚构信息学、虚构工程学/);
    assert.doesNotMatch(result.jobs[0].majorRequirements, /⌄/);
  });

  await check('单个任职要求标题的wrapper不会截掉相邻正文', async () => {
    await load(separateDetail, '/fictional/detail?id=separate-a');
    const result = await scan({}, true); assert.equal(result.jobs.length, 1);
    assert.match(result.jobs[0].requirements, /具备虚构系统设计能力/);
    assert.match(result.jobs[0].requirements, /虚构信息学相关专业/);
  });

  await check('详情标题内嵌薪资标签不混入岗位名称', async () => {
    await load(separateDetail, '/fictional/detail?id=separate-a');
    const result = await scan({}, true); assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].name, '虚构图景分析岗位'); assert.doesNotMatch(result.jobs[0].name, /15K|25K/);
  });

  await check('独立公司卡提供公司证据而不是替代岗位标题', async () => {
    await load(separateDetail, '/fictional/detail?id=separate-a');
    const result = await scan({}, true); assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].company, '虚构云舟技术有限公司'); assert.equal(result.jobs[0].name, '虚构图景分析岗位');
  });

  await check('选中详情正文后仍合并外部标题学历与独立公司卡', async () => {
    await load(separateDetail, '/fictional/detail?id=separate-a');
    const result = await scan({ area: '.posting-copy' }, true); assert.equal(result.jobs.length, 1);
    const job = result.jobs[0];
    assert.deepEqual({ name: job.name, company: job.company, city: job.city, degree: /硕士及以上/.test(job.requirements), body: /虚构系统设计能力/.test(job.requirements) },
      { name: '虚构图景分析岗位', company: '虚构云舟技术有限公司', city: '虚构市', degree: true, body: true });
  });

  await check('可见aria busy与进度条使占位零结果保持loading状态', async () => {
    await load(loading); const result = await scan();
    assert.equal(result.kind, 'loading'); assert.equal(result.loading, true); assert.equal(result.jobs.length, 0);
  });

  await check('选中区域自身的aria busy也保持loading而不是空列表', async () => {
    await load('<main><div>共0个岗位</div><div id="loading-region" aria-busy="true" style="min-height:20px">正在加载岗位</div></main>');
    const result = await scan({ area: '#loading-region' });
    assert.equal(result.kind, 'loading'); assert.equal(result.loading, true); assert.equal(result.jobs.length, 0);
  });

  await check('aria busy期间仍可见的旧卡片不被作为新一页读取', async () => {
    await load(listing([record('旧页甲'), record('旧页乙')], 4, { busy: true }));
    const waiting = await scan(); assert.equal(waiting.kind, 'loading'); assert.equal(waiting.loading, true); assert.equal(waiting.jobs.length, 0);
    await page.evaluate(() => document.querySelector('.tiles-wrap').setAttribute('aria-busy', 'false'));
    const ready = await scan(); assert.equal(ready.kind, 'list'); assert.equal(ready.jobs.length, 2);
    assert.deepEqual(ready.jobs.map(job => job.name), ['虚构字段岗位旧页甲', '虚构字段岗位旧页乙']);
  });

  await check('隐藏加载标记不阻止明确空列表结束', async () => {
    await load('<main><h1>虚构招聘岗位列表</h1><div>共0个岗位</div><div hidden aria-busy="true"><div role="progressbar">加载中</div></div><p>暂无岗位</p></main>');
    const result = await scan(); assert.notEqual(result.kind, 'loading'); assert.notEqual(result.loading, true);
    assert.equal(result.jobs.length, 0); assert.equal(result.total, 0); assert.equal(result.next, false);
  });

  await check('collector等待占位零结果异步变成字段岗位而不提前空结束', async () => {
    await load(loading); await addCollector();
    const result = await page.evaluate(async ready => {
      const session = JobScreenCollector.session(location.href); let reads = 0, nextCalls = 0;
      setTimeout(() => {
        document.getElementById('fictional-total').textContent = '共2个岗位';
        const list = document.querySelector('.tiles-wrap'); list.innerHTML = ready; list.setAttribute('aria-busy', 'false');
      }, 300);
      await JobScreenCollector.collect({ session, read: async () => { reads++; return JobScreenPage.scanDocument(document, location.href); },
        next: async () => { nextCalls++; throw Error('虚构单页不应翻页'); }, resolveLink: async () => '',
        readDetail: async () => { throw Error('虚构测试未提供详情链接'); }, delay: 0 });
      return { names: session.jobs.map(job => job.name), pages: session.pages, total: session.total, complete: session.complete, reads, nextCalls };
    }, [record('异步甲'), record('异步乙')].map(job => card(job)).join(''));
    assert.deepEqual(result.names, ['虚构字段岗位异步甲', '虚构字段岗位异步乙']);
    assert.equal(result.total, 2); assert.equal(result.pages, 1); assert.equal(result.complete, true); assert.ok(result.reads >= 2); assert.equal(result.nextCalls, 0);
  });

  await check('loading等待可暂停且恢复后重新读取岗位不锁定空页面', async () => {
    await load(loading); await addCollector();
    const result = await page.evaluate(async ready => {
      const session = JobScreenCollector.session(location.href), controller = new AbortController();
      const options = { session, read: async () => JobScreenPage.scanDocument(document, location.href),
        next: async () => { throw Error('虚构单页不应翻页'); }, resolveLink: async () => '', readDetail: async () => ({}), delay: 0 };
      setTimeout(() => controller.abort(new DOMException('虚构暂停', 'AbortError')), 100);
      let errorName = '';
      try { await JobScreenCollector.collect({ ...options, signal: controller.signal }); } catch (error) { errorName = error.name; }
      const paused = { errorName, stage: session.stage, count: session.jobs.length, complete: session.complete, listEnded: session.listEnded };
      document.getElementById('fictional-total').textContent = '共2个岗位';
      const list = document.querySelector('.tiles-wrap'); list.innerHTML = ready; list.setAttribute('aria-busy', 'false');
      await JobScreenCollector.collect(options);
      return { paused, names: session.jobs.map(job => job.name), pages: session.pages, complete: session.complete };
    }, [record('恢复甲'), record('恢复乙')].map(job => card(job)).join(''));
    assert.deepEqual(result.paused, { errorName: 'AbortError', stage: 'paused', count: 0, complete: false, listEnded: false });
    assert.deepEqual(result.names, ['虚构字段岗位恢复甲', '虚构字段岗位恢复乙']); assert.equal(result.pages, 1); assert.equal(result.complete, true);
  });

  await check('括号地点栏目保留省市完整原文而不只取页头城市', async () => {
    await load('<main><h1 class="jobTitle">虚构区域岗位</h1><p>测试市</p><h5>【工作地区】</h5><p>测试省-测试市</p><h2>任职要求</h2><p>本科及以上，专业不限。</p><h2>主要职责</h2><p>完成虚构任务。</p></main>', '/fictional/detail?id=region');
    const result = await scan({}, true); assert.equal(result.jobs[0].city, '测试省-测试市');
  });
  await check('实习经验要求不推断岗位性质但独立摘要全职仍保留', async () => {
    const detail = '<h1 class="jobTitle">虚构经历岗位</h1><h2>任职要求</h2><p>本科及以上，有相关实习经验者优先。</p><h2>主要职责</h2><p>完成虚构任务。</p>';
    await load('<main>' + detail + '</main>', '/fictional/detail?id=nature');
    assert.equal((await scan({}, true)).jobs[0].nature, '');
    await load('<main><p>测试市｜全职</p>' + detail + '</main>', '/fictional/detail?id=nature');
    assert.equal((await scan({}, true)).jobs[0].nature, '全职');
  });
  console.log('通用字段卡片与加载验收：通过 ' + passed + ' 项，失败 ' + failures.length + ' 项。');
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await context?.close(); await browser?.close();
});
