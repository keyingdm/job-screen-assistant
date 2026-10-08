// Production interval and permissions; isolated profile, fictional localhost sites only.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..'),tempRoot=fs.realpathSync(os.tmpdir()),testRoot=fs.mkdtempSync(path.join(tempRoot,'job-access-test-'));
let context,servers=[],hub,worker,passed=0;const pass=s=>{passed++;console.log('PASS '+s);};
async function until(check,timeout=35000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('condition timed out');}
async function site(kind){
  const traffic=[],counts=new Map(),server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1'),id=u.searchParams.get('id');traffic.push({path:u.pathname,id,at:Date.now()});res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Cache-Control','no-store');
    if(u.pathname==='/favicon.ico'){res.statusCode=204;return res.end();}
    if(u.pathname==='/denied'){res.statusCode=403;return res.end('Access denied');}
    if(u.pathname==='/more'||u.pathname==='/api'){res.statusCode=kind==='list403'?403:429;res.setHeader('Retry-After','1800');return res.end('{}');}
    if(u.pathname==='/list'){
      const n=kind==='full'?7:kind==='rate'?2:3;
      const items=Array.from({length:n},(_,i)=>'<li><h3><a href="/detail?id='+(i+1)+'&tab='+(u.searchParams.get('tab')||'1')+'">虚构保护岗位'+(i+1)+'</a></h3><p>工作地点：武汉</p><p>学历要求：本科及以上</p>'+(kind==='full'?'<h4>任职要求</h4><p>本科及以上，专业不限。</p>':'')+'</li>').join('');
      return res.end('<main><h1>虚构招聘列表</h1><ul>'+items+'</ul><p>共'+(kind==='list403'?6:n)+'个岗位</p>'+(kind==='list403'?'<nav class="pagination"><button onclick="fetch(\'/more\')">下一页</button></nav>':'')+'</main>');
    }
    if(u.pathname==='/detail'){
      counts.set(id,(counts.get(id)||0)+1);
      if(id==='2'){
        if(kind==='403'||kind==='429'){res.statusCode=Number(kind);res.setHeader('Retry-After','1800');return res.end('');}
        if(kind==='captcha')return res.end('<main><h1>安全验证</h1><p>请完成验证后继续</p></main>');
        if(kind==='dynamic403'&&counts.get(id)>1){res.statusCode=403;return res.end('');}
        if(kind==='dynamic403')return res.end('<main><h1>虚构动态岗位</h1><div id="detail"></div></main>');
        if(kind==='xhr429')return res.end('<main><h1>虚构动态岗位</h1></main><script>fetch("/api")</script>');
      }
      return res.end('<main><h1>虚构保护岗位'+id+'</h1><h2>任职要求</h2><p>本科及以上，专业不限。</p></main>');
    }
    res.statusCode=404;res.end('not found');
  });
  servers.push(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));return {base:'http://127.0.0.1:'+server.address().port,traffic};
}
async function bind(base,query=''){
  const source=await context.newPage();await source.goto(base+'/list'+query);
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,source.url());
  await worker.evaluate(async id=>openDashboard(await chrome.tabs.get(id)),tabId);
  if(!hub){hub=context.pages().find(p=>p.url().includes('/jobs.html'));hub.setDefaultTimeout(35000);}
  await until(async()=>hub.locator('#task-source option').evaluateAll((nodes,id)=>nodes.some(n=>n.value.startsWith(id+':')),tabId));
  const value=await hub.locator('#task-source option').evaluateAll((nodes,id)=>nodes.find(n=>n.value.startsWith(id+':')).value,tabId);await hub.locator('#task-source').selectOption(value);
  return {source,tabId};
}
async function completed(){await until(async()=>!(await hub.locator('#collect').textContent()).includes('采集中')); }
(async()=>{
  const ext=path.join(testRoot,'extension');fs.cpSync(path.join(ROOT,'extension'),ext,{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(path.join(testRoot,'profile'),{executablePath:process.env.BROWSER_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,viewport:{width:1280,height:1050},ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const rate=await site('rate');await bind(rate.base,'?tab=1');await hub.locator('#collect').click();await bind(rate.base,'?tab=2');await hub.locator('#collect').click();
  const unmanaged=await context.newPage();await unmanaged.goto(rate.base+'/denied');
  await until(async()=>rate.traffic.filter(r=>r.path==='/detail').length===4);await completed();await until(async()=>(await hub.locator('#task-list').textContent()).match(/已结束/g)?.length===2);
  const times=rate.traffic.filter(r=>r.path==='/detail').map(r=>r.at);assert.ok(times.slice(1).every((t,i)=>t-times[i]>=2800),JSON.stringify(times));
  pass('real production pacing serializes two same-origin tabs at least three seconds per controlled operation');
  assert.equal(await hub.locator('.job-row').count(),2);pass('an unrelated tab refusal does not stop the active source tasks');
  for(const kind of ['403','429','captcha','dynamic403','xhr429','list403']){
    const fixture=await site(kind);await bind(fixture.base);await hub.locator('#collect').click();
    await hub.locator('#status').filter({hasText:kind==='captcha'?'验证':kind==='403'||kind==='dynamic403'||kind==='list403'?'403':'429'}).waitFor();await completed();
    assert.equal(fixture.traffic.filter(r=>r.path==='/detail'&&r.id==='3').length,0,kind+' must not visit job 3');
    if(kind==='list403')assert.equal(fixture.traffic.filter(r=>r.path==='/detail').length,0);
    else assert.equal(fixture.traffic.filter(r=>r.path==='/detail'&&r.id==='1').length,1);
    if(kind==='403'||kind==='429'||kind==='captcha')assert.equal(fixture.traffic.filter(r=>r.path==='/detail'&&r.id==='2').length,1,'no dynamic fallback after refusal');
    const prior=fixture.traffic.length;await hub.locator('#collect').click();await completed();await hub.waitForTimeout(250);assert.equal(fixture.traffic.length,prior,'cooldown prevents manual retry requests');
    const block=await worker.evaluate(async origin=>(await chrome.storage.session.get('jobAccessBlock:'+origin))['jobAccessBlock:'+origin],fixture.base);
    assert.ok(block.until>Date.now()+500000);if(kind==='429'||kind==='xhr429')assert.ok(block.until>Date.now()+1700000);
    assert.equal(await hub.locator('.job-row').count(),3);
    await until(async()=>!Object.keys(await worker.evaluate(()=>chrome.storage.session.get(null))).some(k=>k.startsWith('jobWorker:')));
    pass(kind+' stops the source, preserves partial results, releases its reader and respects the cooldown');
  }
  const full=await site('full'),bound=await bind(full.base);await hub.locator('#collect').click();await hub.locator('#status').filter({hasText:'本次采集结束'}).waitFor();await completed();
  await worker.evaluate(async id=>JobScreenChannel.showMini(await chrome.tabs.get(id)),bound.tabId);await bound.source.locator('#job-screen-widget').waitFor();
  const client=await context.newCDPSession(bound.source),{root}=await client.send('DOM.getDocument',{depth:-1,pierce:true});
  const find=n=>{if(n.attributes?.includes('job-screen-widget'))return n;for(const ch of [...(n.children||[]),...(n.shadowRoots||[])]){const result=find(ch);if(result)return result;}};
  const shadow=find(root).shadowRoots[0],{object}=await client.send('DOM.resolveNode',{nodeId:shadow.nodeId});
  const result=await client.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){return {count:this.querySelectorAll(".job-name").length,scroll:this.querySelector("section").scrollHeight>this.querySelector("section").clientHeight};}',returnByValue:true});await client.detach();
  assert.equal(result.result.value.count,7);assert.equal(result.result.value.scroll,true);assert.equal(await hub.locator('.job-row').count(),7);
  fs.mkdirSync(path.join(ROOT,'docs','preview'),{recursive:true});await bound.source.screenshot({path:path.join(ROOT,'docs','preview','小窗全部结果.png')});
  pass('the real hub-to-widget flow displays all seven filtered jobs in a scrollable small window');
  const detection=await hub.evaluate(()=>{
    const html='<main><h1>虚构研发岗位</h1><h2>任职资格</h2><p>了解验证码系统的研发，计算机专业。</p><div id="captcha" hidden>请输入验证码</div></main>';
    return {negative:JobScreenAccess.detectDocument(new DOMParser().parseFromString(html,'text/html')),positive:JobScreenAccess.detectDocument(new DOMParser().parseFromString('<main><div id="captcha">请输入图形验证码</div></main>','text/html'))};
  });assert.equal(detection.negative,null);assert.equal(detection.positive.kind,'captcha');
  pass('hidden captcha templates and job descriptions remain readable while explicit verification controls stop collection');
  const stored=await worker.evaluate(()=>chrome.storage.session.get(null));assert.ok(!JSON.stringify(stored).includes('虚构保护岗位'));
  pass('protection persistence stores cooldown metadata only and no ordinary job contents');
  console.log('Access protection checks passed: '+passed);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  await context?.close();await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));
  const target=path.resolve(testRoot);if(path.dirname(target)===tempRoot&&path.basename(target).startsWith('job-access-test-'))fs.rmSync(target,{recursive:true,force:true,maxRetries:3});
});
