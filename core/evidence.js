/**
 * 奇门·证据包(Evidence) core —— 纯函数、无副作用、可移植。
 *
 * 解决的问题：原先喂给 AI 的是一大段自然语言盘面文本，模型难以分辨「哪些是算出来的事实、
 * 哪些是应用给的规则、哪些是传统象义」，于是常把三者混为一谈，甚至自行补一套象义。
 * 本模块把送进提示词的内容拆成三类可核验的条目：
 *   FACT   —— 由排盘引擎算得的盘面事实（落宫、空亡、驿马等），模型不得改写。
 *   RULE   —— 应用内确定性分析（引擎吉凶/格局、wangshuai 旺衰、yingqi 应期、shanxiang 宅盘）。
 *   SYMBOL —— 取自 knowledge/symbols.json 的结构化象义，模型应优先采用而非自行发挥。
 *
 * 关键边界：
 *   ① **只收录用神相关元素**的象义，绝不把整个知识库倾倒进提示词（有单测把关体积与条目数）。
 *   ② 不产出吉凶结论——证据是给模型推理用的材料，判断仍归模型 + 引擎既有判定。
 *   ③ 未传入的分析结果一律缺席，不凭空补条目（宁缺勿造）。
 *
 * 数据来源：knowledge/symbols.json（须先 load() 注入）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Evidence = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KB = null;
  var VERSION = '1.0.0';
  // 每个元素最多送几条象义。过多会稀释提示词、挤占盘面事实的注意力。
  var MAX_WORDS_PER_ELEMENT = 12;
  var MAX_SYMBOL_ITEMS = 24;
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
    var domain = args.domain || (ys && ys.domain) || 'general';
    var items = [];

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
    if (ys && ys.examine) {
      ys.examine.forEach(function (m) {
        // 用神元素本身
        var cat = KIND_TO_CAT[m.kind];
        if (cat) addSymbol(cat, m.resolved && cat === 'tiangan' ? m.resolved : m.name);
        // 其所落之宫（方位/场所之象，失物与风水尤需）
        addSymbol('jiugong', m.gong);
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
      items: items,
      combined: ys && ys.examine ? combine(ys.examine, domain) : []
    };
  }

  /** 证据包 → 提示词文本块。坏数据返回空串，绝不阻断解读流程。 */
  function toPromptBlock(ev) {
    if (!ev || !ev.items || !ev.items.length) return '';
    var L = [], facts = [], rules = [], syms = [];
    ev.items.forEach(function (x) {
      if (x.type === 'FACT') facts.push('  - ' + x.content);
      else if (x.type === 'RULE') rules.push('  - [' + x.source + '] ' + x.content);
      else if (x.type === 'SYMBOL') syms.push('  - ' + (x.label || x.element) + '：' + x.content.join('、'));
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
    if (facts.length) { L.push('· FACT（引擎算得的盘面事实，不得改写）：'); L = L.concat(facts); }
    if (rules.length) { L.push('· RULE（应用确定性分析，优先于模型自身判断）：'); L = L.concat(rules); }
    if (syms.length) { L.push('· SYMBOL（知识库象义，优先采用；可组合，不可替换为自创象义）：'); L = L.concat(syms); }
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
