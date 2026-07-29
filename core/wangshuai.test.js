/**
 * 旺衰与四害 core 单元测试（纯 Node，无框架）。
 * 运行：node core/wangshuai.test.js
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

console.log('== 旺相休囚死（五行当令通则）==');
t('春木令：木旺 火相 水休 金囚 土死', function () {
  assert.strictEqual(WS.stateOf('木', '木'), '旺');
  assert.strictEqual(WS.stateOf('火', '木'), '相');
  assert.strictEqual(WS.stateOf('水', '木'), '休');
  assert.strictEqual(WS.stateOf('金', '木'), '囚');
  assert.strictEqual(WS.stateOf('土', '木'), '死');
});
t('夏火令：火旺 土相 木休 水囚 金死', function () {
  assert.strictEqual(WS.stateOf('火', '火'), '旺');
  assert.strictEqual(WS.stateOf('土', '火'), '相');
  assert.strictEqual(WS.stateOf('木', '火'), '休');
  assert.strictEqual(WS.stateOf('水', '火'), '囚');
  assert.strictEqual(WS.stateOf('金', '火'), '死');
});
t('秋金令 / 冬水令 / 四季土令 各自自洽', function () {
  assert.strictEqual(WS.stateOf('水', '金'), '相');
  assert.strictEqual(WS.stateOf('土', '金'), '休');
  assert.strictEqual(WS.stateOf('木', '水'), '相');
  assert.strictEqual(WS.stateOf('金', '土'), '相');
  assert.strictEqual(WS.stateOf('水', '土'), '死');
});
t('每种当令下五行状态互不重复（五态齐全）', function () {
  ['木', '火', '土', '金', '水'].forEach(function (s) {
    var got = ['木', '火', '土', '金', '水'].map(function (e) { return WS.stateOf(e, s); }).sort();
    assert.deepStrictEqual(got, ['休', '囚', '死', '旺', '相'].sort(), '当令' + s);
  });
});

console.log('== 月支定四时 ==');
t('寅卯→春木，巳午→夏火，申酉→秋金，亥子→冬水', function () {
  assert.strictEqual(WS.seasonOf('寅').element, '木');
  assert.strictEqual(WS.seasonOf('午').element, '火');
  assert.strictEqual(WS.seasonOf('酉').element, '金');
  assert.strictEqual(WS.seasonOf('子').element, '水');
});
t('辰未戌丑→四季土', function () {
  ['辰', '未', '戌', '丑'].forEach(function (z) {
    assert.strictEqual(WS.seasonOf(z).element, '土', z);
    assert.strictEqual(WS.seasonOf(z).season, '四季');
  });
});

console.log('== 十干入墓（乙丙戊乾·甲癸坤·丁庚己艮·壬辛巽）==');
t('乙丙戊 落乾六 为入墓', function () {
  ['乙', '丙', '戊'].forEach(function (g) { assert.ok(WS.isRuMu(g, '6'), g); });
});
t('甲癸 落坤二 为入墓', function () {
  ['甲', '癸'].forEach(function (g) { assert.ok(WS.isRuMu(g, '2'), g); });
});
t('丁庚己 落艮八 为入墓', function () {
  ['丁', '庚', '己'].forEach(function (g) { assert.ok(WS.isRuMu(g, '8'), g); });
});
t('壬辛 落巽四 为入墓', function () {
  ['壬', '辛'].forEach(function (g) { assert.ok(WS.isRuMu(g, '4'), g); });
});
t('十干各有且仅有一墓宫（覆盖完整、无遗漏）', function () {
  var all = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  all.forEach(function (g) {
    var hits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].filter(function (p) { return WS.isRuMu(g, p); });
    assert.strictEqual(hits.length, 1, g + ' 墓宫数=' + hits.length);
  });
});
t('落非墓宫不误判', function () {
  assert.ok(!WS.isRuMu('乙', '2'));
  assert.ok(!WS.isRuMu('壬', '6'));
});

console.log('== 六仪击刑 ==');
t('戊→震三、己→坤二、庚→艮八、辛→离九、壬→巽四、癸→巽四', function () {
  assert.ok(WS.isJiXing('戊', '3'));
  assert.ok(WS.isJiXing('己', '2'));
  assert.ok(WS.isJiXing('庚', '8'));
  assert.ok(WS.isJiXing('辛', '9'));
  assert.ok(WS.isJiXing('壬', '4'));
  assert.ok(WS.isJiXing('癸', '4'));
});
t('三奇乙丙丁不参与六仪击刑', function () {
  ['乙', '丙', '丁'].forEach(function (g) {
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(function (p) {
      assert.ok(!WS.isJiXing(g, p), g + p);
    });
  });
});

console.log('== analyze() 对真实盘 ==');
var pan = QM.qimen.calculate(new Date('2026-07-14T15:30:00'), { type: '四柱', method: '时家', purpose: '求财' });
t('识别月令（乙未月 → 四季土令）', function () {
  var r = WS.analyze(pan);
  assert.strictEqual(r.season.zhi, '未');
  assert.strictEqual(r.season.element, '土');
});
t('九宫齐备且每宫含旺衰与四害字段', function () {
  var r = WS.analyze(pan);
  for (var i = 1; i <= 9; i++) {
    var c = r.gongs[String(i)];
    assert.ok(c, '缺' + i + '宫');
    assert.ok(c.gongState, i + '宫无宫旺衰');
    assert.ok(typeof c.power === 'number' && c.power > 0, i + '宫无力量值');
    assert.ok(Array.isArray(c.harms), i + '宫无四害数组');
  }
});
t('空亡宫被标记为四害', function () {
  var r = WS.analyze(pan);
  (pan.kongWangGong || []).forEach(function (g) {
    assert.ok(r.gongs[String(g)].kongWang, g + '宫应为空亡');
    assert.ok(r.gongs[String(g)].harms.indexOf('空亡') >= 0);
  });
});
t('门迫与引擎判定一致', function () {
  var r = WS.analyze(pan);
  for (var i = 1; i <= 9; i++) {
    var eng = !!(pan.jiuGongAnalysis[i] || {}).menPo;
    assert.strictEqual(r.gongs[String(i)].menPo, eng, i + '宫门迫');
  }
});
t('入墓/击刑判定与规则表一致（全盘核对）', function () {
  var r = WS.analyze(pan);
  for (var i = 1; i <= 9; i++) {
    var g = String(i), c = r.gongs[g];
    var expectMu = WS.isRuMu(pan.tianPan[g], g) || WS.isRuMu(pan.diPan[g], g);
    var expectJx = WS.isJiXing(pan.tianPan[g], g) || WS.isJiXing(pan.diPan[g], g);
    assert.strictEqual(c.ruMu, expectMu, g + '宫入墓');
    assert.strictEqual(c.jiXing, expectJx, g + '宫击刑');
  }
});
t('四害叠加时力量相乘递减', function () {
  var r = WS.analyze(pan);
  var withHarm = [], clean = [];
  for (var i = 1; i <= 9; i++) {
    var c = r.gongs[String(i)];
    (c.harms.length ? withHarm : clean).push(c.power);
  }
  if (withHarm.length && clean.length) {
    assert.ok(Math.min.apply(null, withHarm) <= Math.max.apply(null, clean), '有害之宫力量应可低于无害之宫');
  }
});

console.log('== toPromptBlock() ==');
t('生成非空文本块且含关键字段', function () {
  var txt = WS.toPromptBlock(pan, { JIU_GONG: QM.JIU_GONG });
  assert.ok(txt.length > 200, '文本过短');
  assert.ok(txt.indexOf('旺衰与四害') >= 0);
  assert.ok(txt.indexOf('当令') >= 0);
  assert.ok(/[旺相休囚死]/.test(txt), '应含旺衰状态');
  assert.ok(txt.indexOf('用法') >= 0, '应含用法提示');
});
t('坏数据不抛异常（返回空串，不阻断解读）', function () {
  assert.strictEqual(WS.toPromptBlock({}, {}), '');
  assert.strictEqual(WS.toPromptBlock(null, {}), '');
});

console.log('== 多盘稳健性 ==');
t('跨四季多个日期均可分析', function () {
  ['2026-02-10T09:00:00', '2026-05-05T14:00:00', '2026-08-20T21:00:00', '2026-11-11T03:00:00'].forEach(function (iso) {
    var p = QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合' });
    var r = WS.analyze(p);
    assert.ok(r.season && r.season.element, iso);
    assert.strictEqual(Object.keys(r.gongs).length, 9, iso);
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
