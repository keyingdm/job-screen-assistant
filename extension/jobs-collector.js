(function (root) {
  'use strict';
  const A = typeof module !== 'undefined' ? require('./jobs-access.js') : root.JobScreenAccess;
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason || new DOMException('已暂停', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  });
  async function collect({ session, read, next, resolveLink, readDetail, onUpdate = () => {}, signal, delay = A.policy.intervalMs, maxPages = A.policy.maxPages, maxJobs = A.policy.maxJobs }) {
    const d = session, map = new Map(d.jobs.map(j => [j.key, j])), identities = new Set(d.identities || d.jobs.map(j => j.id)), signatures = new Set(d.signatures);
    let lastPublish = 0;
    const publish = () => { d.jobs = [...map.values()]; d.identities = [...identities]; d.updatedAt = new Date().toISOString(); lastPublish = Date.now(); onUpdate(d); };
    try { while (!d.listEnded) {
      signal?.throwIfAborted();
      let page = d.currentPage;
      if (!page && d.advanceNeeded) {
        // A pause can occur after browser navigation but before its result arrives.
        // Re-read that page before deciding to advance again.
        if (d.advanceInFlight) {
          const current = await read(), signature = current.signature || current.jobs.map(j => j.id).join('|');
          if (signature !== d.signatures.at(-1)) page = current;
        }
        if (!page) { d.advanceInFlight = true; page = await next(); }
      }
      page ||= await read(); d.advanceInFlight = false;
      d.currentPage = page; d.advanceNeeded = false;
      if (page.ended) { d.listEnded = true; d.currentPage = null; d.stopReason = page.stopReason || ''; publish(); break; }
      if (!page.jobs.length && page.total === 0 && !page.next) { d.total = 0; d.currentPage = null; d.listEnded = true; publish(); break; }
      if (!page.jobs.length) {
        if (!d.pages) throw Error('没有识别到岗位。请先指定岗位区域或标题，再重新采集。');
        d.listEnded = true; d.currentPage = null; d.stopReason = '当前分页未识别到岗位，已停止继续翻页；已发现岗位仍会读取详情。'; publish(); break;
      }
      const signature = page.signature || page.jobs.map(j => j.id).join('|');
      if (signatures.has(signature)) { d.listEnded = true; d.currentPage = null; d.stopReason = '翻页后岗位没有变化，已停止继续翻页；已发现岗位仍会读取详情。可以核对下一页按钮。'; publish(); break; }
      if (Number.isInteger(page.total) && page.total >= 0) d.total = page.total;
      if (d.pages === 0 && page.pageNumber && page.pageNumber > 1) d.startedMidList = true;
      const resumedPage = Boolean(d.pageOffset); let additions = 0;
      for (let index = d.pageOffset || 0; index < page.jobs.length; index++) {
        signal?.throwIfAborted();
        const raw = page.jobs[index];
        const identity = raw.id;
        if (identities.has(identity)) { d.pageOffset = index + 1; continue; }
        if (map.size >= maxJobs) { d.discoveryLimited = true; d.listEnded = true; d.stopReason = '达到本轮 ' + maxJobs + ' 个岗位上限，已停止发现更多岗位；本轮结果仍可筛选和收藏。'; break; }
        if (raw.titleSelector && raw.linkKind === 'list') {
          try { const link = await resolveLink(raw.titleSelector); if (link) { raw.id = link; raw.url = link; raw.linkKind = 'detail'; } } catch (e) { if (A.read(e)) throw e; }
        }
        const job = JobScreen.normalize(raw, 'page'); map.set(job.key, job); identities.add(identity); d.pageOffset = index + 1; additions++;
        if (!lastPublish || Date.now() - lastPublish >= 250) publish();
        if (additions % 50 === 0) await sleep(0, signal);
      }
      signatures.add(signature); d.signatures.push(signature); d.pages++; d.currentPage = null; d.pageOffset = 0;
      publish();
      if (d.discoveryLimited) break;
      if (!additions && !resumedPage && d.pages > 1) { d.listEnded = true; d.advanceNeeded = false; d.stopReason = '翻页后没有新增岗位，已停止继续翻页；已发现岗位仍会读取详情。'; break; }
      d.advanceNeeded = Boolean(page.next); d.listEnded = !page.next;
      if (!d.listEnded && (d.pages >= maxPages || map.size >= maxJobs)) { d.discoveryLimited = true; d.listEnded = true; d.advanceNeeded = false; d.stopReason = '达到本轮岗位或分页上限，已停止发现更多岗位；本轮结果仍可筛选和收藏。'; }
      if (!d.listEnded) await sleep(delay, signal);
    }
    d.stage = 'details'; publish();
    for (const job of map.values()) {
      signal?.throwIfAborted();
      if (job.collectionState === 'read' || job.collectionState === 'missing') continue;
      if (job.linkKind !== 'detail') { job.collectionState = 'missing'; job.collectionError = '未识别独立详情链接；当前只读到列表内容。'; publish(); continue; }
      job.collectionState = 'reading'; publish();
      try {
        const raw = await readDetail(job.url, signal); signal?.throwIfAborted();
        const complete = raw.requirements && raw.completeness !== 'detail-summary';
        const detailDegree = JobScreen.degreeInfo(raw.requirements || '');
        const inheritedDegree = raw.requirements && !detailDegree.rank && !detailDegree.unrestricted && job.facts.degree.evidence;
        const requirements = (raw.requirements || job.requirements) + (inheritedDegree ? '\n学历要求（来源列表）：' + inheritedDegree : '');
        const enriched = JobScreen.normalize({ ...job, ...raw, id: job.id, url: job.url,
          name: job.name || raw.name, company: job.company || raw.company, city: job.city || raw.city,
          majorRequirements: raw.majorRequirements || (raw.requirements && JobScreen.majors.extract(raw).known ? '' : job.majorRequirements),
          requirements, completeness: complete ? 'detail' : 'detail-missing',
          collectionState: complete ? 'read' : 'missing', collectionError: complete ? '' : '详情已读取，但未找到完整的任职要求；摘要不代表详情已读完整。' }, 'page');
        map.set(job.key, enriched);
      } catch (error) {
        if (signal?.aborted) { job.collectionState = 'pending'; publish(); throw error; }
        job.collectionState = 'failed'; job.collectionError = error.message;
        if (A.read(error)) { if (A.read(error).kind === 'permission') job.collectionState = 'pending'; publish(); throw error; }
      }
      publish(); await sleep(delay, signal);
    }
    d.complete = !d.discoveryLimited && !d.startedMidList && Number.isInteger(d.total) && map.size === d.total;
    d.stage = d.discoveryLimited ? 'limited' : 'done'; publish(); return d;
    } catch (e) { publish(); if (signal?.aborted && !A.read(signal.reason)) throw signal.reason || e; const stop = A.read(signal?.reason) || A.read(e); if (stop) { d.accessStop = stop; d.stage = stop.kind === 'limit' ? 'limited' : stop.kind === 'permission' ? 'permission' : stop.kind === 'cancelled' ? 'stopped' : 'blocked'; d.stopReason = stop.reason; d.complete = false; publish(); } throw e; }
  }
  const session = url => ({ source: 'page', sourceURL: url, jobs: [], total: null, pages: 0, signatures: [], listEnded: false,
    advanceNeeded: false, complete: false, stage: 'list', updatedAt: new Date().toISOString() });
  root.JobScreenCollector = { collect, session, sleep };
  if (typeof module !== 'undefined') module.exports = root.JobScreenCollector;
})(globalThis);
