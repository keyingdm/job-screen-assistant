(async function () {
  'use strict';
  const J = JobScreen, Store = JobScreenStorage, P = JobScreenPage, C = JobScreenCollector, $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search), initialBinding = params.get('tab') && params.get('nonce') ? { tabId: Number(params.get('tab')), nonce: params.get('nonce') } : null;
  const profileFields = ['degree', 'year', 'major', 'experience', 'english'];
  const filterFields = ['city', 'role', 'company', 'major', 'majorMode', 'exclude', 'benefits', 'nature', 'days', 'state', 'mark', 'hideConflicts', 'hideDegreeConflicts', 'onlyOpen', 'query', 'sort'];
  let profile = await Store.get('jobProfile', {}), favorites = await Store.migrate(), filters = {}, dataset = null, rows = [], page = 1;
  let mode = 'favorites', view = await Store.get('jobView', 'table'), busy = false, source = null, rule = {}, ruleKey = '', selectedTask = 'all', port = null, closing = false;
  const tasks = new JobScreenTasks.Tasks(() => repaint());
  const activeTask = () => tasks.items.get(selectedTask);
  let profileSave = Promise.resolve(), renderTimer = null;
  const repaint = () => { if (!closing && renderTimer === null) renderTimer = setTimeout(() => { renderTimer = null; render(); }, 70); };
  const node = (tag, cls, value) => { const el = document.createElement(tag); if (cls) el.className = cls; if (value !== undefined) el.textContent = value; return el; };
  const status = value => { $('status').textContent = value; };
  const keyFor = job => job.linkKind === 'detail' && job.url ? job.url : job.key;
  const packed = job => { const { facts, tags, deadline, ...raw } = job; return raw; };
  const allJobs = () => mode === 'favorites' ? Object.values(favorites).map(f => J.normalize(f.job, f.job.source || 'page')) : dataset?.jobs || [];
  const marks = (jobs = allJobs()) => Object.fromEntries(jobs.map(j => [j.key, { favorite: Boolean(favorites[keyFor(j)]), status: favorites[keyFor(j)]?.status || '未标记' }]));
  const rpc = async (action, extra = {}, task = activeTask()) => {
    if (!task?.tabId || !globalThis.chrome?.runtime) throw Error('请在招聘列表页点击浏览器工具栏的插件图标，再开始采集。');
    const response = await chrome.runtime.sendMessage({ type: 'job-screen', tabId: task.tabId, nonce: task.nonce, ticket: task.ticket, action, ...extra });
    if (!response?.ok) throw response?.accessStop ? JobScreenAccess.error(response.accessStop) : Error(response?.error || '原网页连接已断开');
    return response.result;
  };
  function controls() {
    for (const k of profileFields) profile[k] = $('my-' + k).value;
    for (const k of filterFields) { const el = $('filter-' + k); filters[k] = el.type === 'checkbox' ? el.checked : el.value; }
  }
  function restore() {
    for (const k of profileFields) $('my-' + k).value = profile[k] ?? '';
    for (const k of filterFields) { const el = $('filter-' + k); if (el.type === 'checkbox') el.checked = Boolean(filters[k]); else el.value = filters[k] ?? (k === 'sort' ? 'match' : ''); }
  }
  async function editFavorite(job, patch = {}) {
    try {
      const write = async () => {
        const saved = await Store.get('jobFavorites', {}), key = keyFor(job);
        if (patch.favorite === false) delete saved[key];
        else saved[key] = { job: packed(job), status: patch.status || saved[key]?.status || '未标记', savedAt: saved[key]?.savedAt || new Date().toISOString() };
        await Store.set('jobFavorites', saved); favorites = saved;
      };
      if (navigator.locks) await navigator.locks.request('job-screen-favorites', write); else await write();
      render(); status(patch.favorite === false ? '已取消收藏。该岗位不会在下次打开时保留。' : '已保存到收藏，岗位原文、链接和投递状态保存在本机。');
      if ($('detail').open) detail(job);
    } catch (error) { status('收藏保存失败，请重试或导出已有收藏：' + error.message); }
  }
  function star(job) {
    const saved = Boolean(favorites[keyFor(job)]), b = node('button', 'favorite-button' + (saved ? ' saved' : ''), saved ? '★ 已收藏' : '☆ 收藏');
    b.setAttribute('aria-label', (saved ? '取消收藏 ' : '收藏 ') + job.name); b.onclick = () => editFavorite(job, { favorite: !saved }); return b;
  }
  function stateSelect(job) {
    const select = node('select'); select.setAttribute('aria-label', '投递标记 ' + job.name);
    for (const value of ['未标记', '准备投递', '已投递', '不考虑']) select.append(node('option', '', value));
    select.value = favorites[keyFor(job)]?.status || '未标记'; select.disabled = !favorites[keyFor(job)];
    select.title = select.disabled ? '先收藏，再保存投递状态' : '手动记录投递状态';
    select.onchange = () => editFavorite(job, { status: select.value }); return select;
  }
  function link(job) {
    if (!job.url) return node('span', 'hint', '未识别原页链接');
    const a = node('a', 'original-job-button', job.linkKind === 'detail' ? '查看原岗位 ↗' : '查看来源列表 ↗');
    a.setAttribute('aria-label', (job.linkKind === 'detail' ? '查看原岗位 ' : '查看来源列表 ') + job.name);
    a.href = job.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  const labels = { read: '已读要求', pending: '待读详情', reading: '读取中', missing: '要求不完整', failed: '读取失败' };
  const judgementLabel = match => match.state === 'fail' ? match.conflictLabel : match.state === 'pass' ? '未见冲突' : '待确认';
  function detail(job) {
    const match = J.evaluate(job, profile); $('detail-name').textContent = job.name;
    $('detail-meta').textContent = [job.company, job.group, job.city, job.nature, job.sourceLabel && '来源：' + job.sourceLabel].filter(Boolean).join(' · ');
    const body = $('detail-body'); body.replaceChildren();
    const actions = node('div', 'detail-actions'); actions.append(star(job), stateSelect(job), link(job)); body.append(actions);
    body.append(node('p', 'source-note', '自动判断只覆盖你填写的条件。专业相关性、技能熟练程度和附加限制仍需结合原文核对。'));
    body.append(node('p', 'hint', '采集状态：' + (labels[job.collectionState] || '待核对') + (job.collectionError ? ' · ' + job.collectionError : '')));
    const majorSearch = J.matchMajor(job, filters.major, profile);
    body.append(node('h3', '', '专业提取与检索'));
    body.append(node('p', 'hint', '只使用独立专业字段或专业条款；熟悉某设备、掌握某技能不代表招收该专业。'));
    if (filters.major) body.append(node('span', 'pill ' + majorClass(majorSearch), majorSearch.label + ' · 检索词：' + filters.major));
    body.append(node('blockquote', '', majorSearch.evidence || '未检测到专业要求。请查看原岗位核对；这不代表专业不限。'));
    if (job.majorRequirements) body.append(node('h3', '', '独立专业字段 · 原文'), node('pre', '', job.majorRequirements));
    body.append(node('h3', '', '逐项判断与依据'));
    if (!match.checks.length) body.append(node('p', 'hint', '填写左侧个人条件后，显示逐项判断。'));
    for (const check of match.checks) {
      const row = node('div', 'check-row'); row.append(node('strong', 'pill ' + check.state, check.label + ' · ' + ({ pass: '未见冲突', review: '待确认', fail: '存在冲突' }[check.state])), node('p', '', check.reason));
      if (check.evidence) row.append(node('blockquote', '', check.evidence)); body.append(row);
    }
    for (const [title, value] of [['任职要求 · 原文', job.requirements], ['工作职责 · 原文', job.description], ['待遇与福利 · 原文', job.benefits]]) body.append(node('h3', '', title), node('pre', '', value || '未读取到这一项，请打开招聘原页核对。'));
    body.append(node('p', 'hint', '截止时间：' + (job.closes || '未明确') + '（北京时间） · 采集于 ' + job.collectedAt));
    if (!$('detail').open) $('detail').showModal();
  }
  function title(job) { const b = node('button', 'job-title', job.name); b.onclick = () => detail(job); return b; }
  const majorClass = major => ['hit', 'range', 'unrestricted'].includes(major.state) ? 'pass' : major.state === 'excluded' ? 'fail' : 'review';
  function professionalData(job) {
    const query = filters.major || profile.major, search = J.matchMajor(job, query, profile), qualification = profile.major ? J.majors.assess(job, profile) : null;
    const matched = search.hit || search.state === 'range' || ['exact', 'category', 'broad'].includes(qualification?.kind);
    const stateLabel = { pending: '详情待读，专业尚未核对', reading: '正在读取详情', failed: '详情读取失败，专业尚未核对' }[job.collectionState];
    const label = !search.known ? stateLabel || '未检测到专业要求' : filters.major ? search.label : qualification ? ({ exact: '专业名称匹配', category: '专业类别匹配 · 待核对', broad: '宽泛范围匹配 · 待核对', unrestricted: '专业不限', excluded: '专业明确冲突', different: '专业未直接匹配', unknown: '专业待确认' }[qualification.kind]) : '已提取专业条款';
    const primary = search.fragments?.join(' / ') || (matched ? qualification?.evidence || search.evidence : '');
    return { search, qualification, label, matched, primary, evidence: search.evidence || stateLabel || '未检测到专业要求；请查看原岗位核对。', missing: label === '未检测到专业要求', query };
  }
  function highlighted(value, query) {
    const span = node('span'); const words = J.terms(query).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!words.length) { span.textContent = value; return span; }
    const escaped = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp('(' + escaped.join('|') + ')', 'ig');
    for (const part of value.split(pattern)) span.append(words.some(w => w.toLowerCase() === part.toLowerCase()) ? node('mark', '', part) : document.createTextNode(part));
    return span;
  }
  function professional(job) {
    const data = professionalData(job), box = node('div', 'professional-evidence' + (data.matched ? ' major-matched' : '') + (data.missing ? ' major-missing' : ''));
    if (data.query || !data.search.known) box.append(node('span', 'pill ' + majorClass(data.search), data.label));
    if (data.primary) { const first = node('strong', 'major-primary'); first.append(highlighted(data.primary, data.query)); box.append(first); }
    box.append(node('span', 'cell-major', data.evidence)); box.title = data.evidence; return box;
  }
  function card({ job, match }) {
    const article = node('article', 'job-card'), head = node('div', 'job-heading');
    head.append(title(job), node('span', 'pill ' + match.state, judgementLabel(match))); article.append(head, node('p', 'job-company', [job.company || '单位未明确', job.group].filter(Boolean).join(' / ')));
    if (match.conflictReason) article.append(node('p', 'conflict-reason', match.conflictReason));
    const pills = node('div', 'pills');
    for (const value of [job.city || '城市未明确', job.facts.degree.label, job.nature, labels[job.collectionState], ...job.tags].filter(Boolean)) pills.append(node('span', 'pill', value));
    const actions = node('div', 'job-actions'); actions.append(star(job), stateSelect(job), link(job), node('span', 'deadline', '截止：' + (job.closes || '未明确')));
    article.append(pills, professional(job), node('p', 'job-snippet', job.requirements || '详情待读取，信息缺失保留待确认。'), actions); return article;
  }
  function table(values) {
    const wrap = node('div', 'table-wrap'), tbl = node('table', 'jobs-table'), head = node('thead'), hr = node('tr'), body = node('tbody');
    for (const text of ['岗位 / 公司', '城市', '学历', '专业要求', '判断 / 采集', '截止', '操作']) hr.append(node('th', '', text)); head.append(hr);
    for (const { job, match } of values) {
      const tr = node('tr', 'job-row' + (professionalData(job).matched && match.state !== 'fail' ? ' preferred-row' : '')), name = node('td'); name.append(title(job), node('p', 'job-company', [job.company || '单位未明确', job.group].filter(Boolean).join(' / ')));
      if (job.sourceLabel) name.append(node('span', 'cell-sub', '来源：' + job.sourceLabel));
      const major = node('td'); major.append(professional(job));
      const judgement = node('td'); judgement.append(node('span', 'pill ' + match.state, judgementLabel(match)), node('span', 'cell-sub', labels[job.collectionState] || '待核对'));
      if (match.conflictReason) judgement.append(node('span', 'conflict-reason', match.conflictReason));
      const last = node('td'); last.append(star(job));
      if (favorites[keyFor(job)]?.status && favorites[keyFor(job)].status !== '未标记') last.append(node('span', 'cell-sub', favorites[keyFor(job)].status));
      if (job.url) last.append(link(job));
      tr.append(name, node('td', '', job.city || '未明确'), node('td', '', job.facts.degree.label), major, judgement, node('td', '', job.closes?.slice(0, 10) || '未明确'), last); body.append(tr);
      tr.tabIndex = 0;
      tr.onclick = e => { if (!e.target.closest('button,a,select,input')) detail(job); };
      tr.onkeydown = e => { if (e.target === tr && ['Enter', ' '].includes(e.key)) { e.preventDefault(); detail(job); } };
    }
    tbl.append(head, body); wrap.append(tbl); return wrap;
  }
  function coverage() {
    const d = dataset;
    $('progress').value = d?.jobs.filter(j => ['read', 'missing', 'failed'].includes(j.collectionState)).length || 0;
    $('progress').max = Math.max(1, d?.total || d?.jobs.length || 1);
    $('resume').hidden = busy || !d || d.stage === 'done' || d.source === 'sample';
    if (!d) { $('coverage').textContent = '下次打开只显示收藏；未收藏的岗位不自动保存。'; return; }
    if (d.source === 'sample') { $('coverage').textContent = '虚构演示 · ' + d.jobs.length + ' 个岗位，公司、日期和内容均为示例。'; return; }
    const counts = { read: 0, missing: 0, failed: 0, pending: 0 };
    for (const j of d.jobs) counts[j.collectionState === 'reading' ? 'pending' : j.collectionState] = (counts[j.collectionState === 'reading' ? 'pending' : j.collectionState] || 0) + 1;
    $('coverage').textContent = '已读 ' + d.pages + ' 页/批 · 已发现 ' + d.jobs.length + (d.total === null ? ' 个岗位' : ' / 页面报告 ' + d.total + ' 个岗位') +
      ' · 要求完整 ' + counts.read + ' · 待读 ' + counts.pending + ' · 不完整 ' + counts.missing + ' · 失败 ' + counts.failed +
      '。' + (d.complete ? '与页面报告数量一致；范围为当前筛选列表。' : d.startedMidList ? '从中间页开始，未覆盖前面的分页。' : '全列表覆盖情况尚未确认。') + (d.stopReason ? ' ' + d.stopReason : '');
  }
  function render() {
    dataset = tasks.aggregate(selectedTask); const task = activeTask(); busy = Boolean(task?.busy || task?.starting); source = task?.source || null; rule = task?.rule || {}; ruleKey = task?.ruleKey || '';
    const jobs = allJobs(), all = jobs.map(j => J.evaluate(j, profile));
    $('favorites-count').textContent = Object.keys(favorites).length; $('session-count').textContent = tasks.aggregate('all')?.jobs.length || 0;
    for (const name of ['favorites', 'session']) { const el = $('tab-' + name); el.classList.toggle('active', mode === name); el.setAttribute('aria-selected', String(mode === name)); }
    for (const name of ['table', 'cards']) { const el = $('view-' + name); el.classList.toggle('active', view === name); el.setAttribute('aria-pressed', String(view === name)); }
    $('stats').replaceChildren(...[['', jobs.length, mode === 'favorites' ? '已收藏岗位' : '本次发现岗位'], ['pass', all.filter(v => v.state === 'pass').length, '所选条件未见冲突'], ['review', all.filter(v => v.state === 'review').length, '待确认'], ['fail', all.filter(v => v.state === 'fail').length, '存在明确冲突']].map(([cls, n, label]) => { const el = node('div', 'stat ' + cls); el.append(node('strong', '', n), node('span', '', label)); return el; }));
    rows = J.filter(jobs, profile, filters, marks()); const pages = Math.max(1, Math.ceil(rows.length / 25)); page = Math.max(1, Math.min(page, pages));
    $('result-count').textContent = '当前显示 ' + rows.length + ' / ' + jobs.length + ' 个岗位 · ' + (mode === 'favorites' ? '收藏包含原文与链接，状态由你手动记录。' : '未收藏的结果关闭或刷新后清空。');
    $('major-result-count').hidden = !J.terms(filters.major).length;
    $('major-result-count').textContent = '当前结果的专业检索：命中 ' + rows.filter(r => r.major.hit).length + ' · 不限 ' + rows.filter(r => r.major.state === 'unrestricted').length + ' · 待确认 ' + rows.filter(r => !r.major.hit && r.major.state !== 'unrestricted').length + '。检索命中不代表符合专业资格。';
    const person = J.majors.lookup(profile.major);
    $('major-profile-note').textContent = !profile.major ? '专业目录参考：教育部2026年本科目录；专科、研究生及企业自定范围按原文核对。' : person ? '已识别本科专业：' + person.name + (profile.degree === '本科' && person.categoryName ? ' → ' + person.categoryName : '') + '。目录关系仅作参考。' : '未识别为目录中的完整本科专业。若填的是简称，请改用下方“专业检索词”；其他层次专业保留待确认。';
    const values = rows.slice((page - 1) * 25, page * 25);
    $('jobs').replaceChildren(...(view === 'table' && values.length ? [table(values)] : values.map(card)));
    if (!values.length) {
      const empty = node('div', 'empty-results'); empty.append(node('div', 'empty-symbol', mode === 'favorites' ? '☆' : '⌕'), node('h2', '', jobs.length ? '没有符合当前组合的岗位' : mode === 'favorites' ? '把值得投递的岗位，留在这里。' : '从招聘列表开始你的筛选。'), node('p', '', jobs.length ? '可以清空偏好，或取消隐藏冲突岗位。' : mode === 'favorites' ? '采集后点击收藏，保存岗位原文和链接。准备投递、已经报过的岗位，都可以在这里管理。' : '在原招聘列表点击插件，再开始采集。你也可以体验虚构示例。')); $('jobs').append(empty);
    }
    $('page-info').textContent = page + ' / ' + pages + ' 页 · 每页 25 条'; $('prev').disabled = page <= 1; $('next').disabled = page >= pages;
    for (const [id, values] of [['city-list', jobs.map(j => j.city)], ['company-list', jobs.flatMap(j => [j.company, j.group])]]) $(id).replaceChildren(...[...new Set(values.filter(Boolean))].sort().slice(0, 500).map(v => { const o = node('option'); o.value = v; return o; }));
    coverage();
    renderTasks(); setBusy(busy); publishWidgets();
  }
  async function readDetail(url, signal, task) {
    await rpc('access-permit', { url }, task); signal.throwIfAborted();
    try {
      const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
      const stop = JobScreenAccess.response(response.status, response.headers.get('Retry-After')); if (stop) throw JobScreenAccess.error(stop);
      if (response.ok) {
        const html = await response.text(); if (html.length > 2500000) throw Error('详情页面过大');
        const result = P.scanDocument(new DOMParser().parseFromString(html, 'text/html'), url, {}, true);
        if (result.jobs.length === 1 && result.jobs[0].requirements && result.jobs[0].completeness === 'detail') return result.jobs[0];
      }
    } catch (e) { if (signal.aborted) throw e; const stop = JobScreenAccess.read(e); if (stop) { await rpc('access-report', { stop, url }, task).catch(() => {}); throw e; } }
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason || new DOMException('已暂停', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      rpc('load', { url }, task).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  function setBusy(value) {
    const task = activeTask();
    $('collect').disabled = value || !task?.tabId || task.clearing;
    $('sample').disabled = [...tasks.items.values()].some(t => t.busy);
    for (const el of document.querySelectorAll('.pick,#clear-rule')) el.disabled = value || !task?.tabId;
    $('pause').hidden = !value; $('collect').textContent = value ? '采集中…' : '开始采集当前列表';
    $('resume').hidden = value || !task?.dataset || ['done','blocked','limited','permission','stopped'].includes(task.dataset.stage) || task.id === 'sample';
    const permission = task?.dataset?.stage === 'permission' && task.dataset.accessStop?.origin;
    $('detail-permission').hidden = !permission; $('authorize-details').disabled = Boolean(value);
    $('detail-permission-note').textContent = permission ? '岗位详情位于 ' + permission + '。授权后只读取岗位详情，沿用本轮进度和访问间隔。' : '';
    $('end-task').disabled = selectedTask === 'all' ? ![...tasks.items.values()].some(t => t.busy || t.dataset) : !task?.busy && !task?.dataset;
  }
  function renderTasks() {
    const select = $('task-source'), signature = [...tasks.items.values()].map(t => t.id).join('|');
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature; const all = node('option', '', '合并所有本轮来源'); all.value = 'all';
      select.replaceChildren(all, ...[...tasks.items.values()].map(t => { const o = node('option', '', t.label + ' · ' + (t.tabId ? '标签页 ' + t.tabId : t.id === 'sample' ? '示例' : '已离开')); o.value = t.id; return o; }));
    }
    select.value = selectedTask;
    $('source-label').textContent = activeTask() ? '当前来源：' + activeTask().label + ' · 沿用原网页当前筛选条件' : tasks.items.size ? '合并查看本轮来源；各网站分别点击小窗启动。' : '在招聘网页点击工具栏图标，打开该网站的小窗。';
    $('task-list').replaceChildren(...[...tasks.items.values()].map(t => {
      const row = node('div', 'task-item'), pick = node('button', 'subtle', t.label); pick.onclick = () => selectSource(t.id);
      row.append(pick, node('span', 'hint', (t.busy ? '采集中' : ['blocked','limited'].includes(t.dataset?.stage) ? '保护已停止' : t.dataset?.stage === 'stopped' ? '已停止' : t.dataset?.stage === 'permission' ? '详情待授权' : t.dataset?.stage === 'done' ? '已结束' : t.dataset ? '已暂停' : '尚未开始') + ' · ' + (t.dataset?.jobs.length || 0) + ' 个岗位')); return row;
    }));
  }
  function selectSource(id) { selectedTask = id; mode = 'session'; page = 1; render(); status(activeTask()?.message || '正在合并查看本轮来源；结束并清空将作用于全部本轮任务。'); }
  async function bindSource(binding) {
    if (!globalThis.chrome?.runtime) throw Error('真实采集需要安装浏览器插件');
    const result = await chrome.runtime.sendMessage({ type: 'job-hub-control', action: 'register', tabId: binding.tabId, nonce: binding.nonce });
    if (!result?.ok) throw Error(result?.error || '来源绑定失败');
    for (const previous of tasks.items.values()) if (previous.tabId === binding.tabId && previous.nonce !== binding.nonce) {
      previous.startToken = null;
      const stop = JobScreenAccess.error(JobScreenAccess.record('cancelled', '原标签页已切换网站，旧任务已停止；已有结果保留。'));
      previous.controller?.abort(stop);
      await rpc('close-worker', {}, previous).catch(() => {});
      await (previous.startPromise || previous.promise);
      previous.starting = false; previous.tabId = null; previous.message = JobScreenAccess.read(stop).reason;
      if (previous.dataset) { previous.dataset.stage = 'stopped'; previous.dataset.complete = false; previous.dataset.stopReason = previous.message; }
    }
    const task = tasks.add(result.result); task.rule = (await Store.get('jobRules', {}))[task.ruleKey] || {};
    if (selectedTask === 'all' && tasks.items.size === 1) selectedTask = task.id;
    render(); return task;
  }
  function widgetSnapshot(task) {
    const jobs = tasks.jobs(task), values = J.filter(jobs, profile, filters, marks(jobs)), d = task.dataset;
    return { busy: Boolean(task.busy || task.starting), clearing: Boolean(task.clearing), resumable: Boolean(d && !['done','blocked','limited','permission','stopped'].includes(d.stage)), needsPermission: d?.stage === 'permission', degree: profile.degree || '', hideDegreeConflicts: Boolean(filters.hideDegreeConflicts), total: jobs.length, count: values.length,
      read: jobs.filter(j => j.collectionState === 'read').length, message: task.message, query: filters.major || '',
      jobs: values.map(({ job, match }) => { const major = professionalData(job); return { key: job.key, name: job.name, company: job.company, city: job.city, url: job.url, linkKind: job.linkKind, degreeLabel: job.facts.degree.label, judgement: judgementLabel(match), conflictReason: match.conflictReason, majorLabel: major.label, majorMissing: major.missing, majorPrimary: major.primary, favorite: Boolean(favorites[keyFor(job)]) }; }) };
  }
  function publishWidgets() {
    if (!port || closing) return;
    try { port.postMessage({ type: 'states', states: [...tasks.items.values()].filter(t => t.tabId).map(t => ({ tabId: t.tabId, nonce: t.nonce, state: widgetSnapshot(t) })) }); } catch {}
  }
  async function completeFavorites(task) {
    if (!task.dataset) return;
    const write = async () => {
      const saved = await Store.get('jobFavorites', {}); let changed = false;
      for (const job of tasks.jobs(task)) { const entry = saved[keyFor(job)]; if (entry && entry.job.collectionState !== 'read' && job.collectionState === 'read') { entry.job = packed(job); changed = true; } }
      if (changed) { await Store.set('jobFavorites', saved); favorites = saved; }
    };
    if (navigator.locks) await navigator.locks.request('job-screen-favorites', write); else await write();
  }
  function startTask(task, resume = false) {
    if (!task || task.busy || task.starting || task.clearing) return Promise.resolve();
    const pending = runStartTask(task, resume); task.startPromise = pending;
    return pending.finally(() => { if (task.startPromise === pending) task.startPromise = null; });
  }
  async function runStartTask(task, resume = false) {
    if (!task || task.busy || task.starting || task.clearing) return;
    const token = {}; task.startToken = token; task.starting = true; render();
    try {
      const context = await rpc('context', {}, task), origin = new URL(context.url).origin;
      if (!await chrome.permissions.contains({ origins: [origin + '/*'] })) throw Error('未获得当前网站访问权限，请点击开始采集并允许。');
      if (task.startToken !== token) return;
      if (!resume) { task.source = context; task.ruleKey = origin + new URL(context.url).pathname; task.rule = (await Store.get('jobRules', {}))[task.ruleKey] || {}; }
      if (task.startToken !== token) return;
      const access = await rpc('access-begin', { resume }, task); task.ticket = access.ticket;
      if (task.startToken !== token) { await rpc('close-worker', {}, task).catch(() => {}); return; }
      await tasks.run(task, { read: () => rpc('scan', { rule: task.rule, expand: true }, task), next: () => rpc('advance', { rule: task.rule }, task),
        resolveLink: selector => rpc('resolve', { selector }, task), readDetail: (url, signal) => readDetail(url, signal, task),
        delay: 0,
        cleanup: async () => { await rpc('close-worker', {}, task).catch(() => {}); await completeFavorites(task); } }, resume);
    } catch (e) { task.message = JobScreenAccess.read(e)?.reason || e.message; }
    finally { if (task.startToken === token) { task.starting = false; task.startToken = null; } if (selectedTask === task.id) status(task.message); render(); }
  }
  async function requestAndStart(resume) {
    const task = activeTask(); if (!task?.tabId) { status('请在各网站的小窗分别开始，或先选择一个来源。'); return; }
    try { const granted = await chrome.permissions.request({ origins: [new URL(task.source.url).origin + '/*'] }); if (granted) { mode = 'session'; await startTask(task, resume); } else status('未获得当前网站权限，可以继续查看收藏。'); }
    catch (e) { status(e.message); }
  }
  async function clearTask(task) {
    task.startToken = null; task.starting = false;
    const pending = tasks.clear(task); if (task.tabId) await rpc('close-worker', {}, task).catch(() => {}); await pending;
    render(); if (selectedTask === task.id) status(task.message);
  }
  async function handleHub(action, binding) {
    let task = tasks.items.get(String(binding.tabId) + ':' + binding.nonce);
    if (action === 'bind' || !task) task = await bindSource(binding);
    if (action === 'bind' || action === 'snapshot') return widgetSnapshot(task);
    if (action === 'search') { filters.major = binding.query; restore(); controls(); page = 1; render(); }
    if (action === 'degree') { profile.degree = binding.degree; filters.hideDegreeConflicts = binding.hideDegreeConflicts; restore(); controls(); page = 1; render(); const value = {...profile}; profileSave = profileSave.then(() => Store.set('jobProfile', value)).catch(e => status('个人条件保存失败：' + e.message)); }
    if (['focus', 'detail', 'start', 'resume'].includes(action)) selectSource(task.id);
    if (action === 'start' || action === 'resume') startTask(task, action === 'resume');
    if (action === 'pause') { tasks.pause(task); rpc('close-worker', {}, task).catch(() => {}); }
    if (action === 'clear') await clearTask(task);
    if (['favorite', 'detail'].includes(action)) {
      const job = tasks.jobs(task).find(j => j.key === binding.key); if (!job) throw Error('该岗位已清空，请重新检索');
      if (action === 'detail') detail(job); else await editFavorite(job, { favorite: !favorites[keyFor(job)] });
    }
    return widgetSnapshot(task);
  }
  function connectHub() {
    if (!globalThis.chrome?.runtime || closing) return;
    const connected = chrome.runtime.connect({ name: 'job-screen-hub' }); port = connected;
    connected.onMessage.addListener(message => {
      if (message.type === 'access-stop') {
        for (const task of tasks.items.values()) if ((message.sources?.includes(task.tabId) || (task.source.url && new URL(task.source.url).origin === message.origin)) && (task.busy || task.starting)) {
          task.message = message.stop.reason; task.controller?.abort(JobScreenAccess.error(message.stop));
        }
        repaint(); return;
      }
      if (!message.id || !message.action) return;
      handleHub(message.action, message.data || {}).then(result => connected.postMessage({ id: message.id, result })).catch(e => { try { connected.postMessage({ id: message.id, error: e.message }); } catch {} });
    });
    connected.onDisconnect.addListener(() => { if (port === connected) { port = null; if (!closing) setTimeout(connectHub, 500); } });
    for (const task of tasks.items.values()) if (task.tabId) chrome.runtime.sendMessage({ type: 'job-hub-control', action: 'register', tabId: task.tabId, nonce: task.nonce }).catch(() => {});
    publishWidgets();
  }
  const heartbeat = setInterval(() => { try { port?.postMessage({ type: 'ping' }); } catch {} }, 20000);
  $('collect').onclick = () => requestAndStart(false); $('resume').onclick = () => requestAndStart(true);
  $('authorize-details').onclick = async () => {
    const task = activeTask(), origin = task?.dataset?.accessStop?.origin; if (!origin || task.busy) return;
    try { const granted = await chrome.permissions.request({origins:[origin + '/*']}); if (granted) await startTask(task, true); else status('未授权详情站点，已有结果保留，可打开岗位原页核对。'); } catch(e) { status('详情站点授权失败：' + e.message); }
  };
  $('pause').onclick = () => { const t = activeTask(); tasks.pause(t); if (t?.tabId) rpc('close-worker', {}, t).catch(() => {}); };
  $('task-source').onchange = () => selectSource($('task-source').value);
  $('end-task').onclick = async () => {
    const selected = selectedTask === 'all' ? [...tasks.items.values()] : [activeTask()].filter(Boolean);
    await Promise.all(selected.map(clearTask)); status(selectedTask === 'all' ? '全部本轮任务已结束，未收藏结果已清空。' : '当前任务已结束，未收藏结果已清空。');
  };
  $('sample').onclick = () => {
    const task = tasks.items.get('sample') || tasks.add({ id: 'sample' });
    task.dataset = { source: 'sample', jobs: JobScreenSamples.map(raw => J.normalize(raw, 'sample')), total: JobScreenSamples.length, stage: 'done', complete: true };
    task.message = '已加载虚构示例。点击收藏可体验保存岗位和链接。'; selectSource(task.id); status(task.message);
  };
  for (const k of profileFields) $('my-' + k).addEventListener('input', () => {
    if (!$('my-' + k).checkValidity()) return; controls(); page = 1; render();
    const value = { ...profile }; profileSave = profileSave.then(() => Store.set('jobProfile', value)).catch(e => status('个人条件保存失败：' + e.message));
  });
  for (const k of filterFields) $('filter-' + k).addEventListener('input', () => { controls(); page = 1; render(); });
  $('reset').onclick = () => { filters = {}; restore(); controls(); page = 1; render(); };
  $('clear-profile').onclick = async () => { profile = {}; restore(); controls(); page = 1; render(); let saved = false; profileSave = profileSave.then(async () => { await Store.set('jobProfile', {}); saved = true; }).catch(e => status('个人条件清空失败：' + e.message)); await profileSave; if (saved) status('已清空个人条件，收藏保留。'); };
  for (const name of ['favorites', 'session']) $('tab-' + name).onclick = () => { mode = name; filters = {}; restore(); controls(); page = 1; render(); };
  for (const name of ['table', 'cards']) $('view-' + name).onclick = async () => { view = name; render(); await Store.set('jobView', view); };
  const download = (name, value, type) => { const url = URL.createObjectURL(new Blob([value], { type })), a = node('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  $('export-csv').onclick = () => { download('岗位筛选结果.csv', J.csv(rows), 'text/csv;charset=utf-8'); status('已导出当前筛选的全部 ' + rows.length + ' 条结果。'); };
  $('export-json').onclick = () => { download('岗位收藏备份.json', JSON.stringify({ format: 'job-screen-favorites', version: 1, favorites: Object.values(favorites) }, null, 2), 'application/json'); status('仅备份收藏，未包含普通结果和个人条件。'); };
  $('import-json').onchange = async () => {
    try {
      const file = $('import-json').files[0]; if (!file) return; if (file.size > 15 * 1024 * 1024) throw Error('文件超过 15 MB');
      const data = JSON.parse(await file.text()); let entries;
      if (data.format === 'job-screen-favorites' && data.version === 1 && Array.isArray(data.favorites)) entries = data.favorites;
      else if (['job-screen', 'application-jobs'].includes(data.format) && data.version === 1 && Array.isArray(data.dataset?.jobs))
        entries = data.dataset.jobs.filter(j => data.marks?.[j.key || (j.source || data.dataset.source || 'page') + ':' + j.id]?.favorite).map(job => ({ job, status: data.marks[job.key || (job.source || data.dataset.source || 'page') + ':' + job.id].status }));
      else throw Error('不是支持的收藏备份');
      if (entries.length > 6000) throw Error('收藏超过 6000 条');
      const write = async () => {
        const saved = await Store.get('jobFavorites', {});
        for (const f of entries) { const j = J.normalize(f.job, f.job?.source || 'page'); saved[keyFor(j)] = { job: packed(j), status: ['未标记', '准备投递', '已投递', '不考虑'].includes(f.status) ? f.status : '未标记', savedAt: J.text(f.savedAt) || new Date().toISOString() }; }
        await Store.set('jobFavorites', saved); favorites = saved;
      };
      if (navigator.locks) await navigator.locks.request('job-screen-favorites', write); else await write();
      mode = 'favorites'; filters = {}; restore(); controls(); render(); status('已导入收藏。旧版备份只导入其中已收藏的岗位。');
    } catch (e) { status('导入失败：' + e.message); } finally { $('import-json').value = ''; }
  };
  for (const el of document.querySelectorAll('.pick')) el.onclick = async () => {
    try {
      const value = await rpc('pick', { kind: el.dataset.kind, rule }); if (!value) { status('已取消选择'); return; }
      rule[el.dataset.kind] = value; const rules = await Store.get('jobRules', {}); rules[ruleKey] = rule; await Store.set('jobRules', rules);
      if (activeTask()) activeTask().rule = rule;
      status('已记住本页识别规则，可以重新开始采集。');
    } catch (e) { status(e.message); }
  };
  $('clear-rule').onclick = async () => { rule = {}; if (activeTask()) activeTask().rule = rule; const rules = await Store.get('jobRules', {}); delete rules[ruleKey]; await Store.set('jobRules', rules); status('本页规则已清除'); };
  $('prev').onclick = () => { page--; render(); }; $('next').onclick = () => { page++; render(); };
  $('detail-close').onclick = () => $('detail').close();
  $('detail').onclick = e => { if (e.target === $('detail') && e.clientX < $('detail').getBoundingClientRect().left) $('detail').close(); };
  $('app-close').onclick = async () => {
    closing = true; clearInterval(heartbeat); for (const task of tasks.items.values()) { task.startToken = null; tasks.pause(task); }
    if (globalThis.chrome?.runtime) await chrome.runtime.sendMessage({ type: 'job-screen', action: 'close-worker' }).catch(() => {});
    if (globalThis.chrome?.tabs) { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.remove(tab.id); }
    else { tasks.items.clear(); mode = 'favorites'; closing = false; render(); status('本次普通结果已清空，可以关闭此标签页。'); }
  };
  window.addEventListener('pagehide', () => { closing = true; clearInterval(heartbeat); for (const task of tasks.items.values()) tasks.pause(task); });
  if (globalThis.chrome?.storage?.onChanged) chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.jobFavorites) { favorites = changes.jobFavorites.newValue || {}; render(); } });
  $('major-list').replaceChildren(...J.majors.catalog.majors.map(([, name]) => { const o = node('option'); o.value = name; return o; }));
  restore(); controls(); render(); setBusy(false);
  connectHub();
  if (initialBinding) try { await bindSource(initialBinding); } catch (e) { status(e.message); $('collect').disabled = true; }
})().catch(error => { document.getElementById('status').textContent = '初始化失败：' + error.message; });
