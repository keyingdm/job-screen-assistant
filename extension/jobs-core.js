(function (root) {
  'use strict';
  const Majors = typeof module !== 'undefined' ? require('./jobs-majors.js') : root.JobScreenMajors;
  const text = value => String(value ?? '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\r/g, '').trim().slice(0, 30000);
  const terms = value => text(value).split(/[\n,，;；、]+/).map(v => v.trim().toLowerCase()).filter(Boolean);
  const degreeNames = ['专科', '本科', '硕士', '博士'];
  const degreeRank = value => /博士/.test(value) ? 4 : /硕士|研究生/.test(value) ? 3 : /本科|学士/.test(value) ? 2 : /专科|大专|高职/.test(value) ? 1 : 0;
  const preferred = value => /优先|优选|加分|更佳|为佳/.test(value);
  const optional = value => /可放宽|可考虑|可以考虑|或|或者|优秀|特别优秀|不限/.test(value);
  function clauses(value) { return text(value).split(/[\n；;。]+/).map(v => v.replace(/^\s*\d+[、.．）)]\s*/, '').trim()).filter(Boolean); }
  const matchMajor = Majors.match;
  function degreeInfo(value) {
    const parts = clauses(value).flatMap(v => v.split(/[，,]/)).filter(v => /专科|大专|高职|本科|学士|硕士|博士|研究生/.test(v));
    const hard = parts.filter(v => !preferred(v) && !/在读|毕业时间/.test(v));
    const evidence = hard.join('；');
    if (!hard.length) return { label: /学历不限|不限学历/.test(value) ? '学历不限' : '未明确', rank: 0, evidence: parts.join('；'), unrestricted: /学历不限|不限学历/.test(value) };
    const ranks = [...evidence.matchAll(/博士研究生|硕士研究生|专科|大专|高职|本科|学士|硕士|博士|研究生/g)].map(m => degreeRank(m[0]));
    const rank = Math.min(...ranks), multiple = new Set(ranks).size > 1;
    const singleRanks = hard.map(part => [...new Set([...part.matchAll(/博士研究生|硕士研究生|专科|大专|高职|本科|学士|硕士|博士|研究生/g)].map(m => degreeRank(m[0])))]).filter(r => r.length === 1).map(r => r[0]);
    const conflicting = new Set(singleRanks).size > 1;
    const minimum = /及以上|或以上|以上|不低于|至少/.test(evidence);
    return { label: conflicting ? '学历表述不一致（看原文）' : degreeNames[rank - 1] + (minimum ? '及以上' : multiple ? '等（看原文）' : '（看原文）'), rank, minimum, exact: /仅限|只招|必须为/.test(evidence), uncertain: conflicting || /可放宽|可考虑|优秀|在读|学位|不含|不包括/.test(evidence) || (multiple && !minimum), evidence };
  }
  function graduationInfo(value) {
    const evidence = clauses(value).filter(v => /(?:20\d{2}).{0,12}(?:届|毕业)|(?:届|毕业).{0,12}20\d{2}/.test(v)).join('；');
    let years = [...evidence.matchAll(/20\d{2}/g)].map(m => Number(m[0]));
    const range = evidence.match(/(20\d{2})\s*[-—~～至到]\s*(20\d{2})/);
    if (range && Number(range[2]) - Number(range[1]) <= 6) years = Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i);
    return { years: [...new Set(years)], evidence, uncertain: /或|放宽|优秀|优先|之后|之前|至今|\d月|20\d{2}年\d/.test(evidence) };
  }
  function experienceInfo(value) {
    const parts = clauses(value).flatMap(v => v.split(/[，,]/)), required = [], preferences = [];
    for (const line of parts) {
      const match = line.match(/([0-9]+(?:\.[0-9]+)?|[一二三四五六七八九十两]{1,3})\s*(?:[-—~～至到]\s*\d+)?\s*年(?:及|以)?(?:以上|下)?[^；。\n]{0,16}(?:经验|经历|工作|从业)/);
      if (!match) continue;
      const digit = value => value === '两' ? 2 : '一二三四五六七八九'.indexOf(value) + 1;
      const chinese = value => value.includes('十') ? (value.split('十')[0] ? digit(value.split('十')[0]) : 1) * 10 + (value.split('十')[1] ? digit(value.split('十')[1]) : 0) : digit(value);
      const min = /^\d/.test(match[1]) ? Number(match[1]) : chinese(match[1]);
      const item = { min, evidence: line, uncertain: optional(line) || /以内|以下|不超过|至多|最多|实习|项目/.test(line) };
      (preferred(line) ? preferences : required).push(item);
    }
    const clearNone = /经验不限|不限经验|无.{0,3}经验要求|无需.{0,3}经验/.test(value);
    return { min: required.length ? Math.max(...required.map(v => v.min)) : null, uncertain: required.some(v => v.uncertain), evidence: required.map(v => v.evidence).join('；'), preferences: preferences.map(v => v.evidence).join('；'), clearNone };
  }
  function englishInfo(value) {
    const parts = clauses(value).flatMap(v => v.split(/[，,]/)).filter(v => /英语|CET|雅思|托福/i.test(v));
    const hard = parts.filter(v => !preferred(v));
    const evidence = hard.join('；');
    const rank = /六级|CET\s*[-—]?\s*6/i.test(evidence) ? 2 : /四级|CET\s*[-—]?\s*4/i.test(evidence) ? 1 : 0;
    return { rank, evidence, uncertain: /或|雅思|托福|\d{3}\s*分/.test(evidence) || (!rank && Boolean(evidence)) };
  }
  function deadline(value) {
    const match = text(value).match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!match) return null;
    const [, y, m, d, h, min, sec] = match;
    const hour = h === undefined ? 24 : Number(h);
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31 || hour > 24 || Number(min || 0) > 59 || Number(sec || 0) > 59 || (hour === 24 && (Number(min || 0) || Number(sec || 0)))) return null;
    const check = new Date(Date.UTC(+y, +m - 1, +d));
    if (check.getUTCMonth() !== +m - 1 || check.getUTCDate() !== +d) return null;
    if (/[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(text(value))) {
      const parsed = Date.parse(text(value)); if (Number.isFinite(parsed)) return parsed;
    }
    return Date.UTC(+y, +m - 1, +d, hour - 8, Number(min || 0), Number(sec || 0));
  }
  function safeURL(value) { try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
  function normalize(raw, source = 'page') {
    if (!raw || typeof raw !== 'object') throw Error('岗位格式无效');
    const id = text(raw.id || raw.positionNo), url = safeURL(raw.url);
    const requirements = text(raw.requirements ?? raw.jobRequirements), description = text(raw.description ?? raw.jobDescription);
    const job = { id, key: `${source}:${id || url || text(raw.name)}`, source, url, name: text(raw.name) || '未命名岗位', company: text(raw.company ?? raw.org ?? raw.orgName), group: text(raw.group ?? raw.positionSecondOrg), city: text(raw.city ?? raw.cityName), nature: text(raw.nature ?? raw.workNature), type: raw.type ?? raw.positionType ?? '', requirements, description, benefits: text(raw.benefits ?? raw.salaryRequirements), closes: text(raw.closes ?? raw.closeDateTime ?? raw.closeDate ?? raw.closeTime), canDeliver: raw.canDeliver, applyable: raw.applyable, collectedAt: text(raw.collectedAt) || new Date().toISOString(), completeness: raw.completeness || (requirements ? 'requirements' : 'list-only') };
    job.sourceURL = safeURL(raw.sourceURL); job.sourceLabel = text(raw.sourceLabel);
    if (job.sourceURL) job.key = `${source}:${new URL(job.sourceURL).origin}:${id || url || job.name}`;
    job.majorRequirements = text(raw.majorRequirements);
    job.collectionState = text(raw.collectionState) || (requirements ? 'read' : 'pending'); job.collectionError = text(raw.collectionError); job.linkKind = text(raw.linkKind) || (url ? 'detail' : 'list');
    job.facts = { degree: degreeInfo(requirements), graduation: graduationInfo(requirements), experience: experienceInfo(requirements), english: englishInfo(requirements), major: Majors.extract(job).evidence, other: clauses(requirements).filter(v => /资格|证书|职称|党员|政治|年龄|岁|全日制|双一流|985|211|院校|户籍|生源/.test(v)).join('；') };
    job.tags = ['出差', '驻场', '驻点', '倒班', '夜班', '轮班', '加班', '外派', '销售', '实习'].filter(v => `${requirements}\n${description}\n${job.name}\n${job.nature}`.includes(v));
    job.deadline = deadline(job.closes);
    return job;
  }
  function evaluate(job, profile = {}, now = Date.now()) {
    const checks = [], add = (label, state, reason, evidence = '') => checks.push({ label, state, reason, evidence });
    const f = job.facts;
    if (profile.degree) {
      const rank = degreeRank(profile.degree), d = f.degree;
      if (d.unrestricted) add('学历', 'pass', '原文写明学历不限', d.evidence);
      else if (!d.rank) add('学历', 'review', '未找到明确的学历门槛', d.evidence);
      else if (rank < d.rank) add('学历', d.uncertain ? 'review' : 'fail', d.uncertain ? '有放宽或复杂条件，需核对' : `你的学历低于原文要求：${d.label}`, d.evidence);
      else if (d.uncertain || (!d.minimum && !d.exact && rank !== d.rank)) add('学历', 'review', '原文未明确是否接受该学历', d.evidence);
      else if (d.exact && !d.minimum && rank !== d.rank) add('学历', 'fail', '原文限定学历，不在限定范围', d.evidence);
      else add('学历', 'pass', '满足已识别的学历条件', d.evidence);
    }
    if (profile.year) {
      const g = f.graduation;
      if (!g.years.length || g.uncertain) add('毕业届别', 'review', '届别未明确或有附加条件', g.evidence);
      else add('毕业届别', g.years.includes(Number(profile.year)) ? 'pass' : 'fail', `原文涉及 ${g.years.join(' / ')} 届`, g.evidence);
    }
    if (profile.major) {
      const major = Majors.assess(job, profile); add('专业', major.state, major.reason, major.evidence);
    }
    if (profile.experience !== '' && profile.experience !== undefined) {
      const e = f.experience;
      if (e.clearNone && e.min === null) add('工作经验', 'pass', '原文写明经验不限');
      else if (e.min === null || e.uncertain) add('工作经验', 'review', '经验门槛未明确或有例外', e.evidence || e.preferences);
      else add('工作经验', Number(profile.experience) >= e.min ? 'pass' : 'fail', `原文至少要求 ${e.min} 年相关经验；年限足够仍需核对经历方向`, e.evidence);
    }
    if (profile.english !== '' && profile.english !== undefined) {
      const e = f.english;
      if (!e.rank || e.uncertain) add('英语', 'review', '英语条件未明确或含分数、替代考试', e.evidence);
      else add('英语', Number(profile.english) >= e.rank ? 'pass' : 'fail', `原文要求英语${e.rank === 2 ? '六' : '四'}级`, e.evidence);
    }
    if (job.canDeliver === false || job.applyable === false || (job.deadline !== null && job.deadline < now)) add('投递状态', 'fail', '采集时不可投递或已过截止时间（北京时间）', job.closes);
    const state = checks.some(v => v.state === 'fail') ? 'fail' : !checks.length || checks.some(v => v.state === 'review') || Boolean(f.other) || ['pending', 'reading', 'failed', 'missing'].includes(job.collectionState) ? 'review' : 'pass';
    if (f.other) add('其他门槛', 'review', '存在额外资格条件，请核对原文', f.other);
    const conflicts = checks.filter(check => check.state === 'fail');
    return { state, checks, conflicts, conflictLabel: conflicts.map(check => check.label + '冲突').join(' / '), conflictReason: conflicts.map(check => check.reason).join('；'), label: state === 'fail' ? '存在明确冲突' : state === 'review' ? '待确认' : '所选条件未见冲突' };
  }
  function filter(jobs, profile, filters = {}, marks = {}, now = Date.now()) {
    const any = (value, query) => !terms(query).length || terms(query).some(t => value.toLowerCase().includes(t));
    return jobs.map(job => ({ job, match: evaluate(job, profile, now), major: matchMajor(job, filters.major, profile), majorQualification: profile.major ? Majors.assess(job, profile) : null, mark: marks[job.key] || {} })).filter(({ job: j, match, major, mark }) => {
      const all = `${j.name}\n${j.company}\n${j.group}\n${j.city}\n${j.requirements}\n${j.description}\n${j.benefits}`;
      const unread = ['pending', 'reading', 'failed', 'missing'].includes(j.collectionState);
      const majorVisible = !terms(filters.major).length || (filters.majorMode === 'hit' ? major.hit : major.hit || major.state === 'range' || major.unrestricted || (!major.excluded && (major.unknown || unread)));
      return any(all, filters.query) && any(j.city, filters.city) && any(j.name + '\n' + j.description, filters.role) && any(j.company + '\n' + j.group, filters.company) && majorVisible && any(j.benefits, filters.benefits) && (!filters.exclude || !terms(filters.exclude).some(t => all.toLowerCase().includes(t))) && (!filters.state || match.state === filters.state) && (!filters.type || String(j.type) === filters.type) && (!filters.nature || j.nature.includes(filters.nature)) && (!filters.hideConflicts || match.state !== 'fail') && (!filters.hideDegreeConflicts || !match.conflicts.some(check => check.label === '学历')) && (!filters.onlyOpen || !(j.canDeliver === false || j.applyable === false || (j.deadline !== null && j.deadline < now))) && (!filters.favorite || mark.favorite) && (!filters.mark || (mark.status || '未标记') === filters.mark) && (!filters.days || (j.deadline !== null && j.deadline >= now && j.deadline <= now + Number(filters.days) * 86400000));
    }).sort((a, b) => {
      if (filters.sort === 'deadline') return (a.job.deadline ?? Infinity) - (b.job.deadline ?? Infinity);
      if (filters.sort === 'company') return a.job.company.localeCompare(b.job.company, 'zh-CN');
      const majorRank = r => terms(filters.major).length ? ({ hit: 0, range: 1, unrestricted: 3, unknown: 4, different: 5, excluded: 6 }[r.major.state]) : r.majorQualification?.rank ?? 0;
      return Number(a.match.state === 'fail') - Number(b.match.state === 'fail') || majorRank(a) - majorRank(b) || ({ pass: 0, review: 1, fail: 2 }[a.match.state] - { pass: 0, review: 1, fail: 2 }[b.match.state]);
    });
  }
  function csv(rows) {
    const cell = value => { let v = String(value ?? ''); if (/^[\s]*[=+@-]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    const headers = ['岗位', '公司', '上级单位', '城市', '学历提取', '专业原文', '经验门槛', '截止时间', '判断', '本地标记', '原文链接', '任职要求', '工作职责', '福利待遇', '采集时间', '来源网站', '来源列表'];
    return '\ufeff' + [headers, ...rows.map(({ job: j, match, mark }) => [j.name, j.company, j.group, j.city, j.facts.degree.label, j.facts.major, j.facts.experience.evidence, j.closes, match.label, mark.status, j.url, j.requirements, j.description, j.benefits, j.collectedAt, j.sourceLabel, j.sourceURL])].map(row => row.map(cell).join(',')).join('\r\n');
  }
  const api = { text, terms, matchMajor, majors: Majors, degreeInfo, graduationInfo, experienceInfo, englishInfo, deadline, safeURL, normalize, evaluate, filter, csv };
  root.JobScreen = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
