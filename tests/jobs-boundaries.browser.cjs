// Unlimited-count regression with isolated browser data and fictional localhost jobs only.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..'),tempRoot=fs.realpathSync(os.tmpdir()),testRoot=fs.mkdtempSync(path.join(tempRoot,'job-boundaries-test-'));
let context,server,passed=0;const visited=[],pass=s=>{passed++;console.log('PASS '+s);};
async function until(check,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('condition timed out');}
(async()=>{
  const ext=path.join(testRoot,'extension');fs.cpSync(path.join(ROOT,'extension'),ext,{recursive:true});require('./access-fixture.cjs')(ext);
  const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify(manifest));
  server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1');res.setHeader('Content-Type','text/html;charset=utf-8');
    if(u.pathname==='/favicon.ico'){res.statusCode=204;return res.end();}
    const p=Number(u.searchParams.get('page')||1);visited.push(p);
    if(u.pathname!=='/list'||p<1||p>35){res.statusCode=404;return res.end();}
    const cards=Array.from({length:20},(_,i)=>{const id=(p-1)*20+i+1;return '<li><h3><a href="/detail?id='+id+'">虚构批量岗位'+id+'</a></h3><p>示例测试单位</p><p>工作地点：武汉</p><p>本科及以上</p><h4>任职要求</h4><p>电子信息类等相关专业。</p></li>';}).join('');
    res.end('<main><h1>虚构批量招聘列表</h1><ul>'+cards+'</ul><p>共700个岗位</p><nav class="pagination"><span aria-current="page">'+p+'</span>'+(p<35?'<a rel="next" href="/list?page='+(p+1)+'">下一页</a>':'<button disabled>下一页</button>')+'</nav></main>');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  context=await chromium.launchPersistentContext(path.join(testRoot,'profile'),{executablePath:process.env.BROWSER_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,viewport:{width:1280,height:950},ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),source=await context.newPage();await source.goto(base+'/list?page=1');
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,source.url());await worker.evaluate(async id=>JobScreenChannel.showMini(await chrome.tabs.get(id)),tabId);
  const hub=context.pages().find(p=>p.url().includes('/jobs.html'));hub.setDefaultTimeout(90000);await hub.locator('#my-degree').selectOption('本科');await hub.locator('#collect').click();
  await hub.locator('#status').filter({hasText:'本次采集结束'}).waitFor();
  assert.equal(await hub.locator('#session-count').textContent(),'700');assert.equal(await hub.locator('#stats .stat strong').first().textContent(),'700');assert.match(await hub.locator('#coverage').textContent(),/已读 35 页/);assert.match(await hub.locator('#coverage').textContent(),/与页面报告数量一致/);
  assert.equal(new Set(visited).size,35);assert.match(source.url(),/page=35/);
  pass('actual automatic navigation covers all 35 pages and 700 jobs without the former count caps');
  assert.equal(await hub.locator('.job-row').count(),25);assert.equal(await hub.locator('.job-row').filter({hasText:'本科及以上'}).count(),25);assert.equal(await hub.locator('.job-row').filter({hasText:'学历冲突'}).count(),0);
  await hub.locator('#filter-query').fill('虚构批量岗位700');assert.equal(await hub.locator('.job-row').count(),1);assert.match(await hub.locator('.job-row').textContent(),/本科及以上/);
  pass('the final job remains searchable and top degree metadata is available in the real result table');
  await hub.locator('#filter-query').fill('');await source.locator('#job-screen-widget').waitFor();
  const client=await context.newCDPSession(source),{root}=await client.send('DOM.getDocument',{depth:-1,pierce:true});
  const find=n=>{if(n.attributes?.includes('job-screen-widget'))return n;for(const c of [...(n.children||[]),...(n.shadowRoots||[])]){const r=find(c);if(r)return r;}};
  const {object}=await client.send('DOM.resolveNode',{nodeId:find(root).shadowRoots[0].nodeId});
  let count=0;await until(async()=>{const out=await client.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){return this.querySelectorAll(".job-name").length;}',returnByValue:true});count=out.result.value;return count===700;});await client.detach();
  assert.equal(count,700);pass('the source widget receives all 700 filtered results without truncation');
  const favorites=await worker.evaluate(()=>chrome.storage.local.get('jobFavorites'));assert.equal(Object.keys(favorites.jobFavorites||{}).length,0);
  await hub.locator('#end-task').click();assert.equal(await hub.locator('#session-count').textContent(),'0');
  pass('large ordinary results can be ended and cleared without being persisted as favorites');
  console.log('Large collection checks passed: '+passed);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  await context?.close();await new Promise(r=>server?server.close(r):r());const target=path.resolve(testRoot);if(path.dirname(target)===tempRoot&&path.basename(target).startsWith('job-boundaries-test-'))fs.rmSync(target,{recursive:true,force:true,maxRetries:3});
});
