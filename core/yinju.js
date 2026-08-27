/**
 * 奇门·伏吟／反吟(YinJu) core —— 纯函数、无副作用、可移植。【Phase 14】
 *
 * 解决的问题：此前全 app 对「吟」只字未提。查证结果：
 *   · 引擎的 pan.geju 恒为 []，从未被填充；
 *   · keYing（干加干格名）在 7 个 core 模块与 7 份知识库里出现 **0 次**；
 *   · 格名只作为一个四字标签裸露在提示词的宫格行里（「小凶 日奇伏吟」），
 *     既不带义，也不进象义／力量／应期／合流任何一层；
 *   · 「反吟」二字在两份纲要之外的代码里完全不存在。
 * 于是纲要写死的两条——「伏吟…事主静滞不动、久拖难成」「反吟…主动荡、反复、
 * 事有变，速而不久」——以及应期节那句「伏吟主静，静中以马星为动机」，
 * 全都从未被执行过。本模块把它们变成确定性判定。
 *
 * 关键边界（务必保持）：
 *   ① **分层出处**。干层出自两份纲要的格局表（【纲要原文】）；星层与门层两份纲要
 *      均无明文，属【非本纲要·通行法】，由用户指定采纳。输出里逐条标注，
 *      绝不让通行法冒充纲要——这是本仓两级出处规矩的延续。
 *   ② **不产出吉凶断语**，只给倾向与出处。与 severity 同一规矩。
 *   ③ **不重算盘**：星／门／干一律取自引擎 jiuGongAnalysis，本层只做比对。
 *   ④ **转盘中宫排除干伏吟**：实测 3000 盘，转盘中宫天地盘干 100% 相同（引擎中宫寄
 *      的结构性产物），飞盘则为 20%。不排除的话每张转盘都会挂一个假伏吟。
 *   ⑤ **局与宫分开**：命中数达阈值报「局」，不足则逐宫报，不把一处硬说成全盘。
 *   ⑥ 完全确定性：同盘必得同一结果，排序稳定。
 *
 * 依赖：knowledge/yinju-rules.json（须先 load() 注入）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YinJu = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB = null;
  var VERSION = '1.0.0';
  var GONGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  function load(json) {
    DB = (json && json.layers && json.homes && json.opposite) ? json : null;
    return !!DB;
  }
  function isLoaded() { return !!DB; }

  function detectSchool(chart) {
    if (!chart) return 'zhuanpan';
    if (chart.renPanMen || chart.tianPanYi || chart.diPanShen) return 'feipan';
    return 'zhuanpan';
  }

  /**
   * 天禽寄芮，引擎写作「禽芮」而不单占一宫。归一后其本位为中五宫，
   * 恒不与所落之宫相等——这正是转盘星层「可判 8 宫、命中只 7」的由来，
   * 是数据实情，不是漏判。
   */
  function normXing(s) {
    s = String(s || '');
    if (s === '禽芮' || s === '天禽芮') return '天禽';
    return s;
  }

  function appliesHere(node, school) {
    var a = node && node.appliesTo;
    if (!a || !a.length) return true;
    return a.indexOf(school) >= 0;
  }

  /** 某层某宫的判定：返回 'fuyin' / 'fanyin' / ''。无法判定一律空，宁可漏判。 */
  function classify(layer, gong, cell, school) {
    var opp = DB.opposite[gong] || '';
    if (layer === 'xing') {
      var x = normXing(cell.xing), hx = DB.homes.xing[x];
      if (!hx) return '';
      if (hx === gong) return 'fuyin';
      if (opp && hx === opp) return 'fanyin';
      return '';
    }
    if (layer === 'men') {
      var m = String(cell.men || ''), hm = DB.homes.men[m];
      if (!hm) return '';
      if (hm === gong) return 'fuyin';
      if (opp && hm === opp) return 'fanyin';
      return '';
    }
    // gan
    var tg = String(cell.tianGan || ''), dg = String(cell.diGan || '');
    if (!tg || !dg) return '';
    if (tg === dg) {
      // 转盘中宫恒同干，是引擎中宫寄的产物而非盘象，必须排除
      var ex = DB.zhongGongExcludeFor || [];
      if (gong === '5' && ex.indexOf(school) >= 0) return '';
      return 'fuyin';
    }
    if (DB.ganChong[tg] === dg) return 'fanyin';
    return '';
  }

  function provOf(layer, kind) {
    var node = DB.layers[layer] && DB.layers[layer][kind];
    return node && node.provenance ? node.provenance : { level: '未注明', text: '' };
  }

  /**
   * @param {object} args.chart   引擎盘（必需）
   * @param {string} [args.school] 未给则由盘自动判别
   * @returns {{version,school,ju:[],gong:[],combos:[],timing:[],notes:[],_counts}}
   */
  function analyze(args) {
    args = args || {};
    var chart = args.chart;
    var out = { version: VERSION, school: '', ju: [], gong: [], combos: [], timing: [], notes: [], _counts: {} };
    if (!DB) { out.notes.push('伏吟／反吟规则库未加载，本层跳过。'); return out; }
    if (!chart || !chart.jiuGongAnalysis) { out.notes.push('盘中无九宫数据，伏吟／反吟无从判起。'); return out; }

    var school = args.school || detectSchool(chart);
    out.school = school;
    var jg = chart.jiuGongAnalysis;
    var thr = Number(DB.juThreshold) || 6;
    var layers = ['xing', 'men', 'gan'];
    var hits = {};   // hits[layer][kind] = [gong...]

    layers.forEach(function (layer) {
      if (!appliesHere(DB.layers[layer], school)) return;
      hits[layer] = { fuyin: [], fanyin: [] };
      GONGS.forEach(function (g) {
        var cell = jg[g];
        if (!cell) return;
        var k = classify(layer, g, cell, school);
        if (k) hits[layer][k].push(g);
      });
    });

    layers.forEach(function (layer) {
      if (!hits[layer]) return;
      ['fuyin', 'fanyin'].forEach(function (kind) {
        var gs = hits[layer][kind];
        out._counts[layer + '.' + kind] = gs.length;
        if (!gs.length) return;
        var node = DB.layers[layer][kind];
        var item = {
          layer: layer,
          layerLabel: DB.layers[layer].label,
          kind: kind,
          name: node.name,
          test: node.test,
          meaning: node.meaning,
          provenance: provOf(layer, kind),
          gongs: gs.slice(),
          count: gs.length
        };
        if (gs.length >= thr) {
          item.scope = 'ju';
          item.scopeLabel = '全盘';
          out.ju.push(item);
        } else {
          item.scope = 'gong';
          item.scopeLabel = gs.length === 1 ? '单宫' : (gs.length + ' 宫');
          out.gong.push(item);
        }
      });
    });

    // 星门同吟：两层在同一范围内同时成立才算，只作「两路同指」的提示
    var combo = DB.combos && DB.combos.xingmen;
    if (combo) {
      ['fuyin', 'fanyin'].forEach(function (kind) {
        var jx = out.ju.filter(function (i) { return i.layer === 'xing' && i.kind === kind; })[0];
        var jm = out.ju.filter(function (i) { return i.layer === 'men' && i.kind === kind; })[0];
        if (!jx || !jm) return;
        out.combos.push({
          name: combo.name + '（' + (kind === 'fuyin' ? '伏' : '反') + '）',
          kind: kind,
          meaning: kind === 'fuyin' ? combo.fuyinMeaning : combo.fanyinMeaning,
          provenance: combo.provenance,
          basedOn: [jx.name, jm.name]
        });
      });
    }

    // 应期联动：伏吟主静→抬升马星（纲要原文）；反吟速而不久→只作提示
    var tl = DB.timingLink || {};
    var anyFu = out.ju.concat(out.gong).some(function (i) { return i.kind === 'fuyin'; });
    var anyFan = out.ju.concat(out.gong).some(function (i) { return i.kind === 'fanyin'; });
    if (anyFu && tl.fuyin && appliesHere(tl.fuyin, school)) {
      out.timing.push({
        kind: 'fuyin', effect: tl.fuyin.effect, target: tl.fuyin.target,
        why: tl.fuyin.why, provenanceLevel: tl.fuyin.provenanceLevel
      });
    }
    if (anyFan && tl.fanyin && appliesHere(tl.fanyin, school)) {
      out.timing.push({
        kind: 'fanyin', effect: tl.fanyin.effect, text: tl.fanyin.text,
        why: tl.fanyin.why, provenanceLevel: tl.fanyin.provenanceLevel
      });
    }

    if (!out.ju.length && !out.gong.length) out.notes.push('本盘星、门、干三层皆无伏吟反吟。');
    return out;
  }

  /** 排版给证据包用。两级出处必须落到每一条上，不能只在抬头写一句。 */
  function toPromptBlock(res) {
    if (!res || (!res.ju.length && !res.gong.length)) return '';
    var L = ['【伏吟／反吟】'];
    function line(i) {
      var p = i.provenance || {};
      L.push('· ' + i.name + '（' + i.scopeLabel + '）：' + i.test +
        '　命中宫 ' + i.gongs.join('、'));
      L.push('    义：' + i.meaning);
      L.push('    〔' + (p.level || '未注明') + '〕' + (p.text || ''));
    }
    if (res.ju.length) { L.push('▍成局者：'); res.ju.forEach(line); }
    if (res.gong.length) { L.push('▍逐宫者（未成局，只在该宫论）：'); res.gong.forEach(line); }
    res.combos.forEach(function (c) {
      L.push('▍' + c.name + '：' + c.meaning);
      L.push('    〔' + c.provenance.level + '〕' + c.provenance.text);
    });
    res.timing.forEach(function (t) {
      L.push('▍应期联动：' + (t.effect === 'raise'
        ? '伏吟主静，故「' + t.target + '」锚点升为高——' + t.why
        : t.text + '（' + t.why + '）'));
      L.push('    〔' + t.provenanceLevel + '〕');
    });
    L.push('※ 本层只给倾向与出处，不下吉凶断语；成败仍须结合用神、旺衰与全盘。');
    return L.join('\n');
  }

  return {
    load: load, isLoaded: isLoaded, analyze: analyze, toPromptBlock: toPromptBlock,
    VERSION: VERSION,
    _internals: { detectSchool: detectSchool, normXing: normXing, classify: classify }
  };
});
