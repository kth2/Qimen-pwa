/**
 * 奇门·类象取用(LeiXiang) core —— 纯函数、无副作用、可移植。【Phase 8】
 *
 * 解决的问题：此前用神只按**占类**取（domains.json：值符/值使/日干/时干/生门/戊…），
 * 所问的**具体人事物**在盘上没有代表——测钥匙时盘上没有钥匙，测尸体时盘上没有尸体，
 * 占类若落在「综合」，连测钱财都不会取戊。于是解读永远只在时干宫、日干宫、值符值使几个宫里打转。
 *
 * 而转盘纲要本来就写了这一层：
 *   · 二节用神取用表尾：「衍象类象：人/物/事各取对应符号(见第四节)，落宫定方位、临神临门定性质。」
 *   · 二节失物一条：「玄武(盗) + **用神类象** + 年命 …… 类象定物，方位定处。」
 * 本模块即据四节的四张类象表，把「所问之物」映射成候选用神符号，并在盘上定其落宫。
 *
 * 关键边界（务必保持）：
 *   ① **转盘专有**。飞盘《鸣法·用神章》是一张按占问类型固定取用的表（寻物＝伤门+年命），
 *      不含类象取用；其射覆的八卦类象是「读用神落宫」之用，非「取用神」之用。故绝不在飞盘启用。
 *   ② **只产出候选，不改写占类用神**。domains.json 的取用一字不动，二者分列送进提示词。
 *   ③ **两级出处**：confidence=high 者，该词就是纲要写的那个词；medium/low 者是本层把它
 *      归入纲要那一类（如钥匙归入「金刃/首饰」）——属归类而非原文，须另作标注。
 *   ④ **不做否定判断**：匹配不到就说匹配不到，并请模型按四节类象自行取用；
 *      绝不因索引没收就说「盘上无此物」。
 *   ⑤ 完全确定性：同一问句同一张盘必得同一结果，排序稳定。
 *
 * 依赖：knowledge/leixiang.json（须先 load() 注入）；
 *       定宫需要一个 locate(chart, name, actors) 函数，由调用方注入（通常是 YongShen.locate）——
 *       本模块不自带盘面解析，以免与 yongshen.js 各写一套而漂移。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeiXiang = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB = null;
  var VERSION = '1.0.0';
  var MAX_CANDIDATES = 8;      // 候选太多等于没取用神
  var CONF_RANK = { high: 3, medium: 2, low: 1 };

  function load(json) {
    DB = (json && json.index && json.tables) ? json : null;
    return !!DB;
  }
  function isLoaded() { return !!DB; }

  /** 与 yongshen.js / xiangyi.js / timing.js detectSchool 同规则。 */
  function detectSchool(chart) {
    if (!chart) return 'zhuanpan';
    if (chart.renPanMen || chart.tianPanYi || chart.diPanShen) return 'feipan';
    return 'zhuanpan';
  }

  function tableOf(name) { return (DB.tables || {})[name] || null; }
  function wordsOf(entry) {
    var t = tableOf(entry.table);
    return (t && t.items[entry.symbol]) ? t.items[entry.symbol].slice() : [];
  }
  function kindOf(entry) {
    var t = tableOf(entry.table);
    return t ? t.kind : '';
  }

  /**
   * 在问句里找类象词。
   * 长词优先并**吃掉已匹配的字**——否则「现金」会先被「金」吃掉一半，钱财被读成首饰。
   * 返回按出现位置排序的命中，位置相同者按置信度、再按符号名稳定排序。
   */
  function match(text) {
    if (!DB || !text) return [];
    var s = String(text);
    var pairs = [];
    (DB.index || []).forEach(function (e, ei) {
      (e.terms || []).forEach(function (term) { pairs.push({ term: term, e: e, ei: ei }); });
    });
    pairs.sort(function (a, b) {
      if (a.term.length !== b.term.length) return b.term.length - a.term.length;
      return a.term < b.term ? -1 : 1;
    });
    var taken = [];                       // 已被更长的词占用的字位
    for (var i = 0; i < s.length; i++) taken.push(false);
    var hits = [];
    pairs.forEach(function (p) {
      var from = 0, at;
      while ((at = s.indexOf(p.term, from)) >= 0) {
        from = at + 1;
        var free = true, k;
        for (k = at; k < at + p.term.length; k++) if (taken[k]) { free = false; break; }
        if (!free) continue;
        for (k = at; k < at + p.term.length; k++) taken[k] = true;
        hits.push({ term: p.term, at: at, entry: p.e, ei: p.ei });
      }
    });
    hits.sort(function (a, b) {
      if (a.at !== b.at) return a.at - b.at;
      var ca = CONF_RANK[a.entry.confidence] || 0, cb = CONF_RANK[b.entry.confidence] || 0;
      if (ca !== cb) return cb - ca;
      return a.entry.symbol < b.entry.symbol ? -1 : 1;
    });
    return hits;
  }

  /**
   * 主入口。
   * @param {object} args
   *   question —— 用户问句（类象从此取；缺则本层停用）
   *   chart    —— 引擎输出的盘（定候选落宫用）
   *   options.school     —— 缺省依盘面判定；非转盘一律停用
   *   options.locate     —— locate(chart, name, actors)，通常传 YongShen.locate
   *   options.actors     —— {riGan, shiGan, nianMingGan}，透传给 locate
   *   options.domainNames—— 占类用神名单，用于标出「与占类用神重合」者，避免重复着墨
   *   options.extra      —— 可选，用户另行指明的所问之物（与问句一并匹配）
   */
  function resolve(args) {
    args = args || {};
    var chart = args.chart || null;
    var options = args.options || {};
    var school = options.school || detectSchool(chart);
    var text = String(args.question || '') + (options.extra ? ' ' + options.extra : '');

    var base = {
      version: VERSION, school: school, applicable: false, reason: '',
      candidates: [], unmatched: false, fallbackNote: '', notes: [], suggestedDomains: [],
      tablesNote: '', bagua: null
    };

    if (!DB) { base.reason = '类象规则库未加载，本层停用。'; return base; }
    if ((DB.appliesTo || []).indexOf(school) < 0) {
      base.reason = '类象取用为转盘专法（飞盘《鸣法·用神章》按占问类型固定取用，不含类象取用），故本盘不启用。';
      return base;
    }
    if (!text.replace(/\s/g, '')) { base.reason = '未提供占问文字，无从取象。'; return base; }

    var hits = match(text);
    var domainNames = options.domainNames || [];
    var locate = typeof options.locate === 'function' ? options.locate : null;
    var actors = options.actors || {};

    var seen = {}, out = [];
    hits.forEach(function (h) {
      var e = h.entry;
      var key = e.symbol + '|' + e.matched;
      if (seen[key]) { seen[key].terms.push(h.term); return; }
      var kind = kindOf(e);
      var c = {
        symbol: e.symbol, kind: kind, table: e.table,
        terms: [h.term], matched: e.matched, words: wordsOf(e),
        confidence: e.confidence || 'medium',
        // high＝该词就是纲要写的那个词；medium/low＝本层把它归入纲要那一类，属归类而非原文
        provenance: e.confidence === 'high' ? '纲要原文' : '本层归类',
        why: e.why || '', basis: e.basis || '',
        inDomain: domainNames.indexOf(e.symbol) >= 0,
        gong: '', gongName: '', direction: '', located: false, locateNote: ''
      };
      if (locate && chart) {
        var m = null;
        try { m = locate(chart, e.symbol, actors); } catch (err) { m = null; }
        if (m && m.gong) {
          c.located = true;
          c.gong = String(m.gong); c.gongName = m.gongName || ''; c.direction = m.direction || '';
          if (m.resolved && m.resolved !== e.symbol) c.resolved = m.resolved;
          if (m.via) c.via = m.via;
        } else {
          // 盘上确实没有这个符号（如某干不上天盘），如实说明，不代为安置落宫
          c.locateNote = '此象盘上未见，不得代为安置落宫';
        }
      }
      seen[key] = c;
      out.push(c);
    });

    // 排序：先纲要原文、后本层归类；同级按在问句中出现的先后（即 out 的原序）
    out.sort(function (a, b) {
      var ca = CONF_RANK[a.confidence] || 0, cb = CONF_RANK[b.confidence] || 0;
      if (ca !== cb) return cb - ca;
      return 0;
    });
    if (out.length > MAX_CANDIDATES) {
      base.notes.push('类象命中 ' + out.length + ' 个符号，按出处与置信取前 ' + MAX_CANDIDATES + ' 个；候选过多等于没取用神。');
      out = out.slice(0, MAX_CANDIDATES);
    }

    base.candidates = out;
    base.unmatched = out.length === 0;

    /* 占类提示：取到的象若正是某占类的**主用神**，而本次占类却落在「其他(general)」，
     * 那多半是问句没被引擎归对类——实测吃过亏：问大伯病情，占类判成 general，
     * health 的判读规则一条没跑，天芮(病符)只作为一个符号出现、毫无权重。
     * 此处只**提示**，不代为改写占类：改占类会连带换掉一整套用神与规则，须由人定夺。 */
    // 占类提示：本次占类为「其他」时固然要提；**占类判错**时更要提——
    // 实测里最贵的一类错就是占类判错（「钱包丢了能不能找到」被判成求财），
    // 错了则用神、规则、判读整套都错，事后无从补救。
    var idx = options.domainsForHint;
    if (idx && idx.length) {
      var hit = {};
      out.forEach(function (c) {
        idx.forEach(function (d) {
          var prim = (d.yongshen && d.yongshen.primary) || [];
          if (d.name === 'general' || d.name === options.domain) return;   // 与本次占类相同者不必提
          if (prim.indexOf(c.symbol) < 0) return;
          if (!hit[d.name]) hit[d.name] = { domain: d.name, label: d.label || '', symbols: [] };
          if (hit[d.name].symbols.indexOf(c.symbol) < 0) hit[d.name].symbols.push(c.symbol);
        });
      });
      base.suggestedDomains = Object.keys(hit).sort().map(function (k) { return hit[k]; });
      if (base.suggestedDomains.length) {
        var cur = options.domain || 'general';
        base.notes.push('问句取到的象（' +
          base.suggestedDomains.map(function (s) { return s.symbols.join('/') + '→' + (s.label || s.domain); }).join('；') +
          '）正是**别的占类**的主用神，而本次占类为「' + (options.domainLabel || cur) + '」，' +
          '那些占类的判读规则并未启用。' +
          (cur === 'general'
            ? '请据其用神一并合参；若确属该类，可在提问处的「占类」里改选后重占。'
            : '**请先核对本次占类是否判对**——占类判错则用神与规则整套皆错；' +
              '若确属所提示的那一类，请在提问处的「占类」里改选后重占。'));
      }
    }
    base.fallbackNote = DB.fallbackNote || '';
    base.bagua = DB.bagua || null;
    base.tablesNote = '类象表逐字取自' + ((DB.tables['十干'] || {}).basis || '').split('：')[0] + ' 等四表。';
    base.applicable = out.length > 0;
    base.reason = out.length
      ? '已据纲要四节类象，为所问之物取出候选用神符号。'
      : '问句中未匹配到纲要类象词；交由模型按四节类象自行取象（见 fallbackNote）。';
    return base;
  }

  /** 类象结果 → 提示词文本块。坏数据返回空串，绝不阻断解读流程。 */
  function toPromptBlock(res) {
    if (!res || res.school !== 'zhuanpan') return '';
    if (!res.applicable && !res.unmatched) return '';
    var L = [];
    L.push('');
    L.push('【类象用神 LeiXiang v' + (res.version || '') + '】');
    L.push('· 依转盘纲要二节表尾「衍象类象：人/物/事各取对应符号(见第四节)，落宫定方位、临神临门定性质」，' +
      '以及失物一条「玄武(盗) + **用神类象** + 年命……类象定物」——**所问的具体人事物本身也要取一个用神**，' +
      '不能只看值符值使日干时干。下列即据四节类象表为本次所问之物取出的候选。');
    if (res.unmatched) {
      L.push('· 本次未在索引中匹配到类象词。' + res.fallbackNote);
      return L.join('\n');
    }
    L.push('· 候选类象用神（与占类用神并列，二者合参，不相取代）：');
    res.candidates.forEach(function (c) {
      var head = '  - ' + c.symbol + '（' + c.matched + '）' +
        '　所问：' + c.terms.join('/') +
        (c.located ? '　落 ' + c.gong + '宫' + (c.gongName ? c.gongName : '') + (c.direction ? '·' + c.direction : '') : '') +
        (c.inDomain ? '　〔已在占类用神之列〕' : '');
      L.push(head);
      L.push('      〔' + c.provenance + '〕' + (c.why ? c.why + '。' : '') +
        '本象全部类象：' + c.words.join('/') +
        (c.locateNote ? '　⚠ ' + c.locateNote : ''));
    });
    L.push('  · 〔纲要原文〕＝所问之词就是纲要写的那个类象词，可直接取用；' +
      '〔本层归类〕＝是本应用把这个词归入纲要那一类（如钥匙归入「金刃/首饰」），' +
      '可用，但断语中须写明是按此类归的，不要说成纲要原文如此。');
    L.push('  · 取用之后照常断：该象落宫之星门神干、旺衰四害、与年命/日干的生克盗泄——' +
      '「落宫定方位、临神临门定性质」。标为「盘上未见」者按未见论，不得代为安置落宫。');
    if (res.bagua) {
      L.push('  · 若要定物之形色质类（射覆一路），再看用神落宫的八卦类象：' + res.bagua.basis);
    }
    if (res.notes.length) res.notes.forEach(function (n) { L.push('  · 说明：' + n); });
    return L.join('\n');
  }

  return {
    load: load, isLoaded: isLoaded,
    detectSchool: detectSchool,
    match: match, resolve: resolve, toPromptBlock: toPromptBlock,
    VERSION: VERSION
  };
});
