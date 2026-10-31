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
    let interrupted = false;
    const readyPage = async value => {
      const until=Date.now()+30000;
      while(value?.kind==='loading' || value?.loading){
        signal?.throwIfAborted();
        if(Date.now()>=until)throw Error('岗位列表仍在加载，尚未核对岗位数量；本轮进度保留，可在原页加载完成后继续。');
        d.phase='loading';publish();await sleep(350,signal);value=await read();
      }
      return value;
    };
    const details = async () => {
      d.stage = 'details'; d.phase = 'details'; publish();
      for (const job of map.values()) {
        signal?.throwIfAborted();
        if (['read', 'missing', 'failed'].includes(job.collectionState)) continue;
        if (job.linkKind !== 'detail') { job.collectionState = 'missing'; job.detailStatus = 'unresolved'; job.collectionError ||= '详情入口未识别，尚未读取岗位详情；当前只读到列表内容。'; publish(); continue; }
        job.collectionState = 'reading'; job.detailStatus = 'loading'; publish();
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
            identityKind: job.identityKind, recordId: job.recordId, detailStatus: complete || raw.detailStatus === 'loaded' ? 'loaded' : 'body-incomplete',
            collectionState: complete ? 'read' : 'missing', collectionError: complete ? '' : raw.detailStatus === 'loaded' ? '详情正文已读取，但未检测到完整任职条件；请查看原岗位核对。' : '详情正文未读完整，专业尚未核对；摘要不代表详情已读完整。' }, 'page');
          map.set(job.key, enriched);
        } catch (error) {
          if (signal?.aborted) { job.collectionState = 'pending'; publish(); throw error; }
          job.collectionState = 'failed'; job.detailStatus = 'failed'; job.collectionError = error.message;
          if (A.read(error)) { if (['permission','cancelled'].includes(A.read(error).kind)) job.collectionState = 'pending'; publish(); throw error; }
        }
        publish(); await sleep(delay, signal);
      }
      d.detailsPending = false;
    };
    const interruptList = reason => {
      interrupted = true; d.complete = false; d.currentPage = null; d.pageOffset = 0;
      d.advanceNeeded = true; d.advanceInFlight = false; d.stopReason = reason;
    };
    try { while (!d.listEnded) {
      signal?.throwIfAborted();
      // Finish this page's details before advancing, including after an interruption.
      if (d.detailsPending) await details();
      d.stage = 'list'; d.phase = 'list';
      let page = d.currentPage;
      if (!page && d.advanceNeeded) {
        // A pause can occur after browser navigation but before its result arrives.
        // Re-read that page before deciding to advance again.
        if (d.advanceInFlight) {
          const current = await readyPage(await read()), signature = current.signature || current.jobs.map(j => j.id).join('|');
          if (signature !== d.signatures.at(-1)) page = current;
        }
        if (!page) { d.advanceInFlight = true; page = await next(); }
      }
      page = await readyPage(page || await read()); d.advanceInFlight = false; d.phase='list';
      if (page.kind === 'directory') throw Error('当前是公司/单位目录，检测到 '+page.entries.length+' 个公司入口，尚未进入岗位列表。请先打开目标公司的岗位页，再开始检索；多家公司可分别在新标签页启动并在总台合并。公司入口不计作岗位。');
      if (d.pages && page.kind === 'detail') { d.scopeChanged = true; throw Error('原列表已变成详情页，已停止合并岗位；请回到原列表并重新开始。'); }
      if (page.scopeURL) {
        if (d.scopeURL && d.scopeURL !== page.scopeURL) { d.scopeChanged = true; throw Error('原网页筛选范围已变化，已停止合并新旧岗位。请重新开始并清空进度。'); }
        d.scopeURL ||= page.scopeURL;
      }
      d.currentPage = page; d.advanceNeeded = false;
      if (page.ended) { d.listEnded = true; d.currentPage = null; d.stopReason = page.stopReason || ''; publish(); break; }
      if (!page.jobs.length && page.total === 0 && !page.next) { d.total = 0; d.currentPage = null; d.listEnded = true; publish(); break; }
      if (!page.jobs.length) {
        if (!d.pages) throw Error('没有识别到岗位。请先指定岗位区域或标题，再重新采集。');
        interruptList('当前分页未识别到岗位，本轮进度保留。请核对原页，点击继续本次采集重试。'); publish(); break;
      }
      const signature = page.signature || page.jobs.map(j => j.id).join('|');
      if (signatures.has(signature)) { interruptList('翻页后岗位没有变化，本轮进度保留。请核对下一页按钮，点击继续本次采集重试。'); publish(); break; }
      if (Number.isInteger(page.total) && page.total >= 0) d.total = page.total;
      if (d.pages === 0 && page.pageNumber && page.pageNumber > 1) d.startedMidList = true;
      const resumedPage = Boolean(d.pageOffset); let additions = 0;
      for (let index = d.pageOffset || 0; index < page.jobs.length; index++) {
        signal?.throwIfAborted();
        const raw = { ...page.jobs[index] };
        const identity = raw.id;
        if (identities.has(identity)) { d.pageOffset = index + 1; continue; }
        if (map.size >= maxJobs) { d.discoveryLimited = true; d.listEnded = true; d.stopReason = '达到本轮 ' + maxJobs + ' 个岗位上限，已停止发现更多岗位；本轮结果仍可筛选和收藏。'; break; }
        if (raw.titleSelector && raw.linkKind === 'list') {
          try { const link = await resolveLink(raw.titleSelector,raw); if (link) { if (raw.identityKind !== 'record') raw.id = root.JobScreenPage?.linkIdentity(link) || link; raw.url = link; raw.linkKind = 'detail'; } } catch (e) { if (A.read(e)) throw e; raw.collectionError = '详情入口读取失败：' + e.message; }
        }
        const job = JobScreen.normalize(raw, 'page');
        const duplicate = map.has(job.key); if (!duplicate) map.set(job.key, job);
        identities.add(identity); identities.add(job.id); d.pageOffset = index + 1; if (!duplicate) additions++;
        if (!lastPublish || Date.now() - lastPublish >= 250) publish();
        if (additions % 50 === 0) await sleep(0, signal);
      }
      signatures.add(signature); d.signatures.push(signature); d.pages++; d.currentPage = null; d.pageOffset = 0;
      if (!additions && !resumedPage && d.pages > 1) { interruptList('翻页后没有新增岗位，本轮进度保留。请核对下一页按钮，点击继续本次采集重试。'); publish(); break; }
      d.advanceNeeded = Boolean(page.next); d.listEnded = !page.next;
      if (!d.listEnded && (d.pages >= maxPages || map.size >= maxJobs)) { d.discoveryLimited = true; d.listEnded = true; d.advanceNeeded = false; d.stopReason = '达到本轮岗位或分页上限，已停止发现更多岗位；本轮结果仍可筛选和收藏。'; }
      // Commit navigation state before reading details so a pause cannot skip a page.
      d.detailsPending = true; publish(); await details();
      if (d.discoveryLimited) break;
      if (!d.listEnded) await sleep(delay, signal);
    }
    await details();
    d.complete = !interrupted && !d.discoveryLimited && !d.startedMidList && Number.isInteger(d.total) && map.size === d.total;
    if (!d.discoveryLimited && !interrupted && Number.isInteger(d.total) && map.size < d.total) {
      interruptList('页面报告 ' + d.total + ' 个岗位，本轮仅发现 ' + map.size + ' 个，尚未采集完整。请核对下一页按钮后继续。'); d.listEnded = false;
    }
    if (!d.discoveryLimited && !interrupted && Number.isInteger(d.total) && map.size > d.total) {
      interrupted = true; d.complete = false; d.countMismatch = true; d.stopReason = '数量未核对一致：页面报告 ' + d.total + ' 个岗位，本轮发现 ' + map.size + ' 个。请核对列表范围和重复项后重新开始，不将本轮视为完整采集。';
    }
    d.stage = d.discoveryLimited ? 'limited' : interrupted ? 'interrupted' : 'done'; publish(); return d;
    } catch (e) {
      const stop = A.read(signal?.reason) || (!signal?.aborted && A.read(e));
      d.complete = false;
      if (stop) { d.accessStop = stop; d.stage = stop.kind === 'limit' ? 'limited' : stop.kind === 'permission' ? 'permission' : stop.kind === 'cancelled' ? 'stopped' : 'blocked'; d.stopReason = stop.reason; }
      else { d.stage = signal?.aborted ? 'paused' : 'interrupted'; d.stopReason = signal?.aborted ? '已暂停，本轮进度保留。' : e.message; }
      // An empty/unrecognized first read must be re-read after the user corrects it.
      if (!d.currentPage?.jobs.length) d.currentPage = null;
      publish(); throw signal?.aborted ? signal.reason || e : e;
    }
  }
  const session = url => ({ source: 'page', sourceURL: url, jobs: [], total: null, pages: 0, signatures: [], listEnded: false,
    advanceNeeded: false, complete: false, stage: 'list', updatedAt: new Date().toISOString() });
  root.JobScreenCollector = { collect, session, sleep };
  if (typeof module !== 'undefined') module.exports = root.JobScreenCollector;
})(globalThis);
