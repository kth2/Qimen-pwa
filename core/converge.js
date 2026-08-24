/**
 * 奇门·证据合流(Converge) core —— 纯函数、无副作用、可移植。【Phase 13】
 *
 * 解决的问题：证据层此前只把「玄武落离九」这样的事实摆出来，然后由模型自己编成一句
 * 「在正南明亮处、炉灶电器旁」。实测里这正是失手最惨的一类——同一张盘上的
 * 九地(稳固藏纳)、杜门(阻塞/隐藏) 明明都指向「低处、被覆盖」，实物也确实在**床下、被衣物压住**，
 * 却因为它们不在用神宫而被整个忽略；而「离九＝明亮处」这条**孤证**反倒被写进了结论。
 *
 * 症结不是象义不够，是**没有人去数「有几路互不相干的证据指向同一个结论」**。
 * 「可能之义」被当成了「较可能之义」。本模块补的正是这一层：
 *   ① 把盘面元素对各维度（方位/高低/显隐/场所）的指向收集成票；
 *   ② 按**独立来源**计数——同一元素的多个别名只算一路，五条同源的话不等于五路旁证；
 *   ③ 检出对立（高 vs 低、显 vs 藏），不代为择一，如实标为争持；
 *   ④ 依独立路数定档 A/B/C/D，并规定各档能不能进结论——**证据不足就弃权**，
 *      而不是硬编一个具体去处出来。
 *
 * 关键边界（务必保持）：
 *   ① **不产出吉凶，也不产出断语**：只说「哪个结论有几路证据、够不够格进结论」。
 *   ② 每一票都出自纲要原文（见 knowledge/dimensions.json 的 basis），不载者不投票。
 *   ③ 方位与场所仍以**用神落宫**为准（纲要二节失物：方位定处）；本层不改这条，
 *      只是把用神宫之外的同类旁证也计入维度，让孤证不至于压过合流。
 *   ④ 完全确定性：同盘同关注宫必得同一结果，排序稳定。
 *
 * 依赖：knowledge/dimensions.json（须先 load() 注入）；关注宫由调用方给出
 *       （通常＝占类用神宫 + 类象用神宫，与 severity 同一份口径）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Converge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB = null;
  var VERSION = '1.0.0';
  /* 档位：按**独立**证据路数定。三路以上才够格进结论——这是本层存在的全部意义。 */
  var TIERS = {
    // label 只写档位，不写路数——降档之后档位与路数未必对应（三路相争者降为 B 仍是三路），
    // 把路数塞进档名会自相矛盾。路数另行单列。
    A: { min: 3, label: 'A级', desc: '多路合流', use: '可写进结论' },
    B: { min: 2, label: 'B级', desc: '两路相合或多路相争', use: '可作次要可能，须并列写出' },
    C: { min: 1, label: 'C级', desc: '孤证或两路相争', use: '只能标「参考」，不得写成结论' },
    D: { min: 0, label: 'D级', desc: '无据或自相矛盾', use: '**不得出现在结论里**' }
  };

  function load(json) {
    DB = (json && json.votes && json.dimensions) ? json : null;
    return !!DB;
  }
  function isLoaded() { return !!DB; }

  function detectSchool(chart) {
    if (!chart) return 'zhuanpan';
    if (chart.renPanMen || chart.tianPanYi || chart.diPanShen) return 'feipan';
    return 'zhuanpan';
  }

  /** 一个宫里都有哪些能投票的元素。同一元素只取一次——别名不另算一路。 */
  function elementsAt(chart, gong, ws) {
    var g = String(gong), out = [];
    var a = (chart.jiuGongAnalysis || {})[g] || {};
    function add(el, kind, show) {
      if (!el) return;
      var k = kind + ':' + el;
      for (var i = 0; i < out.length; i++) if (out[i].key === k) return;
      out.push({ key: k, el: String(el), show: show || String(el), kind: kind, gong: g });
    }
    // 宫这一路显示成「离九宫」而不是光秃秃一个「9」
    add(g, 'gong', (a.gongName || '') + g + '宫');
    add(a.shen, 'shen');
    add(a.men, 'men');
    add(a.xing, 'xing');
    // 四害亦可投票（入墓主「能量深藏难发」）
    var w = (ws && ws.gongs) ? ws.gongs[g] : null;
    if (w && (w.harms || []).some(function (h) { return h.indexOf('入墓') >= 0; })) add('入墓', 'flag');
    return out;
  }

  /**
   * 主入口。
   * @param {object} args
   *   chart      —— 引擎输出的盘；必需
   *   focus      —— [{gong, roles:[..], primary:bool}] 关注宫。primary 者为用神落宫（方位以它为准）
   *   wangshuai  —— 可选，用于取四害
   *   options.dims —— 只算这几个维度（缺省全算）
   */
  function analyze(args) {
    args = args || {};
    var chart = args.chart || null;
    var ws = (args.wangshuai && args.wangshuai.gongs) ? args.wangshuai : null;
    var focus = (args.focus || []).filter(function (f) { return f && /^[1-9]$/.test(String(f.gong)); });
    var school = (args.options && args.options.school) || detectSchool(chart);

    var base = {
      version: VERSION, school: school, applicable: false, reason: '',
      dimensions: [], abstained: [], tiers: TIERS, notes: []
    };
    if (!DB) { base.reason = '维度表未加载，本层停用。'; return base; }
    if (!chart) { base.reason = '未提供盘面，本层停用。'; return base; }
    if (!focus.length) { base.reason = '未取得关注宫（用神/类象用神皆缺），无从合流。'; return base; }

    // 元素 → 票
    var byEl = {};
    DB.votes.forEach(function (v) {
      var k = v.kind + ':' + v.el;
      (byEl[k] = byEl[k] || []).push(v);
    });

    var wantDims = (args.options && args.options.dims) || Object.keys(DB.dimensions);
    var acc = {};   // dim -> value -> { sources:{key:src}, votes:[] }
    focus.forEach(function (f) {
      var isPrimary = !!f.primary;
      elementsAt(chart, f.gong, ws).forEach(function (e) {
        (byEl[e.key] || []).forEach(function (v) {
          if (wantDims.indexOf(v.dim) < 0) return;
          // 方位与场所以**用神落宫**为准（纲要：方位定处），非主用神宫的同类票不参与定位，
          // 免得旁宫的方位把用神宫的方位挤掉——那是另一回事，不是合流。
          if ((v.dim === '方位' || v.dim === '场所') && !isPrimary) return;
          var d = (acc[v.dim] = acc[v.dim] || {});
          var slot = (d[v.value] = d[v.value] || { sources: {}, votes: [] });
          slot.sources[e.key] = { el: e.el, show: e.show || e.el, kind: e.kind, gong: e.gong, roles: (f.roles || []).slice() };
          slot.votes.push({ el: e.el, kind: e.kind, gong: e.gong, basis: v.basis, note: v.note || '' });
        });
      });
    });

    var out = [], abstained = [];
    Object.keys(acc).sort().forEach(function (dim) {
      var meta = DB.dimensions[dim] || {};
      var opp = meta.opposites || {};
      var cands = Object.keys(acc[dim]).map(function (val) {
        var s = acc[dim][val];
        var n = Object.keys(s.sources).length;
        return {
          value: val, independent: n,
          sources: Object.keys(s.sources).sort().map(function (k) { return s.sources[k]; }),
          votes: s.votes
        };
      });
      // 对立检出：高 vs 低、显 vs 藏。两边都有据者一律降一档并标争持——不代为择一。
      cands.forEach(function (c) {
        var o = opp[c.value];
        c.contested = !!(o && acc[dim][o]);
        c.contestedBy = c.contested ? o : '';
      });
      cands.sort(function (a, b) {
        if (a.independent !== b.independent) return b.independent - a.independent;
        return a.value < b.value ? -1 : 1;
      });
      cands.forEach(function (c) {
        var t = c.independent >= TIERS.A.min ? 'A' : c.independent >= TIERS.B.min ? 'B' : 'C';
        if (c.contested) t = t === 'A' ? 'B' : t === 'B' ? 'C' : 'D';   // 争持者降一档
        c.tier = t;
        c.tierLabel = TIERS[t].label; c.tierDesc = TIERS[t].desc;
        c.use = TIERS[t].use;
      });
      var best = cands[0];
      var row = {
        dim: dim, label: meta.label || dim, candidates: cands,
        contested: cands.some(function (c) { return c.contested; }),
        top: best ? best.value : '', topTier: best ? best.tier : 'D'
      };
      out.push(row);
      // 弃权：本维度最好的也只到 C（孤证）或 D，则不给具体值
      if (!best || best.tier === 'C' || best.tier === 'D') {
        abstained.push({
          dim: dim, why: !best ? '本盘无票'
            : (best.contested ? '两说相争（' + best.value + ' ⇄ ' + best.contestedBy + '），证据不足以定其一'
              : '仅一路孤证（' + best.value + '），不足以写进结论')
        });
      }
    });

    out.sort(function (a, b) { return a.dim < b.dim ? -1 : 1; });
    base.dimensions = out;
    base.abstained = abstained;
    base.applicable = out.length > 0;
    base.reason = out.length
      ? '已按独立证据路数为各维度定档（同一元素的别名只算一路）。'
      : '关注宫内无可投票之象。';
    return base;
  }

  /** 合流结果 → 提示词文本块。坏数据返回空串，绝不阻断解读流程。 */
  function toPromptBlock(res) {
    if (!res || !res.applicable || !res.dimensions.length) return '';
    var L = [];
    L.push('');
    L.push('【证据合流 Converge v' + res.version + '】（数的是「有几路**互不相干**的证据指向同一结论」，不是象义多少）');
    L.push('· 档位与用法：**A级**（' + TIERS.A.desc + '，≥' + TIERS.A.min + ' 路）＝' + TIERS.A.use +
      '；**B级**（' + TIERS.B.desc + '）＝' + TIERS.B.use +
      '；**C级**（' + TIERS.C.desc + '）＝' + TIERS.C.use +
      '；**D级**（' + TIERS.D.desc + '）＝' + TIERS.D.use);
    L.push('· 同一元素的多个别名只算**一路**。五条同源的话不等于五路旁证——这正是此前把' +
      '「离九＝明亮处」一条孤证写成结论的由来。');
    res.dimensions.forEach(function (d) {
      L.push('· ' + d.label + (d.contested ? '　⚠ 两说相争' : '') + '：');
      d.candidates.forEach(function (c) {
        L.push('    [' + c.tierLabel + '｜' + c.independent + ' 路独立证据] ' + c.value +
          (c.contested ? '（与「' + c.contestedBy + '」相争，已降一档）' : '') +
          '　← ' + c.sources.map(function (s) { return s.show; }).join('、') +
          '　—— ' + c.use);
      });
    });
    if (res.abstained.length) {
      L.push('· **本次弃权的维度**（证据不足，不得硬编一个具体说法）：');
      res.abstained.forEach(function (a) {
        L.push('    · ' + a.dim + '：' + a.why + '。断语请照实说「此项证据不足，不锁定」，' +
          '不要凭一条孤证编出一个确指。');
      });
    }
    res.notes.forEach(function (n) { L.push('· 说明：' + n); });
    return L.join('\n');
  }

  return {
    load: load, isLoaded: isLoaded, detectSchool: detectSchool,
    elementsAt: elementsAt, analyze: analyze, toPromptBlock: toPromptBlock,
    TIERS: TIERS, VERSION: VERSION
  };
});
