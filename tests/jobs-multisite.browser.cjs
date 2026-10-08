// Two isolated local origins, fictional jobs, production widget/control routing.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..'),tempRoot=fs.realpathSync(os.tmpdir()),testRoot=fs.mkdtempSync(path.join(tempRoot,'job-multi-test-'));
let context,servers=[],passed=0;const pass=s=>{passed++;console.log('PASS '+s);};
async function widget(page, selector, operation='text', value='') {
  const client=await context.newCDPSession(page);
  try {
    const {root}=await client.send('DOM.getDocument',{depth:-1,pierce:true});
    const find=n=>{if(n.attributes?.includes('job-screen-widget'))return n;for(const child of [...(n.children||[]),...(n.shadowRoots||[])]){const r=find(child);if(r)return r;}};
    const host=find(root),shadow=host?.shadowRoots?.[0];assert.ok(shadow,'closed widget shadow exists');
    const {object}=await client.send('DOM.resolveNode',{nodeId:shadow.nodeId});
    const result=await client.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(selector,operation,value){const n=this.querySelector(selector);if(!n)return null;if(operation==="click"){n.click();return true;}if(operation==="fill"){n.value=value;n.dispatchEvent(new Event("change",{bubbles:true}));return true;}return n.textContent;}',arguments:[{value:selector},{value:operation},{value}],returnByValue:true});
    return result.result.value;
  } finally {await client.detach();}
}
async function until(check,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,120));}throw Error('condition timed out');}
(async()=>{
  const ext=path.join(testRoot,'extension');fs.cpSync(path.join(ROOT,'extension'),ext,{recursive:true});
  require('./access-fixture.cjs')(ext);
  const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify(manifest));
  const bases=[];
  for(const name of ['A','B']){
    const server=http.createServer((req,res)=>{
      res.setHeader('Content-Type','text/html;charset=utf-8');const u=new URL(req.url,'http://127.0.0.1'),id=u.searchParams.get('id')||'1';
      if(u.pathname==='/list')res.end('<main><h1>虚构招聘集团-校招</h1><ul>'+[1,2].map(i=>'<li><h3><a href="/job/detail?id='+i+'">虚构'+name+i+'工程师</a></h3><p>工作地点：武汉</p><p>学历要求：本科及以上</p><h5>示例单位'+name+'</h5></li>').join('')+'</ul><p>共2个岗位</p></main>');
      else if(u.pathname==='/job/detail'){
        const professional=name==='A'&&id==='1'?'电气工程及其自动化专业':'理工类专业';
        const content='<h2 class="jobTitle">虚构'+name+id+'工程师</h2><h2>人资资格</h2><p>本科及以上，'+professional+'。</p><h2>工作职责</h2><p>负责电气设备维护。</p>';
        // Force two simultaneous rendered-detail workers rather than static-only fetches.
        res.end('<main><h1>虚构招聘集团-校招</h1><div id="detail"></div></main><script>setTimeout(()=>document.getElementById("detail").innerHTML='+JSON.stringify(content)+',1800);</script>');
      }else{res.statusCode=404;res.end('not found');}
    });
    servers.push(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));bases.push('http://127.0.0.1:'+server.address().port);
  }
  context=await chromium.launchPersistentContext(path.join(testRoot,'profile'),{executablePath:process.env.BROWSER_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,viewport:{width:1280,height:1050},ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),a=await context.newPage(),b=await context.newPage();await a.goto(bases[0]+'/list');await b.goto(bases[1]+'/list');
  const ids=await worker.evaluate(async urls=>Promise.all(urls.map(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id)),[a.url(),b.url()]);
  const created=context.waitForEvent('page');await worker.evaluate(async id=>JobScreenChannel.showMini(await chrome.tabs.get(id)),ids[0]);const hub=await created;hub.setDefaultTimeout(30000);const errors=[];hub.on('pageerror',e=>errors.push(e.message));
  await a.locator('#job-screen-widget').waitFor();assert.equal(await a.evaluate(()=>document.querySelector('#job-screen-widget').shadowRoot),null);
  assert.match(await widget(a,'section'),/开始检索/);assert.equal(await hub.locator('.job-row').count(),0);pass('toolbar flow opens a private styled widget and one inactive hub without starting collection');
  await hub.locator('#my-degree').selectOption('本科');await hub.locator('#my-major').fill('电气工程及其自动化');
  await widget(a,'[data-action=start]','click');await until(async()=>Number(await hub.locator('#session-count').textContent())===2);
  await widget(a,'[data-action=hide]','click');await until(()=>a.locator('#job-screen-widget').evaluate(e=>e.style.display==='none'));
  const bindingBefore=await worker.evaluate(async id=>(await chrome.storage.session.get('jobBinding:'+id))['jobBinding:'+id].nonce,ids[0]);
  await worker.evaluate(async id=>JobScreenChannel.showMini(await chrome.tabs.get(id)),ids[1]);
  assert.equal(context.pages().filter(p=>p.url().includes('/jobs.html')).length,1);assert.match(await widget(b,'.count'),/已发现 0/);
  pass('opening a second site reuses the hub and waits for its own start command');
  await widget(b,'[data-action=start]','click');
  await until(async()=>{const data=await worker.evaluate(()=>chrome.storage.session.get(null));return Object.keys(data).filter(k=>k.startsWith('jobWorker:')).length===2;});
  pass('two origins read details concurrently in separate owned work tabs');
  const unrelated=await context.newPage();await unrelated.goto('about:blank');await unrelated.bringToFront();
  await until(async()=>{const data=await widget(b,'.count');return /已读详情 2/.test(data);});
  await hub.locator('#task-source').selectOption('all');assert.equal(await hub.locator('.job-row').count(),4);
  const names=await hub.locator('.job-title').allTextContents();assert.equal(new Set(names).size,4);assert.ok(names.every(n=>/^虚构[AB][12]工程师$/.test(n)));assert.equal(names[0],'虚构A1工程师');
  assert.match(await hub.locator('.job-row').first().locator('.major-primary').textContent(),/电气工程及其自动化/);
  assert.match(await hub.locator('.job-row').filter({hasText:'虚构A2工程师'}).textContent(),/宽泛范围匹配/);
  pass('hidden widget collection completes while browsing another tab and merged results retain real job names with major matches first');
  await worker.evaluate(async id=>JobScreenChannel.showMini(await chrome.tabs.get(id)),ids[0]);
  assert.equal(await worker.evaluate(async id=>(await chrome.storage.session.get('jobBinding:'+id))['jobBinding:'+id].nonce,ids[0]),bindingBefore);
  await widget(a,'[data-action=favorite]','click');await until(async()=>Object.keys((await worker.evaluate(()=>chrome.storage.local.get('jobFavorites'))).jobFavorites||{}).length===1);
  await widget(a,'[data-action=clear]','click');await until(async()=>/已发现 0/.test(await widget(a,'.count')));
  await hub.locator('#task-source').selectOption('all');assert.equal(await hub.locator('.job-row').count(),2);assert.ok((await hub.locator('.job-title').allTextContents()).every(n=>n.startsWith('虚构B')));
  assert.equal(Object.keys((await worker.evaluate(()=>chrome.storage.local.get('jobFavorites'))).jobFavorites).length,1);
  pass('reopening preserves task identity and ending one source clears only its unsaved results');
  await widget(b,'input','fill','电气');await until(async()=>await hub.locator('#filter-major').inputValue()==='电气');
  await widget(b,'[data-action=focus]','click');await until(async()=>new RegExp('^'+ids[1]+':').test(await hub.locator('#task-source').inputValue()));
  await hub.getByRole('button',{name:'虚构B1工程师',exact:true}).click();assert.match(await hub.locator('#detail-body').textContent(),/本科目录门类.*工学/);await hub.locator('#detail-close').click();
  pass('widget filters and source navigation share the hub criteria and broad-major evidence');
  const previews=path.join(ROOT,'docs','preview');fs.mkdirSync(previews,{recursive:true});await b.screenshot({path:path.join(previews,'网站小窗.png')});
  await b.goto(bases[1]+'/list?next=2');await b.locator('#job-screen-widget').waitFor();await until(async()=>/已发现 2/.test(await widget(b,'.count')));
  pass('a visible widget reconnects after same-origin page navigation and retains its task');
  await widget(b,'[data-action=hide]','click');await until(async()=>(await worker.evaluate(async id=>chrome.storage.session.get('jobWidget:'+id),ids[1]))['jobWidget:'+ids[1]]===false);
  await b.goto(bases[1]+'/list?next=3');await b.waitForTimeout(250);assert.equal(await b.locator('#job-screen-widget').count(),0);
  await worker.evaluate(async id=>JobScreenChannel.showMini(await chrome.tabs.get(id)),ids[1]);await until(async()=>/已发现 2/.test(await widget(b,'.count')));
  pass('a hidden widget stays hidden across navigation and can reopen with the same completed task');
  const stored=await worker.evaluate(async()=>({local:await chrome.storage.local.get(null),session:await chrome.storage.session.get(null)}));
  assert.equal(stored.local.jobDataset,undefined);assert.equal(stored.local.jobFilters,undefined);assert.ok(!JSON.stringify(stored.session).includes('虚构B1工程师'));
  await hub.reload();await hub.locator('#tab-favorites[aria-selected=true]').waitFor();await until(async()=>Number(await hub.locator('#session-count').textContent())===0);assert.equal(await hub.locator('.job-row').count(),1);
  await until(async()=>/本轮未收藏结果已清空/.test(await widget(b,'.status')));
  pass('hub reload discards all ordinary multi-site data and notifies source widgets while retaining favorites');
  await worker.evaluate(async id=>JobScreenChannel.showMini(await chrome.tabs.get(id)),ids[1]);await widget(b,'[data-action=start]','click');
  await until(async()=>Object.keys(await worker.evaluate(()=>chrome.storage.session.get(null))).some(k=>k.startsWith('jobWorker:')));
  await widget(b,'[data-action=clear]','click');await until(async()=>/已发现 0/.test(await widget(b,'.count')));
  await until(async()=>!Object.keys(await worker.evaluate(()=>chrome.storage.session.get(null))).some(k=>k.startsWith('jobWorker:')));
  await b.waitForTimeout(2000);assert.match(await widget(b,'.count'),/已发现 0/);assert.equal(Object.keys((await worker.evaluate(()=>chrome.storage.local.get('jobFavorites'))).jobFavorites).length,1);
  pass('ending a task during dynamic detail loading removes its reader and rejects late results');
  await widget(b,'[data-action=start]','click');await until(async()=>Object.keys(await worker.evaluate(()=>chrome.storage.session.get(null))).some(k=>k.startsWith('jobWorker:')));
  await b.goto('about:blank');await hub.locator('#status').filter({hasText:'已切换网站'}).waitFor();
  await until(async()=>!Object.keys(await worker.evaluate(()=>chrome.storage.session.get(null))).some(k=>k.startsWith('jobWorker:')));
  assert.ok(!(await hub.locator('#collect').textContent()).includes('采集中'));
  pass('navigating the active source tab to another website stops further reads and removes its detail reader');
  await b.goto(bases[1]+'/list');await worker.evaluate(async id=>JobScreenChannel.showMini(await chrome.tabs.get(id)),ids[1]);
  const oldTask=await hub.locator('#task-source').inputValue();
  await widget(b,'[data-action=start]','click');await until(async()=>Object.keys(await worker.evaluate(()=>chrome.storage.session.get(null))).some(k=>k.startsWith('jobWorker:')));
  await b.goto(bases[0]+'/list');await worker.evaluate(async id=>JobScreenChannel.showMini(await chrome.tabs.get(id)),ids[1]);await widget(b,'[data-action=start]','click');
  await until(async()=>Object.keys(await worker.evaluate(()=>chrome.storage.session.get(null))).some(k=>k.startsWith('jobWorker:')));
  await hub.locator('#task-source').selectOption(oldTask);await hub.locator('#end-task').click();
  await until(async()=>/已读详情 2/.test(await widget(b,'.count')));assert.match(await widget(b,'section'),/虚构A1工程师/);
  assert.ok(await hub.locator('#task-source option').filter({hasText:'已离开'}).count()>0);
  pass('quickly starting a new site in the same tab and clearing the old task cannot cancel the new reader');
  await widget(b,'[data-action=start]','click');await until(async()=>Object.keys(await worker.evaluate(()=>chrome.storage.session.get(null))).some(k=>k.startsWith('jobWorker:')));
  const closing=hub.waitForEvent('close');await hub.locator('#app-close').click();await closing;
  await until(async()=>!Object.keys(await worker.evaluate(()=>chrome.storage.session.get(null))).some(k=>k.startsWith('jobWorker:')));
  assert.equal(a.isClosed(),false);assert.equal(b.isClosed(),false);assert.deepEqual(errors,[]);
  pass('closing the hub stops owned readers and leaves both recruitment pages open');
  console.log('Multi-site checks passed: '+passed);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  await context?.close();await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));
  const target=path.resolve(testRoot);if(path.dirname(target)===tempRoot&&path.basename(target).startsWith('job-multi-test-'))fs.rmSync(target,{recursive:true,force:true,maxRetries:3});
});
