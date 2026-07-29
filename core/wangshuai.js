/**
 * 奇门·旺衰与四害 core —— 纯函数、无副作用、可移植。
 *
 * 解决的问题：本引擎排盘完整，但**不计算旺相休囚死、入墓、击刑**；而两派《解断方法纲要》
 * 通篇依赖旺衰（"旺相逢生为得""得令为旺，失令/入墓/空亡则力弱""旺相足数、休囚减半"）。
 * 数据缺位时 AI 只能凭感觉猜强弱，这是实战断准确度下滑的首要原因。本模块补齐：
 *   ① 旺相休囚死（以月令定四时，判宫/星/门/天盘干/地盘干之力量）
 *   ② 十干入墓（口诀「乙丙戊乾，甲癸坤，丁庚己艮，壬辛巽」）
 *   ③ 六仪击刑（甲子戊→震三、甲戌己→坤二、甲申庚→艮八、甲午辛→离九、
 *      甲辰壬→巽四、甲寅癸→巽四）
 *   ④ 奇门四害（门迫/击刑/空亡/入墓）汇总与能量估计
 *
 * 出处：旺相休囚死为五行当令通则（当令者旺、令生者相、生令者休、克令者囚、令克者死）；
 * 入墓取奇门通行口诀（自洽覆盖十干），击刑取六仪地支相刑通行表。两者在奇门实务中
 * 合称「四害」，为衰旺与吉凶判断的关键依据。详见 README「旺衰与四害」节。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WangShuai = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WU_XING = ['木', '火', '土', '金', '水'];
  // 生：木→火→土→金→水→木
  var SHENG = { '木': '火', '火': '土', '土': '金', '金': '水', '水': '木' };
  // 克：木→土→水→火→金→木
  var KE = { '木': '土', '土': '水', '水': '火', '火': '金', '金': '木' };

  var GAN_WX = { '甲': '木', '乙': '木', '丙': '火', '丁': '火', '戊': '土', '己': '土', '庚': '金', '辛': '金', '壬': '水', '癸': '水' };
  var GONG_WX = { '1': '水', '2': '土', '3': '木', '4': '木', '5': '土', '6': '金', '7': '金', '8': '土', '9': '火' };
  // 九星/八门按名中特征字取五行（星名可能为「禽芮」等合称，取首个可识别字）
  var XING_WX = { '蓬': '水', '芮': '土', '冲': '木', '辅': '木', '禽': '土', '心': '金', '柱': '金', '任': '土', '英': '火' };
  var MEN_WX = { '休': '水', '生': '土', '伤': '木', '杜': '木', '景': '火', '死': '土', '惊': '金', '开': '金' };

  // 月支 → 四时当令五行（辰未戌丑为四季土月）
  var ZHI_SEASON = {
    '寅': ['春', '木'], '卯': ['春', '木'],
    '巳': ['夏', '火'], '午': ['夏', '火'],
    '申': ['秋', '金'], '酉': ['秋', '金'],
    '亥': ['冬', '水'], '子': ['冬', '水'],
    '辰': ['四季', '土'], '未': ['四季', '土'], '戌': ['四季', '土'], '丑': ['四季', '土']
  };

  // 十干入墓宫（通行口诀：乙丙戊乾六，甲癸坤二，丁庚己艮八，壬辛巽四）
  var RU_MU_GONG = { '乙': '6', '丙': '6', '戊': '6', '甲': '2', '癸': '2', '丁': '8', '庚': '8', '己': '8', '壬': '4', '辛': '4' };
  // 六仪击刑宫（仪所代地支刑其所落宫之支）
  var JI_XING_GONG = { '戊': '3', '己': '2', '庚': '8', '辛': '9', '壬': '4', '癸': '4' };
  var JI_XING_WHY = {
    '戊': '甲子戊·子刑卯（震三）', '己': '甲戌己·戌刑未（坤二）', '庚': '甲申庚·申刑寅（艮八）',
    '辛': '甲午辛·午自刑（离九）', '壬': '甲辰壬·辰自刑（巽四）', '癸': '甲寅癸·寅刑巳（巽四）'
  };

  // 力量档位（用于粗略能量估计与排序）
  var STATE_POWER = { '旺': 1.0, '相': 0.8, '休': 0.5, '囚': 0.3, '死': 0.15 };

  /** 五行 e 在当令五行 s 之下的状态：旺/相/休/囚/死 */
  function stateOf(e, s) {
    if (!e || !s) return '';
    if (e === s) return '旺';
    if (SHENG[s] === e) return '相';   // 令生我
    if (SHENG[e] === s) return '休';   // 我生令
    if (KE[e] === s) return '囚';      // 我克令
    if (KE[s] === e) return '死';      // 令克我
    return '';
  }

  /** 由月支求当令：{ zhi, season, element } */
  function seasonOf(monthZhi) {
    var row = ZHI_SEASON[monthZhi];
    if (!row) return null;
    return { zhi: monthZhi, season: row[0], element: row[1] };
  }

  function xingElement(name) {
    if (!name) return '';
    for (var i = 0; i < name.length; i++) if (XING_WX[name.charAt(i)]) return XING_WX[name.charAt(i)];
    return '';
  }
  function menElement(name) {
    if (!name) return '';
    for (var i = 0; i < name.length; i++) if (MEN_WX[name.charAt(i)]) return MEN_WX[name.charAt(i)];
    return '';
  }

  function isRuMu(gan, gong) { return !!gan && RU_MU_GONG[gan] === String(gong); }
  function isJiXing(gan, gong) { return !!gan && JI_XING_GONG[gan] === String(gong); }

  /**
   * 分析整盘的旺衰与四害。
   * @param {Object} pan 引擎输出的盘（需含 siZhu/jiuXing/baMen/tianPan/diPan/kongWangGong/jiuGongAnalysis）
   * @returns {Object} { season, gongs: {1..9: {...}} }
   */
  function analyze(pan) {
    if (!pan || !pan.siZhu) throw new Error('缺少盘数据(siZhu)');
    var monthZhi = String(pan.siZhu.month || '').charAt(1);
    var season = seasonOf(monthZhi);
    if (!season) throw new Error('无法识别月支：' + pan.siZhu.month);
    var s = season.element;
    var kongWang = (pan.kongWangGong || []).map(String);
    var ja = pan.jiuGongAnalysis || {};
    var gongs = {};

    for (var i = 1; i <= 9; i++) {
      var g = String(i);
      var xing = (pan.jiuXing || {})[g] || '';
      var men = (pan.baMen || {})[g] || '';
      var tg = (pan.tianPan || {})[g] || '';
      var dg = (pan.diPan || {})[g] || '';
      var gongEl = GONG_WX[g];
      var xEl = xingElement(xing), mEl = menElement(men);
      var tEl = GAN_WX[tg] || '', dEl = GAN_WX[dg] || '';

      var harms = [];
      var d = ja[g] || {};
      if (d.menPo) harms.push('门迫');
      if (kongWang.indexOf(g) >= 0) harms.push('空亡');
      var tMu = isRuMu(tg, g), dMu = isRuMu(dg, g);
      if (tMu) harms.push('天盘' + tg + '入墓');
      if (dMu) harms.push('地盘' + dg + '入墓');
      var tJx = isJiXing(tg, g), dJx = isJiXing(dg, g);
      if (tJx) harms.push('天盘' + tg + '击刑');
      if (dJx) harms.push('地盘' + dg + '击刑');

      // 粗略能量：以天盘干旺衰为基，四害逐项打折（门迫/击刑 ×0.5，空亡 ×0.5，入墓 ×0.2）
      var power = STATE_POWER[stateOf(tEl, s)] || 0.5;
      if (d.menPo) power *= 0.5;
      if (kongWang.indexOf(g) >= 0) power *= 0.5;
      if (tJx || dJx) power *= 0.5;
      if (tMu || dMu) power *= 0.2;

      gongs[g] = {
        gong: g,
        gongElement: gongEl, gongState: stateOf(gongEl, s),
        xing: xing, xingElement: xEl, xingState: stateOf(xEl, s),
        men: men, menElement: mEl, menState: stateOf(mEl, s),
        tianGan: tg, tianGanElement: tEl, tianGanState: stateOf(tEl, s),
        diGan: dg, diGanElement: dEl, diGanState: stateOf(dEl, s),
        ruMu: tMu || dMu, ruMuDetail: (tMu ? '天盘' + tg : '') + (tMu && dMu ? '、' : '') + (dMu ? '地盘' + dg : ''),
        jiXing: tJx || dJx,
        jiXingDetail: (tJx ? '天盘' + tg + '（' + JI_XING_WHY[tg] + '）' : '') + (tJx && dJx ? '、' : '') + (dJx ? '地盘' + dg + '（' + JI_XING_WHY[dg] + '）' : ''),
        menPo: !!d.menPo,
        kongWang: kongWang.indexOf(g) >= 0,
        harms: harms,
        power: Math.round(power * 100) / 100
      };
    }
    return { season: season, gongs: gongs };
  }

  /** 生成喂给 AI 的旺衰/四害文本块（简明逐宫 + 用法提示） */
  function toPromptBlock(pan, opts) {
    opts = opts || {};
    var r;
    try { r = analyze(pan); } catch (e) { return ''; }
    var JG = opts.JIU_GONG || {};
    var lines = ['', '【旺衰与四害（引擎未算，由此补全——断强弱成败必用）】',
      '当令：' + r.season.zhi + '月·' + r.season.season + '令，' + r.season.element + '当旺'
      + '（当令者旺、令生者相、生令者休、克令者囚、令克者死）'];
    for (var i = 1; i <= 9; i++) {
      var g = String(i), c = r.gongs[g];
      var nm = (JG[g] && JG[g].name) ? JG[g].name : '';
      var dir = (JG[g] && JG[g].direction) ? JG[g].direction : '';
      var parts = [];
      parts.push('宫' + (c.gongState ? c.gongState : '?'));
      if (c.xing) parts.push(c.xing + c.xingState);
      if (c.men) parts.push(c.men + c.menState);
      if (c.tianGan) parts.push('天盘' + c.tianGan + c.tianGanState);
      if (c.diGan) parts.push('地盘' + c.diGan + c.diGanState);
      lines.push('  - ' + g + '宫' + (nm ? '(' + nm + (dir ? '·' + dir : '') + ')' : '') + '：'
        + parts.join('、')
        + (c.harms.length ? '　【四害：' + c.harms.join('、') + '】' : '')
        + '　力量约' + c.power);
    }
    lines.push('用法：①用神/值符/值使/日干/时干宫旺相则事有力可成，休囚死则力弱难成；'
      + '②四害减力——门迫、击刑各减半，空亡吉凶皆减半且须待填实/冲实方应，入墓仅余两成、事多滞塞；'
      + '③旺相而入墓者，应期多在冲墓之年月日时；衰死又入墓者，谋事难遂，不可强断为吉；'
      + '④同宫多害则减力相乘，须明写"因×害故力弱"，不可无视四害而空言旺相。');
    return lines.join('\n');
  }

  return {
    WU_XING: WU_XING, SHENG: SHENG, KE: KE,
    GAN_WX: GAN_WX, GONG_WX: GONG_WX, XING_WX: XING_WX, MEN_WX: MEN_WX,
    RU_MU_GONG: RU_MU_GONG, JI_XING_GONG: JI_XING_GONG,
    stateOf: stateOf, seasonOf: seasonOf,
    isRuMu: isRuMu, isJiXing: isJiXing,
    analyze: analyze, toPromptBlock: toPromptBlock
  };
});
