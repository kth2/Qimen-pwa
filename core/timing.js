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
  var VERSION = '5.0.0';
  var MAX_ANCHORS = 12;   // 应期锚点不宜多：候选越多越等于没给答案

  /* 单位 → 四柱中的哪一柱。同一个支在不同柱上各读一次，故位次也各按各柱起算。 */
  var PILLAR_OF = { '时': 'time', '日': 'day', '月': 'month', '年': 'year' };
  var UNIT_ORDER = ['时', '日', '月', '年'];

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
   * 距今位次：从本盘某柱之支(或干)数到目标支(或干)还有几位。地支 12 位循环、天干 10 位循环。
   * 四柱各支逐位递进（日支一日一位、月支一月一位、年支一年一位、时支一辰一位），
   * 故此位次就是**该候选下一次出现的真实距离**：0＝正当其时，2＝两位之后。
   * 但「候选何时再来」是历法事实，「事情是否应在那时」是另一回事——后者仍由模型据全盘定夺。
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
  function buildTargets(xy, options, lx) {
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
    /* 类象用神也是用神（纲要二节表尾「人/物/事各取对应符号」），故其落宫同样是用神宫，
     * 「用神宫干支定日」「用神入墓→冲墓」等法照样适用——问钥匙何时寻见、货款何时到账，
     * 靠的正是所问之物那一宫，而不是值符值使那几宫。
     * 但**不给它编造占类权重**：占类权重出自 domain-rules 的 roles，类象用神不在其中，
     * 故一律记 0，如实表示「知道是用神宫，但纲要没说它在本占中占多少分量」。 */
    if (lx && lx.applicable && lx.candidates) {
      lx.candidates.forEach(function (c) {
        if (!c.located || !c.gong) return;
        // 同名同宫者（如失物占里的玄武，既是占类用神又被类象取中）不另立一条，
        // 只在原条目上补记类象来历——否则用神名单里会出现「玄武、玄武」。
        var exist = (byGong[String(c.gong)] || []).filter(function (t) { return t.name === c.symbol; })[0];
        if (exist) {
          exist.leixiang = true;
          exist.terms = (c.terms || []).slice();
          if (!exist.aspect) exist.aspect = c.matched || '';
          return;
        }
        add(c.gong, {
          name: c.symbol, aspect: c.matched || '', weight: 0,
          roleType: 'leixiang', leixiang: true, terms: (c.terms || []).slice()
        });
      });
      if (source) source += '+leixiang'; else source = 'leixiang';
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


  /** 四柱各柱的干与支。位次按各柱各起（日支一日一位、月支一月一位…），故须逐柱取。 */
  function pillarsOf(sz) {
    var p = {};
    UNIT_ORDER.forEach(function (u) {
      var s = String((sz || {})[PILLAR_OF[u]] || '');
      p[u] = { gan: s.charAt(0), zhi: s.charAt(1) };
    });
    return p;
  }

  /** 盘的公历日期，用来把位次折成看得见的年月日。取自 basicInfo.date；缺则只给位次不折算。 */
  function chartDate(chart) {
    var s = (chart && chart.basicInfo && chart.basicInfo.date) || '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
  }
  function addDaysISO(cd, n) {
    if (!cd) return '';
    var d = new Date(Date.UTC(cd.y, cd.mo - 1, cd.d));
    d.setUTCDate(d.getUTCDate() + n);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }

  /** 该机制**原文**写明的单位。冲墓在两派纲要中写法不同，故支持按盘别分列。 */
  function nativeUnitsOf(m, school) {
    if (m.nativeUnitsBySchool) return (m.nativeUnitsBySchool[school] || []).slice();
    return (m.nativeUnits || ['日']).slice();
  }

  /**
   * 同一个干支在时/日/月/年四级各读一次。
   *   source='native'  —— 该机制原文写明的单位（马星「之日/月」、冲墓「之年月日时」、飞盘暗干支「年/月/日时」）；
   *   source='horizon' —— 由纲要·三节应期5「近事看日时、中事看月、远事看年」一条推及者。
   * 两者出处分列，模型据此看得出哪一级不是该机制自己说的。填实/冲实原文再三强调「只能是地支日」，
   * 故其 native 只有日，其余三级一律记 horizon——不把断法悄悄推广。
   */
  function buildReads(m, kind, value, school, pillars, cd) {
    var native = nativeUnitsOf(m, school);
    var order = kind === 'gan' ? (DB.ganOrder || []) : (DB.zhiOrder || []);
    var zu = DB.zhiUnits || {}, hz = DB.horizon || {};
    return UNIT_ORDER.map(function (u) {
      var from = (pillars[u] || {})[kind === 'gan' ? 'gan' : 'zhi'] || '';
      var off = offsetIn(order, from, value);
      var isNative = native.indexOf(u) >= 0;
      // 干与支的称谓不同：地支才有「午时」「辰月」这样的名目，天干在时/月/年三柱上
      // 只能说「该柱之干为某」——写成「己时」「戊月」是生造的说法，故分开命名。
      // 惟「戊日」是纲要本来的用语（「用神坐丙→丙日」），照旧。
      var name = kind === 'gan' && u !== '日' ? (u + '干' + value) : (value + u);
      var r = {
        unit: u, label: name, kind: kind,
        offset: off, cycle: order.length,
        source: isNative ? 'native' : 'horizon',
        basis: isNative ? (m.unitBasis || m.basis || '') : (hz.basis || ''),
        window: '', when: ''
      };
      if (kind === 'zhi') {
        if (u === '时') r.window = (zu['时'] || {})[value] || '';
        else if (u === '年') r.window = (zu['年'] || {})[value] || '';
        else if (u === '月') {
          var mm = (zu['月'] || {})[value];
          if (mm) r.window = mm.lunar + '（' + mm.jieqi + '，' + mm.gregorian + '）';
        }
      }
      // 位次折成时点：四柱各支逐位递进，故位次即真实距离——这是历法定数，不是断言事情应在那时
      if (off != null) {
        if (u === '日') r.when = off === 0 ? '即今日' : ('第 ' + off + ' 日后' + (cd ? ' = ' + addDaysISO(cd, off) : ''));
        else if (u === '时') r.when = off === 0 ? '即当下这个时辰' : ('第 ' + off + ' 个时辰后');
        else if (u === '月') r.when = off === 0 ? '即本月建' : ('第 ' + off + ' 个月后');
        else r.when = off === 0 ? '即本年太岁' : ('第 ' + off + ' 年后' + (cd ? ' ≈ ' + (cd.y + off) + ' 年' : ''));
      }
      return r;
    });
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
    var lx = (args.leixiang && args.leixiang.version && args.leixiang.applicable) ? args.leixiang : null;
    var school = options.school || detectSchool(chart);
    var domain = options.domain || (xy && xy.domain) || '';

    var base = {
      version: VERSION, domain: domain, school: school,
      applicable: false, reason: '',
      dayZhi: '', dayGan: '', pillars: null,
      anchors: [], timeline: [], byUnit: null, units: [], pace: null, horizon: null,
      numbers: [], targetSource: '', notes: []
    };

    if (!DB) { base.reason = '应期规则库未加载，本层停用。'; return base; }
    if (!yq) { base.reason = '未提供 yingqi 计算结果；本层只做筛选排序、绝不自行推算干支，故停用。'; return base; }

    var sz = (chart && chart.siZhu) || yq.siZhu || {};
    base.dayGan = String(sz.day || '').charAt(0);
    base.dayZhi = String(sz.day || '').charAt(1);
    if (!base.dayZhi) { base.reason = '盘面缺日柱，无从计算距今位次。'; return base; }
    var pillars = pillarsOf(sz);
    var cd = chartDate(chart);
    base.pillars = pillars;
    // 缺哪一柱就说哪一柱：少了月柱就断不了月，如实标出，不拿日柱顶替
    UNIT_ORDER.forEach(function (u) {
      if (!pillars[u].zhi) base.notes.push('盘面缺' + PILLAR_OF[u] + '柱，「' + u + '」一级的位次无从起算，该级只给支名不给远近。');
    });

    var targets = buildTargets(xy, options, lx);
    base.targetSource = targets.source;
    if (!targets.source) {
      base.notes.push('未取得用神落宫（占类象义层停用且未传 yongShenGongs），锚点无法按用神主次排序，一律记为参考级。');
    }
    if (lx) {
      base.notes.push('所问之物的类象用神（' +
        lx.candidates.filter(function (c) { return c.located; })
          .map(function (c) { return c.symbol + '=' + (c.terms || []).join('/'); }).join('、') +
        '）之落宫已一并计入用神宫：问「何时寻见/何时到手」正应看这几宫。' +
        '惟纲要未给类象用神以占类权重，故其权重记 0，排序时靠机制强弱而非权重。');
    }

    var ZHI = DB.zhiOrder || [], GAN = DB.ganOrder || [];
    var out = [];
    var seq = 0;

    function mech(name) { return DB.mechanisms[name] || null; }
    function enabled(name) {
      var m = mech(name);
      return !!m && (m.appliesTo || []).indexOf(school) >= 0;
    }
    function push(mechName, value, gong, extra, kindOverride) {
      var m = mech(mechName);
      if (!m || !value) return;
      // 多数机制的干支性质是固定的；惟飞盘暗干支一法干支两半俱有，故容调用处指明
      var kind = (kindOverride || m.kind) === 'gan' ? 'gan' : 'zhi';
      var unit = kind === 'gan' ? '干' : '地支';
      var tg = targetsAt(targets, gong);
      // 强弱＝机制与用神的关系，非打分。级别由规则库显式声明（mechanism.onTarget），
      // 不由描述字段的有无去推断——落到用神宫才谈得上强弱，否则一律 low。
      var strength = tg.length ? (m.onTarget || 'medium') : 'low';
      var order = kind === 'gan' ? GAN : ZHI;
      // offset 仍是**日**一级的位次：既是本层原有语义，也是下游案例本对轨所依赖的那一个
      var offset = offsetIn(order, kind === 'gan' ? base.dayGan : base.dayZhi, value);
      var reads = buildReads(m, kind, value, school, pillars, cd);
      var nativeUnits = nativeUnitsOf(m, school);
      out.push({
        id: mechName + ':' + value + '@' + (gong || '-') + '#' + (seq++),
        mechanism: mechName, label: m.label || mechName,
        kind: kind, value: value, display: value + '日',
        unit: unit, why: tg.length ? (m.onTargetWhy || '') : '所指之宫非本占用神宫',
        gong: gong ? String(gong) : '',
        targets: tg, weight: maxWeight(tg), strength: strength,
        offset: offset, cycle: order.length,
        // v5：同一个干支在时/日/月/年四级各读一次，并标明哪一级是机制原文所许、哪一级由「远近」推及
        reads: reads, nativeUnits: nativeUnits,
        unitBasis: m.unitBasis || '',
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

    /* ---------- ⑤ 用神宫暗干定远期（仅飞盘：转盘纲要应期节未列此法） ----------
     * 这是纲要里唯一**专为远期而设**的机制：飞盘·应期节明写「远期：取用神宫的地盘暗干支定（年/月/日时）」。
     * 飞盘盘面 diPanAnGan 排出的是**完整干支**（如「丁卯」），干支两半俱在，正合纲要所指。 */
    if (enabled('暗干远期') && chart && chart.diPanAnGan) {
      Object.keys(targets.byGong).forEach(function (g) {
        var ag = String(chart.diPanAnGan[g] || chart.diPanAnGan[String(g)] || '');
        if (!ag) return;
        var agGan = ag.charAt(0), agZhi = ag.charAt(1);
        // 干支两半各成一锚：循环长短不同（十 vs 十二），位次须各按各算，不能合成一条
        push('暗干远期', agGan, g, { note: '用神宫地盘暗干支 ' + ag + ' 之干；纲要以此定远期（年/月/日时）' }, 'gan');
        if (agZhi) push('暗干远期', agZhi, g, { note: '用神宫地盘暗干支 ' + ag + ' 之支；纲要以此定远期（年/月/日时）' }, 'zhi');
      });
    }

    /* ---------- ⑥ 排序：先按强弱，再按用神权重，最后按距今位次（同分以 id 稳定） ---------- */
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

    /* ---------- ⑦ 迟速：以权重最高之用神的旺衰定（纲要·三节应期5） ---------- */
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

    /* ---------- ⑧ 数字：只取用神宫的河图数（全盘对照表仍由 yingqi 块承载） ---------- */
    Object.keys(targets.byGong).forEach(function (g) {
      var gg = (yq.gongGan || {})[g];
      if (!gg) return;
      base.numbers.push({
        gong: g, targets: targetsAt(targets, g).map(function (t) { return t.name; }),
        tianGan: gg.tianGan, tianNum: gg.tianNum, diGan: gg.diGan, diNum: gg.diNum
      });
    });
    base.numbers.sort(function (a, b) { return a.gong < b.gong ? -1 : 1; });

    /* ---------- ⑨ 按单位汇总：同一批锚点分别按时/日/月/年铺一次 ----------
     * 同一个支在四级上是**同一个候选的四种读法**，不是四个候选。故按 label 去重，
     * 只留最强的那条来源，避免「午日/午月/午年」被当成三次独立的机会去凑命中。 */
    base.byUnit = {};
    UNIT_ORDER.forEach(function (u) {
      var seen = {}, list = [];
      out.forEach(function (a) {
        (a.reads || []).forEach(function (r) {
          if (r.unit !== u || r.offset == null) return;
          var prev = seen[r.label];
          var row = {
            label: r.label, value: a.value, kind: a.kind, window: r.window, when: r.when,
            offset: r.offset, source: r.source, mechanism: a.mechanism, mechLabel: a.label,
            strength: a.strength, weight: a.weight, gong: a.gong
          };
          if (!prev) { seen[r.label] = row; list.push(row); return; }
          // 同名者留最强：先比强弱，再比用神权重，再优先机制原文所许者
          var better = (STRENGTH_RANK[row.strength] || 0) > (STRENGTH_RANK[prev.strength] || 0)
            || (row.strength === prev.strength && row.weight > prev.weight)
            || (row.strength === prev.strength && row.weight === prev.weight
                && row.source === 'native' && prev.source !== 'native');
          if (better) { list[list.indexOf(prev)] = row; seen[r.label] = row; }
        });
      });
      list.sort(function (a, b) {
        if (a.offset !== b.offset) return a.offset - b.offset;
        var sa = STRENGTH_RANK[a.strength] || 0, sb = STRENGTH_RANK[b.strength] || 0;
        if (sa !== sb) return sb - sa;
        return a.label < b.label ? -1 : 1;
      });
      base.byUnit[u] = list;
    });

    /* ---------- ⑩ 远近：断时/断日/断月/断年，取哪一级 ----------
     * 远近本应由**所问之事**决定（纲要·三节应期5）。用户未言明时，依同一句「得令旺相则应速，
     * 休囚墓绝则应迟」，以迟速作缺省推定——推定就写明是推定，不冒充用户所述。 */
    if (DB.horizon) {
      var hz = DB.horizon, tier = '', src_ = '';
      if (options.horizon && hz.tiers[options.horizon]) { tier = options.horizon; src_ = 'user'; }
      else if (base.pace && (hz.fromPace || {})[base.pace.speed]) { tier = hz.fromPace[base.pace.speed]; src_ = 'pace'; }
      else { tier = '近'; src_ = 'default'; }
      var t = hz.tiers[tier] || {};
      base.horizon = {
        tier: tier, units: (t.units || []).slice(), when: t.when || '', tierNote: t.note || '',
        source: src_,
        sourceNote: src_ === 'user' ? '由调用方按所问之事指定'
          : src_ === 'pace' ? ('未据所问之事指定，依用神' + (base.pace ? base.pace.state : '') + '所定之「' + (base.pace ? base.pace.speed : '') + '」缺省推定——' + (hz.fromPaceNote || ''))
          : '既未指定、亦无迟速可依，缺省按近事（日与时辰）读；若所问是数月或数年之事，请改按月/年一级读下列锚点。',
        guidance: hz.guidance || '', basis: hz.basis || '', caution: hz.caution || ''
      };
      base.units = UNIT_ORDER.filter(function (u) { return (base.byUnit[u] || []).length > 0; });
    } else { base.horizon = null; base.units = []; }
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
    var SRC = { native: '机制原文', horizon: '远近推及' };
    L.push('');
    L.push('【应期时间线 Timing v' + res.version + (res.domain ? '　占类：' + res.domain : '') + '】');
    L.push('· 下列干支**全部取自上方【应期与数字】块的同一组计算**，本层只做「挑出与本占用神相关者、' +
      '定其强弱、定其可读的单位、排出先后」，未另推一套。取期请只在这些候选中选，不得自造日辰。');
    if (res.targetSource === 'engine') {
      L.push('· 用神落宫取自引擎自算（未启用占类象义层），故只分主次不分权重。');
    } else if (!res.targetSource) {
      L.push('· 未取得用神落宫，以下锚点均为参考级，请结合盘面自行判定主次。');
    }

    /* ---- 远近：先把「这次该按哪一级读」摆在最前，否则模型一律断成某日 ---- */
    if (res.horizon) {
      L.push('· 【远近·先定这一条】本次缺省按「' + res.horizon.tier + '事」读，即看 ' +
        res.horizon.units.join('、') + ' 一级' + (res.horizon.when ? '（' + res.horizon.when + '）' : '') + '。' +
        res.horizon.sourceNote);
      L.push('  ' + res.horizon.guidance);
      L.push('  ⚠ **这只是缺省。请先看用户问的是多远的事**：问「这两天能不能成」就断日与时辰；' +
        '问「这两三个月」就断月；问「今年明年」「哪一年」就断年。同一批锚点按哪一级读，答案就落在哪一级——' +
        '不要一律断成某日，也不要因为用户问的是远事就说「本盘只能断日」。');
      if (res.horizon.caution) L.push('  ⚠ ' + res.horizon.caution);
    }

    /* ---- 锚点：每条给出机制原文所许的单位，与由远近推及的其余单位 ---- */
    L.push('· 应期锚点（按强弱与用神权重排序）：');
    res.anchors.forEach(function (a) {
      var who = a.targets.length
        ? a.targets.map(function (t) {
          return t.name + (t.aspect ? '(' + t.aspect + ')' : '') +
            (t.leixiang ? '〔类象·所问「' + (t.terms || []).join('/') + '」〕' : '');
        }).join('、')
        : '非用神宫';
      L.push('  - [' + (SPEED[a.strength] || '') + '] ' + a.label + '：' + a.value +
        (a.gong ? '　(' + a.gong + '宫)' : '') + '　用神：' + who + (a.note ? '　—— ' + a.note : ''));
      var reads = (a.reads || []).filter(function (r) { return r.offset != null; });
      var nat = reads.filter(function (r) { return r.source === 'native'; });
      var hor = reads.filter(function (r) { return r.source === 'horizon'; });
      function fmt(r) {
        var bits = [];
        if (r.window) bits.push(r.window);
        if (r.when) bits.push(r.when);
        return r.label + (bits.length ? '（' + bits.join('，') + '）' : '');
      }
      if (nat.length) L.push('      〔本法原文所许〕' + nat.map(fmt).join('　｜　'));
      if (hor.length) L.push('      〔按远近推及〕' + hor.map(fmt).join('　｜　'));
    });
    if (res.anchors.some(function (a) { return a.kind === 'gan'; })) {
      L.push('  · 天干锚点的读法：「戊日」是纲要原有用语；但时辰与月建是以**地支**命名的（午时、辰月），' +
        '天干在时/月/年三柱上只能说「该柱之干为某」，故写作「时干戊」「月干戊」「年干戊」——' +
        '断语中不要写成「戊时」「戊月」，那是生造的说法。');
    }
    L.push('  · 〔本法原文所许〕＝纲要写这条法时就写明了这一级（如马星「之日/月」、冲墓「之年月日时」、' +
      '飞盘远期暗干支「年/月/日时」），可直接照断。' +
      '〔按远近推及〕＝该法原文只写了日，是由「近事看日时、中事看月、远事看年」一条推及的——' +
      '可用，但断语里要说清是按远近推的，不要说成该法本身如此。');

    /* ---- 按单位分铺：这一段直接回答「同一天不同时辰」「远期在哪几个月/哪一年」 ---- */
    (res.units || []).forEach(function (u) {
      var list = (res.byUnit && res.byUnit[u]) || [];
      if (!list.length) return;
      var head = u === '时' ? '· 若断时辰（同一日之内何时；近事必看这一级）：'
        : u === '日' ? '· 若断日：'
        : u === '月' ? '· 若断月（中事看月；月建以节气分界，非农历朔望月）：'
        : '· 若断年（远事看年；年以立春分界，所标公历年为约数）：';
      L.push(head + list.slice(0, 8).map(function (r) {
        return r.label + '[' + (SPEED[r.strength] || '') + '·' + r.mechLabel + (r.source === 'native' ? '' : '·推及') + ']'
          + (r.window ? '（' + r.window + '）' : '') + (r.when ? '　' + r.when : '');
      }).join('；'));
    });

    L.push('· 先后次序（按日一级的距今位次；四柱各支逐位递进，故位次即该候选下次出现的真实距离，' +
      '但「候选何时再来」是历法事实，「事情是否应在那时」仍须你据全盘定夺）：' +
      res.timeline.map(function (a) {
        return a.value + '(' + a.label + (a.offset == null ? '' : '·第' + a.offset + '位') + ')';
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
