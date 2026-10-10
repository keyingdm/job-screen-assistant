// Fictional DOM reproductions only; no company code, public snapshots or accounts.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..'),tempRoot=fs.realpathSync(os.tmpdir()),testRoot=fs.mkdtempSync(path.join(tempRoot,'job-recognition-test-'));
let context,server,passed=0;const pass=s=>{passed++;console.log('PASS '+s);};
const filterPanel='<aside><div class="filters">'+['招聘类型','学历要求','工作地点','招聘公司'].map(label=>'<div><div class="filterTitle"><span>'+label+'</span></div><p>博士 硕士 本科 上海市 招聘公司</p><input placeholder="筛选"></div>').join('')+'</div></aside>';
const cards=count=>Array.from({length:count},(_,i)=>'<div class="styled__ListItem repeated-card"><div class="styled__ListItemContent"><div class="styled__TitleSection"><span><div class="styled__JobTitle"><span><span onclick="window.open(\'/campus/detail?key='+i+'\')">虚构技术岗位'+i+'</span></span></div></span></div><div>示例单位A</div><div>武汉</div><div>2099-12-31</div></div></div>').join('');
(async()=>{
  const ext=path.join(testRoot,'extension');fs.cpSync(path.join(ROOT,'extension'),ext,{recursive:true});
  require('./access-fixture.cjs')(ext);
  const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify(manifest));
  let detailRequests=0;
  server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html;charset=utf-8');const u=new URL(req.url,'http://127.0.0.1');
    if(u.pathname==='/list')res.end('<style>.repeated-card{padding:20px;border:1px solid #ddd}.styled__JobTitle{font-weight:bold}aside{float:left;width:240px}</style>'+filterPanel+'<main><p>共120个职位</p><div id="records">'+cards(20)+'</div><div id="sentinel">向下浏览更多职位</div></main><script>let count=20,loading=false;window.addEventListener("scroll",()=>{if(loading||count>=120)return;if(document.getElementById("sentinel").getBoundingClientRect().bottom>innerHeight+5)return;loading=true;setTimeout(()=>{let html="";for(let i=count;i<Math.min(count+20,120);i++)html+=\'<div class="styled__ListItem repeated-card"><div class="styled__ListItemContent"><div class="styled__TitleSection"><span><div class="styled__JobTitle"><span><span onclick="window.open(\\\'/campus/detail?key=\'+i+\'\\\')">虚构技术岗位\'+i+\'</span></span></div></span></div><div>示例单位A</div><div>武汉</div><div>2099-12-31</div></div></div>\';document.getElementById("records").insertAdjacentHTML("beforeend",html);count+=20;if(count===120)document.getElementById("sentinel").textContent="没有更多职位";loading=false;},120);});</script>');
    else if(u.pathname==='/campus/detail'){detailRequests++;res.end('<main><h1>虚构技术岗位'+u.searchParams.get('key')+'</h1><h2>任职资格</h2><p>本科及以上，电子信息科学与技术、通信工程。</p><h2>工作职责</h2><p>完成虚构技术工作。</p></main>');}
    else{res.statusCode=404;res.end('not found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  context=await chromium.launchPersistentContext(path.join(testRoot,'profile'),{executablePath:process.env.BROWSER_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,viewport:{width:1280,height:900},ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const source=await context.newPage();await source.goto(base+'/list');
  await source.addScriptTag({path:path.join(ROOT,'extension/jobs-page.js')});
  const recognized=await source.evaluate(()=>JobScreenPage.scanDocument(document,location.href));
  console.log('Recognized first batch:',recognized.jobs.length,recognized.jobs.slice(0,5).map(j=>j.name));
  assert.equal(recognized.jobs.length,20);assert.ok(recognized.jobs.every(j=>j.name.startsWith('虚构技术岗位')));
  assert.equal(recognized.total,120);assert.equal(recognized.nextKind,'scroll');
  const labelsOnly=await source.evaluate(html=>JobScreenPage.scanDocument(new DOMParser().parseFromString(html.replace(/aside/g,'div'),'text/html'),location.href),filterPanel);
  assert.equal(labelsOnly.jobs.length,0);
  const withSalary=await source.evaluate(()=>{
    const d=new DOMParser().parseFromString('<div>'+[1,2].map(i=>'<div class="jobCard"><div class="titleSection"><div class="jobTitle"><span>虚构软件岗位'+i+'</span></div><div>10-20K</div></div><p>工作地点：武汉</p><p>本科</p></div>').join('')+'</div>','text/html');
    return JobScreenPage.scanDocument(d,location.href);
  });
  assert.equal(withSalary.jobs.length,2);assert.ok(withSalary.jobs.every(j=>!j.name.includes('10-20K')));
  const stable=await source.evaluate(()=>{
    const parse=s=>JobScreenPage.scanDocument(new DOMParser().parseFromString('<div class="jobCard"><div class="jobTitle"><span>虚构稳定岗位</span></div><p>工作地点：武汉</p>'+s+'</div>','text/html'),location.href).jobs[0].id;
    return [parse('<button>查看详情</button>'),parse('<h3>任职要求</h3><p>本科及以上</p><button>关闭详情</button>')];
  });
  assert.equal(stable[0],stable[1]);
  pass('nested job titles and repeated metadata-only cards exclude all four filter headings');
  const sparse=await source.evaluate(()=>{
    const d=new DOMParser().parseFromString('<div class="filterTitle"><span>学历要求</span></div><p>博士 硕士 本科</p><div class="styled__ListItem"><div class="styled__JobTitle"><span>虚构单个岗位</span></div><p>工作地点：武汉</p><button>查看详情</button></div>','text/html');
    return JobScreenPage.scanDocument(d,location.href);
  });
  assert.equal(sparse.jobs.length,1);assert.equal(sparse.jobs[0].name,'虚构单个岗位');
  pass('a single job with a detail action remains discoverable without filter contamination');
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,source.url());
  const event=context.waitForEvent('page');await worker.evaluate(async id=>openDashboard(await chrome.tabs.get(id)),tabId);const page=await event;
  page.setDefaultTimeout(120000);await page.waitForURL('**/jobs.html?tab=*');await page.locator('#source-label').filter({hasText:'127.0.0.1'}).waitFor();
  // Test the actual permission/binding/RPC path, with fast local detail reads only.
  await page.locator('#collect').click();
  const progress=setInterval(async()=>{try{console.log('Collection progress:',await page.locator('#coverage').textContent(),await page.locator('#status').textContent());}catch{}},10000);
  try{await page.locator('#coverage').filter({hasText:'已发现 120 /'}).waitFor();}finally{clearInterval(progress);}
  await page.locator('#pause').click();await page.locator('#status').filter({hasText:'已暂停'}).waitFor();
  assert.equal(await page.locator('#session-count').textContent(),'120');
  const extracted=await source.evaluate(()=>JobScreenPage.scanDocument(document,location.href));
  assert.equal(extracted.jobs.length,120);assert.ok(extracted.jobs.every(j=>j.name.startsWith('虚构技术岗位')));
  pass('scroll collection discovers 120 distinct real cards without storing ordinary results');
  const persisted=await page.evaluate(async()=>chrome.storage.local.get(null));assert.equal(persisted.jobDataset,undefined);
  const snapshot=await page.evaluate(()=>({coverage:document.getElementById('coverage').textContent,buttons:[...document.querySelectorAll('.job-title')].map(e=>e.textContent)}));
  assert.ok(snapshot.buttons.every(n=>n.startsWith('虚构技术岗位')));
  await page.getByRole('button',{name:'虚构技术岗位0',exact:true}).click();
  assert.equal(await page.locator('#detail-body a').getAttribute('href'),base+'/campus/detail?key=0');await page.locator('#detail-close').click();
  pass('captured title links retain the original detail destination');
  // Verify selected details through production read paths without reading all 120 slowly.
  const loaded=await page.evaluate(async url=>{
    const response=await fetch(url),html=await response.text(),doc=new DOMParser().parseFromString(html,'text/html');
    const result=JobScreenPage.scanDocument(doc,url,{},true);if(!result.jobs.length)result.diagnostic={html,text:JobScreenPage.text(doc.body)};return result;
  },base+'/campus/detail?key=0');
  if(loaded.diagnostic)console.log('DETAIL DIAGNOSTIC',loaded.diagnostic);
  assert.match(loaded.jobs[0].requirements,/电子信息科学与技术/);
  await page.evaluate(raw=>{JobScreenSamples=[raw];},loaded.jobs[0]);await page.locator('#sample').click();
  await page.locator('#my-major').fill('电子信息科学与技术');await page.locator('#filter-major').fill('电子信息');
  assert.equal(await page.locator('.job-row').count(),1);
  await page.getByRole('button',{name:'虚构技术岗位0',exact:true}).click();assert.match(await page.locator('#detail-body').textContent(),/专业词命中.*电子信息/);await page.locator('#detail-close').click();
  pass('short professional keywords find longer degree names without requiring the word major');
  const fields=await page.evaluate(()=>[
    '<table><tr><th>专业要求</th><td>电气工程及其自动化</td><th>学历要求</th><td>本科</td></tr></table>',
    '<dl><dt>专业背景</dt><dd>机械设计制造及其自动化</dd><dt>工作地点</dt><dd>武汉</dd></dl>',
    '<h2>所学专业</h2><p>金融工程</p><h2>工作职责</h2><p>熟悉电气设备</p>'
  ].map(markup=>JobScreenPage.scanDocument(new DOMParser().parseFromString('<main><h1>虚构字段岗位</h1>'+markup+'<h2>任职要求</h2><p>本科及以上；熟悉电气设备</p></main>','text/html'),'https://example.invalid/job',{},true).jobs[0]));
  assert.deepEqual(fields.map(j=>j.majorRequirements),['电气工程及其自动化','机械设计制造及其自动化','金融工程']);
  const majors=await page.evaluate(raws=>raws.map(raw=>({major:JobScreen.normalize(raw).facts.major,hit:JobScreen.matchMajor(raw,'电气').hit})),fields);
  assert.equal(majors[0].hit,true);assert.equal(majors[1].hit,false);assert.equal(majors[2].hit,false);
  pass('table, definition and heading major fields survive static HTML extraction independently of skills');
  const schema=await page.evaluate(()=>{
    const item={'@type':'JobPosting',title:'虚构结构化岗位',qualifications:'法学专业',skills:'电气设备维修'};
    const doc=new DOMParser().parseFromString('<script type="application/ld+json">'+JSON.stringify(item)+'</script>','text/html');
    const raw=JobScreenPage.scanDocument(doc,'https://example.invalid/schema',{},true).jobs[0];return {req:raw.requirements,major:JobScreen.normalize(raw).facts.major,hit:JobScreen.matchMajor(raw,'电气').hit};
  });
  assert.match(schema.req,/技能要求/);assert.doesNotMatch(schema.major,/电气/);assert.equal(schema.hit,false);
  pass('structured skills remain separate from professional qualifications');
  const structuredList=await page.evaluate(()=>{
    const items=[1,2].map(i=>({'@type':'JobPosting',title:'虚构结构化列表岗位'+i,educationRequirements:'本科',hiringOrganization:{name:'示例测试单位'}}));
    const html='<script type="application/ld+json">'+JSON.stringify({'@graph':items})+'</script><nav class="pagination"><span aria-current="page">1</span><a rel="next" href="?page=2">下一页</a></nav><p>共4个岗位</p>';
    return JobScreenPage.scanDocument(new DOMParser().parseFromString(html,'text/html'),'https://example.invalid/list');
  });
  assert.equal(structuredList.kind,'list');assert.equal(structuredList.jobs.length,2);assert.equal(new Set(structuredList.jobs.map(j=>j.id)).size,2);assert.equal(structuredList.next,true);assert.equal(structuredList.total,4);
  assert.ok(structuredList.jobs.every(j=>j.linkKind==='list'&&j.collectionState==='pending'&&j.completeness==='detail-summary'));
  const mergedDetail=await page.evaluate(()=>{
    const schema={'@type':'JobPosting',title:'虚构合并岗位',educationRequirements:'本科',qualifications:['法学专业','英语四级']};
    const html='<script type="application/ld+json">'+JSON.stringify(schema)+'</script><main><h1>虚构合并岗位</h1><p>学历要求：本科</p></main>';
    return JobScreenPage.scanDocument(new DOMParser().parseFromString(html,'text/html'),'https://example.invalid/job',{},true).jobs[0];
  });assert.equal(mergedDetail.completeness,'detail');assert.match(mergedDetail.requirements,/法学专业/);assert.match(mergedDetail.requirements,/英语四级/);
  pass('structured lists retain pagination and distinct identities; degree-only summaries wait and array qualifications merge with visible metadata');
  const embedded=await page.evaluate(()=>{
    const html='<main><h1>虚构招聘集团-校招</h1><h2 class="jobTitle">虚构研发工程师</h2><h2>人才条件说明</h2><p>本科及以上，理工类相关专业。</p><h2>工作职责</h2><p>1. 负责电气设备维护，掌握电气专业知识。</p><h2>相关推荐</h2><p>法学专业</p></main>';
    const raw=JobScreenPage.scanDocument(new DOMParser().parseFromString(html,'text/html'),'https://example.invalid/detail',{},true).jobs[0];
    const result=JobScreenMajors.assess(raw,{degree:'本科',major:'电子信息科学与技术'});
    return {raw,result,search:JobScreen.matchMajor(raw,'电气')};
  });
  assert.equal(embedded.raw.name,'虚构研发工程师');assert.match(embedded.raw.requirements,/理工类相关专业/);
  assert.doesNotMatch(embedded.raw.requirements,/电气专业知识|法学专业/);assert.equal(embedded.result.kind,'broad');assert.equal(embedded.search.hit,false);
  pass('unlabelled qualification clauses inside a detail are found without turning duties or recommendations into professional requirements');
  const metadata=await page.evaluate(()=>{
    const body='<h2>专业要求</h2><p>电气工程及其自动化、电子信息类等相关专业</p><h2>工作职责</h2><p>负责虚构本科课程设备的质量管理。</p><h2>任职要求</h2><p>电子信息类等相关专业；熟悉质量管理。</p>';
    const headers=['<h1>虚构质量工程师</h1><p>示例测试有限公司 ｜ 武汉市 ｜ 本科及以上 ｜ 招聘若干人</p>', '<h1>虚构质量工程师</h1><div><span>示例测试有限公司</span><span>武汉市</span><span>硕士研究生或以上</span><span>招聘若干人</span></div>'];
    const documents=[headers[0]+body, headers[1]+body, '<h1>虚构质量工程师</h1><table><tr><th>学历要求</th><td>硕士及以上</td><th>英语要求</th><td>英语六级</td></tr></table>'+body, '<h1>虚构质量工程师</h1><dl><dt>学历</dt><dd>博士研究生及以上</dd><dt>经验要求</dt><dd>3年以上工作经验</dd></dl>'+body, '<h1>虚构质量工程师</h1><h2>学历要求</h2><p>学历不限</p>'+body];
    return documents.map(html=>{const doc=new DOMParser().parseFromString('<main>'+html+'<aside><h2>推荐岗位</h2><p>博士学历；法学专业</p></aside></main>','text/html');const raw=JobScreenPage.scanDocument(doc,'https://example.invalid/metadata',{},true).jobs[0];return {raw,facts:JobScreen.normalize(raw).facts};});
  });
  assert.deepEqual(metadata.map(v=>v.facts.degree.rank),[2,3,3,4,0]);assert.equal(metadata[0].facts.degree.minimum,true);assert.equal(metadata[1].facts.degree.minimum,true);assert.equal(metadata[4].facts.degree.unrestricted,true);
  assert.equal(metadata[2].facts.english.rank,2);assert.equal(metadata[3].facts.experience.min,3);assert.ok(metadata.every(v=>!v.raw.requirements.includes('法学')));
  pass('top metadata, inline badges, tables, definition lists and separate degree fields merge with qualification text and preserve other explicit conditions');
  const outside=await page.evaluate(()=>{
    const html='<header><h1>示例招聘门户</h1><nav>本科课程</nav></header><section class="job-summary"><h1>虚构质量工程师</h1><p>示例测试有限公司 ｜ 武汉市 ｜ 本科及以上</p></section><main><h2>专业要求</h2><p>电子信息类</p><h2>任职要求</h2><p>电子信息类等相关专业。</p><h2>相关推荐</h2><p>博士学历；法学专业</p></main>';
    return JobScreenPage.scanDocument(new DOMParser().parseFromString(html,'text/html'),'https://example.invalid/separate-header',{},true).jobs[0];
  });assert.equal(outside.name,'虚构质量工程师');assert.match(outside.requirements,/本科及以上/);assert.doesNotMatch(outside.requirements,/博士|法学|课程/);
  const missing=await page.evaluate(()=>{
    const html='<main><h1>虚构课程工程师</h1><h2>工作职责</h2><p>负责本科课程；协助硕士项目。</p><h2>任职要求</h2><p>专业不限；熟悉设备。</p><div hidden>学历：博士</div><section class="recommend"><p>学历：硕士</p></section></main>';
    return JobScreen.normalize(JobScreenPage.scanDocument(new DOMParser().parseFromString(html,'text/html'),'https://example.invalid/no-degree',{},true).jobs[0]).facts.degree;
  });assert.equal(missing.rank,0);
  const renderedHidden=await page.evaluate(()=>{
    const wrapper=document.createElement('div');wrapper.innerHTML='<style>.fixture-hidden-degree{display:none}</style><article id="fixture-detail"><h1>虚构可见岗位</h1><div class="fixture-hidden-degree">学历要求：博士</div><h2>任职要求</h2><p>专业不限；熟悉设备。</p></article>';document.body.append(wrapper);
    try{const raw=JobScreenPage.scanDocument(document,'https://example.invalid/live-hidden',{area:'#fixture-detail'},true).jobs[0];return {...JobScreen.normalize(raw).facts.degree,name:raw.name};}finally{wrapper.remove();}
  });assert.equal(renderedHidden.rank,0);assert.equal(renderedHidden.name,'虚构可见岗位');
  pass('separate job headers are read while portal navigation, hidden text, duties and recommended-job degrees are excluded');
  const disagreement=await page.evaluate(()=>{
    const raw=JobScreenPage.scanDocument(new DOMParser().parseFromString('<main><h1>虚构矛盾学历岗位</h1><p>本科及以上</p><h2>任职要求</h2><p>硕士及以上学历，专业不限。</p></main>','text/html'),'https://example.invalid/conflict',{},true).jobs[0];return JobScreen.evaluate(JobScreen.normalize(raw),{degree:'本科'});
  });assert.equal(disagreement.state,'review');assert.match(disagreement.checks[0].evidence,/本科/);assert.match(disagreement.checks[0].evidence,/硕士/);
  pass('inconsistent header and body degrees preserve both statements instead of silently accepting the lower threshold');
  assert.ok(detailRequests>0);
  console.log('Recognition checks passed: '+passed);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  await context?.close();await new Promise(resolve=>server?server.close(resolve):resolve());
  const target=path.resolve(testRoot);if(path.dirname(target)===tempRoot&&path.basename(target).startsWith('job-recognition-test-'))fs.rmSync(target,{recursive:true,force:true,maxRetries:3});
});
