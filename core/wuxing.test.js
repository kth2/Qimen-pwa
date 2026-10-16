/**
 * 五行推理(WuXing) core 单元测试（纯 Node，无框架）。
 * 运行：node core/wuxing.test.js
 *
 * 守住四件事：
 *   ① 与冻结规格《五行推理断法 v1》逐条一致（影子跟踪所用实现同一断语，471 盘已对拍）；
 *   ② 转盘专用：飞盘不出断语（零串味）；
 *   ③ 不重算旺衰：缺 wangshuai 即停用；
 *   ④ 进证据包：提示词里有【五行推理 v1】一段，怕发生之事另加换算一句。
 */
'use strict';
var path = require('path');
var assert = require('assert');
global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var WX = require('./wuxing.js');
var WS = require('./wangshuai.js');
var EV = require('./evidence.js');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function cast(y, m, d, h, mi) { return QM.qimen.calculate(new Date(y, m - 1, d, h, mi), { type: '四柱', method: '时家', purpose: '综合' }); }
function run(ch, domain) { return WX.analyze({ chart: ch, wangshuai: WS.analyze(ch), domain: domain }); }

console.log('== 冻结规格 v1 ==');
t('借钱一盘（2026-10-06 01:14，求财）：生门艮八土克日干坎一水，宫内天柱金通关 → +1 如愿', function () {
  var r = run(cast(2026, 10, 6, 1, 14), 'wealth');
  assert.ok(r.applicable);
  assert.strictEqual(r.R, '1'); assert.strictEqual(r.Y, '8'); assert.strictEqual(r.yName, '生门');
  assert.strictEqual(r.relation, '事克我');
  assert.strictEqual(r.score, 1); assert.strictEqual(r.verdict, '如愿');
  assert.ok(/通关/.test(r.why));
});
t('得分与断语一一对应：>0 如愿，<0 不如愿，0 不定；分值只在 {-2,-1,0,1}', function () {
  var d0 = new Date(2025, 0, 1, 9, 0).getTime(), seen = {};
  for (var i = 0; i < 300; i++) {
    var ch = QM.qimen.calculate(new Date(d0 + i * 37 * 3600 * 1000), { type: '四柱', method: '时家', purpose: '综合' });
    ['wealth', 'career', 'general', 'relationship', 'study'].forEach(function (dm) {
      var r = run(ch, dm); if (!r.applicable) return;
      assert.ok([-2, -1, 0, 1].indexOf(r.score) >= 0, '分值越界 ' + r.score);
      assert.strictEqual(r.verdict, r.score > 0 ? '如愿' : r.score < 0 ? '不如愿' : '不定');
      seen[r.relation] = 1;
    });
  }
  ['比和', '事生我', '我克事', '事克我', '我生事'].forEach(function (k) { assert.ok(seen[k], '样本未覆盖关系 ' + k); });
});
t('用神取法照规格：求财取生门、事业取开门、学业取景门、感情取六合、其余取时干', function () {
  var ch = cast(2026, 10, 6, 1, 14);
  assert.strictEqual(run(ch, 'wealth').yName, '生门');
  assert.strictEqual(run(ch, 'career').yName, '开门');
  assert.strictEqual(run(ch, 'study').yName, '景门');
  assert.strictEqual(run(ch, 'relationship').yName, '六合');
  assert.strictEqual(run(ch, 'lost_item').yName, '时干');
});
t('同盘同占类两次调用完全一致', function () {
  var ch = cast(2026, 9, 14, 14, 35);
  assert.deepStrictEqual(run(ch, 'fengshui'), run(ch, 'fengshui'));
});

console.log('== 边界 ==');
t('飞盘不出断语（零串味）', function () {
  var ch = Object.assign({}, cast(2026, 10, 6, 1, 14), { renPanMen: { '1': '休门' } });
  var r = WX.analyze({ chart: ch, wangshuai: WS.analyze(cast(2026, 10, 6, 1, 14)), domain: 'wealth' });
  assert.strictEqual(r.applicable, false);
  assert.ok(/飞盘/.test(r.reason));
});
t('缺 wangshuai 即停用，不自行重算旺衰', function () {
  var r = WX.analyze({ chart: cast(2026, 10, 6, 1, 14), domain: 'wealth' });
  assert.strictEqual(r.applicable, false);
});

console.log('== 进证据包 ==');
t('提示词带【五行推理 v1】一段与用法', function () {
  var ch = cast(2026, 10, 6, 1, 14);
  var ev = EV.build({ question: '向舅妈借钱会不会借', domain: 'wealth', chart: ch, wuxing: run(ch, 'wealth') });
  var txt = EV.toPromptBlock(ev);
  assert.ok(/【五行推理 v1】本盘断：\*\*如愿\*\*/.test(txt), '缺五行断语');
  assert.ok(/用户所定·2026-10-16/.test(txt));
  assert.strictEqual(ev.meta ? ev.meta.wuxing.verdict : ev.wuxing.verdict, '如愿');
});
t('怕发生之事：另加「如愿即所怕之事不发生」', function () {
  var ch = cast(2026, 10, 6, 1, 14);
  var ev = EV.build({ question: '会不会被罚款', domain: 'wealth', chart: ch, wuxing: run(ch, 'wealth'),
    framing: { version: '1', direction: 'adverse', event: '被罚款', phrase: '会不会被' } });
  assert.ok(/如愿」即所怕之事\*\*不发生\*\*/.test(EV.toPromptBlock(ev)));
});
t('不适用（飞盘）时证据包不带五行段', function () {
  var ch = cast(2026, 10, 6, 1, 14);
  var ev = EV.build({ question: 'x', domain: 'wealth', chart: ch, wuxing: { version: '1.0.0', applicable: false } });
  assert.ok(!/五行推理 v1/.test(EV.toPromptBlock(ev)));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
