// Optional, local integration boundary. No provider, endpoint or network request is bundled.
(function (root) {
  'use strict';
  let provider = null;
  const operations = ['extract', 'explain', 'recommend'];
  function register(value) {
    if (!value || typeof value.run !== 'function' || typeof value.name !== 'string') throw Error('AI 服务需要名称和 run 方法');
    provider = value;
  }
  async function run({ operation, jobs = [], profile, consent = false, signal } = {}) {
    if (!provider) throw Error('尚未配置 AI 服务');
    if (!consent) throw Error('需先确认本次发送的岗位及个人条件范围');
    if (!operations.includes(operation) || jobs.length > 100) throw Error('AI 请求范围无效');
    const input = jobs.map(j => ({ key: j.key, name: j.name, requirements: j.requirements, majorRequirements: j.majorRequirements, description: j.description, city: j.city }));
    const result = await provider.run({ operation, jobs: input, ...(profile ? { profile: { ...profile } } : {}), signal });
    if (!Array.isArray(result?.items)) throw Error('AI 返回格式无效');
    const known = new Map(input.map(j => [j.key, j]));
    const items = result.items.map(item => {
      const job = known.get(item.key), quotes = item.evidence;
      if (!job || !Array.isArray(quotes) || !quotes.length || quotes.some(q => typeof q !== 'string' || !q.trim() || ![job.requirements, job.majorRequirements, job.description].some(t => t?.includes(q)))) throw Error('AI 结果缺少可核对的岗位原文依据');
      return { key: item.key, reason: String(item.reason || '').slice(0, 3000), evidence: quotes, score: Number.isFinite(item.score) ? Math.max(0, Math.min(1, item.score)) : null, source: 'ai', needsReview: true };
    });
    return { provider: provider.name, operation, items };
  }
  const api = { register, run, operations, get configured() { return Boolean(provider); } };
  root.JobScreenAI = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
