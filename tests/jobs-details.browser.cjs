// Fictional cross-origin lists/details only. Browser permissions are provisioned for localhost fixtures.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..'),tempRoot=fs.realpathSync(os.tmpdir()),testRoot=fs.mkdtempSync(path.join(tempRoot,'job-details-test-'));
let context,server,passed=0;const traffic=[],pass=s=>{passed++;console.log('PASS '+s);};
async function until(check,timeout=35000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('condition timed out');}
async function widget(page,selector,operation='text',value=''){
  const client=await context.newCDPSession(page);try{
    const {root}=await client.send('DOM.getDocument',{depth:-1,pierce:true}),find=n=>{if(n.attributes?.includes('job-screen-widget'))return n;for(const ch of [...(n.children||[]),...(n.shadowRoots||[])]){const r=find(ch);if(r)return r;}};
    const {object}=await client.send('DOM.resolveNode',{nodeId:find(root).shadowRoots[0].nodeId});
    const out=await client.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(s,o,v){const n=this.querySelector(s);if(o==="fill"){n.value=v;n.dispatchEvent(new Event("change",{bubbles:true}));return true;}if(o==="check"){n.checked=v;n.dispatchEvent(new Event("change",{bubbles:true}));return true;}if(o==="click"){n.click();return true;}return n?.textContent;}',arguments:[{value:selector},{value:operation},{value}],returnByValue:true});return out.result.value;
  }finally{await client.detach();}
}
(async()=>{
  const ext=path.join(testRoot,'extension');fs.cpSync(path.join(ROOT,'extension'),ext,{recursive:true});require('./access-fixture.cjs')(ext);
  const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*','http://localhost/*'];fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify(manifest));
  let base,detail;
  server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://localhost'),id=u.searchParams.get('id');traffic.push({path:u.pathname,id,at:Date.now()});res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Cache-Control','no-store');
    if(u.pathname==='/favicon.ico'){res.statusCode=204;return res.end();}
    if(u.pathname==='/list'||u.pathname==='/permission'||u.pathname==='/refusals'){
      const n=u.pathname==='/refusals'?3:2,folder=u.pathname==='/refusals'?'/denied':'/detail';
      return res.end('<main><h1>虚构招聘列表</h1><ul>'+Array.from({length:n},(_,i)=>'<li class="job-card"><h3><a class="jobTitle" href="'+detail+folder+'?id='+(i+1)+'">虚构跨站岗位'+(i+1)+'</a></h3><h3><a class="company-title" href="'+detail+'/company?id=1">示例出版有限公司</a></h3><p>工作地点：北京</p><p>学历要求：本科</p></li>').join('')+'</ul><p>共'+n+'个岗位</p></main>');
    }
    if(u.pathname==='/denied'&&id==='2'){res.statusCode=429;res.setHeader('Retry-After','1800');return res.end('Too many requests');}
    if(u.pathname==='/detail'||u.pathname==='/denied'){
      const content='<h2>【职位描述】</h2><p>负责虚构技术工作。</p><h2>【任职资格】</h2><p>'+(id==='1'?'理学、工学等相关专业。':'电子信息科学与技术相关专业。')+'</p><h2>【福利待遇】</h2><p>虚构福利。</p>';
      // The second detail initially contains only degree metadata, then loads full qualifications.
      return res.end('<section class="job-summary"><h1>虚构跨站岗位'+id+'</h1><p>'+(id==='1'?'硕士研究生及以上':'本科及以上')+'</p></section><main>'+(id==='2'?'<div id="requirements"></div>':content)+'</main>'+(id==='2'?'<script type="application/ld+json">'+JSON.stringify({'@type':'JobPosting',title:'虚构跨站岗位2',educationRequirements:'本科'})+'</script><script>setTimeout(()=>document.getElementById("requirements").innerHTML='+JSON.stringify(content)+',900)</script>':''));
    }
    res.statusCode=404;res.end('not found');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;detail='http://localhost:'+server.address().port;
  context=await chromium.launchPersistentContext(path.join(testRoot,'profile'),{executablePath:process.env.BROWSER_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,viewport:{width:1340,height:1120},ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),source=await context.newPage();await source.goto(base+'/list');
  await source.addScriptTag({path:path.join(ROOT,'extension/jobs-page.js')});
  const recognized=await source.evaluate(()=>JobScreenPage.scanDocument(document,location.href));assert.equal(recognized.jobs.length,2);assert.ok(recognized.jobs.every(j=>j.name.startsWith('虚构跨站岗位')&&j.url.startsWith('http://localhost:')));
  const plain=await source.evaluate(()=>JobScreenPage.scanDocument(new DOMParser().parseFromString('<main>'+[1,2].map(i=>'<article><h3><a href="https://details.invalid/job?id='+i+'">虚构普通标题'+i+'</a></h3><h3><a href="https://details.invalid/company?id=1">示例测试有限公司</a></h3><p>学历要求：本科</p></article>').join('')+'</main>','text/html'),location.href));assert.equal(plain.jobs.length,2);assert.ok(plain.jobs.every(j=>j.name.startsWith('虚构普通标题')));
  pass('generic cards retain external job links while company headings and company links produce no duplicate jobs');
  const id=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,source.url());await worker.evaluate(async id=>JobScreenChannel.showMini(await chrome.tabs.get(id)),id);
  const hub=context.pages().find(p=>p.url().includes('/jobs.html'));hub.setDefaultTimeout(35000);await hub.locator('#my-degree').selectOption('本科');await hub.locator('#my-major').fill('电子信息科学与技术');
  const variants=await hub.evaluate(()=>{
    const contents=['<h2>【任职资格】</h2><p>硕士及以上学历，理学、工学等相关专业。</p>','<p>[应聘条件]</p><p>本科及以上，电子信息科学与技术相关专业。</p>','<h3>（岗位要求）</h3><p>本科，专业不限。</p>','<h2>人才说明</h2><p>本科，电子信息科学与技术相关专业，掌握专业知识。</p>'];
    const docs=contents.map(html=>JobScreenPage.scanDocument(new DOMParser().parseFromString('<main><h1>虚构岗位</h1>'+html+'</main>','text/html'),'https://details.invalid/job',{},true).jobs[0]);
    const schema={'@type':'JobPosting',title:'虚构结构化岗位',educationRequirements:'硕士',description:'<p>【任职资格】</p><p>理学、工学等相关专业。</p><p>【职位描述】</p><p>负责虚构工作。</p>'};
    docs.push(JobScreenPage.scanDocument(new DOMParser().parseFromString('<script type="application/ld+json">'+JSON.stringify(schema)+'</script>','text/html'),'https://details.invalid/schema',{},true).jobs[0]);return docs.map(raw=>({raw,major:JobScreenMajors.extract(raw)}));
  });assert.ok(variants.every(v=>v.major.known));assert.match(variants[0].raw.requirements,/理学、工学/);assert.doesNotMatch(variants[4].raw.requirements,/负责虚构工作/);
  pass('bracketed headings, mixed qualification prose and structured description text preserve literal major requirements');
  await hub.locator('#collect').click();await hub.locator('#status').filter({hasText:'本次采集结束'}).waitFor();assert.equal(await hub.locator('.job-row').count(),2);
  const rows=await hub.locator('.job-row').allTextContents();assert.ok(rows.every(s=>!s.includes('详情中未提取到专业条款')));assert.ok(rows.some(s=>s.includes('理学、工学')));assert.equal(traffic.filter(r=>r.path==='/detail'&&r.id==='2').length,2);
  pass('static and dynamic details merge degree badges outside main with qualifications, and degree-only shells still wait for the actual text');
  const conflict=hub.locator('.job-row').filter({hasText:'虚构跨站岗位1'});assert.match(await conflict.textContent(),/学历冲突/);assert.match(await conflict.locator('.conflict-reason').textContent(),/硕士及以上/);
  await hub.locator('#view-cards').click();assert.match(await hub.locator('.job-card').filter({hasText:'虚构跨站岗位1'}).textContent(),/学历冲突/);await hub.locator('#view-table').click();
  await source.locator('#job-screen-widget').waitFor();assert.match(await widget(source,'section'),/学历要求：硕士及以上/);
  await widget(source,'select[aria-label="我的学历"]','fill','硕士');await until(async()=>await hub.locator('#my-degree').inputValue()==='硕士');assert.equal(await hub.locator('.conflict-reason').count(),0);
  await widget(source,'select[aria-label="我的学历"]','fill','本科');await until(async()=>await hub.locator('#my-degree').inputValue()==='本科');await widget(source,'input[type=checkbox]','check',true);await until(async()=>await hub.locator('.job-row').count()===1);assert.match(await hub.locator('.job-row').textContent(),/虚构跨站岗位2/);await widget(source,'input[type=checkbox]','check',false);
  await until(async()=>await hub.locator('.job-row').count()===2);await until(async()=>/筛选后 2/.test(await widget(source,'.count')));fs.mkdirSync(path.join(ROOT,'docs','preview'),{recursive:true});await source.screenshot({path:path.join(ROOT,'docs','preview','学历与详情小窗.png')});
  pass('table, cards and widget identify the degree conflict; widget degree controls synchronize and hide only explicit degree conflicts');
  const original=conflict.getByRole('link',{name:'查看原岗位 虚构跨站岗位1',exact:true});
  assert.equal(await original.getAttribute('href'),detail+'/detail?id=1');
  let opened=context.waitForEvent('page');await original.click();let originalPage=await opened;await originalPage.waitForURL(detail+'/detail?id=1');await originalPage.close();
  opened=context.waitForEvent('page');await widget(source,'a[aria-label="查看原岗位 虚构跨站岗位2"]','click');originalPage=await opened;await originalPage.waitForURL(detail+'/detail?id=2');await originalPage.close();
  assert.equal(source.url(),base+'/list');
  pass('prominent original-job buttons in the hub and widget open the correct external detail in a separate tab');
  // Permissions are already provisioned in this isolated profile. Withhold only the preflight check,
  // then restore it to exercise the real explicit button/resume path without claiming an OS prompt test.
  await source.goto(base+'/permission');await worker.evaluate(()=>{globalThis.testNativePermissionCheck=chrome.permissions.contains;globalThis.testPermissionMissing=true;chrome.permissions.contains=async p=>testPermissionMissing&&p.origins?.some(s=>s.includes('localhost'))?false:testNativePermissionCheck(p);});
  const prior=traffic.filter(r=>r.path==='/detail').length;await hub.locator('#collect').click();await hub.locator('#authorize-details').waitFor();assert.equal(traffic.filter(r=>r.path==='/detail').length,prior);assert.equal(await hub.locator('.job-row').count(),2);
  await worker.evaluate(()=>{testPermissionMissing=false;});await hub.locator('#authorize-details').click();await hub.locator('#status').filter({hasText:'本次采集结束'}).waitFor();assert.equal(await hub.locator('.job-row').count(),2);assert.ok(traffic.filter(r=>r.path==='/detail').length>prior);assert.doesNotMatch(await hub.locator('#coverage').textContent(),/请授权/);await worker.evaluate(()=>{chrome.permissions.contains=testNativePermissionCheck;});
  pass('missing foreign permission pauses before any detail request and the explicit authorization button resumes the same discovered jobs');
  await source.goto(base+'/refusals');await hub.locator('#collect').click();await hub.locator('#status').filter({hasText:'429'}).waitFor();await until(async()=>!(await hub.locator('#collect').textContent()).includes('采集中'));
  assert.equal(traffic.filter(r=>r.path==='/denied'&&r.id==='3').length,0);assert.equal(await hub.locator('.job-row').count(),3);const saved=await worker.evaluate(()=>chrome.storage.session.get(null));assert.ok(saved['jobAccessBlock:'+detail].until>Date.now()+1700000);assert.ok(!JSON.stringify(saved).includes('虚构跨站岗位'));assert.ok(!Object.keys(saved).some(k=>k.startsWith('jobWorker:')));
  pass('a foreign detail refusal stops its originating source, honors Retry-After, closes its worker and never requests later jobs');
  console.log('Detail and degree checks passed: '+passed);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  await context?.close();await new Promise(r=>server?server.close(r):r());const target=path.resolve(testRoot);if(path.dirname(target)===tempRoot&&path.basename(target).startsWith('job-details-test-'))fs.rmSync(target,{recursive:true,force:true,maxRetries:3});
});
