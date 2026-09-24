/**
 * 年命天干落宫 回归测试（纯 Node，无框架）。
 * 运行：node core/nianming.test.js
 *
 * 起因一（Phase 31）：用户报「Custom 端点的解读会论年命天干，Gemini 的不论」，疑 Gemini 那路漏了年命。
 *   逐字比对两路请求体，答案是**不是**（同 Phase 24）。病根在提示词本身：
 *   ① **转盘从不说年命落在哪一宫**——给了【求测人年命天干】，又三处要求「对年命宫的生克」，却从不定位它。
 *   ② 飞盘把「提供了但定不了」误报成「（未提供年命）」。
 *   ③ core/yongshen.js 的 locate() 只认日干/时干。
 *
 * 起因二（Phase 31 更正）：用户一盘三人竞选局（2018-03-06 17:30），AI 把「甲子年生人」放进中五宫——
 *   理由是「年干壬，遁甲于旬首」，拿**本盘旬首甲辰壬**顶了甲子。这是错的：甲子遁于**戊**，
 *   该盘天盘戊落坎一宫。而 Phase 31 第一版恰恰把同一个错写进了代码（年命甲 → 以值符落宫论）。
 *
 *   纲要原文是「日/时干为甲时，以值符落宫论之」，**不及年命**；也不能及——本盘旬首随占时而变，
 *   年命是出生年，不随占时而变。年命甲按六甲遁仪取宫：甲子戊、甲戌己、甲申庚、甲午辛、甲辰壬、甲寅癸。
 *   故年命甲**必须带年支**；只有一个「甲」就如实说定不了，不得拿旬首顶替。
 *
 * 不变量：**凡提示词要求按年命宫断的，年命宫就必须在提示词里有落宫；定不了就明说，不许顶替。**
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

var APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
var HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var BUNDLE = fs.readFileSync(path.join(ROOT, 'engine.bundle.js'), 'utf8');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

/** 从 app.js 源码里取出 riShiGanBlock 并真的跑起来——源码守卫只能看有没有写，跑一遍才知道对不对。 */
function loadRiShiGanBlock() {
  var at = APP.indexOf('function riShiGanBlock(');
  assert.ok(at > 0, 'app.js 里找不到 riShiGanBlock');
  var end = APP.indexOf('\n  }', at);
  assert.ok(end > at, 'riShiGanBlock 函数体截取失败');
  return new Function('QM', APP.slice(at, end + 4) + '\n; return riShiGanBlock;')(QM);
}
var riShiGanBlock = loadRiShiGanBlock();

// 通则：六甲遁六仪
var DUN = { '甲子': '戊', '甲戌': '己', '甲申': '庚', '甲午': '辛', '甲辰': '壬', '甲寅': '癸' };
// 界面下拉的全部取值（不含「不提供」）：甲须连年支，其余单干
var NM_VALUES = Object.keys(DUN).concat('乙丙丁戊己庚辛壬癸'.split(''));

// 固定盘 A：2025-04-04 19:41（四柱修复那一卦）
var ZP = QM.qimen.calculate(new Date('2025-04-04T19:41:00'), { type: '四柱', method: '时家', purpose: '综合' });
var FP = QM.feipanQimen.calculate(new Date('2025-04-04T19:41:00'), { method: '时家' });
// 固定盘 B：用户那一盘三人竞选局。伏吟，时柱己酉 → 旬首甲辰壬 → 值符落坤二
var ZP18 = QM.qimen.calculate(new Date('2018-03-06T17:30:00'), { type: '四柱', method: '时家', purpose: '综合' });

function tianPanGong(pan, gan) {
  var tp = pan.tianPan || {};
  return Object.keys(tp).filter(function (g) { return tp[g] === gan; })[0];
}
function nmLine(text) { var m = text.match(/- 年命.*/); return m ? m[0] : ''; }
function feipanUser(gan) {
  return QM.feipanPredict.buildPrompt(FP, '钥匙丢了能找到吗？',
    { nianMingGan: gan, methodText: '（纲要占位）', includeMethod: false }).user;
}
function fpLine(text) { var m = text.match(/年命宫：.*/); return m ? m[0] : ''; }

console.log('== 用户那一盘：甲子年生人不是中五，是坎一 ==');
t('盘面前提：伏吟、旬首壬、值符落 2 宫、天盘戊在 1 宫', function () {
  assert.strictEqual(ZP18.xunShou, '壬');
  assert.strictEqual(String(ZP18.zhiFuLuoGong || ZP18.zhiFuGong), '2');
  assert.strictEqual(tianPanGong(ZP18, '戊'), '1');
});
t('转盘 年命甲子 → 甲子遁于戊，天盘落 1 宫(坎·正北)', function () {
  var l = nmLine(riShiGanBlock(ZP18, '甲子'));
  assert.ok(/年命\(求测人本命\)甲子遁于戊：天盘落1宫\(坎·正北\)/.test(l), l);
});
t('转盘 年命甲子 **不得**落到旬首壬(5宫)或值符(2宫)——这正是那次解读的错', function () {
  var l = nmLine(riShiGanBlock(ZP18, '甲子'));
  assert.ok(!/[25]宫/.test(l), '甲子被放进了旬首/值符宫：' + l);
  assert.ok(!/值符|旬首/.test(l), '甲子仍在走值符/旬首：' + l);
});
t('同盘另两人未变：乙丑→离九、辛酉→巽四', function () {
  assert.ok(/乙：天盘落9宫\(离/.test(nmLine(riShiGanBlock(ZP18, '乙'))));
  assert.ok(/辛：天盘落4宫\(巽/.test(nmLine(riShiGanBlock(ZP18, '辛'))));
});

console.log('== 转盘：给了年命，就必须给出年命宫 ==');
t('提供年命(乙) → 块内有年命落宫，且标题点出年命', function () {
  var b = riShiGanBlock(ZP, '乙');
  assert.ok(/【日干\/时干\/年命落宫/.test(b), '标题未点出年命：' + b.split('\n')[1]);
  assert.ok(/- 年命\(求测人本命\)乙：天盘落\d宫\(/.test(b), '缺年命落宫行：\n' + b);
});
t('未提供年命 → 不出年命行，且明说以日干宫代之（不许点名却不给）', function () {
  var b = riShiGanBlock(ZP, '');
  assert.ok(!/- 年命/.test(b), '未提供年命却出了年命行');
  assert.ok(/本次未提供年命，以日干宫代年命宫/.test(b), '未说明以日干宫代年命宫：\n' + b);
  assert.ok(!/时干宫对年命宫/.test(b), '未提供年命时仍要求按年命宫断');
});
t('提供年命时，末行改以年命宫为主宰（纲要：有年命则年命优先于日干）', function () {
  assert.ok(/时干宫对年命宫\(求测人本命，优先于日干宫\)/.test(riShiGanBlock(ZP, '丙')));
});
t('六个甲年各按其遁仪取宫（两盘都查）', function () {
  [ZP, ZP18].forEach(function (pan) {
    Object.keys(DUN).forEach(function (jz) {
      var l = nmLine(riShiGanBlock(pan, jz)), want = tianPanGong(pan, DUN[jz]);
      assert.ok(new RegExp(jz + '遁于' + DUN[jz] + '：天盘落' + want + '宫').test(l), jz + ' → ' + l);
    });
  });
});
t('只给一个「甲」→ 如实说定不了、列出六甲遁仪、明令不得以旬首/值符代之', function () {
  var b = riShiGanBlock(ZP18, '甲'), l = nmLine(b);
  assert.ok(/无法定位/.test(l), '未说定不了：' + l);
  assert.ok(/甲子戊、甲戌己、甲申庚、甲午辛、甲辰壬、甲寅癸/.test(l), '未列六甲遁仪');
  assert.ok(/不得以本盘旬首或值符代之/.test(l), '未禁以旬首代之');
  assert.ok(!/天盘落\d宫/.test(l), '只给甲却定了宫——那必是拿旬首顶的：' + l);
  // 定不了就不能再点名年命宫，退回日干宫
  assert.ok(/年命未能定宫，以日干宫代年命宫/.test(b.split('\n').pop()), '末行未退回日干宫');
});
t('界面全部 15 个取值逐个定得到宫，无一落空', function () {
  NM_VALUES.forEach(function (v) {
    var l = nmLine(riShiGanBlock(ZP, v));
    assert.ok(/天盘落\d宫\(/.test(l), v + ' 定位落空：' + l);
  });
});
t('日干/时干两行格式未变；fmt 的值符分支仍在（时干为甲用它，日干甲另见 jiadun.test.js）', function () {
  var b = riShiGanBlock(ZP, '乙');
  assert.ok(/- 日干\(求测人\)癸：天盘落\d宫\(/.test(b), '日干行变了：\n' + b);
  assert.ok(/- 时干\(所占之事\/对方\)壬：天盘落\d宫\(/.test(b), '时干行变了：\n' + b);
  var fmtSrc = APP.slice(APP.indexOf('function riShiGanBlock('), APP.indexOf('const LIU_JIA_DUN'));
  assert.ok(/甲遁于旬首，以值符落宫论/.test(fmtSrc), '时干为甲的值符分支被删了');
});

console.log('== system 纪律：问句里的多人年命也得照此取（那次三人年命全来自问句） ==');
t('纪律 4.1 在，且给出六甲遁仪全表与例子', function () {
  var at = APP.indexOf("'4.1 年命宫");
  assert.ok(at > 0, '缺纪律 4.1');
  var r = APP.slice(at, APP.indexOf('\n', at));
  ['甲子→戊', '甲戌→己', '甲申→庚', '甲午→辛', '甲辰→壬', '甲寅→癸'].forEach(function (p) {
    assert.ok(r.indexOf(p) >= 0, '4.1 缺 ' + p);
  });
  assert.ok(/甲子年生人看天盘戊落宫/.test(r), '缺例子');
});
t('纪律 4.1 明令不得以旬首/值符代之，惟时干为甲者以值符论', function () {
  var at = APP.indexOf("'4.1 年命宫"), r = APP.slice(at, APP.indexOf('\n', at));
  assert.ok(/不得以本盘旬首或值符代之/.test(r));
  assert.ok(/惟\*\*时干\*\*为甲者以值符落宫论/.test(r), '未点明只有时干走值符');
  assert.ok(/涉及多人/.test(r), '未覆盖问句中多人年命的情形');
});
t('纪律 4.1 紧跟第 4 条（逐宫详析年命宫）之后', function () {
  var a = APP.indexOf("'4. 逐宫详析关键宫位"), b = APP.indexOf("'4.1 年命宫"), c = APP.indexOf("'5. 推理要一步步");
  assert.ok(a > 0 && a < b && b < c, '4.1 位置不对');
});

console.log('== 界面：甲年须连年支选 ==');
t('下拉里无光秃秃的「甲」，六个甲年各一项且值为干支', function () {
  var at = HTML.indexOf('<select id="aiNianMing">'), seg = HTML.slice(at, HTML.indexOf('</select>', at));
  assert.ok(!/<option>甲<\/option>/.test(seg), '仍有单独的「甲」选项——选了也定不了宫');
  Object.keys(DUN).forEach(function (jz) {
    assert.ok(seg.indexOf('value="' + jz + '"') >= 0, '缺 ' + jz);
    assert.ok(seg.indexOf(jz + '(遁' + DUN[jz] + ')') >= 0, jz + ' 未注明所遁之仪');
  });
  var vals = (seg.match(/<option[^>]*>/g) || []).length;
  assert.strictEqual(vals, 16, '应为 1 个「不提供」+ 6 个甲年 + 9 个单干，实得 ' + vals);
});

console.log('== 飞盘：甲年按遁仪、「只给甲」「未提供」「盘上未见」各说各的 ==');
t('提供年命(乙) → 年命宫定位到具体宫', function () {
  assert.ok(/年命宫：\d宫\(/.test(fpLine(feipanUser('乙'))));
});
t('年命甲子 → 定到飞盘天盘戊所在宫，并注明遁戊', function () {
  var l = fpLine(feipanUser('甲子'));
  var tp = FP.tianPanYi || {}, want = Object.keys(tp).filter(function (g) { return tp[g] === '戊'; })[0];
  assert.ok(new RegExp('年命宫：' + want + '宫\\(').test(l), '甲子未落天盘戊宫(' + want + ')：' + l);
  assert.ok(/甲子遁于戊，以天盘戊落宫论/.test(l), '未注明遁戊：' + l);
  assert.ok(!/值符|旬首/.test(l.replace(/不得以旬首或值符代之/, '')), '仍在走值符：' + l);
});
t('只给「甲」→ 说须知年支，不定宫、不说「未提供」', function () {
  var l = fpLine(feipanUser('甲'));
  assert.ok(/须知年支/.test(l) && /不得以旬首或值符代之/.test(l), l);
  assert.ok(!/年命宫：\d宫/.test(l), '只给甲却定了宫：' + l);
  assert.ok(!/未提供年命/.test(l), '提供了甲却说未提供：' + l);
});
t('确实未提供 → 才说「未提供年命」', function () {
  assert.ok(/未提供年命/.test(fpLine(feipanUser(''))));
});
t('界面全部 15 个取值逐个定得到宫，且都不报「未提供」', function () {
  NM_VALUES.forEach(function (v) {
    var l = fpLine(feipanUser(v));
    assert.ok(/年命宫：\d宫\(/.test(l), v + ' 定位失败：' + l);
    assert.ok(!/未提供/.test(l), v + ' 被误报未提供：' + l);
  });
});

console.log('== yongshen.locate()：年命与日干/时干同属干落宫，甲另按遁仪 ==');
t('locate(年命=乙) 定位到天盘乙所在宫', function () {
  var m = YS.locate(ZP, '年命', { riGan: '癸', shiGan: '壬', nianMingGan: '乙' });
  assert.ok(m, '返回 null');
  assert.strictEqual(m.kind, 'gan');
  assert.strictEqual(String(m.gong), tianPanGong(ZP, '乙'));
});
t('locate(年命=甲子) 在用户那盘落 1 宫，resolved 仍是纯干「甲」，via 写明遁戊', function () {
  var m = YS.locate(ZP18, '年命', { riGan: '丁', shiGan: '己', nianMingGan: '甲子' });
  assert.ok(m, '返回 null');
  assert.strictEqual(String(m.gong), '1');
  assert.strictEqual(m.resolved, '甲', 'resolved 须是纯干，否则查不到 symbols');
  assert.ok(/甲子遁于戊/.test(m.via || ''), 'via：' + m.via);
});
t('locate(年命=六甲) 各按遁仪', function () {
  Object.keys(DUN).forEach(function (jz) {
    var m = YS.locate(ZP18, '年命', { riGan: '丁', shiGan: '己', nianMingGan: jz });
    assert.strictEqual(String(m.gong), tianPanGong(ZP18, DUN[jz]), jz);
  });
});
t('locate(年命=甲) 只给甲 → null，不拿值符顶替', function () {
  assert.strictEqual(YS.locate(ZP18, '年命', { riGan: '丁', shiGan: '己', nianMingGan: '甲' }), null);
});
t('未提供年命 → null', function () {
  assert.strictEqual(YS.locate(ZP, '年命', { riGan: '癸', shiGan: '壬', nianMingGan: '' }), null);
});
// 日干为甲（〔用户所定·2026-09-24〕改从遁仪）的回归见 core/jiadun.test.js

console.log('== 三份六甲遁仪表钉在一起 ==');
t('core/yongshen.js 导出的表与通则一致', function () {
  assert.deepStrictEqual(YS.LIU_JIA_DUN, DUN);
});
t('app.js 那一份与通则一致', function () {
  Object.keys(DUN).forEach(function (jz) {
    assert.ok(new RegExp(jz + ": '" + DUN[jz] + "'").test(APP), 'app.js 表缺/错 ' + jz);
  });
});
t('engine.bundle.js 飞盘年命那一份与通则一致', function () {
  // 只认年命宫那一处的表（$nm=）。bundle 里旬首遁干（getXunShou）本有一张同样的表，
  // 若全文搜，这条在改前也会「过」——第一版就是这么假绿的。
  var esc = function (s) { return s.replace(/[^\x00-\x7F]/g, function (c) { return '\\u' + c.charCodeAt(0).toString(16).toUpperCase(); }); };
  var at = BUNDLE.indexOf('$nm={');
  assert.ok(at > 0, 'bundle 里找不到年命宫那张遁仪表（$nm=）');
  var obj = BUNDLE.slice(at, BUNDLE.indexOf('}', at) + 1);
  Object.keys(DUN).forEach(function (jz) {
    assert.ok(obj.indexOf(esc(jz) + ':"' + esc(DUN[jz]) + '"') >= 0, 'bundle 年命表缺/错 ' + jz);
  });
});

console.log('== 两路 provider 收到的仍是同一份提示词 ==');
t('年命只由 app/引擎拼，provider 层不参与——llm.js 里不出现年命字样', function () {
  var LLMSRC = fs.readFileSync(path.join(ROOT, 'llm.js'), 'utf8');
  assert.ok(LLMSRC.indexOf('年命') < 0 && LLMSRC.indexOf('nianMing') < 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
