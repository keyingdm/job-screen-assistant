const { chromium } = require('playwright');
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..'), tempRoot = fs.realpathSync(os.tmpdir()), testDir = fs.mkdtempSync(path.join(tempRoot, 'job-ui-test-'));
let context, passed = 0; const pass = s => { passed++; console.log('PASS ' + s); };
(async () => {
  const ext = path.join(ROOT, 'extension'), legacy = path.resolve(ROOT, '../网申助手/extension');
  const paths = fs.existsSync(path.join(legacy, 'manifest.json')) ? [ext, legacy] : [ext];
  context = await chromium.launchPersistentContext(testDir, { executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true,
    viewport: { width: 1540, height: 1120 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--disable-extensions-except=' + paths.join(','), '--load-extension=' + paths.join(',')] });
  while (context.serviceWorkers().length < paths.length) await context.waitForEvent('serviceworker');
  let worker, legacyWorker; const errors = [];
  for (const w of context.serviceWorkers()) { if (await w.evaluate(() => chrome.runtime.getManifest().name) === '岗位筛选助手') worker = w; else legacyWorker = w; }
  if (legacyWorker) await legacyWorker.evaluate(async () => chrome.storage.local.set({ isolationTest: 'fiction-only', jobProfile: { degree: '博士' } }));
  const id = new URL(worker.url()).host, page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('chrome-extension://' + id + '/jobs.html');
  await page.locator('#result-count').filter({hasText:'0 / 0'}).waitFor();
  assert.equal(await page.locator('#tab-favorites').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#view-table').getAttribute('aria-pressed'),'true');
  pass('production extension opens to favorites with a table default');
  await page.locator('#sample').click(); assert.equal(await page.locator('.job-row').count(),6);
  await page.locator('#view-cards').click(); assert.equal(await page.locator('.job-card').count(),6);
  await page.locator('#view-table').click(); pass('table and cards show the same temporary results');
  await page.locator('#my-degree').selectOption('本科'); await page.locator('#my-year').fill('2027');
  await page.locator('#my-major').fill('电子信息科学与技术'); await page.locator('#my-experience').fill('0'); await page.locator('#my-english').selectOption('1');
  await page.locator('#filter-hideConflicts').check(); assert.equal(await page.locator('.job-row').count(),3);
  await page.locator('#filter-city').fill('深圳,南昌'); assert.equal(await page.locator('.job-row').count(),2);
  pass('personal criteria and preference filters keep unknown requirements visible');
  await page.getByRole('button',{name:'嵌入式软件工程师（虚构）',exact:true}).click();
  assert.match(await page.locator('#detail-body').textContent(),/本科及以上/);
  assert.ok(await page.locator('#detail').evaluate(e=>e.getBoundingClientRect().width<750));
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#detail').getAttribute('open'),null);
  await page.getByRole('button',{name:'嵌入式软件工程师（虚构）',exact:true}).click();
  await page.locator('#detail-close').click(); pass('right detail drawer shows original evidence and closes with X or Escape');
  await page.getByRole('button',{name:'收藏 嵌入式软件工程师（虚构）',exact:true}).click();
  await page.waitForFunction(async()=>Object.keys((await chrome.storage.local.get('jobFavorites')).jobFavorites||{}).length===1);
  await page.getByRole('button',{name:'嵌入式软件工程师（虚构）',exact:true}).click();
  await page.getByLabel('投递标记 嵌入式软件工程师（虚构）',{exact:true}).selectOption('已投递');
  await page.waitForFunction(async()=>Object.values((await chrome.storage.local.get('jobFavorites')).jobFavorites)[0].status==='已投递');
  await page.locator('#detail-close').click();
  const saved = await page.evaluate(async()=>chrome.storage.local.get(null)); assert.equal(saved.jobDataset,undefined); assert.equal(saved.jobMarks,undefined);
  assert.equal(Object.values(saved.jobFavorites)[0].job.description.includes('嵌入式'),true);
  pass('only a full favorite snapshot and manual application state are persisted');
  await page.reload(); await page.locator('.job-row').waitFor(); assert.equal(await page.locator('.job-row').count(),1);
  assert.equal(await page.locator('#tab-favorites').getAttribute('aria-selected'),'true');
  await page.locator('#tab-session').click(); assert.equal(await page.locator('.job-row').count(),0);
  assert.equal(await page.locator('#my-year').inputValue(),'2027');
  pass('reload clears non-favorites and returns to the saved collection');
  await page.locator('#sample').click();
  const dl = page.waitForEvent('download'); await page.locator('#export-json').click();
  const backup = JSON.parse(fs.readFileSync(await (await dl).path(),'utf8'));
  assert.equal(backup.format,'job-screen-favorites'); assert.equal(backup.favorites.length,1); assert.equal(backup.dataset,undefined); assert.equal(backup.profile,undefined);
  pass('backup contains favorites only even while six ordinary results are visible');
  await page.locator('#tab-favorites').click(); await page.getByRole('button',{name:'取消收藏 嵌入式软件工程师（虚构）',exact:true}).click();
  await page.waitForFunction(async()=>Object.keys((await chrome.storage.local.get('jobFavorites')).jobFavorites).length===0);
  await page.reload(); assert.equal(await page.locator('.job-row').count(),0); pass('removing a favorite also removes its persisted snapshot');
  const migration = await page.evaluate(async()=> {
    const jobs=JobScreenSamples.slice(0,2).map(raw=>JobScreen.normalize(raw,'sample'));
    await chrome.storage.local.set({jobDataset:{source:'sample',jobs},jobMarks:{[jobs[0].key]:{favorite:true,status:'已投递'},[jobs[1].key]:{favorite:false}}}); return jobs[0].key;
  });
  await page.reload(); await page.locator('.job-row').waitFor();
  const migrated = await page.evaluate(async()=>chrome.storage.local.get(null));
  assert.equal(Object.keys(migrated.jobFavorites).length,1); assert.equal(migrated.jobDataset,undefined); assert.equal(migrated.jobMarks,undefined);
  assert.equal(Object.values(migrated.jobFavorites)[0].status,'已投递'); pass('upgrade migrates old favorites before removing the old ordinary dataset');
  const file=path.join(testDir,'favorites.json'); fs.writeFileSync(file,JSON.stringify(backup));
  await page.locator('#import-json').setInputFiles(file); await page.locator('#status').filter({hasText:'已导入收藏'}).waitFor();
  assert.equal(await page.locator('.job-row').count(),1); pass('favorite-only restore merges saved records');
  const originalSamples=await page.evaluate(()=>JobScreenSamples);
  await page.evaluate(()=>{JobScreenSamples=[
    {id:'major1',name:'虚构电气研发',requirements:'本科及以上；熟悉电气设备',majorRequirements:'电气工程及其自动化'},
    {id:'major2',name:'虚构电气类别',requirements:'本科及以上；电气类相关专业'},
    {id:'major3',name:'虚构设备技能',requirements:'本科及以上；熟悉电气设备'},
    {id:'major4',name:'虚构不限专业',requirements:'本科及以上；专业不限'},
    {id:'major5',name:'虚构法学岗位',requirements:'本科及以上；法学专业，熟悉电气设备'},
    {id:'major6',name:'虚构专业排除',requirements:'本科及以上；不接受电气类专业'},
    {id:'major7',name:'虚构宽泛专业',requirements:'本科及以上；理工科相关专业'}
  ];});
  await page.locator('#sample').click();await page.locator('#reset').click();await page.locator('#clear-profile').click();
  await page.locator('#my-degree').selectOption('本科');await page.locator('#my-major').fill('电气工程及其自动化');await page.locator('#filter-major').fill('电气');
  assert.equal(await page.locator('.job-row').count(),5);assert.match(await page.locator('#major-result-count').textContent(),/命中 2.*不限 1.*待确认 2/);
  const skillRow=page.locator('.job-row').filter({has:page.getByRole('button',{name:'虚构设备技能',exact:true})});
  assert.match(await skillRow.locator('.professional-evidence').textContent(),/未检测到专业要求/);assert.doesNotMatch(await skillRow.locator('.professional-evidence').textContent(),/命中/);
  assert.equal(await skillRow.locator('.major-missing .pill').textContent(),'未检测到专业要求');
  await page.getByRole('button',{name:'虚构设备技能',exact:true}).click();assert.match(await page.locator('#detail-body').textContent(),/未检测到专业要求.*不代表专业不限/);await page.locator('#detail-close').click();
  await page.locator('#view-cards').click();assert.equal(await page.locator('.job-card').filter({hasText:'虚构设备技能'}).locator('.major-missing .pill').textContent(),'未检测到专业要求');await page.locator('#view-table').click();
  await page.locator('#filter-majorMode').selectOption('hit');assert.equal(await page.locator('.job-row').count(),2);
  await page.locator('#view-cards').click();assert.equal(await page.locator('.job-card').count(),2);await page.locator('#view-table').click();
  await page.getByRole('button',{name:'虚构电气类别',exact:true}).click();assert.match(await page.locator('#detail-body').textContent(),/电气工程及其自动化 → 电气类/);await page.locator('#detail-close').click();
  await page.locator('#my-major').fill('电气');assert.match(await page.locator('#major-profile-note').textContent(),/未识别/);
  pass('major keyword groups, strict mode and full-name qualification stay distinct in table, cards and drawer');
  await page.getByRole('button',{name:'收藏 虚构电气研发',exact:true}).click();
  await page.waitForFunction(async()=>Object.values((await chrome.storage.local.get('jobFavorites')).jobFavorites).some(f=>f.job.majorRequirements==='电气工程及其自动化'));
  await page.getByRole('button',{name:'取消收藏 虚构电气研发',exact:true}).click();
  await page.waitForFunction(async()=>!Object.values((await chrome.storage.local.get('jobFavorites')).jobFavorites).some(f=>f.job.id==='major1'));
  pass('separate professional fields are retained in a favorite snapshot');
  await page.evaluate(()=>{const original=JobScreenStorage.set;globalThis.pendingProfileWrites=0;JobScreenStorage.set=async function(key,value){if(key==='jobProfile'){pendingProfileWrites++;try{await new Promise(r=>setTimeout(r,180));return await original.call(this,key,value);}finally{pendingProfileWrites--;}}return original.call(this,key,value);};});
  await page.locator('#my-major').fill('电子信息科学与技术');await page.locator('#my-degree').selectOption('硕士');await page.locator('#clear-profile').click();
  await page.locator('#status').filter({hasText:'已清空个人条件'}).waitFor();await page.waitForFunction(()=>pendingProfileWrites===0);
  assert.deepEqual(await page.evaluate(async()=>(await chrome.storage.local.get('jobProfile')).jobProfile),{});
  await page.reload();assert.equal(await page.locator('#my-major').inputValue(),'');assert.equal(await page.locator('#my-degree').inputValue(),'');
  pass('clearing criteria waits for earlier delayed saves and the cleared profile stays empty after reload');
  await page.evaluate(raw=>{JobScreenSamples=raw;},originalSamples);
  await page.locator('#sample').click(); await page.locator('#reset').click(); await page.locator('#clear-profile').click();
  await page.locator('#my-degree').selectOption('本科');await page.locator('#my-major').fill('电子信息科学与技术');await page.locator('#filter-major').fill('电子信息');
  assert.match(await page.locator('.major-primary').first().textContent(),/电子信息科学与技术/);assert.ok(await page.locator('.major-primary mark').count()>0);
  fs.mkdirSync(path.join(ROOT,'docs/images'),{recursive:true});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(ROOT,'docs/images/岗位筛选台.png')});
  await page.getByRole('button',{name:'嵌入式软件工程师（虚构）',exact:true}).click();
  await page.screenshot({path:path.join(ROOT,'docs/images/岗位详情.png')}); await page.locator('#detail-close').click();
  require('node:child_process').execFileSync('python',[path.join(ROOT,'tools/build_help.py')],{windowsHide:true,stdio:'ignore'});
  const help=await context.newPage();await help.goto('chrome-extension://'+id+'/help.html');
  const tutorial=await help.evaluate(async()=>{for(const i of document.images)i.loading='eager';await Promise.all([...document.images].map(i=>i.decode()));return{chapters:document.querySelectorAll('h2').length,images:document.images.length,version:document.body.textContent.includes('v'+chrome.runtime.getManifest().version)};});
  assert.equal(tutorial.chapters,8);assert.equal(tutorial.images,2);assert.equal(tutorial.version,true);await help.close();pass('offline tutorial has eight chapters and two decoded fictional screenshots');
  await page.setViewportSize({width:680,height:950}); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  pass('lavender interface and scrolling table fit a narrow viewport');
  const denied=await page.evaluate(async()=>chrome.runtime.sendMessage({type:'job-screen',action:'scan',tabId:99999,nonce:'invalid'}));
  assert.equal(denied.ok,false); pass('unbound pages cannot read browser tabs');
  if(legacyWorker) { const old=await legacyWorker.evaluate(async()=>chrome.storage.local.get(null)); assert.equal(old.isolationTest,'fiction-only');assert.equal(old.jobProfile.degree,'博士');assert.equal(old.jobFavorites,undefined); pass('independent extension storage remains isolated from the original assistant'); }
  assert.deepEqual(errors,[]); pass('production dashboard has no JavaScript errors');
  const closing=page.waitForEvent('close'); await page.locator('#app-close').click(); await closing; pass('close button closes the extension-created workspace tab');
  console.log('UI checks passed: '+passed);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  await context?.close(); const target=path.resolve(testDir);
  if(path.dirname(target)===tempRoot&&path.basename(target).startsWith('job-ui-test-'))fs.rmSync(target,{recursive:true,force:true,maxRetries:3});
});
