/**
 * 年命天干落宫 回归测试（纯 Node，无框架）。
 * 运行：node core/nianming.test.js
 *
 * 起因：用户报「Custom 端点的解读会论年命天干，Gemini 的不论」，疑 Gemini 那路提示词漏了年命。
 *
 * 逐字比对两路请求体后，答案又是**不是**（同 Phase 24）：system/user 完全相同。
 * 真正的毛病在提示词本身，与 provider 无关——
 *
 *   ① **转盘从不说年命落在哪一宫**。提示词给了【求测人年命天干】，system 纪律第 4 条与
 *      骨架第 1) 条又反复要求「以…对年命宫的生克盗泄定论」，却从不定位它。模型只能自己
 *      去九宫表里翻那个干：肯翻的就论了，不肯翻的整段跳过。飞盘早有【三乙四宫 + 年命宫】
 *      把它定死，转盘这一路漏了。
 *   ② **年命填「甲」时永远定位不到**：甲不上天盘，而年命那一路没有「遁于旬首、以值符落宫论」
 *      的兜底（紧邻的时干分支有），且飞盘会把它误报成「（未提供年命）」——明明提供了。
 *   ③ core/yongshen.js 的 locate() 只认日干/时干，年命即便传进 actors 也定位不到。
 *
 * 本文件把三条都钉住。**「点了名就必须给」是这里唯一守得住的不变量**：
 * 凡提示词要求按年命宫断的，年命宫就必须在提示词里有落宫。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

var ROOT = path.join(__dirname, '..');
global.window = {};
require(path.join(ROOT, 'engine.bundle.js'));
var QM = global.window.QM;
var YS = require('./yongshen.js');
YS.load(require('../knowledge/domains.json'));

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

/** 从 app.js 源码里取出 riShiGanBlock 并真的跑起来——源码守卫只能看有没有写，跑一遍才知道对不对。 */
function loadRiShiGanBlock() {
  var APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  var at = APP.indexOf('function riShiGanBlock(');
  assert.ok(at > 0, 'app.js 里找不到 riShiGanBlock');
  var end = APP.indexOf('\n  }', at);
  assert.ok(end > at, 'riShiGanBlock 函数体截取失败');
  var src = APP.slice(at, end + 4);
  return new Function('QM', src + '\n; return riShiGanBlock;')(QM);
}
var riShiGanBlock = loadRiShiGanBlock();

// 固定盘：2025-04-04 19:41（即本轮四柱修复那一卦），同一时刻必得同一盘
var ZP = QM.qimen.calculate(new Date('2025-04-04T19:41:00'), { type: '四柱', method: '时家', purpose: '综合' });
var FP = QM.feipanQimen.calculate(new Date('2025-04-04T19:41:00'), { method: '时家' });

function feipanUser(gan) {
  return QM.feipanPredict.buildPrompt(FP, '钥匙丢了能找到吗？',
    { nianMingGan: gan, methodText: '（纲要占位）', includeMethod: false }).user;
}
function nianMingLine(text) {
  var m = text.match(/年命宫：.*/);
  return m ? m[0] : '';
}

console.log('== 转盘：给了年命天干，就必须给出年命宫 ==');
t('提供年命(乙) → 块内有年命落宫，且标题点出年命', function () {
  var b = riShiGanBlock(ZP, '乙');
  assert.ok(/【日干\/时干\/年命落宫/.test(b), '标题未点出年命：' + b.split('\n')[1]);
  assert.ok(/- 年命\(求测人本命\)乙：天盘落\d宫\(/.test(b), '缺年命落宫行：\n' + b);
});
t('未提供年命 → 不出年命行，且明说以日干宫代之（不许点名却不给）', function () {
  var b = riShiGanBlock(ZP, '');
  assert.ok(!/- 年命/.test(b), '未提供年命却出了年命行');
  assert.ok(/以日干宫代年命宫/.test(b), '未说明以日干宫代年命宫：\n' + b);
  // 末行不得再要求「对年命宫的生克」——那正是此前让模型无所适从的写法
  assert.ok(!/对年命宫\(/.test(b) && !/时干宫对年命宫/.test(b), '未提供年命时仍要求按年命宫断');
});
t('提供年命时，末行改以年命宫为主宰（纲要：有年命则年命优先于日干）', function () {
  var b = riShiGanBlock(ZP, '丙');
  assert.ok(/时干宫对年命宫\(求测人本命，优先于日干宫\)/.test(b), '末行未改以年命宫为主：\n' + b);
});
t('年命=甲 → 走「遁于旬首、以值符落宫论」，与日干/时干同一口径', function () {
  var b = riShiGanBlock(ZP, '甲');
  assert.ok(/- 年命\(求测人本命\)甲：甲遁于旬首，以值符落宫论 → \d宫\(/.test(b), '甲未走值符落宫：\n' + b);
});
t('十干逐个都定位得到，无一落空', function () {
  '甲乙丙丁戊己庚辛壬癸'.split('').forEach(function (g) {
    var b = riShiGanBlock(ZP, g);
    assert.ok(/- 年命\(求测人本命\)/.test(b), g + ' 无年命行');
    assert.ok(!/年命\(求测人本命\).*(未见|\?宫)/.test(b), g + ' 定位落空：' + nianMingLine(b));
  });
});
t('日干/时干两行未被改动（原有行为不回退）', function () {
  var b = riShiGanBlock(ZP, '乙');
  assert.ok(/- 日干\(求测人\)癸：天盘落\d宫\(/.test(b), '日干行变了：\n' + b);
  assert.ok(/- 时干\(所占之事\/对方\)壬：天盘落\d宫\(/.test(b), '时干行变了：\n' + b);
});

console.log('== 飞盘：甲要有兜底，「未提供」与「查不到」要分开说 ==');
t('提供年命(乙) → 年命宫定位到具体宫', function () {
  assert.ok(/年命宫：\d宫\(/.test(feipanUser('乙')), '年命宫未定位：' + nianMingLine(feipanUser('乙')));
});
t('年命=甲 → 定位到值符落宫，并注明遁于旬首（改前报「未提供」）', function () {
  var line = nianMingLine(feipanUser('甲'));
  assert.ok(/年命宫：\d宫\(/.test(line), '甲仍定位不到：' + line);
  assert.ok(/甲遁于旬首，以值符落宫论/.test(line), '甲未注明出处：' + line);
  assert.ok(!/未提供/.test(line), '提供了甲却仍说「未提供」：' + line);
});
t('确实未提供 → 才说「未提供年命」', function () {
  assert.ok(/未提供年命/.test(nianMingLine(feipanUser(''))), '未提供时文案不对：' + nianMingLine(feipanUser('')));
});
t('十干逐个都定位得到，且都不报「未提供」', function () {
  '甲乙丙丁戊己庚辛壬癸'.split('').forEach(function (g) {
    var line = nianMingLine(feipanUser(g));
    assert.ok(/年命宫：\d宫\(/.test(line), g + ' 定位失败：' + line);
    assert.ok(!/未提供/.test(line), g + ' 被误报未提供：' + line);
  });
});

console.log('== yongshen.locate()：年命与日干/时干同属干落宫 ==');
t('locate(年命) 定位到与该干天盘所在宫一致', function () {
  var actors = { riGan: '癸', shiGan: '壬', nianMingGan: '乙' };
  var m = YS.locate(ZP, '年命', actors);
  assert.ok(m, 'locate(年命) 返回 null');
  assert.strictEqual(m.kind, 'gan');
  assert.strictEqual(m.resolved, '乙');
  var tp = ZP.tianPan || {}, want = Object.keys(tp).filter(function (g) { return tp[g] === '乙'; })[0];
  assert.strictEqual(String(m.gong), String(want), '年命宫与天盘乙所在宫不符');
});
t('locate(年命=甲) 走值符落宫，resolved 仍是纯干「甲」（否则查不到 symbols）', function () {
  var m = YS.locate(ZP, '年命', { riGan: '癸', shiGan: '壬', nianMingGan: '甲' });
  assert.ok(m, 'locate(年命=甲) 返回 null');
  assert.strictEqual(m.resolved, '甲');
  assert.strictEqual(String(m.gong), String(ZP.zhiFuLuoGong || ZP.zhiFuGong));
  assert.ok(/遁于旬首/.test(m.via || ''), '缺 via 说明');
});
t('未提供年命 → locate 如实返回 null，不得代为编造', function () {
  assert.strictEqual(YS.locate(ZP, '年命', { riGan: '癸', shiGan: '壬', nianMingGan: '' }), null);
});
t('日干/时干的定位未被改动', function () {
  var actors = { riGan: '甲', shiGan: '壬', nianMingGan: '乙' };
  var ri = YS.locate(ZP, '日干', actors), shi = YS.locate(ZP, '时干', actors);
  assert.strictEqual(ri.resolved, '甲');
  assert.strictEqual(String(ri.gong), String(ZP.zhiFuLuoGong || ZP.zhiFuGong), '日干甲仍应走值符落宫');
  assert.strictEqual(shi.resolved, '壬');
});

console.log('== 两路 provider 收到的仍是同一份提示词（本次改动不得把它们改分家）==');
t('年命行只由 app/引擎拼，provider 层不参与——llm.js 里不出现年命字样', function () {
  var LLMSRC = fs.readFileSync(path.join(ROOT, 'llm.js'), 'utf8');
  assert.ok(LLMSRC.indexOf('年命') < 0, 'llm.js 里出现了年命——提示词内容不该下沉到 provider 层');
  assert.ok(LLMSRC.indexOf('nianMing') < 0, 'llm.js 里出现了 nianMing');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
