(function (root) {
  'use strict';
  const J = typeof module !== 'undefined' ? require('./jobs-core.js') : root.JobScreen;
  const C = typeof module !== 'undefined' ? require('./jobs-collector.js') : root.JobScreenCollector;
  const A = typeof module !== 'undefined' ? require('./jobs-access.js') : root.JobScreenAccess;
  const canResume = task => Boolean(task?.tabId && task.dataset && !task.busy && !task.starting && !task.startPromise && !task.clearing &&
    !task.dataset.scopeChanged && !task.dataset.countMismatch && !['blocked','limited','permission'].includes(task.dataset.stage) &&
    (task.dataset.stage !== 'done' || task.dataset.jobs.some(j => j.collectionState === 'failed' || j.detailStatus === 'body-incomplete')));
  class Tasks {
    constructor(change = () => {}) { this.items = new Map(); this.change = change; }
    add(binding) {
      const id = binding.id || String(binding.tabId) + ':' + binding.nonce;
      if (this.items.has(id)) return this.items.get(id);
      const url = J.safeURL(binding.url), label = url ? new URL(url).hostname : '虚构示例';
      if (!url && id !== 'sample') throw Error('来源网址无效');
      const task = { ...binding, id, source: { url, title: J.text(binding.title) }, label, dataset: null, busy: false, generation: 0, controller: null, promise: null, message: '尚未开始', rule: {}, ruleKey: url ? new URL(url).origin + new URL(url).pathname : '' };
      task.speed = 'steady'; this.items.set(id, task); this.change(task); return task;
    }
    async run(task, options, resume = false) {
      if (task.busy || task.clearing) return;
      const generation = ++task.generation;
      if (!resume || !task.dataset) task.dataset = C.session(task.source.url);
      else {
        for (const job of task.dataset.jobs) if (job.collectionState === 'failed' || job.detailStatus === 'body-incomplete') job.collectionState = 'pending';
        delete task.dataset.accessStop; task.dataset.stopReason = '';
        task.dataset.stage = task.dataset.detailsPending || task.dataset.listEnded ? 'details' : 'list';
      }
      task.controller = new AbortController(); task.busy = true; task.message = '正在采集当前网站'; this.change(task);
      const execute = async () => {
        try {
          await C.collect({ ...options, session: task.dataset, signal: task.controller.signal, onUpdate: data => {
            if (task.generation === generation) { task.dataset = data; this.change(task); }
          } });
          if (task.generation === generation) task.message = ['limited','interrupted'].includes(task.dataset.stage) ? task.dataset.stopReason : task.dataset.jobs.some(j => j.collectionState === 'failed' || j.detailStatus === 'body-incomplete') ? '本次列表采集结束，部分详情失败或正文未读完整。点击继续可重试这些详情，已读岗位保留。' : '本次采集结束。请核对原文并收藏需要保留的岗位。';
        } catch (error) {
          if (task.generation === generation) task.message = (A.read(error)?.reason || (task.controller?.signal.aborted ? '已暂停' : error.message)) + (!task.dataset.scopeChanged && !task.dataset.countMismatch && ['paused','interrupted','stopped'].includes(task.dataset.stage) ? ' 本轮进度保留；原招聘页仍可访问时，点击继续本次采集。' : '');
        } finally {
          await options.cleanup?.().catch(() => {});
          if (task.generation === generation) { task.busy = false; task.controller = null; task.promise = null; this.change(task); }
        }
      };
      task.promise = execute(); return task.promise;
    }
    pause(task) { task?.controller?.abort(); }
    async clear(task) {
      if (!task) return;
      const pending = task.promise;
      task.generation++; task.controller?.abort(); task.dataset = null; task.busy = false; task.clearing = true; task.message = '本次任务已结束，未收藏结果已清空。'; this.change(task);
      await pending;
      task.controller = null; task.promise = null; task.clearing = false; this.change(task);
    }
    jobs(task) {
      return (task.dataset?.jobs || []).map(job => J.normalize({ ...job, sourceURL: task.source.url, sourceLabel: task.label }, job.source));
    }
    aggregate(id = 'all') {
      const selected = id === 'all' ? [...this.items.values()].filter(t => t.dataset) : [this.items.get(id)].filter(t => t?.dataset);
      if (!selected.length) return null;
      if (selected.length === 1) return { ...selected[0].dataset, jobs: this.jobs(selected[0]) };
      const totalKnown = selected.every(t => Number.isInteger(t.dataset.total));
      const seen = new Map(), all = selected.flatMap(t => this.jobs(t)), jobs = [];
      const quality = j => (j.collectionState === 'read' ? 10 : 0) + ['company','city','majorRequirements','requirements'].filter(k=>j[k]).length;
      for (const j of all) {
        if (!['record','link'].includes(j.identityKind)) { jobs.push(j); continue; }
        if (seen.has(j.id)) { const index = seen.get(j.id); if (quality(j) > quality(jobs[index])) jobs[index] = j; }
        else { seen.set(j.id,jobs.length); jobs.push(j); }
      }
      const duplicates = all.length - jobs.length;
      return { source: 'merged', jobs, total: totalKnown && !duplicates ? selected.reduce((n, t) => n + t.dataset.total, 0) : null, duplicates,
        pages: selected.reduce((n, t) => n + (t.dataset.pages || 0), 0), complete: !duplicates && selected.every(t => t.dataset.complete), stage: selected.some(t => t.busy) ? 'running' : selected.some(t => t.dataset.stage !== 'done') ? 'interrupted' : 'done', sourceCount: selected.length };
    }
  }
  root.JobScreenTasks = { Tasks, canResume };
  if (typeof module !== 'undefined') module.exports = root.JobScreenTasks;
})(globalThis);
