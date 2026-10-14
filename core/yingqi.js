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

  /* ---------- 应期融合法 v1（转盘专用；2026-10-14 前瞻检验通过） ----------
   * 规格：claude/应期融合法v1-冻结规格.md。三法等权投票，取得票最多之支（并列全取）：
   *   ① 填实：本盘空亡二支；
   *   ② 值符宫支合：值符落宫所含地支（隅宫两支）各取其六合支；
   *   ③ 克用神宫之支：五行能克用神落宫五行的地支。用神按占类：求财/风水/产育/健康取生门，
   *      事业/官司/行人取开门，学业取景门，感情/寻人取六合，其余取时干；落中五则此票不投。
   * 前瞻检验（2026-10-08 之后录入、实况写明日子的 13 例）：命中 7，瞎猜期望 3.25，2.15×，单侧 p=0.015。
   * 只在转盘启用：检验数据全是转盘，不推及飞盘（零串味）。 */
  var LIU_HE = { '子': '丑', '丑': '子', '寅': '亥', '亥': '寅', '卯': '戌', '戌': '卯', '辰': '酉', '酉': '辰', '巳': '申', '申': '巳', '午': '未', '未': '午' };
  var ZHI_ORDER = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  var ZHI_WX = { '寅': '木', '卯': '木', '巳': '火', '午': '火', '申': '金', '酉': '金', '亥': '水', '子': '水', '辰': '土', '戌': '土', '丑': '土', '未': '土' };
  var GONG_WX = { '1': '水', '2': '土', '3': '木', '4': '木', '5': '土', '6': '金', '7': '金', '8': '土', '9': '火' };
  var KE = { '木': '土', '土': '水', '水': '火', '火': '金', '金': '木' };
  var FUSION_Y = { wealth: '生门', fengshui: '生门', pregnancy: '生门', health: '生门',
    career: '开门', lawsuit: '开门', traveler: '开门', study: '景门', relationship: '六合', find_person: '六合' };
  var LIU_JIA_DUN = { '甲子': '戊', '甲戌': '己', '甲申': '庚', '甲午': '辛', '甲辰': '壬', '甲寅': '癸' };

  function findGong(map, v) { for (var k in (map || {})) if (map[k] === v) return String(k); return ''; }
  function fusionYGong(pan, domain) {
    var y = FUSION_Y[domain];
    if (y && /门$/.test(y)) return { name: y, gong: findGong(pan.baMen, y) };
    if (y) return { name: y, gong: findGong(pan.baShen, y) };
    var t = String((pan.siZhu || {}).time || ''), g = t.charAt(0);
    if (g === '甲') return { name: '时干', gong: pan.zhiFuGong != null ? String(pan.zhiFuGong) : '' };
    return { name: '时干', gong: findGong(pan.tianPan, g) || findGong(pan.diPan, g) };
  }
  /** 应期融合法 v1。飞盘、或无日柱者返回 null。 */
  function fusionV1(pan, domain) {
    if (!pan || pan.renPanMen || pan.tianPanYi || pan.diPanShen) return null;
    var parts = { '填实': [], '值符宫支合': [], '克用神宫之支': [] };
    parts['填实'] = uniq(pan.kongWangZhi || []);
    var fg = pan.zhiFuGong != null ? String(pan.zhiFuGong) : '';
    parts['值符宫支合'] = uniq((GONG_ZHI[fg] || []).map(function (z) { return LIU_HE[z]; }));
    var y = fusionYGong(pan, domain || '');
    if (y.gong && y.gong !== '5') {
      parts['克用神宫之支'] = ZHI_ORDER.filter(function (z) { return KE[ZHI_WX[z]] === GONG_WX[y.gong]; });
    }
    var votes = {};
    Object.keys(parts).forEach(function (k) { parts[k].forEach(function (z) { votes[z] = (votes[z] || 0) + 1; }); });
    var max = 0; Object.keys(votes).forEach(function (z) { if (votes[z] > max) max = votes[z]; });
    var picks = ZHI_ORDER.filter(function (z) { return max > 0 && votes[z] === max; });
    return { version: '1.0.0', picks: picks, maxVotes: max, votes: votes, parts: parts,
      yName: y.name, yGong: y.gong, zhiFuGong: fg };
  }

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

    // 应期融合法 v1：需知占类（定用神）。未传 domain 时按「其余」取时干，与规格一致。
    var fusion = fusionV1(pan, opts.domain || '');

    return { kongWang: kongWang, maXing: ma, ruMu: ruMu, gongGan: gongGan, yongShenGongs: yong, siZhu: pan.siZhu || {}, fusion: fusion };
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

    // 应期融合法 v1（转盘）
    // 只在调用方给了占类时才写：未给占类则用神无从定，避免与 TIMING 块两套说法
    if (opts.domain && r.fusion && r.fusion.picks.length) {
      var fp = r.fusion.parts;
      L.push('· 应期融合法（前瞻检验通过，转盘首选）：**' + r.fusion.picks.map(function (z) { return z + '日'; }).join('、') + '**'
        + '（得 ' + r.fusion.maxVotes + ' 票；三票＝填实[' + fp['填实'].join('') + ']、值符宫支合[' + fp['值符宫支合'].join('') + ']、克用神(' + r.fusion.yName + ')宫之支[' + fp['克用神宫之支'].join('') + ']）');
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
    chongOf: chongOf, heTuOf: heTuOf, fusionV1: fusionV1,
    analyze: analyze, toPromptBlock: toPromptBlock
  };
});
