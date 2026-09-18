/**
 * 四柱交节边界回归测试（纯 Node，无框架）。
 * 运行：node core/sizhu.test.js
 *
 * 钉住两条规矩：
 *   1) 月柱以**交节时刻**换月（非交节当日零点）；
 *   2) 年柱以**立春时刻**换年（非农历正月初一）。
 * 参见 README「四柱交节边界」。
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var WS = require('./wangshuai.js');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

function sz(iso, method) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: method || '时家', purpose: '综合' }).siZhu;
}
function szFei(iso) {
  return QM.feipanQimen.calculate(new Date(iso), { method: '时家' }).siZhu;
}

// 2025 年节气实际交节时刻（lunar-javascript 计算值，与紫金山天文台公布值同分）：
//   立春 2025-02-03 22:10:28   惊蛰 2025-03-05 16:07:18
//   清明 2025-04-04 20:48:36   立夏 2025-05-05 13:57:13

console.log('== 月柱：以交节时刻为界，非交节当日零点 ==');
t('清明前 67 分钟（2025-04-04 19:41）仍是己卯月', function () {
  assert.deepStrictEqual(sz('2025-04-04T19:41:00'),
    { year: '乙巳', month: '己卯', day: '癸卯', time: '壬戌' });
});
t('清明后（2025-04-04 20:49）才进庚辰月', function () {
  assert.strictEqual(sz('2025-04-04T20:49:00').month, '庚辰');
});
t('交节当日零点（2025-04-04 00:30）仍属上一月', function () {
  assert.strictEqual(sz('2025-04-04T00:30:00').month, '己卯');
});
t('立夏前（2025-05-05 10:00）仍是庚辰月，未跨入辛巳', function () {
  assert.strictEqual(sz('2025-05-05T10:00:00').month, '庚辰');
});
t('立夏后（2025-05-05 14:30）进辛巳月', function () {
  assert.strictEqual(sz('2025-05-05T14:30:00').month, '辛巳');
});

console.log('== 年柱：以立春时刻为界，非农历正月初一 ==');
t('春节已过而立春未到（2025-01-30 10:00）仍是甲辰年', function () {
  assert.deepStrictEqual(sz('2025-01-30T10:00:00'),
    { year: '甲辰', month: '丁丑', day: '己亥', time: '己巳' });
});
t('立春当日交节前（2025-02-03 20:00）仍是甲辰年丁丑月', function () {
  var s = sz('2025-02-03T20:00:00');
  assert.strictEqual(s.year, '甲辰');
  assert.strictEqual(s.month, '丁丑');
});
t('立春交节后（2025-02-03 23:30）进乙巳年戊寅月', function () {
  var s = sz('2025-02-03T23:30:00');
  assert.strictEqual(s.year, '乙巳');
  assert.strictEqual(s.month, '戊寅');
});

console.log('== 日柱/时柱：日以 23:00 子时换日（原有行为，一并钉住）==');
t('2025-02-03 23:30 已换为甲辰日、甲子时', function () {
  var s = sz('2025-02-03T23:30:00');
  assert.strictEqual(s.day, '甲辰');
  assert.strictEqual(s.time, '甲子');
});

console.log('== 转盘与飞盘四柱一致 ==');
t('同一时刻两盘四柱相同', function () {
  ['2025-04-04T19:41:00', '2025-05-05T10:00:00', '2025-01-30T10:00:00', '2025-02-03T23:30:00'].forEach(function (iso) {
    assert.deepStrictEqual(szFei(iso), sz(iso), iso);
  });
});

console.log('== 四柱与局数同步：交节前后局数与月柱一起翻 ==');
t('清明交节前局数仍按春分起，月柱亦未进辰月', function () {
  var p = QM.qimen.calculate(new Date('2025-04-04T19:41:00'), { type: '四柱', method: '时家', purpose: '综合' });
  assert.strictEqual(p.juShu.jieQiName, '春分');
  assert.strictEqual(p.siZhu.month, '己卯');
});
t('清明交节后局数与月柱同时切到清明/庚辰', function () {
  var p = QM.qimen.calculate(new Date('2025-04-04T20:49:00'), { type: '四柱', method: '时家', purpose: '综合' });
  assert.strictEqual(p.juShu.jieQiName, '清明');
  assert.strictEqual(p.siZhu.month, '庚辰');
});

console.log('== 下游：旺衰季节随月支改正 ==');
t('2025-04-04 19:41 为卯月 → 春木令（非辰月土令）', function () {
  var r = WS.analyze(QM.qimen.calculate(new Date('2025-04-04T19:41:00'), { type: '四柱', method: '时家', purpose: '综合' }));
  assert.strictEqual(r.season.season, '春');
  assert.strictEqual(r.season.element, '木');
});

console.log('== 年家/日家旬首不因改动报错 ==');
t('时家/日家/年家均可排盘', function () {
  ['时家', '日家', '年家'].forEach(function (m) {
    var p = QM.qimen.calculate(new Date('2025-04-04T19:41:00'), { type: '四柱', method: m, purpose: '综合' });
    assert.ok(p.juShu && p.juShu.fullName, m);
    assert.ok(p.xunShou, m);
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
