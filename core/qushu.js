/**
 * 奇门·取数(QuShu) core —— 纯函数、无副作用、可移植。【Phase 21】
 *
 * 解决的问题：此前全 app 只有**一个**数源——用神宫天/地盘干的河图数
 * （core/yingqi.js 算、core/timing.js §⑧ 送进证据包）。用神所落之宫**本身的宫数**
 * 从来不是候选：纲要「范围大则乘宫数/层数」一句里，宫数只当倍率使；先天八卦数则
 * 两份纲要皆无。用户 2026-09-03 在一例高考分数断错（断 560～580，实际 620）之后
 * 指出这一缺口——他的读法是 丁奇落乾六取 6、时干庚落坤二取 2，连读得 62、定量级得 620。
 *
 * 本层把「这一盘能取出哪些数」摊开列全，并**报出可达的相异数值个数**。
 *
 * 关键边界（务必保持）：
 *   ① **本层不给答案**，只给数源与算法。哪个用神、哪种组合、哪个量级由断者定。
 *   ② **两级出处不混同**：河图数/单取/相加/旺相足数休囚减半/乘宫数＝〔纲要原文〕；
 *      后天宫数作独立候选、先天卦数、连读、定量级＝〔用户所定·2026-09-03〕。
 *   ③ **候选越多，命中越不值钱**。故强制报 reachable 与 rate——「凑得出来」与
 *      「断得出来」当场分开。这是本层最要紧的一件事，不是附注。
 *   ④ 用户那一例 620 是**知道答案之后**凑出的，属事后复盘，不构成对连读法的验证。
 *   ⑤ **效应未测**：宫数入候选能不能提高取数准头，本仓一个数据都没有。
 *   ⑥ 两派通用：河图数与八卦/洛书宫数不涉任一派排盘断法，两份纲要各自都写了
 *      「河图数」一节且口径一致，故不构成串味。
 *
 * 不改 core/yingqi.js：它算的全盘河图数对照表照旧承载，本层是**在用神宫上**另加数源，
 * 两者同源不同职，绝不并列成两套推算。
 *
 * 依赖：knowledge/qushu-rules.json（须先 load() 注入）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuShu = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB = null;
  var VERSION = '1.0.0';

  var HALF_STATES = { '休': 1, '囚': 1, '死': 1 };

  function load(json) {
    DB = (json && json.sources && json.heTu && json.compose && json.adjust) ? json : null;
    return !!DB;
  }
  function isLoaded() { return !!DB; }

  function heTuOf(gan) {
    if (!DB || !gan) return null;
    var n = DB.heTu[gan];
    return typeof n === 'number' ? n : null;
  }
  function xianTianOf(gong) {
    if (!DB) return null;
    var m = (DB.sources.xiantian || {}).map || {};
    var n = m[String(gong)];
    return typeof n === 'number' ? n : null;   // 中五宫无先天卦数，返回 null
  }
  function houTianOf(gong) {
    var n = parseInt(gong, 10);
    return (n >= 1 && n <= 9) ? n : null;
  }

  /** 休囚死者减半（向下取整）与取个位——纲要两法并存，皆列出，由断者声明取哪一种。 */
  function halveOf(n) { return n == null ? null : Math.floor(n / 2); }
  function unitOf(n) { return n == null ? null : (n % 10); }

  function dedupeNum(arr) {
    var seen = {}, out = [];
    arr.forEach(function (n) {
      if (n == null || !isFinite(n)) return;
      if (!seen[n]) { seen[n] = 1; out.push(n); }
    });
    return out.sort(function (a, b) { return a - b; });
  }

  /**
   * 主入口。
   * @param {object} args
   *   yongshen  —— YongShen.analyze() 的结果（用其 examine：name/gong/tianGan/diGan）
   *   wangshuai —— WangShuai.analyze(pan) 的结果；缺省则旺衰不明，足数/减半不判（degraded）
   *   options.school       —— 'zhuanpan' | 'feipan'
   *   options.maxTargets   —— 参与取数的用神个数上限（缺省 4；用神越多可达数越爆炸）
   * @returns {object} 数源表 + 候选格 + 可达度量；**不含任何选定之数**。
   */
  function analyze(args) {
    args = args || {};
    var ys = args.yongshen || null;
    var ws = args.wangshuai || null;
    var opts = args.options || {};
    var school = opts.school === 'feipan' ? 'feipan' : 'zhuanpan';
    var maxT = typeof opts.maxTargets === 'number' ? opts.maxTargets : 4;

    var base = {
      version: VERSION, school: school, applicable: false, reason: '',
      degraded: '', targets: [], candidates: [], reachable: 0, span: null,
      compose: [], discipline: [], notes: []
    };
    if (!DB) { base.reason = '取数规则库未载入，本次不排取数层。'; return base; }
    if (!ys || !ys.examine || !ys.examine.length) {
      base.reason = '本盘未定出用神落宫，取数无所依附。';
      base.notes.push('纲要取数一律以**用神宫**（或值符宫）为据，无用神即无数源，不得改由他宫凑数。');
      return base;
    }
    if (!ws) base.degraded = '未提供旺衰，故「旺相足数／休囚减半」一条本次不判，所出河图数一律按足数列，另附减半与个位两个备选。';

    /* ---------- ① 逐用神列数源 ---------- */
    ys.examine.slice(0, maxT).forEach(function (m) {
      var g = String(m.gong || '');
      if (!g) return;
      var cell = (ws && ws.gongs && ws.gongs[g]) || null;
      var gongState = cell ? cell.gongState : '';
      // 「旺相足数、休囚减半或取个位」一句紧接河图数而言，旺相的主语是**那个干**，
      // 不是那个宫——数是干的数，旺衰自然也该论干。初版误以宫的旺衰裁之，
      // 于是出现「宫死·力量约1」旁边跟着「天盘庚河图=9(减半4)」这种自相矛盾的呈现：
      // 宫与干本就可以一衰一旺，拿宫去裁干的数，减对了也是碰巧。
      // 宫的旺衰仍照常显示（那是读盘的背景），但不再拿它当裁量的依据。
      var tState = cell ? cell.tianGanState : '';
      var dState = cell ? cell.diGanState : '';
      var tNum = heTuOf(m.tianGan), dNum = heTuOf(m.diGan);
      var tHalf = !!HALF_STATES[tState], dHalf = !!HALF_STATES[dState];
      base.targets.push({
        name: m.name, resolved: m.resolved || m.name, origin: m.origin || '',
        gong: g, gongName: m.gongName || '', direction: m.direction || '',
        gongState: gongState, power: cell ? cell.power : null,
        harms: cell ? (cell.harms || []).slice() : [],
        sources: {
          hetuTian: tNum == null ? null : {
            gan: m.tianGan, state: tState, adjust: ws ? (tHalf ? 'half' : 'full') : 'unknown',
            full: tNum, half: halveOf(tNum), unit: unitOf(tNum)
          },
          hetuDi: dNum == null ? null : {
            gan: m.diGan, state: dState, adjust: ws ? (dHalf ? 'half' : 'full') : 'unknown',
            full: dNum, half: halveOf(dNum), unit: unitOf(dNum)
          },
          houtian: houTianOf(g),
          xiantian: xianTianOf(g)
        },
        // 旺衰只裁河图数一路：宫数该不该随旺衰增减，纲要与用户皆未言，本层不代为增减。
        // 天地两干各判各的——一宫之内一干旺一干衰是常事，不该被折成同一档。
        adjust: ws ? ((tHalf || dHalf) ? 'half' : 'full') : 'unknown',
        adjustNote: ws
          ? ('天盘' + (m.tianGan || '—') + (tState ? tState : '?') +
             '、地盘' + (m.diGan || '—') + (dState ? dState : '?') +
             '：旺相者取足数，休囚死者减半或取个位（两法并存，须声明取哪一种）——' +
             '论的是**干**的旺衰，不是宫的（本宫为' + (gongState || '?') + '）')
          : '旺衰未提供，河图数按足数列，另附减半与个位两个备选',
        gongNumNote: '宫数（后天／先天）本层一律出足数——纲要「旺相足数、休囚减半」一句紧接河图数而言，未及宫数。'
      });
    });
    if (!base.targets.length) {
      base.reason = '用神虽定，但皆无可用之宫（如中宫寄、甲不上天盘），取数无据。';
      return base;
    }
    base.applicable = true;
    if (ys.examine.length > maxT) {
      base.notes.push('本盘用神 ' + ys.examine.length + ' 个，取数只列权重最高的 ' + maxT +
        ' 个——用神每多一个，可达之数便翻几番，多列反而更容易事后凑数。');
    }

    /* ---------- ② 候选格：逐法生成，每条都带出处 ---------- */
    var byMethod = {};
    function push(method, value, how, from) {
      if (value == null || !isFinite(value)) return;
      var meta = null;
      (DB.compose || []).forEach(function (c) { if (c.id === method) meta = c; });
      if (!byMethod[method]) byMethod[method] = [];
      byMethod[method].push({
        method: method, label: meta ? meta.label : method,
        level: meta ? meta.level : '', basis: meta ? meta.basis : '',
        value: value, how: how, from: from
      });
    }

    base.targets.forEach(function (t) {
      var s = t.sources, tag = t.name + '@' + t.gong + '宫';
      // 单取：河图数（足数／减半／个位）与两路宫数
      // 天地两干各按**自己**的旺衰出候选：旺相者只出足数，休囚死者另出减半与个位。
      [[s.hetuTian, '天盘'], [s.hetuDi, '地盘']].forEach(function (pair) {
        var src = pair[0], side = pair[1];
        if (!src) return;
        push('single', src.full, side + src.gan + (src.state ? src.state : '') + '·河图数足数', tag);
        if (src.adjust !== 'full') {
          push('single', src.half, side + src.gan + (src.state ? src.state : '') + '·河图数减半', tag);
          push('single', src.unit, side + src.gan + (src.state ? src.state : '') + '·河图数取个位', tag);
        }
      });
      if (s.houtian != null) push('single', s.houtian, '后天宫数', tag);
      if (s.xiantian != null) push('single', s.xiantian, '先天卦数', tag);
      // 相加：纲要只许「两干相加」，故只加同宫天地两干之河图数，不把宫数加进去
      if (s.hetuTian && s.hetuDi) {
        push('sum', s.hetuTian.full + s.hetuDi.full,
          '天' + s.hetuTian.gan + s.hetuTian.full + ' + 地' + s.hetuDi.gan + s.hetuDi.full, tag);
      }
      // 乘宫数：纲要「范围大则乘宫数/层数」
      if (s.hetuTian && s.houtian != null) {
        push('scale', s.hetuTian.full * s.houtian,
          '天' + s.hetuTian.gan + s.hetuTian.full + ' × 宫数' + s.houtian, tag);
      }
      if (s.hetuDi && s.houtian != null) {
        push('scale', s.hetuDi.full * s.houtian,
          '地' + s.hetuDi.gan + s.hetuDi.full + ' × 宫数' + s.houtian, tag);
      }
    });

    // 连读：〔用户所定〕两用神各出一数按位连读。次序不定，故正反两序皆列——
    // 正因两序皆通，用此法必须先说清凭什么是这个次序，否则与事后凑数无异。
    for (var i = 0; i < base.targets.length; i++) {
      for (var j = 0; j < base.targets.length; j++) {
        if (i === j) continue;
        var a = base.targets[i], b = base.targets[j];
        if (a.sources.houtian == null || b.sources.houtian == null) continue;
        push('concat', a.sources.houtian * 10 + b.sources.houtian,
          a.name + '宫数' + a.sources.houtian + ' 连读 ' + b.name + '宫数' + b.sources.houtian,
          a.name + '@' + a.gong + '宫 + ' + b.name + '@' + b.gong + '宫');
      }
    }

    ['single', 'sum', 'scale', 'concat'].forEach(function (k) {
      (byMethod[k] || []).forEach(function (c) { base.candidates.push(c); });
    });

    /* ---------- ③ 可达度量：把「凑得出来」和「断得出来」分开 ---------- */
    var vals = dedupeNum(base.candidates.map(function (c) { return c.value; }));
    base.reachable = vals.length;
    base.span = vals.length ? { min: vals[0], max: vals[vals.length - 1], values: vals } : null;
    base.notes.push('本盘取数层可达 ' + base.reachable + ' 个相异数值（' +
      (base.span ? base.span.min + '～' + base.span.max : '—') + '），尚未计入「定量级」的移位——' +
      '移位一开，同一批数在每个量级各来一遍。**给出答案时须说明凭什么在这些候选里选中这一个**；' +
      '理由若只是「它最接近某个已知值」，那不是断，是拟合，此时应当直说断不出。');

    base.compose = (DB.compose || []).map(function (c) {
      return { id: c.id, label: c.label, level: c.level, basis: c.basis, note: c.note };
    });
    base.discipline = (DB.discipline || []).slice();
    return base;
  }

  /** 生成喂给 AI 的取数文本块。 */
  function toPromptBlock(res) {
    if (!res || !res.version) return '';
    var L = ['', '【取数（定数字/分数/价格/数量/号码）　QuShu v' + res.version + '】'];
    if (!res.applicable) {
      L.push('· 本次不排取数层：' + (res.reason || '条件不足'));
      (res.notes || []).forEach(function (n) { L.push('· ' + n); });
      return L.join('\n');
    }
    if (res.degraded) L.push('· 降级：' + res.degraded);

    L.push('· 数源（逐用神列全；宫数一路是本次新补，此前只有河图数一路）：');
    res.targets.forEach(function (t) {
      var s = t.sources, parts = [];
      if (s.hetuTian) parts.push('天盘' + s.hetuTian.gan + s.hetuTian.state + '河图=' + s.hetuTian.full +
        (s.hetuTian.adjust !== 'full' ? '(减半' + s.hetuTian.half + '/个位' + s.hetuTian.unit + ')' : ''));
      if (s.hetuDi) parts.push('地盘' + s.hetuDi.gan + s.hetuDi.state + '河图=' + s.hetuDi.full +
        (s.hetuDi.adjust !== 'full' ? '(减半' + s.hetuDi.half + '/个位' + s.hetuDi.unit + ')' : ''));
      if (s.houtian != null) parts.push('后天宫数=' + s.houtian);
      parts.push(s.xiantian != null ? '先天卦数=' + s.xiantian : '先天卦数=无(中五宫无卦)');
      L.push('  - ' + t.name + (t.resolved && t.resolved !== t.name ? '(' + t.resolved + ')' : '') +
        ' 落 ' + t.gong + '宫' + (t.gongName ? '(' + t.gongName + (t.direction ? '·' + t.direction : '') + ')' : '') +
        (t.gongState ? '·宫' + t.gongState : '') + (t.power != null ? '·力量约' + t.power : '') +
        '：' + parts.join('、'));
      L.push('    ' + t.adjustNote + '；' + t.gongNumNote);
    });

    L.push('· 组合法（逐条出处不同，用哪条就报哪条的出处，不得混称）：');
    (res.compose || []).forEach(function (c) {
      L.push('  - ' + c.label + '〔' + c.level + '〕：' + c.note);
    });

    if (res.span) {
      L.push('· 可达候选：本盘按上列数源与组合法可达 **' + res.reachable + ' 个相异数值**（' +
        res.span.min + '～' + res.span.max + '）：' + res.span.values.join('、') +
        '。「定量级」的移位尚未计入——移位一开，这批数在每个量级各来一遍。');
    }
    (res.discipline || []).forEach(function (d) { L.push('· 纪律：' + d); });
    (res.notes || []).forEach(function (n) { L.push('· 说明：' + n); });
    // 这一句每次都要出：宫数这一路补进来，是因为原先缺一个数源，不是因为它测出来更准。
    // 只在证据包那一段写而独立块不写，等于换个入口就把话吞了。
    L.push('· ※ 宫数入候选能不能让数字题更准，本仓**一个数据都没有**（未测）。' +
      '补它是因为原先缺一个数源，不是因为它更准。');
    return L.join('\n');
  }

  return {
    load: load, isLoaded: isLoaded,
    heTuOf: heTuOf, xianTianOf: xianTianOf, houTianOf: houTianOf,
    analyze: analyze, toPromptBlock: toPromptBlock,
    VERSION: VERSION
  };
});
