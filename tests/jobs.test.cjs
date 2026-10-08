const test = require('node:test'), assert = require('node:assert/strict');
const J = require('../extension/jobs-core.js'), C = require('../extension/jobs-collector.js');
const A = require('../extension/jobs-access.js');
const job = (requirements, extra = {}) => J.normalize({ id: 'test', name: '测试岗位', jobRequirements: requirements, ...extra });
test('minimum degree, preference and restricted degree differ', () => {
  assert.equal(J.evaluate(job('本科及以上学历，硕士优先'), { degree: '本科' }).state, 'pass');
  assert.equal(J.evaluate(job('硕士及以上学历'), { degree: '本科' }).state, 'fail');
  assert.equal(J.evaluate(job('仅限本科学历'), { degree: '硕士' }).state, 'fail');
  assert.equal(J.evaluate(job('本科学历'), { degree: '硕士' }).state, 'review');
  assert.equal(J.evaluate(job('硕士优先'), { degree: '本科' }).state, 'review');
});
test('missing degree and exceptional admission remain reviewable', () => {
  assert.equal(J.evaluate(job('熟悉计算机'), { degree: '本科' }).state, 'review');
  assert.equal(J.evaluate(job('硕士及以上学历，优秀者可放宽至本科'), { degree: '本科' }).state, 'review');
  assert.equal(J.evaluate(job('学历不限'), { degree: '专科' }).state, 'pass');
  assert.equal(J.evaluate(job('本科以上（不含本科）'), { degree: '本科' }).state, 'review');
});
test('major categories do not become automatic rejections', () => {
  assert.equal(J.evaluate(job('电子信息类相关专业'), { major: '电子信息科学与技术' }).state, 'review');
  assert.equal(J.evaluate(job('电子信息科学与技术、通信工程专业'), { major: '电子信息科学与技术' }).state, 'pass');
  assert.equal(J.evaluate(job('专业不限'), { major: '电子信息科学与技术' }).state, 'pass');
  assert.equal(J.evaluate(job('不接受电子信息科学与技术专业'), { major: '电子信息科学与技术' }).state, 'fail');
});
test('explicit years and year ranges are distinguished from preference', () => {
  assert.equal(J.evaluate(job('2027届应届毕业生'), { year: '2026' }).state, 'fail');
  assert.equal(J.evaluate(job('2026-2027届毕业生'), { year: '2026' }).state, 'pass');
  assert.equal(J.evaluate(job('2027届优先'), { year: '2026' }).state, 'review');
});
test('campus label does not override experience requirements', () => {
  assert.equal(J.evaluate(job('本科及以上，3年以上审计从业经历', { positionType: 0 }), { degree: '本科', experience: '0' }).state, 'fail');
  assert.equal(J.evaluate(job('有3年以上工作经验者优先'), { experience: '0' }).state, 'review');
  assert.equal(J.evaluate(job('无工作经验要求'), { experience: '0' }).state, 'pass');
  assert.equal(J.evaluate(job('1年实习经验'), { experience: '0' }).state, 'review');
  assert.equal(J.experienceInfo('十一年以上工作经验').min, 11);
  assert.equal(J.evaluate(job('工作年限不超过三年工作经验'), { experience: '0' }).state, 'review');
});
test('English threshold and other qualifications surface evidence', () => {
  assert.equal(J.evaluate(job('英语六级及以上'), { english: '1' }).state, 'fail');
  assert.equal(J.evaluate(job('英语四级及以上'), { english: '2' }).state, 'pass');
  assert.equal(J.evaluate(job('英语六级或雅思6.5'), { english: '1' }).state, 'review');
  assert.equal(J.evaluate(job('本科及以上学历，需持职业资格证书'), { degree: '本科' }).state, 'review');
});
test('China cutoff date handles 24:00 and ignores expireFlag as expiry', () => {
  assert.equal(J.deadline('2026-10-08 24:00:00'), Date.parse('2026-10-09T00:00:00+08:00'));
  assert.equal(J.deadline('2026-02-31'), null);
  assert.equal(J.deadline('2026-10-08 24:10:00'), null);
  assert.equal(J.deadline('2026-10-08 12:60:00'), null);
  assert.equal(J.deadline('2026-10-08 12:00:60'), null);
  assert.equal(J.deadline('2026-10-08T12:00:00Z'), Date.parse('2026-10-08T12:00:00Z'));
  assert.equal(J.deadline('2026-10-08T12:00:00-05:00'), Date.parse('2026-10-08T12:00:00-05:00'));
  assert.equal(J.evaluate(job('本科及以上', { expireFlag: true, closeDate: '2026-10-08' }), { degree: '本科' }, Date.parse('2026-10-07T12:00:00+08:00')).state, 'pass');
  assert.equal(J.evaluate(job('本科及以上', { closeDate: '2026-10-08' }), { degree: '本科' }, Date.parse('2026-10-09T00:00:01+08:00')).state, 'fail');
});
test('filters combine across fields, use OR within a field and keep unknowns', () => {
  const jobs = [job('本科及以上，电子信息科学与技术专业', { id: '1', cityName: '武汉', org: '示例软件', jobDescription: '软件测试' }), job('硕士及以上，计算机专业', { id: '2', cityName: '深圳', jobDescription: '算法研究' }), job('相关专业', { id: '3', cityName: '武汉', jobDescription: '驻场支持' })];
  assert.equal(J.filter(jobs, { degree: '本科' }, { city: '武汉,深圳', hideConflicts: true }).length, 2);
  assert.equal(J.filter(jobs, {}, { city: '武汉', exclude: '驻场', role: '测试,嵌入式' }).length, 1);
  assert.equal(J.filter(jobs, {}, { favorite: true }, { 'page:1': { favorite: true } }).length, 1);
});
test('URLs, imported HTML and CSV formula injection are safe', () => {
  const j = job('<script>alert(1)</script>本科及以上', { url: 'javascript:alert(1)', name: '=HYPERLINK("x")' });
  assert.equal(j.url, ''); assert.ok(!j.requirements.includes('<script>'));
  assert.ok(J.csv([{ job: j, match: J.evaluate(j, {}), mark: {} }]).includes("'=HYPERLINK"));
});

const raw = (id, more = {}) => ({ id, url: 'https://example.test/job/detail?id=' + id, name: '虚构岗位' + id, requirements: '本科及以上，专业不限。', collectionState: 'read', linkKind: 'detail', ...more });
test('short professional keywords match longer names even without a major label', () => {
  const matching = job('本科及以上，电子信息科学与技术、通信工程。', {id:'major-hit'});
  const other = job('专业要求：法学。', {id:'other'});
  assert.equal(J.filter([matching,other],{}, {major:'电子信息'}).length,1);
  assert.equal(J.filter([matching],{}, {major:'电子 信息'}).length,1);
  const check=J.evaluate(matching,{major:'电子信息'}).checks.find(c=>c.label==='专业');
  assert.equal(check.state,'review');assert.match(check.reason,/完整专业名称/);assert.match(check.evidence,/电子信息科学与技术/);
  assert.equal(J.evaluate(matching,{major:'电子信息科学与技术'}).state,'pass');
  assert.equal(J.evaluate(job('电子信息类相关专业'),{major:'电子信息'}).state,'review');
});
test('major keyword filters retain unread records and unrestricted majors',()=>{
  const pending=job('',{id:'pending',collectionState:'pending'}),any=job('专业不限',{id:'any'}),different=job('法学专业',{id:'different'});
  assert.deepEqual(J.filter([pending,any,different],{}, {major:'电子信息'}).map(r=>r.job.id).sort(),['any','pending']);
});
test('partial major searches work across disciplines and arbitrary field values',()=>{
  for (const [query,full] of [['电气','电气工程及其自动化'],['机械','机械设计制造及其自动化'],['计算机','计算机科学与技术'],['金融','金融工程'],['法学','法学'],['星图','数字星图学']]) {
    assert.equal(J.matchMajor({requirements:'熟悉业务系统',majorRequirements:full},query).hit,true,full);
    assert.equal(J.matchMajor('专业要求：'+full,query).hit,true,full);
  }
  assert.equal(J.matchMajor('电气工程及其自动化','电 气').hit,true);
  assert.equal(J.matchMajor('所学专业：机械设计制造及其自动化','金融,机械').hit,true);
});
test('equipment, work and professional skills do not become major evidence',()=>{
  for(const line of ['熟悉电气设备','具有机械设计经验','掌握计算机网络','具备金融市场分析能力','熟悉法学专业知识','专业知识：熟悉电气设备','技能要求：软件工程','不要求电气工程及其自动化专业']) {
    const m=J.matchMajor(line,'电气,机械,计算机,金融,法学,软件');
    assert.equal(m.hit,false,line);assert.equal(m.state,'unknown',line);
  }
  const mixed=job('专业要求：机械类，熟悉电气设备');
  assert.equal(J.matchMajor(mixed,'电气').state,'different');
  assert.ok(!mixed.facts.major.includes('电气设备'));
  assert.equal(J.matchMajor('具有电气工程及其自动化专业背景','电气').hit,true);
});
test('unknown major scopes stay visible by default and strict search is explicit',()=>{
  const jobs=[job('专业要求：电气类',{id:'hit'}),job('专业不限',{id:'any'}),job('理工科相关专业',{id:'broad'}),job('熟悉电气设备',{id:'skill'}),job('专业要求：法学',{id:'other'}),job('不接受电气类专业',{id:'excluded'})];
  assert.deepEqual(J.filter(jobs,{}, {major:'电气'}).map(r=>r.job.id).sort(),['any','broad','hit','skill']);
  assert.deepEqual(J.filter(jobs,{}, {major:'电气',majorMode:'hit'}).map(r=>r.job.id),['hit']);
  assert.equal(J.matchMajor(jobs[3],'电气').label,'未检测到专业要求');
});
test('full-name eligibility requires a professional scope and name boundaries',()=>{
  assert.equal(J.evaluate(job('熟悉计算机科学与技术'),{major:'计算机科学与技术'}).state,'review');
  assert.equal(J.evaluate(job('应用物理学专业'),{major:'物理学'}).state,'review');
  assert.equal(J.evaluate(job('专业要求：电气类'),{major:'电气'}).state,'review');
  assert.equal(J.evaluate(job('电气工程及其自动化专业'),{major:'电气工程及其自动化'}).state,'pass');
  assert.equal(J.evaluate(job('法学专业'),{major:'法学'}).state,'pass');
  assert.equal(J.evaluate(job('软件工程专业优先'),{major:'软件工程'}).state,'review');
  assert.equal(J.evaluate(job('原则上要求金融工程专业'),{major:'金融工程'}).state,'review');
});
test('major exclusions precede unrestricted statements and use verified categories',()=>{
  const p={degree:'本科',major:'电气工程及其自动化'};
  for(const req of ['不接受电气工程及其自动化专业','专业不限（电气类除外）','专业不限；电气类除外','专业不限；不接受电气类专业','除电气类专业外均可'])
    assert.equal(J.evaluate(job(req),p).state,'fail',req);
  assert.equal(J.evaluate(job('不接受非电气类专业'),p).state,'review');
  assert.equal(J.evaluate(job('接受电气工程及其自动化专业；不接受电气工程及其自动化专业'),p).state,'review');
  assert.equal(J.majors.assess('专业不限；不接受法学专业',p).state,'pass');
  assert.equal(J.evaluate(job('专业不限；电气类除外'),{major:'电气'}).state,'review');
  assert.equal(J.majors.assess('专业不限；电气类除外',{degree:'硕士',major:'电气工程及其自动化'}).state,'review');
});
test('official undergraduate catalogue carries provenance and limited category inference',()=>{
  const cat=J.majors.catalog;
  assert.equal(cat.version,'moe-undergraduate-2026');assert.equal(cat.majors.length,883);assert.equal(Object.keys(cat.categories).length,92);
  assert.equal(J.majors.lookup('电子信息科学与技术').categoryName,'电子信息类');
  assert.equal(J.majors.lookup('电气工程及其自动化').categoryName,'电气类');
  assert.equal(J.majors.lookup('数字星图学'),null);
  const j=job('电子信息类相关专业'),p={degree:'本科',major:'电子信息科学与技术'};
  assert.match(J.evaluate(j,p).checks.find(c=>c.label==='专业').reason,/2026年教育部目录/);
  assert.equal(J.evaluate(j,p).state,'review');
  assert.doesNotMatch(J.evaluate(j,{...p,degree:'硕士'}).checks.find(c=>c.label==='专业').reason,/目录关系/);
  assert.equal(J.majors.assess('按2020年专业目录；专业不限；电气类除外',{degree:'本科',major:'电气工程及其自动化'}).state,'review');
  assert.match(cat.source,/^https:\/\/www\.moe\.gov\.cn\//);assert.match(cat.pdfSha256,/^[a-f0-9]{64}$/);
});
test('independent major fields and old favorite text both normalize into evidence',()=>{
  const j=job('本科及以上；熟悉电气设备',{majorRequirements:'机械设计制造及其自动化'});
  assert.equal(j.majorRequirements,'机械设计制造及其自动化');assert.match(j.facts.major,/机械/);assert.doesNotMatch(j.facts.major,/电气/);
  assert.equal(J.evaluate(j,{major:'机械设计制造及其自动化'}).state,'pass');
  assert.match(J.csv([{job:j,match:J.evaluate(j,{}),mark:{}}]),/机械设计制造及其自动化/);
  const restored=J.normalize(JSON.parse(JSON.stringify(j)));assert.equal(restored.majorRequirements,j.majorRequirements);
  assert.equal(J.matchMajor(job('专业要求：金融学'),'金融').hit,true);
});
const listing = (ids, next = false, more = {}) => ({ jobs: ids.map(id => raw(id)), next, total: 3, signature: ids.join('|'), pageNumber: 1, ...more });
const options = (session, more = {}) => ({ session, read: async () => listing(['1','2'], true), next: async () => listing(['3'], false, {pageNumber:2}), resolveLink: async () => '', readDetail: async () => ({}), delay: 0, ...more });
test('generic collector follows observed pages and reports scoped counts', async () => {
  const d = C.session('https://example.test/list?city=武汉'), updates = [];
  await C.collect(options(d, { onUpdate:s=>updates.push(s.jobs.length) }));
  assert.equal(d.jobs.length,3); assert.equal(d.pages,2); assert.equal(d.complete,true); assert.ok(updates.includes(2));
  assert.equal(d.sourceURL,'https://example.test/list?city=武汉');
});
test('unknown or incomplete total never claims full coverage', async () => {
  const d=C.session('https://example.test/list');
  await C.collect(options(d,{read:async()=>listing(['1'],false,{total:null})}));
  assert.equal(d.complete,false); assert.equal(d.stage,'done');
  const middle=C.session(d.sourceURL);
  await C.collect(options(middle,{read:async()=>listing(['1','2','3'],false,{pageNumber:4})}));
  assert.equal(middle.complete,false); assert.equal(middle.startedMidList,true);
});
test('repeated pages stop rather than reporting completion', async () => {
  const d=C.session('https://example.test/list');
  await assert.rejects(C.collect(options(d,{next:async()=>listing(['1','2'],true)})),/内容|没有变化/);
  assert.equal(d.jobs.length,2); assert.equal(d.complete,false);
});
test('pause resumes the same in-memory page without losing items', async () => {
  const d=C.session('https://example.test/list'), controller=new AbortController();
  await assert.rejects(C.collect(options(d,{signal:controller.signal,onUpdate:s=>{if(s.jobs.length===1)controller.abort();}})),{name:'AbortError'});
  assert.equal(d.jobs.length,1); assert.equal(d.pageOffset,1);
  await C.collect(options(d));
  assert.equal(d.jobs.length,3); assert.equal(d.pages,2); assert.equal(d.complete,true);
});
test('details enrich records and preserve failed and incomplete items', async () => {
  const d=C.session('https://example.test/list');
  await C.collect(options(d,{read:async()=>listing(['1','2','3'],false,{jobs:['1','2','3'].map(id=>raw(id,{requirements:'',collectionState:'pending'}))}),
    readDetail:async url=> { if(url.endsWith('2'))throw Error('模拟失败'); return url.endsWith('1')?{requirements:'硕士及以上学历'}:{}; }}));
  assert.equal(d.jobs[0].facts.degree.rank,3); assert.equal(d.jobs[1].collectionState,'failed'); assert.equal(d.jobs[2].collectionState,'missing');
  assert.equal(J.evaluate(d.jobs[2],{degree:'本科'}).state,'review');
});
test('discovered popup links become source links without a site-specific URL', async () => {
  const d=C.session('https://example.test/list');
  await C.collect(options(d,{read:async()=>listing(['1'],false,{total:1,jobs:[raw('1',{url:d.sourceURL,linkKind:'list',titleSelector:'.title'})]}),
    resolveLink:async css=>{assert.equal(css,'.title');return 'https://example.test/open?key=one';}}));
  assert.equal(d.jobs[0].url,'https://example.test/open?key=one'); assert.equal(d.jobs[0].linkKind,'detail');
});
test('missing detail state cannot be treated as fully reviewed',()=>{
  assert.equal(J.evaluate(J.normalize(raw('1',{collectionState:'pending'})),{degree:'本科'}).state,'review');
});
test('an explicitly empty list is valid and does not become a fake detail',async()=>{
  const d=C.session('https://example.test/list');
  await C.collect(options(d,{read:async()=>listing([],false,{total:0})}));
  assert.equal(d.jobs.length,0);assert.equal(d.complete,true);assert.equal(d.stage,'done');
});
test('appended scroll batches deduplicate title lookups and stop before reading details',async()=>{
  const d=C.session('https://example.test/list'),calls=[];
  const first=listing(['1','2'],true,{total:3,jobs:['1','2'].map(id=>raw(id,{linkKind:'list',titleSelector:'.title'+id}))});
  let batch=0;
  await C.collect(options(d,{read:async()=>first,next:async()=>++batch===1?listing(['1','2','3'],true,{total:3,jobs:['1','2','3'].map(id=>raw(id,{linkKind:'list',titleSelector:'.title'+id}))}):{ended:true,jobs:[],next:false,stopReason:'no additions'},
    resolveLink:async selector=>{calls.push(selector);return 'https://example.test/resolved/'+selector.slice(-1);}}));
  assert.equal(d.jobs.length,3);assert.equal(calls.length,3);assert.equal(d.complete,true);assert.equal(d.stopReason,'no additions');
});
test('detail major fields replace list summaries without losing a separate field',async()=>{
  const d=C.session('https://example.test/list');
  await C.collect(options(d,{read:async()=>listing(['1','2'],false,{total:2,jobs:['1','2'].map(id=>raw(id,{majorRequirements:'电气类',requirements:'本科',collectionState:'pending'}))}),
    readDetail:async url=>url.endsWith('1')?{requirements:'专业要求：法学'}:{requirements:'本科及以上；熟悉电气设备',majorRequirements:'机械类'}}));
  assert.equal(J.matchMajor(d.jobs[0],'电气').hit,false);assert.equal(J.matchMajor(d.jobs[0],'法学').hit,true);
  assert.equal(d.jobs[1].majorRequirements,'机械类');assert.equal(J.matchMajor(d.jobs[1],'电气').hit,false);
});
test('wide disciplines in qualification prose are extracted and explained conservatively',()=>{
  const profile={degree:'本科',major:'电子信息科学与技术'};
  for(const req of ['任职资格：本科及以上，要求理工类专业。','应聘条件：理工科本科毕业生。','理工类相关专业背景']) {
    const m=J.majors.assess(req,profile);assert.equal(m.kind,'broad',req);assert.equal(m.state,'review');assert.match(m.reason,/工学/);
    assert.equal(J.matchMajor(req,'电子信息',profile).state,'range');
  }
  assert.equal(J.majors.lookup('电子信息科学与技术').disciplineName,'工学');
  assert.equal(J.majors.assess('工科类专业',{degree:'硕士',major:'电子信息科学与技术'}).kind,'unknown');
  assert.equal(J.matchMajor('熟悉理工科实验设备','理工',profile).hit,false);
  assert.notEqual(J.matchMajor('按2020年目录，理工类专业','电子信息',profile).state,'range');
  assert.notEqual(J.matchMajor('研究生目录中的电子信息类专业','电子信息科学',profile).state,'range');
  assert.equal(J.majors.assess('专业不限，不接受理工类专业',profile).state,'review');
});
test('multiple discipline names joined by punctuation remain an inclusive broad range',()=>{
  const requirements='硕士研究生及以上学历，理学、工学等相关专业。';
  for(const major of ['电子信息科学与技术','物理学']) assert.equal(J.majors.assess(requirements,{degree:'本科',major}).kind,'broad');
  assert.notEqual(J.majors.assess(requirements,{degree:'本科',major:'汉语言文学'}).kind,'broad');
  for(const text of ['工学类相关专业','理学、工学门类专业','理学与工学相关专业']) assert.equal(J.majors.assess(text,{degree:'本科',major:'电子信息科学与技术'}).kind,'broad');
  assert.equal(J.matchMajor(requirements,'电子信息',{degree:'本科',major:'电子信息科学与技术'}).state,'range');
});
test('conflict reasons identify the failed condition while missing majors remain reviewable',()=>{
  const j=job('硕士及以上学历');const result=J.evaluate(j,{degree:'本科',major:'电子信息科学与技术'});
  assert.equal(result.conflictLabel,'学历冲突');assert.match(result.conflictReason,/你的学历低于原文要求/);
  assert.equal(result.checks.find(c=>c.label==='专业').state,'review');
  assert.equal(J.filter([j,job('学历不限',{id:'unknown-major'}),job('本科；英语六级',{id:'english'})],{degree:'本科',english:'0'},{hideDegreeConflicts:true}).length,2);
});
test('missing detail permission pauses with the original link and resumes without losing jobs',async()=>{
  const d=C.session('https://list.invalid/list');let allowed=false;
  const opt=options(d,{read:async()=>listing(['1'],false,{total:1,jobs:[raw('1',{url:'https://detail.invalid/job?id=1',requirements:'',collectionState:'pending'})]}),readDetail:async()=>{
    if(!allowed)throw A.error({...A.record('permission','详情站点待授权'),origin:'https://detail.invalid'});return {requirements:'硕士及以上；理学、工学等相关专业'};
  }});
  await assert.rejects(C.collect(opt),e=>A.read(e)?.kind==='permission');assert.equal(d.stage,'permission');assert.equal(d.accessStop.origin,'https://detail.invalid');assert.equal(d.jobs[0].collectionState,'pending');
  allowed=true;await C.collect(opt);assert.equal(d.stage,'done');assert.equal(d.jobs.length,1);assert.equal(d.jobs[0].url,'https://detail.invalid/job?id=1');assert.equal(d.jobs[0].collectionState,'read');
});
test('separate sources share pacing at their actual authorized detail origin',async()=>{
  let time=0;const waits=[],g=new A.Governor({now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;}}),a={origin:'https://a.invalid',active:true,count:0},b={origin:'https://b.invalid',active:true,count:0};
  await Promise.all([g.permit(a,'https://details.invalid'),g.permit(b,'https://details.invalid')]);assert.deepEqual(waits,[3000]);assert.equal(a.count,1);assert.equal(b.count,1);
});

test('a source cancellation stops the detail loop and preserves already collected results',async()=>{
  const d=C.session('https://list.invalid/list'),calls=[];
  await assert.rejects(C.collect(options(d,{read:async()=>listing(['1','2','3'],false,{total:3,jobs:['1','2','3'].map(id=>raw(id,{requirements:'',collectionState:'pending'}))}),readDetail:async url=>{
    calls.push(url);if(calls.length===2)throw A.error(A.record('cancelled','原标签页已切换网站，任务已停止'));return {requirements:'本科；专业不限'};
  }})),e=>A.read(e)?.kind==='cancelled');
  assert.equal(calls.length,2);assert.equal(d.stage,'stopped');assert.equal(d.complete,false);assert.equal(d.jobs.length,3);assert.equal(d.jobs[0].collectionState,'read');assert.equal(d.jobs[2].collectionState,'pending');
});
test('major ranking promotes clear matches and keeps other hard conflicts last',()=>{
  const profile={degree:'本科',major:'电气工程及其自动化'};
  const jobs=[job('本科及以上；专业不限',{id:'any'}),job('本科及以上；理工类专业',{id:'wide'}),job('本科及以上；电气工程及其自动化专业',{id:'exact'}),job('硕士及以上；电气工程及其自动化专业',{id:'degree-conflict'}),job('本科及以上；电气类相关专业',{id:'category'}),job('本科及以上；熟悉电气设备',{id:'unknown'})];
  assert.deepEqual(J.filter(jobs,profile).map(r=>r.job.id),['exact','category','wide','any','unknown','degree-conflict']);
  const s=J.matchMajor('机械设计制造及其自动化、材料成型及控制工程及电气工程及其自动化专业','电气');
  assert.equal(s.hit,true);assert.equal(s.fragments[0],'电气工程及其自动化');
});
test('detail headers cannot overwrite a known list title or employer',async()=>{
  const d=C.session('https://example.test/list');
  await C.collect(options(d,{read:async()=>listing(['1'],false,{total:1,jobs:[raw('1',{name:'虚构产品工程师',company:'示例制造公司',collectionState:'pending',requirements:''})]}),
    readDetail:async()=>({name:'工作职责',company:'虚构集团-校招',requirements:'本科及以上；理工类专业'})}));
  assert.equal(d.jobs[0].name,'虚构产品工程师');assert.equal(d.jobs[0].company,'示例制造公司');
});
test('independent source tasks aggregate without colliding IDs or writing records',async()=>{
  const {Tasks}=require('../extension/jobs-tasks'),m=new Tasks();
  const a=m.add({tabId:1,nonce:'a',url:'https://first.invalid/list'}),b=m.add({tabId:2,nonce:'b',url:'https://second.invalid/list'});
  const opt={read:async()=>listing(['1'],false,{total:1}),next:async()=>{},readDetail:async()=>({}),resolveLink:async()=>'',delay:0};
  await Promise.all([m.run(a,opt),m.run(b,opt)]);
  const merged=m.aggregate();assert.equal(merged.jobs.length,2);assert.equal(new Set(merged.jobs.map(j=>j.key)).size,2);assert.equal(merged.sourceCount,2);
  assert.equal(m.aggregate(a.id).jobs[0].sourceURL,a.source.url);assert.equal(m.add({tabId:1,nonce:'a',url:a.source.url}),a);
  await m.clear(a);assert.equal(m.aggregate(a.id),null);assert.equal(m.aggregate().jobs.length,1);
});
test('clearing one task rejects late data and leaves another task intact',async()=>{
  const {Tasks}=require('../extension/jobs-tasks'),m=new Tasks();
  const a=m.add({tabId:3,nonce:'a',url:'https://first.invalid/list'}),b=m.add({tabId:4,nonce:'b',url:'https://second.invalid/list'});
  let resolveDetail;const ready=new Promise(resolve=>{a.ready=resolve;});
  const opt={read:async()=>listing(['1'],false,{total:1,jobs:[raw('1',{requirements:'',collectionState:'pending'})]}),resolveLink:async()=>'',delay:0};
  const work=m.run(a,{...opt,readDetail:()=>new Promise(resolve=>{resolveDetail=resolve;a.ready();})});await ready;
  await m.run(b,{...opt,readDetail:async()=>({requirements:'本科，专业不限'})});
  const clearing=m.clear(a);assert.equal(a.dataset,null);resolveDetail({requirements:'电气工程及其自动化专业'});await clearing;await work;
  assert.equal(a.dataset,null);assert.equal(a.busy,false);assert.equal(m.jobs(b).length,1);
});
test('AI integration is disabled by default and requires explicit request scope',async()=>{
  const AI=require('../extension/jobs-ai');assert.equal(AI.configured,false);
  await assert.rejects(AI.run({operation:'recommend',consent:true}),/尚未配置/);
  let calls=0,received;AI.register({name:'offline fixture',run:async input=>{calls++;received=input;return {items:[{key:'j',reason:'原文证据',evidence:['理工类专业'],score:0.7}]};}});
  const jobs=[{key:'j',name:'虚构岗位',requirements:'本科及以上，理工类专业',url:'https://private.invalid',unrelated:'secret'}];
  await assert.rejects(AI.run({operation:'recommend',jobs}),/需先确认/);assert.equal(calls,0);
  const result=await AI.run({operation:'recommend',jobs,consent:true});assert.equal(result.items[0].needsReview,true);assert.equal(received.profile,undefined);assert.equal(received.jobs[0].unrelated,undefined);assert.equal(received.jobs[0].url,undefined);
  AI.register({name:'invalid fixture',run:async()=>({items:[{key:'j',evidence:['原文并不存在']} ]})});
  await assert.rejects(AI.run({operation:'extract',jobs,consent:true}),/原文依据/);
});

test('production access limits are finite and conservative',()=>{
  assert.equal(A.policy.intervalMs,3000);assert.equal(A.policy.maxJobs,200);assert.equal(A.policy.maxPages,30);assert.equal(A.policy.maxActions,400);
  assert.equal(A.read(A.error(A.record('captcha','请核对原站'))).reason,'请核对原站');
  assert.equal(A.read(Error('ordinary failure')),null);
});
test('same-origin runs share the gate while other origins can proceed independently',async()=>{
  let time=0;const waits=[],g=new A.Governor({now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;}});
  const first={origin:'https://one.invalid',active:true,count:0},second={origin:first.origin,active:true,count:0};
  await Promise.all([g.permit(first),g.permit(second),g.permit(first)]);
  assert.deepEqual(waits,[3000,3000]);assert.equal(time,6000);assert.equal(first.count,2);assert.equal(second.count,1);
  const other={origin:'https://two.invalid',active:true,count:0};await g.permit(other);assert.equal(time,6000);
});
test('cancelling a queued operation prevents its later execution and count increment',async()=>{
  let time=0;const run={origin:'https://one.invalid',active:true,count:0},g=new A.Governor({now:()=>time,wait:async ms=>{time+=ms;run.active=false;}});
  await g.permit(run);await assert.rejects(g.permit(run),e=>A.read(e)?.kind==='cancelled');assert.equal(run.count,1);
});
test('operation budgets stop before initiating an extra action',async()=>{
  const run={origin:'https://one.invalid',active:true,count:0},g=new A.Governor({intervalMs:0,maxActions:2});
  await g.permit(run);await g.permit(run);await assert.rejects(g.permit(run),e=>A.read(e)?.kind==='limit');assert.equal(run.count,2);
});
test('manual pause during a guarded operation stays resumable',async()=>{
  const d=C.session('https://one.invalid/list'),controller=new AbortController();
  await assert.rejects(C.collect(options(d,{signal:controller.signal,read:async()=>listing(['1'],false,{jobs:[raw('1',{requirements:'',collectionState:'pending'})]}),readDetail:async()=>{controller.abort();throw A.error(A.record('cancelled','操作已结束'));}})),{name:'AbortError'});
  assert.notEqual(d.stage,'blocked');assert.equal(d.jobs[0].collectionState,'pending');
});
test('resuming after an interrupted navigation reads the new page before advancing again',async()=>{
  const d=C.session('https://one.invalid/list'),controller=new AbortController();let moved=false,advances=0;
  const read=async()=>moved?listing(['3'],false,{pageNumber:2}):listing(['1','2'],true);
  const next=async()=>{advances++;moved=true;controller.abort();throw controller.signal.reason;};
  await assert.rejects(C.collect(options(d,{read,next,signal:controller.signal})),{name:'AbortError'});
  assert.equal(d.advanceInFlight,true);assert.equal(d.jobs.length,2);
  await C.collect(options(d,{read,next}));assert.equal(d.jobs.length,3);assert.equal(advances,1);assert.equal(d.complete,true);
});
test('Retry-After seconds and dates extend a cooldown without triggering retries',()=>{
  const now=Date.parse('2026-10-08T00:00:00Z');
  assert.equal(A.response(429,'1800',now).until,now+1800000);
  assert.equal(A.response(429,'Thu, 08 Oct 2026 01:00:00 GMT',now).until,now+3600000);
  assert.equal(A.response(403,'invalid',now).until,now+600000);assert.equal(A.response(404,'',now),null);
});
test('background resume retains the operation budget and overlapping refusals never shorten cooldowns',async()=>{
  const vm=require('node:vm'),fs=require('node:fs'),saved={};
  const context=vm.createContext({JobScreenAccess:A,JobScreenChannel:{accessStop(){}},crypto:require('node:crypto').webcrypto,URL,setTimeout,
    chrome:{permissions:{contains:async()=>false},storage:{session:{get:async k=>({[k]:saved[k]}),set:async values=>Object.assign(saved,values),remove:async k=>{delete saved[k];}}},
      webRequest:{onHeadersReceived:{addListener(){}}},runtime:{onMessage:{addListener(){}}},tabs:{onRemoved:{addListener(){}}}}});
  vm.runInContext(fs.readFileSync(require.resolve('../extension/jobs-access-background.js'),'utf8'),context);
  const background=context.JobScreenAccessBackground,origin='https://budget.invalid';
  await assert.rejects(background.target(origin,'https://other.invalid/job?id=1'),e=>A.read(e)?.kind==='permission'&&A.read(e).origin==='https://other.invalid');
  await assert.rejects(background.target(origin,'javascript:alert(1)'),/链接无效/);
  const first=await background.begin(1,2,origin);background.current(1,2,first.ticket).count=399;background.finish(1,2);
  const resumed=await background.begin(1,2,origin,true);assert.equal(background.current(1,2,resumed.ticket).count,399);
  await background.permit(1,2,resumed.ticket);await assert.rejects(background.permit(1,2,resumed.ticket),e=>A.read(e)?.kind==='limit');
  background.finish(1,2);const fresh=await background.begin(1,2,origin);assert.equal(background.current(1,2,fresh.ticket).count,0);
  const longer=Date.now()+3600000;await Promise.all([background.block(origin,A.record('rate','较长冷却',429,longer)),background.block(origin,A.record('refused','稍后拒绝',403))]);
  assert.ok(saved['jobAccessBlock:'+origin].until>=longer);await assert.rejects(background.begin(1,2,origin),e=>A.read(e)?.until>=longer);
  background.finish(1);await assert.rejects(background.begin(1,3,'https://new.invalid',true),e=>A.read(e)?.kind==='cancelled');
});
test('refusal and captcha failures stop the whole collector without reading later jobs',async()=>{
  for(const kind of ['refused','rate','captcha']){
    const d=C.session('https://one.invalid/list'),calls=[];
    await assert.rejects(C.collect(options(d,{read:async()=>listing(['1','2','3'],false,{jobs:['1','2','3'].map(id=>raw(id,{requirements:'',collectionState:'pending'}))}),
      readDetail:async url=>{calls.push(url);if(url.endsWith('2'))throw A.error(A.record(kind,'访问保护已停止'));return {requirements:'本科，专业不限'};}})),e=>A.read(e)?.kind===kind);
    assert.equal(calls.length,2);assert.equal(d.jobs[0].collectionState,'read');assert.equal(d.jobs[2].collectionState,'pending');assert.equal(d.stage,'blocked');assert.equal(d.complete,false);
  }
});
test('the discovery cap never inserts job 201 and still completes already discovered details',async()=>{
  const d=C.session('https://one.invalid/list');let detailReads=0,advances=0;
  await C.collect(options(d,{read:async()=>listing(Array.from({length:201},(_,i)=>String(i)),true,{total:201,jobs:Array.from({length:201},(_,i)=>raw(String(i),{requirements:'',collectionState:'pending'}))}),
    next:async()=>{advances++;throw Error('must not advance');},readDetail:async()=>{detailReads++;return {requirements:'本科，专业不限'};}}));
  assert.equal(d.jobs.length,200);assert.equal(detailReads,200);assert.equal(advances,0);assert.equal(d.stage,'limited');assert.equal(d.complete,false);
});
test('the page cap stops further pagination while preserving useful detail results',async()=>{
  const d=C.session('https://one.invalid/list');let advances=0;
  await C.collect(options(d,{maxPages:1,next:async()=>{advances++;throw Error('must not advance');}}));
  assert.equal(advances,0);assert.equal(d.jobs.length,2);assert.equal(d.stage,'limited');assert.equal(d.discoveryLimited,true);
});
