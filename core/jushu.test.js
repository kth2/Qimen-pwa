/**
 * 四法（时家/日家/月家/年家）局数与空亡回归测试（纯 Node，无框架）。
 * 运行：node core/jushu.test.js
 *
 * 钉住三条旧账的修复（见 README「Phase 30」）：
 *   1) 月家能排盘（原 getJieQiList()[...].getName() 直接抛异常），且取的是**本月之节**；
 *   2) 年家恒以**立春**定局（原取成农历二月初四的前一节气，逐年是雨水/惊蛰/春分）；
 *   3) 日家空亡与旬首**同源**（同取 Exact，23:00 换日后两者不再打架）。
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

function pan(iso, method) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: method, purpose: '综合' });
}

console.log('== 四法均可排盘（月家曾直接抛异常）==');
t('时家/日家/月家/年家都给得出局数与旬首', function () {
  ['时家', '日家', '月家', '年家'].forEach(function (m) {
    var p = pan('2025-04-04T19:41:00', m);
    assert.ok(p.juShu && p.juShu.fullName, m + ' 无局数');
    assert.ok(p.xunShou, m + ' 无旬首');
    assert.ok(Array.isArray(p.kongWangZhi) && p.kongWangZhi.length === 2, m + ' 空亡不成对');
  });
});

console.log('== 月家：节气取本月之节（由月支定，非农历月下标）==');
t('己卯月取惊蛰，卯属子午卯酉为上元 → 阳遁1局', function () {
  var j = pan('2025-04-04T19:41:00', '月家').juShu;
  assert.strictEqual(j.jieQiName, '惊蛰');
  assert.strictEqual(j.yuan, '上元');
  assert.strictEqual(j.fullName, '阳遁1局 (上元)');
});
t('十二月支各取其节，无一落空', function () {
  var want = {
    '寅': '立春', '卯': '惊蛰', '辰': '清明', '巳': '立夏', '午': '芒种', '未': '小暑',
    '申': '立秋', '酉': '白露', '戌': '寒露', '亥': '立冬', '子': '大雪', '丑': '小寒'
  };
  var seen = {};
  for (var m = 0; m < 12; m++) {
    var p = pan('2025-' + String(m + 1).padStart(2, '0') + '-15T12:00:00', '月家');
    var zhi = p.siZhu.month.charAt(1);
    assert.strictEqual(p.juShu.jieQiName, want[zhi], '月支 ' + zhi);
    seen[zhi] = true;
  }
  assert.strictEqual(Object.keys(seen).length, 12, '12 个月支未跑全');
});
t('阴阳遁在夏至后（未月/小暑）转阴、冬至后（丑月/小寒）转阳', function () {
  assert.strictEqual(pan('2025-06-15T12:00:00', '月家').juShu.type, 'yang'); // 午月·芒种
  assert.strictEqual(pan('2025-07-15T12:00:00', '月家').juShu.type, 'yin');  // 未月·小暑
  assert.strictEqual(pan('2025-12-15T12:00:00', '月家').juShu.type, 'yin');  // 子月·大雪
  assert.strictEqual(pan('2025-01-15T12:00:00', '月家').juShu.type, 'yang'); // 丑月·小寒
});
t('闰月不越界（2025 闰六月）', function () {
  var p = pan('2025-08-01T12:00:00', '月家');
  assert.ok(p.juShu.fullName, '闰月排盘失败');
  assert.strictEqual(p.juShu.jieQiName, '小暑'); // 未月
});

console.log('== 年家：恒以立春定局 ==');
t('四年均取立春，且合子午卯酉阳8／寅申巳亥阳5／辰戌丑未阳2', function () {
  var want = { 2023: ['癸卯', '阳遁8局 (上元)'], 2024: ['甲辰', '阳遁2局 (下元)'],
               2025: ['乙巳', '阳遁5局 (中元)'], 2026: ['丙午', '阳遁8局 (上元)'] };
  Object.keys(want).forEach(function (y) {
    var p = pan(y + '-06-01T12:00:00', '年家');
    assert.strictEqual(p.siZhu.year, want[y][0], y + ' 年柱');
    assert.strictEqual(p.juShu.jieQiName, '立春', y + ' 节气');
    assert.strictEqual(p.juShu.fullName, want[y][1], y + ' 局数');
  });
});
t('年内任何时点（立春后）年家局数不变', function () {
  var a = pan('2025-02-04T09:00:00', '年家').juShu.fullName;
  var b = pan('2025-11-30T23:00:00', '年家').juShu.fullName;
  assert.strictEqual(a, '阳遁5局 (中元)');
  assert.strictEqual(b, a);
});

console.log('== 日家：空亡与旬首同源（23:00 换日）==');
t('22:30 为癸卯日（甲午旬）：旬首辛、空亡辰巳', function () {
  var p = pan('2025-04-04T22:30:00', '日家');
  assert.strictEqual(p.siZhu.day, '癸卯');
  assert.strictEqual(p.xunShou, '辛');
  assert.deepStrictEqual(p.kongWangZhi, ['辰', '巳']);
});
t('23:30 已换甲辰日（甲辰旬）：旬首壬、空亡寅卯（改前仍报辰巳）', function () {
  var p = pan('2025-04-04T23:30:00', '日家');
  assert.strictEqual(p.siZhu.day, '甲辰');
  assert.strictEqual(p.xunShou, '壬');
  assert.deepStrictEqual(p.kongWangZhi, ['寅', '卯']);
});
t('换日前后一小时内，空亡必与日柱所在旬相符', function () {
  var XUN_KONG = { '甲子': ['戌', '亥'], '甲戌': ['申', '酉'], '甲申': ['午', '未'],
                   '甲午': ['辰', '巳'], '甲辰': ['寅', '卯'], '甲寅': ['子', '丑'] };
  var JIA_ZI = [];
  var GAN = '甲乙丙丁戊己庚辛壬癸', ZHI = '子丑寅卯辰巳午未申酉戌亥';
  for (var i = 0; i < 60; i++) JIA_ZI.push(GAN.charAt(i % 10) + ZHI.charAt(i % 12));
  ['2025-04-04T22:30:00', '2025-04-04T23:30:00', '2025-02-03T23:10:00', '2025-08-09T23:59:00']
    .forEach(function (iso) {
      var p = pan(iso, '日家');
      var idx = JIA_ZI.indexOf(p.siZhu.day);
      var xunShou = JIA_ZI[Math.floor(idx / 10) * 10];
      assert.deepStrictEqual(p.kongWangZhi, XUN_KONG[xunShou], iso + ' 日柱 ' + p.siZhu.day);
    });
});

console.log('== 时家不受本次改动影响 ==');
t('时家局数仍按交节时刻走（春分 → 阳遁9局 中元）', function () {
  var j = pan('2025-04-04T19:41:00', '时家').juShu;
  assert.strictEqual(j.jieQiName, '春分');
  assert.strictEqual(j.fullName, '阳遁9局 (中元)');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
