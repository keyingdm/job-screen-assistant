(function (root) {
  'use strict';
  const catalog = typeof module !== 'undefined' ? require('./jobs-major-data.js') : root.JobScreenMajorData;
  const clean = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/\r/g, '').trim().slice(0, 30000);
  const norm = value => clean(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const names = new Map(catalog.majors.map(([code, name, category]) => [norm(name), { code, name, category, categoryName: catalog.categories[category] || '', discipline: code.slice(0, 2), disciplineName: catalog.disciplines[code.slice(0, 2)] || '' }]));
  const categoryNames = Object.values(catalog.categories);
  const LABEL = /^(?:专业要求|所学专业|专业背景|专业范围|招聘专业|专业类别|学科专业|专业|major(?:s)?|field of study)\s*[:：]\s*/i;
  const HEADING = /^(?:专业要求|所学专业|专业背景|专业范围|招聘专业|专业类别|学科专业|专业|major(?:s)?|field of study)\s*[:：]?\s*$/i;
  const SKILL = /^(?:熟悉|熟练|掌握|精通|了解|具备|具有|有|能够|能|负责|从事|参与|使用|会|擅长|获[得取]|持有|通过|技能要求|能力要求|familiar|proficient|experience|skills?\s*[:：])/i;
  const OTHER = /^(?:学历|学位|毕业|工作地点|工作经验|岗位职责|工作职责|技能要求|能力要求|英语|年龄|性别|政治面貌|薪酬|福利|截止|招聘人数|任职要求|任职资格|备注)\s*[:：]/;
  const BROAD = /^(?:(?:相关|相近|其他|其它|理工科|理工|工科|工学|理学|文科|文史|经管|经济管理|不限|所有|各|本岗位).{0,8}(?:专业|学科|方向)?|相关专业)$/;
  const WIDE = /理工(?:科)?(?:类)?|工科(?:类)?|(?:理学|工学|经济学|管理学)(?:类)?(?:等)?(?:相关)?(?:专业|学科|背景)/;
  const join = entries => [...new Set(entries.map(e => e.text))].join('；');
  function lookup(value) { return names.get(norm(value)) || null; }
  function bare(value) {
    const s = norm(value).replace(/(?:及以上|学历|学位|本科|硕士|博士)/g, '');
    if (names.has(s) || categoryNames.includes(s)) return true;
    const tokens = s.split(/[、,，/或]+/).filter(Boolean);
    return tokens.length > 0 && tokens.every(t => names.has(t) || categoryNames.includes(t));
  }
  function extract(value) {
    const job = typeof value === 'object' && value !== null ? value : { requirements: value };
    const entries = [], seen = new Set();
    function read(raw, field) {
      let block = field;
      for (const line of clean(raw).split(/[\n；;。]+/).map(s => s.replace(/^\s*\d+[、.．）)]\s*/, '').trim()).filter(Boolean)) {
        if (HEADING.test(line)) { block = true; continue; }
        if (OTHER.test(line)) block = false;
        const labeled = LABEL.test(line), stripped = labeled ? line.replace(LABEL, '') : line;
        // Commas separate skills from major lists; a trailing “专业” also scopes a preceding bare list item.
        const pieces = stripped.replace(/[（(]([^）)]*(?:除外|以外)[^）)]*)[）)]/g, '；$1；').split(/[，,；;]/).map(s => s.trim()).filter(Boolean);
        const listScope = pieces.some(s => /专业(?:毕业|背景|优先|$)|相关专业|学科/.test(s));
        for (const piece of pieces) {
          const n = norm(piece);
          if (!n || /^(?:不要求|无需|无须).+专业/.test(n) || (SKILL.test(piece) && !/^(?:具备|具有|拥有|有).+(?:专业背景|专业学历|专业学位|专业教育)/.test(piece)) || /专业(?:知识|技能|技术|能力|素养|软件)/.test(piece)) continue;
          const professional = labeled || block || /专业(?:背景|毕业|方向)?|学科/.test(piece) || WIDE.test(piece) || bare(piece) || bare(piece.replace(/^(?:不接受|不招收?|不含|不包括|排除|除)/, '').replace(/(?:除外|以外|外)$/, '')) || (listScope && /^[\p{L}、/\s]{2,40}$/u.test(piece) && !/学历|经验|证书|工作|以上|应届/.test(piece));
          if (!professional) continue;
          const unrestricted = /专业不限|不限专业|专业不作限制|专业不做限制|不限$|^anymajor$/i.test(n);
          const excluded = /^(?:不接受|不招收?|不含|不包括|排除)|(?:除外|以外)|^除.+外|专业(?:不接受|不招)/.test(n);
          const uncertain = /可放宽|可考虑|可以考虑|视情况|优秀者|也接受|也可|另有|原则上|非.{1,25}专业|不接受非|不招非/.test(n);
          const kind = excluded ? 'excluded' : /优先|优选|为佳|加分/.test(n) ? 'preferred' : unrestricted ? 'unrestricted' : 'required';
          const entry = { text: (labeled ? line.slice(0, line.length - stripped.length) : '') + piece, value: n, kind, source: labeled || field || block ? 'field' : 'clause', uncertain, broad: BROAD.test(n) || WIDE.test(n) };
          const key = kind + ':' + n;
          if (!seen.has(key)) { entries.push(entry); seen.add(key); }
        }
        if (labeled) block = false;
      }
    }
    // An explicit field is kept independently from requirements, including list-only metadata.
    if (job.majorRequirements) read(job.majorRequirements, true);
    read(job.requirements || job.jobRequirements || '', false);
    return { entries, evidence: join(entries), known: entries.length > 0, uncertain: !entries.length || entries.some(e => e.broad || e.uncertain) };
  }
  function wideRelation(entry, person) {
    if (!person) return false;
    if (/理工(?:科)?(?:类)?/.test(entry.value)) return ['07', '08'].includes(person.discipline);
    if (/工科(?:类)?/.test(entry.value) && person.discipline === '08') return true;
    return Object.entries(catalog.disciplines).some(([code, name]) => code === person.discipline && [name, name + '类', name + '门类'].some(label => includesName(entry, label)));
  }
  function fragments(entries, keywords) {
    const complete = [...names.values()].filter(p => keywords.some(k => norm(p.name).includes(k)) && entries.some(e => includesName(e, p.name))).map(p => p.name);
    if (complete.length) return complete;
    return [...new Set(entries.flatMap(e => e.text.split(/[、/或]/)).filter(s => keywords.some(k => norm(s).includes(k))).map(s => s.trim()).filter(Boolean))];
  }
  function match(value, query, profile = {}) {
    const scope = extract(value), keywords = clean(query).split(/[\n,，;；、]+/).map(norm).filter(Boolean);
    const positives = scope.entries.filter(e => e.kind !== 'excluded' && e.kind !== 'unrestricted');
    const hits = positives.filter(e => keywords.some(k => e.value.includes(k)));
    const negatives = scope.entries.filter(e => e.kind === 'excluded' && keywords.some(k => e.value.includes(k)));
    const any = scope.entries.filter(e => e.kind === 'unrestricted');
    const person = lookup(profile.major || (keywords.length === 1 ? keywords[0] : ''));
    const relevant = person && keywords.some(k => norm(person.name).includes(k) || norm(person.categoryName).includes(k));
    const original = norm(typeof value === 'object' ? (value.requirements || '') + '\n' + (value.majorRequirements || '') : value);
    const otherCatalog = /20(?!26)\d{2}.{0,16}目录|(?:研究生|高职|专科).{0,10}目录/.test(original);
    const ranges = !otherCatalog && profile.degree === '本科' && relevant ? positives.filter(e => (person.categoryName && includesName(e, person.categoryName)) || wideRelation(e, person)) : [];
    const hit = hits.length > 0, excluded = !hit && negatives.some(e => !e.uncertain);
    const unrestricted = any.length > 0 && !negatives.length;
    const unknown = !scope.known || positives.some(e => e.broad || e.uncertain) || negatives.some(e => e.uncertain);
    const state = hit ? 'hit' : excluded ? 'excluded' : ranges.length ? 'range' : unrestricted ? 'unrestricted' : unknown ? 'unknown' : 'different';
    const evidence = join(hit ? hits.concat(negatives) : negatives.length ? negatives : ranges.length ? ranges : unrestricted ? any : scope.entries);
    return { ...scope, hit, keyword: keywords.find(k => hits.some(e => e.value.includes(k))) || '', excluded, unrestricted, unknown, state, evidence, fragments: fragments(hits, keywords),
      label: !scope.known ? '未检测到专业要求' : hit && negatives.length ? '专业词命中 · 含排除' : { hit: '专业词命中', range: '专业范围匹配 · 待核对', excluded: '原文有排除', unrestricted: '专业不限', unknown: '专业待确认', different: '专业词未命中' }[state] };
  }
  function includesName(entry, name) {
    const n = norm(name), value = entry.value, at = value.indexOf(n);
    if (at < 0) return false;
    const before = value.slice(0, at), after = value.slice(at + n.length);
    // No suffix matching: “应用物理学” is not the standalone “物理学”.
    const left = !before || /[、/:(（]$/.test(before) || /(?:专业(?:为|是|包括|包含)|限|仅限|只招|不接受|不招收?|不含|不包括|排除|除|接受|招收|要求|或|及|和|与|具有|具备|拥有|有)$/.test(before);
    const right = !after || /^(?:[、/):）]|专业|相关|等|毕业|背景|优先|及|或|和|与|除外|以外|方向)/.test(after) || (entry.kind === 'excluded' && after === '外');
    return left && right;
  }
  function assess(value, profile) {
    const scope = extract(value), input = norm(profile.major), person = lookup(input);
    const original = norm(typeof value === 'object' ? (value.requirements || '') + '\n' + (value.majorRequirements || '') : value);
    const otherCatalog = /20(?!26)\d{2}.{0,16}目录|(?:研究生|高职|专科).{0,10}目录/.test(original);
    const relation = entry => !otherCatalog && person && profile.degree === '本科' && person.categoryName && includesName(entry, person.categoryName);
    const direct = entry => person && includesName(entry, person.name);
    const negatives = scope.entries.filter(e => e.kind === 'excluded' && (direct(e) || relation(e)));
    const positive = scope.entries.filter(e => ['required', 'preferred'].includes(e.kind));
    const exact = positive.filter(direct), categories = positive.filter(relation);
    const add = (state, reason, evidence, kind = state === 'fail' ? 'excluded' : state === 'pass' ? 'exact' : 'unknown') => ({ state, reason, evidence, kind, rank: { exact: 0, category: 1, broad: 2, unrestricted: 3, unknown: 4, different: 5, excluded: 6 }[kind] });
    const reference = person?.categoryName ? `本科目录关系：${person.name} → ${person.categoryName}（2026年教育部目录）。` : '';
    if (negatives.length) {
      const uncertain = negatives.some(e => e.uncertain) || exact.length > 0;
      return add(uncertain ? 'review' : 'fail', uncertain ? '专业的接收和排除表述存在例外或冲突，请核对' : '原文明确排除你的专业或其所属专业类。' + (negatives.some(relation) ? reference : ''), join(negatives.concat(exact)));
    }
    const wideNegatives = scope.entries.filter(e => e.kind === 'excluded' && wideRelation(e, person));
    if (wideNegatives.length) return add('review', '原文排除宽泛专业范围，可能涉及你的专业；企业对该范围的定义需核对', join(wideNegatives));
    if (scope.entries.some(e => e.kind === 'unrestricted')) {
      const unresolved = scope.entries.some(e => e.kind === 'excluded' && (!person || e.uncertain || !profile.degree || ((otherCatalog || profile.degree !== '本科') && categoryNames.some(c => includesName(e, c)))));
      return add(unresolved ? 'review' : 'pass', unresolved ? '专业不限附带排除或例外，尚不能确定是否适用你的专业' : '原文写明专业不限；已识别的排除项未指向你的完整专业', scope.evidence, unresolved ? 'unknown' : 'unrestricted');
    }
    if (exact.length) {
      const uncertain = exact.some(e => e.kind === 'preferred' || e.uncertain || /相关|相近|方向|研究|等/.test(e.value)) || scope.entries.some(e => e.kind === 'excluded' && e.value.includes(input));
      return add(uncertain ? 'review' : 'pass', uncertain ? '原文提到你的完整专业，但含优先、方向或附加范围，需确认' : '原文专业要求明确出现你的完整专业名称', join(exact), uncertain ? 'category' : 'exact');
    }
    if (categories.length) return add('review', reference + '岗位按专业类或相关专业招聘，仍需核对企业范围', join(categories), 'category');
    const wide = !otherCatalog && profile.degree === '本科' ? positive.filter(e => wideRelation(e, person)) : [];
    if (wide.length) return add('review', `本科目录门类：${person.name} → ${person.disciplineName}。原文范围可能覆盖该专业；“理工类”等宽泛范围以企业解释为准`, join(wide), 'broad');
    const keyword = match(value, profile.major, profile);
    if (!person) return add('review', '该输入未识别为2026年本科目录中的完整专业名称；请在“我的完整专业”填写全称，部分名称放入“专业检索词”。其他层次或目录外专业需按原文核对', keyword.evidence);
    if (keyword.hit) return add('review', '专业名称出现部分匹配，尚不足以确认接收你的完整专业', keyword.evidence);
    return add('review', !scope.known ? '未检测到专业要求；技能或设备描述不能证明专业资格' : '完整专业未直接匹配，相关专业、简称或其他目录范围需核对', scope.evidence, keyword.unknown ? 'unknown' : 'different');
  }
  const api = { catalog, lookup, extract, match, assess };
  root.JobScreenMajors = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
