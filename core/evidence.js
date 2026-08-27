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
      answers: r.answers || '', answersNote: r.answersNote || '',
      element: scope === 'combination' ? (r.elements || []).join('+')
        : scope === 'relation' ? (r.fromLabel + '→' + r.toLabel) : r.on,
      // 关系条目的 element 已含双方角色名，再补 aspect 会重复
      aspect: scope === 'relation' ? '' : (r.aspect || ''),
      trigger: r.trigger || '',
      revised: r.revised || '',
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
    var lx = (args.leixiang && args.leixiang.version) ? args.leixiang : null;
    var sv = (args.severity && args.severity.version) ? args.severity : null;
    var cv = (args.converge && args.converge.version) ? args.converge : null;
    var yj = (args.yinju && args.yinju.version) ? args.yinju : null;
    var gj = (args.geju && args.geju.version) ? args.geju : null;
    var sg = (args.shige && args.shige.version) ? args.shige : null;
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
      // 类象用神落宫（Phase 8）。所问的具体人事物本身也要有代表，否则解读永远只在
      // 值符值使日干时干几个宫里打转——纲要二节表尾「人/物/事各取对应符号」正是此意。
      if (lx && lx.applicable) {
        lx.candidates.forEach(function (c) {
          items.push(fact('【类象用神·' + c.provenance + '】' + c.symbol + '(' + c.matched + ')＝所问「' +
            c.terms.join('/') + '」' +
            (c.located ? ' 落 ' + c.gong + '宫' + (c.gongName || '') + (c.direction ? '·' + c.direction : '') +
              (c.resolved && c.resolved !== c.symbol ? '（' + c.resolved + '）' : '')
              : ' —— 此象盘上未见，不得代为安置落宫'),
            'leixiang:' + c.symbol));
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
    // 类象用神同样要有象义可读：只给「辛＝金刃/首饰」四个字，模型断不出它落宫是何情状。
    // 象义仍从 symbols.json 取，与占类用神走同一条路，不另开一套。
    if (lx && lx.applicable) {
      lx.candidates.forEach(function (c) {
        var cat = KIND_TO_CAT[c.kind];
        if (cat) addSymbol(cat, c.resolved && cat === 'tiangan' ? c.resolved : c.symbol);
        if (c.gong) addSymbol('jiugong', c.gong);
      });
    }

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

    /* ---------- TIMING：应期锚点（Phase 4；v5 起每条带时/日/月/年四级读法） ---------- */

    if (tm && tm.applicable) {
      (tm.anchors || []).slice(0, MAX_TIMING_ITEMS).forEach(function (a) {
        items.push({
          type: 'TIMING', source: 'core/timing.js（干支取自 core/yingqi.js，未另推）',
          id: a.id, mechanism: a.mechanism, label: a.label,
          value: a.value, kind: a.kind, gong: a.gong,
          strength: a.strength, weight: a.weight, offset: a.offset,
          targets: (a.targets || []).map(function (t) {
            // 类象用神的锚点要标明白：不标，模型看不出「这个日子是冲着所问那件东西来的」
            return t.name + (t.leixiang ? '〔类象·所问「' + (t.terms || []).join('/') + '」〕' : '');
          }),
          // v5：同一干支在时/日/月/年四级各读一次，并标明哪一级是机制原文所许、哪一级由「远近」推及
          reads: (a.reads || []).filter(function (r) { return r.offset != null; }).map(function (r) {
            return { unit: r.unit, label: r.label, window: r.window, when: r.when, source: r.source };
          }),
          nativeUnits: (a.nativeUnits || []).slice(),
          content: [a.note || a.display],
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
        safetyNote: xy.safetyNote || '', revisions: xy.revisions || null,
        focus: xy.focus, absent: xy.absent, tally: xy.tally, degraded: xy.degraded, notes: xy.notes
      } : null,
      // 应期层元信息。锚点本身在 items(TIMING) 中，此处记时间线次序、迟速与数字。
      timing: tm ? {
        version: tm.version, applicable: tm.applicable, reason: tm.reason,
        dayZhi: tm.dayZhi, dayGan: tm.dayGan, targetSource: tm.targetSource,
        timeline: (tm.timeline || []).map(function (a) {
          return { value: a.value, mechanism: a.mechanism, offset: a.offset, strength: a.strength };
        }),
        byUnit: tm.byUnit, units: tm.units,
        pace: tm.pace, horizon: tm.horizon, numbers: tm.numbers, notes: tm.notes
      } : null,
      // 证据合流层元信息：各维度有几路独立证据、哪些维度证据不足须弃权。
      converge: cv ? {
        version: cv.version, applicable: cv.applicable, reason: cv.reason,
        dimensions: cv.dimensions, abstained: cv.abstained
      } : null,
      // 伏吟／反吟层元信息。局与宫分列，两级出处随条附上。
      yinju: yj ? {
        version: yj.version, school: yj.school, ju: yj.ju, layers: yj.layers,
        timing: yj.timing, notes: yj.notes
      } : null,
      // 时格层元信息（五不遇时／天显时格）。分量随条带出——「增加几率」不是「必然如此」。
      shige: sg ? {
        version: sg.version, riGan: sg.riGan, shiGan: sg.shiGan,
        dayPillar: sg.dayPillar, timePillar: sg.timePillar, hits: sg.hits, notes: sg.notes
      } : null,
      // 八十一格层元信息。focus/rest 分列，引擎异名随条附上。
      geju: gj ? {
        version: gj.version, focus: gj.focus, rest: gj.rest, notes: gj.notes,
        provenance: gj.provenance || null
      } : null,
      // 力量校验层元信息。findings 是纲要的硬禁令，提示词里另起一段前置呈现。
      severity: sv ? {
        version: sv.version, applicable: sv.applicable, reason: sv.reason,
        thresholds: sv.thresholds, findings: sv.findings, verdict: sv.verdict,
        mustDo: sv.mustDo, gongs: sv.gongs
      } : null,
      // 类象取用层元信息。候选本身也进了 FACT，此处记出处与未匹配时的交代。
      leixiang: lx ? {
        version: lx.version, applicable: lx.applicable, school: lx.school, reason: lx.reason,
        candidates: lx.candidates, unmatched: lx.unmatched, fallbackNote: lx.fallbackNote,
        bagua: lx.bagua ? { basis: lx.bagua.basis } : null, notes: lx.notes
      } : null,
      items: items,
      combined: combine(examineOrdered, domain)
    };
  }

  /** 证据包 → 提示词文本块。坏数据返回空串，绝不阻断解读流程。 */
  function toPromptBlock(ev) {
    if (!ev || !ev.items || !ev.items.length) return '';
    var L = [], facts = [], rules = [], syms = [], times = [], cals = [], ansNotes = [];
    var reads = { condition: [], combination: [], relation: [] };
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
        times.push('  - [' + (STR[x.strength] || '') + '] ' + x.label + '：' + x.value +
          (x.gong ? '　(' + x.gong + '宫)' : '') +
          (x.targets.length ? '　用神：' + x.targets.join('、') : '　（非用神宫）') +
          (x.content.length ? '　—— ' + x.content.join('') : ''));
        // 四级读法另起一行。〔推及〕＝该法原文只写了日，这一级是由「近事看日时、中事看月、
        // 远事看年」推来的——标出来，才不至于把断法悄悄推广到纲要没说的地方。
        var rs = (x.reads || []);
        if (rs.length) {
          times.push('      ' + rs.map(function (r) {
            var bits = [];
            if (r.window) bits.push(r.window);
            if (r.when) bits.push(r.when);
            return r.label + (r.source === 'native' ? '' : '〔推及〕') + (bits.length ? '(' + bits.join('，') + ')' : '');
          }).join(' ｜ '));
        }
      }
      else if (x.type === 'READING' && reads[x.scope]) {
        var revMark = x.revised ? '〔本机修订·' + (x.revised === 'mute' ? '停用' : x.revised === 'narrow' ? '已收窄' : '已调权') + '〕' : '';
        if (x.answersNote && ansNotes.indexOf(x.answersNote) < 0) ansNotes.push(x.answersNote);
        var ansMark = x.answers ? '〔只答：' + x.answers + '〕' : '';
        reads[x.scope].push('  - [' + (POL[x.polarity] || '中') + '] ' + revMark + ansMark + x.element +
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
      // 类象用神紧跟占类用神：这两段必须挨着，模型才知道「用神」不止值符值使日干时干那几个。
      // 放到证据包尾部就晚了——那时它已经按占类用神把逐宫详析写完了。
      var lxi = ev.leixiang;
      if (lxi && lxi.school === 'zhuanpan') {
        if (lxi.applicable) {
          L.push('· 类象用神（**所问的具体人事物本身也要取一个用神**，与上面的占类用神并列合参，不相取代）：');
          lxi.candidates.forEach(function (c) {
            L.push('  - ' + c.symbol + '（' + c.matched + '）＝所问「' + c.terms.join('/') + '」' +
              (c.located ? '，落 ' + c.gong + '宫' + (c.gongName || '') + (c.direction ? '·' + c.direction : '') : '') +
              (c.inDomain ? '　〔已在占类用神之列〕' : '') +
              '　〔' + c.provenance + '〕' + (c.why ? c.why + '。' : '') +
              '　本象类象：' + c.words.join('/') +
              (c.locateNote ? '　⚠ ' + c.locateNote : ''));
          });
          L.push('  依据：转盘纲要·二节用神取用表尾「衍象类象：人/物/事各取对应符号(见第四节)，' +
            '落宫定方位、临神临门定性质」；失物一条「玄武(盗) + **用神类象** + 年命……类象定物，方位定处」。');
          L.push('  〔纲要原文〕＝所问之词就是纲要写的那个类象词，可直接取用；' +
            '〔本层归类〕＝是本应用把这个词归入纲要那一类（如钥匙归入「金刃/首饰」），可用，' +
            '但断语中须写明是按此类归的，不要说成纲要原文如此。');
          L.push('  取用之后照常断：该象落宫之星门神干、旺衰四害、与年命/日干的生克盗泄。' +
            '「用神与关键宫位逐宫详析」一节**必须把这些类象用神的落宫也逐一展开**，' +
            '不得只写值符、值使、日干宫、时干宫。');
        } else if (lxi.unmatched) {
          L.push('· 类象用神：本次未在索引中匹配到类象词。' + lxi.fallbackNote);
        }
        if (lxi.bagua) L.push('  若要定物之形色质类（射覆一路），再看用神落宫的八卦类象：' + lxi.bagua.basis);
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
    /* ---------- 力量校验：必须排在 FACT / READING 之前 ----------
     * 实测教训：这几条禁令若放在包尾，模型读到时早已按「引擎判小吉」写完了「有转机」。
     * 纲要把称量力量列为解读流程的 3.5 步（必做），本段就是那一步的产物。 */
    var svi = ev.severity;
    if (svi && svi.applicable && svi.findings && svi.findings.length) {
      var SMARK = { critical: '‼', high: '⚠', medium: '·' };
      L.push('· 【力量校验·先看这一段】纲要把这件事写得很死：**吉凶定方向，旺衰定成败大小；' +
        '不可只看吉凶不看旺衰**。下列是本盘触发的**禁令**——不是叫你断凶，是这几种说法纲要不许下：');
      svi.findings.forEach(function (f) {
        L.push('  ' + (SMARK[f.severity] || '·') + ' [' + f.check + '] ' + f.gong + '宫（' + f.roles.join('、') + '）：' + f.detail);
        L.push('      → ' + f.verdict + '。' + f.prohibition);
      });
      if (svi.verdict) {
        L.push('  整盘口径：关注宫 ' + svi.verdict.total + ' 处，其中 ' + svi.verdict.impaired + ' 处已受重折' +
          (svi.verdict.impairedGongs.length ? '（' + svi.verdict.impairedGongs.join('、') + '宫）' : '') +
          '。' + svi.verdict.note);
      }
      (svi.mustDo || []).forEach(function (m) { L.push('  · ' + m); });
      var svb = [];
      svi.findings.forEach(function (f) { if (svb.indexOf(f.basis) < 0) svb.push(f.basis); });
      L.push('  依据：' + svb.join(' ／ '));
    } else if (svi && !svi.applicable && svi.reason) {
      L.push('· 力量校验：' + svi.reason);
    }

    /* ---------- 证据合流：与力量校验同样前置 ----------
     * 「有几路互不相干的证据指向同一结论」必须在模型动笔之前摆出来，否则它会先挑一个
     * 看着顺眼的孤证写成结论，再回头给它找理由。 */
    var cvi = ev.converge;
    if (cvi && cvi.applicable && cvi.dimensions.length) {
      L.push('· 【证据合流·先看这一段】数的是「有几路**互不相干**的证据指向同一结论」，不是象义多少。' +
        '同一元素的多个别名只算**一路**。');
      L.push('  档位：**A级**（≥3 路）可写进结论；**B级**（2 路或多路相争）可作次要可能，须并列写出；' +
        '**C级**（孤证或两路相争）只能标「参考」；**D级**（无据或自相矛盾）**不得出现在结论里**。');
      cvi.dimensions.forEach(function (d) {
        L.push('  · ' + d.label + (d.contested ? '　⚠ 两说相争' : '') + '：' +
          d.candidates.map(function (c) {
            return '[' + c.tierLabel + '｜' + c.independent + '路] ' + c.value +
              (c.contested ? '(与「' + c.contestedBy + '」相争·已降档)' : '') +
              '←' + c.sources.map(function (s) { return s.show; }).join('/');
          }).join('　；　'));
      });
      if (cvi.abstained && cvi.abstained.length) {
        L.push('  ⚠ **本次须弃权的维度**（证据不足，不得硬编一个具体说法）：' +
          cvi.abstained.map(function (a) { return a.dim + '（' + a.why + '）'; }).join('；'));
        L.push('  这几项请照实写「证据不足，不锁定」，**不要凭一条孤证编出一个确指**——' +
          '实测里最伤的一次就是凭「离九＝明亮处」一条孤证断成「正南明亮处、炉灶电器旁」，' +
          '而实物在床下、被衣物压住。');
      }
    }

    /* ---------- 伏吟／反吟：与前两段同样前置 ----------
     * 「事动不动」是断成败与断应期共同的前提：伏吟主静则久拖，反吟主动则反复。
     * 若排在包尾，模型早已按别的线索写完了「近日可成」。 */
    var yji = ev.yinju;
    if (yji && yji.layers && yji.layers.length) {
      L.push('· 【伏吟／反吟·先看这一段】判的是「事动不动」，不是吉凶。' +
        '伏吟主静——事在原处不动、久拖难成；反吟主动——动荡反复、速而不久。' +
        '**下列各条已逐条标明出处等级，〔纲要原文〕与〔用户所定〕不可等同看待。**');
      (yji.ju || []).forEach(function (j) {
        L.push('  ‼ **' + j.name + '**（全盘之象，笼罩通篇）：' + j.test);
        L.push('      据：' + j.basedOn.map(function (b) {
          return b.name + '（' + b.checkable + ' 宫中 ' + b.count + ' 宫：' + b.gongs.join('、') + '）';
        }).join(' ＋ '));
        L.push('      义：' + j.meaning);
        L.push('      〔' + j.provenance.level + '〕' + j.provenance.text);
      });
      function yjLine(i) {
        L.push('  · ' + i.name + '（' + i.scopeLabel + '）：' + i.test +
          '　' + i.checkable + ' 宫中 ' + i.count + ' 宫（' + i.gongs.join('、') + '）');
        L.push('      义：' + i.meaning);
        L.push('      〔' + i.provenance.level + '〕' + i.provenance.text);
      }
      // 星／门两层：已并入局者不再单列（同一件事不说两遍），未成局者另节并警其不得以局论
      var sm = (yji.layers || []).filter(function (i) {
        return (i.layer === 'xing' || i.layer === 'men') && !(yji.ju || []).some(function (j) {
          return j.kind === i.kind && i.scope === 'full';
        });
      });
      if (sm.length) {
        L.push('  ▍星门之吟未成局（**不得以局论**——局须星、门俱全，此处只在所命中之宫上说）：');
        sm.forEach(yjLine);
      }
      // 干层是干加干之格，本就不参与局，另节列出免得与「未成局」混为一谈
      var gan = (yji.layers || []).filter(function (i) { return i.layer === 'gan'; });
      if (gan.length) {
        L.push('  ▍干加干之格（**不参与局的判定**，局只论星门；此层按宫论）：');
        gan.forEach(yjLine);
      }
      (yji.timing || []).forEach(function (tt) {
        L.push('  ▍应期联动：' + (tt.effect === 'raise'
          ? '伏吟主静，静中以马星为动机，故「' + tt.target + '」一条锚点在本盘升为**高**。'
          : tt.text));
        L.push('      〔' + tt.provenanceLevel + '〕' + (tt.why || ''));
      });
      L.push('  ※ 本层只给倾向与出处，**不下吉凶断语**；成败仍须结合用神、旺衰与全盘。');
    }

    /* ---------- 八十一格：紧随吟局，同样前置 ----------
     * 引擎早就认得格名，却只把四个字裸露在宫格行里。模型看见「日奇伏吟」
     * 而不知其义，等于没给。此段把名与断语一并摆出。 */
    var gji = ev.geju;
    if (gji && (gji.focus.length || gji.rest.length)) {
      L.push('· 【八十一格（干加干）】格名与断语出自用户所供之 81 格表。' +
        '**格之名不等于宫之吉凶**——宫位吉凶另由引擎给出，二者分开看，不得混为一谈。');
      gji.focus.forEach(function (i) {
        L.push('  · ' + i.gong + '宫' + (i.gongName ? '(' + i.gongName + ')' : '') +
          (i.roles.length ? '〔' + i.roles.join('、') + '〕' : '') +
          '　天盘' + i.tianGan + ' 加 地盘' + i.diGan + ' —— **' + i.name + '**' +
          (i.engineName ? '（引擎作「' + i.engineName + '」，两说并存）' : ''));
        L.push('      ' + i.text + (i.gongJiXiong ? '　｜　该宫吉凶(引擎)：' + i.gongJiXiong : ''));
      });
      if (gji.rest.length) {
        L.push('  · 其余各宫：' + gji.rest.map(function (i) {
          return i.gong + '宫' + i.tianGan + '加' + i.diGan + '「' + i.name + '」';
        }).join('　'));
      }
      L.push('  〔' + (gji.provenance && gji.provenance.level || '用户所供 81 格表') + '〕' +
        (gji.provenance && gji.provenance.text || ''));
      (gji.notes || []).forEach(function (nt) { L.push('  ※ ' + nt); });
    }

    /* ---------- 时格：五不遇时／天显时格 ----------
     * 与前几段不同，这一段是**倾向**不是禁令。分量必须随条写死，
     * 否则「增加几率」会被读成「必然如此」——那正是这类传统说法最容易被用坏的地方。 */
    var sgi = ev.shige;
    if (sgi && sgi.hits && sgi.hits.length) {
      var SGM = { tendency: '倾向', weak: '**分量很轻**' };
      L.push('· 【时格】' + sgi.dayPillar + '日 ／ ' + sgi.timePillar + '时' +
        '　—— 出的是**几率上的倾向，不是禁令，也不是定论**。');
      sgi.hits.forEach(function (h) {
        L.push('  · **' + h.name + '**（' + h.test + '）：' + h.detail);
        L.push('      义：' + h.meaning + '　【' + (SGM[h.strength] || h.strength) + '】');
        L.push('      用法：' + h.howToUse);
        L.push('      〔' + h.provenance.level + '〕' + h.provenance.text);
      });
      L.push('  ※ 本仓**从未测过**时格与实际应验率的关系（案例本未按时格分层），' +
        '故不得声称「此类盘更准／更不准」，也不得据时格调整你对自己判断的把握度。');
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
      // 本机修订须显式告知：标〔本机修订〕者已不是纯纲要判读，模型与用户都该知道
      if (xy && xy.revisions && xy.revisions.count) {
        L.push('  ⚠ 本次应用了 ' + xy.revisions.count + ' 条**本机经验修订**（修订集 ' + xy.revisions.hash +
          '）。修订只会收窄或降权，不会新造断法；标〔本机修订〕者即受其影响。' +
          '这些修订源自你自己的案例反推，**不是《解断方法纲要》**。');
      }
      // 实测里最常见的错不是规则错，是拿它去答了它不管的问题。故凡带范围限定的判读，
      // 把「它只答什么、不答什么、别的该看哪里」原样铺出来。
      if (ansNotes.length) {
        L.push('  ⚠ **断语范围**（〔只答：×〕者，其结论只落在×上，不得挪去答别的问题）：');
        ansNotes.forEach(function (n) { L.push('    · ' + n); });
      }
      if (xy && xy.notes && xy.notes.length) xy.notes.forEach(function (n) { L.push('  说明：' + n); });
    }
    if (times.length) {
      var tmi = ev.timing || {};
      L.push('· TIMING（应期锚点：干支取自上方 yingqi 同一组计算，此处只是筛过、定过强弱、排过序的那一份。' +
        '取期只在这些候选中选，不得自造日辰）：');
      // 远近必须摆在锚点**之前**：放在后面，模型读到时早已把每一条都当成「某日」断完了，
      // 远期之问（几个月后、哪一年）就永远得不到答案。
      if (tmi.horizon) {
        L.push('  · 【先定远近】本次缺省按「' + tmi.horizon.tier + '事」读（看 ' +
          (tmi.horizon.units || []).join('、') + ' 一级）。' + tmi.horizon.guidance);
        L.push('  ⚠ 这只是缺省——**先看用户问的是多远的事**：问这两天就断日与时辰，问这几个月就断月，' +
          '问哪一年就断年。同一批锚点按哪一级读，答案就落在哪一级，不要一律断成某日；' +
          '也不要因为用户问的是远事，就说「本盘只能断日」。');
        if (tmi.horizon.caution) L.push('  ⚠ ' + tmi.horizon.caution);
      }
      L = L.concat(times);
      L.push('  · 单位出处：无标记者＝该法在纲要里就写明了这一级（马星「之日/月」、转盘冲墓「之年月日时」、' +
        '飞盘远期暗干支「年/月/日时」），可直接照断；〔推及〕＝该法原文只写了日，这一级是由' +
        '「近事看日时、中事看月、远事看年」一条推来的——可用，但断语里要说清是按远近推的。');
      if (times.some(function (s) { return s.indexOf('干') >= 0 && /时干|月干|年干/.test(s); })) {
        L.push('  · 天干的称谓：「戊日」是纲要原有用语；时辰与月建以**地支**命名（午时、辰月），' +
          '天干在时/月/年三柱上只能说「该柱之干为某」，故写作「时干戊」「月干戊」「年干戊」——' +
          '断语中不要写成「戊时」「戊月」，那是生造的说法。');
      }
      if (tmi.timeline && tmi.timeline.length) {
        L.push('  先后次序（按日一级的位次；四柱各支逐位递进，故位次即该候选下次出现的真实距离，' +
          '但「候选何时再来」是历法事实，「事情是否应在那时」仍须据全盘定夺）：' +
          tmi.timeline.map(function (a) { return a.value + '(' + a.mechanism + (a.offset == null ? '' : '·第' + a.offset + '位') + ')'; }).join(' → '));
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
      // 分单位再铺一次：同一批候选按时/日/月/年各排一行，问远问近都能直接取用
      var UHEAD = {
        '时': '  若断时辰（同一日之内何时；近事必看这一级）：',
        '日': '  若断日：',
        '月': '  若断月（月建以节气分界，非农历朔望月）：',
        '年': '  若断年（年以立春分界，所标公历年为约数）：'
      };
      (tmi.units || []).forEach(function (u) {
        var list = (tmi.byUnit || {})[u] || [];
        if (!list.length) return;
        L.push((UHEAD[u] || ('  若断' + u + '：')) + list.slice(0, 8).map(function (r) {
          return r.label + (r.source === 'native' ? '' : '〔推及〕') +
            (r.window ? '(' + r.window + ')' : '') + (r.when ? ' ' + r.when : '');
        }).join('；'));
      });
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
