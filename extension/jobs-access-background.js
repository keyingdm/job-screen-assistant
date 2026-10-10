'use strict';
// Counts controlled operations only. Never records response bodies or browsing history.
globalThis.JobScreenAccessBackground = (() => {
  const A = JobScreenAccess, runs = new Map(), budgets = new Map(), tabs = new Map(), recent = new Map(), blocks = new Map(), writes = new Map();
  const governor = new A.Governor({ intervalFor: (run, origin) => Math.max(run.intervalMs, ...[...runs.values()].filter(r => r.active && !r.stop && r.origins.has(origin)).map(r => r.intervalMs)) });
  const key = (owner, source) => owner + ':' + source;
  const runKey = k => 'jobAccessRun:' + k;
  const runWrites = new Map(), gateReads = new Map();
  function saveRun(run) {
    const k = key(run.owner, run.source), value = { origin: run.origin, count: run.count };
    const write = (runWrites.get(k) || Promise.resolve()).catch(() => {}).then(() => chrome.storage.session.set({ [runKey(k)]: value }));
    runWrites.set(k, write); return write;
  }
  async function restoreGate(origin) {
    if (!gateReads.has(origin)) gateReads.set(origin, (async () => {
      const k = 'jobAccessGate:' + origin, saved = (await chrome.storage.session.get(k))[k];
      if (!governor.pools.has(origin)) governor.pools.set(origin, { last: Number.isFinite(saved?.last) ? saved.last : null, intervalMs: saved?.intervalMs || 0, queue: Promise.resolve() });
    })());
    await gateReads.get(origin);
  }
  const blockKey = origin => 'jobAccessBlock:' + origin;
  async function block(origin, stop) {
    if (['cancelled','limit','permission'].includes(stop.kind)) return;
    stop = { ...stop, until: Math.max(stop.until || 0, blocks.get(origin)?.until || 0, Date.now() + A.policy.cooldownMs) }; blocks.set(origin, stop);
    const owners = new Map();
    for (const run of runs.values()) if (run.origins.has(origin) && run.active) { run.stop = stop; owners.set(run.owner, [...(owners.get(run.owner) || []), run.source]); }
    for (const [owner, sources] of owners) JobScreenChannel.accessStop(owner, origin, stop, sources);
    const write = (writes.get(origin) || Promise.resolve()).catch(() => {}).then(async () => {
      const k = blockKey(origin), saved = (await chrome.storage.session.get(k))[k], latest = blocks.get(origin) || stop;
      const value = { ...latest, until: Math.max(latest.until, saved?.until || 0) }; blocks.set(origin, value);
      await chrome.storage.session.set({ [k]: value });
    });
    writes.set(origin, write); try { await write; } finally { if (writes.get(origin) === write) writes.delete(origin); }
  }
  async function blocked(origin) {
    const k = blockKey(origin), saved = (await chrome.storage.session.get(k))[k], cached = blocks.get(origin);
    const value = (cached?.until || 0) >= (saved?.until || 0) ? cached : saved;
    if (value?.until > Date.now()) return value;
    blocks.delete(origin); if (saved) await chrome.storage.session.remove(k); return null;
  }
  async function begin(owner, source, origin, resume = false, speed = 'steady') {
    const saved = await blocked(origin); if (saved) throw A.error(saved);
    await finish(owner, source);
    const k = key(owner, source);
    await runWrites.get(k);
    if (resume && !budgets.has(k)) {
      const savedRun = (await chrome.storage.session.get(runKey(k)))[runKey(k)];
      if (savedRun?.origin === origin && Number.isInteger(savedRun.count) && savedRun.count >= 0) budgets.set(k, savedRun.count);
    }
    if (resume && !budgets.has(k)) throw A.error(A.record('cancelled', '本轮访问连接已结束，请手动重新开始。'));
    const run = { owner, source, origin, origins: new Set([origin]), ticket: crypto.randomUUID(), active: true, speed: A.speed(speed), intervalMs: A.speeds[A.speed(speed)], count: resume ? budgets.get(k) : 0 }; budgets.set(k, run.count);
    runs.set(key(owner, source), run); tabs.set(source, run); await saveRun(run); return { ticket: run.ticket, policy: A.policy, speed: run.speed };
  }
  function finish(owner, source, preserve = false) {
    const pending = [];
    for (const [k, run] of runs) if (run.owner === owner && (!source || run.source === source)) { run.active = false; budgets.set(k, run.count); pending.push(saveRun(run)); runs.delete(k); for (const [id, mapped] of tabs) if (mapped === run) tabs.delete(id); }
    if (!source && !preserve) {
      for (const k of budgets.keys()) if (k.startsWith(owner + ':')) budgets.delete(k);
      return Promise.all(pending).then(async () => {
        const saved = await chrome.storage.session.get(null);
        await chrome.storage.session.remove(Object.keys(saved).filter(k => k.startsWith(runKey(owner + ':'))));
      });
    }
    return Promise.all(pending);
  }
  function current(owner, source, ticket) {
    const run = runs.get(key(owner, source));
    if (!run || !run.active || (ticket && run.ticket !== ticket)) throw A.error(A.record('cancelled', '自动读取连接已结束，请手动重新开始。'));
    if (run.stop) throw A.error(run.stop); return run;
  }
  async function target(origin, url) {
    if (!url) return origin;
    let parsed; try { parsed = new URL(url); } catch { throw Error('详情链接无效'); }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw Error('详情链接无效');
    if (parsed.origin !== origin && !await chrome.permissions.contains({origins:[parsed.origin + '/*']})) throw A.error({ ...A.record('permission', '当前网站的详情跳到 ' + parsed.origin + '，请授权该详情站点后继续。'), origin: parsed.origin });
    return parsed.origin;
  }
  async function permit(owner, source, ticket, url) {
    const run = current(owner, source, ticket), origin = await target(run.origin, url), saved = await blocked(origin); if (saved) { run.stop = saved; throw A.error(saved); }
    run.origins.add(origin); await restoreGate(origin); await governor.permit(run, origin);
    const pool = governor.pools.get(origin);
    await chrome.storage.session.set({ ['jobAccessGate:' + origin]: { last: pool.last, intervalMs: pool.intervalMs } });
    await saveRun(run); return true;
  }
  async function attach(owner, source, ticket, tabId, origin) {
    const run = current(owner, source, ticket); tabs.set(tabId, run);
    const seen = recent.get(tabId); if (seen?.origin === (origin || run.origin) && Date.now() - seen.at < 15000) { await block(seen.origin, seen.stop); throw A.error(seen.stop); }
  }
  chrome.webRequest.onHeadersReceived.addListener(details => {
    if (![403, 429].includes(details.statusCode)) return;
    let origin; try { origin = new URL(details.url).origin; } catch { return; }
    if (![...runs.values()].some(r => r.active && r.origins.has(origin))) return;
    const retry = details.responseHeaders?.find(h => h.name.toLowerCase() === 'retry-after')?.value, stop = A.response(details.statusCode, retry);
    const run = tabs.get(details.tabId);
    if (run?.active && run.origins.has(origin)) block(origin, stop).catch(() => {});
    else if (details.type === 'main_frame') { recent.set(details.tabId, { origin, stop, at: Date.now() }); if (recent.size > 100) recent.delete(recent.keys().next().value); }
  }, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame', 'xmlhttprequest'] }, ['responseHeaders']);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'job-access-step') return;
    (async () => {
      const run = tabs.get(sender.tab?.id);
      if (sender.id !== chrome.runtime.id || !run || run.ticket !== message.ticket || !run.origins.has(new URL(sender.url).origin)) throw Error('自动读取授权无效');
      return permit(run.owner, run.source, run.ticket, sender.url);
    })().then(result => respond({ ok: true, result })).catch(e => respond({ ok: false, error: e.message, accessStop: A.read(e) })); return true;
  });
  chrome.tabs.onRemoved.addListener(tabId => { tabs.delete(tabId); recent.delete(tabId); for (const run of [...runs.values()]) if (run.source === tabId || run.owner === tabId) finish(run.owner, run.source); });
  return { begin, finish, current, permit, attach, block, target };
})();
