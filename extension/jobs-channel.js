'use strict';
// Routes control messages only. Job records remain in the hub page's memory.
globalThis.JobScreenChannel = (() => {
  const ports = new Map(), pending = new Map(), closing = new Map(), readers = new Map(); let opening = null;
  function readerToken(owner, source) { const key = owner + ':' + source; if (!readers.has(key)) readers.set(key, crypto.randomUUID()); return readers.get(key); }
  function cancelReaders(owner, source) {
    if (source) readers.set(owner + ':' + source, crypto.randomUUID());
    else for (const key of readers.keys()) if (key.startsWith(owner + ':')) readers.set(key, crypto.randomUUID());
  }
  const ownPage = sender => { try { const u = new URL(sender.url); return sender.id === chrome.runtime.id && u.origin === new URL(chrome.runtime.getURL('/')).origin && u.pathname === '/jobs.html' && Number.isInteger(sender.tab?.id); } catch { return false; } };
  const ownerKey = (owner, source) => 'jobOwner:' + owner + ':' + source;
  async function bind(tab) {
    if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) return null;
    const key = 'jobBinding:' + tab.id, origin = new URL(tab.url).origin;
    let binding = (await chrome.storage.session.get(key))[key];
    if (!binding || binding.origin !== origin) { binding = { nonce: crypto.randomUUID(), origin }; await chrome.storage.session.set({ [key]: binding }); }
    return { tabId: tab.id, nonce: binding.nonce, url: tab.url, title: tab.title || '' };
  }
  async function authorize(owner, tabId, nonce) {
    await closing.get(owner);
    const key = 'jobBinding:' + tabId, binding = (await chrome.storage.session.get(key))[key], tab = await chrome.tabs.get(tabId);
    if (!binding || binding.nonce !== nonce || !/^https?:\/\//.test(tab.url || '') || new URL(tab.url).origin !== binding.origin) throw Error('原标签页已切换网站，请重新打开插件');
    await chrome.storage.session.set({ [ownerKey(owner, tabId)]: nonce });
    return { tabId, nonce, url: tab.url, title: tab.title || '' };
  }
  async function waitPort(tabId) {
    for (let i = 0; i < 60; i++) { if (ports.has(tabId)) return ports.get(tabId); await new Promise(r => setTimeout(r, 150)); }
    throw Error('总筛选台尚未连接，请重新打开插件');
  }
  async function request(tabId, action, data = {}) {
    const port = await waitPort(tabId), id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('总筛选台响应超时，请查看总台状态')); }, 20000);
      pending.set(id, { port, resolve, reject, timer });
      try { port.postMessage({ id, action, data }); } catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
    });
  }
  async function hub(binding, active) {
    const ensure = async () => {
      const saved = (await chrome.storage.session.get('jobHubTab')).jobHubTab;
      let tab = saved ? await chrome.tabs.get(saved).catch(() => null) : null;
      if (!tab?.url?.startsWith(chrome.runtime.getURL('jobs.html'))) {
        const query = binding ? '?tab=' + binding.tabId + '&nonce=' + encodeURIComponent(binding.nonce) : '';
        tab = await chrome.tabs.create({ url: chrome.runtime.getURL('jobs.html' + query), active });
        await chrome.storage.session.set({ jobHubTab: tab.id });
      }
      return tab;
    };
    if (!opening) opening = ensure().finally(() => { opening = null; });
    const tab = await opening;
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
    if (binding) { const authorized = await authorize(tab.id, binding.tabId, binding.nonce); await request(tab.id, 'bind', authorized); }
    if (active) await chrome.tabs.update(tab.id, { active: true });
    return tab;
  }
  async function open(tab, active = true) { return hub(await bind(tab), active); }
  async function showMini(tab) {
    if (!/^https?:\/\//.test(tab?.url || '')) return open(null, true);
    // Request starts directly in the toolbar gesture, before any await.
    const permission = chrome.permissions.request({ origins: [new URL(tab.url).origin + '/*'] }).catch(() => false);
    const binding = await bind(tab); await hub(binding, false); await permission;
    await chrome.storage.session.set({ ['jobWidget:' + tab.id]: true });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['jobs-widget.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: data => JobScreenWidget.show(data), args: [binding] });
    const saved = (await chrome.storage.session.get('jobHubTab')).jobHubTab;
    const snapshot = await request(saved, 'snapshot', binding);
    await chrome.tabs.sendMessage(tab.id, { type: 'job-widget-state', nonce: binding.nonce, state: snapshot }).catch(() => {});
  }
  async function cleanup(owner) {
    cancelReaders(owner);
    globalThis.JobScreenAccessBackground?.finish(owner);
    const data = await chrome.storage.session.get(null), keys = [];
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('jobWorker:') && (value.ownerTabId === owner || key === 'jobWorker:' + owner)) { await chrome.tabs.remove(value.tabId).catch(() => {}); keys.push(key); }
      if (key.startsWith('jobOwner:' + owner + ':')) {
        const sourceTabId = Number(key.split(':')[2]);
        await chrome.tabs.sendMessage(sourceTabId, { type: 'job-widget-state', nonce: value, state: { busy: false, message: '总筛选台已关闭或刷新，本轮未收藏结果已清空。', jobs: [], count: 0, ended: true } }).catch(() => {}); keys.push(key);
      }
    }
    await chrome.storage.session.remove(keys);
  }
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'job-screen-hub' || !ownPage(port.sender)) return;
    const owner = port.sender.tab.id; ports.set(owner, port);
    chrome.storage.session.get('jobHubTab').then(s => { if (!s.jobHubTab) return chrome.storage.session.set({ jobHubTab: owner }); });
    port.onMessage.addListener(message => {
      const reply = pending.get(message.id);
      if (reply?.port === port) { clearTimeout(reply.timer); pending.delete(message.id); message.error ? reply.reject(Error(message.error)) : reply.resolve(message.result); }
      if (message.type === 'states' && Array.isArray(message.states)) for (const item of message.states.slice(0, 30)) {
        chrome.storage.session.get(ownerKey(owner, item.tabId)).then(data => {
          if (data[ownerKey(owner, item.tabId)] === item.nonce) return chrome.tabs.sendMessage(item.tabId, { type: 'job-widget-state', nonce: item.nonce, state: item.state }).catch(() => {});
        });
      }
    });
    port.onDisconnect.addListener(() => {
      if (ports.get(owner) !== port) return;
      ports.delete(owner);
      for (const [id, item] of pending) if (item.port === port) { clearTimeout(item.timer); item.reject(Error('总筛选台连接已重置')); pending.delete(id); }
      const clean = cleanup(owner).catch(() => {}).finally(() => { if (closing.get(owner) === clean) closing.delete(owner); }); closing.set(owner, clean);
    });
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['job-widget', 'job-hub-control'].includes(message?.type)) return;
    (async () => {
      if (message.type === 'job-hub-control') {
        if (!ownPage(sender) || message.action !== 'register') throw Error('总台来源无效');
        return authorize(sender.tab.id, Number(message.tabId), message.nonce);
      }
      const tabId = Number(message.tabId), binding = (await chrome.storage.session.get('jobBinding:' + tabId))['jobBinding:' + tabId];
      if (sender.id !== chrome.runtime.id || sender.tab?.id !== tabId || !binding || binding.nonce !== message.nonce || new URL(sender.url).origin !== binding.origin) throw Error('小窗与当前网站未绑定');
      if (!['snapshot', 'start', 'resume', 'pause', 'clear', 'focus', 'detail', 'favorite', 'search', 'degree', 'hide'].includes(message.action)) throw Error('小窗操作无效');
      if (message.action === 'degree' && !['','专科','本科','硕士','博士'].includes(message.degree)) throw Error('学历设置无效');
      if (message.action === 'hide') { await chrome.storage.session.set({ ['jobWidget:' + tabId]: false }); return true; }
      const metadata = { tabId, nonce: binding.nonce, url: sender.tab.url, title: sender.tab.title || '' };
      const page = await hub(metadata, false);
      if (['start', 'resume'].includes(message.action) && !await chrome.permissions.contains({ origins: [binding.origin + '/*'] })) {
        await chrome.tabs.update(page.id, { active: true }); throw Error('请在总台点击开始采集，允许读取当前网站后再使用小窗');
      }
      if (['focus', 'detail'].includes(message.action)) await chrome.tabs.update(page.id, { active: true });
      return request(page.id, message.action, { ...metadata, key: String(message.key || '').slice(0, 3000), query: String(message.query || '').slice(0, 300), degree: message.degree || '', hideDegreeConflicts: Boolean(message.hideDegreeConflicts) });
    })().then(result => respond({ ok: true, result })).catch(error => respond({ ok: false, error: error.message })); return true;
  });
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status !== 'complete' || !/^https?:\/\//.test(tab.url || '')) return;
    (async () => {
      const data = await chrome.storage.session.get(['jobWidget:' + tabId, 'jobBinding:' + tabId, 'jobHubTab']), binding = data['jobBinding:' + tabId], owner = data.jobHubTab;
      if (!data['jobWidget:' + tabId] || !owner || !binding || new URL(tab.url).origin !== binding.origin) return;
      if ((await chrome.storage.session.get(ownerKey(owner, tabId)))[ownerKey(owner, tabId)] !== binding.nonce) return;
      const metadata = { tabId, nonce: binding.nonce, url: tab.url, title: tab.title || '' };
      await chrome.scripting.executeScript({ target: { tabId }, files: ['jobs-widget.js'] });
      await chrome.scripting.executeScript({ target: { tabId }, func: value => JobScreenWidget.show(value), args: [metadata] });
      const state = await request(owner, 'snapshot', metadata);
      await chrome.tabs.sendMessage(tabId, { type: 'job-widget-state', nonce: binding.nonce, state });
    })().catch(() => {});
  });
  function accessStop(owner, origin, stop, sources) { try { ports.get(owner)?.postMessage({ type: 'access-stop', origin, stop, sources }); } catch {} }
  return { open, showMini, ownPage, ownerKey, cleanup, readerToken, cancelReaders, accessStop };
})();
