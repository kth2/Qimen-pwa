/**
 * 奇门·九宫象义卡(XiangKa) core —— 纯函数、无副作用、可移植。【Phase 39 · 全盘象义叙事】
 *
 * 要解决的事：此前的解读只围着四个角色宫（日干、时干、值符、值使）和用神宫打转，
 * 判断靠吉凶计票与力量。三套方法（纲要、古籍、五行）在 391 例上回测，是非吉凶的
 * 区分力都接近瞎猜。本层支撑另一种读法：**九宫都在说同一件事**，把每宫的象义
 * 关联到所问之事上，再合成一个完整的故事（见 assets/narrative-method.md）。
 *
 * 本层只做一件事：为九宫逐宫列出**可取之象**，供模型编故事时取材。
 *   ① **象只许取自固定的表**，不许模型自由发挥。来源只有四处，每条都标明出处：
 *      - 〔纲要〕 转盘纲要三节「九宫定方所」、四节衍象（经 knowledge/leixiang.json）
 *      - 〔统宗〕 《奇门遁甲统宗》八卦／九星／八神类神（经 knowledge/classics-xiangyi.json）
 *      - 〔旨归〕 《奇门旨归》八门飞加克应，门×宫 70 格
 *      - 〔集成〕 《古今图书集成·奇门遁甲》八卦动应章，门×宫物象
 *   ② **不判吉凶、不算力量**。旺衰只照抄 wangshuai 的结论，供判断象的显隐、新旧。
 *   ③ **角色宫照实标注**，不代为取舍；其余各宫同样列出，因为本读法要求九宫都过一遍。
 *
 * 依赖：无（表由调用方注入）。转盘专有：飞盘不用本层（零串味）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XiangKa = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  /* 转盘纲要·三节「方位（九宫定方所）」表，逐字。射覆八卦类象取自同纲要三节「射覆猜物」一条。 */
  var GONG = {
    '1': { gua: '坎', dir: '正北', place: '沟渠池塘、水边、隐伏低洼、卫浴', shefu: '水黑圆' },
    '2': { gua: '坤', dir: '西南', place: '平原田野、村庄、腹/库房', shefu: '土方布众' },
    '3': { gua: '震', dir: '正东', place: '大途道路、丛林、闹市、车马', shefu: '木动声' },
    '4': { gua: '巽', dir: '东南', place: '花草林木、文教、风口、绳索', shefu: '木长绳风' },
    '5': { gua: '中', dir: '中央', place: '中堂、内室、贴身、核心之处', shefu: '' },
    '6': { gua: '乾', dir: '西北', place: '高亢、楼台、神庙、官府、首脑', shefu: '金圆刚贵' },
    '7': { gua: '兑', dir: '正西', place: '池泽、沟渠、口形器物、娱乐喧哗', shefu: '金口缺泽' },
    '8': { gua: '艮', dir: '东北', place: '山坡丘陵、堤坝、门径、桌柜之下/旁、坟', shefu: '土止小山' },
    '9': { gua: '离', dir: '正南', place: '闹市、明亮处、炉灶电器、文书', shefu: '火文丽中虚' }
  };
  var XING_CHARS = '蓬芮冲辅禽心柱任英';
  var SHEN_KEY = { '白虎': '勾陈（下有白虎）', '玄武': '朱雀（下有玄武）', '值符': '值符', '腾蛇': '腾蛇', '太阴': '太阴', '六合': '六合', '九地': '九地', '九天': '九天' };
  var LIU_JIA_DUN = { '甲子': '戊', '甲戌': '己', '甲申': '庚', '甲午': '辛', '甲辰': '壬', '甲寅': '癸' };

  var LX = null, CL = null;
  /** 注入两张表。leixiang 必需（纲要四节）；classics 可缺（缺则只列纲要之象）。 */
  function load(leixiang, classics) {
    LX = (leixiang && leixiang.tables) ? leixiang.tables : null;
    CL = (classics && classics.tables) ? classics.tables : null;
    return !!LX;
  }
  function ready() { return !!LX; }

  function clip(s, n) {
    s = String(s || '').replace(/\s+/g, '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  function gangyao(kind, name) {
    var t = LX && LX[kind];
    var it = t && t.items && t.items[name];
    return it && it.length ? it.join('/') : '';
  }
  /** 统宗八神类神：取「为人…」「于物为…」两句的开头，加色、形、数。 */
  function shenClassic(name) {
    var t = CL && CL['八神类神'] && CL['八神类神'].items;
    var s = t && t[SHEN_KEY[name]];
    if (!s) return '';
    var out = [];
    var ren = s.match(/为人[^。；]*/);
    if (ren) out.push(clip(ren[0], 16));
    var wu = s.match(/于物为[^。；]*/);
    if (wu) out.push(clip(wu[0], 22));
    var csn = s.match(/其色([^，。]+)[，。]其(?:形|体)([^，。]+)[，。]其数([^。]+)。/);
    if (csn) out.push('色' + csn[1] + '·形' + csn[2] + '·数' + csn[3].replace('与', '、'));
    return out.join('；');
  }
  function xingClassic(name) {
    var t = CL && CL['九星类神'] && CL['九星类神'].items;
    return t && t[name] ? clip(t[name], 26) : '';
  }
  function guaClassic(gua) {
    var t = CL && CL['八卦类神'] && CL['八卦类神'].items;
    return t && t[gua + '宫'] ? clip(t[gua + '宫'], 30) : '';
  }
  /** 旨归八门飞加克应：优先取「在物为…」，否则取克应开头。 */
  function menGong(men, gua) {
    var t = CL && CL['八门飞加克应'] && CL['八门飞加克应'].items;
    var c = t && t[men] && t[men][gua];
    if (!c) return '';
    if (c['物象']) return clip('物：' + c['物象'], 30);
    return clip(c['克应'] || '', 30);
  }
  function menGongJicheng(men, gua) {
    var t = CL && CL['门临宫物象'] && CL['门临宫物象'].items;
    var v = t && t[men] && t[men][gua];
    return v ? clip(v, 20) : '';
  }

  function findIn(map, v) { for (var k in (map || {})) if (map[k] === v) return String(k); return ''; }

  /**
   * 角色宫。调用方可另传 extra：[{ name, role, gong }]（占类用神、类象用神、年命等）。
   * 甲的取法与 app.js riShiGanBlock、core/xiangyi.js 同一口径：
   *   时干为甲 → 值符落宫；日干为甲 → 本日之甲所遁之仪落宫。
   */
  function roles(chart, extra) {
    var sz = chart.siZhu || {}, out = {};
    function tag(g, label) { if (!g) return; g = String(g); (out[g] = out[g] || []).push(label); }
    var ri = (sz.day || '').charAt(0), shi = (sz.time || '').charAt(0);
    var tp = chart.tianPan || {}, dp = chart.diPan || {};
    function ganGong(g) { return findIn(tp, g) || findIn(dp, g); }
    if (ri) tag(ri === '甲' ? ganGong(LIU_JIA_DUN[sz.day] || '') : ganGong(ri), '日干（我）');
    if (shi) tag(shi === '甲' ? (chart.zhiFuLuoGong || chart.zhiFuGong) : ganGong(shi), '时干（所问之事）');
    tag(chart.zhiFuLuoGong || chart.zhiFuGong, '值符（大势·开端）');
    tag(chart.zhiShiGong, '值使（经过·落点）');
    (extra || []).forEach(function (x) { if (x && x.gong) tag(x.gong, x.role || x.name); });
    return out;
  }

  /**
   * 主入口。
   * @param {object} a { chart, wangshuai(analyze 结果，可缺), extraRoles: [{name, role, gong}] }
   * @returns {{version, applicable, reason, cards:Array, roles:Object}}
   */
  function build(a) {
    a = a || {};
    var chart = a.chart || null;
    var res = { version: VERSION, applicable: false, reason: '', cards: [], roles: {} };
    if (!chart) { res.reason = '无盘'; return res; }
    if (chart.renPanMen || chart.tianPanYi || chart.diPanShen) { res.reason = '飞盘不用本层（零串味）'; return res; }
    if (!LX) { res.reason = '纲要类象表未加载'; return res; }
    var ws = (a.wangshuai && a.wangshuai.gongs) || {};
    var rl = roles(chart, a.extraRoles);
    res.roles = rl;
    var kong = (chart.kongWangGong || []).map(String);
    for (var i = 1; i <= 9; i++) {
      var g = String(i), G = GONG[g];
      var card = { gong: g, gua: G.gua, dir: G.dir, place: G.place, shefu: G.shefu, roles: rl[g] || [], items: [], state: '' };
      if (g !== '5') card.items.push({ layer: '宫', name: G.gua + '卦', xiang: [G.shefu ? '〔纲要〕' + G.shefu : '', guaClassic(G.gua) ? '〔统宗〕' + guaClassic(G.gua) : ''].filter(Boolean) });
      var xs = String((chart.jiuXing || {})[g] || '');
      for (var k = 0; k < xs.length; k++) {
        var ch = xs.charAt(k);
        if (XING_CHARS.indexOf(ch) < 0) continue;
        var xn = '天' + ch;
        card.items.push({ layer: '星', name: xn, xiang: [gangyao('九星', xn) ? '〔纲要〕' + gangyao('九星', xn) : '', xingClassic(xn) ? '〔统宗〕' + xingClassic(xn) : ''].filter(Boolean) });
      }
      var men = (chart.baMen || {})[g];
      if (men) {
        card.items.push({ layer: '门', name: men, xiang: [
          gangyao('八门', men) ? '〔纲要〕' + gangyao('八门', men) : '',
          menGong(men, G.gua) ? '〔旨归·' + men.charAt(0) + '加' + G.gua + '〕' + menGong(men, G.gua) : '',
          menGongJicheng(men, G.gua) ? '〔集成〕' + menGongJicheng(men, G.gua) : ''
        ].filter(Boolean) });
      }
      var shen = (chart.baShen || {})[g];
      if (shen) card.items.push({ layer: '神', name: shen, xiang: [gangyao('八神', shen) ? '〔纲要〕' + gangyao('八神', shen) : '', shenClassic(shen) ? '〔统宗〕' + shenClassic(shen) : ''].filter(Boolean) });
      [['天盘', (chart.tianPan || {})[g]], ['地盘', (chart.diPan || {})[g]], ['暗干', (chart.anGan || {})[g]]].forEach(function (p) {
        if (p[1] && gangyao('十干', p[1])) card.items.push({ layer: p[0], name: p[1], xiang: ['〔纲要〕' + gangyao('十干', p[1])] });
      });
      var w = ws[g] || {};
      var st = [];
      if (w.gongState) st.push('宫' + w.gongState);
      if (kong.indexOf(g) >= 0) st.push('空亡');
      if (w.ruMu) st.push('入墓');
      if (w.jiXing) st.push('击刑');
      if (w.menPo) st.push('门迫');
      card.state = st.join('·');
      res.cards.push(card);
    }
    res.applicable = true;
    return res;
  }

  /** 证据文本块。顺序：先角色宫，再其余各宫——本读法要求九宫都过一遍，但角色宫是故事的骨架。 */
  function toPromptBlock(r) {
    if (!r || !r.applicable) return '';
    var L = ['', '【九宫象义卡】（全盘象义叙事专用。象只许取自本卡，出处已标；旺衰只用来判断象的显隐、新旧、强弱，不作成败计票）'];
    var cards = r.cards.slice().sort(function (a, b) {
      return (b.roles.length ? 1 : 0) - (a.roles.length ? 1 : 0) || (+a.gong - +b.gong);
    });
    cards.forEach(function (c) {
      L.push(c.gua + (c.gong === '5' ? '五' : '') + c.gong + '宫·' + c.dir + '｜场所〔纲要〕' + c.place
        + (c.state ? '｜' + c.state : '') + (c.roles.length ? '｜角色：' + c.roles.join('、') : '｜角色：无（旁证、人物或环境）'));
      c.items.forEach(function (it) {
        L.push('  ' + it.layer + ' ' + it.name + '：' + (it.xiang.join('；') || '（表中无此象）'));
      });
    });
    return L.join('\n') + '\n';
  }

  return { VERSION: VERSION, load: load, ready: ready, build: build, toPromptBlock: toPromptBlock, roles: roles, GONG: GONG };
});
