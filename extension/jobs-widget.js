(function (root) {
  'use strict';
  if (root.JobScreenWidget) return;
  let binding, current = {}, host, panel, list, message, count, search, degree, hideDegree, speed, start, pause, resume, restart, clear, authorize;
  let pollTimer, polling = false, epochFloor = 0;
  let renderedRows = new Map(), listSignature = '';
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  async function send(action, extra = {}) {
    try {
      const requested = { ...binding };
      const pending = chrome.runtime.sendMessage({ type: 'job-widget', action, tabId: requested.tabId, nonce: requested.nonce, ...extra });
      let timer;
      const response = await (action === 'snapshot' ? Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('状态同步超时，正在重连；已有结果保留。')), 6000); })]).finally(() => clearTimeout(timer)) : pending);
      if (binding.nonce !== requested.nonce) return;
      if (!response?.ok) throw Error(response?.error || '插件连接已断开，请重新点击工具栏图标');
      if (response.result?.jobs) render(response.result);
      return response.result;
    } catch (e) {
      if (action === 'snapshot') render({ ...current, busy: false, connectionLost: true, message: '状态连接中断，正在重连；已有结果保留。' });
      else message.textContent = e.message;
    }
  }
  async function poll() { if (polling || !host?.isConnected || host.style.display === 'none') return; polling = true; try { await send('snapshot'); } finally { polling = false; } }
  function button(label, action, fn) { const b = el('button', label); b.dataset.action = action; b.type = 'button'; b.onclick = fn || (() => send(action)); return b; }
  function build() {
    renderedRows = new Map(); listSignature = '';
    host = el('div'); host.id = 'job-screen-widget'; host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483646;width:min(370px,calc(100vw - 28px));display:block;';
    const shadow = host.attachShadow({ mode: 'closed' }), style = el('style');
    style.textContent = ':host{all:initial}*{box-sizing:border-box}section{font:13px/1.7 system-ui,"Microsoft YaHei",sans-serif;color:#39334f;background:linear-gradient(145deg,#fff,#f7f4ff);border:1px solid #e3dcf3;border-radius:20px;box-shadow:0 15px 65px #30205226;max-height:calc(100vh - 40px);overflow:auto;padding:18px}header{display:flex;gap:10px;align-items:center}h2{font-size:15px;margin:0;flex:1}small{color:#807393}p{margin:8px 0}button{border:1px solid #e4dcf4;background:#f3effc;border-radius:9px;padding:7px 10px;color:#7053b6;font:inherit;cursor:pointer}button:hover{background:#eae1fc}button:disabled{opacity:.5;cursor:default}.close{border:0;font-size:22px;padding:0 8px;background:transparent}.actions{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}.primary{background:#7460c7;color:white;border-color:#7460c7}label{display:block;font-size:12px;color:#776a8c}input,select{width:100%;border:1px solid #ded6ed;background:white;border-radius:9px;padding:9px;font:inherit;color:#39334f;margin:4px 0}ol{list-style:none;margin:0;padding:0}li{background:#ffffffbd;border:1px solid #ebe5f5;border-radius:12px;margin:8px 0;padding:10px}.job-name{font-weight:650;text-align:left;background:none;border:0;padding:0;color:#40345b}.job-meta{font-size:11px;color:#8d7c9c}.major{font-size:12px;font-weight:650;color:#6545b4}.row-actions{display:flex;gap:12px;align-items:center;font-size:11px;margin-top:7px}.row-actions button{font-size:11px;padding:3px 8px}a{color:#796298;text-decoration:none}.status{font-size:12px;color:#8c759c;overflow-wrap:anywhere}.count{font-size:12px;color:#76638e;background:#eee8fa;border-radius:9px;padding:8px}.note{font-size:11px;color:#9c8daa}.danger{color:#a36683;background:#fbf1f6}.empty{font-size:12px;color:#9b8ca9;padding:15px 0}.degree-filter{display:flex;align-items:center;gap:6px;margin:7px 0}.degree-filter input{width:auto;margin:0}.conflict-reason{font-size:11px;color:#ad5c74;margin-top:5px}select{margin:4px 0}.original-job-button{display:inline-flex;align-items:center;justify-content:center;border:1px solid #d8cdf4;border-radius:8px;padding:3px 9px;background:#f0ebff;color:#6047aa;font-size:11px;font-weight:650}.original-job-button:hover{background:#e6ddfc}.major.missing{color:#a07124;background:#fff4dc;border:1px solid #f2dfb7;border-radius:7px;padding:4px 7px;margin:6px 0;display:inline-block}[hidden]{display:none!important}';
    panel = el('section'); panel.setAttribute('aria-label', '岗位筛选小窗');
    const head = el('header'); head.append(el('h2', '岗位筛选助手'));
    const close = button('×', 'hide', () => { hide(); send('hide'); }); close.className = 'close'; close.setAttribute('aria-label', '收起小窗，任务继续'); head.append(close);
    const source = el('small', ''); source.id = 'source'; panel.append(head, source);
    const label = el('label', '专业检索词'); search = el('input'); search.placeholder = '例如 电气、电子信息'; search.setAttribute('aria-label', '专业检索词'); label.append(search);
    search.onchange = () => send('search', { query: search.value }); panel.append(label);
    const education = el('label', '我的学历'); degree = el('select'); degree.setAttribute('aria-label', '我的学历');
    for (const value of ['', '专科', '本科', '硕士', '博士']) { const option = el('option', value || '未设置'); option.value = value; degree.append(option); } education.append(degree);
    const hideLabel = el('label', undefined, 'degree-filter'); hideDegree = el('input'); hideDegree.type = 'checkbox'; hideDegree.setAttribute('aria-label', '隐藏学历明确不符'); hideLabel.append(hideDegree, document.createTextNode('隐藏学历明确不符（未知仍保留）'));
    degree.onchange = hideDegree.onchange = () => send('degree', { degree: degree.value, hideDegreeConflicts: hideDegree.checked }); panel.append(education, hideLabel);
    const pace = el('label', '采集速度'); speed = el('select'); speed.setAttribute('aria-label', '采集速度');
    for (const [value, text] of [['steady', '稳妥 · 3 秒间隔（默认）'], ['fast', '较快 · 2 秒间隔']]) { const option = el('option', text); option.value = value; speed.append(option); } pace.append(speed); speed.onchange = () => send('speed', { speed: speed.value }); panel.append(pace, el('p', '采集中先暂停再改速度；同站按较慢设置共用间隔。较快模式可能更易限流，遇到限制仍立即停止。', 'note'));
    const actions = el('div', undefined, 'actions'); start = button('开始检索', 'start'); start.className = 'primary'; pause = button('暂停', 'pause'); resume = button('继续', 'resume');
    resume.textContent = '继续本次采集'; resume.className = 'primary'; restart = button('重新开始并清空进度', 'restart'); restart.title = '清空本轮进度，从原招聘页当前所在页开始';
    clear = button('结束并清空', 'clear'); clear.className = 'danger'; const full = button('打开总筛选台 ↗', 'focus'); authorize = button('授权详情站点 ↗', 'focus'); authorize.hidden = true; actions.append(start, pause, resume, restart, authorize, full, clear); panel.append(actions);
    count = el('p', '尚未开始', 'count'); message = el('p', '当前网站独立检索，专业与其他条件可在总台设置。', 'status'); message.setAttribute('role', 'status'); list = el('ol');
    panel.append(count, message, list, el('p', '× 只收起小窗；请保持总筛选台打开。收藏长期保存，其他结果仅属于本轮会话。', 'note'));
    shadow.append(style, panel); document.documentElement.append(host);
  }
  function render(state) {
    if (!panel) return;
    if (state?.epoch && (state.epoch < epochFloor || state.epoch < (current.epoch || 0) || state.epoch === current.epoch && state.revision < current.revision)) return;
    if (state?.ended) epochFloor = Math.max(epochFloor, (current.epoch || 0) + 1);
    current = state || {};
    count.textContent = '已发现 ' + (current.total || 0) + ' · 筛选后 ' + (current.count || 0) + ' · 已读详情 ' + (current.read || 0);
    message.textContent = current.message || '尚未开始'; start.disabled = Boolean(current.busy || current.clearing || current.hasProgress || current.connectionLost); start.hidden = Boolean(current.resumable); pause.hidden = !current.busy; resume.hidden = current.busy || !current.resumable; resume.disabled = Boolean(current.connectionLost); clear.disabled = !current.total && !current.busy;
    restart.hidden = !current.hasProgress; restart.disabled = Boolean(current.busy || current.clearing || current.connectionLost);
    authorize.hidden = !current.needsPermission; degree.value = current.degree || ''; hideDegree.checked = Boolean(current.hideDegreeConflicts); speed.value = current.speed === 'fast' ? 'fast' : 'steady'; speed.disabled = Boolean(current.busy || current.clearing);
    if (document.activeElement !== host && search.value !== (current.query || '')) search.value = current.query || '';
    const signature = JSON.stringify([current.total || 0, current.count || 0, current.jobs || []]);
    if (signature === listSignature) return;
    listSignature = signature; const nextRows = new Map(), children = [];
    for (const job of (current.jobs || [])) {
      const key = job.key, signature = JSON.stringify(job), old = renderedRows.get(key);
      if (old?.signature === signature) { nextRows.set(key, old); children.push(old.row); continue; }
      const row = el('li'), title = button(job.name, 'detail', () => send('detail', { key: job.key })); title.className = 'job-name';
      row.append(title, el('div', [job.city, job.company].filter(Boolean).join(' · '), 'job-meta'), el('div', job.majorLabel || '未检测到专业要求', 'major' + (job.majorMissing ? ' missing' : '')));
      row.append(el('div', '学历要求：' + (job.degreeLabel || '未明确') + (job.judgement ? ' · ' + job.judgement : ''), 'job-meta'));
      if (job.conflictReason) row.append(el('div', job.conflictReason, 'conflict-reason'));
      if (job.majorPrimary) row.append(el('div', job.majorPrimary, 'job-meta'));
      const actions = el('div', undefined, 'row-actions'); actions.append(button(job.favorite ? '★ 已收藏' : '☆ 收藏', 'favorite', () => send('favorite', { key: job.key })));
      try { const url = new URL(job.url); if (/^https?:$/.test(url.protocol) && !url.username && !url.password) { const link = el('a', job.linkKind === 'detail' ? '查看原岗位 ↗' : '查看来源列表 ↗', 'original-job-button'); link.setAttribute('aria-label', (job.linkKind === 'detail' ? '查看原岗位 ' : '查看来源列表 ') + job.name); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link); } } catch {}
      row.append(actions); nextRows.set(key, { signature, row }); children.push(row);
    }
    if (!current.jobs?.length) children.push(el('li', current.total ? '暂无符合当前组合的结果，可在总台调整条件。' : '点击开始检索，沿用原网站当前的筛选范围。', 'empty'));
    else children.push(el('li', '已显示当前筛选的全部 ' + current.count + ' 条结果，可在小窗内滚动查看。', 'note'));
    list.replaceChildren(...children); renderedRows = nextRows;
  }
  function show(data) { if (binding && binding.nonce !== data.nonce) { current = {}; epochFloor = 0; } binding = data; if (!host?.isConnected) build(); host.style.display = 'block'; panel.querySelector('#source').textContent = new URL(data.url).hostname + ' · 仅控制当前网站'; render(current); clearInterval(pollTimer); pollTimer = setInterval(poll, 4000); poll(); }
  function hide() { if (host) host.style.display = 'none'; clearInterval(pollTimer); }
  chrome.runtime.onMessage.addListener((value, sender) => { if (sender.id === chrome.runtime.id && value?.type === 'job-widget-state' && value.nonce === binding?.nonce) render(value.state); });
  root.JobScreenWidget = { show, hide };
})(globalThis);
