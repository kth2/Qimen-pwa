/**
 * 奇门·时格(ShiGe) core —— 纯函数、无副作用、可移植。【Phase 16】
 *
 * 两格：**五不遇时**（时干克日干且阴阳同性）与**天显时格**（时干与日干相同）。
 * 二者由四柱的日干时干判定，与盘上星门神仪的排布无关，故独立成层。
 *
 * 此前全 app 对这两格只字未提：「五不遇」「天显」「时格」三词在代码、7 份知识库、
 * 两份纲要里命中数皆为 0。
 *
 * 关键边界（务必保持）：
 *   ① **定义由用户给定**（2026-08-27），非纲要所载。出处一律标〔用户所定〕。
 *   ② **不重算干支**：日干时干取自引擎 siZhu。
 *   ③ **这不是禁令层**。用户给的口径是「增加几率」而非「必然如此」，尤其天显时格
 *      用户**明言「吉的几率不显着」**——故它是最弱一档，不得据以加重吉断。
 *      与 severity 的硬禁令性质不同，不可混为一谈。
 *   ④ **未测效应**：只测了发生率（各约 10%），从未测过与应验率的关系。不测不报。
 *   ⑤ **不写解法**：传统另有可解之说，用户此次未给，宁缺勿造。
 *   ⑥ 两派通用：判据是四柱，不涉及任一派的排盘断法，不构成串味。
 *
 * 依赖：knowledge/shige-rules.json（须先 load() 注入）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShiGe = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB = null;
  var VERSION = '1.0.0';

  function load(json) {
    DB = (json && json.checks && json.checks.wubuyu && json.checks.tianxian
      && json.element && json.ke && json.yinYang) ? json : null;
    return !!DB;
  }
  function isLoaded() { return !!DB; }

  /** 干支柱取天干。柱形如「乙亥」，取首字。 */
  function ganOf(pillar) {
    var s = String(pillar || '');
    return s ? s.charAt(0) : '';
  }

  /** 时干是否克日干（五行相克，方向：时→日）。 */
  function keRiGan(shiGan, riGan) {
    var es = DB.element[shiGan], er = DB.element[riGan];
    if (!es || !er) return false;
    return DB.ke[es] === er;
  }
  function sameYinYang(a, b) {
    var ya = DB.yinYang[a], yb = DB.yinYang[b];
    return !!ya && !!yb && ya === yb;
  }

  /** 五不遇时：时干克日干 且 阴阳同性。按定义现算，不据表查——表只用于单测校验。 */
  function isWuBuYu(riGan, shiGan) {
    if (!riGan || !shiGan) return false;
    return keRiGan(shiGan, riGan) && sameYinYang(shiGan, riGan);
  }
  /** 天显时格：时干与日干相同。 */
  function isTianXian(riGan, shiGan) {
    return !!riGan && riGan === shiGan;
  }

  /**
   * @param {object} args.chart 引擎盘（必需，取其 siZhu）
   * @returns {{version,riGan,shiGan,hits:[],notes:[]}}
   */
  function analyze(args) {
    args = args || {};
    var chart = args.chart;
    var out = { version: VERSION, riGan: '', shiGan: '', hits: [], notes: [] };
    if (!DB) { out.notes.push('时格规则库未加载，本层跳过。'); return out; }
    var sz = chart && chart.siZhu;
    if (!sz || !sz.day || !sz.time) {
      out.notes.push('盘中无日柱或时柱，五不遇时与天显时格无从判起。');
      return out;
    }
    var ri = ganOf(sz.day), shi = ganOf(sz.time);
    out.riGan = ri; out.shiGan = shi;
    out.dayPillar = String(sz.day); out.timePillar = String(sz.time);

    function push(key) {
      var c = DB.checks[key];
      out.hits.push({
        id: key, name: c.name, test: c.test,
        polarity: c.polarity, strength: c.strength,
        meaning: c.meaning, howToUse: c.howToUse,
        provenance: c.provenance,
        detail: '日干' + ri + '（' + sz.day + '）／时干' + shi + '（' + sz.time + '）'
      });
    }
    if (isWuBuYu(ri, shi)) push('wubuyu');
    if (isTianXian(ri, shi)) push('tianxian');
    if (!out.hits.length) out.notes.push('本时辰非五不遇时，亦非天显时格。');
    return out;
  }

  /** 排版给证据包用。分量必须随条写明，否则「增加几率」会被读成「必然如此」。 */
  function toPromptBlock(res) {
    if (!res || !res.hits.length) return '';
    var MARK = { tendency: '倾向', weak: '**分量很轻**' };
    var L = ['【时格】' + res.dayPillar + '日 ／ ' + res.timePillar + '时'];
    res.hits.forEach(function (h) {
      L.push('· **' + h.name + '**（' + h.test + '）：' + h.detail);
      L.push('    义：' + h.meaning + '　【' + (MARK[h.strength] || h.strength) + '】');
      L.push('    用法：' + h.howToUse);
      L.push('    〔' + h.provenance.level + '〕' + h.provenance.text);
    });
    L.push('※ 本层出的是**几率上的倾向，不是禁令，也不是定论**；' +
      '本仓从未测过时格与实际应验率的关系，故不得声称「此类盘更准／更不准」。');
    return L.join('\n');
  }

  return {
    load: load, isLoaded: isLoaded, analyze: analyze, toPromptBlock: toPromptBlock,
    VERSION: VERSION,
    _internals: { ganOf: ganOf, isWuBuYu: isWuBuYu, isTianXian: isTianXian }
  };
});
