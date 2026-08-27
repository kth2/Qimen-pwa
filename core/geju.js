/**
 * 奇门·八十一干加干格局(GeJu) core —— 纯函数、无副作用、可移植。【Phase 15】
 *
 * 解决的问题：引擎其实认得格（100 种干加干里它给 81 种起了名），但这些名字
 * 只作为一个四字标签裸露在提示词的宫格行里：
 *     5宫(中央/室内):    | 天乙/地乙(暗丁) | 小凶 日奇伏吟
 * ——没有断语，也不进象义／力量／应期／合流任何一层（keYing 在 7 个 core 模块
 * 与 7 份知识库里出现 0 次）。模型看见「日奇伏吟」四个字，却不知道它是什么意思。
 *
 * 本层把用户所供的《奇门遁甲 81 格局》表接上：逐宫查出格名与其两句断语，
 * 关注宫详列、其余宫一行带过。
 *
 * 关键边界（务必保持）：
 *   ① **表是用户所供**，非本仓纲要所载。出处一律标〔用户所供 81 格表〕。
 *   ② **不重算盘**：天盘干、地盘干取自引擎 jiuGongAnalysis。
 *   ③ **不造吉凶等级**。表只给名与断语，本层就只给名与断语；宫位吉凶仍以引擎
 *      jiXiong 为准，二者分列不合并——一格之名与一宫之吉凶本就不是一回事。
 *   ④ 引擎另有一套命名，与本表 61 格同、20 格异。本层以本表为准，同时把引擎的
 *      叫法一并带出（engineName），**两套说法并存而不混**。
 *   ⑤ 键的方向是「天盘干+地盘干」；表的行为地盘、列为天盘，录入时已换向并验证。
 *   ⑥ 完全确定性：同盘同关注宫必得同一结果，排序稳定（按宫号）。
 *
 * 依赖：knowledge/geju-81.json（须先 load() 注入）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GeJu = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB = null;
  var VERSION = '1.0.0';
  var GONGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  function load(json) {
    DB = (json && json.table && Object.keys(json.table).length === 81) ? json : null;
    return !!DB;
  }
  function isLoaded() { return !!DB; }

  /** 查一格。查不到就是查不到——甲不上盘，或该宫干不全，一律返回 null，不臆造。 */
  function lookup(tianGan, diGan) {
    if (!DB) return null;
    var k = String(tianGan || '') + '+' + String(diGan || '');
    var e = DB.table[k];
    if (!e) return null;
    return {
      key: k, tianGan: String(tianGan), diGan: String(diGan),
      name: e.name, text: e.text,
      engineName: e.engineName || '',     // 仅在与本表不同时才有
      // 个别格经用户裁定改从纲要或引擎，其出处便不再是「用户所供 81 格表」。
      // 出处必须逐条各标各的，不能让整层的抬头替它背书。
      provenance: e.provenanceOverride || null,
      supersededTableName: e.supersededTableName || '',
      supersededWhy: e.supersededWhy || ''
    };
  }

  /**
   * @param {object}   args.chart   引擎盘（必需）
   * @param {string[]} [args.focusGongs] 关注宫（用神宫等）。给了则该几宫详列、余宫简列
   * @param {object}   [args.focusRoles] { gong: [role...] } 该宫因何要紧
   * @returns {{version,items:[],focus:[],rest:[],notes:[]}}
   */
  function analyze(args) {
    args = args || {};
    var chart = args.chart;
    var out = { version: VERSION, items: [], focus: [], rest: [], notes: [], provenance: provenance() };
    if (!DB) { out.notes.push('81 格表未加载，本层跳过。'); return out; }
    if (!chart || !chart.jiuGongAnalysis) { out.notes.push('盘中无九宫数据，格局无从查起。'); return out; }

    var focus = {};
    (args.focusGongs || []).forEach(function (g) { focus[String(g)] = true; });
    var roles = args.focusRoles || {};
    var jg = chart.jiuGongAnalysis;

    GONGS.forEach(function (g) {
      var c = jg[g];
      if (!c) return;
      var hit = lookup(c.tianGan, c.diGan);
      if (!hit) {
        // 甲不上盘，故中宫或某宫若出现甲即查不到——如实记一笔，不硬凑
        if (c.tianGan && c.diGan) out.notes.push(g + '宫 ' + c.tianGan + '加' + c.diGan + ' 不在 81 格表内（甲不上盘）。');
        return;
      }
      var item = {
        gong: g, gongName: c.gongName || '',
        tianGan: hit.tianGan, diGan: hit.diGan,
        name: hit.name, text: hit.text, engineName: hit.engineName,
        provenance: hit.provenance, supersededTableName: hit.supersededTableName,
        supersededWhy: hit.supersededWhy,
        isFocus: !!focus[g],
        roles: (roles[g] || []).slice(),
        // 宫位吉凶另取自引擎，与格名分列——一格之名不等于一宫之吉凶
        gongJiXiong: c.jiXiongText || ''
      };
      out.items.push(item);
      (item.isFocus ? out.focus : out.rest).push(item);
    });

    // 未指定关注宫时，全部按详列处理，免得一条详情都没有
    if (!out.focus.length && out.rest.length && !(args.focusGongs || []).length) {
      out.focus = out.rest.slice();
      out.rest = [];
      out.items.forEach(function (i) { i.isFocus = true; });
    }
    return out;
  }

  function provenance() {
    return (DB && DB._provenance) || { level: '未注明', text: '' };
  }

  /** 排版给证据包用。关注宫详列，余宫一行带过——九宫全详列会把包撑爆。 */
  function toPromptBlock(res) {
    if (!res || !res.items.length) return '';
    var p = provenance();
    var L = ['【八十一格（干加干）】'];
    res.focus.forEach(function (i) {
      L.push('· ' + i.gong + '宫' + (i.gongName ? '(' + i.gongName + ')' : '') +
        (i.roles.length ? '〔' + i.roles.join('、') + '〕' : '') +
        '　天盘' + i.tianGan + ' 加 地盘' + i.diGan + ' —— **' + i.name + '**' +
        (i.engineName ? '（引擎作「' + i.engineName + '」）' : ''));
      L.push('    ' + i.text + (i.gongJiXiong ? '　｜　该宫吉凶(引擎)：' + i.gongJiXiong : ''));
      if (i.provenance) L.push('    〔' + i.provenance.level + '〕' + i.provenance.text);
      if (i.supersededTableName) L.push('    （本格经裁定，原表作「' + i.supersededTableName + '」）');
    });
    if (res.rest.length) {
      L.push('· 其余各宫：' + res.rest.map(function (i) {
        return i.gong + '宫' + i.tianGan + '加' + i.diGan + '「' + i.name + '」';
      }).join('　'));
    }
    L.push('〔' + p.level + '〕' + p.text);
    L.push('※ 格名与断语出自上表；**格之名不等于宫之吉凶**，二者须分开看，成败仍结合用神、旺衰与全盘。');
    return L.join('\n');
  }

  return {
    load: load, isLoaded: isLoaded, analyze: analyze, lookup: lookup,
    toPromptBlock: toPromptBlock, provenance: provenance, VERSION: VERSION
  };
});
