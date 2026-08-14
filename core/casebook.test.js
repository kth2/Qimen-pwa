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

console.log('== 实况录入 ==');
t('applyFeedback 收下实况文本与实际日期', function () {
  var rec = CB.applyFeedback(mkCase(1), {
    outcome: 'partial', actual: '5月中旬收到一笔款，但比预期少一半，且是合伙人转来的',
    happenedAt: '2024-05-12', now: '2024-05-20T00:00:00Z'
  });
  assert.strictEqual(rec.feedback.actual.indexOf('合伙人') >= 0, true);
  assert.strictEqual(rec.feedback.happenedAt, '2024-05-12');
});
t('逐条标注带来源标记，便于分辨可信度', function () {
  var id = XYR.readings[0].id, v = {}; v[id] = 'happened';
  var manual = CB.applyFeedback(mkCase(1), { outcome: 'partial', ruleVerdicts: v });
  assert.strictEqual(manual.feedback.verdictSource, 'manual');
  var ai = CB.applyFeedback(mkCase(1), { outcome: 'partial', ruleVerdicts: v, verdictSource: 'ai' });
  assert.strictEqual(ai.feedback.verdictSource, 'ai');
});
t('makeCase 存下判读的可读文字（否则逐条标注无从下手）', function () {
  var rec = mkCase(1);
  rec.fired.rules.forEach(function (r) {
    assert.ok(r.label && r.label.length > 0, r.id + ' 缺可读标签');
    assert.ok(typeof r.concept === 'string', r.id + ' 缺判读文字');
    assert.ok(r.concept.length <= 60, '判读文字须截断，避免撑爆手机存储');
  });
});

console.log('== 盘面象义条目（用户报的 bug：标注清单不是本盘象义） ==');
function fullCase(domain, opts) {
  opts = opts || {};
  var ys = YS.resolve({ domain: domain, chart: CHART, options: opts.school ? { school: opts.school } : {} });
  var xy = XY.analyze({ domain: domain, chart: CHART, wangshuai: WSR, options: opts.school ? { school: opts.school } : {} });
  var ev = EV.build({ domain: domain, chart: CHART, yongshen: ys, xiangyi: xy });
  return CB.makeCase({ id: 'f', domain: domain, chart: CHART, yongshen: ys, xiangyi: xy, evidence: ev });
}
t('规则库未覆盖的占类（综合）仍有象义可标——这正是原 bug', function () {
  var rec = fullCase('general');
  assert.ok(rec.fired.rules.length <= 1, '前提：综合占类规则库近乎空白');
  assert.ok(rec.fired.symbols.length >= 3,
    '综合占类也须给出盘面象义，实得 ' + rec.fired.symbols.length + ' 条——否则标注清单名不副实');
});
t('飞盘（象义层整层停用）同样有象义可标', function () {
  // 真实调用中 app.js 必传 engineYong（引擎自算的用神）；零串味会排除转盘占类取用，
  // 但引擎用神照常保留——象义即由它而来。此处照实模拟该路径。
  var engineYong = { matched: true, category: '求财', note: '引擎取用', located: [{ name: '生门' }, { name: '值符' }] };
  var ys = YS.resolve({ domain: 'wealth', chart: CHART, options: { school: 'feipan', engineYong: engineYong } });
  var xy = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WSR, options: { school: 'feipan' } });
  var ev = EV.build({ domain: 'wealth', chart: CHART, yongshen: ys, xiangyi: xy });
  var rec = CB.makeCase({ id: 'fp', domain: 'wealth', chart: CHART, yongshen: ys, xiangyi: xy, evidence: ev });
  assert.strictEqual(rec.fired.rules.length, 0, '前提：飞盘下规则层停用');
  assert.ok(rec.fired.symbols.length > 0, '飞盘也须给出盘面象义，实得 ' + rec.fired.symbols.length);
  // 零串味：排除掉的转盘占类取用不得混进象义条目
  var excluded = ys.resolution.excluded.map(function (x) { return x.name; });
  rec.fired.symbols.forEach(function (s) {
    assert.ok(excluded.indexOf(s.name) < 0, '飞盘下不得出现被隔离的转盘取用：' + s.name);
  });
});
t('用神清单为空时象义段为空，不编造条目', function () {
  var rec = CB.makeCase({ id: 'e', domain: 'wealth', chart: CHART, yongshen: { examine: [] } });
  assert.deepStrictEqual(rec.fired.symbols, []);
});
t('象义条目确与盘面一致：落宫、同宫元素逐项核对', function () {
  var rec = fullCase('wealth');
  assert.ok(rec.fired.symbols.length > 0);
  rec.fired.symbols.forEach(function (s) {
    assert.ok(/^[1-9]$/.test(s.gong), s.key + ' 落宫非法');
    // 同宫元素必须真在那一宫
    var atG = [CHART.jiuXing[s.gong], CHART.baMen[s.gong], CHART.baShen[s.gong],
      CHART.tianPan[s.gong], CHART.diPan[s.gong], (CHART.anGan || {})[s.gong]];
    s.withEls.forEach(function (w) {
      var bare = w.replace(/^(星|门|神|天盘|地盘|暗干)/, '');
      assert.ok(atG.indexOf(bare) >= 0, s.key + ' 声称同宫有 ' + bare + '，但 ' + s.gong + ' 宫实为 ' + atG.join('/'));
    });
  });
});
t('象义词确出自 symbols.json，且元素象与宫象各留配额', function () {
  var rec = fullCase('wealth');
  var sm = rec.fired.symbols.filter(function (s) { return s.name === '生门'; })[0];
  assert.ok(sm, '求财须含生门');
  var men = EV.getSymbol('bamen', '生门');
  var gong = EV.getSymbol('jiugong', sm.gong);
  var fromMen = sm.words.filter(function (w) { return JSON.stringify(men).indexOf('"' + w + '"') >= 0; });
  var fromGong = sm.words.filter(function (w) { return JSON.stringify(gong).indexOf('"' + w + '"') >= 0; });
  assert.ok(fromMen.length > 0, '须含门之象');
  assert.ok(fromGong.length > 0, '须含宫之象——宫象不得被干/门象整段挤掉（方位类象全靠它）');
  sm.words.forEach(function (w) {
    var inKb = JSON.stringify(men).indexOf('"' + w + '"') >= 0 || JSON.stringify(gong).indexOf('"' + w + '"') >= 0;
    assert.ok(inKb, '象义须出自知识库，不得杜撰：' + w);
  });
});
t('日干为甲时，甲的象义不再漏失（既存 bug 回归）', function () {
  assert.strictEqual(CHART.siZhu.day.charAt(0), '甲', '前提：本测试盘日干为甲');
  var ys = YS.resolve({ domain: 'wealth', chart: CHART });
  var jia = ys.examine.filter(function (m) { return m.name === '日干'; })[0];
  assert.strictEqual(jia.resolved, '甲', 'resolved 须为纯干，否则查 symbols.json 必落空');
  assert.ok(/遁于旬首/.test(jia.via || ''), '「遁于旬首」的说明应由 via 承载');
  var ev = EV.build({ domain: 'wealth', chart: CHART, yongshen: ys });
  var els = ev.items.filter(function (x) { return x.type === 'SYMBOL'; }).map(function (x) { return x.element; });
  assert.ok(els.indexOf('甲') >= 0, '甲日求测人自身的象义必须进证据包');
});
t('象义 key 为「元素@宫」，跨案例可累计', function () {
  var a = fullCase('wealth'), b = fullCase('wealth');
  assert.deepStrictEqual(a.fired.symbols.map(function (s) { return s.key; }),
    b.fired.symbols.map(function (s) { return s.key; }), '同盘同占类须得同一批 key');
  a.fired.symbols.forEach(function (s) {
    assert.ok(/^sym:.+@[1-9]$/.test(s.key), 'key 格式应为 sym:元素@宫，实为 ' + s.key);
  });
});
t('象义标注与规则标注分开统计，互不冒充', function () {
  var recs = [];
  var proto = fullCase('wealth');
  var symKey = proto.fired.symbols[0].key;
  for (var i = 0; i < 8; i++) {
    var r = fullCase('wealth'); r.id = 's' + i;
    var sv = {}; sv[symKey] = 'happened';
    recs.push(CB.applyFeedback(r, { outcome: 'not_happened', symbolVerdicts: sv, now: '2024-05-01' }));
  }
  var cal = CB.calibrate(recs);
  assert.ok(Array.isArray(cal.symbols) && cal.symbols.length > 0, '统计须含象义段');
  var target = cal.symbols.filter(function (s) { return s.key === symKey; })[0];
  assert.strictEqual(target.attribution, 'symbol');
  assert.strictEqual(target.rate, 1, '逐条标注应压过整案结果');
  // 规则段不得被象义标注污染
  cal.rules.forEach(function (r) {
    assert.strictEqual(r.attribution, 'case', '未标注规则者应仍按整案归因，不得挪用象义标注');
  });
});
t('AI 复盘可给象义标注，且编造的 key 一律丢弃', function () {
  var rec = fullCase('wealth');
  var key = rec.fired.symbols[0].key;
  var r = CB.parseReview(JSON.stringify({
    verdicts: {}, symbolVerdicts: { [key]: 'partial', 'sym:伪造@9': 'happened' }
  }), rec);
  assert.strictEqual(r.symbolVerdicts[key], 'partial');
  assert.ok(!('sym:伪造@9' in r.symbolVerdicts));
  assert.ok(r.dropped.some(function (d) { return /本案无此象义条目/.test(d.why); }));
});
t('复盘提示同时列出盘面象义与规则判读', function () {
  var rec = fullCase('general');
  var p = CB.reviewPrompt(rec, '实际发生了某事');
  assert.ok(/盘面象义/.test(p), '提示须含象义段');
  assert.ok(p.indexOf(rec.fired.symbols[0].key) >= 0, '须把象义 key 列出，模型才标得回来');
  assert.ok(/symbolVerdicts/.test(p), '须说明象义标注的字段名');
});

console.log('== 应期反推：完全确定性 ==');
function siZhuOf(iso) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合' }).siZhu;
}
t('给出实际日期即可判定命中了哪条锚点，命中值必与那天干支一致', function () {
  var rec = mkCase(1);
  var sz = siZhuOf('2024-05-12T12:00:00');     // 丙子日
  var d = CB.deriveTimingHits(rec, sz);
  assert.ok(d.hits.length + d.missed.length === rec.fired.anchors.length, '每个锚点非命中即未中');
  d.hits.forEach(function (h) {
    var lv = h.level === '日' ? sz.day : h.level === '月' ? sz.month : sz.year;
    var expect = h.kind === 'gan' ? lv.charAt(0) : lv.charAt(1);
    assert.strictEqual(h.value, expect, h.mechanism + ' 声称命中 ' + h.level + '，但那天是 ' + lv);
  });
});
t('日/月/年三层都比对，并如实标明命中在哪一层', function () {
  var rec = mkCase(1);
  var seen = {};
  ['2024-05-12', '2024-07-03', '2024-11-20', '2025-02-14', '2024-04-18'].forEach(function (day) {
    CB.deriveTimingHits(rec, siZhuOf(day + 'T12:00:00')).hits.forEach(function (h) {
      assert.ok(['日', '月', '年'].indexOf(h.level) >= 0);
      seen[h.level] = 1;
    });
  });
  assert.ok(Object.keys(seen).length >= 1, '样本中应至少命中一层');
});
t('未给日期时不臆断，全部记为未中', function () {
  var rec = mkCase(1);
  var d = CB.deriveTimingHits(rec, null);
  assert.strictEqual(d.hits.length, 0);
  assert.strictEqual(d.missed.length, rec.fired.anchors.length);
  assert.strictEqual(d.chance, null, '无从计算基准时不得编一个数出来');
});
t('随机基准算得出且落在 0-1，候选越多基准越高', function () {
  var rec = mkCase(1);
  var d = CB.deriveTimingHits(rec, siZhuOf('2024-05-12T12:00:00'));
  assert.ok(d.chance > 0 && d.chance <= 1, '基准应为概率：' + d.chance);
  // 人工构造：候选极少 → 基准应明显更低
  var few = JSON.parse(JSON.stringify(rec));
  few.fired.anchors = [{ mechanism: '填实', value: '子', kind: 'zhi', strength: 'high', gong: '1' }];
  var d2 = CB.deriveTimingHits(few, siZhuOf('2024-05-12T12:00:00'));
  assert.ok(d2.chance < d.chance, '候选少则蒙中概率低：' + d2.chance + ' vs ' + d.chance);
});
t('反推结果并入记录时不改原对象', function () {
  var rec = mkCase(1);
  var d = CB.deriveTimingHits(rec, siZhuOf('2024-05-12T12:00:00'));
  var out = CB.applyTimingDerivation(rec, d);
  assert.strictEqual(rec.timingHits, undefined);
  assert.ok(out.timingHits.hits);
});

console.log('== 应期机制命中率：必须连随机基准一起给 ==');
t('按机制统计命中率，每案每机制只计一次', function () {
  var recs = [];
  for (var i = 0; i < 10; i++) {
    var r = mkCase(i, 'happened');
    recs.push(CB.applyTimingDerivation(r, CB.deriveTimingHits(r, siZhuOf('2024-05-1' + (i % 10) + 'T12:00:00'))));
  }
  var tc = CB.timingCalibration(recs);
  assert.strictEqual(tc.cases, 10);
  tc.mechanisms.forEach(function (m) {
    assert.ok(m.n <= 10, m.mechanism + ' 每案每机制只应计一次，实得 n=' + m.n);
    assert.ok(m.hit <= m.n, m.mechanism + ' 命中数不得超过样本数');
  });
});
t('★强锚点单列统计：全量基准逼近 1 时，唯有强子集有信息量', function () {
  var rec = mkCase(1);
  var d = CB.deriveTimingHits(rec, siZhuOf('2024-05-12T12:00:00'));
  assert.ok(d.high && typeof d.high.total === 'number', '须给出强锚点子集');
  assert.ok(d.high.total <= rec.fired.anchors.length);
  assert.ok(d.high.hit <= d.high.total);
  if (d.high.total > 0) {
    assert.ok(d.high.chance <= d.chance + 1e-9,
      '强子集候选更少，基准不应高于全量：' + d.high.chance + ' vs ' + d.chance);
  }
  var recs = [];
  for (var i = 0; i < 10; i++) {
    var r = mkCase(i, 'happened');
    recs.push(CB.applyTimingDerivation(r, CB.deriveTimingHits(r, siZhuOf('2024-0' + (5 + i % 4) + '-1' + (i % 9) + 'T12:00:00'))));
  }
  var tc = CB.timingCalibration(recs);
  assert.ok(tc.high && typeof tc.high.n === 'number', '统计须含强子集');
  assert.ok(tc.high.n <= tc.cases);
  if (tc.high.enough) {
    assert.ok(tc.high.rate >= 0 && tc.high.rate <= 1);
    assert.ok(tc.high.baseline >= 0 && tc.high.baseline <= 1);
  }
});
t('输出必带随机基准与其说明（防止把蒙中当灵验）', function () {
  var recs = [];
  for (var i = 0; i < 10; i++) {
    var r = mkCase(i, 'happened');
    recs.push(CB.applyTimingDerivation(r, CB.deriveTimingHits(r, siZhuOf('2024-06-0' + (i % 10) + 'T12:00:00'))));
  }
  var tc = CB.timingCalibration(recs);
  assert.ok(typeof tc.baseline === 'number' && tc.baseline > 0, '须给出随机基准');
  assert.ok(/随机基准/.test(tc.baselineNote) && /未提供额外信息/.test(tc.baselineNote),
    '须说明命中率与基准相当时并不代表准');
});
t('未反推过的案例不进入应期统计', function () {
  var recs = [mkCase(1, 'happened'), mkCase(2, 'happened')];
  assert.strictEqual(CB.timingCalibration(recs).cases, 0);
});

console.log('== AI 复盘：只做映射，且输出严格校验 ==');
t('复盘提示只让模型标注、不让它改规则或重断', function () {
  var p = CB.reviewPrompt(mkCase(1), '五月中旬收到款，但比预期少');
  assert.ok(/复盘/.test(p) && /不是重新断卦/.test(p));
  assert.ok(/不得新增条目/.test(p) && /不得改写其内容/.test(p) && /不得提出新的断法/.test(p));
  assert.ok(/宁缺勿猜/.test(p), '未涉及的条目须允许省略，不得逼模型硬判');
  assert.ok(p.indexOf(XYR.readings[0].id) >= 0, '须把待判条目连同 id 列出');
});
t('解析：合法输出被接受', function () {
  var rec = mkCase(1);
  var id = rec.fired.rules[0].id;
  var r = CB.parseReview('{"verdicts":{"' + id + '":"partial"},"observations":["提到合伙人"]}', rec);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdicts[id], 'partial');
  assert.strictEqual(r.observations[0], '提到合伙人');
});
t('解析：编造的规则 id 与非法档位一律丢弃', function () {
  var rec = mkCase(1);
  var id = rec.fired.rules[0].id;
  var r = CB.parseReview('{"verdicts":{"' + id + '":"happened","wealth.伪造.规则":"happened","x":"乱写"}}', rec);
  assert.strictEqual(Object.keys(r.verdicts).length, 1, '只应保留本案真正触发过的合法条目');
  assert.strictEqual(r.dropped.length, 2);
  assert.ok(r.dropped.some(function (d) { return /本案未触发/.test(d.why); }));
});
t('解析：容忍代码块包裹与前后废话', function () {
  var rec = mkCase(1);
  var id = rec.fired.rules[0].id;
  var r = CB.parseReview('好的，结果如下：\n```json\n{"verdicts":{"' + id + '":"happened"}}\n```\n希望有帮助', rec);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdicts[id], 'happened');
});
t('解析：坏输出不抛异常，如实返回失败', function () {
  var rec = mkCase(1);
  [null, '', '完全不是 JSON', '{坏的', '[]'].forEach(function (bad) {
    var r = CB.parseReview(bad, rec);
    assert.ok(!r.ok || Object.keys(r.verdicts).length === 0);
    assert.deepStrictEqual(r.observations, []);
  });
});
t('观察最多 3 条且逐条截断（防模型长篇灌入）', function () {
  var rec = mkCase(1);
  var long = new Array(500).join('啊');
  var r = CB.parseReview(JSON.stringify({ verdicts: {}, observations: [long, long, long, long, long] }), rec);
  assert.strictEqual(r.observations.length, 3);
  r.observations.forEach(function (o) { assert.ok(o.length <= 200); });
});
t('AI 复盘的标注进入统计后，仍以「逐条标注」计而非整案归因', function () {
  var recs = [], id = XYR.readings[0].id;
  for (var i = 0; i < 8; i++) {
    var v = {}; v[id] = 'happened';
    recs.push(CB.applyFeedback(mkCase(i), {
      outcome: 'not_happened', ruleVerdicts: v, verdictSource: 'ai', now: '2024-05-01'
    }));
  }
  var cal = CB.calibrate(recs);
  var target = cal.rules.filter(function (r) { return r.ruleId === id; })[0];
  assert.strictEqual(target.attribution, 'rule');
  assert.strictEqual(target.rate, 1);
});

console.log('== 复盘须看得见当时的解读（用户报的缺口） ==');
t('案例记录保存 AI 解读全文', function () {
  var rec = CB.makeCase({ id: 'a', chart: CHART, xiangyi: XYR, answer: '结论：本月财运可期……' });
  assert.ok(rec.answer && /财运可期/.test(rec.answer), '解读全文必须存下来');
});
t('复盘提示词带上当时的解读——否则 AI 是在盲判', function () {
  var rec = CB.makeCase({ id: 'a', chart: CHART, xiangyi: XYR, answer: '结论：本月财运可期，生门临坤得令。' });
  var p = CB.reviewPrompt(rec, '一分未进');
  assert.ok(/当时实际给出的解读/.test(p), '须有解读段');
  assert.ok(p.indexOf('本月财运可期') >= 0, '解读原文须进入提示词');
});
t('解读过长时截断并如实标注节选', function () {
  var long = new Array(6000).join('长');
  var p = CB.reviewPrompt(CB.makeCase({ id: 'a', chart: CHART, xiangyi: XYR, answer: long }), '实况');
  assert.ok(/节选前 \d+ 字/.test(p), '截断须告知，不能让模型以为看到了全文');
  assert.ok(p.length < long.length, '提示词不应原样塞入超长解读');
});
t('未记录解读时如实说明，不伪装成有', function () {
  var p = CB.reviewPrompt(CB.makeCase({ id: 'a', chart: CHART, xiangyi: XYR }), '实况');
  assert.ok(/未记录解读全文/.test(p));
});
t('提示词要求指出断错之处并指明所据条目', function () {
  var rec = CB.makeCase({ id: 'a', chart: CHART, xiangyi: XYR, answer: '断言' });
  var p = CB.reviewPrompt(rec, '实况');
  assert.ok(/断错分析\(misreads\)/.test(p));
  assert.ok(/照抄解读里的原句/.test(p), '须要求照抄原句，转述会让人无法核对');
  assert.ok(/basedOn/.test(p) && /misreads/.test(p));
});

console.log('== 断错分析：严格校验，不许编造依据 ==');
t('解析合法 misreads', function () {
  var rec = CB.makeCase({ id: 'a', chart: CHART, xiangyi: XYR, answer: 'x' });
  var id = rec.fired.rules[0].id;
  var r = CB.parseReview(JSON.stringify({
    verdicts: {}, misreads: [{ claim: '断言本月必进财', basedOn: id, actual: '一分未进' }]
  }), rec);
  assert.strictEqual(r.misreads.length, 1);
  assert.strictEqual(r.misreads[0].basedOn, id);
  assert.strictEqual(r.misreads[0].actual, '一分未进');
});
t('编造的 basedOn 被清空但断错本身保留（内容仍有价值）', function () {
  var rec = CB.makeCase({ id: 'a', chart: CHART, xiangyi: XYR, answer: 'x' });
  var r = CB.parseReview(JSON.stringify({
    misreads: [{ claim: '某断言', basedOn: 'wealth.根本不存在.规则', actual: '实际' }]
  }), rec);
  assert.strictEqual(r.misreads.length, 1, '断错内容应保留');
  assert.strictEqual(r.misreads[0].basedOn, '', '编造的依据须清空，否则污染被指错计数');
  assert.ok(r.dropped.some(function (d) { return /断错分析引了本案不存在的条目/.test(d.why); }));
});
t('misreads 数量与长度受限', function () {
  var rec = CB.makeCase({ id: 'a', chart: CHART, xiangyi: XYR, answer: 'x' });
  var many = [];
  for (var i = 0; i < 20; i++) many.push({ claim: new Array(400).join('长'), basedOn: '', actual: new Array(400).join('长') });
  var r = CB.parseReview(JSON.stringify({ misreads: many }), rec);
  assert.ok(r.misreads.length <= 5, '最多 5 条');
  r.misreads.forEach(function (m) {
    assert.ok(m.claim.length <= 200 && m.actual.length <= 200, '逐条截断');
  });
});
t('无 claim 的条目被丢弃', function () {
  var rec = CB.makeCase({ id: 'a', chart: CHART, xiangyi: XYR, answer: 'x' });
  var r = CB.parseReview(JSON.stringify({ misreads: [{ basedOn: '', actual: 'x' }, { claim: '  ' }] }), rec);
  assert.strictEqual(r.misreads.length, 0);
});
t('坏输出时 misreads 为空数组，不抛异常', function () {
  var rec = CB.makeCase({ id: 'a', chart: CHART, xiangyi: XYR, answer: 'x' });
  ['', '非 JSON', '{坏'].forEach(function (bad) {
    assert.deepStrictEqual(CB.parseReview(bad, rec).misreads, []);
  });
});
t('applyFeedback 收下 misreads', function () {
  var rec = CB.applyFeedback(mkCase(1), {
    outcome: 'not_happened',
    misreads: [{ claim: 'a', basedOn: 'b', actual: 'c' }]
  });
  assert.strictEqual(rec.feedback.misreads.length, 1);
});

console.log('== 被指错次数：符合率之外的独立信号 ==');
t('统计每条规则被指为断错依据的次数，并留例证', function () {
  var recs = [], id = XYR.readings[0].id;
  for (var i = 0; i < 10; i++) {
    recs.push(CB.applyFeedback(mkCase(i), {
      outcome: 'happened',    // 整案说应验
      misreads: [{ claim: '断言必进财', basedOn: id, actual: '一分未进' }],
      now: '2024-05-01'
    }));
  }
  var cal = CB.calibrate(recs);
  var target = cal.rules.filter(function (r) { return r.ruleId === id; })[0];
  assert.strictEqual(target.misreadN, 10);
  assert.ok(target.misreadExamples.length > 0 && target.misreadExamples.length <= 3, '留少量例证即可');
  assert.strictEqual(target.rate, 1, '符合率仍为 1——这正说明两个信号各看各的');
});
t('符合率尚可但屡被指错者，仍会被建议复核', function () {
  var recs = [], id = XYR.readings[0].id;
  for (var i = 0; i < 12; i++) {
    recs.push(CB.applyFeedback(mkCase(i), {
      outcome: 'happened',
      misreads: [{ claim: '断言必进财', basedOn: id, actual: '一分未进' }],
      now: '2024-05-01'
    }));
  }
  var ps = CB.proposals(CB.calibrate(recs));
  var hit = ps.filter(function (p) { return /常被指为断错/.test(p.title) && p.ruleId === id; });
  assert.strictEqual(hit.length, 1, '这是符合率看不出来的问题，必须单独提示');
  assert.ok(/问题可能不在条目本身/.test(hit[0].detail), '须点明可能是用法而非条目本身之错');
});
t('指向象义 key 的断错不计入规则的被指错次数', function () {
  var recs = [];
  var proto = fullCase('wealth');
  var symKey = proto.fired.symbols[0].key;
  for (var i = 0; i < 10; i++) {
    var r = fullCase('wealth'); r.id = 'm' + i;
    recs.push(CB.applyFeedback(r, {
      outcome: 'happened', misreads: [{ claim: 'x', basedOn: symKey, actual: 'y' }], now: '2024-05-01'
    }));
  }
  var cal = CB.calibrate(recs);
  cal.rules.forEach(function (x) {
    assert.strictEqual(x.misreadN, 0, '象义 key 不应记到规则头上：' + x.ruleId);
  });
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
