/**
 * 奇门·力量校验(Severity) core —— 纯函数、无副作用、可移植。【Phase 9】
 *
 * 解决的问题：wangshuai 早已算出每宫的四害与力量、引擎早已给出每宫吉凶，
 * 但**二者从未对拍**。于是出现过这样的实测失误：
 *   某宫 引擎判「小吉」、力量 0.08（门迫 + 天盘干入墓），解读照断「有转机」。
 * 而纲要在四之二节把这件事写得很死：
 *   「旺相之凶格，凶亦有力；休囚之吉格，吉亦无力。**不可只看吉凶不看旺衰。**」
 *   「同宫多害则减力相乘……断语须明写"因×害故力弱"。」
 *   「衰死又入墓者：谋事难遂，**不可强断为吉**。」
 * 本模块不是新增断法，是把这几条**本就写死、却从未被执行**的禁令变成确定性检查。
 *
 * 关键边界（务必保持）：
 *   ① **不重算**力量与吉凶：力量取自 core/wangshuai.js，宫位吉凶取自引擎 jiuGongAnalysis，
 *      本层只做对拍与标注——两处若各推一套，模型必然选错。
 *   ② **不产出吉凶结论**，只产出禁令与提醒：说的是「不得据此断为吉」，不是「此事必凶」。
 *      占断的结论仍由模型据全盘作出，本层只拦住那几种纲要明令不许的说法。
 *   ③ 阈值由 wangshuai 的力量刻度反推（见 severity-rules.json 的 thresholds._why），非随手所定。
 *   ④ 只校验**关注宫**（用神宫 / 类象用神宫 / 值符 / 值使 / 日干宫 / 时干宫），不遍历全盘徒增噪音。
 *   ⑤ 两派通用：四条禁令在两份纲要中表述一致，出处各自注明，非由一派推及另一派。
 *   ⑥ 完全确定性：同盘同关注宫必得同一结果，排序稳定。
 *
 * 依赖：knowledge/severity-rules.json（须先 load() 注入）；
 *       core/wangshuai.js 的 analyze() 结果与引擎盘（由调用方传入，本模块不重算）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Severity = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB = null;
  var VERSION = '1.0.0';
  var SEV_RANK = { critical: 3, high: 2, medium: 1 };
  var JI = { da_ji: 2, xiao_ji: 1 };
  var XIONG = { da_xiong: 2, xiao_xiong: 1 };

  function load(json) {
    DB = (json && json.checks && json.thresholds) ? json : null;
    return !!DB;
  }
  function isLoaded() { return !!DB; }

  function detectSchool(chart) {
    if (!chart) return 'zhuanpan';
    if (chart.renPanMen || chart.tianPanYi || chart.diPanShen) return 'feipan';
    return 'zhuanpan';
  }

  /**
   * 关注宫及其来历。同一宫可由多个身份带进来（既是用神宫又是时干宫），全部记下——
   * 「哪一宫失力」要紧，「它是以什么身份要紧的」同样要紧。
   */
  function focusGongs(args) {
    var chart = args.chart || {};
    var map = {};
    function add(gong, who) {
      var g = String(gong || '');
      if (!/^[1-9]$/.test(g)) return;
      if (!map[g]) map[g] = [];
      if (map[g].indexOf(who) < 0) map[g].push(who);
    }
    var xy = args.xiangyi;
    if (xy && xy.applicable && xy.focus) {
      xy.focus.forEach(function (f) { add(f.gong, f.name + (f.aspect ? '(' + f.aspect + ')' : '')); });
    }
    (args.yongShenGongs || []).forEach(function (g) { add(g, '用神'); });
    var lx = args.leixiang;
    if (lx && lx.applicable && lx.candidates) {
      lx.candidates.forEach(function (c) {
        if (c.located) add(c.gong, c.symbol + '〔类象·所问「' + (c.terms || []).join('/') + '」〕');
      });
    }
    // 值符/值使/日干/时干宫：纲要 3.5 点名要称量的四处
    add(chart.zhiFuLuoGong || chart.zhiFuGong, '值符宫');
    add(chart.zhiShiGong, '值使宫');
    var ys = args.yongshen;
    if (ys && ys.examine) {
      ys.examine.forEach(function (m) {
        if (m.name === '日干' || m.name === '时干') add(m.gong, m.name + '宫');
      });
    }
    return map;
  }

  function harmsOf(w) { return (w && w.harms) ? w.harms.slice() : []; }
  function hasMu(w) {
    return !!(w && (w.ruMu || harmsOf(w).some(function (h) { return h.indexOf('入墓') >= 0; })));
  }

  /**
   * 主入口。
   * @param {object} args
   *   chart      —— 引擎输出的盘（取 jiuGongAnalysis 的宫位吉凶）；必需
   *   wangshuai  —— WangShuai.analyze(pan) 的结果；**必需**，缺则本层停用（绝不自行推算力量）
   *   xiangyi / leixiang / yongshen / yongShenGongs —— 可选，用于圈定关注宫
   */
  function analyze(args) {
    args = args || {};
    var chart = args.chart || null;
    var ws = (args.wangshuai && args.wangshuai.gongs) ? args.wangshuai : null;
    var school = (args.options && args.options.school) || detectSchool(chart);

    var base = {
      version: VERSION, school: school, applicable: false, reason: '',
      thresholds: null, gongs: [], findings: [], verdict: null, mustDo: [], notes: []
    };
    if (!DB) { base.reason = '力量校验规则库未加载，本层停用。'; return base; }
    if (!chart) { base.reason = '未提供盘面，本层停用。'; return base; }
    if (!ws) { base.reason = '未提供 wangshuai 结果；本层只做对拍、绝不自行推算力量，故停用。'; return base; }

    var TH = DB.thresholds;
    base.thresholds = { critical: TH.critical, weak: TH.weak, strong: TH.strong };
    var jga = chart.jiuGongAnalysis || {};
    var map = focusGongs(args);
    var gongList = Object.keys(map).sort();
    if (!gongList.length) {
      base.reason = '未取得任何关注宫（用神/值符值使/日干时干皆缺），无从校验。';
      return base;
    }

    var findings = [];
    function fire(name, gong, roles, detail) {
      var c = DB.checks[name];
      if (!c) return;
      findings.push({
        id: c.id, check: name, gong: gong, roles: roles.slice(),
        severity: c.severity, verdict: c.verdict, detail: detail,
        prohibition: c.prohibition, basis: c.basis
      });
    }

    gongList.forEach(function (g) {
      var w = ws.gongs[g] || {};
      var a = jga[g] || {};
      var power = typeof w.power === 'number' ? w.power : null;
      var harms = harmsOf(w);
      var jx = a.jiXiong || '';
      var row = {
        gong: g, gongName: a.gongName || '', direction: a.direction || '',
        roles: map[g].slice(),
        power: power, harms: harms,
        tianGan: w.tianGan || '', tianGanState: w.tianGanState || '',
        gongState: w.gongState || '',
        men: w.men || '', xing: w.xing || '', shen: a.shen || '',
        jiXiong: jx, jiXiongText: a.jiXiongText || ''
      };
      base.gongs.push(row);
      if (power == null) return;

      // ① 吉凶与力量背离：引擎判吉而力量不足 —— 纲要「休囚之吉格，吉亦无力」
      if (JI[jx] && power <= TH.weak) {
        fire('吉凶与力量背离', g, map[g],
          '引擎判此宫「' + (a.jiXiongText || jx) + '」，而其力量仅 ' + power +
          (harms.length ? '（' + harms.join('、') + '）' : '') + '，未达 ' + TH.weak + '。');
      }
      // ② 旺相之凶：引擎判凶而力量充足 —— 纲要「旺相之凶格，凶亦有力（凶得更凶）」
      if (XIONG[jx] && power >= TH.strong) {
        fire('旺相之凶', g, map[g],
          '引擎判此宫「' + (a.jiXiongText || jx) + '」，且力量达 ' + power + '（旺相未受折损）。');
      }
      // ③ 多害叠加 —— 纲要「断语须明写"因×害故力弱"」
      if (harms.length >= 2) {
        fire('多害叠加', g, map[g], '此宫犯 ' + harms.length + ' 害：' + harms.join('、') + '，力量 ' + power + '。');
      }
      // ④ 衰死又入墓 —— 纲要「谋事难遂，不可强断为吉」
      if ((w.tianGanState === '囚' || w.tianGanState === '死') && hasMu(w)) {
        fire('衰死入墓', g, map[g],
          '天盘' + (w.tianGan || '') + ' 值「' + w.tianGanState + '」而又入墓，力量 ' + power + '。');
      }
      // ⑤ 力量极弱 —— 纲要以「既入墓又击刑」为几近无力之例，其值恰为 0.1
      if (power <= TH.critical) {
        fire('力量极弱', g, map[g],
          '力量 ' + power + '，已在纲要所谓「几近无力」之量级' + (harms.length ? '（' + harms.join('、') + '）' : '') + '。');
      }
    });

    findings.sort(function (x, y) {
      var sx = SEV_RANK[x.severity] || 0, sy = SEV_RANK[y.severity] || 0;
      if (sx !== sy) return sy - sx;
      if (x.gong !== y.gong) return x.gong < y.gong ? -1 : 1;
      return x.id < y.id ? -1 : 1;
    });
    base.findings = findings;

    // 整盘口径：只是一句汇总描述，**不是整盘吉凶的预测**。
    // 以本机 61 例回测过：口径与实际应验结果无相关（none 31% 未应验、most 21%），
    // 故此处不产出「整盘偏凶」之类的推断——那等于把原来的乐观误判换个方向再犯一次。
    var impaired = {};
    findings.forEach(function (f) {
      if (f.severity === 'critical' || f.check === '多害叠加' || f.check === '吉凶与力量背离') impaired[f.gong] = 1;
    });
    var nImpaired = Object.keys(impaired).length, nAll = gongList.length;
    var level = nImpaired === 0 ? 'none' : (nImpaired * 2 >= nAll ? 'most' : 'some');
    base.verdict = {
      level: level, impaired: nImpaired, total: nAll,
      impairedGongs: Object.keys(impaired).sort(),
      note: (DB.chartVerdict.levels || {})[level] || ''
    };
    base.mustDo = (DB.mustDo || []).slice();
    base.applicable = findings.length > 0;
    base.reason = findings.length
      ? '已按纲要四之二节的禁令对拍力量与吉凶，' + findings.length + ' 处需在断语中照实写明。'
      : '关注宫未触发纲要所列的失力禁令（力量与吉凶无背离、无多害叠加、无衰死入墓）。';
    return base;
  }

  /** 力量校验 → 提示词文本块。坏数据返回空串，绝不阻断解读流程。 */
  function toPromptBlock(res) {
    if (!res || !res.applicable || !res.findings.length) return '';
    var L = [];
    var MARK = { critical: '‼', high: '⚠', medium: '·' };
    L.push('');
    L.push('【力量校验 Severity v' + res.version + '】（力量取自上方【旺衰与四害】、宫位吉凶取自引擎，此处只做对拍）');
    L.push('· 纲要把这件事写得很死：**吉凶定方向，旺衰定成败大小；不可只看吉凶不看旺衰**。' +
      '下列各条是本盘触发的**禁令**——不是叫你断凶，是这几种说法纲要不许下。');
    res.findings.forEach(function (f) {
      L.push('  ' + (MARK[f.severity] || '·') + ' [' + f.check + '] ' + f.gong + '宫（' + f.roles.join('、') + '）：' + f.detail);
      L.push('      → ' + f.verdict + '。' + f.prohibition);
    });
    if (res.verdict) {
      L.push('· 整盘口径：关注宫 ' + res.verdict.total + ' 处，其中 ' + res.verdict.impaired +
        ' 处已受重折' + (res.verdict.impairedGongs.length ? '（' + res.verdict.impairedGongs.join('、') + '宫）' : '') +
        '。' + res.verdict.note);
    }
    res.mustDo.forEach(function (m) { L.push('· ' + m); });
    var bs = [];
    res.findings.forEach(function (f) { if (bs.indexOf(f.basis) < 0) bs.push(f.basis); });
    L.push('· 依据：' + bs.join(' ／ '));
    return L.join('\n');
  }

  return {
    load: load, isLoaded: isLoaded, detectSchool: detectSchool,
    focusGongs: focusGongs, analyze: analyze, toPromptBlock: toPromptBlock,
    VERSION: VERSION
  };
});
