/**
 * 奇门·占类象义推理层(XiangYi) core —— 纯函数、无副作用、可移植。【Phase 2】
 *
 * 解决的问题：Phase 1 把「盘面事实 + 通用象义」结构化喂给了模型，但通用象义是与占类无关的
 * ——symbols.json 里「生门 = 生发/财利/生机」，无论问财、问病、问官司都是这一句。于是模型
 * 拿到的仍是原料，「在这个具体问题里它意味着什么」全靠自由发挥，同一张盘换个问法就漂。
 * 本模块补上这一层：把占类角色（谁是财源、谁是我方、谁是阻力）、旺衰四害、同宫组合、
 * 宫际生克，按 knowledge/domain-rules.json 的规则确定性地求值成一条条可溯源的「象义判读」。
 *
 * 为什么同一个「旺」会得出相反的判读：因为角色不同。求财中生门旺 = 财源有力(+)，
 * 而庚旺 = 竞争者强势(-)。这正是本层存在的理由——脱离占类角色谈旺衰是没有意义的。
 *
 * 关键边界（务必保持）：
 *   ① 只产出「象义判读」，**不产出最终吉凶断语**。每条 polarity 仅表示该判读对本占类是
 *      助力(+)还是阻力(-)，最终成败仍由引擎 jiuGongAnalysis/geju 与模型综合。
 *   ② 只读不写：条件求值只读盘面与 wangshuai 已算出的旺衰/四害，绝不反过来改写 FACT。
 *   ③ 零串味：规则库源自转盘传统(appliesTo)，遇飞盘盘面**整体停用**并说明原因，
 *      绝不降级套用（与 yongshen.js 同一铁律）。
 *   ④ 宁缺勿造：条件无法判定时视为不成立（如八神不参五行，对八神写 state 条件永不命中），
 *      不得为凑出判读而放宽匹配。
 *   ⑤ 完全确定性：同盘同占类必得同一结果，不含随机、不含时间依赖；输出顺序亦稳定。
 *
 * 依赖：knowledge/domain-rules.json（须先 load() 注入）；
 *       旺衰/四害取 core/wangshuai.js 的 analyze() 结果（由调用方传入，本模块不重算，
 *       以免与 wangshuai 产生两套算法）。未传入时 state/relation 类规则自动停用并置 degraded。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XiangYi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB = null;
  var VERSION = '2.0.0';
  // 条目上限：判读不是越多越好，过多会稀释提示词、把关键判读挤到噪音里。
  var MAX_CONDITIONS = 20;
  var MAX_COMBINATIONS = 12;

  var GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];

  /* ---------- 以下三组常量与 core/wangshuai.js、core/yongshen.js 同源。
     此处各存一份是为保持 core 模块可独立移植（与 yongshen.js 内置 GONG_INFO 同理）；
     core/xiangyi.test.js 有「常量漂移守卫」逐项比对，任一处改动而另一处未跟进即测试失败。 ---------- */
  var SHENG = { '木': '火', '火': '土', '土': '金', '金': '水', '水': '木' };
  var KE = { '木': '土', '土': '水', '水': '火', '火': '金', '金': '木' };
  // 十干入墓宫（乙丙戊乾六、甲癸坤二、丁庚己艮八、壬辛巽四）
  var RU_MU_GONG = { '乙': '6', '丙': '6', '戊': '6', '甲': '2', '癸': '2', '丁': '8', '庚': '8', '己': '8', '壬': '4', '辛': '4' };
  // 六仪击刑宫
  var JI_XING_GONG = { '戊': '3', '己': '2', '庚': '8', '辛': '9', '壬': '4', '癸': '4' };
  var GONG_INFO = {
    '1': { name: '坎', direction: '正北' }, '2': { name: '坤', direction: '西南' },
    '3': { name: '震', direction: '正东' }, '4': { name: '巽', direction: '东南' },
    '5': { name: '中', direction: '中央' }, '6': { name: '乾', direction: '西北' },
    '7': { name: '兑', direction: '正西' }, '8': { name: '艮', direction: '东北' },
    '9': { name: '离', direction: '正南' }
  };

  function load(rulesJson) {
    DB = (rulesJson && rulesJson.domains) ? rulesJson : null;
    return !!DB;
  }
  function isLoaded() { return !!DB; }
  function getDomain(id) { return (DB && DB.domains[id]) ? DB.domains[id] : null; }
  function domainIds() { return DB ? Object.keys(DB.domains) : []; }
  /** 该占类规则是否已建成（pending 者结构在、规则空，不得当作"无判读"误读为"无碍"） */
  function domainStatus(id) {
    var d = getDomain(id);
    return d ? (d.status || 'pending') : 'unknown';
  }

  /** 与 yongshen.js detectSchool 同规则：飞盘用 renPanMen/tianPanYi/diPanShen 命名。 */
  function detectSchool(chart) {
    if (!chart) return 'zhuanpan';
    if (chart.renPanMen || chart.tianPanYi || chart.diPanShen) return 'feipan';
    return 'zhuanpan';
  }

  function repeat(s, n) { var out = ''; for (var i = 0; i < n; i++) out += s; return out; }
  function kindOf(name) {
    if (name === '日干' || name === '时干' || name === '年命') return 'gan';
    if (name === '值符') return 'shen';
    if (name === '值使') return 'men';
    if (name.length === 2 && name.charAt(1) === '门') return 'men';
    if (name.charAt(0) === '天' && name.length === 2) return 'xing';
    if (GAN.indexOf(name) >= 0) return 'gan';
    return 'shen';
  }

  /**
   * 建盘面索引：每宫有哪些元素、每个元素落在哪一宫。
   * 干可同时出现在多宫（天盘一处、地盘另一处）：primary 取「天盘 > 地盘 > 暗干」为其主位
   * （与 yongshen.locate 同序），而 at[g] 收全部层次——判「同宫」时天地盘皆算数。
   */
  function indexChart(chart) {
    var c = chart || {};
    var men = c.baMen || {}, xing = c.jiuXing || {}, shen = c.baShen || {};
    var tian = c.tianPan || {}, di = c.diPan || {}, an = c.anGan || {};
    var at = {}, primary = {}, layer = {}, g, i;

    for (i = 1; i <= 9; i++) at[String(i)] = [];
    function put(g, name) {
      g = String(g);
      if (!name || !at[g]) return;
      if (at[g].indexOf(name) < 0) at[g].push(name);
    }
    function claim(name, g, lay) {
      if (!name || primary[name]) return;      // 先到先得：天盘先于地盘先于暗干
      primary[name] = String(g); layer[name] = lay;
    }
    for (g in men) { put(g, men[g]); claim(men[g], g, 'men'); }
    for (g in xing) { put(g, xing[g]); claim(xing[g], g, 'xing'); }
    for (g in shen) { put(g, shen[g]); claim(shen[g], g, 'shen'); }
    for (g in tian) { put(g, tian[g]); claim(tian[g], g, 'tianGan'); }
    for (g in di) { put(g, di[g]); claim(di[g], g, 'diGan'); }
    for (g in an) { put(g, an[g]); claim(an[g], g, 'anGan'); }

    var sz = c.siZhu || {};
    return {
      at: at, primary: primary, layer: layer,
      actors: { 日干: (sz.day || '').charAt(0) || '', 时干: (sz.time || '').charAt(0) || '' },
      zhiFuGong: c.zhiFuLuoGong != null ? String(c.zhiFuLuoGong) : (c.zhiFuGong != null ? String(c.zhiFuGong) : ''),
      zhiShiGong: c.zhiShiGong != null ? String(c.zhiShiGong) : '',
      zhiShiMen: c.zhiShiMen || '',
      kongWang: (c.kongWangGong || []).map(String),
      maGong: (c.maStar && c.maStar.gong != null) ? String(c.maStar.gong) : ''
    };
  }

  /**
   * 解析规则中的元素名 → 具体落点。
   * 返回 null 表示盘上无此元素（如甲不上天盘且无值符宫），调用方须如实呈现「未见」。
   */
  function resolveElement(name, idx) {
    if (!name || !idx) return null;
    var kind = kindOf(name), resolved = name, gong = null, lay = '', via = '';

    if (name === '日干' || name === '时干') {
      var gan = idx.actors[name];
      if (!gan) return null;
      resolved = gan;
      if (gan === '甲') {                       // 甲不上天盘，遁于旬首，以值符落宫论
        if (!idx.zhiFuGong) return null;
        gong = idx.zhiFuGong; lay = 'zhiFu'; via = '甲不上天盘，以值符落宫论';
      } else {
        gong = idx.primary[gan] || null; lay = idx.layer[gan] || '';
      }
    } else if (name === '值使') {
      gong = idx.zhiShiGong || null; lay = 'men'; resolved = idx.zhiShiMen || '值使';
    } else if (name === '值符' && !idx.primary['值符']) {
      gong = idx.zhiFuGong || null; lay = 'shen';   // 八神中无值符时退回值符星落宫
    } else {
      gong = idx.primary[name] || null; lay = idx.layer[name] || '';
    }
    if (!gong) return null;
    var info = GONG_INFO[gong] || {};
    return {
      name: name, resolved: resolved, kind: kind, layer: lay, via: via,
      gong: gong, gongName: info.name || '', direction: info.direction || ''
    };
  }

  /** 该元素自身的旺相休囚死。门/星/干各取本层状态；八神不参五行故恒为空——刻意不猜。 */
  function stateOfElement(el, wsGong) {
    if (!el || !wsGong) return '';
    if (el.kind === 'men') return wsGong.menState || '';
    if (el.kind === 'xing') return wsGong.xingState || '';
    if (el.kind === 'gan') {
      if (el.layer === 'tianGan' || wsGong.tianGan === el.resolved) return wsGong.tianGanState || '';
      if (el.layer === 'diGan' || wsGong.diGan === el.resolved) return wsGong.diGanState || '';
      return '';                                  // 暗干不参旺衰，不臆造
    }
    return '';
  }

  /**
   * 该元素当前命中的四害/动象标记。
   * 入墓与击刑为十干专属：元素本身是干时判**该干**是否墓/刑于此宫；
   * 元素是门/星/神时，判其所落之宫内**是否有干**墓/刑（宫受其累，非该门自身入墓）。
   */
  function flagsOfElement(el, idx, wsGong, chart) {
    var f = [], why = {};
    if (!el) return { flags: f, why: why };
    var g = el.gong;
    if (idx.kongWang.indexOf(g) >= 0) f.push('空亡');
    if (idx.maGong && idx.maGong === g) f.push('驿马');
    var menPo = wsGong ? !!wsGong.menPo
      : !!(chart && chart.jiuGongAnalysis && chart.jiuGongAnalysis[g] && chart.jiuGongAnalysis[g].menPo);
    if (menPo) {
      f.push('门迫');
      // 门迫是「该宫之门克宫」。元素本身是门时说的就是它自己；是星/神/干时，是其所落之宫受迫。
      if (el.kind !== 'men') why['门迫'] = '所落' + g + '宫门迫（门克宫），宫气受制';
    }
    // 干自身的墓/刑，只在该干**确实摆在天盘或地盘上**时才断——这样与 wangshuai 判的四害
    // 严格同源，不会出现"本层说入墓、旺衰块说没有"的两套说法。
    // 日/时干为甲时经值符落宫定位(layer='zhiFu')，甲并不上天盘，故不按甲墓于坤二硬断，
    // 退回宫层判定；暗干同理（wangshuai 亦不将暗干计入四害）。
    var onPlate = el.kind === 'gan' && el.resolved && (el.layer === 'tianGan' || el.layer === 'diGan');
    if (onPlate) {
      if (RU_MU_GONG[el.resolved] === g) { f.push('入墓'); why['入墓'] = el.resolved + '墓于' + g + '宫'; }
      if (JI_XING_GONG[el.resolved] === g) { f.push('击刑'); why['击刑'] = el.resolved + '击刑于' + g + '宫'; }
    } else if (wsGong) {
      // 门/星/神（及甲/暗干等不上盘者）本身不论墓刑；此处记的是**其所落之宫内有干**墓/刑，
      // 该宫因此滞塞、用神受其累——须写明缘由，否则会被读成该门/该干自身入墓。
      var whose = el.kind === 'gan' ? (el.resolved + '所落') : '所落';
      if (wsGong.ruMu) { f.push('入墓'); why['入墓'] = whose + g + '宫内 ' + (wsGong.ruMuDetail || '有干') + '入墓，宫滞'; }
      if (wsGong.jiXing) { f.push('击刑'); why['击刑'] = whose + g + '宫内有干击刑，宫滞'; }
    }
    return { flags: f, why: why };
  }

  function asArray(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }

  /** when 各键为「与」，键内数组为「或」。无法判定者一律不成立。 */
  function matchWhen(when, ctx) {
    if (!when) return null;
    var hit = {};
    var states = asArray(when.state);
    if (states.length) {
      if (!ctx.state || states.indexOf(ctx.state) < 0) return null;
      hit.state = ctx.state;
    }
    var flags = asArray(when.flags), i;
    if (flags.length) {
      for (i = 0; i < flags.length; i++) if (ctx.flags.indexOf(flags[i]) < 0) return null;
      hit.flags = flags.slice();
    }
    var withs = asArray(when['with']);
    if (withs.length) {
      for (i = 0; i < withs.length; i++) if (ctx.sameGong.indexOf(withs[i]) < 0) return null;
      hit['with'] = withs.slice();
    }
    var gongs = asArray(when.gong).map(String);
    if (gongs.length) {
      if (gongs.indexOf(ctx.gong) < 0) return null;
      hit.gong = ctx.gong;
    }
    return hit;
  }

  /** 两宫五行关系。同宫优先于生克，故先判 same_gong。 */
  function relationKind(fromGong, toGong, fromEl, toEl) {
    if (fromGong === toGong) return 'same_gong';
    if (!fromEl || !toEl) return '';
    if (fromEl === toEl) return 'same_element';
    if (SHENG[toEl] === fromEl) return 'to_sheng_from';
    if (SHENG[fromEl] === toEl) return 'from_sheng_to';
    if (KE[fromEl] === toEl) return 'from_ke_to';
    if (KE[toEl] === fromEl) return 'to_ke_from';
    return '';
  }

  function weightFor(d, name) {
    var r = d.roles && d.roles[name];
    if (r && typeof r.weight === 'number') return r.weight;
    var def = (DB && DB.defaultWeights) || {};
    var w = def[kindOf(name)];
    return typeof w === 'number' ? w : 2;
  }
  function aspectFor(d, name) {
    var r = d.roles && d.roles[name];
    return r ? (r.aspect || '') : '';
  }

  /**
   * 主入口。
   * @param {object} args
   *   domain    —— 占类 id（已由 YongShen.normalizeDomain 归一化）
   *   chart     —— 引擎输出的盘
   *   wangshuai —— WangShuai.analyze(pan) 的结果对象；缺省则 state/relation 类规则停用（degraded）
   *   options.school —— 可选，缺省依盘面判定
   * @returns {object} 确定性判读结果；不含最终吉凶断语。
   */
  function analyze(args) {
    args = args || {};
    var chart = args.chart || null;
    var options = args.options || {};
    var id = args.domain || 'general';
    var school = options.school || detectSchool(chart);
    var ws = args.wangshuai && args.wangshuai.gongs ? args.wangshuai : null;

    var base = {
      version: VERSION, domain: id, label: '', school: school,
      applicable: false, status: domainStatus(id), reason: '',
      focus: [], readings: [], combinations: [], relations: [], absent: [],
      tally: { support: 0, obstruct: 0, neutral: 0, weighted: 0, byAspect: {} },
      degraded: !ws, notes: []
    };

    if (!DB) { base.reason = '规则库未加载，本层停用。'; return base; }
    var d = getDomain(id);
    if (!d) { base.reason = '规则库中无此占类（' + id + '），本层停用。'; return base; }
    base.label = d.label || '';

    // 零串味：规则库源自转盘，遇他派盘面整体停用，绝不降级套用。
    var appliesTo = DB.appliesTo || ['zhuanpan'];
    if (appliesTo.indexOf(school) < 0) {
      base.reason = '规则库取用与判读源自' + appliesTo.join('/') + '传统，本盘为' + school +
        '、另有取用体系，按零串味原则整体停用（不降级套用）。';
      return base;
    }
    if (!chart) { base.reason = '未提供盘面，无从求值。'; return base; }
    if ((d.status || 'pending') === 'pending') {
      base.reason = '占类「' + (d.label || id) + '」规则尚未建成（Phase 2.3 待办），本层不产出判读；' +
        '此为"规则未建"而非"盘上无碍"，不得据此认定无阻。';
      return base;
    }
    if (!ws) base.notes.push('未提供旺衰分析(wangshuai)，旺相休囚死与宫际生克类规则本次停用。');

    base.applicable = true;
    base.reason = '占类「' + (d.label || id) + '」规则已建成，按 domain-rules.json 逐条求值。';

    var idx = indexChart(chart);
    var located = {};   // name -> element | null（null 表示盘上未见）
    var roleNames = Object.keys(d.roles || {});

    function loc(name) {
      if (!(name in located)) located[name] = resolveElement(name, idx);
      return located[name];
    }
    /** 同宫元素集合：含该宫门/星/神/天盘干/地盘干/暗干，并把日干/时干按其实干折算进去 */
    function sameGongNames(gong) {
      var names = (idx.at[gong] || []).slice();
      ['日干', '时干'].forEach(function (alias) {
        var e = loc(alias);
        if (e && e.gong === gong && names.indexOf(alias) < 0) names.push(alias);
      });
      return names;
    }
    /**
     * 该元素占据的**全部**宫（判同宫用）。
     * 干可一支在天盘、一支在地盘，分落两宫：若只取主位，「生门+庚」这类组合会在
     * 庚的地盘落宫上漏判。日干/时干是"人/事"之代称，按传统仍只取其主位（天盘），不放宽。
     */
    function gongsOf(name) {
      if (name === '日干' || name === '时干' || name === '值使') {
        var e = loc(name);
        return e ? [e.gong] : [];
      }
      var out = [], g;
      for (g in idx.at) if (idx.at[g].indexOf(name) >= 0) out.push(g);
      if (!out.length) {
        var e2 = loc(name);                       // 值符退回值符星落宫等特例
        if (e2) out.push(e2.gong);
      }
      return out.sort();
    }
    function ctxOf(name) {
      var el = loc(name);
      if (!el) return null;
      var wsGong = ws ? ws.gongs[el.gong] : null;
      var fl = flagsOfElement(el, idx, wsGong, chart);
      return {
        el: el, gong: el.gong,
        state: stateOfElement(el, wsGong),
        flags: fl.flags, flagWhy: fl.why,
        sameGong: sameGongNames(el.gong)
      };
    }

    /* ---------- ① 焦点：占类角色 × 权重 × 实际落点 ---------- */
    roleNames.sort(function (a, b) {
      var wa = weightFor(d, a), wb = weightFor(d, b);
      return wb !== wa ? wb - wa : (a < b ? -1 : 1);
    }).forEach(function (name) {
      var r = d.roles[name], c = ctxOf(name);
      if (!c) {
        base.absent.push({
          name: name, aspect: r.aspect || '', role: r.role || '', weight: weightFor(d, name),
          note: '盘上未见，不得代为安置落宫'
        });
        return;
      }
      base.focus.push({
        name: name, resolved: c.el.resolved !== name ? c.el.resolved : '',
        aspect: r.aspect || '', role: r.role || '', roleType: r.roleType || '',
        weight: weightFor(d, name), kind: c.el.kind,
        gong: c.gong, gongName: c.el.gongName, direction: c.el.direction,
        state: c.state, flags: c.flags, flagWhy: c.flagWhy,
        via: c.el.via || '', basis: r.basis || ''
      });
    });

    /* ---------- ② 条件判读：单象 × 旺衰/四害 ---------- */
    (d.conditions || []).forEach(function (rule) {
      var c = ctxOf(rule.on);
      if (!c) return;
      var hit = matchWhen(rule.when, c);
      if (!hit) return;
      // 门/星/神的墓刑实为「所落之宫内有干墓刑」，须随判读写明，否则读作该门自身入墓即失真
      if (hit.flags) {
        hit.why = hit.flags.map(function (f) { return c.flagWhy[f] || ''; }).filter(Boolean);
        if (!hit.why.length) delete hit.why;
      }
      var trig = [];
      if (hit.state) trig.push(hit.state);
      if (hit.flags) trig.push(hit.flags.join('·'));
      if (hit['with']) trig.push('同宫' + hit['with'].join('·'));
      base.readings.push({
        id: rule.id, kind: 'condition', on: rule.on,
        aspect: aspectFor(d, rule.on), weight: weightFor(d, rule.on),
        gong: c.gong, gongName: c.el.gongName,
        matched: hit,
        // 触发条件必须随判读一同呈现——只说结论不说"因何而得"，模型无从核验，也无从复述依据
        trigger: trig.join('+') + (hit.why ? '〔' + hit.why.join('；') + '〕' : ''),
        concept: (rule.concept || []).slice(),
        polarity: rule.polarity || '0', basis: rule.basis || ''
      });
    });

    /* ---------- ③ 组合判读：两象同宫。只跑规则表列出的组合，不做全排列——
       Phase 3 若要扩到三象，也须由占类相关性约束，否则组合数爆炸。 ---------- */
    (d.combinations || []).forEach(function (rule) {
      var els = rule.elements || [];
      if (els.length < 2) return;
      // 求各元素所占宫的交集：交集非空即为「同宫相遇」。取宫号最小者，保证输出稳定。
      var shared = null, ok = true, parts = [];
      els.forEach(function (n) {
        if (!ok) return;
        var gs = gongsOf(n);
        if (!gs.length) { ok = false; return; }
        shared = shared === null ? gs : shared.filter(function (x) { return gs.indexOf(x) >= 0; });
        if (!shared.length) { ok = false; return; }
        var c = ctxOf(n);
        parts.push({ name: n, resolved: (c && c.el.resolved !== n) ? c.el.resolved : '' });
      });
      if (!ok || !shared || !shared.length) return;
      var g = shared[0];
      var w = Math.max.apply(null, els.map(function (n) { return weightFor(d, n); }));
      base.combinations.push({
        id: rule.id, kind: 'combination', elements: els.slice(), parts: parts,
        weight: w, gong: g, gongName: (GONG_INFO[g] || {}).name || '',
        trigger: '同宫',
        concept: (rule.concept || []).slice(),
        polarity: rule.polarity || '0', basis: rule.basis || ''
      });
    });

    /* ---------- ④ 宫际关系：我方宫 ↔ 用神宫 的生克盗泄 ---------- */
    if (ws) {
      (d.relations || []).forEach(function (rule) {
        var a = ctxOf(rule.from), b = ctxOf(rule.to);
        if (!a || !b) return;
        var ea = (ws.gongs[a.gong] || {}).gongElement || '';
        var eb = (ws.gongs[b.gong] || {}).gongElement || '';
        var kind = relationKind(a.gong, b.gong, ea, eb);
        var entry = kind && rule.map ? rule.map[kind] : null;
        if (!entry) return;
        base.relations.push({
          id: rule.id, kind: 'relation',
          from: rule.from, to: rule.to,
          fromLabel: rule.fromLabel || rule.from, toLabel: rule.toLabel || rule.to,
          fromGong: a.gong, toGong: b.gong,
          fromElement: ea, toElement: eb, relation: kind,
          trigger: ((DB.relationKinds || {})[kind] || kind),
          weight: Math.max(weightFor(d, rule.from), weightFor(d, rule.to)),
          concept: (entry.concept || []).slice(),
          polarity: entry.polarity || '0', basis: rule.basis || ''
        });
      });
    }

    /* ---------- ⑤ 排序与截断（稳定：权重降序，同权按 id 字典序） ---------- */
    function byWeight(a, b) { return b.weight !== a.weight ? b.weight - a.weight : (a.id < b.id ? -1 : 1); }
    base.readings.sort(byWeight);
    base.combinations.sort(byWeight);
    base.relations.sort(byWeight);
    if (base.readings.length > MAX_CONDITIONS) {
      base.notes.push('条件判读命中 ' + base.readings.length + ' 条，按权重取前 ' + MAX_CONDITIONS + ' 条。');
      base.readings = base.readings.slice(0, MAX_CONDITIONS);
    }
    if (base.combinations.length > MAX_COMBINATIONS) {
      base.notes.push('组合判读命中 ' + base.combinations.length + ' 条，按权重取前 ' + MAX_COMBINATIONS + ' 条。');
      base.combinations = base.combinations.slice(0, MAX_COMBINATIONS);
    }

    /* ---------- ⑥ 倾向计数（**非吉凶结论**，只是证据条目的加权计数，供模型与后续校准参考） ---------- */
    base.readings.concat(base.combinations, base.relations).forEach(function (r) {
      var t = base.tally;
      if (r.polarity === '+') { t.support++; t.weighted += r.weight; }
      else if (r.polarity === '-') { t.obstruct++; t.weighted -= r.weight; }
      else t.neutral++;
      var asp = r.aspect || r.toLabel || '组合';
      if (!t.byAspect[asp]) t.byAspect[asp] = { support: 0, obstruct: 0, neutral: 0 };
      if (r.polarity === '+') t.byAspect[asp].support++;
      else if (r.polarity === '-') t.byAspect[asp].obstruct++;
      else t.byAspect[asp].neutral++;
    });

    return base;
  }

  /** 判读结果 → 提示词文本块。坏数据返回空串，绝不阻断解读流程。 */
  function toPromptBlock(res) {
    if (!res || !res.applicable) {
      if (res && res.reason && res.school && res.school !== 'zhuanpan') {
        return '\n【占类象义判读】本盘为' + res.school + '，' + res.reason;
      }
      return '';
    }
    var L = [];
    L.push('');
    L.push('【占类象义判读 XiangYi v' + res.version + '　占类：' + res.domain + (res.label ? '(' + res.label + ')' : '') + '】');
    L.push('· 以下判读由应用按 domain-rules.json 确定性求值得出，已注明依据；' +
      '判读只说明「该元素在本占类中意味着什么」，**不是最终吉凶断语**，成败仍须结合引擎吉凶与全盘综合。');
    if (res.focus.length) {
      L.push('· 本占类关注点（★为权重，越高越应重点着墨）：');
      res.focus.forEach(function (f) {
        var marks = [];
        if (f.state) marks.push(f.state);
        f.flags.forEach(function (x) { marks.push(x + (f.flagWhy[x] ? '(' + f.flagWhy[x] + ')' : '')); });
        L.push('  - ' + repeat('★', f.weight) + ' ' + f.name + (f.resolved ? '(' + f.resolved + ')' : '') +
          '＝' + (f.aspect || '?') + '：落' + f.gong + '宫' + (f.gongName ? '(' + f.gongName + ')' : '') +
          (marks.length ? '　[' + marks.join('　') + ']' : '') + (f.via ? '（' + f.via + '）' : ''));
      });
    }
    if (res.absent.length) {
      L.push('· 盘上未见（须按"未见"论，不得代为安置落宫）：' +
        res.absent.map(function (a) { return a.name + '(' + (a.aspect || '?') + ')'; }).join('、'));
    }
    function line(r, head) {
      return '  - [' + (r.polarity === '+' ? '助' : r.polarity === '-' ? '阻' : '中') + '] ' +
        head + '：' + r.concept.join('、') + '　（依据：' + r.basis + '）';
    }
    if (res.readings.length) {
      L.push('· 单象判读：');
      res.readings.forEach(function (r) {
        L.push(line(r, r.on + (r.aspect ? '(' + r.aspect + ')' : '') + ' ' + r.trigger + ' 于' + r.gong + '宫'));
      });
    }
    if (res.combinations.length) {
      L.push('· 组合判读（同宫相遇，其义不等于两象之和）：');
      res.combinations.forEach(function (r) {
        L.push(line(r, r.elements.join('+') + ' 同落' + r.gong + '宫'));
      });
    }
    if (res.relations.length) {
      L.push('· 宫际生克（定成败向背）：');
      res.relations.forEach(function (r) {
        L.push(line(r, r.fromLabel + r.fromGong + '宫(' + r.fromElement + ') ' +
          r.trigger + ' ' + r.toLabel + r.toGong + '宫(' + r.toElement + ')'));
      });
    }
    var t = res.tally;
    L.push('· 证据倾向计数（**非结论**，仅供权衡详略：助 ' + t.support + ' 条／阻 ' + t.obstruct +
      ' 条／中性 ' + t.neutral + ' 条）。条数多寡不等于吉凶，仍须按权重与全盘定论。');
    if (res.notes.length) res.notes.forEach(function (n) { L.push('· 说明：' + n); });
    return L.join('\n');
  }

  return {
    load: load, isLoaded: isLoaded,
    domainIds: domainIds, getDomain: getDomain, domainStatus: domainStatus,
    detectSchool: detectSchool,
    indexChart: indexChart, resolveElement: resolveElement,
    relationKind: relationKind,
    analyze: analyze, toPromptBlock: toPromptBlock,
    VERSION: VERSION,
    // 供漂移守卫测试比对（不供业务调用）
    _TABLES: { SHENG: SHENG, KE: KE, RU_MU_GONG: RU_MU_GONG, JI_XING_GONG: JI_XING_GONG, GONG_INFO: GONG_INFO }
  };
});
