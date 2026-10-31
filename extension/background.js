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
  await chrome.storage.session.remove(['jobBinding:' + tabId, 'jobWidget:' + tabId, 'jobWidgetPosition:' + tabId, 'jobWorker:' + tabId, ...owners]);
});
async function inspect(tabId, rule, expand = false, detailOnly = false, access = null) {
  if (access) JobScreenAccessBackground.current(access.owner, access.source, access.ticket);
  await chrome.scripting.executeScript({ target: { tabId }, injectImmediately: true, files: ['jobs-access.js', 'jobs-page.js'] });
  const out = await chrome.scripting.executeScript({ target: { tabId }, injectImmediately: true, func: (r, ex, detail, ctx) => JobScreenPage.scan(r, ex, detail, ctx ? async () => {
    const reply = await chrome.runtime.sendMessage({ type: 'job-access-step', ticket: ctx.ticket });
    if (!reply?.ok) throw reply?.accessStop ? JobScreenAccess.error(reply.accessStop) : Error(reply?.error || '读取授权已结束');
  } : null), args: [rule || {}, expand, detailOnly, access] });
  return out[0]?.result;
}
async function settled(tabId, origin, rule, previous, detailOnly = false, access = null, expected = null) {
  const until = Date.now() + 16000; let partial, snapshot = '';
  while (Date.now() < until) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && !tab.url.startsWith('about:') && new URL(tab.url).origin !== origin) throw JobScreenAccess.error(JobScreenAccess.record('cancelled', '页面跳转到其他网站，已停止；请在新页面重新打开插件。'));
    // Images or unrelated scripts can keep a committed document loading. Read
    // its rendered DOM without accepting an uncommitted URL or an empty shell.
    if (/^https?:/.test(tab.url || '') && !tab.pendingUrl) { try {
      const r = await inspect(tabId, rule, !expected, detailOnly, access);
      const matches = !expected || (r?.kind === expected.kind && r.scopeURL === expected.scopeURL && r.signature === expected.signature);
      const eligible = matches && r?.jobs.length && !r.loading && r.kind !== 'loading' && (!previous || r.signature !== previous) && (!detailOnly || r.kind === 'detail' && r.jobs.every(job => job.name));
      if (eligible) {
        const key = JSON.stringify([r.kind, r.scopeURL, r.signature, r.jobs.map(job => [job.name,job.company,job.city,job.requirements,job.majorRequirements,job.description,job.completeness])]);
        if (key === snapshot) {
          if (detailOnly && ['detail-summary','detail-missing'].includes(r.jobs[0]?.completeness)) partial = r;
          else return r;
        } else { snapshot = key; partial = null; }
      } else { snapshot = ''; partial = null; }
    } catch (e) { if (JobScreenAccess.read(e)) throw e; snapshot = ''; partial = null; }
    } else { snapshot = ''; partial = null; }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  if (partial) {
    // A visible title and responsibilities prove that a body was read, even if qualifications are absent.
    partial.jobs = partial.jobs.map(j=>({...j,detailStatus:j.name&&j.description?'loaded':'body-incomplete'}));
    return partial;
  }
  throw Error('页面加载超时或翻页后内容未变化。当前结果保留，可暂停后重试。');
}
async function waitURL(tabId, expected) {
  const until = Date.now() + 16000;
  while (Date.now() < until) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url === expected && tab.status === 'complete' && !tab.pendingUrl) return tab;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('岗位入口跳转未完成，请回到原列表后继续。');
}
async function resetReader(tabId) {
  // about:blank has no granted host, so tabs.url can be omitted. Observe its actual load cycle.
  return new Promise((resolve, reject) => {
    let loading = false;
    const finish = error => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(updated); chrome.tabs.onRemoved.removeListener(removed); error ? reject(error) : resolve(); };
    const updated = (id, change) => { if (id !== tabId) return; if (change.status === 'loading') loading = true; if (loading && change.status === 'complete') finish(); };
    const removed = id => { if (id === tabId) finish(Error('详情读取已结束')); };
    const timer = setTimeout(() => finish(Error('详情阅读页重置超时，请暂停后重试。')), 16000);
    chrome.tabs.onUpdated.addListener(updated); chrome.tabs.onRemoved.addListener(removed);
    chrome.tabs.update(tabId, { url: 'about:blank', active: false }).catch(finish);
  });
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
      await JobScreenAccessBackground.finish(ownerId, Number(message.tabId));
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
    if (message.action === 'context') {
      let scopeURL;
      if (await chrome.permissions.contains({origins:[binding.origin + '/*']})) {
        await chrome.scripting.executeScript({target:{tabId},files:['jobs-page.js']});
        const result = await chrome.scripting.executeScript({target:{tabId},func:()=>JobScreenPage.listScope(location.href,document)});
        scopeURL = result[0]?.result;
      }
      return { url: tab.url, title: tab.title, scopeURL };
    }
    if (message.action === 'access-begin') return JobScreenAccessBackground.begin(ownerId, tabId, binding.origin, Boolean(message.resume), message.speed);
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
      const originalList = await inspect(tabId, message.rule || {}, false, false, access);
      if (originalList?.kind !== 'list') throw Error('原页面已不是岗位列表，请回到原列表后继续。');
      const candidates = originalList.jobs.filter(j => message.expectedIdentity ? j.id === message.expectedIdentity : message.expectedRecordId ? j.recordId === message.expectedRecordId : message.expectedName && j.name === message.expectedName);
      if (message.expectedIdentity && candidates.length !== 1) throw Error('原列表中的岗位身份已变化，请核对后继续。');
      // SPA restoration can recreate IDs and wrappers while retaining the same jobs.
      const currentSelector = candidates.length === 1 && candidates[0].titleSelector || message.selector;
      const before = originalList.url; let navigation = '', popupTarget = '', out;
      const marker = '__jobScreenResolve_' + crypto.randomUUID().replace(/-/g, ''), token = crypto.randomUUID();
      const possiblePopups = new Map(), popups = new Map();
      const created = child => {
        // Chromium can attribute an injected window.open to the active tab.
        // New tabs are only candidates; their DOM opener must prove ownership.
        possiblePopups.set(child.id, child.pendingUrl || child.url || '');
      };
      const observe = (id, change) => {
        if (id === tabId && change.url && change.url !== before) navigation = change.url;
        if (possiblePopups.has(id) && change.url) possiblePopups.set(id, change.url);
        if (popups.has(id) && change.url) popups.set(id, change.url);
      };
      chrome.tabs.onCreated.addListener(created);
      chrome.tabs.onUpdated.addListener(observe);
      try { out = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: async (css, expected, expectedID, marker, token) => {
        const el = document.querySelector(css);
        if (!el || /^(?:立即)?(?:申请|投递|登录|注册|提交)(?:岗位|职位|简历)?[↗]*$/.test(el.textContent.replace(/\s/g,''))) return '';
        const anchor = el.closest('a[href]');
        if (anchor) { const u = new URL(anchor.getAttribute('href'),location.href), paths = [u.pathname]; if (/^#(?:\/|!\/)/.test(u.hash)) paths.push(new URL(u.origin+u.hash.replace(/^#!/,'#').slice(1)).pathname); if (paths.some(path=>/(?:^|[/_-])(?:apply(?:job)?|application|login|signin|register|signup|submit)(?:$|[/_.-])/i.test(path))) return ''; }
        if (expected && !el.textContent.trim().includes(expected)) throw Error('岗位标题已变化，未点击不匹配的入口。');
        if (expectedID && ![el.id,...['job','post','position','vacancy','requisition'].map(k=>el.getAttribute('data-'+k+'-id'))].includes(expectedID)) throw Error('岗位编号已变化，未点击不匹配的入口。');
        Object.defineProperty(window, marker, {value:token, configurable:true});
        setTimeout(() => { if (window[marker] === token) delete window[marker]; }, 8000);
        const original = window.open, before = location.href; let captured = '';
        window.open = (...args) => {
          const target = args[0];
          // Blank-window workflows need their real WindowProxy for later navigation.
          if (target == null || !String(target).trim() || /^about:blank(?:[?#]|$)/i.test(String(target))) return original.apply(window, args);
          try { const url = new URL(target, location.href); if (/^https?:$/.test(url.protocol)) captured = url.href; } catch {}
          return {focus(){},closed:false};
        };
        try { el.click(); if (!captured) await new Promise(resolve => setTimeout(resolve, 1000)); } finally { window.open = original; }
        return { url: captured, navigated: location.href !== before, location: location.href };
      }, args: [String(currentSelector || '').slice(0, 1500),String(message.expectedName || '').slice(0,100),String(message.expectedRecordId || '').slice(0,120),marker,token] });
      } catch (e) {
        // A navigating script may disappear before tabs.url reflects its destination.
        for (let i = 0; i < 10 && !navigation; i++) {
          const current = await chrome.tabs.get(tabId);
          navigation = current.pendingUrl && current.pendingUrl !== before ? current.pendingUrl : current.url !== before ? current.url : '';
          if (!navigation) await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!navigation && !possiblePopups.size) throw e;
      }
      finally {
        try {
          // A cached open bypasses the temporary wrapper. Verify the DOM opener
          // rather than accepting all new tabs attributed to the hub.
          const until = Date.now() + 3000;
          while (possiblePopups.size && Date.now() < until) {
            for (const id of possiblePopups.keys()) {
              const child = await chrome.tabs.get(id).catch(() => null);
              const url = child?.pendingUrl || child?.url;
              if (!child) { possiblePopups.delete(id); continue; }
              if (url && /^https?:/.test(url)) possiblePopups.set(id, url);
              if (!popups.has(id)) {
                const proof = await chrome.scripting.executeScript({target:{tabId:id},world:'MAIN',func:(key,value)=>{
                  try { return Boolean(window.opener && window.opener[key] === value); } catch { return false; }
                },args:[marker,token]}).catch(() => null);
                if (proof?.[0]?.result === true) {
                  popups.set(id, possiblePopups.get(id));
                  await JobScreenAccessBackground.attach(ownerId, tabId, access.ticket, id, binding.origin);
                }
              } else if (url && /^https?:/.test(url)) popups.set(id, url);
            }
            if (popups.size && [...popups.values()].every(url => /^https?:/.test(url))) break;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          const targets = [...new Set([...popups.values()].filter(url => /^https?:/.test(url)))];
          if (targets.length > 1) throw Error('本次标题点击打开了多个不同页面，未自动选择；请在原站核对岗位入口。');
          popupTarget = targets[0] || '';
        } finally {
          chrome.tabs.onUpdated.removeListener(observe); chrome.tabs.onCreated.removeListener(created);
          await Promise.all([...popups.keys()].map(id => chrome.tabs.remove(id).catch(() => {})));
          await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:(key,value)=>{
            if (window[key] === value) delete window[key];
          },args:[marker,token]}).catch(() => {});
        }
      }
      const r = out?.[0]?.result; let after = await chrome.tabs.get(tabId);
      if (!r?.url && !popupTarget && !r?.navigated && after.url === before && !after.pendingUrl && !navigation) {
        // Some SPA handlers route after the click script has returned.
        const until = Date.now() + 2000;
        while (Date.now() < until && after.url === before && !after.pendingUrl) { await new Promise(resolve => setTimeout(resolve, 100)); after = await chrome.tabs.get(tabId); }
      }
      const target = r?.url || popupTarget || (after.pendingUrl && after.pendingUrl !== before ? after.pendingUrl : after.url !== before ? after.url : navigation || (r?.navigated ? r.location : ''));
      if (!r?.url && !popupTarget && target) after = await waitURL(tabId, target);
      if (after.url !== before) {
        await JobScreenAccessBackground.permit(ownerId, tabId, access.ticket, before);
        const prior = new URL(before), current = new URL(after.url); prior.hash = ''; current.hash = '';
        // Back can skip script-created history entries, and replaceState adds none.
        if (r?.navigated || prior.href === current.href) await chrome.tabs.update(tabId, { url: before });
        else await chrome.tabs.goBack(tabId);
        await waitURL(tabId, before);
        const restored = await settled(tabId, binding.origin, message.rule || {}, null, false, access, originalList);
        if (restored.kind !== 'list') throw Error('详情入口跳转后未恢复原列表，已停止；请回到原列表后继续。');
      }
      if (!target) return '';
      JobScreenAccessBackground.current(ownerId, tabId, access.ticket);
      const resolved = new URL(target), paths = [resolved.pathname];
      if (/^#(?:\/|!\/)/.test(resolved.hash)) paths.push(new URL(resolved.origin + resolved.hash.replace(/^#!/,'#').slice(1)).pathname);
      return /^https?:$/.test(resolved.protocol) && !resolved.username && !resolved.password && !paths.some(path=>/(?:^|[/_-])(?:apply(?:job)?|application|login|signin|register|signup|submit)(?:$|[/_.-])/i.test(path)) ? resolved.href : '';
    }
    const url = new URL(message.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw Error('详情链接无效');
    if (!await chrome.permissions.contains({ origins: [url.origin + '/*'] })) throw Error('需要允许读取当前详情网站的权限');
    await JobScreenAccessBackground.permit(ownerId, tabId, access.ticket, url.href);
    const key = 'jobWorker:' + ownerId + ':' + tabId; let owned = (await chrome.storage.session.get(key))[key], worker;
    const cancelled = () => JobScreenChannel.readerToken(ownerId, tabId) !== readToken;
    if (cancelled()) throw Error('详情读取已结束');
    if (owned?.tabId) worker = await chrome.tabs.get(owned.tabId).catch(() => null);
    if (worker) {
      const prior = worker.url ? new URL(worker.url) : null, destination = new URL(url.href);
      if (prior) prior.hash = ''; destination.hash = '';
      if (prior?.href === destination.href && worker.url !== url.href) {
        // A fragment change can leave the previous job's DOM in a completed SPA tab.
        await resetReader(worker.id);
      }
      if (!cancelled()) await chrome.tabs.update(worker.id, { url: url.href, active: false });
    }
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
