/**
 * 案例本与校准(Casebook) + 案例存储(CaseStore) 单元测试（纯 Node，无框架）。
 * 运行：node core/casebook.test.js
 *
 * 重点守住五件事：
 *   ① 经验层绝不改写教义层——反馈再多也不动 knowledge/*.json，规则求值结果不受历史影响；
 *   ② 样本不足时不给符合率（宁可不说，也不给会被当真的假精度）；
 *   ③ 归因如实标注——整案归因是粗的，不得冒充逐条标注；
 *   ④ 不生成「翻转极性」类建议（那等于越过纲要自创断法）；
 *   ⑤ 存储只在本机，导入默认合并不覆盖，且导出可完整回灌。
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var CB = require('./casebook.js');
var CS = require('./casestore.js');
var XY = require('./xiangyi.js');
var TM = require('./timing.js');
var WS = require('./wangshuai.js');
var YQ = require('./yingqi.js');
var EV = require('./evidence.js');
var YS = require('./yongshen.js');

XY.load(require('../knowledge/domain-rules.json'));
TM.load(require('../knowledge/timing-rules.json'));
EV.load(require('../knowledge/symbols.json'));
YS.load(require('../knowledge/domains.json'));

var pass = 0, fail = 0;
function t(name, fn) {
  try {
    var r = fn();
    if (r && typeof r.then === 'function') throw new Error('异步用例请用 ta()');
    pass++; console.log('  ✓ ' + name);
  } catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
var chain = Promise.resolve();
function ta(name, fn) {
  chain = chain.then(function () {
    return Promise.resolve().then(fn).then(function () {
      pass++; console.log('  ✓ ' + name);
    }, function (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); });
  });
}

function chartAt(iso) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '财运' });
}
var CHART = chartAt('2024-04-10T10:00:00');
var WSR = WS.analyze(CHART);
var XYR = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR });
var YQR = YQ.analyze(CHART, { yongShenGongs: XYR.focus.map(function (f) { return f.gong; }) });
var TMR = TM.analyze({ chart: CHART, yingqi: YQR, xiangyi: XYR, wangshuai: WSR, options: { domain: 'wealth' } });

function mkCase(i, outcome, verdicts) {
  var rec = CB.makeCase({
    id: 'c' + i, now: '2024-04-1' + (i % 10) + 'T00:00:00Z',
    question: '第' + i + '问', domain: 'wealth', school: 'zhuanpan',
    chart: CHART, xiangyi: XYR, timing: TMR, answer: '（解读全文）'
  });
  if (outcome) rec = CB.applyFeedback(rec, { outcome: outcome, now: '2024-05-01T00:00:00Z', ruleVerdicts: verdicts });
  return rec;
}

console.log('== 案例记录 ==');
t('makeCase 抽出本次触发的规则与应期锚点', function () {
  var rec = mkCase(1);
  assert.ok(rec.fired.rules.length > 0, '应记下触发的规则');
  assert.ok(rec.fired.anchors.length > 0, '应记下应期锚点');
  rec.fired.rules.forEach(function (r) {
    assert.ok(r.id && ['+', '-', '0'].indexOf(r.polarity) >= 0, '规则须带 id 与极性');
  });
});
t('只存复现盘所需的最小信息，不塞整盘', function () {
  var rec = mkCase(1);
  assert.ok(rec.chartRef.siZhu && rec.chartRef.juShu, '须能凭此复现盘');
  assert.ok(!rec.chart && !rec.jiuGongAnalysis, '不应把整盘存进记录');
  var size = JSON.stringify(rec).length;
  assert.ok(size < JSON.stringify(CHART).length, '记录不应比整盘还大：' + size);
});
t('未反馈时 feedback 为 null，graded 为 false', function () {
  var rec = mkCase(1);
  assert.strictEqual(rec.feedback, null);
  assert.strictEqual(CB.graded(rec), false);
});
t('applyFeedback 不改原记录（纯函数）', function () {
  var rec = mkCase(1);
  var out = CB.applyFeedback(rec, { outcome: 'happened' });
  assert.strictEqual(rec.feedback, null, '原记录不得被就地改写');
  assert.strictEqual(out.feedback.outcome, 'happened');
  assert.strictEqual(out.feedback.label, '完全应验');
});
t('非法反馈档位报错，非法逐条标注被丢弃', function () {
  var rec = mkCase(1);
  assert.throws(function () { CB.applyFeedback(rec, { outcome: '瞎填' }); }, /档位非法/);
  var out = CB.applyFeedback(rec, { outcome: 'partial', ruleVerdicts: { 'a': 'happened', 'b': '乱写' } });
  assert.strictEqual(out.feedback.ruleVerdicts.a, 'happened');
  assert.ok(!('b' in out.feedback.ruleVerdicts), '非法档位不得进入统计');
});

console.log('== 样本量门槛：不给假精度 ==');
t('样本不足时 rate 为 null，且如实显示"样本不足"', function () {
  var recs = [mkCase(1, 'happened'), mkCase(2, 'not_happened')];
  var cal = CB.calibrate(recs);
  assert.ok(cal.rules.length > 0);
  cal.rules.forEach(function (r) {
    assert.strictEqual(r.enough, false);
    assert.strictEqual(r.rate, null, '样本不足不得给出符合率');
    assert.ok(/样本不足 \d+\/\d+/.test(r.display), r.display);
  });
});
t('达到门槛后才给符合率，且算得对', function () {
  var recs = [];
  for (var i = 0; i < 8; i++) recs.push(mkCase(i, i < 4 ? 'happened' : 'not_happened'));
  var cal = CB.calibrate(recs);
  var r = cal.rules[0];
  assert.strictEqual(r.enough, true);
  assert.strictEqual(r.n, 8);
  assert.strictEqual(r.rate, 0.5, '4 应验 + 4 未应验 应为 0.5，实得 ' + r.rate);
  assert.ok(/50%（8 例/.test(r.display), r.display);
});
t('部分应验计 0.5、结果相反另行计数', function () {
  var recs = [];
  for (var i = 0; i < 8; i++) recs.push(mkCase(i, 'partial'));
  assert.strictEqual(CB.calibrate(recs).rules[0].rate, 0.5);
  var opp = [];
  for (var j = 0; j < 8; j++) opp.push(mkCase(j, 'opposite'));
  var r = CB.calibrate(opp).rules[0];
  assert.strictEqual(r.rate, 0, '结果相反不计分');
  assert.strictEqual(r.opposite, 8, '结果相反须单独计数，它比"没应验"更重');
});
t('未反馈的案例不进入统计', function () {
  var recs = [mkCase(1, 'happened'), mkCase(2), mkCase(3)];
  var cal = CB.calibrate(recs);
  assert.strictEqual(cal.totals.cases, 3);
  assert.strictEqual(cal.totals.graded, 1, '只有已反馈的才算数');
});

console.log('== 归因诚实 ==');
t('逐条标注优先于整案归因，并标明 attribution', function () {
  var ruleId = XYR.readings[0].id;
  var recs = [];
  for (var i = 0; i < 8; i++) {
    var v = {}; v[ruleId] = 'happened';
    recs.push(mkCase(i, 'not_happened', v));   // 整案未应验，但该条被单独标为应验
  }
  var cal = CB.calibrate(recs);
  var target = cal.rules.filter(function (r) { return r.ruleId === ruleId; })[0];
  assert.strictEqual(target.attribution, 'rule');
  assert.strictEqual(target.rate, 1, '逐条标注应压过整案结果');
  assert.ok(/逐条标注/.test(target.display));
  var other = cal.rules.filter(function (r) { return r.ruleId !== ruleId && r.caseN > 0; })[0];
  assert.strictEqual(other.attribution, 'case');
  assert.ok(/整案归因/.test(other.display), '整案归因须如实标明其粗糙');
});
t('整案归因占比过高时，给出方法学提醒', function () {
  var recs = [];
  for (var i = 0; i < 12; i++) recs.push(mkCase(i, 'happened'));
  var ps = CB.proposals(CB.calibrate(recs));
  assert.ok(ps.some(function (p) { return p.kind === 'method' && /整案归因/.test(p.detail); }),
    '应提醒用户逐条标注才谈得上可信');
});

console.log('== 建议：只建议、不执行，且不越过纲要 ==');
t('低符合率生成复核建议，且指向改规则库而非靠反馈覆盖', function () {
  var recs = [];
  for (var i = 0; i < 12; i++) recs.push(mkCase(i, 'not_happened'));
  var ps = CB.proposals(CB.calibrate(recs));
  var rev = ps.filter(function (p) { return p.kind === 'review'; });
  assert.ok(rev.length > 0, '应生成复核建议');
  assert.ok(/domain-rules\.json/.test(rev[0].detail), '须引导去改规则库并补出处');
  assert.ok(/不要靠反馈去覆盖/.test(rev[0].detail), '须明说不靠反馈覆盖规则');
});
t('高符合率生成确认建议', function () {
  var recs = [];
  for (var i = 0; i < 12; i++) recs.push(mkCase(i, 'happened'));
  var ps = CB.proposals(CB.calibrate(recs));
  assert.ok(ps.some(function (p) { return p.kind === 'confirm'; }));
});
t('样本低于建议门槛时不生成规则类建议', function () {
  var recs = [];
  for (var i = 0; i < 9; i++) recs.push(mkCase(i, 'not_happened'));   // 够展示(8)但不够建议(12)
  var ps = CB.proposals(CB.calibrate(recs));
  assert.strictEqual(ps.filter(function (p) { return p.ruleId; }).length, 0,
    '9 例不足以驱动任何规则级建议');
});
t('绝不生成"翻转极性"类建议', function () {
  var kinds = {};
  [['not_happened', 12], ['opposite', 12], ['happened', 12], ['partial', 12]].forEach(function (pair) {
    var recs = [];
    for (var i = 0; i < pair[1]; i++) recs.push(mkCase(i, pair[0]));
    CB.proposals(CB.calibrate(recs)).forEach(function (p) {
      kinds[p.kind] = 1;
      assert.ok(!/flip|翻转|反转/.test(p.kind + JSON.stringify(p.suggested || {})),
        '不得建议翻转极性——那等于越过纲要自创断法');
    });
  });
  assert.deepStrictEqual(Object.keys(kinds).sort(), ['confirm', 'method', 'review']);
});

console.log('== 经验层不改教义层（本期最要紧的一条） ==');
t('反馈再多也不改变规则求值结果（同盘同占类仍得同一结果）', function () {
  var before = JSON.stringify(XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR }));
  var recs = [];
  for (var i = 0; i < 30; i++) recs.push(mkCase(i, 'opposite'));
  var cal = CB.calibrate(recs);
  var overlay = CB.buildOverlay(CB.proposals(cal), cal);
  assert.ok(overlay.count >= 0);
  var after = JSON.stringify(XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR }));
  assert.strictEqual(before, after, '经验层一旦影响规则求值，确定性与跨设备可复现就没了');
});
t('overlay 只产出附注，不含权重覆盖或极性改写', function () {
  var recs = [];
  for (var i = 0; i < 20; i++) recs.push(mkCase(i, 'not_happened'));
  var cal = CB.calibrate(recs);
  var overlay = CB.buildOverlay(CB.proposals(cal), cal);
  Object.keys(overlay.notes).forEach(function (id) {
    var n = overlay.notes[id];
    assert.ok(n.note && /本机历史/.test(n.note));
    assert.ok(!('polarity' in n) && !('weight' in n) && !('concept' in n),
      'overlay 不得携带可改写教义的字段');
  });
});
t('样本已不足的规则，即便曾被采纳也不再生效', function () {
  var many = [];
  for (var i = 0; i < 20; i++) many.push(mkCase(i, 'not_happened'));
  var calMany = CB.calibrate(many);
  var accepted = CB.proposals(calMany);
  var few = [mkCase(1, 'not_happened')];       // 案例被删到只剩 1 例
  var overlay = CB.buildOverlay(accepted, CB.calibrate(few));
  assert.strictEqual(overlay.count, 0, '样本塌了就该失效，不能留着一条无据的附注');
});
t('calibrationFor 只回本次真正触发的规则', function () {
  var recs = [];
  for (var i = 0; i < 20; i++) recs.push(mkCase(i, 'not_happened'));
  var cal = CB.calibrate(recs);
  var overlay = CB.buildOverlay(CB.proposals(cal), cal);
  var got = CB.calibrationFor(overlay, XYR);
  var firedIds = XYR.readings.concat(XYR.combinations, XYR.relations).map(function (r) { return r.id; });
  got.forEach(function (g) { assert.ok(firedIds.indexOf(g.ruleId) >= 0, '不该回没触发的规则 ' + g.ruleId); });
  // 换一个占类，本次未触发这些规则，则不应有附注
  var other = XY.analyze({ domain: 'health', chart: CHART, wangshuai: WSR });
  CB.calibrationFor(overlay, other).forEach(function (g) {
    assert.ok(g.ruleId.indexOf('health') === 0, '跨占类不得串用经验：' + g.ruleId);
  });
});

console.log('== 证据包集成：经验与教义严格分列 ==');
t('CALIBRATION 与 READING 分列，来源各自标明', function () {
  var recs = [];
  for (var i = 0; i < 20; i++) recs.push(mkCase(i, 'not_happened'));
  var cal = CB.calibrate(recs);
  var overlay = CB.buildOverlay(CB.proposals(cal), cal);
  var ev = EV.build({
    question: 'q', domain: 'wealth', chart: CHART,
    yongshen: YS.resolve({ domain: 'wealth', chart: CHART }),
    xiangyi: XYR, calibration: CB.calibrationFor(overlay, XYR)
  });
  var cals = ev.items.filter(function (x) { return x.type === 'CALIBRATION'; });
  var reads = ev.items.filter(function (x) { return x.type === 'READING'; });
  assert.ok(cals.length > 0 && reads.length > 0);
  cals.forEach(function (c) { assert.ok(/本机案例记录/.test(c.source), '经验须标明来源非纲要'); });
  reads.forEach(function (r) { assert.strictEqual(r.source, 'knowledge/domain-rules.json'); });
  var txt = EV.toPromptBlock(ev);
  assert.ok(/CALIBRATION（\*\*本机历史反馈统计，不是纲要\*\*/.test(txt), '提示块须明说这不是纲要');
  assert.ok(/不得据此推翻 READING/.test(txt), '须禁止用经验推翻教义');
});
t('不传 calibration 时证据包无 CALIBRATION（Phase 4 行为原样不变）', function () {
  var ev = EV.build({
    question: 'q', domain: 'wealth', chart: CHART,
    yongshen: YS.resolve({ domain: 'wealth', chart: CHART }), xiangyi: XYR
  });
  assert.strictEqual(ev.items.filter(function (x) { return x.type === 'CALIBRATION'; }).length, 0);
  assert.ok(EV.toPromptBlock(ev).indexOf('CALIBRATION') < 0);
});

console.log('== 存储：只在本机、导入不覆盖 ==');
ta('保存/读取/列表/删除', function () {
  var s = CS.create(CS.memoryBackend());
  var a = mkCase(1, 'happened'), b = mkCase(2);
  a.id = 'a1'; a.createdAt = '2024-01-01'; b.id = 'b1'; b.createdAt = '2024-02-01';
  return s.save(a).then(function () { return s.save(b); })
    .then(function () { return s.list(); })
    .then(function (rows) {
      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].id, 'b1', '新的应在前');
      return s.get('a1');
    })
    .then(function (got) {
      assert.strictEqual(got.feedback.outcome, 'happened');
      return s.remove('a1');
    })
    .then(function () { return s.list(); })
    .then(function (rows) { assert.strictEqual(rows.length, 1); });
});
ta('缺 id 拒绝写入', function () {
  var s = CS.create(CS.memoryBackend());
  return s.save({ question: '无 id' }).then(function () {
    throw new Error('本应拒绝');
  }, function (e) { assert.ok(/缺 id/.test(e.message)); });
});
ta('导出可完整回灌（往返不丢数据）', function () {
  var s1 = CS.create(CS.memoryBackend());
  var recs = [mkCase(1, 'happened'), mkCase(2, 'partial'), mkCase(3)];
  recs.forEach(function (r, i) { r.id = 'x' + i; });
  return Promise.all(recs.map(function (r) { return s1.save(r); }))
    .then(function () { return s1.exportAll('2024-06-01'); })
    .then(function (dump) {
      assert.strictEqual(dump.format, 'qimen-casebook');
      assert.strictEqual(dump.count, 3);
      var s2 = CS.create(CS.memoryBackend());
      return s2.importAll(JSON.parse(JSON.stringify(dump))).then(function (r) {
        assert.strictEqual(r.added, 3);
        return s2.list();
      }).then(function (rows) {
        assert.strictEqual(rows.length, 3);
        assert.strictEqual(rows.filter(function (x) { return CB.graded(x); }).length, 2);
      });
    });
});
ta('导入默认合并：同 id 取较新者，旧的不覆盖新的', function () {
  var s = CS.create(CS.memoryBackend());
  var mine = mkCase(1, 'happened'); mine.id = 'same'; mine.createdAt = '2024-03-01';
  mine.feedback.recordedAt = '2024-05-10T00:00:00Z';
  var theirsOld = mkCase(1, 'not_happened'); theirsOld.id = 'same'; theirsOld.createdAt = '2024-03-01';
  theirsOld.feedback.recordedAt = '2024-04-01T00:00:00Z';
  return s.save(mine)
    .then(function () { return s.importAll({ format: 'qimen-casebook', cases: [theirsOld] }); })
    .then(function (r) {
      assert.strictEqual(r.skipped, 1, '较旧的应被跳过');
      return s.get('same');
    })
    .then(function (got) {
      assert.strictEqual(got.feedback.outcome, 'happened', '本机较新的记录不得被旧文件覆盖');
    });
});
ta('导入较新者会更新', function () {
  var s = CS.create(CS.memoryBackend());
  var old = mkCase(1, 'not_happened'); old.id = 'same'; old.feedback.recordedAt = '2024-04-01T00:00:00Z';
  var neu = mkCase(1, 'happened'); neu.id = 'same'; neu.feedback.recordedAt = '2024-06-01T00:00:00Z';
  return s.save(old)
    .then(function () { return s.importAll({ format: 'qimen-casebook', cases: [neu] }); })
    .then(function (r) { assert.strictEqual(r.updated, 1); return s.get('same'); })
    .then(function (got) { assert.strictEqual(got.feedback.outcome, 'happened'); });
});
ta('拒绝非本应用的文件', function () {
  var s = CS.create(CS.memoryBackend());
  return s.importAll({ foo: 1 }).then(function () { throw new Error('本应拒绝'); },
    function (e) { assert.ok(/不是本应用导出/.test(e.message)); });
});
ta('newId 不重复', function () {
  var s = CS.create(CS.memoryBackend());
  var seen = {};
  for (var i = 0; i < 500; i++) {
    var id = s.newId();
    assert.ok(!seen[id], 'id 撞号：' + id);
    seen[id] = 1;
  }
  return Promise.resolve();
});
ta('Node 环境下如实标明未落盘（界面据此告警）', function () {
  var s = CS.create();   // 无 IndexedDB → 退回内存
  assert.strictEqual(s.persistent, false, '未落盘必须如实标明，不能让用户以为存住了');
  assert.strictEqual(s.backendName, 'memory');
  return Promise.resolve();
});
ta('overlay 与已采纳建议可独立存取', function () {
  var s = CS.create(CS.memoryBackend());
  return s.setOverlay({ version: '5.0.0', notes: {}, count: 0 })
    .then(function () { return s.setAccepted([{ ruleId: 'r1', kind: 'review' }]); })
    .then(function () { return Promise.all([s.getOverlay(), s.getAccepted()]); })
    .then(function (r) {
      assert.strictEqual(r[0].version, '5.0.0');
      assert.strictEqual(r[1][0].ruleId, 'r1');
    });
});
ta('案例列表不含任何联网写出口（隐私）', function () {
  var s = CS.create(CS.memoryBackend());
  var api = Object.keys(s).join(',');
  ['upload', 'sync', 'post', 'fetch', 'send', 'share'].forEach(function (bad) {
    assert.ok(api.toLowerCase().indexOf(bad) < 0, '存储层不得有联网出口：' + bad);
  });
  var src = require('fs').readFileSync(path.join(__dirname, 'casestore.js'), 'utf8');
  assert.ok(!/fetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(src),
    '案例含私事，存储层源码中不得出现任何网络调用');
  return Promise.resolve();
});

chain.then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
