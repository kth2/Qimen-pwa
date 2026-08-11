/**
 * 奇门·应期时间线(Timing) core —— 纯函数、无副作用、可移植。【Phase 4】
 *
 * 解决的问题：core/yingqi.js 已把应期所需的具体干支算准（填实/冲实/冲墓/马星/宫干日辰/河图数），
 * 但它输出的是一张**平铺的表**——九宫干日全列、空亡冲墓并陈。谁要紧、谁先到、为什么是这个日子，
 * 仍要模型自己从表里挑。实测中模型常挑到与本占用神毫无关系的宫干日，或把空亡的填实之期
 * 与入墓的冲墓之期混作一谈。本模块补上这一层：
 *   ① 只留与**本占用神**相关的锚点（用神与权重取自 core/xiangyi.js，故随占类而变）；
 *   ② 给每个锚点标注机制、强弱与出处（强弱不是打分，是机制与用神的关系，见 knowledge/timing-rules.json）；
 *   ③ 按**距今位次**排出先后，把一堆并列的日子变成一条有次序的时间线；
 *   ④ 依权重最高之用神的旺衰定应期迟速（纲要·三节应期5）。
 *
 * 关键边界（务必保持）：
 *   ① **绝不重算干支**。填实/冲实/冲墓/马星/宫干日辰一律取自 YingQi.analyze() 的结果，
 *      本模块只做筛选、定强弱与排序——避免与【应期与数字】块出现两套说法。
 *   ② 不产出「必于某日应验」。锚点是候选时点与其机制依据，断日/断月/断年仍须结合问事远近，
 *      由模型综合（纲要·三节应期5：近事看日时、中事看月、远事看年）。
 *   ③ 零串味到**机制**一级：填实/冲实、冲墓、宫干定日在两派纲要中表述一致，故两派通用；
 *      马星只见于转盘纲要应期节，故只在转盘启用。用神取用仍分派——转盘用 xiangyi 的占类用神，
 *      飞盘退回引擎自算的用神宫，绝不把转盘占类取用带入飞盘。
 *   ④ 完全确定性：同盘同占类必得同一结果，排序稳定。
 *
 * 依赖：knowledge/timing-rules.json（须先 load() 注入）；
 *       core/yingqi.js 的 analyze() 结果（由调用方传入，本模块不重算）；
 *       可选 core/xiangyi.js 的结果（提供占类用神与权重）与 core/wangshuai.js 的结果（定迟速）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Timing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB = null;
  var VERSION = '4.0.0';
  var MAX_ANCHORS = 12;   // 应期锚点不宜多：候选越多越等于没给答案

  function load(rulesJson) {
    DB = (rulesJson && rulesJson.mechanisms) ? rulesJson : null;
    return !!DB;
  }
  function isLoaded() { return !!DB; }

  /** 与 yongshen.js / xiangyi.js detectSchool 同规则。 */
  function detectSchool(chart) {
    if (!chart) return 'zhuanpan';
    if (chart.renPanMen || chart.tianPanYi || chart.diPanShen) return 'feipan';
    return 'zhuanpan';
  }

  /**
   * 距今位次：从本盘日支(或日干)数到目标支(或干)还有几位。
   * 地支 12 位循环、天干 10 位循环；0 表示就在今日。
   * 这不是「几天后」的断言——只是同一循环内的先后次序，用来把并列的候选排成时间线。
   */
  function offsetIn(order, from, to) {
    if (!order || !from || !to) return null;
    var i = order.indexOf(from), j = order.indexOf(to);
    if (i < 0 || j < 0) return null;
    return (j - i + order.length) % order.length;
  }

  function firstChar(s) { return s ? String(s).charAt(0) : ''; }

  /**
   * 本占的用神落宫 → 权重与角色。
   * 转盘：取 xiangyi.focus（占类相关、带权重）。
   * 飞盘或 xiangyi 停用时：退回 options.yongShenGongs（引擎自算，不带占类语义），权重一律记 0，
   * 如实表示「知道是用神宫，但不知其在本占中的分量」——不代为编造权重。
   */
  function buildTargets(xy, options) {
    var byGong = {}, source = '';
    function add(gong, entry) {
      var g = String(gong);
      if (!g || g === 'undefined') return;
      if (!byGong[g]) byGong[g] = [];
      byGong[g].push(entry);
    }
    if (xy && xy.applicable && xy.focus && xy.focus.length) {
      source = 'xiangyi';
      xy.focus.forEach(function (f) {
        add(f.gong, { name: f.name, aspect: f.aspect || '', weight: f.weight || 0, roleType: f.roleType || '' });
      });
    } else if (options.yongShenGongs && options.yongShenGongs.length) {
      source = 'engine';
      options.yongShenGongs.forEach(function (g) {
        add(g, { name: '用神', aspect: '', weight: 0, roleType: '' });
      });
    }
    return { byGong: byGong, source: source };
  }

  function targetsAt(targets, gong) {
    var list = (targets.byGong[String(gong)] || []).slice();
    list.sort(function (a, b) { return b.weight !== a.weight ? b.weight - a.weight : (a.name < b.name ? -1 : 1); });
    return list;
  }
  function maxWeight(list) {
    var w = 0;
    list.forEach(function (t) { if (t.weight > w) w = t.weight; });
    return w;
  }

  var STRENGTH_RANK = { high: 3, medium: 2, low: 1 };

  /**
   * 主入口。
   * @param {object} args
   *   chart      —— 引擎输出的盘（取日支/日干以算位次）
   *   yingqi     —— YingQi.analyze(pan) 的结果；**必需**，缺则本层停用（绝不自行推算干支）
   *   xiangyi    —— 可选，XiangYi.analyze() 的结果，提供占类用神与权重
   *   wangshuai  —— 可选，WangShuai.analyze(pan) 的结果，用于定应期迟速
   *   options.school / options.yongShenGongs / options.domain
   */
  function analyze(args) {
    args = args || {};
    var chart = args.chart || null;
    var options = args.options || {};
    var yq = args.yingqi || null;
    var xy = args.xiangyi || null;
    var ws = (args.wangshuai && args.wangshuai.gongs) ? args.wangshuai : null;
    var school = options.school || detectSchool(chart);
    var domain = options.domain || (xy && xy.domain) || '';

    var base = {
      version: VERSION, domain: domain, school: school,
      applicable: false, reason: '',
      dayZhi: '', dayGan: '',
      anchors: [], timeline: [], pace: null, horizon: null,
      numbers: [], targetSource: '', notes: []
    };

    if (!DB) { base.reason = '应期规则库未加载，本层停用。'; return base; }
    if (!yq) { base.reason = '未提供 yingqi 计算结果；本层只做筛选排序、绝不自行推算干支，故停用。'; return base; }

    var sz = (chart && chart.siZhu) || yq.siZhu || {};
    base.dayGan = String(sz.day || '').charAt(0);
    base.dayZhi = String(sz.day || '').charAt(1);
    if (!base.dayZhi) { base.reason = '盘面缺日柱，无从计算距今位次。'; return base; }

    var targets = buildTargets(xy, options);
    base.targetSource = targets.source;
    if (!targets.source) {
      base.notes.push('未取得用神落宫（占类象义层停用且未传 yongShenGongs），锚点无法按用神主次排序，一律记为参考级。');
    }

    var ZHI = DB.zhiOrder || [], GAN = DB.ganOrder || [];
    var out = [];
    var seq = 0;

    function mech(name) { return DB.mechanisms[name] || null; }
    function enabled(name) {
      var m = mech(name);
      return !!m && (m.appliesTo || []).indexOf(school) >= 0;
    }
    function push(mechName, value, gong, extra) {
      var m = mech(mechName);
      if (!m) return;
      var kind = m.kind === 'gan' ? 'gan' : 'zhi';
      var unit = kind === 'gan' ? '干日' : '地支日';
      var tg = targetsAt(targets, gong);
      // 强弱＝机制与用神的关系，非打分。级别由规则库显式声明（mechanism.onTarget），
      // 不由描述字段的有无去推断——落到用神宫才谈得上强弱，否则一律 low。
      var strength = tg.length ? (m.onTarget || 'medium') : 'low';
      var order = kind === 'gan' ? GAN : ZHI;
      var offset = offsetIn(order, kind === 'gan' ? base.dayGan : base.dayZhi, value);
      out.push({
        id: mechName + ':' + value + '@' + (gong || '-') + '#' + (seq++),
        mechanism: mechName, label: m.label || mechName,
        kind: kind, value: value, display: value + '日',
        unit: unit, why: tg.length ? (m.onTargetWhy || '') : '所指之宫非本占用神宫',
        gong: gong ? String(gong) : '',
        targets: tg, weight: maxWeight(tg), strength: strength,
        offset: offset, cycle: order.length,
        basis: m.basis || '', caution: m.caution || '',
        note: (extra && extra.note) || ''
      });
    }

    /* ---------- ① 空亡 → 填实 / 冲实（纲要：须待填实/冲实之时方应） ---------- */
    var kw = yq.kongWang || {};
    var kwGongs = (kw.gongs || []).map(String);
    (kw.tianShi || []).forEach(function (d, i) {
      if (!enabled('填实')) return;
      // 填实之支与空亡宫一一对应；宫数与支数不等时不强行配对，改记全部空亡宫
      var g = kwGongs.length === (kw.tianShi || []).length ? kwGongs[i] : (kwGongs[0] || '');
      push('填实', firstChar(d), g, { note: '空亡支 ' + firstChar(d) + ' 当值之日' });
    });
    (kw.chongShi || []).forEach(function (d, i) {
      if (!enabled('冲实')) return;
      var g = kwGongs.length === (kw.chongShi || []).length ? kwGongs[i] : (kwGongs[0] || '');
      push('冲实', firstChar(d), g, { note: '冲动空亡支之日' });
    });

    /* ---------- ② 入墓 → 冲墓（纲要：旺相而入墓者，应期多在冲墓之时） ---------- */
    if (enabled('冲墓')) {
      (yq.ruMu || []).forEach(function (m) {
        push('冲墓', firstChar(m.chongMu), m.gong,
          { note: m.where + m.gan + ' 墓于 ' + m.gong + '宫（墓库支' + m.muZhi + '），冲开则发' });
      });
    }

    /* ---------- ③ 马星发动（仅转盘：飞盘纲要应期节未列此法） ---------- */
    if (enabled('马星') && yq.maXing && yq.maXing.zhi) {
      push('马星', yq.maXing.zhi, yq.maXing.gong, { note: '驿马临 ' + yq.maXing.gong + '宫，动象之期；亦可取寅申巳亥之日/月' });
    }

    /* ---------- ④ 用神宫干定日（只取用神宫；全九宫的干日表由 yingqi 块承载，此处不重复倾倒） ---------- */
    if (enabled('宫干定日')) {
      Object.keys(targets.byGong).forEach(function (g) {
        var gg = (yq.gongGan || {})[g];
        if (!gg) return;
        if (gg.tianGan) push('宫干定日', gg.tianGan, g, { note: '用神宫天盘干 ' + gg.tianGan });
        if (gg.diGan && gg.diGan !== gg.tianGan) push('宫干定日', gg.diGan, g, { note: '用神宫地盘干 ' + gg.diGan });
      });
    }

    /* ---------- ⑤ 排序：先按强弱，再按用神权重，最后按距今位次（同分以 id 稳定） ---------- */
    out.sort(function (a, b) {
      var sa = STRENGTH_RANK[a.strength] || 0, sb = STRENGTH_RANK[b.strength] || 0;
      if (sa !== sb) return sb - sa;
      if (a.weight !== b.weight) return b.weight - a.weight;
      var oa = a.offset == null ? 99 : a.offset, ob = b.offset == null ? 99 : b.offset;
      if (oa !== ob) return oa - ob;
      return a.id < b.id ? -1 : 1;
    });
    if (out.length > MAX_ANCHORS) {
      base.notes.push('应期锚点命中 ' + out.length + ' 条，按强弱与用神权重取前 ' + MAX_ANCHORS + ' 条。');
      out = out.slice(0, MAX_ANCHORS);
    }
    base.anchors = out;

    // 时间线：同一批锚点按「距今位次」重排，回答"先到哪个"
    base.timeline = out.slice().sort(function (a, b) {
      var oa = a.offset == null ? 99 : a.offset, ob = b.offset == null ? 99 : b.offset;
      if (oa !== ob) return oa - ob;
      var sa = STRENGTH_RANK[a.strength] || 0, sb = STRENGTH_RANK[b.strength] || 0;
      if (sa !== sb) return sb - sa;
      return a.id < b.id ? -1 : 1;
    });

    /* ---------- ⑥ 迟速：以权重最高之用神的旺衰定（纲要·三节应期5） ---------- */
    if (ws && xy && xy.applicable && xy.focus && xy.focus.length) {
      var lead = xy.focus[0];
      var st = lead.state || (ws.gongs[lead.gong] || {}).gongState || '';
      var row = st ? (DB.pace.map || {})[st] : null;
      if (row) {
        var extra = [];
        if ((lead.flags || []).indexOf('入墓') >= 0) extra.push('惟其入墓，纵旺相亦须待冲墓方发');
        if ((lead.flags || []).indexOf('空亡') >= 0) extra.push('惟其空亡，须待填实/冲实方应');
        base.pace = {
          from: lead.name, aspect: lead.aspect || '', gong: lead.gong, state: st,
          speed: row.speed, note: row.note + (extra.length ? '；' + extra.join('；') : ''),
          basis: DB.pace.basis + (extra.length ? ' ' + DB.pace.muNote : '')
        };
      }
    }

    /* ---------- ⑦ 数字：只取用神宫的河图数（全盘对照表仍由 yingqi 块承载） ---------- */
    Object.keys(targets.byGong).forEach(function (g) {
      var gg = (yq.gongGan || {})[g];
      if (!gg) return;
      base.numbers.push({
        gong: g, targets: targetsAt(targets, g).map(function (t) { return t.name; }),
        tianGan: gg.tianGan, tianNum: gg.tianNum, diGan: gg.diGan, diNum: gg.diNum
      });
    });
    base.numbers.sort(function (a, b) { return a.gong < b.gong ? -1 : 1; });

    base.horizon = DB.horizon ? { guidance: DB.horizon.guidance, basis: DB.horizon.basis } : null;
    base.applicable = base.anchors.length > 0;
    base.reason = base.applicable
      ? '已按机制与用神权重筛出应期锚点（干支全部取自 yingqi 计算，未另推）。'
      : '本盘无可用应期锚点（无空亡/入墓/驿马，且未取得用神宫干）。';
    return base;
  }

  /** 应期结果 → 提示词文本块。坏数据返回空串，绝不阻断解读流程。 */
  function toPromptBlock(res) {
    if (!res || !res.applicable || !res.anchors.length) return '';
    var L = [];
    var SPEED = { high: '★强', medium: '★中', low: '★参考' };
    L.push('');
    L.push('【应期时间线 Timing v' + res.version + (res.domain ? '　占类：' + res.domain : '') + '】');
    L.push('· 下列干支**全部取自上方【应期与数字】块的同一组计算**，本层只做「挑出与本占用神相关者、' +
      '定其强弱、排出先后」，未另推一套。取期请只在这些候选中选，不得自造日辰。');
    if (res.targetSource === 'engine') {
      L.push('· 用神落宫取自引擎自算（未启用占类象义层），故只分主次不分权重。');
    } else if (!res.targetSource) {
      L.push('· 未取得用神落宫，以下锚点均为参考级，请结合盘面自行判定主次。');
    }
    L.push('· 应期锚点（按强弱与用神权重排序）：');
    res.anchors.forEach(function (a) {
      var who = a.targets.length
        ? a.targets.map(function (t) { return t.name + (t.aspect ? '(' + t.aspect + ')' : ''); }).join('、')
        : '非用神宫';
      L.push('  - [' + (SPEED[a.strength] || '') + '] ' + a.label + '：' + a.value + '日' +
        (a.gong ? '　(' + a.gong + '宫' + ')' : '') + '　用神：' + who +
        (a.note ? '　—— ' + a.note : ''));
    });
    L.push('· 先后次序（同一循环内距今位次，仅表先到后到，不是"几天后"的断言）：' +
      res.timeline.map(function (a) {
        return a.value + '日(' + a.label + (a.offset == null ? '' : '·第' + a.offset + '位') + ')';
      }).join(' → '));
    if (res.pace) {
      L.push('· 迟速：以 ' + res.pace.from + (res.pace.aspect ? '(' + res.pace.aspect + ')' : '') +
        ' 落 ' + res.pace.gong + '宫' + res.pace.state + ' 论，应期偏「' + res.pace.speed + '」——' + res.pace.note +
        '　（依据：' + res.pace.basis + '）');
    }
    if (res.numbers.length) {
      L.push('· 用神宫河图数（定数量/号码时优先取此，非用神宫之数不取）：' +
        res.numbers.map(function (n) {
          return n.gong + '宫[' + (n.targets.join('/') || '用神') + ']天' + n.tianGan + '=' + n.tianNum +
            '、地' + n.diGan + '=' + n.diNum;
        }).join('；'));
    }
    if (res.horizon) L.push('· 断日/断月/断年：' + res.horizon.guidance + '　（依据：' + res.horizon.basis + '）');
    // 机制自带的禁令逐条带出——这是实测最容易被绕过的地方
    var cautions = [];
    res.anchors.forEach(function (a) { if (a.caution && cautions.indexOf(a.caution) < 0) cautions.push(a.caution); });
    if (cautions.length) L.push('· 注意：' + cautions.join(' '));
    if (res.notes.length) res.notes.forEach(function (n) { L.push('· 说明：' + n); });
    return L.join('\n');
  }

  return {
    load: load, isLoaded: isLoaded,
    detectSchool: detectSchool,
    offsetIn: offsetIn,
    analyze: analyze, toPromptBlock: toPromptBlock,
    VERSION: VERSION
  };
});
