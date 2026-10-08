(function (root) {
  'use strict';
  // DOM rules only: no company names, domains, endpoints or site adapters.
  const REQUIRE = /^(?:\d+[、.．）)]\s*)?\s*[【\[（(]?\s*(?:岗位任职条件|招聘任职条件|任职资格与要求|任职资格条件|任职资格要求|任职条件|任职要求|职位要求|岗位要求|任职资格|资格条件|招聘条件|招聘要求|应聘要求|应聘资格|应聘条件|人资资格|Qualifications|Requirements)\s*[】\]）)]?\s*[:：]?/i;
  const DUTIES = /^\s*[【\[（(]?\s*(?:岗位职责|工作职责|工作内容|职位描述|Responsibilities|Job description)\s*[】\]）)]?\s*[:：]?/i;
  const BENEFITS = /^\s*[【\[（(]?\s*(?:福利待遇|薪酬待遇|待遇福利|Benefits)\s*[】\]）)]?\s*[:：]?/i;
  const BAD = /^(?:申请|立即申请|投递|立即投递|申请职位|登录|注册|收藏|首页|返回|查看详情|关闭详情|下一页|上一页|更多)$/;
  const NEXT = /^(?:下一页|下页|下一頁|Next|Next page|›|»|→|加载更多|更多岗位|Load more)$/i;
  const FIELD_TITLE = /^(?:招聘类型|招聘类别|学历要求|学历|工作地点|工作城市|工作地区|招聘公司|招聘单位|所属单位|所属公司|岗位类型|岗位类别|职位类型|职位类别|专业要求|专业类别|岗位分类|职位分类|专业标签|筛选条件|筛选|搜索|公司|城市|任职要求|任职资格|岗位职责|工作内容|职位描述|福利待遇|薪酬待遇|查看详情|查看职位详情|职位详情|详情|没有更多职位|没有更多了)[：:\s]*$/;
  const TITLE_QUERY = 'h1,h2,h3,h4,a[href],[role=link],[class*="title" i],[class*="jobName" i],[class*="positionName" i]';
  const JOB_TITLE = /(?:job|position|vacancy|career).*(?:title|name)|(?:title|name).*(?:job|position|vacancy|career)/i;
  const ORGANIZATION = /(?:有限公司|股份公司|集团|公司|研究院|研究所|大学|医院|工厂|中心)$/;
  const isOrganization = el => ORGANIZATION.test(text(el)) && !JOB_TITLE.test(el.className || '') && !/[-—·]/.test(text(el));
  const DETAIL_ACTION = /^(?:查看(?:职位|岗位)?详情|展开详情|职位详情|岗位详情|展开)$/;
  const clean = value => String(value || '').replace(/\r/g, '').trim().slice(0, 30000);
  function text(node) {
    if (!node) return '';
    if (node.ownerDocument?.defaultView && typeof node.innerText === 'string') return clean(node.innerText);
    const parts = [];
    const walk = n => {
      if (n.nodeType === 3) { parts.push(n.textContent); return; }
      if (n.nodeType !== 1 || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.tagName)) return;
      const block = /^(DIV|MAIN|P|LI|H[1-6]|BR|TR|TD|SECTION|ARTICLE)$/.test(n.tagName);
      if (block) parts.push('\n');
      for (const child of n.childNodes) walk(child);
      if (block) parts.push('\n');
    };
    walk(node); return clean(parts.join('').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n'));
  }
  function visible(node) {
    if (!node || node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
    return !node.isConnected || !node.ownerDocument.defaultView || Boolean(node.getClientRects().length);
  }
  function selector(node) {
    if (node.id) return '#' + CSS.escape(node.id);
    const parts = [];
    for (let n = node; n && n.tagName !== 'BODY' && parts.length < 7; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      const siblings = n.parentElement ? [...n.parentElement.children].filter(s => s.tagName === n.tagName) : [n];
      parts.unshift(n.tagName.toLowerCase() + ':nth-of-type(' + (siblings.indexOf(n) + 1) + ')');
    }
    return parts.join(' > ');
  }
  function safeURL(value, base) {
    try { const u = new URL(value, base); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
  }
  function section(value, kind) {
    const lines = value.split('\n'), out = []; let found = false;
    for (const line of lines) {
      if (!found && kind.test(line.trim())) { found = true; out.push(line.trim().replace(kind, '')); continue; }
      if (found && (REQUIRE.test(line.trim()) || DUTIES.test(line.trim()) || BENEFITS.test(line.trim()) || /^(?:申请|立即投递|相关推荐|发布时间|截止时间|关闭详情)/.test(line.trim()))) break;
      if (found) out.push(line);
    }
    return clean(out.join('\n'));
  }
  function field(value, labels) {
    const m = value.match(new RegExp('(?:^|\\n)\\s*(?:' + labels + ')\\s*[:：]\\s*([^\\n]+)', 'i'));
    return clean(m?.[1]);
  }
  function majorField(value, node) {
    const label = /^(?:专业要求|所学专业|专业背景|专业范围|招聘专业|专业类别|学科专业|专业|Majors?|Field of study)\s*[:：]?\s*$/i;
    const inline = field(value, '专业要求|所学专业|专业背景|专业范围|招聘专业|专业类别|学科专业|专业|Majors?|Field of study');
    if (inline) return inline;
    for (const row of node.querySelectorAll('tr')) {
      const cells = [...row.children];
      for (let i = 0; i < cells.length - 1; i++) if (label.test(text(cells[i]))) return text(cells[i + 1]);
    }
    for (const term of node.querySelectorAll('dt')) if (label.test(text(term)) && term.nextElementSibling?.matches('dd')) return text(term.nextElementSibling);
    const lines = value.split('\n').map(v => v.trim()).filter(Boolean), index = lines.findIndex(v => label.test(v));
    if (index < 0) return '';
    const out = [];
    for (const line of lines.slice(index + 1, index + 9)) {
      if (/^(?:学历|学位|工作|岗位|任职|招聘|年龄|英语|技能|能力|职责|福利|薪酬|截止|备注|所属|人数|性别)|^.{2,12}[:：]/.test(line)) break;
      out.push(line);
    }
    return clean(out.join('\n'));
  }
  function expiry(value) {
    const raw = value.match(/(?:报名截止日期|投递截止时间|截止时间|截止日期|申请截止)[：:\s]*(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日)?(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?/);
    return raw ? raw[1] + '-' + raw[2].padStart(2, '0') + '-' + raw[3].padStart(2, '0') + (raw[4] ? ' ' + raw[4] : '') : '';
  }
  function company(value, node, name) {
    const named = [...node.querySelectorAll('[class*="company" i],[class*="employer" i],[class*="orgName" i]')].map(text).find(s => s && s !== name && s.length < 100);
    return field(value, '招聘单位|公司名称|招聘公司|用人单位') || named ||
      value.split('\n').find(s => s !== name && /(?:有限公司|股份公司|研究院|集团|公司|分公司|工厂|中心)$/.test(s.trim())) || [...node.querySelectorAll('h5,h4')].map(text).find(s => s && s !== name && s.length < 100) || '';
  }
  function city(value) {
    return field(value, '工作地点|工作城市|岗位地点|工作地区') ||
      value.split('\n').find(s => /^[^｜|\n]{1,35}[｜|]\s*(全职|实习|兼职)/.test(s))?.split(/[｜|]/)[0] ||
      value.split('\n').find(s => /^(?:北京|上海|天津|重庆|内蒙古|宁夏|广西|新疆|西藏|香港|澳门|[^\s]{2,8}[省市])/.test(s) && s.length < 45) || '';
  }
  function qualificationClauses(value) {
    // Only called inside a single detail scope. Keep literal clauses, not inferred qualifications.
    const scoped = value.split(/(?:相关推荐|推荐岗位|推荐职位|相似职位|其他职位)/)[0];
    return [...new Set(scoped.split(/[\n。；;]+/).map(s => s.trim()).filter(line => {
      const bare = line.replace(/^\d+[、.．）)]\s*/, '');
      if (!bare || bare.length > 800 || /^(?:熟悉|熟练|掌握|精通|了解|负责|从事|参与|使用)/.test(bare)) return false;
      return bare.split(/[，,]/).some(part => !/专业(?:知识|技能|技术|能力|素养|软件)/.test(part) && /专业(?:要求|背景|学历|学位|毕业|方向|优先|不限|[，,、\s]|$)|相关专业|不限专业|学科背景|理工(?:科|类)?(?:相关)?(?:专业|本科|毕业生)|工科(?:类)?(?:相关)?(?:专业|本科|毕业生)/.test(part));
    }))].join('\n');
  }
  function facts(node, base, name, url, detailOnly = false) {
    const value = text(node), requirement = section(value, REQUIRE), clauses = detailOnly ? qualificationClauses(value) : '';
    const lines = value.split('\n'), boundary = lines.findIndex(line => REQUIRE.test(line.trim()) || DUTIES.test(line.trim()) || BENEFITS.test(line.trim()));
    const identityText = lines.slice(0, boundary < 0 ? undefined : boundary).filter(line => !DETAIL_ACTION.test(line.trim()) && !/^(?:关闭详情|立即申请|申请|已申请|立即投递|投递|收藏|已收藏)$/.test(line.trim())).join('\n');
    let fingerprint = 2166136261;
    for (let i = 0; i < identityText.length; i++) fingerprint = Math.imul(fingerprint ^ identityText.charCodeAt(i), 16777619);
    const degree = field(value, '学历要求|学历') || value.match(/(?:大学)?(?:本科|硕士研究生|博士研究生|硕士|博士|大专|专科)(?:及以上)?/)?.[0] || '';
    const major = majorField(value, node);
    const summary = [degree && '学历要求：' + degree, major && '专业要求：' + major].filter(Boolean).join('\n');
    return { id: url || base + '#job=' + encodeURIComponent(name + '|' + company(value, node, name) + '|' + city(value) + '|' + (fingerprint >>> 0).toString(36)), url: url || base,
      name, company: company(value, node, name), city: city(value), group: field(value, '所属单位|上级单位|所属集团'),
      requirements: [requirement || summary, ...clauses.split('\n').filter(line => line && !(requirement || summary).includes(line))].filter(Boolean).join('\n'), majorRequirements: major, description: section(value, DUTIES), benefits: section(value, BENEFITS),
      nature: field(value, '岗位性质|工作性质') || value.match(/(?:全职|实习|兼职|合同工)/)?.[0] || '',
      closes: expiry(value), completeness: requirement || (detailOnly && (major || clauses)) ? 'detail' : detailOnly ? 'detail-summary' : 'list-summary', linkKind: url ? 'detail' : 'list',
      collectionState: requirement ? 'read' : 'pending' };
  }
  function jobPosting(doc, base) {
    const found = [];
    function walk(item) {
      if (Array.isArray(item)) { item.forEach(walk); return; }
      if (!item || typeof item !== 'object') return;
      if ([].concat(item['@type'] || []).includes('JobPosting')) {
        const plain = v => Array.isArray(v) ? v.map(plain).filter(Boolean).join('\n') : typeof v === 'string' ? v.replace(/<(?:br|\/p|\/div|\/h[1-6])[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ') : v?.name || v?.credentialCategory || '';
        const locations = [].concat(item.jobLocation || []).map(v => v.address?.addressLocality || v.address?.addressRegion || v.name || '').filter(Boolean);
        const description = plain(item.description), embedded = section(description, REQUIRE) || qualificationClauses(description);
        const qualifications = plain(item.qualifications), req = [qualifications, plain(item.educationRequirements), plain(item.experienceRequirements), embedded, item.skills && '技能要求：' + plain(item.skills)].filter(Boolean).join('\n');
        const url = item.url ? safeURL(item.url, base) : '', name = plain(item.title), employer = plain(item.hiringOrganization);
        found.push({ id: url || base + '#job=' + encodeURIComponent([name, employer, locations.join('/'), plain(item.identifier) || item.identifier?.value || ''].join('|')), url: url || base, name, company: employer, city: locations.join(' / '),
          requirements: req, description, closes: plain(item.validThrough), nature: plain(item.employmentType),
          completeness: qualifications || embedded ? 'detail' : req ? 'detail-summary' : 'detail-missing', collectionState: qualifications || embedded ? 'read' : 'pending', linkKind: url ? 'detail' : 'list' });
      }
      if (item['@graph']) walk(item['@graph']);
    }
    for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) { try { walk(JSON.parse(el.textContent)); } catch {} }
    return found;
  }
  function nextControl(doc, rule = {}) {
    if (rule.next) { try { const e = doc.querySelector(rule.next); if (e && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.closest('.disabled,.is-disabled')) return e; return null; } catch {} }
    return [...doc.querySelectorAll('a,button,[role=button],[class*="next" i][title],[class*="next" i][aria-label]')].find(el => {
      const label = clean(el.getAttribute('aria-label') || el.title || text(el));
      const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('.disabled,.is-disabled');
      const pagination = el.closest('nav,[class*="pagination" i],[class*="pager" i],[aria-label*="分页"],[aria-label*="Pagination"]');
      return !disabled && visible(el) && (el.getAttribute('rel') === 'next' || ((NEXT.test(label) || /\bnext(?: page)?\b/i.test(label) || /(?:^|\s)(?:btn-)?next(?:\s|$)/i.test(el.className || '')) && pagination) || (/^(加载更多|更多岗位|Load more)$/i.test(label) && !el.closest('form')));
    }) || null;
  }
  function candidateName(el) {
    const name = text(el);
    if (/(?:company|employer|organization|org).*(?:name|title)|(?:name|title).*(?:company|employer|organization)/i.test(el.className || '') && !JOB_TITLE.test(el.className || '')) return '';
    const heading = name.replace(/^\d+[、.．）)]\s*/, '').replace(/[：:\s]+$/, '');
    const sectionHeading = [REQUIRE, DUTIES, BENEFITS].some(pattern => pattern.test(heading) && heading.replace(pattern, '').trim() === '');
    const generic = /^(?:校园招聘|社会招聘|人才招聘|招聘首页|职位列表|岗位列表)$/.test(heading) || /(?:公司|集团|研究院)[-—·\s]*(?:校招|校园招聘|招聘官网|招聘平台)$/.test(heading);
    return visible(el) && name && name.length <= 100 && !BAD.test(name) && !FIELD_TITLE.test(name) && !sectionHeading && !generic && !/^(?:共\s*)?\d+\s*(?:个?(?:职位|岗位)|条|页)$/.test(name) ? name : '';
  }
  function cardFor(el, name, rule) {
    for (let node = el.parentElement, depth = 0; node && node.tagName !== 'BODY' && depth < 10; node = node.parentElement, depth++) {
      if (node.matches('header,footer,nav,aside,[role=search],[role=dialog]')) return null;
      const value = text(node);
      if (value.length < name.length + 4) continue;
      if (value.length > 16000) return null;
      if (node.querySelector('input:not([type=hidden]),select,[role=combobox]')) return null;
      const signature = [...node.classList].filter(c => !/^(?:active|selected|hover|open|expanded|show|is-.*)$/.test(c)).sort().join(' ');
      const repeated = node.parentElement && [...node.parentElement.children].filter(s => s.tagName === node.tagName && [...s.classList].filter(c => !/^(?:active|selected|hover|open|expanded|show|is-.*)$/.test(c)).sort().join(' ') === signature).length > 1;
      const semantic = node.matches('article,li,tr,[role=row]') || /(?:item|card)/i.test(signature);
      const titleClass = JOB_TITLE.test(el.className || '') || Boolean(el.closest('[class*="jobTitle" i],[class*="positionTitle" i],[class*="jobName" i],[class*="positionName" i]'));
      const evidence = /学历|专业|截止|全职|实习|招聘人数|任职要求|岗位要求|工作地点|本科|硕士|博士/.test(value);
      const actions = [...node.querySelectorAll('a,button,[role=button]')].some(b => DETAIL_ACTION.test(text(b)));
      const titleCount = [...node.querySelectorAll(TITLE_QUERY)].filter(t => candidateName(t) && !isOrganization(t) && text(t) !== name && (JOB_TITLE.test(t.className || '') || t.matches('h1,h2,h3,h4,a[href],[role=link]'))).length;
      if (titleCount > 1) return null;
      if ((repeated || semantic) && (evidence || titleClass || actions || rule.title)) return node;
    }
    return null;
  }
  function scanDocument(doc, base, rule = {}, detailOnly = false) {
    const blocked = root.JobScreenAccess?.detectDocument(doc); if (blocked) throw root.JobScreenAccess.error(blocked);
    const structured = jobPosting(doc, base);
    let area; try { area = rule.area ? doc.querySelector(rule.area) : null; } catch {}
    if (rule.area && !area) throw Error('之前指定的岗位区域已不存在，请清除本页规则后重新选择。');
    area ||= doc.querySelector('main,[role=main],article') || doc.body;
    if (!area) return { url: base, jobs: [], next: false, total: null };
    const titleNodes = rule.title ? [...area.querySelectorAll(rule.title)] : [...area.querySelectorAll(TITLE_QUERY)];
    const jobs = detailOnly ? [] : structured, seen = new Set();
    if (!detailOnly && !structured.length) for (const candidate of titleNodes) {
      if (candidate.closest('header,footer,nav,aside,[role=search],[role=dialog]')) continue;
      const name = candidateName(candidate); if (!name) continue;
      if ([...candidate.querySelectorAll(TITLE_QUERY)].some(child => candidateName(child) && text(child) !== name)) continue;
      const el = candidate.matches('a,[role=link]') ? candidate : [...candidate.querySelectorAll('a,[role=link],span')].filter(n => text(n) === name).pop() || candidate;
      const href = el.getAttribute('href'), url = href && !/^\s*#\s*$/.test(href) ? safeURL(href, base) : '';
      if (href && !url && !/^\s*(?:javascript:|#\s*$)/i.test(href)) continue;
      const titleLike = candidate.matches('h1,h2,h3,h4,[role=link]') || /title|jobname|positionname/i.test(candidate.className || '') || /title/i.test(el.parentElement?.className || '');
      const pathLike = url && /[?&](?:id|jobId|positionId)=|\/(?:job|position|detail|vacancy|career)[^/]*\/|\/\d{3,}(?:[/?#]|$)/i.test(url);
      if (!titleLike && !pathLike && !rule.title) continue;
      const card = cardFor(candidate, name, rule);
      if (!card) continue;
      if (!rule.title && isOrganization(candidate) && [...card.querySelectorAll(TITLE_QUERY)].some(t => candidateName(t) && !isOrganization(t) && text(t) !== name)) continue;
      const job = facts(card, base, name, url);
      if (!rule.title && job.company === name) continue;
      if (seen.has(job.id)) continue; seen.add(job.id);
      if (!url && doc.defaultView) job.titleSelector = selector(el);
      const btn = [...card.querySelectorAll('button,a,[role=button]')].find(b => DETAIL_ACTION.test(text(b)) && visible(b));
      if (btn && doc.defaultView) job.expandSelector = selector(btn);
      jobs.push(job); if (jobs.length >= 6000) break;
    }
    if (!jobs.length || detailOnly) {
      const detailArea = doc.querySelector('main,[role=main],article,.content') || area;
      const value = text(detailArea), req = section(value, REQUIRE);
      if (value.split('\n').some(line => REQUIRE.test(line.trim())) || (detailOnly && (/(?:学历要求|专业要求)\s*[:：]\s*\S/.test(value) || qualificationClauses(value)))) {
        const explicit = [...detailArea.querySelectorAll('[class*="jobTitle" i],[class*="positionTitle" i],[class*="jobName" i],[class*="positionName" i]')].map(candidateName).find(Boolean);
        const title = explicit || [...detailArea.querySelectorAll('h1,h2,h3')].map(candidateName).find(Boolean) || '';
        const job = facts(detailArea, base, field(value, '招聘岗位|岗位名称|职位名称') || title, base, true);
        if (detailOnly && structured.length === 1) {
          const schema = structured[0];
          job.requirements = [...new Set([job.requirements, schema.requirements].filter(Boolean))].join('\n');
          for (const key of ['name','company','city','description','closes','nature']) job[key] ||= schema[key];
          if (schema.completeness === 'detail') job.completeness = 'detail';
        }
        if (!job.requirements) job.completeness = 'detail-missing'; job.collectionState = job.completeness === 'detail' ? 'read' : 'missing';
        return { url: base, jobs: [job], kind: 'detail', next: false, total: 1 };
      }
      if (detailOnly) return structured.length ? { url: base, jobs: structured.map(j => ({...j, url: base, linkKind: 'detail'})), kind: 'detail', next: false, total: 1 } : { url: base, jobs: [], kind: 'unknown', next: false, total: null };
    }
    const next = nextControl(doc, rule), pageText = text(doc.body);
    const totalMatch = pageText.match(/共[（(\s]*(\d+)[）)\s]*(?:条(?:记录)?|个?(?:职位|岗位))/) || pageText.match(/(?:^|\n)\s*(\d+)\s*个?(?:职位|岗位)\s*(?:\n|$)/);
    const pagesMatch = pageText.match(/共\s*(\d+)\s*页/);
    const pageNode = doc.querySelector('[aria-current=page],.pagination .active,.pagination .is-active,.pager .active,.el-pager .is-active');
    const total = totalMatch ? Number(totalMatch[1]) : null;
    const scroll = Boolean(!next && !rule.next && doc.defaultView && jobs.length && (total === null || jobs.length < total));
    return { url: base, jobs, kind: jobs.length ? 'list' : 'unknown', next: Boolean(next) || scroll, nextKind: next ? 'control' : scroll ? 'scroll' : '',
      nextURL: next ? safeURL(next.getAttribute('href'), base) : '', total: totalMatch ? Number(totalMatch[1]) : null,
      totalPages: pagesMatch ? Number(pagesMatch[1]) : null, pageNumber: Number(text(pageNode)) || null,
      signature: jobs.map(j => j.id).join('|') };
  }
  async function scan(rule = {}, expand = false, detailOnly = false, permit = null) {
    let result = scanDocument(document, location.href, rule, detailOnly);
    if (expand) {
      let changed = false;
      for (const job of result.jobs.slice(0, root.JobScreenAccess?.policy.maxJobs || 200)) if (job.expandSelector && job.collectionState !== 'read') {
        const btn = document.querySelector(job.expandSelector);
        if (btn && DETAIL_ACTION.test(text(btn))) { await permit?.(); const blocked = root.JobScreenAccess?.detectDocument(document); if (blocked) throw root.JobScreenAccess.error(blocked); btn.click(); changed = true; }
      }
      if (changed) { await new Promise(resolve => setTimeout(resolve, 700)); result = scanDocument(document, location.href, rule, detailOnly); }
    }
    return result;
  }
  async function advance(rule = {}, permit = null) {
    const blocked = root.JobScreenAccess?.detectDocument(document); if (blocked) throw root.JobScreenAccess.error(blocked);
    const el = nextControl(document, rule);
    if (el) {
      if (/申请|投递|登录|提交/.test(text(el))) throw Error('分页控件无效，请重新指定下一页按钮。');
      await permit?.(); el.click(); return true;
    }
    const before = await scan(rule);
    if (before.nextKind !== 'scroll') throw Error('未识别到可用的下一页，请指定分页按钮。');
    const until = Date.now() + 7000;
    while (Date.now() < until) {
      await permit?.();
      let area; try { area = rule.area ? document.querySelector(rule.area) : null; } catch {}
      (area || document.body).lastElementChild?.scrollIntoView({block:'end'});
      for (let node = area; node && node !== document.body; node = node.parentElement) if (node.scrollHeight > node.clientHeight + 5) { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll', {bubbles:true})); }
      window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
      window.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => setTimeout(resolve, 400));
      const after = await scan(rule, true, false, permit);
      if (after.signature !== before.signature && after.jobs.length) return after;
    }
    return { ...before, ended: true, next: false, stopReason: '向下滚动后没有发现新增岗位；当前已发现的岗位仍会继续读取详情。' };
  }
  function pick(kind) {
    return new Promise(resolve => {
      document.getElementById('job-screen-picker')?.remove();
      const box = document.createElement('div'); box.id = 'job-screen-picker';
      box.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#29264b;color:white;padding:16px;border-radius:16px;font:14px system-ui;box-shadow:0 10px 50px #0004;display:flex;gap:12px;align-items:center';
      const label = document.createElement('span'); label.textContent = '点击' + ({ area: '岗位列表区域', title: '一个岗位标题', next: '下一页按钮' }[kind]) + '；Esc 取消';
      const grow = document.createElement('button'), use = document.createElement('button'), cancel = document.createElement('button');
      grow.textContent = '扩大区域'; use.textContent = '使用选择'; cancel.textContent = '关闭';
      for (const b of [grow, use, cancel]) b.style.cssText = 'padding:7px 12px;border:0;border-radius:8px;cursor:pointer;background:#eeeaff;color:#29264b';
      box.append(label, grow, use, cancel); document.body.append(box);
      let chosen = null, previous = '', timer;
      const highlight = node => { if (chosen) chosen.style.outline = previous; chosen = node; previous = node.style.outline; node.style.outline = '3px solid #8b5cf6'; label.textContent = '已选 ' + node.tagName.toLowerCase() + ' · 可扩大区域后确认'; };
      const cleanup = value => { clearTimeout(timer); if (chosen) chosen.style.outline = previous; document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); box.remove(); resolve(value); };
      const click = e => { if (box.contains(e.target)) return; e.preventDefault(); e.stopImmediatePropagation(); highlight(e.target); };
      const key = e => { if (e.key === 'Escape') cleanup(null); };
      grow.onclick = () => { if (chosen?.parentElement && chosen.parentElement !== document.body) highlight(chosen.parentElement); };
      use.onclick = () => {
        if (!chosen) return;
        let path = selector(chosen);
        if (kind === 'title') {
          const cls = [...chosen.classList].filter(c => /^[\w-]+$/.test(c) && !/active|selected|hover/.test(c));
          if (cls.length) path = chosen.tagName.toLowerCase() + '.' + cls.map(CSS.escape).join('.');
          else if (chosen.parentElement) {
            const cs = [...chosen.parentElement.classList].filter(c => /^[\w-]+$/.test(c) && !/active|selected|hover/.test(c));
            if (cs.length) path = '.' + cs.map(CSS.escape).join('.') + ' > ' + chosen.tagName.toLowerCase();
          }
        }
        cleanup(path);
      };
      cancel.onclick = () => cleanup(null);
      document.addEventListener('click', click, true); document.addEventListener('keydown', key, true);
      timer = setTimeout(() => cleanup(null), 55000);
    });
  }
  root.JobScreenPage = { scan, advance, pick, scanDocument, text, safeURL };
})(globalThis);
