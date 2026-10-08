'use strict';
importScripts('jobs-access.js', 'jobs-channel.js', 'jobs-access-background.js');
const trustedStorage = () => chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.runtime.onInstalled.addListener(trustedStorage);
chrome.runtime.onStartup.addListener(trustedStorage);
async function openDashboard(tab) {
  return JobScreenChannel.open(tab, true);
}
chrome.action.onClicked.addListener(tab => JobScreenChannel.showMini(tab).catch(() => chrome.action.setBadgeText({ tabId: tab.id, text: '!' })));
chrome.tabs.onRemoved.addListener(async tabId => {
  const data = await chrome.storage.session.get(null), owned = data['jobWorker:' + tabId];
  if (data.jobHubTab === tabId) { await JobScreenChannel.cleanup(tabId); await chrome.storage.session.remove('jobHubTab'); }
  if (owned?.tabId) await chrome.tabs.remove(owned.tabId).catch(() => {});
  for (const [key, value] of Object.entries(data)) if (key.startsWith('jobWorker:') && (value.sourceTabId === tabId || value.ownerTabId === tabId)) {
    await chrome.tabs.remove(value.tabId).catch(() => {}); await chrome.storage.session.remove(key);
  }
  const owners = Object.keys(data).filter(key => key.startsWith('jobOwner:') && key.endsWith(':' + tabId));
  for (const key of owners) JobScreenChannel.cancelReaders(Number(key.split(':')[1]), tabId);
  await chrome.storage.session.remove(['jobBinding:' + tabId, 'jobWidget:' + tabId, 'jobWorker:' + tabId, ...owners]);
});
async function inspect(tabId, rule, expand = false, detailOnly = false, access = null) {
  if (access) JobScreenAccessBackground.current(access.owner, access.source, access.ticket);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['jobs-access.js', 'jobs-page.js'] });
  const out = await chrome.scripting.executeScript({ target: { tabId }, func: (r, ex, detail, ctx) => JobScreenPage.scan(r, ex, detail, ctx ? async () => {
    const reply = await chrome.runtime.sendMessage({ type: 'job-access-step', ticket: ctx.ticket });
    if (!reply?.ok) throw reply?.accessStop ? JobScreenAccess.error(reply.accessStop) : Error(reply?.error || '读取授权已结束');
  } : null), args: [rule || {}, expand, detailOnly, access] });
  return out[0]?.result;
}
async function settled(tabId, origin, rule, previous, detailOnly = false, access = null) {
  const until = Date.now() + 16000; let partial;
  while (Date.now() < until) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && !tab.url.startsWith('about:') && new URL(tab.url).origin !== origin) throw JobScreenAccess.error(JobScreenAccess.record('cancelled', '页面跳转到其他网站，已停止；请在新页面重新打开插件。'));
    if (tab.status === 'complete') try {
      const r = await inspect(tabId, rule, true, detailOnly, access);
      if (r?.jobs.length && (!previous || r.signature !== previous)) { if (detailOnly && r.jobs[0]?.completeness === 'detail-summary') partial = r; else return r; }
    } catch (e) { if (JobScreenAccess.read(e)) throw e; }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  if (partial) return partial;
  throw Error('页面加载超时或翻页后内容未变化。当前结果保留，可暂停后重试。');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'job-screen') return;
  let accessOrigin = '';
  (async () => {
    const dashboard = new URL(chrome.runtime.getURL('jobs.html')), source = new URL(sender.url || 'https://invalid/');
    if (sender.id !== chrome.runtime.id || source.origin !== dashboard.origin || source.pathname !== '/jobs.html') throw Error('来源无效');
    if (!['context', 'scan', 'advance', 'resolve', 'load', 'pick', 'close-worker', 'access-begin', 'access-permit', 'access-report'].includes(message.action)) throw Error('仅支持读取岗位与招聘列表翻页');
    const ownerId = sender.tab?.id;
    const readToken = message.action === 'load' ? JobScreenChannel.readerToken(ownerId, Number(message.tabId)) : null;
    if (message.action === 'close-worker') {
      JobScreenChannel.cancelReaders(ownerId, Number(message.tabId));
      JobScreenAccessBackground.finish(ownerId, Number(message.tabId));
      const data = await chrome.storage.session.get(null), keys = [];
      for (const [key, owned] of Object.entries(data)) if (key.startsWith('jobWorker:') && (owned.ownerTabId === ownerId || key === 'jobWorker:' + ownerId) && (!message.tabId || owned.sourceTabId === Number(message.tabId))) { await chrome.tabs.remove(owned.tabId).catch(() => {}); keys.push(key); }
      await chrome.storage.session.remove(keys); return true;
    }
    const tabId = Number(message.tabId), binding = (await chrome.storage.session.get('jobBinding:' + tabId))['jobBinding:' + tabId];
    const owner = JobScreenChannel.ownerKey(ownerId, tabId), registered = (await chrome.storage.session.get(owner))[owner];
    if (!binding || binding.nonce !== message.nonce || registered !== binding.nonce) throw JobScreenAccess.error(JobScreenAccess.record('cancelled', '页面未绑定原标签页，请在招聘网页点击插件图标重新打开'));
    const tab = await chrome.tabs.get(tabId);
    if (!/^https?:\/\//.test(tab.url || '') || new URL(tab.url).origin !== binding.origin) throw JobScreenAccess.error(JobScreenAccess.record('cancelled', '原标签页已切换网站，任务已停止；请在新页面重新打开插件'));
    accessOrigin = binding.origin;
    if (message.action === 'context') return { url: tab.url, title: tab.title };
    if (message.action === 'access-begin') return JobScreenAccessBackground.begin(ownerId, tabId, binding.origin, Boolean(message.resume));
    if (message.action === 'access-permit') { accessOrigin = await JobScreenAccessBackground.target(binding.origin, message.url); return JobScreenAccessBackground.permit(ownerId, tabId, message.ticket, message.url); }
    if (message.action === 'access-report') { accessOrigin = await JobScreenAccessBackground.target(binding.origin, message.url); if (!['rate', 'refused', 'captcha'].includes(message.stop?.kind)) throw Error('访问限制类型无效'); throw JobScreenAccess.error(message.stop); }
    if (message.action === 'load') accessOrigin = await JobScreenAccessBackground.target(binding.origin, message.url);
    const access = ['scan', 'advance', 'resolve', 'load'].includes(message.action) ? { owner: ownerId, source: tabId, ticket: JobScreenAccessBackground.current(ownerId, tabId, message.ticket).ticket } : null;
    if (message.action === 'scan') return inspect(tabId, message.rule, Boolean(message.expand), false, access);
    if (message.action === 'advance') {
      const prior = await inspect(tabId, message.rule, false, false, access);
      const advanced = await chrome.scripting.executeScript({ target: { tabId }, func: (r, ctx) => JobScreenPage.advance(r, async () => {
        const reply = await chrome.runtime.sendMessage({ type: 'job-access-step', ticket: ctx.ticket });
        if (!reply?.ok) throw reply?.accessStop ? JobScreenAccess.error(reply.accessStop) : Error(reply?.error || '读取授权已结束');
      }), args: [message.rule || {}, access] });
      if (advanced[0]?.result?.jobs) return advanced[0].result;
      return settled(tabId, binding.origin, message.rule, prior.signature, false, access);
    }
    if (message.action === 'pick') {
      if (!['area', 'title', 'next'].includes(message.kind)) throw Error('选择类型无效');
      await chrome.tabs.update(tabId, { active: true }); await inspect(tabId, message.rule);
      const out = await chrome.scripting.executeScript({ target: { tabId }, func: kind => JobScreenPage.pick(kind), args: [message.kind] });
      return out[0]?.result || null;
    }
    if (message.action === 'resolve') {
      await JobScreenAccessBackground.permit(ownerId, tabId, access.ticket);
      const out = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: async css => {
        const el = document.querySelector(css);
        if (!el || /申请|投递|登录|注册|提交/.test(el.textContent.trim())) return '';
        const original = window.open, before = location.href; let captured = '';
        window.open = url => { try { captured = new URL(url, location.href).href; } catch {} return null; };
        try { el.click(); if (!captured) await new Promise(resolve => setTimeout(resolve, 250)); } finally { window.open = original; }
        return { url: captured, navigated: location.href !== before };
      }, args: [String(message.selector || '').slice(0, 1500)] });
      const r = out[0]?.result;
      if (r?.navigated) { await chrome.tabs.goBack(tabId).catch(() => {}); throw Error('标题在原页跳转，未识别独立详情链接。'); }
      if (!r?.url) return ''; const resolved = new URL(r.url); return /^https?:$/.test(resolved.protocol) && !resolved.username && !resolved.password ? resolved.href : '';
    }
    const url = new URL(message.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw Error('详情链接无效');
    if (!await chrome.permissions.contains({ origins: [url.origin + '/*'] })) throw Error('需要允许读取当前详情网站的权限');
    await JobScreenAccessBackground.permit(ownerId, tabId, access.ticket, url.href);
    const key = 'jobWorker:' + ownerId + ':' + tabId; let owned = (await chrome.storage.session.get(key))[key], worker;
    const cancelled = () => JobScreenChannel.readerToken(ownerId, tabId) !== readToken;
    if (cancelled()) throw Error('详情读取已结束');
    if (owned?.tabId) worker = await chrome.tabs.get(owned.tabId).catch(() => null);
    if (worker) await chrome.tabs.update(worker.id, { url: url.href, active: false });
    else {
      worker = await chrome.tabs.create({ url: url.href, active: false });
      if (!await chrome.tabs.get(ownerId).catch(() => null)) { await chrome.tabs.remove(worker.id).catch(() => {}); throw Error('筛选台已关闭'); }
      await chrome.storage.session.set({ [key]: { tabId: worker.id, sourceTabId: tabId, ownerTabId: ownerId } });
    }
    if (cancelled()) {
      await chrome.tabs.remove(worker.id).catch(() => {});
      if ((await chrome.storage.session.get(key))[key]?.tabId === worker.id) await chrome.storage.session.remove(key);
      throw Error('详情读取已结束');
    }
    await JobScreenAccessBackground.attach(ownerId, tabId, access.ticket, worker.id, url.origin);
    const r = await settled(worker.id, url.origin, {}, null, true, access);
    if (r.kind !== 'detail' || r.jobs.length !== 1) throw Error('未识别到完整详情，可在原站核对或重试。');
    return r.jobs[0];
  })().then(result => respond({ ok: true, result })).catch(async error => {
    const stop = JobScreenAccess.read(error); if (stop && accessOrigin) await JobScreenAccessBackground.block(accessOrigin, stop).catch(() => {});
    respond({ ok: false, error: error.message, accessStop: stop });
  });
  return true;
});
