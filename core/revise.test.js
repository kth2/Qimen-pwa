/**
 * 复盘正解与规则修订(Revise) core 单元测试（纯 Node，无框架）。
 * 运行：node core/revise.test.js
 *
 * 重点守住五件事：
 *   ① 只能收窄，不能新造——从错例反推出全新规则是最容易滑向事后诸葛亮的地方；
 *   ② 正解必须留「按纲要断不出」这个出口，且必须指向已有条目；
 *   ③ 应验案例能拦下过激的修订（8 例应验不该被 2 例未应验推翻）；
 *   ④ 修订独立于纲要层：knowledge/*.json 不被改写，且修订生效时逐条留痕；
 *   ⑤ 不传修订时，规则求值结果与此前逐字一致。
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var RV = require('./revise.js');
var CB = require('./casebook.js');
var XY = require('./xiangyi.js');
var WS = require('./wangshuai.js');
var YS = require('./yongshen.js');
var EV = require('./evidence.js');
var RULES = require('../knowledge/domain-rules.json');

XY.load(RULES);
YS.load(require('../knowledge/domains.json'));
EV.load(require('../knowledge/symbols.json'));

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

var CHART = QM.qimen.calculate(new Date('2024-04-10T10:00:00'), { type: '四柱', method: '时家', purpose: '财运' });
var WSR = WS.analyze(CHART);
var BASE = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR });
var RID = BASE.readings[0].id;

function mkCase(id, outcome, ruleId, verdict) {
  var r = {
    id: id, question: 'q' + id, domain: 'wealth', answer: '当时断：财源有力，本月可期。',
    fired: { rules: [{ id: ruleId, label: 'L', concept: 'C', polarity: '+' }], symbols: [], anchors: [] }
  };
  var fb = { outcome: outcome, now: '2024-05-01' };
  if (verdict) { fb.ruleVerdicts = {}; fb.ruleVerdicts[ruleId] = verdict; }
  return CB.applyFeedback(r, fb);
}
function fails(n, ruleId) {
  var out = []; for (var i = 0; i < n; i++) out.push(mkCase('f' + i, 'not_happened', ruleId));
  return out;
}

console.log('== 硬约束：只能收窄，不能新造 ==');
t('允许的操作只有 narrow/reweight/mute，没有 add/create', function () {
  assert.deepStrictEqual(RV.OP_KEYS.slice().sort(), ['mute', 'narrow', 'reweight']);
  Object.keys(RV.OPS).forEach(function (k) {
    assert.ok(!/add|create|new|新增|新造/.test(k), '不得出现新造类操作：' + k);
  });
});
t('模型若提出新造规则，解析时一律丢弃', function () {
  var r = RV.parseBias(JSON.stringify({
    revisions: [
      { ruleId: RID, op: 'add', payload: {}, reasoning: '我觉得该加一条新规则' },
      { ruleId: RID, op: 'create', reasoning: '同上' }
    ]
  }), [RID]);
  assert.strictEqual(r.revisions.length, 0, '新造类 op 必须被拒');
  assert.strictEqual(r.dropped.length, 2);
});
t('提示词明令禁止新造并说明理由', function () {
  var p = RV.biasPrompt([{ ruleId: RID, label: 'L', concept: 'C', polarity: '+', failN: 5, marked: 0, misreads: [] }], '求财');
  assert.ok(/不得新造规则/.test(p));
  assert.ok(/事后圆回来/.test(p), '须说明为何禁止——否则模型不知轻重');
  assert.ok(/收窄与降权只会让应用「少说」/.test(p));
});
t('narrow 的条件键受白名单约束，模型自造的 DSL 键被丢弃', function () {
  var r = RV.parseBias(JSON.stringify({
    revisions: [{ ruleId: RID, op: 'narrow', payload: { when: { state: ['囚'], 自造键: 'x' } }, reasoning: '坤宫土重，生门虽旺而气不得出' }]
  }), [RID]);
  assert.strictEqual(r.revisions.length, 1);
  assert.deepStrictEqual(Object.keys(r.revisions[0].payload.when), ['state'], '未知条件键须剔除');
});
t('权重调整幅度受限，不许把 ★5 压成 ★1', function () {
  var r = RV.parseBias(JSON.stringify({
    revisions: [{ ruleId: RID, op: 'reweight', payload: { delta: -99 }, reasoning: '此条在休囚之月常不应，宜降其详略' }]
  }), [RID]);
  assert.strictEqual(r.revisions[0].payload.delta, -RV.MAX_WEIGHT_DELTA);
});
t('缺易理依据或只给废话的修订一律丢弃', function () {
  var r = RV.parseBias(JSON.stringify({
    revisions: [{ ruleId: RID, op: 'mute', payload: {}, reasoning: '' },
      { ruleId: RID, op: 'mute', payload: {}, reasoning: '不准' }]
  }), [RID]);
  assert.strictEqual(r.revisions.length, 0);
  assert.ok(r.dropped.every(function (d) { return /缺易理依据/.test(d.why); }));
  // 门槛须容得下真实的中文易理陈述——定太高会把真依据误判为缺依据
  var ok = RV.parseBias(JSON.stringify({
    revisions: [{ ruleId: RID, op: 'mute', payload: {}, reasoning: '土重埋金之故' }]
  }), [RID]);
  assert.strictEqual(ok.revisions.length, 1, '六字的易理陈述应当被接受');
});
t('规则库中不存在的 ruleId 被丢弃', function () {
  var r = RV.parseBias(JSON.stringify({
    revisions: [{ ruleId: '我编的.规则', op: 'mute', reasoning: '理由充分得很' }]
  }), [RID]);
  assert.strictEqual(r.revisions.length, 0);
  assert.ok(/规则库中无此条/.test(r.dropped[0].why));
});
t('op=none 记为「规则没错、是解读用错了」，不进修订', function () {
  var r = RV.parseBias(JSON.stringify({
    revisions: [{ ruleId: RID, op: 'none', reasoning: '此条无误，是解读把倾向说成了必然' }]
  }), [RID]);
  assert.strictEqual(r.revisions.length, 0);
  assert.strictEqual(r.notes.length, 1, '该转去改解读纪律，而非改规则');
});

console.log('== 正解：必须能指到已有条目，且允许说「断不出」 ==');
var REC = CB.makeCase({
  id: 'c1', domain: 'wealth', chart: CHART,
  yongshen: YS.resolve({ domain: 'wealth', chart: CHART }), xiangyi: BASE,
  evidence: EV.build({ domain: 'wealth', chart: CHART, yongshen: YS.resolve({ domain: 'wealth', chart: CHART }), xiangyi: BASE }),
  answer: '结论：本月财运可期，生门得令。'
});
t('提示词含防事后圆说的三条约束', function () {
  var p = RV.correctionPrompt(REC, '一分未进');
  assert.ok(/只能建立在上面已列出的条目之上/.test(p));
  assert.ok(/not_derivable/.test(p) && /强行圆出一套说法比承认断不出更有害/.test(p));
  assert.ok(/而不是对实际结果的复述/.test(p), '须防止把实况复述一遍当正解');
});
t('解析正解：itemId 须为本案真实条目', function () {
  var id = REC.fired.rules[0].id;
  var r = RV.parseCorrection(JSON.stringify({
    verdict: 'derivable', correction: '当时应断为……',
    misweighted: [{ itemId: id, how: 'overrated', why: '生门虽旺然入墓，力不能出' },
      { itemId: '编造.条目', how: 'missed', why: 'x' }]
  }), REC);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.misweighted.length, 1);
  assert.ok(/本案无此条目/.test(r.dropped[0].why));
});
t('how 非法者丢弃', function () {
  var r = RV.parseCorrection(JSON.stringify({
    verdict: 'derivable', correction: 'x',
    misweighted: [{ itemId: REC.fired.rules[0].id, how: '瞎写', why: 'y' }]
  }), REC);
  assert.strictEqual(r.misweighted.length, 0);
});
t('verdict=not_derivable 时保留原因，且不强求正解文字', function () {
  var r = RV.parseCorrection(JSON.stringify({
    verdict: 'not_derivable', correction: '', whyNotDerivable: '纲要未涉及此类事，盘上亦无相应之象'
  }), REC);
  assert.strictEqual(r.ok, true);
  assert.ok(/纲要未涉及/.test(r.whyNotDerivable));
});
t('verdict 非法或坏 JSON 时如实失败，不抛异常', function () {
  assert.strictEqual(RV.parseCorrection(JSON.stringify({ verdict: '乱写' }), REC).ok, false);
  ['', '非 JSON', '{坏'].forEach(function (bad) {
    var r = RV.parseCorrection(bad, REC);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.misweighted, []);
  });
});

console.log('== 应验案例作反证 ==');
t('无冲突时建议采纳', function () {
  var c = RV.review([{ ruleId: RID, op: 'mute', payload: {}, reasoning: 'r' }], fails(6, RID))[0];
  assert.strictEqual(c.check.conflictN, 0);
  assert.strictEqual(c.recommend, 'accept');
});
t('有已应验案例时拦下停用/收窄——8 例应验不该被 6 例未应验推翻', function () {
  var recs = fails(6, RID);
  for (var i = 0; i < 8; i++) recs.push(mkCase('h' + i, 'happened', RID));
  var c = RV.review([{ ruleId: RID, op: 'mute', payload: {}, reasoning: 'r' }], recs)[0];
  assert.strictEqual(c.check.blocked, true);
  assert.strictEqual(c.recommend, 'reject');
  assert.ok(/已应验/.test(c.check.reason) && /会连带损害那些断对的情形/.test(c.check.reason));
});
t('reweight 只改详略，不因应验案例被拦，但如实报出冲突数', function () {
  var recs = fails(6, RID);
  for (var i = 0; i < 8; i++) recs.push(mkCase('h' + i, 'happened', RID));
  var c = RV.conflictCheck({ ruleId: RID, op: 'reweight', payload: { delta: -1 } }, recs);
  assert.strictEqual(c.blocked, false);
  assert.strictEqual(c.conflictN, 8, '不拦下不等于不告知');
});
t('逐条标注压过整案：整案失败但该条被标为相符，则算冲突而非支撑', function () {
  var recs = [];
  for (var i = 0; i < 6; i++) recs.push(mkCase('d' + i, 'not_happened', RID, 'happened'));
  var c = RV.conflictCheck({ ruleId: RID, op: 'mute', payload: {} }, recs);
  assert.strictEqual(c.supportN, 0);
  assert.strictEqual(c.conflictN, 6);
  assert.strictEqual(c.blocked, true, '该条其实没错，不该被改');
});
t('支撑不足时不建议动规则', function () {
  var c = RV.review([{ ruleId: RID, op: 'mute', payload: {}, reasoning: 'r' }], fails(2, RID))[0];
  assert.strictEqual(c.recommend, 'hold');
  assert.ok(/尚不足以动规则/.test(c.recommendWhy));
});
t('failureDigest 只收够格者，且逐条标注计数分开', function () {
  var few = RV.failureDigest(fails(3, RID));
  assert.strictEqual(few.length, 0, '不足 4 次不进反推——那是噪音不是偏差');
  var enough = RV.failureDigest(fails(5, RID));
  assert.strictEqual(enough.length, 1);
  assert.strictEqual(enough[0].failN, 5);
  assert.strictEqual(enough[0].marked, 0, '整案归因须与逐条标注分开计');
});

console.log('== 修订生效：独立层、可停用、留痕 ==');
t('mute 使该条不再产出，并逐条留痕', function () {
  var idx = RV.indexRevisions([{ id: 'r1', ruleId: RID, op: 'mute', enabled: true, reasoning: '易理依据若干' }]);
  var out = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR, revisions: idx });
  assert.ok(!out.readings.some(function (r) { return r.id === RID; }));
  assert.strictEqual(out.readings.length, BASE.readings.length - 1);
  var log = out.revisions.applied.filter(function (a) { return a.ruleId === RID; })[0];
  assert.ok(log && log.effect === '已停用' && log.reasoning, '须留痕并带易理依据');
});
t('reweight 调整权重且被 clamp 在 1-5', function () {
  var idx = RV.indexRevisions([{ id: 'r2', ruleId: RID, op: 'reweight', payload: { delta: -2 }, enabled: true, reasoning: 'x' }]);
  var out = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR, revisions: idx });
  var got = out.readings.filter(function (r) { return r.id === RID; })[0];
  var before = BASE.readings.filter(function (r) { return r.id === RID; })[0];
  assert.strictEqual(got.weight, Math.max(1, before.weight - 2));
  assert.strictEqual(got.revised, 'reweight');
});
t('narrow 条件不满足则不产出，满足则照常', function () {
  var no = RV.indexRevisions([{ id: 'r3', ruleId: RID, op: 'narrow', payload: { when: { flags: ['击刑'] } }, enabled: true, reasoning: 'x' }]);
  var a = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR, revisions: no });
  assert.ok(!a.readings.some(function (r) { return r.id === RID; }));
  assert.ok(/未产出/.test(a.revisions.applied[0].effect));
  // 用该条本来就满足的条件收窄 → 应照常产出
  var trig = BASE.readings.filter(function (r) { return r.id === RID; })[0].matched;
  var when = trig.state ? { state: [trig.state] } : { flags: trig.flags };
  var yes = RV.indexRevisions([{ id: 'r4', ruleId: RID, op: 'narrow', payload: { when: when }, enabled: true, reasoning: 'x' }]);
  var b = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR, revisions: yes });
  assert.ok(b.readings.some(function (r) { return r.id === RID; }), '收窄条件满足时应照常产出');
});
t('enabled=false 的修订不生效', function () {
  var idx = RV.indexRevisions([{ id: 'r5', ruleId: RID, op: 'mute', enabled: false, reasoning: 'x' }]);
  assert.strictEqual(idx.count, 0);
  var out = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR, revisions: idx });
  assert.strictEqual(out.readings.length, BASE.readings.length);
});
t('不传修订时，规则求值结果与此前逐字一致', function () {
  assert.strictEqual(
    JSON.stringify(XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR }).readings),
    JSON.stringify(BASE.readings));
});
t('修订集带哈希，确定性变为「同盘 + 同占类 + 同修订集」', function () {
  var a = RV.indexRevisions([{ id: 'x', ruleId: RID, op: 'mute', enabled: true }]);
  var b = RV.indexRevisions([{ id: 'x', ruleId: RID, op: 'mute', enabled: true }]);
  assert.strictEqual(a.hash, b.hash, '同一集须得同一哈希');
  var c = RV.indexRevisions([{ id: 'x', ruleId: RID, op: 'reweight', payload: { delta: -1 }, enabled: true }]);
  assert.notStrictEqual(a.hash, c.hash, '不同集须得不同哈希');
  var out = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR, revisions: a });
  assert.strictEqual(out.revisions.hash, a.hash, '结果须带出所用修订集');
});
t('纲要文件本身不被改写', function () {
  var before = JSON.stringify(require('../knowledge/domain-rules.json'));
  var idx = RV.indexRevisions([{ id: 'z', ruleId: RID, op: 'mute', enabled: true }]);
  XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR, revisions: idx });
  assert.strictEqual(JSON.stringify(require('../knowledge/domain-rules.json')), before,
    '修订必须独立于纲要层——改了它，basis 就成了假话');
});

console.log('== 采纳记录带完整出处 ==');
t('adopt 记下易理依据、支撑案例、冲突案例与来源声明', function () {
  var recs = fails(5, RID);
  var reviewed = RV.review([{ ruleId: RID, op: 'mute', payload: {}, reasoning: '土重埋金，生门虽旺而气不出' }], recs)[0];
  var rec = RV.adopt(reviewed, '2024-06-01T00:00:00Z');
  assert.strictEqual(rec.ruleId, RID);
  assert.ok(rec.reasoning.length > 0);
  assert.strictEqual(rec.supportCases.length, 5);
  assert.deepStrictEqual(rec.conflictCases, []);
  assert.ok(/非《解断方法纲要》/.test(rec.provenance), '须声明这不是纲要说的');
  assert.strictEqual(rec.enabled, true);
});

console.log('\n== 界面说明：把「反推≠生效」和「只改这一层」写在明处 ==');
(function () {
  var fs = require('fs');
  var APP = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  var seg = APP.slice(APP.indexOf("$('caseRevView').innerHTML"), APP.indexOf("$('caseRevView').innerHTML") + 3000);
  t('说明里写明「反推本身不改变任何判读，须再点采纳」', function () {
    assert.ok(/反推本身不改变任何判读/.test(seg), '缺第①条');
    assert.ok(/必须再点候选下面的「采纳」/.test(seg), '未说清还要点采纳');
    assert.ok(/不建议采纳/.test(seg), '未说明不够格的没有采纳按钮');
  });
  t('说明里写明「采纳之后下一次解读真的会变」，并说清怎么撤回', function () {
    assert.ok(/采纳之后，下一次解读是真的会变/.test(seg), '缺第②条');
    assert.ok(/从送给 AI 的证据包里消失/.test(seg), '未说清变在哪里');
    assert.ok(/取消下面的「启用」勾选即刻恢复原样/.test(seg), '未说清如何撤回');
  });
  t('说明里写明「只作用于占类象义判读这一层」，并逐一点名不受影响的层', function () {
    assert.ok(/只作用于「占类象义判读」这一层/.test(seg), '缺第③条');
    ['排盘与格局', '用神取用', '旺衰四害', '应期锚点', '类象取用', '证据合流',
     '伏吟反吟', '八十一格', '时格', '取数'].forEach(function (n) {
      assert.ok(seg.indexOf(n) >= 0, '未点名「' + n + '」');
    });
  });
  t('这三条与代码实情相符：_revIndex 只传进 XiangYi 一处', function () {
    // 说明写得再好，与代码不符就是误导。此处按源码核对：
    // ①「须再点采纳」——deriveBias 只填 _revCandidates，adoptRevision 才落盘
    assert.ok(/_revCandidates = RV\.review\(/.test(APP), '反推应只产候选');
    assert.ok(!/await saveRevisions\(/.test(APP.slice(APP.indexOf('async function deriveBias('),
      APP.indexOf('async function adoptRevision('))), '反推里不得直接落盘');
    assert.ok(/async function adoptRevision\([\s\S]{0,400}?await saveRevisions\(list\)/.test(APP),
      '采纳才落盘');
    // ②③ 修订只喂给 XiangYi
    assert.strictEqual((APP.match(/revisions: _revIndex/g) || []).length, 1,
      '_revIndex 的消费者不止一处，第③条就说错了');
  });
  t('MIN_FAIL_CASES 由代码取值，不在界面里另写死一个数', function () {
    assert.ok(/\$\{RV\.MIN_FAIL_CASES\}/.test(seg),
      '门槛须引 RV.MIN_FAIL_CASES，写死的数会跟代码漂移');
  });
  t('说明里不留 Markdown 星号（这里是 innerHTML，** 会原样显示）', function () {
    var head = APP.slice(APP.indexOf('修订独立于《解断方法纲要》') - 200,
                         APP.indexOf('修订独立于《解断方法纲要》') + 1800);
    assert.ok(!/\*\*/.test(head), '说明里仍有 ** ，界面上会原样显示成星号');
  });
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
