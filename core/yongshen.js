/**
 * 奇门·用神(YongShen) core —— 纯函数、无副作用、可移植。
 *
 * 解决的问题：引擎虽有 YONG_SHEN_RULES，但它按「问句关键词」分类后只给出 1-2 个用神元素，
 * 且判定逻辑埋在打包产物里、无法逐条审阅。本模块在其**之上**加一层可读、可测、可扩充的
 * 占类→角色映射（我方/主用神/辅用神/对方），把「该看哪些元素、它们落在哪一宫」显式列出，
 * 供 evidence.js 组装证据包，减少 AI 自行臆测用神的空间。
 *
 * 关键边界（务必保持）：
 *   ① 本模块只回答「该看什么」，**绝不判吉凶**——吉凶仍由引擎 jiuGongAnalysis / geju 决定。
 *   ② 三个概念严格分列，绝不合并成一个 yongshen 字段（Phase 1.1 审计结论）：
 *        domainRule —— 「这类问题应该看什么」（源自 domains.json，转盘传统）
 *        engineRule —— 「引擎对本盘实际算出的用神是什么」（原样保留，权威）
 *        examine    —— 「本次最终要看哪些元素」（二者归并，逐条标注 origin 来源）
 *      优先级：引擎匹配成功时 authority='engine'，domainRule 仅作补充视角；
 *      引擎未匹配（综合类）时 authority='domain'。
 *   ③ 零串味：domains.json 取用源自转盘，遇飞盘盘面时不得套用（详见 resolve 内 school 判定）。
 *   ③ 完全确定性：同盘同占类必得同一结果，不含随机、不含时间依赖。
 *
 * 数据来源：knowledge/domains.json（须先调用 load() 注入；不在模块内硬编码，便于校订）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YongShen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB = null;                    // domains.json 内容
  var GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  // 宫号 → 宫名/方位。与引擎 QM.JIU_GONG 同源，此处内置一份以保持 core 可独立移植。
  var GONG_INFO = {
    '1': { name: '坎', direction: '正北' }, '2': { name: '坤', direction: '西南' },
    '3': { name: '震', direction: '正东' }, '4': { name: '巽', direction: '东南' },
    '5': { name: '中', direction: '中央' }, '6': { name: '乾', direction: '西北' },
    '7': { name: '兑', direction: '正西' }, '8': { name: '艮', direction: '东北' },
    '9': { name: '离', direction: '正南' }
  };

  /**
   * 依盘面 schema 判定盘别。飞盘用 renPanMen/tianPanYi，转盘用 baMen/tianPan。
   * 山向盘复用转盘引擎机器，故归为 zhuanpan。
   */
  function detectSchool(chart) {
    if (!chart) return 'zhuanpan';
    if (chart.renPanMen || chart.tianPanYi || chart.diPanShen) return 'feipan';
    return 'zhuanpan';
  }

  /**
   * 界面「目的」→ 引擎占类名。
   * 引擎 classifyQuestion(question, category, fallbackCategory) 的回落分支要求传引擎占类名；
   * 界面值与之并不同名（财运/求财、健康/疾病、学业/功名），直传会静默回落「综合」并丢失专用用神。
   */
  function toEngineCategory(uiPurpose) {
    if (!uiPurpose) return '';
    var m = DB && DB.uiPurposeToEngineCategory;
    return (m && m[uiPurpose]) || uiPurpose;
  }

  function load(domainsJson) {
    DB = domainsJson && domainsJson.domains ? domainsJson : null;
    return !!DB;
  }
  function isLoaded() { return !!DB; }
  function domainIds() { return DB ? Object.keys(DB.domains) : []; }
  function getDomain(id) { return DB && DB.domains[id] ? DB.domains[id] : null; }

  /**
   * 占类归一化：接受 domain id(英)、界面「目的」(中)、引擎占类(中)三种输入，一律映射到 domain id。
   * 认不出时回落 general —— 这是向后兼容的关键：不传 domain 的旧调用照常工作。
   */
  function normalizeDomain(input) {
    if (!DB || !input) return 'general';
    var key = String(input).trim();
    if (!key) return 'general';
    if (DB.domains[key]) return key;
    var ids = Object.keys(DB.domains), i, j, d;
    for (i = 0; i < ids.length; i++) {
      d = DB.domains[ids[i]];
      var lists = [d.uiPurposes || [], d.engineCategories || [], [d.label]];
      for (j = 0; j < lists.length; j++) {
        if (lists[j].indexOf(key) >= 0) return ids[i];
      }
    }
    return 'general';
  }

  /* ---------- 盘面适配：转盘 / 飞盘 / 山向盘 schema 不同，统一取用 ---------- */
  function views(chart) {
    var c = chart || {};
    return {
      men: c.baMen || c.renPanMen || {},
      xing: c.jiuXing || c.tianPanXing || {},
      shen: c.baShen || c.tianPanShen || {},
      diShen: c.diPanShen || {},
      tianGan: c.tianPan || c.tianPanYi || {},
      diGan: c.diPan || {},
      anGan: c.anGan || c.renPanAnGan || c.tianPanAnGan || {}
    };
  }
  function findIn(map, name, loose) {
    for (var g in map) {
      var v = map[g];
      if (!v) continue;
      if (v === name) return String(g);
      // 九星可能作「禽芮」等合称，须包含匹配；仅对星名放开，避免干支误命中
      if (loose && String(v).indexOf(name.replace('天', '')) >= 0) return String(g);
    }
    return null;
  }
  function gongMeta(g, chart) {
    if (!g) return {};
    var v = views(chart), info = GONG_INFO[g] || {};
    var ja = (chart && chart.jiuGongAnalysis && chart.jiuGongAnalysis[g]) || {};
    return {
      gong: String(g),
      gongName: info.name || ja.gongName || '',
      direction: info.direction || ja.direction || '',
      tianGan: v.tianGan[g] || '',
      diGan: v.diGan[g] || '',
      anGan: v.anGan[g] || '',
      men: v.men[g] || '',
      xing: v.xing[g] || '',
      shen: v.shen[g] || '',
      kongWang: !!(chart && chart.kongWangGong && chart.kongWangGong.map(String).indexOf(String(g)) >= 0),
      yiMa: !!(chart && chart.maStar && String(chart.maStar.gong) === String(g))
    };
  }

  /**
   * 定位单个用神元素落宫。返回 null 表示盘上无此元素（如中宫寄、甲不上天盘），
   * 调用方须如实呈现"未见"，不得代为编造。
   */
  function locate(chart, name, actors) {
    if (!chart || !name) return null;
    var v = views(chart), g = null, kind = null, resolved = name;

    if (name === '日干' || name === '时干') {
      var gan = name === '日干' ? (actors && actors.riGan) : (actors && actors.shiGan);
      if (!gan) return null;
      resolved = gan;
      kind = 'gan';
      // 甲不上天盘，遁于旬首，通行以值符落宫论
      if (gan === '甲') {
        g = String(chart.zhiFuLuoGong || chart.zhiFuGong || '');
        if (!g) return null;
        var m0 = gongMeta(g, chart);
        // resolved 必须是**纯干**：它要用来查 symbols.json。写成「甲(遁旬首)」会查不到，
        // 导致日干为甲时（约 1/10 的日子）求测人自身的象义整个漏出提示词。
        // 「遁于旬首」的说明由 via 承载，二者各司其职。
        m0.name = name; m0.kind = kind; m0.resolved = '甲';
        m0.via = '甲不上天盘，遁于旬首，以值符落宫论';
        return m0;
      }
      g = findIn(v.tianGan, gan) || findIn(v.diGan, gan) || findIn(v.anGan, gan);
    } else if (name === '值使') {
      // 值使门由引擎直接给出宫位，不另行推算
      g = chart.zhiShiGong != null ? String(chart.zhiShiGong) : null;
      kind = 'men';
      resolved = chart.zhiShiMen || '值使';
    } else if (name === '值符' && !findIn(v.shen, '值符')) {
      // 飞盘/部分盘八神中无「值符」时，退回值符星落宫
      g = chart.zhiFuLuoGong != null ? String(chart.zhiFuLuoGong) : (chart.zhiFuGong != null ? String(chart.zhiFuGong) : null);
      kind = 'shen';
      resolved = chart.zhiFuXing || '值符';
    } else if (name.length === 2 && name.charAt(1) === '门') {
      g = findIn(v.men, name); kind = 'men';
    } else if (name.charAt(0) === '天' && name.length === 2) {
      g = findIn(v.xing, name) || findIn(v.xing, name, true); kind = 'xing';
    } else if (GAN.indexOf(name) >= 0) {
      g = findIn(v.tianGan, name) || findIn(v.diGan, name) || findIn(v.anGan, name); kind = 'gan';
      // 甲三盘皆无（甲不上天盘，遁于旬首），若直接返回 null，则凡以甲为用神者——
      // 类象取甲为「栋梁/首领」断老板、领导——一律落得「盘上未见」，等于白取。
      // 纲要既已明言「以值符落宫论」，此处与上面日干为甲一路同样处理，非新造断法。
      if (!g && name === '甲') {
        g = String(chart.zhiFuLuoGong || chart.zhiFuGong || '');
        if (!g) return null;
        var mJia = gongMeta(g, chart);
        mJia.name = name; mJia.kind = 'gan';
        mJia.via = '甲不上天盘，遁于旬首，以值符落宫论';
        return mJia;
      }
    } else {
      g = findIn(v.shen, name) || findIn(v.diShen, name); kind = 'shen';
    }
    if (!g) return null;
    var meta = gongMeta(g, chart);
    meta.name = name; meta.kind = kind;
    if (resolved !== name) meta.resolved = resolved;
    return meta;
  }

  function dedupe(arr) {
    var out = [], i;
    for (i = 0; i < arr.length; i++) if (arr[i] && out.indexOf(arr[i]) < 0) out.push(arr[i]);
    return out;
  }

  /**
   * 主入口。
   * @param {object} args {domain, chart, options}
   *   options.engineYong —— 引擎 prompt.context.yong（或 classifyQuestion 结果），原样保留。
   *   options.school     —— 可选，缺省时依盘面自动判定。
   * @returns {object} 确定性结果；domainRule / engineRule / examine 三者分列，不含任何吉凶结论。
   */
  function resolve(args) {
    args = args || {};
    var chart = args.chart || null;
    var options = args.options || {};
    var id = normalizeDomain(args.domain);
    var d = getDomain(id) || { name: id, label: '', yongshen: {}, priority: [], relevantSymbols: {} };
    var ys = d.yongshen || {};
    var school = options.school || detectSchool(chart);

    var sz = (chart && chart.siZhu) || {};
    var actors = {
      riGan: (sz.day || '').charAt(0) || '',
      shiGan: (sz.time || '').charAt(0) || '',
      nianMingGan: options.nianMingGan || ''
    };

    /* ---------- ① 占类用神：严格等于 domains.json，任何情况下都不被改写 ---------- */
    var domainRule = {
      self: dedupe(ys.self || []),
      primary: dedupe(ys.primary || []),
      secondary: dedupe(ys.secondary || []),
      opponent: dedupe(ys.opponent || [])
    };
    var domainNames = dedupe([].concat(domainRule.self, domainRule.primary, domainRule.secondary, domainRule.opponent));

    /* ---------- ② 引擎用神：原样保留，不重算、不覆盖 ---------- */
    var engineRule = null, engineNames = [];
    var ey = options.engineYong;
    if (ey) {
      // 注意两种形态：classifyQuestion() 给 .yongshen[{kind,name}]；
      // buildPrompt().context.yong 给 .located[{name,kind,gong,...}]（不含 .yongshen）。二者都要认。
      var fromYs = (ey.yongshen || []).map(function (x) { return x && x.name; }).filter(Boolean);
      var fromLoc = (ey.located || []).map(function (x) { return x && x.name; }).filter(Boolean);
      engineNames = dedupe(fromYs.concat(fromLoc));
      engineRule = {
        category: ey.category || '',
        note: ey.note || '',
        matched: !!ey.matched,
        yongshen: engineNames,
        located: (ey.located || []).slice()   // 引擎自己算的落宫，逐条原样保留
      };
    }

    /* ---------- ③ 裁定：谁说了算 ---------- */
    var appliesTo = (DB && DB.appliesTo) || ['zhuanpan'];
    var neutral = (DB && DB.schoolNeutral) || [];
    var schoolMatch = appliesTo.indexOf(school) >= 0;
    var excluded = [], reason;

    if (engineRule && engineRule.matched) {
      reason = '引擎已按问句/占类识别出本盘用神，属针对性规则，优先于通用占类映射。';
    } else if (engineRule) {
      reason = '引擎未匹配到特定占类（综合类），改由占类映射提供查看范围。';
    } else {
      reason = '未提供引擎用神，仅按占类映射提供查看范围。';
    }
    var authority = (engineRule && engineRule.matched) ? 'engine' : 'domain';

    // 零串味：domains.json 取用源自转盘，遇飞盘时不得套用。
    // 仅保留 ①引擎自己算出的用神 ②盘面结构性元素(值符/值使/时干)。
    if (!schoolMatch) {
      domainNames.forEach(function (n) {
        if (engineNames.indexOf(n) < 0 && neutral.indexOf(n) < 0) {
          excluded.push({ name: n, from: 'domains.json', reason: 'domains.json 取用源自转盘传统，' + school + '盘另有取用体系，按零串味原则排除' });
        }
      });
      reason += ' 又因本盘为' + school + '、而占类映射仅适用于 ' + appliesTo.join('/') + '，其专属取用已排除。';
    }
    var excludedNames = excluded.map(function (x) { return x.name; });

    /* ---------- ④ 最终查看清单：归并并标注来源 ---------- */
    var order = dedupe(
      engineNames                                                   // 引擎用神最先
        .concat((d.priority || []).filter(function (n) { return domainNames.indexOf(n) >= 0; }))
        .concat(domainNames)
    ).filter(function (n) { return excludedNames.indexOf(n) < 0; });

    var examine = [], missing = [];
    if (chart) {
      order.forEach(function (n) {
        var m = locate(chart, n, actors);
        var inEng = engineNames.indexOf(n) >= 0;
        var inDom = domainNames.indexOf(n) >= 0 && excludedNames.indexOf(n) < 0;
        var origin = (inEng && inDom) ? 'both' : (inEng ? 'engine' : 'domain');
        if (m) { m.origin = origin; examine.push(m); }
        else missing.push({ name: n, origin: origin });
      });
    }

    // 引擎与占类映射对同一角色给出不同元素时留痕，供人工校订（不自动取舍）
    var conflicts = [];
    if (engineRule && engineRule.matched && schoolMatch) {
      var domOnly = domainNames.filter(function (n) { return engineNames.indexOf(n) < 0 && n !== '日干'; });
      if (domOnly.length) conflicts.push({ type: 'domain-extra', names: domOnly, note: '占类映射额外指出的查看点，引擎未取；作为补充视角，不覆盖引擎判定。' });
      var engOnly = engineNames.filter(function (n) { return domainNames.indexOf(n) < 0; });
      if (engOnly.length) conflicts.push({ type: 'engine-extra', names: engOnly, note: '引擎针对本盘取用而占类映射未列；以引擎为准。' });
    }

    return {
      domain: id,
      label: d.label || '',
      school: school,
      domainRule: domainRule,
      engineRule: engineRule,
      resolution: { authority: authority, reason: reason, conflicts: conflicts, excluded: excluded },
      examine: examine,
      missing: missing,
      actors: actors,
      relevantSymbols: d.relevantSymbols || {},
      methodNote: d._methodNote || '',
      source: 'domain-rule'
    };
  }

  return {
    load: load, isLoaded: isLoaded,
    domainIds: domainIds, getDomain: getDomain,
    normalizeDomain: normalizeDomain,
    detectSchool: detectSchool, toEngineCategory: toEngineCategory,
    locate: locate, gongMeta: gongMeta,
    GONG_INFO: GONG_INFO,
    resolve: resolve
  };
});
