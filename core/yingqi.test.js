/**
 * 应期与数字 core 单元测试（纯 Node，无框架）。
 * 运行：node core/yingqi.test.js
 * 重点回归：空亡填实/冲实必须是"空亡地支本身"与"其六冲之支"，
 *          不得出现天干（戊己日）或无关地支——此为实测所见的错误。
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var YQ = require('./yingqi.js');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

console.log('== 地支六冲 ==');
t('六冲成对且互逆', function () {
  var pairs = [['子', '午'], ['丑', '未'], ['寅', '申'], ['卯', '酉'], ['辰', '戌'], ['巳', '亥']];
  pairs.forEach(function (p) {
    assert.strictEqual(YQ.chongOf(p[0]), p[1], p[0]);
    assert.strictEqual(YQ.chongOf(p[1]), p[0], p[1]);
  });
});
t('十二支皆有冲，无遗漏', function () {
  '子丑寅卯辰巳午未申酉戌亥'.split('').forEach(function (z) {
    assert.ok(YQ.chongOf(z), z + ' 无冲');
  });
});

console.log('== 河图数 ==');
t('甲乙3·8 丙丁7·2 戊己5·10 庚辛9·4 壬癸1·6', function () {
  var exp = { '甲': 3, '乙': 8, '丙': 7, '丁': 2, '戊': 5, '己': 10, '庚': 9, '辛': 4, '壬': 1, '癸': 6 };
  Object.keys(exp).forEach(function (g) { assert.strictEqual(YQ.heTuOf(g), exp[g], g); });
});

console.log('== 用户实测错误场景：午未空亡 ==');
t('午未空亡 → 填实必为午日/未日，冲实必为子日/丑日', function () {
  var fake = { kongWangZhi: ['午', '未'], kongWangGong: ['9', '2'], tianPan: {}, diPan: {}, siZhu: {} };
  var r = YQ.analyze(fake);
  assert.deepStrictEqual(r.kongWang.tianShi, ['午日', '未日']);
  assert.deepStrictEqual(r.kongWang.chongShi, ['子日', '丑日']);
});
t('午未空亡的输出中不得出现「戊己日」或「辰巳日」（实测误答）', function () {
  var fake = { kongWangZhi: ['午', '未'], kongWangGong: ['9', '2'], tianPan: {}, diPan: {}, siZhu: {} };
  var txt = YQ.toPromptBlock(fake, {});
  // 只查"填实/冲实"的取值行；"注意"告诫行本身含「如戊己日」字样，属有意提示，须排除
  var valueLines = txt.split('\n').filter(function (l) {
    return /填实之日|冲实之日/.test(l) && !/注意/.test(l);
  }).join('\n');
  assert.ok(/午日/.test(valueLines) && /未日/.test(valueLines), '应含填实 午日/未日');
  assert.ok(/子日/.test(valueLines) && /丑日/.test(valueLines), '应含冲实 子日/丑日');
  assert.ok(!/戊日|己日/.test(valueLines), '空亡应期取值不得出现天干日：' + valueLines);
  assert.ok(!/辰日|巳日/.test(valueLines), '空亡应期取值不得出现无关地支日：' + valueLines);
  // 且告诫行确实存在（明令禁止臆造天干）
  assert.ok(/不得改用天干/.test(txt), '应保留禁止臆造之告诫');
});
t('戌亥空亡 → 填实戌日/亥日，冲实辰日/巳日', function () {
  var fake = { kongWangZhi: ['戌', '亥'], kongWangGong: ['6', '6'], tianPan: {}, diPan: {}, siZhu: {} };
  var r = YQ.analyze(fake);
  assert.deepStrictEqual(r.kongWang.tianShi, ['戌日', '亥日']);
  assert.deepStrictEqual(r.kongWang.chongShi, ['辰日', '巳日']);
});
t('空亡宫重复被去重（引擎会输出 6、6）', function () {
  var fake = { kongWangZhi: ['戌', '亥'], kongWangGong: ['6', '6'], tianPan: {}, diPan: {}, siZhu: {} };
  assert.deepStrictEqual(YQ.analyze(fake).kongWang.gongs, ['6']);
});
t('无空亡时明确标注，不编造', function () {
  var txt = YQ.toPromptBlock({ kongWangZhi: [], kongWangGong: [], tianPan: {}, diPan: {}, siZhu: {} }, {});
  assert.ok(/本盘无空亡/.test(txt));
  assert.ok(!/填实之日/.test(txt), '无空亡不应给填实');
});

console.log('== 真实盘 ==');
var pan = QM.qimen.calculate(new Date('2026-07-14T15:30:00'), { type: '四柱', method: '时家', purpose: '求财' });
t('空亡地支取自引擎 kongWangZhi 且填实/冲实自洽', function () {
  var r = YQ.analyze(pan);
  assert.deepStrictEqual(r.kongWang.zhi, pan.kongWangZhi.filter(function (v, i, a) { return a.indexOf(v) === i; }));
  r.kongWang.zhi.forEach(function (z, i) {
    assert.strictEqual(r.kongWang.tianShi[i], z + '日');
    assert.strictEqual(r.kongWang.chongShi[i], YQ.chongOf(z) + '日');
  });
});
t('驿马取自引擎且应期为寅申巳亥', function () {
  var r = YQ.analyze(pan);
  if (pan.maStar && pan.maStar.zhi) {
    assert.strictEqual(r.maXing.zhi, pan.maStar.zhi);
    assert.ok(/寅、申、巳、亥/.test(r.maXing.period));
  }
});
t('入墓宫给出冲墓之日且与六冲一致', function () {
  var r = YQ.analyze(pan);
  r.ruMu.forEach(function (m) {
    assert.strictEqual(m.chongMu, YQ.chongOf(m.muZhi) + '日', m.gong + '宫冲墓');
  });
});
t('各宫干→日辰/河图数与盘面一致', function () {
  var r = YQ.analyze(pan);
  for (var i = 1; i <= 9; i++) {
    var g = String(i), c = r.gongGan[g];
    if (pan.tianPan[g]) {
      assert.strictEqual(c.tianDay, pan.tianPan[g] + '日', g + '宫天盘日');
      assert.strictEqual(c.tianNum, YQ.heTuOf(pan.tianPan[g]), g + '宫天盘数');
    }
  }
});
t('用神宫定日被显式列出', function () {
  var txt = YQ.toPromptBlock(pan, { JIU_GONG: QM.JIU_GONG, yongShenGongs: ['3'] });
  assert.ok(/用神宫 3宫/.test(txt), '应含用神宫定日行');
  assert.ok(new RegExp(pan.tianPan['3'] + '日').test(txt), '应含该宫天盘干之日');
});
t('文本块含禁止臆造之明令', function () {
  var txt = YQ.toPromptBlock(pan, { JIU_GONG: QM.JIU_GONG });
  assert.ok(/禁止自行臆造/.test(txt));
  assert.ok(/不得改用天干/.test(txt));
  assert.ok(/地支六冲/.test(txt));
});
t('坏数据不抛异常', function () {
  assert.strictEqual(YQ.toPromptBlock(null, {}), '');
});

console.log('== 跨盘稳健性：填实/冲实恒为地支日 ==');
t('多个日期下空亡应期均为合法地支日', function () {
  var ZHI = '子丑寅卯辰巳午未申酉戌亥';
  ['2026-01-05T08:00:00', '2026-03-18T13:00:00', '2026-06-30T22:00:00', '2026-09-09T05:00:00', '2026-12-01T16:00:00']
    .forEach(function (iso) {
      var p = QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合' });
      var r = YQ.analyze(p);
      r.kongWang.tianShi.concat(r.kongWang.chongShi).forEach(function (d) {
        assert.ok(ZHI.indexOf(d.charAt(0)) >= 0, iso + ' 出现非地支应期：' + d);
        assert.strictEqual(d.length, 2, iso + ' 应期格式异常：' + d);
      });
    });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
