'use strict';
globalThis.JobScreenStorage = {
  async get(key, fallback) {
    if (globalThis.chrome?.storage?.local) return (await chrome.storage.local.get(key))[key] ?? fallback;
    try { return JSON.parse(localStorage.getItem('job-screen-demo:' + key)) ?? fallback; } catch { return fallback; }
  },
  async set(key, value) {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [key]: value });
    else localStorage.setItem('job-screen-demo:' + key, JSON.stringify(value));
  },
  async remove(keys) {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.remove(keys);
    else for (const key of [].concat(keys)) localStorage.removeItem('job-screen-demo:' + key);
  },
  async migrate() {
    const run = async () => {
      const favorites = await this.get('jobFavorites', {}), old = await this.get('jobDataset', null), marks = await this.get('jobMarks', {});
      for (const raw of old?.jobs || []) {
        const legacyKey = raw.key || (raw.source || old.source || 'page') + ':' + raw.id;
        const mark = marks[legacyKey];
        if (!mark?.favorite) continue;
        const job = JobScreen.normalize(raw, raw.source || old.source || 'page'), key = job.linkKind === 'detail' && job.url ? job.url : job.key;
        const { facts, tags, deadline, ...snapshot } = job;
        if (!favorites[key]) favorites[key] = { job: snapshot, status: mark.status || '未标记', savedAt: new Date().toISOString() };
      }
      await this.set('jobFavorites', favorites);
      await this.remove(['jobDataset', 'jobMarks', 'jobFilters']);
      return favorites;
    };
    return globalThis.navigator?.locks ? navigator.locks.request('job-screen-favorites', run) : run();
  }
};
