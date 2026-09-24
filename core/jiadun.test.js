/**
 * 甲的遁仪取宫 回归测试（纯 Node，无框架）。
 * 运行：node core/jiadun.test.js
 *
 * 甲不上天盘。纲要原文：「日/时干为甲时，以值符落宫论之」。
 * 〔用户所定·2026-09-24〕：**日干**一半改从六甲遁仪，年命一并明定；**时干**照旧。
 *
 *   时干为甲 → 以值符落宫论。甲X时之旬首**就是**甲X本身，与遁仪法恰好重合。
 *   日干为甲 → 按本日之甲所遁之仪取宫：甲子戊、甲戌己、甲申庚、甲午辛、甲辰壬、甲寅癸。
 *   年命为甲 → 按本年之甲所遁之仪取宫（见 core/nianming.test.js）。
 *   类象之甲 → 不属某日某年，无本旬之仪可依，仍以值符论（本次不动）。
 *
 * 为什么日干不能走值符：甲日十二时辰是甲子…癸酉（甲子旬，遁戊）与甲戌、乙亥（甲戌旬，遁己），
 * 所以按值符取，**任何甲日的日干都只会取到戊或己**——甲午日、甲寅日也一样。值符是按占时起的，
 * 日干是那一天本身，不该随时辰走。
 *
 * 日干甲的取宫在四处各有实现：纲要原文、app.js riShiGanBlock、core/yongshen.js locate()、
 * core/xiangyi.js resolveElement()。本文件逐处钉住，并把四份六甲遁仪表钉在一起。
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
var XY = require('./xiangyi.js');

var APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
var BUNDLE = fs.readFileSync(path.join(ROOT, 'engine.bundle.js'), 'utf8');
var ZP_METHOD = fs.readFileSync(path.join(ROOT, 'assets', 'zhuanpan-method.md'), 'utf8');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

var DUN = { '甲子': '戊', '甲戌': '己', '甲申': '庚', '甲午': '辛', '甲辰': '壬', '甲寅': '癸' };

function pan(iso) { return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合' }); }
function tianPanGong(p, gan) {
  var tp = p.tianPan || {};
  return Object.keys(tp).filter(function (g) { return tp[g] === gan; })[0];
}
function zhiFu(p) { return String(p.zhiFuLuoGong || p.zhiFuGong); }

var riShiGanBlock = (function () {
  var at = APP.indexOf('function riShiGanBlock('), end = APP.indexOf('\n  }', at);
  assert.ok(at > 0 && end > at, 'app.js 里取不出 riShiGanBlock');
  return new Function('QM', APP.slice(at, end + 4) + '\n; return riShiGanBlock;')(QM);
})();
function riLine(p) { var m = riShiGanBlock(p, '').match(/- 日干.*/); return m ? m[0] : ''; }
function shiLine(p) { var m = riShiGanBlock(p, '').match(/- 时干.*/); return m ? m[0] : ''; }

// 固定样本：同一时辰（己巳时，甲子旬，旬首戊），遁仪法与值符法落宫各不相同
var CASES = [
  { iso: '2025-01-25T10:00:00', day: '甲午', yi: '辛', gong: '1', zhiFu: '4' },
  { iso: '2025-02-14T10:00:00', day: '甲寅', yi: '癸', gong: '3', zhiFu: '6' },
  { iso: '2025-01-15T10:00:00', day: '甲申', yi: '庚', gong: '4', zhiFu: '9' },
  { iso: '2025-02-04T10:00:00', day: '甲辰', yi: '壬', gong: '9', zhiFu: '3' }
];
// 对照：甲子日前十个时辰，旬首恰是甲子本身，两法重合
var AGREE = { iso: '2025-02-24T10:00:00', day: '甲子', yi: '戊', gong: '1' };
// 时干为甲：甲午日甲子时（23:00 已换日）
var SHI_JIA = '2025-01-25T00:30:00';

console.log('== 纲要原文已改，并留出处 ==');
t('时干为甲仍以值符论；日干、年命为甲按遁仪；不得以旬首/值符代之', function () {
  var line = ZP_METHOD.split('\n').filter(function (l) { return /甲干不上天盘/.test(l); })[0] || '';
  assert.ok(/\*\*时干\*\*为甲时，以值符落宫论之/.test(line), '时干那一半丢了：' + line);
  assert.ok(/\*\*日干、年命为甲时，按其本日、本年之甲所遁之仪取宫\*\*/.test(line), '日干/年命未改从遁仪');
  ['甲子→戊', '甲戌→己', '甲申→庚', '甲午→辛', '甲辰→壬', '甲寅→癸'].forEach(function (x) {
    assert.ok(line.indexOf(x) >= 0, '纲要缺 ' + x);
  });
  assert.ok(/不得以本盘旬首或值符代之/.test(line));
});
t('改动标了〔用户所定·日期〕，且写明原文——纲要原文与用户所定不可混称', function () {
  var line = ZP_METHOD.split('\n').filter(function (l) { return /甲干不上天盘/.test(l); })[0] || '';
  assert.ok(/〔用户所定·2026-09-24·原文「日\/时干为甲时，以值符落宫论之」/.test(line), '出处/原文未留：' + line);
});

console.log('== app.js riShiGanBlock：日干甲按遁仪 ==');
CASES.forEach(function (c) {
  t(c.day + '日 → 日干遁' + c.yi + '，天盘落' + c.gong + '宫（值符在' + c.zhiFu + '宫，不取）', function () {
    var p = pan(c.iso);
    assert.strictEqual(p.siZhu.day, c.day, '前提：日柱');
    assert.strictEqual(zhiFu(p), c.zhiFu, '前提：值符落宫');
    var l = riLine(p);
    assert.ok(new RegExp('日干\\(求测人\\)' + c.day + '遁于' + c.yi + '：天盘落' + c.gong + '宫').test(l), l);
    assert.ok(!/值符/.test(l), '日干甲仍在走值符：' + l);
  });
});
t('甲子日（对照）：遁戊与值符恰好同宫，两法此处本就一致', function () {
  var p = pan(AGREE.iso);
  assert.strictEqual(p.siZhu.day, '甲子');
  assert.strictEqual(zhiFu(p), AGREE.gong);
  assert.ok(new RegExp('甲子遁于戊：天盘落' + AGREE.gong + '宫').test(riLine(p)), riLine(p));
});
t('时干为甲（甲午日甲子时）仍以值符落宫论', function () {
  var p = pan(SHI_JIA);
  assert.strictEqual(p.siZhu.time, '甲子', '前提：时柱甲子');
  var l = shiLine(p);
  assert.ok(new RegExp('时干\\(所占之事\\/对方\\)甲：甲遁于旬首，以值符落宫论 → ' + zhiFu(p) + '宫').test(l), l);
});
t('非甲日干不受影响', function () {
  var p = pan('2025-04-04T19:41:00');   // 癸卯日
  assert.ok(/- 日干\(求测人\)癸：天盘落\d宫/.test(riLine(p)), riLine(p));
});
t('扫 120 天：甲日的日干宫一律等于天盘遁仪之宫，且确有与值符不同者', function () {
  var n = 0, differ = 0;
  for (var d = 0; d < 120; d++) {
    [3, 10, 17].forEach(function (h) {
      var dt = new Date(2025, 0, 1 + d, h, 30);
      var p = QM.qimen.calculate(dt, { type: '四柱', method: '时家', purpose: '综合' });
      var day = p.siZhu.day; if (day.charAt(0) !== '甲') return;
      n++;
      var want = tianPanGong(p, DUN[day]);
      assert.ok(new RegExp(day + '遁于' + DUN[day] + '：天盘落' + want + '宫').test(riLine(p)), dt + ' ' + riLine(p));
      if (want !== zhiFu(p)) differ++;
    });
  }
  assert.ok(n >= 20, '甲日样本太少：' + n);
  assert.ok(differ > 0, '没有一个样本与值符不同——那等于没测出改动');
});

console.log('== core/yongshen.js locate / resolve：日干甲按遁仪 ==');
CASES.forEach(function (c) {
  t(c.day + '日 locate(日干) → ' + c.gong + '宫，resolved 纯干，via 写明遁' + c.yi, function () {
    var p = pan(c.iso);
    var m = YS.locate(p, '日干', { riGan: '甲', riZhu: c.day, shiGan: p.siZhu.time.charAt(0) });
    assert.ok(m, '返回 null');
    assert.strictEqual(String(m.gong), c.gong);
    assert.strictEqual(m.resolved, '甲', 'resolved 须是纯干，否则查不到 symbols');
    assert.strictEqual(m.via, c.day + '遁于' + c.yi + '，以天盘' + c.yi + '落宫论');
  });
});
t('resolve() 自建 actors 时带上 riZhu，端到端取到遁仪之宫', function () {
  var c = CASES[0], p = pan(c.iso);
  var ys = YS.resolve({ domain: 'wealth', chart: p });
  assert.strictEqual(ys.actors.riZhu, c.day, 'actors 未带日柱');
  var ri = ys.examine.filter(function (m) { return m.name === '日干'; })[0];
  assert.ok(ri, 'examine 里没有日干');
  assert.strictEqual(String(ri.gong), c.gong);
});
t('actors 未给 riZhu 时退回盘上日柱，结果相同', function () {
  var c = CASES[1], p = pan(c.iso);
  var m = YS.locate(p, '日干', { riGan: '甲', shiGan: '己' });
  assert.strictEqual(String(m.gong), c.gong);
});
t('时干为甲 locate 仍走值符', function () {
  var p = pan(SHI_JIA);
  var m = YS.locate(p, '时干', { riGan: '甲', riZhu: '甲午', shiGan: '甲' });
  assert.strictEqual(String(m.gong), zhiFu(p));
  assert.ok(/遁于旬首/.test(m.via || ''));
});
t('类象之甲仍走值符（本次不动）', function () {
  var p = pan(CASES[0].iso);
  var m = YS.locate(p, '甲', {});
  assert.ok(m, '类象甲返回 null');
  assert.strictEqual(String(m.gong), zhiFu(p));
});

console.log('== core/xiangyi.js resolveElement：日干甲按遁仪 ==');
CASES.forEach(function (c) {
  t(c.day + '日 → ' + c.gong + '宫', function () {
    var p = pan(c.iso), idx = XY.indexChart(p);
    assert.strictEqual(idx.riZhu, c.day, 'indexChart 未带日柱');
    var r = XY.resolveElement('日干', idx);
    assert.ok(r, '返回 null');
    assert.strictEqual(String(r.gong), c.gong);
    assert.strictEqual(r.resolved, '甲');
    assert.ok(new RegExp(c.day + '遁于' + c.yi).test(r.via), r.via);
  });
});
t('日干甲的层记作 dunYi，不当「甲在天盘」——否则会按甲墓于坤二硬断（第一版踩过）', function () {
  var WS = require('./wangshuai.js');
  CASES.forEach(function (c) {
    var r = XY.resolveElement('日干', XY.indexChart(pan(c.iso)));
    assert.strictEqual(r.layer, 'dunYi', c.day + ' 层号：' + r.layer);
  });
  // 扫甲日：凡断日干入墓，必是所落之宫内确有干入墓（与 wangshuai 同源），且不写成「甲墓于」
  var hit = 0;
  for (var d = 0; d < 120; d++) {
    var p = QM.qimen.calculate(new Date(2025, 0, 1 + d, 10, 30), { type: '四柱', method: '时家', purpose: '综合' });
    if (p.siZhu.day.charAt(0) !== '甲') continue;
    var ws = WS.analyze(p);
    var f = XY.analyze({ domain: 'wealth', chart: p, wangshuai: ws }).focus.filter(function (x) { return x.name === '日干'; })[0];
    if (!f || f.flags.indexOf('入墓') < 0) continue;
    hit++;
    assert.ok(ws.gongs[f.gong].ruMu, p.siZhu.day + ' 断日干入墓而 wangshuai 未判');
    assert.ok(!/^甲墓于/.test(f.flagWhy['入墓'] || ''), '把甲当成上了天盘：' + f.flagWhy['入墓']);
  }
});
t('时干为甲 resolveElement 仍走值符', function () {
  var p = pan(SHI_JIA), r = XY.resolveElement('时干', XY.indexChart(p));
  assert.strictEqual(String(r.gong), zhiFu(p));
  assert.strictEqual(r.layer, 'zhiFu');
});
t('yongshen 与 xiangyi 两层对日干甲给出同一宫', function () {
  CASES.concat([AGREE]).forEach(function (c) {
    var p = pan(c.iso);
    var a = YS.locate(p, '日干', { riGan: '甲', riZhu: c.day }), b = XY.resolveElement('日干', XY.indexChart(p));
    assert.strictEqual(String(a.gong), String(b.gong), c.day + ' 两层分家');
  });
});

console.log('== system 纪律 4.1 覆盖日干 ==');
t('4.1 写明日干为甲按本日之甲所遁之仪，惟时干以值符', function () {
  var at = APP.indexOf("'4.1 年命宫"), r = APP.slice(at, APP.indexOf('\n', at));
  assert.ok(/年命、日干为甲者/.test(r) && /本年、本日之甲所遁之仪/.test(r), '4.1 未覆盖日干');
  assert.ok(/甲午日之日干看天盘辛落宫/.test(r), '缺日干的例子');
  assert.ok(/惟\*\*时干\*\*为甲者以值符落宫论/.test(r));
});

console.log('== 四份六甲遁仪表钉在一起 ==');
t('yongshen / xiangyi 导出的表与通则一致', function () {
  assert.deepStrictEqual(YS.LIU_JIA_DUN, DUN);
  assert.deepStrictEqual(XY._TABLES.LIU_JIA_DUN, DUN);
});
t('app.js 与 engine.bundle.js 的表与通则一致', function () {
  Object.keys(DUN).forEach(function (jz) {
    assert.ok(new RegExp(jz + ": '" + DUN[jz] + "'").test(APP), 'app.js 表缺/错 ' + jz);
  });
  var esc = function (s) { return s.replace(/[^\x00-\x7F]/g, function (c) { return '\\u' + c.charCodeAt(0).toString(16).toUpperCase(); }); };
  var at = BUNDLE.indexOf('$nm={'), obj = BUNDLE.slice(at, BUNDLE.indexOf('}', at) + 1);
  assert.ok(at > 0, 'bundle 里找不到年命宫那张表');
  Object.keys(DUN).forEach(function (jz) {
    assert.ok(obj.indexOf(esc(jz) + ':"' + esc(DUN[jz]) + '"') >= 0, 'bundle 表缺/错 ' + jz);
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
