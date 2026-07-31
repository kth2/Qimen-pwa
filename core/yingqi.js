/**
 * 奇门·应期与数字 core —— 纯函数、无副作用、可移植。
 *
 * 解决的问题：引擎算出了空亡**地支**(kongWangZhi，如 戌亥)，但序列化给 AI 的盘面只写
 * 【空亡宫】6、6（宫号，且重复），**从不告诉 AI 哪两个地支空亡**。于是纲要虽写"空亡则
 * 填实冲实"，AI 却无从知道填哪个支，只能臆造（实测出现「午未空亡 → 应在戊己日/辰巳日」
 * 这类错误：戊己是天干、辰巳是别支，皆非午未之填实或冲实）。
 * 本模块把应期所需的**具体干支**全部算好写明：
 *   ① 空亡地支 → 填实之日(该支值日) / 冲实之日(冲该支之日)
 *   ② 驿马地支 → 寅申巳亥动象之期
 *   ③ 入墓宫 → 冲墓之日
 *   ④ 各宫天/地盘干 → 对应日辰（用神宫据此定日）
 *   ⑤ 河图数（定数字/数量/号码）
 *
 * 依据：地支六冲（子午、丑未、寅申、卯酉、辰戌、巳亥）；填实＝该支当值之时，
 * 冲实＝冲动该空支之时；河图数 甲乙3·8、丙丁7·2、戊己5·10、庚辛9·4、壬癸1·6。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YingQi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 地支六冲
  var CHONG = {
    '子': '午', '午': '子', '丑': '未', '未': '丑', '寅': '申', '申': '寅',
    '卯': '酉', '酉': '卯', '辰': '戌', '戌': '辰', '巳': '亥', '亥': '巳'
  };
  // 河图数（干 → 数）
  var HE_TU = { '甲': 3, '乙': 8, '丙': 7, '丁': 2, '戊': 5, '己': 10, '庚': 9, '辛': 4, '壬': 1, '癸': 6 };
  // 宫 → 所属地支（用于墓库与方位对照）
  var GONG_ZHI = {
    '1': ['子'], '2': ['未', '申'], '3': ['卯'], '4': ['辰', '巳'], '5': [],
    '6': ['戌', '亥'], '7': ['酉'], '8': ['丑', '寅'], '9': ['午']
  };
  // 墓宫 → 墓库本支（冲此支即"冲墓"）
  var MU_GONG_ZHI = { '6': '戌', '2': '未', '8': '丑', '4': '辰' };
  var MA_ZHI = ['寅', '申', '巳', '亥'];

  function chongOf(zhi) { return CHONG[zhi] || ''; }
  function heTuOf(gan) { return HE_TU[gan] || null; }

  function uniq(arr) {
    var out = [], seen = {};
    (arr || []).forEach(function (x) { var k = String(x); if (!seen[k]) { seen[k] = 1; out.push(k); } });
    return out;
  }

  /**
   * 计算本盘的应期锚点与数字候选。
   * @param {Object} pan 引擎输出的盘
   * @param {Object} [opts] { yongShenGongs: ['1','3'] 可选，用神所落之宫 }
   */
  function analyze(pan, opts) {
    opts = opts || {};
    if (!pan) throw new Error('缺少盘数据');
    var kwZhi = uniq(pan.kongWangZhi || []);
    var kwGong = uniq(pan.kongWangGong || []); // 引擎会重复输出同宫，去重

    var kongWang = {
      zhi: kwZhi,
      gongs: kwGong,
      tianShi: kwZhi.map(function (z) { return z + '日'; }),                 // 填实：该支值日
      chongShi: kwZhi.map(function (z) { return chongOf(z) + '日'; })        // 冲实：冲该支之日
        .filter(function (s) { return s !== '日'; })
    };

    var ma = pan.maStar && pan.maStar.zhi
      ? { zhi: pan.maStar.zhi, gong: pan.maStar.gong, period: MA_ZHI.join('、') + ' 之日/月' }
      : null;

    // 入墓宫（由 wangshuai 规则同源：乙丙戊→6、甲癸→2、丁庚己→8、壬辛→4）
    var RU_MU = { '乙': '6', '丙': '6', '戊': '6', '甲': '2', '癸': '2', '丁': '8', '庚': '8', '己': '8', '壬': '4', '辛': '4' };
    var ruMu = [];
    for (var g = 1; g <= 9; g++) {
      var gs = String(g);
      var tg = (pan.tianPan || {})[gs], dg = (pan.diPan || {})[gs];
      [[tg, '天盘'], [dg, '地盘']].forEach(function (pair) {
        var gan = pair[0], where = pair[1];
        if (gan && RU_MU[gan] === gs) {
          var muZhi = MU_GONG_ZHI[gs];
          ruMu.push({ gong: gs, gan: gan, where: where, muZhi: muZhi, chongMu: muZhi ? chongOf(muZhi) + '日' : '' });
        }
      });
    }

    // 各宫干 → 日辰 与 河图数
    var gongGan = {};
    for (var i = 1; i <= 9; i++) {
      var k = String(i);
      var t = (pan.tianPan || {})[k] || '', d = (pan.diPan || {})[k] || '';
      gongGan[k] = {
        tianGan: t, diGan: d,
        tianDay: t ? t + '日' : '', diDay: d ? d + '日' : '',
        tianNum: heTuOf(t), diNum: heTuOf(d)
      };
    }

    var yong = (opts.yongShenGongs || []).map(String).filter(function (g) { return gongGan[g]; });

    return { kongWang: kongWang, maXing: ma, ruMu: ruMu, gongGan: gongGan, yongShenGongs: yong, siZhu: pan.siZhu || {} };
  }

  /** 生成喂给 AI 的【应期与数字】文本块——所有干支均已算好，禁止自行臆造 */
  function toPromptBlock(pan, opts) {
    opts = opts || {};
    var r;
    try { r = analyze(pan, opts); } catch (e) { return ''; }
    var JG = opts.JIU_GONG || {};
    var L = [];
    L.push('');
    L.push('【应期与数字（已据本盘算出具体干支，必须照用，禁止自行臆造）】');

    // 空亡
    if (r.kongWang.zhi.length) {
      L.push('· 空亡地支：**' + r.kongWang.zhi.join('、') + '**'
        + (r.kongWang.gongs.length ? '（落' + r.kongWang.gongs.join('、') + '宫）' : ''));
      L.push('  - 填实之日 = 空亡支本身当值：**' + r.kongWang.tianShi.join('、') + '**');
      L.push('  - 冲实之日 = 冲动空亡支：**' + r.kongWang.chongShi.join('、') + '**');
      L.push('  - 注意：填实/冲实只能是上列这几个日辰。**不得改用天干（如戊己日）或其它地支充数。**');
    } else {
      L.push('· 本盘无空亡（不可编造空亡应期）');
    }

    // 驿马
    if (r.maXing) {
      L.push('· 驿马：**' + r.maXing.zhi + '**（落' + r.maXing.gong + '宫）→ 动象应期取 ' + r.maXing.period);
    }

    // 入墓
    if (r.ruMu.length) {
      r.ruMu.forEach(function (m) {
        L.push('· 入墓：' + m.gong + '宫' + m.where + m.gan + ' 入墓（墓库支' + m.muZhi + '）→ 冲墓之日：**' + m.chongMu + '**');
      });
    }

    // 用神宫定日
    if (r.yongShenGongs.length) {
      r.yongShenGongs.forEach(function (g) {
        var c = r.gongGan[g], nm = (JG[g] && JG[g].name) ? JG[g].name : '';
        L.push('· 用神宫 ' + g + '宫' + (nm ? '(' + nm + ')' : '') + ' 定日：天盘' + c.tianGan + '→**' + c.tianDay
          + '**、地盘' + c.diGan + '→**' + c.diDay + '**；河图数 天' + c.tianNum + '/地' + c.diNum);
      });
    }

    // 全宫干→日/数 对照
    var rows = [];
    for (var i = 1; i <= 9; i++) {
      var k = String(i), c = r.gongGan[k];
      if (!c.tianGan && !c.diGan) continue;
      rows.push(k + '宫:' + (c.tianGan ? '天' + c.tianGan + '(' + c.tianDay + '/数' + c.tianNum + ')' : '')
        + (c.diGan ? ' 地' + c.diGan + '(' + c.diDay + '/数' + c.diNum + ')' : ''));
    }
    L.push('· 各宫干→日辰/河图数对照：' + rows.join('；'));
    L.push('· 地支六冲：子午、丑未、寅申、卯酉、辰戌、巳亥（冲实/冲墓据此，勿另推）');
    L.push('· 远近：近事看日时、中事看月、远事看年；旺相应速，休囚入墓应迟。');
    L.push('· 数字题（价格/数量/号码）取用神宫或值符宫天地盘干之河图数（见上对照），'
      + '旺相取足数、休囚减半或取个位，可单取或两干相加，给出一数或区间。');
    return L.join('\n');
  }

  return {
    CHONG: CHONG, HE_TU: HE_TU, GONG_ZHI: GONG_ZHI, MU_GONG_ZHI: MU_GONG_ZHI,
    chongOf: chongOf, heTuOf: heTuOf,
    analyze: analyze, toPromptBlock: toPromptBlock
  };
});
