/**
 * 奇门·五行推理(WuXing) core —— 纯函数、无副作用、可移植。【Phase 40】
 *
 * 用《素问》的五行变化（乘侮、亢害承制、母子相及）加通关，论「事（用神宫）对我（日干宫）」
 * 的关系，断是非题的「如愿／不如愿」。规则逐条照冻结规格《五行推理断法 v1》（sha256 a775af79…）；
 * 与后台影子跟踪所用 shadow_wuxing.js 的 score() 同一实现，同盘同占类必得同一断。
 *
 * 检验记录（如实带进提示词）：
 *   · 旧案例本 189 题平衡准确率 47.3%（纲要 54.0%）；
 *   · 前瞻第一批（2026-10-14 导出，33 题）52.8%（纲要引擎 47.0%、纲要盲断 47.9%），未到预定评估点；
 *   · 2026-10-16 用户决定纳入 app（〔用户所定·2026-10-16〕）。
 *
 * 两派都用（〔用户所定·2026-10-16〕：五行生克是两派共通之理，一视同仁）。零串味守在**取用**一级：
 *   · 转盘：我＝日干宫，事＝本占用神宫（照冻结规格 v1 的占类取法）；
 *   · 飞盘：我＝年命宫（飞盘纲要一节「年命宫＝求测人自身」），事＝引擎按《鸣法》用神章取出的用神宫，
 *           无专用用神时取时干宫（三乙四宫之一，「禀盘主宰」）；宫内五行取明门、天盘星、天盘仪、地盘干。
 *           未提供年命则不断——飞盘以年命为我，不借转盘的日干代之。
 *   · 飞盘未经案例检验（案例本只有 9 例飞盘），提示词如实写明。
 *
 * 边界：
 *   ① 取用分派，五行打分两派同一套。
 *   ② 不重算盘：宫旺衰与四害一律取自 core/wangshuai.js 的 analyze() 结果。
 *   ③ 只断是非题的方向；不管何物、何地、何时、多少。
 *   ④ 「如愿」＝事情朝求测人所盼的方向走；问的若是怕发生之事，如愿即所怕之事不发生。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WuXing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var GONG_WX = { '1': '水', '2': '土', '3': '木', '4': '木', '5': '土', '6': '金', '7': '金', '8': '土', '9': '火' };
  var GAN_WX = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
  var MEN_WX = { 休门: '水', 生门: '土', 伤门: '木', 杜门: '木', 景门: '火', 死门: '土', 惊门: '金', 开门: '金' };
  var XING_WX = { 蓬: '水', 芮: '土', 冲: '木', 辅: '木', 禽: '土', 心: '金', 柱: '金', 任: '土', 英: '火' };
  var SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
  var KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };
  var STATE_V = { 旺: 1.0, 相: 0.8, 休: 0.5, 囚: 0.3, 死: 0.15 };
  var LIU_JIA_DUN = { 甲子: '戊', 甲戌: '己', 甲申: '庚', 甲午: '辛', 甲辰: '壬', 甲寅: '癸' };
  var Y_OF = { wealth: '生门', fengshui: '生门', pregnancy: '生门', health: '生门',
    career: '开门', lawsuit: '开门', traveler: '开门', study: '景门', relationship: '六合', find_person: '六合' };
  var GONG_NAME = { '1': '坎一', '2': '坤二', '3': '震三', '4': '巽四', '5': '中五', '6': '乾六', '7': '兑七', '8': '艮八', '9': '离九' };

  function findIn(m, v) { for (var k in (m || {})) if (m[k] === v) return String(k); return ''; }
  function ganGong(ch, gan) { return findIn(ch.tianPan, gan) || findIn(ch.diPan, gan); }
  function riGanGong(ch) {
    var d = String((ch.siZhu || {}).day || ''), g = d.charAt(0);
    return g === '甲' ? ganGong(ch, LIU_JIA_DUN[d]) : ganGong(ch, g);
  }
  function shiGanGong(ch) {
    var t = String((ch.siZhu || {}).time || ''), g = t.charAt(0);
    if (g === '甲') return ch.zhiFuGong != null ? String(ch.zhiFuGong) : '';
    return ganGong(ch, g);
  }
  function yGong(ch, domain) {
    var y = Y_OF[domain];
    if (!y) return { name: '时干', g: shiGanGong(ch) };
    if (/门$/.test(y)) return { name: y, g: findIn(ch.baMen, y) };
    return { name: y, g: findIn(ch.baShen, y) };
  }
  function power(ws, g) {
    var w = (ws && ws.gongs && ws.gongs[g]) || {};
    var p = STATE_V[w.gongState] != null ? STATE_V[w.gongState] : 0.5;
    if (w.menPo) p *= 0.5; if (w.kongWang) p *= 0.5; if (w.jiXing) p *= 0.5; if (w.ruMu) p *= 0.2;
    return p;
  }
  function lvl(p) { return p >= 0.8 ? '太过' : p <= 0.3 ? '不及' : '平'; }
  function isFeipan(ch) { return !!(ch && (ch.renPanMen || ch.tianPanYi || ch.diPanShen)); }
  function innerWx(ch, g) {
    var s = {}, fp = isFeipan(ch);
    var m = ((fp ? ch.renPanMen : ch.baMen) || {})[g]; if (MEN_WX[m]) s[MEN_WX[m]] = 1;
    String(((fp ? ch.tianPanXing : ch.jiuXing) || {})[g] || '').split('').forEach(function (c) { if (XING_WX[c]) s[XING_WX[c]] = 1; });
    var t = ((fp ? ch.tianPanYi : ch.tianPan) || {})[g], d = (ch.diPan || {})[g];
    if (GAN_WX[t]) s[GAN_WX[t]] = 1; if (GAN_WX[d]) s[GAN_WX[d]] = 1;
    return s;
  }
  function keOf(x) { for (var k in KE) if (KE[k] === x) return k; return ''; }

  /** 冻结规格 v1 的打分。返回 { score, relation, why }。 */
  function score(ch, ws, R, Y) {
    var r = GONG_WX[R], y = GONG_WX[Y], pR = power(ws, R), pY = power(ws, Y), lR = lvl(pR), lY = lvl(pY);
    var o = { rWx: r, yWx: y, pR: +pR.toFixed(3), pY: +pY.toFixed(3), lR: lR, lY: lY };
    function out(s, rel, why) { o.score = s; o.relation = rel; o.why = why; return o; }
    if (R === Y || r === y) return out(1, '比和', '同宫或比和，事与我同气');
    if (SHENG[y] === r) {
      if (lY === '太过' && lR === '不及') {
        return innerWx(ch, Y)[keOf(y)]
          ? out(1, '事生我', '生方太过而宫中有承制，化害为生（亢则害，承乃制）')
          : out(0, '事生我', '生方太过、我不及而无承制，生太过反为害（亢害）');
      }
      return out(1, '事生我', '事来生我');
    }
    if (KE[r] === y) {
      if (lR === '不及' && lY === '太过') return out(-1, '我克事', '我不及而事太过，反为所侮');
      if (lR === '不及') return out(0, '我克事', '我欲制事而力不及（克而无力）');
      return out(1, '我克事', '我能制事');
    }
    if (KE[y] === r) {
      var x = SHENG[y];
      if (SHENG[x] === r && (innerWx(ch, Y)[x] || innerWx(ch, R)[x])) return out(1, '事克我', '事克我而宫中有' + x + '通关，克化为生');
      if (lY === '太过' && lR === '不及') return out(-2, '事克我', '事太过、我不及，克之太过（乘）');
      if (lY === '不及' && lR === '太过') return out(1, '事克我', '事不及、我太过，我反制之（侮）');
      return out(-1, '事克我', '事克我');
    }
    if (SHENG[r] === y) {
      if (lR === '不及') return out(-2, '我生事', '我不及而生事，子盗母气');
      if (lR === '太过') return out(1, '我生事', '我太过，有余而生');
      return out(-1, '我生事', '我耗于事');
    }
    return out(0, '', '未归类');
  }

  /**
   * 主入口。
   * @param {object} a { chart, wangshuai, domain, feipan? }
   *   feipan（飞盘必传，取自引擎 feipanPredict.buildPrompt 的 context）：
   *     { nianMingGong, shiGanGong, yongGong, yongName }
   */
  function analyze(a) {
    a = a || {};
    var ch = a.chart || {};
    var res = { version: VERSION, applicable: false, reason: '', domain: a.domain || '' };
    if (!a.wangshuai || !a.wangshuai.gongs) { res.reason = '缺旺衰结果，本层停用（不自行重算）。'; return res; }
    var R, Y, yName, rLabel;
    if (isFeipan(ch)) {
      res.school = 'feipan';
      var f = a.feipan || {};
      R = f.nianMingGong ? String(f.nianMingGong) : '';
      if (!R) { res.reason = '飞盘以年命宫为我（飞盘纲要一节）；未提供年命或年命无法定宫，本层不断，不借转盘的日干代之。'; return res; }
      if (f.yongGong) { Y = String(f.yongGong); yName = f.yongName || '用神'; }
      else { Y = f.shiGanGong ? String(f.shiGanGong) : ''; yName = '时干'; }
      rLabel = '年命宫';
    } else {
      res.school = 'zhuanpan';
      var yo = yGong(ch, a.domain || '');
      R = riGanGong(ch); Y = yo.g; yName = yo.name; rLabel = '日干宫';
    }
    res.R = R; res.Y = Y; res.yName = yName; res.rLabel = rLabel;
    if (!R || !Y) { res.reason = rLabel + '或用神宫未见，本层弃权。'; return res; }
    var s = score(ch, a.wangshuai, R, Y);
    res.applicable = true;
    res.rName = GONG_NAME[R]; res.yGongName = GONG_NAME[Y];
    for (var k in s) res[k] = s[k];
    res.verdict = s.score > 0 ? '如愿' : s.score < 0 ? '不如愿' : '不定';
    res.lines = toPromptLines(res, false);   // 证据层直接取用；怕发生之事的换算由证据层按问句方向补一句
    return res;
  }

  /** 结果 → 提示词一段。不适用返回空串。framingAdverse：问句是否为怕发生之事。 */
  function toPromptLines(r, framingAdverse) {
    if (!r || !r.applicable) return [];
    var L = [];
    L.push('· 【五行推理 v1】本盘断：**' + r.verdict + '**（得分 ' + (r.score > 0 ? '+' : '') + r.score + '）');
    L.push('  我＝' + (r.rLabel || '日干宫') + r.rName + '（' + r.rWx + '，' + r.lR + '）；事＝' + r.yName + '宫' + r.yGongName +
      '（' + r.yWx + '，' + r.lY + '）；关系：' + r.relation + '——' + r.why + '。');
    if (framingAdverse) L.push('  本问为怕发生之事：「如愿」即所怕之事**不发生**，「不如愿」即它发生。');
    L.push('  用法〔用户所定·2026-10-16〕：是非题作答须参考此断，并在理由里写明五行推理的结论；' +
      '与纲要判读相左时两者都写出来，再给出唯一答案。只管是非方向，不管何物、何地、何时、多少。');
    if (r.school === 'feipan') {
      L.push('  飞盘：此法以年命宫为我、以《鸣法》用神为事，与飞盘纲要「用神对年命之生克盗泄」同一路，' +
        '另加乘侮、亢害承制、子盗母气、通关诸变。飞盘尚无案例检验（案例本只有 9 例飞盘），〔用户所定·2026-10-16〕两派一视同仁纳入。');
    } else {
      L.push('  检验记录：前瞻第一批 33 题平衡准确率 52.8%（纲要引擎 47.0%）；此法断「如愿」偏多（82%，实际 58%），' +
        '纲要则偏断不成——两者正好互补，故相左时须把两边理由都摆出来再定。');
    }
    return L;
  }

  return { VERSION: VERSION, analyze: analyze, score: score, toPromptLines: toPromptLines };
});
