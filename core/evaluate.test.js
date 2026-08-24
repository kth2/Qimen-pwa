/**
 * 案例本评估器(Evaluate) 单元测试（纯 Node，无框架）。
 * 本层的第一要务不是算得多，而是**不算它算不了的**——分母不存在时硬凑一个数出来，
 * 比不报更有害。故测试重点在：小样本不给率、算不了的须列出缘由、口径与 casebook 一致。
 */
'use strict';
var path = require('path'), assert = require('assert');
global.window = global;
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM || global.QM;
var EV = require('./evaluate.js');
var CB = require('./casebook.js');
var XY = require('./xiangyi.js');
var WS = require('./wangshuai.js');
XY.load(require('../knowledge/domain-rules.json'));

var pass = 0, fail = 0;
function t(n, f) { try { f(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '  ->  ' + e.message); } }

var CHART = QM.qimen.calculate(new Date('2024-04-10T10:00:00'), { type: '四柱', method: '时家', purpose: '财运' });
var XYR = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WS.analyze(CHART) });
function mk(i, outcome, extra) {
  var rec = CB.makeCase(Object.assign({
    id: 'e' + i, now: '2024-04-1' + (i % 10) + 'T00:00:00Z',
    question: '第' + i + '问', domain: 'wealth', chart: CHART, xiangyi: XYR, answer: '（全文）'
  }, (extra && extra.make) || {}));
  if (outcome) rec = CB.applyFeedback(rec, Object.assign({ outcome: outcome, now: '2024-05-01T00:00:00Z' }, (extra && extra.fb) || {}));
  return rec;
}

console.log('== 规模、覆盖率与指纹 ==');

t('空案例本不抛错，报告里如实说空并给出下一步', function () {
  var r = EV.evaluate([]);
  assert.ok(r.notes.join('').indexOf('为空') >= 0);
  var txt = EV.toReport(r);           // 从前此处会抛错——坏数据不得阻断
  assert.ok(/案例本为空，无从评估/.test(txt));
  assert.ok(/存为案例/.test(txt), '空报告须告诉用户下一步做什么');
});

t('修订集记录不计入案例数', function () {
  var r = EV.evaluate([mk(1, 'happened'), { id: '__revisions__', schema: 'revisions', list: [] }]);
  assert.strictEqual(r.n.cases, 1);
});

t('指纹含案例数、回填数与日期跨度，便于两次评估对得上', function () {
  var r = EV.evaluate([mk(1, 'happened'), mk(2)]);
  assert.ok(/2例\/1回填\//.test(r.fingerprint), r.fingerprint);
});

t('覆盖率如实反映各项填写比例', function () {
  var recs = [mk(1, 'happened', { fb: { happenedAt: '2024-05-01' } }), mk(2, 'partial'), mk(3)];
  var r = EV.evaluate(recs);
  assert.strictEqual(r.n.graded, 2);
  assert.strictEqual(r.coverage.withDate, 50, '两例回填中一例填了日期');
  assert.strictEqual(r.coverage.withAnswer, 100);
});

console.log('== 小样本一律不给率 ==');

t('占类样本不足门槛时不给百分比，只说样本不足', function () {
  var recs = [];
  for (var i = 0; i < 3; i++) recs.push(mk(i, 'happened'));
  var d = EV.evaluate(recs).byDomain[0];
  assert.strictEqual(d.enough, false);
  assert.strictEqual(d.exactRate, null, '样本不足不得给率');
  assert.ok(/样本不足 3\/8/.test(d.display));
  assert.ok(/会被当成精度/.test(d.display), '须说明为何不给');
});

t('达到门槛后才给率，且算得对', function () {
  var recs = [];
  for (var i = 0; i < 10; i++) recs.push(mk(i, i < 4 ? 'happened' : 'not_happened'));
  var d = EV.evaluate(recs).byDomain[0];
  assert.strictEqual(d.enough, true);
  assert.strictEqual(d.exactRate, 40);
  assert.strictEqual(d.failRate, 60);
});

t('规则样本分布如实呈现，且门槛与 casebook 同一口径', function () {
  var recs = [];
  for (var i = 0; i < 9; i++) recs.push(mk(i, 'happened'));
  var r = EV.evaluate(recs);
  assert.strictEqual(r.rules.minSamples, CB.calibrate(recs).minSamples, '门槛须与 casebook 一致，不另立一套');
  var h = r.rules.sampleHistogram;
  assert.strictEqual(h['1'] + h['2-3'] + h['4-7'] + h['8+'], r.rules.total);
});

console.log('== 结果分布与加权分 ==');

t('四档计数与比率自洽', function () {
  var recs = [mk(1, 'happened'), mk(2, 'happened'), mk(3, 'partial'), mk(4, 'not_happened'), mk(5, 'opposite')];
  var o = EV.evaluate(recs).outcomes;
  assert.strictEqual(o.counts.happened, 2);
  assert.strictEqual(o.exactRate, 40);
  assert.strictEqual(o.failRate, 40, '未应验+结果相反');
  assert.strictEqual(o.oppositeRate, 20);
  assert.strictEqual(o.weightedScore, 0.5, '(1+1+0.5+0+0)/5');
});

t('加权分沿用 casebook.caseScore：已拆问者按逐问平均', function () {
  var rec = CB.makeCase({ id: 'p', domain: 'wealth', chart: CHART, xiangyi: XYR,
    question: '问：1.甲？\n2.乙？\n3.丙？\n4.丁？' });
  rec.parts = Object.assign({}, rec.parts, { confirmed: true });
  rec = CB.applyFeedback(rec, { outcome: 'partial', now: '2024-05-01T00:00:00Z',
    partOutcomes: { 0: 'happened', 1: 'happened', 2: 'happened', 3: 'not_happened' } });
  var r = EV.evaluate([rec]);
  assert.strictEqual(r.outcomes.weightedScore, 0.75, '实得 ' + r.outcomes.weightedScore);
  assert.strictEqual(r.outcomes.weightedFromParts, 1);
});

console.log('== 未支撑断言与可核验性 ==');

t('「挂不上证据的断错」单独计数，且说明它不等于全部断言的未支撑率', function () {
  var recs = [mk(1, 'not_happened', { fb: { misreads: [
    { claim: 'A', actual: 'a', basedOn: '' }, { claim: 'B', actual: 'b', basedOn: XYR.readings[0].id }] } })];
  var c = EV.evaluate(recs).claims;
  assert.strictEqual(c.misreadTotal, 2);
  assert.strictEqual(c.untraceable, 1);
  assert.strictEqual(c.untraceableRate, 50);
  assert.ok(/不等于/.test(c._note), '须说清这不是全部断言的未支撑率');
});

t('实况过短者单独计数——那类反馈撑不起逐条核验', function () {
  var recs = [mk(1, 'happened', { fb: { actual: '中了' } }),
              mk(2, 'happened', { fb: { actual: '这一段实际情况写得很长很长很长很长很长很长' } })];
  var v = EV.evaluate(recs).verifiability;
  assert.strictEqual(v.tooShort, 1);
  assert.strictEqual(v.threshold, EV.SHORT_ACTUAL);
  assert.ok(/不足以核验/.test(v._note));
});

console.log('== 算不了的，必须列出来并说明缘由 ==');

t('notMeasured 至少覆盖四类，且条条有缘由', function () {
  var r = EV.evaluate([mk(1, 'happened')]);
  assert.ok(r.notMeasured.length >= 4);
  var names = r.notMeasured.map(function (x) { return x.metric; }).join('|');
  ['逐条断言准确率', '方位', '时辰', '校准'].forEach(function (k) {
    assert.ok(names.indexOf(k) >= 0, '应列出「' + k + '」为算不了：' + names);
  });
  r.notMeasured.forEach(function (x) {
    assert.ok(x.why && x.why.length >= 15, x.metric + ' 缺缘由');
  });
});

t('逐条断言准确率的缘由须点明「分母不存在」', function () {
  var x = EV.evaluate([mk(1, 'happened')]).notMeasured
    .filter(function (y) { return /逐条断言/.test(y.metric); })[0];
  assert.ok(/分母/.test(x.why), '须点明分母不存在，而不是含糊带过');
});

t('报告文本把「算不了」的一节印出来，不让人误以为测过了', function () {
  var txt = EV.toReport(EV.evaluate([mk(1, 'happened')]));
  assert.ok(/算不了/.test(txt));
  assert.ok(/免得被人当成没测或测过了/.test(txt));
});

console.log('== 档位校准（新案例才有） ==');

t('无档位数据时不产出校准行，并如实说尚无数据', function () {
  var r = EV.evaluate([mk(1, 'happened')]);
  assert.strictEqual(r.calibration.total, 0);
  var x = r.notMeasured.filter(function (y) { return /校准/.test(y.metric); })[0];
  assert.ok(/尚无数据|开始累积/.test(x.why));
});

t('有档位 + 逐维度标注时，按档位分组算符合率并受样本门槛约束', function () {
  var recs = [];
  for (var i = 0; i < 10; i++) {
    var rec = CB.makeCase({ id: 'c' + i, domain: 'wealth', chart: CHART, xiangyi: XYR, question: 'q',
      converge: { version: '1.0.0', applicable: true,
        dimensions: [{ dim: '方位', contested: false, candidates: [{ value: '正南', tier: 'A', independent: 3 }] }],
        abstained: [] } });
    assert.ok(rec.converge, '案例须存下合流档位');
    recs.push(CB.applyFeedback(rec, { outcome: 'happened', now: '2024-05-01T00:00:00Z',
      dimVerdicts: { '方位': i < 8 ? 'happened' : 'not_happened' } }));
  }
  var r = EV.evaluate(recs);
  var a = r.calibration.rows.filter(function (x) { return x.tier === 'A'; })[0];
  assert.ok(a, '应有 A 级一行');
  assert.strictEqual(a.n, 10);
  assert.strictEqual(a.rate, 0.8, '8/10 应验，实得 ' + a.rate);
  assert.ok(/A 级的符合率应明显高于/.test(r.calibration._note), '须说明这一项该怎么读');
});

t('弃权的维度不进档位校准（本就没给结论，无从算准不准）', function () {
  var rec = CB.makeCase({ id: 'ab', domain: 'wealth', chart: CHART, xiangyi: XYR, question: 'q',
    converge: { version: '1.0.0', applicable: true,
      dimensions: [{ dim: '方位', contested: false, candidates: [{ value: '正南', tier: 'C', independent: 1 }] }],
      abstained: ['方位'] } });
  assert.deepStrictEqual(rec.converge.abstained, ['方位']);
  var r = EV.evaluate([CB.applyFeedback(rec, { outcome: 'happened', now: '2024-05-01T00:00:00Z' })]);
  assert.strictEqual(r.calibration.total, 0, '未标注则不计入');
});

console.log('== 确定性与序列化 ==');

t('同一批数据两次评估结果逐字相同（生成时刻除外）', function () {
  var recs = [mk(1, 'happened'), mk(2, 'partial')];
  var a = EV.evaluate(recs, { now: 'T' }), b = EV.evaluate(recs, { now: 'T' });
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.strictEqual(EV.toReport(a), EV.toReport(b));
});

t('报告可 JSON 序列化，便于存档与前后比对', function () {
  var r = EV.evaluate([mk(1, 'happened')]);
  assert.strictEqual(typeof JSON.parse(JSON.stringify(r)).fingerprint, 'string');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
