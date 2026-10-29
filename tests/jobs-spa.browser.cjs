// Fictional local SPA pages only. Exercise real extension messages in an isolated browser.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..'),TEMP=fs.realpathSync(os.tmpdir()),testRoot=fs.mkdtempSync(path.join(TEMP,'job-spa-test-'));
let context,server,passed=0;const traffic=[],pass=s=>{passed++;console.log('PASS '+s);};
const detail=n=>'<main><h1 class="jobTitle">虚构单页岗位'+n+'</h1><h2>工作职责</h2><p>完成虚构项目'+n+'。</p><h2>任职要求</h2><p>本科及以上，'+(n===1?'通信工程':'计算机科学与技术')+'专业。</p></main>';
const list='<main><p>共2个岗位</p><ul>'+[1,2].map(n=>'<li class="job-card"><h3><a class="jobTitle" id="job-'+n+'" href="#/detail/'+n+'" onclick="event.preventDefault();openJob('+n+')">虚构单页岗位'+n+'</a></h3><p>学历要求：本科</p><p>工作地点：武汉市</p></li>').join('')+'</ul></main>';
function spaDocument(listMarkup, details) {
 const app = document.getElementById('app'), mode = new URL(location.href).searchParams.get('mode');
 let renderTimer, listGeneration = 0;
 function render(delayed) {
  clearTimeout(renderTimer);
  const n = Number(location.hash.split('/').pop());
  const paint = () => {
   if (!n && mode === 'dynamic-wrapper') {
    const wrapper = document.createElement('section'); wrapper.id = 'fictional-list-' + (++listGeneration); wrapper.innerHTML = listMarkup;
    for (const title of wrapper.querySelectorAll('a.jobTitle')) { title.removeAttribute('id'); title.removeAttribute('href'); }
    // The hidden copy forces a unique selector to include the recreated wrapper ID.
    const hidden = wrapper.cloneNode(true); hidden.id = 'fictional-hidden-list'; hidden.hidden = true;
    app.replaceChildren(wrapper, hidden);
   } else app.innerHTML = n ? details[n] : listMarkup;
  };
  if (delayed) renderTimer = setTimeout(paint, 1400); else paint();
 }
 window.openJob = n => {
  const navigate = () => { history[mode === 'replace' ? 'replaceState' : 'pushState']({}, '', '#/detail/' + n); render(false); };
  if (mode === 'delayed') setTimeout(navigate, 1400); else navigate();
 };
 addEventListener('popstate', () => render(true)); addEventListener('hashchange', () => render(true)); render(false);
}
const app=()=>'<div id="app"></div><script>('+spaDocument.toString()+')('+JSON.stringify(list)+','+JSON.stringify([null,detail(1),detail(2)])+');</script>';
async function until(check,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('condition timed out');}
(async()=>{
 const ext=path.join(testRoot,'extension');fs.cpSync(path.join(ROOT,'extension'),ext,{recursive:true});require('./access-fixture.cjs')(ext);
 const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify(manifest));
 server=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1');traffic.push(u.pathname);res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Cache-Control','no-store');if(u.pathname==='/guard'&&traffic.filter(p=>p==='/guard').length===2){res.statusCode=429;res.setHeader('Retry-After','60');return res.end('Too many requests');}if(['/app','/worker','/guard'].includes(u.pathname))return res.end(app());if(u.pathname==='/favicon.ico'){res.statusCode=204;return res.end();}res.statusCode=404;res.end('missing');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 context=await chromium.launchPersistentContext(path.join(testRoot,'profile'),{executablePath:process.env.BROWSER_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),source=await context.newPage();await source.goto(base+'/app#/list');
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,source.url());await worker.evaluate(async id=>openDashboard(await chrome.tabs.get(id)),tabId);
 const hub=context.pages().find(p=>p.url().includes('/jobs.html'));await hub.waitForLoadState();hub.setDefaultTimeout(25000);
 const nonce=await worker.evaluate(async id=>(await chrome.storage.session.get('jobBinding:'+id))['jobBinding:'+id].nonce,tabId);
 await hub.evaluate(binding=>{globalThis.spaBinding=binding;globalThis.spaRPC=async(action,data={})=>{const r=await chrome.runtime.sendMessage({type:'job-screen',action,...spaBinding,...data});if(!r.ok)throw Error(r.error);return r.result;};},{tabId,nonce});
 const run=await hub.evaluate(()=>spaRPC('access-begin',{speed:'fast'}));await hub.evaluate(ticket=>spaBinding.ticket=ticket,run.ticket);
 const first=await hub.evaluate(url=>spaRPC('load',{url}),base+'/worker#/detail/1');assert.equal(first.name,'虚构单页岗位1');
 const before=await worker.evaluate(()=>chrome.storage.session.get(null)),ownedKey=Object.keys(before).find(k=>k.startsWith('jobWorker:')),readerId=before[ownedKey].tabId;
 const second=await hub.evaluate(url=>spaRPC('load',{url}),base+'/worker#/detail/2');assert.equal(second.name,'虚构单页岗位2');assert.match(second.requirements,/计算机科学与技术/);assert.equal(traffic.filter(p=>p==='/worker').length,2);
 const saved=await worker.evaluate(()=>chrome.storage.session.get(null));assert.equal(saved[ownedKey].tabId,readerId);assert.equal(Object.keys(saved).filter(k=>k.startsWith('jobWorker:')).length,1);
 pass('hash-only reader reuse commits a fresh document and returns the requested job while retaining one owned worker');
 for(const mode of ['push','replace','delayed']){
  const original=base+'/app?mode='+mode+'#/list';await source.goto(original);await until(async()=>(await worker.evaluate(async id=>(await chrome.tabs.get(id)).url,tabId))===original);const prior=await hub.evaluate(()=>spaRPC('scan',{rule:{}}));assert.equal(prior.kind,'list');assert.equal(prior.jobs.length,2);assert.equal(prior.url,original);
  const resolved=await hub.evaluate(()=>spaRPC('resolve',{selector:'#job-1',expectedName:'虚构单页岗位1',rule:{}}));assert.equal(resolved,base+'/app?mode='+mode+'#/detail/1');assert.equal(source.url(),original);
  const restored=await hub.evaluate(()=>spaRPC('scan',{rule:{}}));assert.equal(restored.kind,'list');assert.equal(restored.scopeURL,prior.scopeURL);assert.equal(restored.signature,prior.signature);
  pass(mode+' hash navigation resolves and waits for the original list DOM after delayed restoration');
 }
 const dynamicURL=base+'/app?mode=dynamic-wrapper#/list';await source.goto(dynamicURL);await until(async()=>(await worker.evaluate(async id=>(await chrome.tabs.get(id)).url,tabId))===dynamicURL);
 const dynamicList=await hub.evaluate(()=>spaRPC('scan',{rule:{}}));assert.equal(dynamicList.jobs.length,2);
 const originalFirst=dynamicList.jobs[0],originalSecond=dynamicList.jobs[1];assert.ok(originalFirst.titleSelector);assert.match(originalSecond.titleSelector,/#fictional-list-/);
 const resolveEntry=raw=>hub.evaluate(job=>spaRPC('resolve',{selector:job.titleSelector,expectedName:job.name,expectedIdentity:job.id,rule:{}}),raw);
 assert.equal(await resolveEntry(originalFirst),base+'/app?mode=dynamic-wrapper#/detail/1');assert.equal(source.url(),dynamicURL);
 const recreatedList=await hub.evaluate(()=>spaRPC('scan',{rule:{}})),recreatedSecond=recreatedList.jobs.find(job=>job.id===originalSecond.id);
 assert.equal(recreatedList.signature,dynamicList.signature);assert.ok(recreatedSecond);assert.notEqual(recreatedSecond.titleSelector,originalSecond.titleSelector);
 assert.equal(await source.evaluate(css=>document.querySelector(css)===null,originalSecond.titleSelector),true);
 assert.equal(await resolveEntry(originalSecond),base+'/app?mode=dynamic-wrapper#/detail/2');assert.equal(source.url(),dynamicURL);
 const finalList=await hub.evaluate(()=>spaRPC('scan',{rule:{}}));assert.equal(finalList.scopeURL,dynamicList.scopeURL);assert.equal(finalList.signature,dynamicList.signature);
 pass('a stale second-job selector is relocated by its expected identity after SPA restoration recreates wrapper IDs');
 await source.evaluate(() => {
  globalThis.fixtureUnsafeClicks = 0;
  const wrapper = document.createElement('div'); wrapper.id = 'fictional-unsafe-controls';
  wrapper.innerHTML = '<a id="fictional-apply-anchor" href="/apply.html?jobId=fictional-unsafe"><span id="fictional-apply-child">虚构操作入口</span></a>' +
   '<a id="fictional-login-anchor" href="/portal#/login?jobId=fictional-unsafe"><span id="fictional-login-child">虚构操作入口</span></a>';
  for (const anchor of wrapper.querySelectorAll('a')) anchor.addEventListener('click', event => { event.preventDefault(); fixtureUnsafeClicks++; });
  document.body.append(wrapper);
 });
 try {
  for (const selector of ['#fictional-apply-anchor', '#fictional-apply-child', '#fictional-login-anchor', '#fictional-login-child']) {
   const result = await hub.evaluate(css => spaRPC('resolve', { selector: css, expectedName: '虚构操作入口', rule: {} }), selector);
   assert.equal(result, ''); assert.equal(source.url(), dynamicURL);
   assert.equal(await source.evaluate(() => fixtureUnsafeClicks), 0);
  }
  assert.equal(traffic.filter(url => ['/apply.html', '/portal'].includes(url)).length, 0);
 } finally { await source.evaluate(() => document.getElementById('fictional-unsafe-controls')?.remove()); }
 pass('direct resolve rejects application and hash-login anchors plus their child spans without firing a click');
 const guarded=await hub.evaluate(url=>spaRPC('load',{url}),base+'/guard#/detail/1');assert.equal(guarded.name,'虚构单页岗位1');
 await assert.rejects(hub.evaluate(url=>spaRPC('load',{url}),base+'/guard#/detail/2'),/429/);assert.equal(traffic.filter(p=>p==='/guard').length,2);
 const block=await worker.evaluate(async origin=>(await chrome.storage.session.get('jobAccessBlock:'+origin))['jobAccessBlock:'+origin],base);assert.ok(block.until>Date.now());
 pass('the fresh document still honors a real HTTP 429 from the reused reader and records the origin cooldown');
 await hub.evaluate(()=>spaRPC('close-worker'));await until(async()=>!Object.keys(await worker.evaluate(()=>chrome.storage.session.get(null))).some(k=>k.startsWith('jobWorker:')));
 const storage=await worker.evaluate(()=>Promise.all([chrome.storage.local.get(null),chrome.storage.session.get(null)]));assert.ok(!JSON.stringify(storage).includes('虚构单页岗位'));
 pass('closing the reader removes its owned tab and storage contains no fictional job records');
 console.log('SPA checks passed: '+passed);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await context?.close();await new Promise(r=>server?server.close(r):r());const p=path.resolve(testRoot);if(path.dirname(p)===TEMP&&path.basename(p).startsWith('job-spa-test-'))fs.rmSync(p,{recursive:true,force:true,maxRetries:3});});
