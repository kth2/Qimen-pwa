/**
 * Phase 43 万年历与四柱反查 回归测试（纯 Node，无框架）。
 * 运行：node core/calendar.test.js
 *
 * 历法用 lib/tyme4ts.js（6tail tyme4ts 1.5.4 的浏览器打包，与奇门穿壬同一份）。
 * 本文件钉住的是「万年历给的四柱与排盘引擎排出的四柱逐时辰一致」——
 * 用户从万年历按「用此日排盘」，盘上的四柱不能与万年历所示不同。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var vm = require('vm');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'tyme4ts.js'), 'utf8'));
var T = global.tyme4ts || global.window.tyme4ts;
var C = require('./calendar.js');
var ROOT = path.join(__dirname, '..');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function siZhu(dt) {
  return QM.qimen.calculate(dt, { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' }).siZhu;
}

t('tyme4ts 载入（浏览器打包可在 Node 里跑）', function () {
  assert.ok(T && T.SolarDay && T.EightChar, '缺 tyme4ts');
});

t('月历：周一起排、补满整周；节气、农历初一显示月名', function () {
  var mo = C.month(T, 2026, 10);
  assert.strictEqual(mo.cells.length % 7, 0);
  assert.strictEqual(mo.cells[0].date, '2026-09-28');
  assert.strictEqual(mo.cells.filter(function (c) { return c.inMonth; }).length, 31);
  assert.deepStrictEqual(mo.terms, [{ name: '寒露', date: '2026-10-08' }, { name: '霜降', date: '2026-10-23' }]);
  assert.strictEqual(mo.cells.find(function (c) { return c.date === '2026-10-10'; }).lunar, '九月');
});

t('年柱立春换、月柱节换', function () {
  assert.strictEqual(C.day(T, 2024, 2, 3).yearGZ, '癸卯');
  assert.strictEqual(C.day(T, 2024, 2, 4).yearGZ, '甲辰');
  assert.strictEqual(C.day(T, 2026, 10, 7).monthGZ, '丁酉');
  assert.strictEqual(C.day(T, 2026, 10, 8).monthGZ, '戊戌');
});

t('四柱与排盘引擎逐时辰一致（含夜子时算次日、交节当天）', function () {
  [[2026, 10, 30], [2024, 2, 4], [2001, 1, 1], [1999, 12, 31], [1985, 6, 21]].forEach(function (a) {
    var y = a[0], m = a[1], d = a[2], x = C.day(T, y, m, d);
    x.hours.forEach(function (h) {
      var sz = siZhu(new Date(y, m - 1, d, h.h, 30));
      assert.strictEqual(h.gz, sz.time, y + '-' + m + '-' + d + ' ' + h.label);
      assert.strictEqual(h.nextDay || x.dayGZ, sz.day, y + '-' + m + '-' + d + ' ' + h.label + ' 日柱');
      var s0 = siZhu(new Date(y, m - 1, d, h.h, 0));
      assert.strictEqual(h.yearGZ, s0.year, '年柱 ' + h.label);
      assert.strictEqual(h.monthGZ, s0.month, '月柱 ' + h.label);
    });
  });
});

t('交节当天：交节时刻与前后年月柱（立春 2024-02-04 16:27）', function () {
  var x = C.day(T, 2024, 2, 4);
  assert.deepStrictEqual(x.jie, { name: '立春', time: '16:27', before: { yearGZ: '癸卯', monthGZ: '乙丑' }, after: { yearGZ: '甲辰', monthGZ: '丙寅' } });
  assert.deepStrictEqual(x.hours.filter(function (h) { return h.jieInside; }).map(function (h) { return h.label; }), ['申']);
  assert.strictEqual(C.day(T, 2024, 2, 19).jie, null);
});

t('四柱反查：到时辰；子时含前一天夜子；三柱只列日子；不相配的查无；结果逐一以引擎复核', function () {
  var r = C.findByPillars(T, ['丙午', '戊戌', '丁丑', '乙巳'], 1800, 2200).results.map(function (x) { return x.date + ' ' + x.time; });
  assert.deepStrictEqual(r, ['1846-10-14 10:00', '2026-10-30 10:00', '2086-10-15 10:00']);
  var zi = C.findByPillars(T, ['丙午', '戊戌', '戊寅', '壬子'], 2000, 2100).results.map(function (x) { return x.date + ' ' + x.time; });
  assert.deepStrictEqual(zi, ['2026-10-30 23:00', '2026-10-31 00:00', '2086-10-15 23:00', '2086-10-16 00:00']);
  zi.concat(r).forEach(function (s) {
    var sz = siZhu(new Date(s.replace(' ', 'T') + ':00'));
    var want = zi.indexOf(s) >= 0 ? '丙午 戊戌 戊寅 壬子' : '丙午 戊戌 丁丑 乙巳';
    assert.strictEqual([sz.year, sz.month, sz.day, sz.time].join(' '), want, s);
  });
  assert.deepStrictEqual(C.findByPillars(T, ['丙午', '戊戌', '丁丑'], 2000, 2100).results.map(function (x) { return x.date; }), ['2026-10-30', '2086-10-15']);
  assert.strictEqual(C.findByPillars(T, ['丙午', '甲子', '丁丑', '乙巳']).results.length, 0);
  assert.strictEqual(C.findByPillars(T, ['丙午', '戊戌']).ok, false);
});

t('下拉选项：六十甲子；五虎遁定月柱；五鼠遁定时柱', function () {
  assert.strictEqual(C.JIAZI.length, 60);
  assert.deepStrictEqual(C.monthPillars('丙午'), ['庚寅', '辛卯', '壬辰', '癸巳', '甲午', '乙未', '丙申', '丁酉', '戊戌', '己亥', '庚子', '辛丑']);
  assert.strictEqual(C.monthPillars('戊辰')[0], '甲寅');
  assert.deepStrictEqual(C.hourPillars('丁丑').slice(0, 3), ['庚子', '辛丑', '壬寅']);
});

t('「设为年命」与年命下拉一致：甲年选项带年支，余年只有天干', function () {
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var sel = html.slice(html.indexOf('id="aiNianMing"'), html.indexOf('</select>', html.indexOf('id="aiNianMing"')));
  ['甲子', '甲戌', '甲申', '甲午', '甲辰', '甲寅', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'].forEach(function (v) {
    assert.ok(sel.indexOf('value="' + v + '"') >= 0 || sel.indexOf('<option>' + v + '</option>') >= 0, '年命下拉缺 ' + v);
  });
  var ui = fs.readFileSync(path.join(ROOT, 'calendar-ui.js'), 'utf8');
  assert.ok(/gz\[0\] === '甲' \? gz : gz\[0\]/.test(ui), '设年命取值规则变了');
});

t('index.html 与 sw.js 都带上了万年历（否则离线版本缺这一层）', function () {
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ['lib/tyme4ts.js', 'core/calendar.js', 'calendar-ui.js'].forEach(function (f) {
    assert.ok(html.indexOf('src="' + f + '"') >= 0, 'index.html 未载入 ' + f);
    assert.ok(sw.indexOf("'./" + f + "'") >= 0, 'sw.js 未缓存 ' + f);
  });
  assert.ok(/id="calBtn"/.test(html) && /id="calPanel"/.test(html));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
