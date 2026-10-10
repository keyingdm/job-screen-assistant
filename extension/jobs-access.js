(function (root) {
  'use strict';
  const policy = Object.freeze({ intervalMs: 3000, maxActions: Infinity, maxJobs: Infinity, maxPages: Infinity, cooldownMs: 600000 });
  const speeds = Object.freeze({ steady: policy.intervalMs, fast: 2000 });
  const speed = value => Object.hasOwn(speeds, value) ? value : 'steady';
  function record(kind, reason, status = 0, until = 0) { return { kind, reason, status, until }; }
  function error(stop) {
    const e = Error('[JOB_ACCESS:' + stop.kind + ':' + (stop.status || 0) + ':' + (stop.until || 0) + '] ' + stop.reason);
    e.accessStop = stop; return e;
  }
  function read(value) {
    if (value?.accessStop) return value.accessStop;
    const m = String(value?.message || value || '').match(/\[JOB_ACCESS:(\w+):(\d+):(\d+)\]\s*([^\n]*)/);
    return m ? record(m[1], m[4], Number(m[2]), Number(m[3])) : null;
  }
  function response(status, retryAfter, now = Date.now()) {
    if (![403, 429].includes(status)) return null;
    const raw = String(retryAfter || '').trim(), retry = /^\d+$/.test(raw) ? now + Number(raw) * 1000 : Date.parse(raw);
    const until = Math.max(now + policy.cooldownMs, Number.isFinite(retry) ? retry : 0);
    return record(status === 429 ? 'rate' : 'refused', status === 429 ? '网站返回 429（访问过于频繁），已停止该网站的自动读取。' : '网站返回 403（拒绝访问），已停止该网站的自动读取。', status, until);
  }
  function detectDocument(doc) {
    const visible = n => {
      if (n.closest('[hidden],[aria-hidden="true"],script,style,template')) return false;
      for (let p = n; p; p = p.parentElement) if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(p.getAttribute('style') || '')) return false;
      return !doc.defaultView || Boolean(n.getClientRects().length);
    };
    const plain = n => String(n.innerText || n.textContent || '').trim();
    const headings = [doc.title || '', ...[...doc.querySelectorAll('h1,h2,[role=alert]')].filter(visible).map(plain)];
    if (headings.some(t => /^(?:安全验证|人机验证|访问验证|机器人验证|请完成验证|验证您?是否为人类|verify (?:you are|that you)|are you (?:a )?(?:human|robot)|just a moment)[。.!！…\s]*$/i.test(t))) return record('captcha', '页面出现人机或安全验证，已停止自动读取；请在原网站人工核对。');
    const texts = [...doc.querySelectorAll('h1,h2,p,[role=alert]')].filter(visible).map(plain).filter(t => t.length < 180);
    if (texts.some(t => /^(?:403\s*(?:forbidden)?|429\s*(?:too many requests)?|access denied|access forbidden|too many requests|访问(?:被拒绝|受限|过于频繁)|请求(?:过于频繁|频率过高)|操作(?:过于频繁|频繁)|您的?IP(?:已被|被)(?:封禁|限制)|访问异常)[\s，,。.!！:：\-]*(?:请稍后(?:再试|重试)|请联系管理员|稍后再试|please try again later|禁止访问)?[。.!！\s]*$/i.test(t))) return record('refused', '页面明确提示访问限制，已停止该网站的自动读取。');
    const controls = [...doc.querySelectorAll('[class*="captcha" i],[id*="captcha" i],[class*="geetest" i],[id*="geetest" i],[class*="turnstile" i],iframe[title*="challenge" i],iframe[title*="reCAPTCHA" i]')].filter(visible);
    if (controls.some(n => /验证码|安全验证|人机验证|拖动滑块|完成验证|captcha|verify|challenge/i.test(plain(n.parentElement || n) + ' ' + (n.title || '')))) return record('captcha', '页面出现验证码或验证控件，已停止自动读取；插件不会绕过验证。');
    return null;
  }
  class Governor {
    constructor({ intervalMs = policy.intervalMs, intervalFor, maxActions = policy.maxActions, now = Date.now, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) { this.intervalMs = intervalMs; this.intervalFor = intervalFor || (() => this.intervalMs); this.maxActions = maxActions; this.now = now; this.wait = wait; this.pools = new Map(); }
    async permit(run, origin = run.origin) {
      const pool = this.pools.get(origin) || { last: null, intervalMs: 0, queue: Promise.resolve() }; this.pools.set(origin, pool);
      const perform = async () => {
        const check = () => { if (run.stop) throw error(run.stop); if (!run.active) throw error(record('cancelled', '本轮自动读取已结束。')); if (run.count >= this.maxActions) throw error(record('limit', '达到本轮 ' + this.maxActions + ' 次自动访问操作上限，已停止；已有结果保留。')); };
        check(); let interval;
        while (true) {
          interval = this.intervalFor(run, origin);
          const remaining = pool.last === null ? 0 : Math.max(0, pool.last + Math.max(pool.intervalMs, interval) - this.now());
          if (!remaining) break;
          await this.wait(remaining); check();
        }
        run.count++; pool.last = this.now(); pool.intervalMs = interval;
      };
      const result = pool.queue.catch(() => {}).then(perform); pool.queue = result.catch(() => {}); return result;
    }
  }
  const api = { policy, speeds, speed, record, error, read, response, detectDocument, Governor };
  root.JobScreenAccess = api; if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
