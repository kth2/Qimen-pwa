/**
 * 奇门·证据包(Evidence) core —— 纯函数、无副作用、可移植。
 *
 * 解决的问题：原先喂给 AI 的是一大段自然语言盘面文本，模型难以分辨「哪些是算出来的事实、
 * 哪些是应用给的规则、哪些是传统象义」，于是常把三者混为一谈，甚至自行补一套象义。
 * 本模块把送进提示词的内容拆成三类可核验的条目：
 *   FACT    —— 由排盘引擎算得的盘面事实（落宫、空亡、驿马等），模型不得改写。
 *   RULE    —— 应用内确定性分析（引擎吉凶/格局、wangshuai 旺衰、yingqi 应期、shanxiang 宅盘）。
 *   SYMBOL  —— 取自 knowledge/symbols.json 的**与占类无关**的通用象义，模型应优先采用而非自行发挥。
 *   READING —— 【Phase 2】取自 core/xiangyi.js 的**占类相关**象义判读：同一个「生门旺」，
 *              在求财是「财源有力」，在别的占类未必；SYMBOL 给原料，READING 给该占类下的读法。
 *   TIMING  —— 【Phase 4】取自 core/timing.js 的应期锚点：哪个日子、凭什么机制、对应哪个用神、
 *              先后如何。干支本身仍出自 yingqi，本项只是筛过、定过强弱、排过序的那一份。
 *   CALIBRATION —— 【Phase 5】本机案例统计出的经验。**与 READING 严格分列**：READING 是
 *              纲要怎么说（教义），CALIBRATION 是这台设备上历史反馈怎么显示（经验）。
 *              经验永不改写教义，只作为一条附注供模型权衡详略；样本量必须随条呈现。
 *
 * 关键边界：
 *   ① **只收录用神相关元素**的象义，绝不把整个知识库倾倒进提示词（有单测把关体积与条目数）。
 *   ② 不产出吉凶结论——证据是给模型推理用的材料，判断仍归模型 + 引擎既有判定。
 *      READING 的 polarity 只表示该条对本占类是助力/阻力，不是成败断语。
 *   ③ 未传入的分析结果一律缺席，不凭空补条目（宁缺勿造）。未传 xiangyi 时行为与 Phase 1 完全一致。
 *
 * 数据来源：knowledge/symbols.json（须先 load() 注入）；READING 由调用方传入 xiangyi 结果，
 * 本模块不自行求值，以免与 xiangyi.js 产生两套规则。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Evidence = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KB = null;
  var VERSION = '2.0.0';
  // 每个元素最多送几条象义。过多会稀释提示词、挤占盘面事实的注意力。
  var MAX_WORDS_PER_ELEMENT = 12;
  var MAX_SYMBOL_ITEMS = 24;
  var MAX_READING_ITEMS = 32;
  var MAX_TIMING_ITEMS = 12;
  var MAX_CALIBRATION_ITEMS = 10;
  // 元素类别 → 知识库分类
  var KIND_TO_CAT = { men: 'bamen', xing: 'jiuxing', shen: 'bashen', gan: 'tiangan', gong: 'jiugong' };

  function load(symbolsJson) {
    KB = symbolsJson && symbolsJson.version ? symbolsJson : null;
    return !!KB;
  }
  function isLoaded() { return !!KB; }

  /** 简单精确查表。查不到返回 null —— 上层据此如实略过，不得猜测。 */
  function getSymbol(category, name) {
    if (!KB || !category || !name) return null;
    var cat = KB[category];
    if (!cat || typeof cat !== 'object') return null;
    var hit = cat[String(name)];
    return hit || null;
  }

  function dedupe(arr) {
    var out = [], i;
    for (i = 0; i < arr.length; i++) if (arr[i] && out.indexOf(arr[i]) < 0) out.push(arr[i]);
    return out;
  }
  function repeat(s, n) { var out = ''; for (var i = 0; i < n; i++) out += s; return out; }

  /**
   * 从一条象义记录中挑选送进提示词的词条。
   * 取用顺序：core → keywords → events → people → objects → places，按占类需要截断。
   * 挑选（而非全量）是刻意的：core/keywords 是最稳定的共识部分，越往后越易有流派差异。
   */
  function pickWords(sym, opts) {
    if (!sym) return { words: [], fields: [] };
    opts = opts || {};
    var buckets = ['core', 'keywords', 'events'];
    if (opts.wantPeople) buckets.push('people');
    if (opts.wantObjects) buckets.push('objects');
    if (opts.wantPlaces) buckets.push('places');
    if (opts.wantBody) buckets.push('body');
    var words = [], used = [];
    buckets.forEach(function (b) {
      if (Array.isArray(sym[b]) && sym[b].length) { used.push(b); words = words.concat(sym[b]); }
    });
    words = dedupe(words).slice(0, MAX_WORDS_PER_ELEMENT);
    // 只声明真正贡献了词条的栏位——截断后落空的栏位不算数，否则溯源会说谎
    var kept = used.filter(function (b) {
      return (sym[b] || []).some(function (w) { return words.indexOf(w) >= 0; });
    });
    return { words: words, fields: kept };
  }

  // 占类决定收哪几栏象义：失物要方位与物品，健康要身体，事业/求财要人与事。
  function bucketOptsFor(domain) {
    switch (domain) {
      case 'lost_item': return { wantObjects: true, wantPlaces: true };
      case 'health': return { wantBody: true, wantPeople: true };
      case 'relationship': return { wantPeople: true };
      case 'wealth': case 'career': case 'lawsuit': return { wantPeople: true };
      default: return { wantPeople: true, wantPlaces: true };
    }
  }

  function fact(content, ref) {
    var o = { type: 'FACT', source: 'chart', content: content };
    if (ref) o.ref = ref;
    return o;
  }
  function rule(source, content) { return { type: 'RULE', source: source, content: content }; }
  /** 占类象义判读条目。scope 区分 单象/组合/宫际，basis 必带出处，polarity 只表助/阻。 */
  function reading(r, scope) {
    return {
      type: 'READING', source: 'knowledge/domain-rules.json',
      id: r.id, scope: scope,
      element: scope === 'combination' ? (r.elements || []).join('+')
        : scope === 'relation' ? (r.fromLabel + '→' + r.toLabel) : r.on,
      // 关系条目的 element 已含双方角色名，再补 aspect 会重复
      aspect: scope === 'relation' ? '' : (r.aspect || ''),
      trigger: r.trigger || '',
      gong: r.gong || (r.fromGong ? r.fromGong + '→' + r.toGong : ''),
      weight: r.weight || 0,
      polarity: r.polarity || '0',
      content: (r.concept || []).slice(),
      basis: r.basis || ''
    };
  }
  function symbol(element, category, content, label, fields) {
    return {
      type: 'SYMBOL', source: 'knowledge/symbols.json',
      element: element, category: category,
      label: label || element,          // 九宫用「坤二宫」而非裸数字，提示词才读得通
      fields: fields || [],             // 溯源：这些词条取自知识库的哪几栏
      content: content
    };
  }

  function describeLocated(m) {
    var bits = [];
    bits.push(m.name + (m.resolved && m.resolved !== m.name ? '(' + m.resolved + ')' : '') +
      '落' + m.gong + '宫' + (m.gongName ? '(' + m.gongName + (m.direction ? '·' + m.direction : '') + ')' : ''));
    var pan = [];
    if (m.xing) pan.push('星' + m.xing);
    if (m.men) pan.push('门' + m.men);
    if (m.shen) pan.push('神' + m.shen);
    if (m.tianGan) pan.push('天盘' + m.tianGan);
    if (m.diGan) pan.push('地盘' + m.diGan);
    if (m.anGan) pan.push('暗干' + m.anGan);
    if (pan.length) bits.push('同宫：' + pan.join('/'));
    var marks = [];
    if (m.kongWang) marks.push('空亡');
    if (m.yiMa) marks.push('驿马');
    if (marks.length) bits.push('[' + marks.join('·') + ']');
    if (m.via) bits.push('（' + m.via + '）');
    return bits.join('　');
  }

  /**
   * 轻量象义组合：把用神落宫的「宫 + 门/星/神」几组关键词并成一份去重列表。
   * 刻意保持简单——不做符号图谱、不做语义检索，只给模型一个可直接引用的关键词池。
   */
  /**
   * 按占类权重给用神清单排序（Phase 2.2）。权重取自 xiangyi.focus；未登记者排在其后，
   * 相同权重保持 examine 原序（稳定排序）。截断 SYMBOL 时才不会先砍掉最该看的那个。
   * 未传 xiangyi 时原样返回，行为与 Phase 1 一致。
   */
  function orderByWeight(examine, xy) {
    if (!xy || !xy.focus || !xy.focus.length) return examine;
    var w = {};
    xy.focus.forEach(function (f) { w[f.name] = f.weight; });
    return examine.map(function (m, i) { return { m: m, i: i, w: w[m.name] || 0 }; })
      .sort(function (a, b) { return b.w !== a.w ? b.w - a.w : a.i - b.i; })
      .map(function (x) { return x.m; });
  }

  function combine(examine, domain) {
    var out = [];
    examine.slice(0, 4).forEach(function (m) {
      [
        getSymbol('jiugong', m.gong),
        getSymbol('bamen', m.men),
        getSymbol('jiuxing', m.xing),
        getSymbol('bashen', m.shen)
      ].forEach(function (s) {
        if (s) out = out.concat((s.core || []).slice(0, 3));
      });
    });
    return dedupe(out).slice(0, 20);
  }

  /**
   * 主入口。参数按仓库实际 API 适配：wangshuai/yingqi 传入的是各自 toPromptBlock() 的文本，
   * shanxiang 传入的是 pan.shanXiang 对象。缺任何一项都不影响其余部分。
   */
  function build(args) {
    args = args || {};
    var chart = args.chart || null;
    var ys = args.yongshen || null;
    var xy = (args.xiangyi && args.xiangyi.version) ? args.xiangyi : null;
    var tm = (args.timing && args.timing.version) ? args.timing : null;
    var domain = args.domain || (ys && ys.domain) || 'general';
    var items = [];
    // 用神清单按占类权重重排：SYMBOL 与关键词池皆据此取用，截断时先保重点
    var examineOrdered = (ys && ys.examine) ? orderByWeight(ys.examine, xy) : [];

    /* ---------- FACT：盘面事实 ---------- */
    if (chart) {
      var bi = chart.basicInfo || {}, sz = chart.siZhu || {};
      if (sz.day) {
        items.push(fact('四柱 ' + [sz.year, sz.month, sz.day, sz.time].filter(Boolean).join(' ') +
          (bi.date ? '（公历 ' + bi.date + '）' : ''), 'siZhu'));
      }
      if (chart.juShu && chart.juShu.fullName) {
        items.push(fact('局：' + chart.juShu.fullName + (chart.xunShou || chart.xunShouYi ? '　旬首' + (chart.xunShou || chart.xunShouYi) : ''), 'juShu'));
      }
      var zfg = chart.zhiFuLuoGong || chart.zhiFuGong;
      if (chart.zhiFuXing && zfg != null) items.push(fact('值符 ' + chart.zhiFuXing + ' 落 ' + zfg + '宫', 'zhiFu'));
      if (chart.zhiShiMen && chart.zhiShiGong != null) items.push(fact('值使 ' + chart.zhiShiMen + ' 落 ' + chart.zhiShiGong + '宫', 'zhiShi'));
      if (chart.kongWangGong && chart.kongWangGong.length) {
        items.push(fact('空亡宫：' + dedupe(chart.kongWangGong.map(String)).join('、') +
          (chart.kongWangZhi ? '（空亡支 ' + [].concat(chart.kongWangZhi).join('') + '）' : ''), 'kongWang'));
      }
      if (chart.maStar && chart.maStar.gong) {
        items.push(fact('驿马落 ' + chart.maStar.gong + '宫' + (chart.maStar.zhi ? '(' + chart.maStar.zhi + ')' : ''), 'maStar'));
      }
      // 用神落宫是本层最核心的 FACT：逐条写明，杜绝模型自行推测宫位
      if (ys && ys.examine) {
        ys.examine.forEach(function (m) {
          // 标注来源，模型才能分辨"引擎为本盘算出的"与"占类补充查看的"
          var tag = m.origin === 'engine' ? '引擎用神' : (m.origin === 'both' ? '用神·引擎+占类' : '占类参考');
          items.push(fact('【' + tag + '】' + describeLocated(m), 'yongshen:' + m.name));
        });
      }
      if (ys && ys.missing && ys.missing.length) {
        items.push(fact('盘上未见：' + ys.missing.map(function (x) { return x.name || x; }).join('、') +
          '（不得据此臆造落宫）', 'missing'));
      }
    }

    /* ---------- RULE：应用内确定性分析 ---------- */
    if (chart) {
      var eng = [], an = chart.analysis || {};
      // 键名依引擎实际输出：overallJiXiongText / bestGong（非 overall）
      if (an.overallJiXiongText) eng.push('引擎总体：' + an.overallJiXiongText);
      if (an.bestGong) eng.push('全盘最利宫：' + an.bestGong + '宫');
      if (Array.isArray(chart.geju) && chart.geju.length) {
        eng.push('格局：' + chart.geju.map(function (g) {
          return g.name + (g.gong ? '(' + g.gong + '宫)' : '') + (g.jiXiong ? '·' + g.jiXiong : '');
        }).join('、'));
      }
      var ja = chart.jiuGongAnalysis || {}, jaBits = [];
      for (var i = 1; i <= 9; i++) {
        var d = ja[i];
        if (d && d.jiXiongText) jaBits.push(i + '宫' + d.jiXiongText);
      }
      if (jaBits.length) eng.push('九宫吉凶：' + jaBits.join('、'));
      if (eng.length) items.push(rule('engine', eng.join('；')));
    }
    if (args.wangshuai) items.push(rule('wangshuai', typeof args.wangshuai === 'string' ? args.wangshuai : JSON.stringify(args.wangshuai)));
    if (args.yingqi) items.push(rule('yingqi', typeof args.yingqi === 'string' ? args.yingqi : JSON.stringify(args.yingqi)));
    if (args.shanxiang) {
      var sx = args.shanxiang;
      items.push(rule('shanxiang', typeof sx === 'string' ? sx :
        ('宅盘：坐' + ((sx.sitting && sx.sitting.name) || '?') + '向' + ((sx.facing && sx.facing.name) || '?') +
         '，定局据 ' + ((sx.juBasis && sx.juBasis.jieqi) || '?') + ((sx.juBasis && sx.juBasis.yuan) || ''))));
    }
    if (ys && ys.engineRule && ys.engineRule.note) {
      items.push(rule('engine-yongshen', '引擎占类「' + ys.engineRule.category + '」（权威取用：' +
        (ys.engineRule.yongshen.join('、') || '未取') + '）：' + ys.engineRule.note));
    }
    if (ys && ys.resolution && ys.resolution.excluded && ys.resolution.excluded.length) {
      items.push(rule('school-isolation', '因盘别隔离已排除下列取用（不得使用）：' +
        ys.resolution.excluded.map(function (x) { return x.name; }).join('、')));
    }
    if (ys && ys.methodNote) items.push(rule('domain-note', ys.methodNote));

    /* ---------- SYMBOL：仅用神相关元素的象义 ---------- */
    var opts = bucketOptsFor(domain), seen = {};
    function addSymbol(cat, name) {
      if (!name) return;
      var key = cat + ':' + name;
      if (seen[key]) return;
      var sym = getSymbol(cat, name);
      if (!sym) return;
      var picked = pickWords(sym, opts);
      if (!picked.words.length) return;
      seen[key] = true;
      items.push(symbol(name, cat, picked.words, sym.name || name, picked.fields));
    }
    examineOrdered.forEach(function (m) {
      // 用神元素本身
      var cat = KIND_TO_CAT[m.kind];
      if (cat) addSymbol(cat, m.resolved && cat === 'tiangan' ? m.resolved : m.name);
      // 其所落之宫（方位/场所之象，失物与风水尤需）
      addSymbol('jiugong', m.gong);
    });

    var symCount = items.filter(function (x) { return x.type === 'SYMBOL'; }).length;
    if (symCount > MAX_SYMBOL_ITEMS) {
      var kept = 0;
      items = items.filter(function (x) {
        if (x.type !== 'SYMBOL') return true;
        kept++; return kept <= MAX_SYMBOL_ITEMS;
      });
    }

    /* ---------- CALIBRATION：本机经验（Phase 5，不改教义、只作附注） ---------- */
    if (Array.isArray(args.calibration) && args.calibration.length) {
      args.calibration.slice(0, MAX_CALIBRATION_ITEMS).forEach(function (c) {
        items.push({
          type: 'CALIBRATION', source: '本机案例记录（非纲要，仅供权衡详略）',
          ruleId: c.ruleId, n: c.n, rate: c.rate, attribution: c.attribution,
          content: [c.note]
        });
      });
    }

    /* ---------- TIMING：应期锚点（Phase 4） ---------- */
    if (tm && tm.applicable) {
      (tm.anchors || []).slice(0, MAX_TIMING_ITEMS).forEach(function (a) {
        items.push({
          type: 'TIMING', source: 'core/timing.js（干支取自 core/yingqi.js，未另推）',
          id: a.id, mechanism: a.mechanism, label: a.label,
          value: a.value, kind: a.kind, gong: a.gong,
          strength: a.strength, weight: a.weight, offset: a.offset,
          targets: (a.targets || []).map(function (t) { return t.name; }),
          content: [a.display + (a.note ? '（' + a.note + '）' : '')],
          basis: a.basis, caution: a.caution || ''
        });
      });
    }

    /* ---------- READING：占类象义判读（Phase 2） ---------- */
    if (xy && xy.applicable) {
      var reads = []
        .concat((xy.readings || []).map(function (r) { return reading(r, 'condition'); }))
        .concat((xy.combinations || []).map(function (r) { return reading(r, 'combination'); }))
        .concat((xy.relations || []).map(function (r) { return reading(r, 'relation'); }));
      // 已在 xiangyi 内按权重排序，此处只做总量兜底
      items = items.concat(reads.slice(0, MAX_READING_ITEMS));
    }

    return {
      version: VERSION,
      domain: domain,
      label: (ys && ys.label) || '',
      question: args.question || '',
      category: (ys && ys.engine && ys.engine.category) || '',
      school: (ys && ys.school) || 'zhuanpan',
      // 三个概念分列呈现，绝不合成单一 yongshen 字段（Phase 1.1 审计结论）
      yongshen: ys ? {
        domain: ys.domainRule,        // 这类问题应该看什么（domains.json）
        engine: ys.engineRule,        // 引擎对本盘实际算出的用神（权威）
        resolution: ys.resolution,    // 谁说了算、为什么、排除了什么
        examine: ys.examine,          // 最终查看清单（逐条带 origin）
        missing: ys.missing,
        actors: ys.actors,
        source: ys.source
      } : null,
      // 占类象义层的元信息。判读条目本身在 items(READING) 中，此处只记「本层是否生效、为何」，
      // 便于在界面/控制台核对，也让"规则未建"与"盘上无碍"不至于被混为一谈。
      xiangyi: xy ? {
        version: xy.version, applicable: xy.applicable, status: xy.status, reason: xy.reason,
        safetyNote: xy.safetyNote || '',
        focus: xy.focus, absent: xy.absent, tally: xy.tally, degraded: xy.degraded, notes: xy.notes
      } : null,
      // 应期层元信息。锚点本身在 items(TIMING) 中，此处记时间线次序、迟速与数字。
      timing: tm ? {
        version: tm.version, applicable: tm.applicable, reason: tm.reason,
        dayZhi: tm.dayZhi, dayGan: tm.dayGan, targetSource: tm.targetSource,
        timeline: (tm.timeline || []).map(function (a) {
          return { value: a.value, mechanism: a.mechanism, offset: a.offset, strength: a.strength };
        }),
        pace: tm.pace, horizon: tm.horizon, numbers: tm.numbers, notes: tm.notes
      } : null,
      items: items,
      combined: combine(examineOrdered, domain)
    };
  }

  /** 证据包 → 提示词文本块。坏数据返回空串，绝不阻断解读流程。 */
  function toPromptBlock(ev) {
    if (!ev || !ev.items || !ev.items.length) return '';
    var L = [], facts = [], rules = [], syms = [], times = [], cals = [], reads = { condition: [], combination: [], relation: [] };
    var POL = { '+': '助', '-': '阻', '0': '中' };
    var STR = { high: '★强', medium: '★中', low: '★参考' };
    ev.items.forEach(function (x) {
      if (x.type === 'FACT') facts.push('  - ' + x.content);
      else if (x.type === 'RULE') rules.push('  - [' + x.source + '] ' + x.content);
      else if (x.type === 'SYMBOL') syms.push('  - ' + (x.label || x.element) + '：' + x.content.join('、'));
      else if (x.type === 'CALIBRATION') {
        cals.push('  - ' + x.ruleId + '：' + x.content.join('') );
      }
      else if (x.type === 'TIMING') {
        times.push('  - [' + (STR[x.strength] || '') + '] ' + x.label + '：' + x.content.join('') +
          (x.gong ? '　(' + x.gong + '宫)' : '') +
          (x.targets.length ? '　用神：' + x.targets.join('、') : '　（非用神宫）'));
      }
      else if (x.type === 'READING' && reads[x.scope]) {
        reads[x.scope].push('  - [' + (POL[x.polarity] || '中') + '] ' + x.element +
          (x.aspect ? '(' + x.aspect + ')' : '') + (x.gong ? '·' + x.gong + '宫' : '') +
          (x.trigger ? ' ' + x.trigger : '') +
          '：' + x.content.join('、') + '　（依据：' + x.basis + '）');
      }
    });
    L.push('');
    L.push('【结构化证据包 Evidence v' + ev.version + '　占类：' + ev.domain + (ev.label ? '(' + ev.label + ')' : '') + '】');
    L.push('· 盘别：' + (ev.school === 'feipan' ? '飞盘（括囊）' : '转盘') + '　—— 只按本派断法解读，不得引入另一派取用。');
    if (ev.yongshen) {
      var eng = ev.yongshen.engine, dom = ev.yongshen.domain, res = ev.yongshen.resolution;
      if (eng && eng.matched) {
        L.push('· 引擎用神（针对本盘算出，权威，不得另取）：' + (eng.yongshen.join('、') || '—') +
          '　[引擎占类：' + eng.category + ']');
      } else {
        L.push('· 引擎用神：本盘未匹配到特定占类，无专用用神。');
      }
      var excl = (res && res.excluded) ? res.excluded.map(function (x) { return x.name; }) : [];
      if (dom) {
        var live = function (a) { return (a || []).filter(function (n) { return excl.indexOf(n) < 0; }); };
        var self_ = live(dom.self), pri = live(dom.primary), sec = live(dom.secondary), opp = live(dom.opponent);
        if (self_.length + pri.length + sec.length + opp.length === 0) {
          // 全数被盘别隔离排除：不要把废弃取用摆到模型面前，否则等于变相提示
          L.push('· 占类用神：本盘为' + (ev.school === 'feipan' ? '飞盘' : ev.school) +
            '，而占类映射源自转盘传统，整体不适用，已停用。请只依引擎用神与本派纲要断。');
        } else {
          L.push('· 占类用神（补充查看范围，不得凌驾于引擎用神之上）：我方=' + (self_.join('、') || '—') +
            '；主=' + (pri.join('、') || '—') +
            '；辅=' + (sec.join('、') || '—') +
            '；对方/阻力=' + (opp.join('、') || '—'));
        }
      }
      if (res) {
        L.push('· 优先级裁定：以「' + (res.authority === 'engine' ? '引擎用神' : '占类用神') + '」为准。' + res.reason);
        if (res.excluded && res.excluded.length) {
          L.push('  （已按盘别隔离排除 ' + res.excluded.length + ' 项他派取用，不在本次可用范围内）');
        }
      }
    }
    // 占类关注点（权重）须排在 FACT 之前：先告诉模型"这一占该重点看谁"，再给材料
    var xy = ev.xiangyi;
    // 安全边界紧贴判读呈现（不止依赖提示词末尾的通用纪律），且本层停用时照样送达
    if (xy && xy.safetyNote) L.push('· ⚠ 本占类边界：' + xy.safetyNote);
    if (xy && xy.applicable && xy.focus && xy.focus.length) {
      L.push('· 本占类关注点与权重（★越多越应重点着墨，勿平均用力）：');
      xy.focus.forEach(function (f) {
        var marks = [];
        if (f.state) marks.push(f.state);
        (f.flags || []).forEach(function (k) { marks.push(k + ((f.flagWhy && f.flagWhy[k]) ? '(' + f.flagWhy[k] + ')' : '')); });
        L.push('  - ' + repeat('★', f.weight) + ' ' + f.name + (f.resolved ? '(' + f.resolved + ')' : '') +
          '＝' + (f.aspect || '?') + '：' + f.gong + '宫' + (f.gongName ? '(' + f.gongName + ')' : '') +
          (marks.length ? '　[' + marks.join('　') + ']' : ''));
      });
      if (xy.absent && xy.absent.length) {
        L.push('  （盘上未见，须按"未见"论：' + xy.absent.map(function (a) {
          return a.name + '(' + (a.aspect || '?') + ')';
        }).join('、') + '）');
      }
    } else if (xy && !xy.applicable && xy.status === 'pending') {
      L.push('· 本占类的象义规则尚未建成，无判读条目——这是「规则未建」而非「盘上无碍」，不得据此认定无阻。');
    }
    if (facts.length) { L.push('· FACT（引擎算得的盘面事实，不得改写）：'); L = L.concat(facts); }
    if (rules.length) { L.push('· RULE（应用确定性分析，优先于模型自身判断）：'); L = L.concat(rules); }
    if (syms.length) { L.push('· SYMBOL（知识库通用象义，与占类无关的原料；优先采用，可组合，不可替换为自创象义）：'); L = L.concat(syms); }
    if (reads.condition.length || reads.combination.length || reads.relation.length) {
      L.push('· READING（占类象义判读：本占类下这些符号该怎么读。已注明依据；[助]/[阻] 只表倾向，**不是成败断语**）：');
      if (reads.condition.length) { L.push('  单象（用神 × 旺衰/四害）：'); L = L.concat(reads.condition); }
      if (reads.combination.length) { L.push('  组合（同宫相遇，其义不等于两象相加）：'); L = L.concat(reads.combination); }
      if (reads.relation.length) { L.push('  宫际生克（定成败向背）：'); L = L.concat(reads.relation); }
      if (xy && xy.tally) {
        L.push('  倾向计数（**非结论**，只供权衡详略）：助 ' + xy.tally.support + ' 条／阻 ' +
          xy.tally.obstruct + ' 条／中性 ' + xy.tally.neutral + ' 条。');
      }
      if (xy && xy.notes && xy.notes.length) xy.notes.forEach(function (n) { L.push('  说明：' + n); });
    }
    if (times.length) {
      var tmi = ev.timing || {};
      L.push('· TIMING（应期锚点：干支取自上方 yingqi 同一组计算，此处只是筛过、定过强弱、排过序的那一份。' +
        '取期只在这些候选中选，不得自造日辰）：');
      L = L.concat(times);
      if (tmi.timeline && tmi.timeline.length) {
        L.push('  先后次序（同一循环内距今位次，仅表先到后到，非"几天后"之断言）：' +
          tmi.timeline.map(function (a) { return a.value + '日(' + a.mechanism + (a.offset == null ? '' : '·第' + a.offset + '位') + ')'; }).join(' → '));
      }
      if (tmi.pace) {
        L.push('  迟速：以 ' + tmi.pace.from + ' 落 ' + tmi.pace.gong + '宫' + tmi.pace.state +
          ' 论，应期偏「' + tmi.pace.speed + '」——' + tmi.pace.note);
      }
      if (tmi.numbers && tmi.numbers.length) {
        L.push('  用神宫河图数（定数量/号码优先取此）：' + tmi.numbers.map(function (n) {
          return n.gong + '宫天' + n.tianGan + '=' + n.tianNum + '、地' + n.diGan + '=' + n.diNum;
        }).join('；'));
      }
      if (tmi.horizon) L.push('  断日/断月/断年：' + tmi.horizon.guidance);
      var cau = [];
      ev.items.forEach(function (x) {
        if (x.type === 'TIMING' && x.caution && cau.indexOf(x.caution) < 0) cau.push(x.caution);
      });
      if (cau.length) L.push('  注意：' + cau.join(' '));
    }
    if (cals.length) {
      L.push('· CALIBRATION（**本机历史反馈统计，不是纲要**。它只说明这些规则在这台设备的既往记录中' +
        '符合得如何，可用于权衡着墨详略；**不得据此推翻 READING 的取用或倾向**，更不得当作断语依据。' +
        '样本量已随条标出，样本少则参考价值有限）：');
      L = L.concat(cals);
    }
    if (ev.combined && ev.combined.length) L.push('· 组合关键词池（供衍象取用）：' + ev.combined.join('、'));
    return L.join('\n');
  }

  return {
    load: load, isLoaded: isLoaded,
    getSymbol: getSymbol,
    build: build, toPromptBlock: toPromptBlock,
    VERSION: VERSION
  };
});
