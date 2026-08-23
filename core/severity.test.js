/**
 * 力量校验(Severity) 单元测试（纯 Node，无框架）。
 * 本层的每一条都不是新断法，而是纲要四之二节里**本就写死、却从未被执行**的禁令。
 * 故测试的第一要务是：逐条回查原文确实如此；第二要务是：不越界——只出禁令，不出吉凶结论。
 */
'use strict';
var path = require('path');
var assert = require('assert');
var fs = require('fs');
global.window = global;
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.QM;

var SV = require('./severity.js');
var WS = require('./wangshuai.js');
var XY = require('./xiangyi.js');
var RULES = require('../knowledge/severity-rules.json');
var MD = fs.readFileSync(path.join(__dirname, '..', 'assets', 'zhuanpan-method.md'), 'utf8');
var FP = fs.readFileSync(path.join(__dirname, '..', 'assets', 'feipan-method.md'), 'utf8');

SV.load(RULES);
XY.load(require('../knowledge/domain-rules.json'));

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function chartAt(iso, purpose) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: purpose || '综合' });
}
function run(chart, domain) {
  var ws = WS.analyze(chart);
  var xy = XY.analyze({ domain: domain || 'general', chart: chart, wangshuai: ws });
  return SV.analyze({ chart: chart, wangshuai: ws, xiangyi: xy });
}
var SAMPLES = (function () {
  var out = [];
  for (var i = 0; i < 120; i++) out.push(chartAt(new Date(Date.UTC(2024, 0, 1 + i * 3, 2 + (i % 11))).toISOString()));
  return out;
})();

console.log('== 每条禁令都指得回纲要原文 ==');

t('五条检查齐备，各带 basis / verdict / prohibition', function () {
  var need = ['吉凶与力量背离', '旺相之凶', '多害叠加', '衰死入墓', '力量极弱'];
  need.forEach(function (k) {
    var c = RULES.checks[k];
    assert.ok(c, '缺检查：' + k);
    assert.ok(c.basis && c.basis.length > 20, k + ' 缺出处');
    assert.ok(c.verdict && c.prohibition, k + ' 须同时给出判语与禁令');
    assert.ok(['critical', 'high', 'medium'].indexOf(c.severity) >= 0);
  });
});

t('引文逐字回查两份纲要（非转述）', function () {
  assert.ok(MD.indexOf('旺相之凶格，凶亦有力（凶得更凶）；休囚之吉格，吉亦无力（吉而不显）') >= 0);
  assert.ok(MD.indexOf('不可只看吉凶不看旺衰') >= 0);
  assert.ok(MD.indexOf('同宫多害则**减力相乘**') >= 0);
  assert.ok(MD.indexOf('不可强断为吉') >= 0);
  assert.ok(FP.indexOf('休囚之吉亦无力') >= 0);
  assert.ok(FP.indexOf('衰死又入墓') >= 0);
  ['吉凶与力量背离', '多害叠加', '衰死入墓'].forEach(function (k) {
    assert.ok(/纲要/.test(RULES.checks[k].basis), k + ' 的 basis 须注明出自纲要何处');
  });
});

t('两派通用，且各自注明出处——非由一派推及另一派', function () {
  assert.deepStrictEqual(RULES.appliesTo, ['zhuanpan', 'feipan']);
  assert.ok(/转盘/.test(RULES.checks['吉凶与力量背离'].basis) && /飞盘/.test(RULES.checks['吉凶与力量背离'].basis));
  assert.ok(/转盘/.test(RULES.checks['衰死入墓'].basis) && /飞盘/.test(RULES.checks['衰死入墓'].basis));
});

t('阈值由 wangshuai 的力量刻度反推，且写明了缘由', function () {
  var th = RULES.thresholds;
  assert.ok(th._why && th._why.length > 60, '阈值须写明何以如此，不得随手所定');
  assert.strictEqual(th.critical, 0.10, '0.1 正是纲要「既入墓又击刑」之量级 1.0×0.5×0.2');
  assert.strictEqual(th.weak, 0.25);
  assert.strictEqual(th.strong, 0.80);
  assert.ok(th.critical < th.weak && th.weak < th.strong);
  // 与 wangshuai 的实际折算一致：旺(1.0) 单犯入墓 = 0.2，落在 weak 之内
  assert.ok(1.0 * 0.2 <= th.weak, '旺干单犯入墓应被判为力弱');
  assert.ok(1.0 * 0.5 * 0.2 <= th.critical, '入墓+击刑应被判为几近无力');
});

console.log('== 只做对拍，不自行推算 ==');

t('缺 wangshuai 即停用——绝不自行推算力量', function () {
  var r = SV.analyze({ chart: chartAt('2024-04-10T10:00:00') });
  assert.strictEqual(r.applicable, false);
  assert.ok(/绝不自行推算力量/.test(r.reason));
  assert.strictEqual(SV.toPromptBlock(r), '');
});

t('缺盘、未加载规则库时停用，不抛错', function () {
  assert.strictEqual(SV.analyze({}).applicable, false);
  var SV2 = require('./severity.js');
  SV2.load(null);
  assert.strictEqual(SV2.isLoaded(), false);
  assert.strictEqual(SV2.analyze({ chart: chartAt('2024-04-10T10:00:00') }).applicable, false);
  SV2.load(RULES);
});

t('findings 里的力量与四害逐项等于 wangshuai 的原值，未被改写', function () {
  SAMPLES.slice(0, 25).forEach(function (c) {
    var ws = WS.analyze(c);
    var r = run(c);
    r.gongs.forEach(function (g) {
      var w = ws.gongs[g.gong] || {};
      assert.strictEqual(g.power, typeof w.power === 'number' ? w.power : null, g.gong + '宫力量被改写');
      assert.deepStrictEqual(g.harms, (w.harms || []), g.gong + '宫四害被改写');
    });
  });
});

t('宫位吉凶逐项等于引擎 jiuGongAnalysis 的原值', function () {
  SAMPLES.slice(0, 25).forEach(function (c) {
    var r = run(c);
    r.gongs.forEach(function (g) {
      assert.strictEqual(g.jiXiong, (c.jiuGongAnalysis[g.gong] || {}).jiXiong || '', g.gong + '宫吉凶被改写');
    });
  });
});

console.log('== 五条检查各自触发正确 ==');

t('吉凶与力量背离：引擎判吉 + 力量不足，才触发', function () {
  var seen = 0;
  SAMPLES.forEach(function (c) {
    var r = run(c);
    r.findings.filter(function (f) { return f.check === '吉凶与力量背离'; }).forEach(function (f) {
      var g = r.gongs.filter(function (x) { return x.gong === f.gong; })[0];
      assert.ok(g.jiXiong === 'da_ji' || g.jiXiong === 'xiao_ji', '非吉宫不该触发背离');
      assert.ok(g.power <= RULES.thresholds.weak, '力量未达门槛不该触发');
      seen++;
    });
  });
  assert.ok(seen > 0, '120 张样本盘里应出现过吉凶与力量背离——这正是实测失误的那一类');
});

t('旺相之凶：引擎判凶 + 力量充足，才触发', function () {
  SAMPLES.forEach(function (c) {
    var r = run(c);
    r.findings.filter(function (f) { return f.check === '旺相之凶'; }).forEach(function (f) {
      var g = r.gongs.filter(function (x) { return x.gong === f.gong; })[0];
      assert.ok(g.jiXiong === 'da_xiong' || g.jiXiong === 'xiao_xiong');
      assert.ok(g.power >= RULES.thresholds.strong);
    });
  });
});

t('多害叠加：命中 2 害以上才触发，且详情逐项列出害名', function () {
  SAMPLES.forEach(function (c) {
    var r = run(c);
    r.findings.filter(function (f) { return f.check === '多害叠加'; }).forEach(function (f) {
      var g = r.gongs.filter(function (x) { return x.gong === f.gong; })[0];
      assert.ok(g.harms.length >= 2, '不足二害不该触发');
      g.harms.forEach(function (h) {
        assert.ok(f.detail.indexOf(h) >= 0, '详情须逐项写明害名（纲要要求写"因×害故力弱"）：' + h);
      });
    });
  });
});

t('衰死入墓：天盘干囚/死 且入墓，才触发', function () {
  SAMPLES.forEach(function (c) {
    var ws = WS.analyze(c);
    var r = run(c);
    r.findings.filter(function (f) { return f.check === '衰死入墓'; }).forEach(function (f) {
      var w = ws.gongs[f.gong];
      assert.ok(w.tianGanState === '囚' || w.tianGanState === '死', '非衰死不该触发');
      assert.ok(w.ruMu || (w.harms || []).some(function (h) { return h.indexOf('入墓') >= 0; }));
      assert.strictEqual(f.severity, 'critical', '纲要于此明言「不可强断为吉」，属最重一档');
    });
  });
});

t('力量极弱：power ≤ critical 才触发', function () {
  SAMPLES.forEach(function (c) {
    var r = run(c);
    r.findings.filter(function (f) { return f.check === '力量极弱'; }).forEach(function (f) {
      var g = r.gongs.filter(function (x) { return x.gong === f.gong; })[0];
      assert.ok(g.power <= RULES.thresholds.critical, f.gong + '宫力量 ' + g.power + ' 不该触发极弱');
    });
  });
});

console.log('== 只校验关注宫，不遍历全盘 ==');

t('校验范围＝用神宫 + 值符 + 值使 + 日干时干宫，且各记来历', function () {
  var c = chartAt('2024-04-10T10:00:00', '财运');
  var ws = WS.analyze(c);
  var xy = XY.analyze({ domain: 'wealth', chart: c, wangshuai: ws });
  var r = SV.analyze({ chart: c, wangshuai: ws, xiangyi: xy });
  assert.ok(r.gongs.length >= 1 && r.gongs.length <= 9);
  var zf = String(c.zhiFuLuoGong || c.zhiFuGong), zs = String(c.zhiShiGong);
  var got = r.gongs.map(function (g) { return g.gong; });
  assert.ok(got.indexOf(zf) >= 0, '值符宫须在校验之列（纲要 3.5 点名）');
  assert.ok(got.indexOf(zs) >= 0, '值使宫须在校验之列');
  r.gongs.forEach(function (g) { assert.ok(g.roles.length > 0, g.gong + '宫未记来历'); });
  var xyGongs = xy.focus.map(function (f) { return String(f.gong); });
  xyGongs.forEach(function (g) { assert.ok(got.indexOf(g) >= 0, '用神宫 ' + g + ' 漏校验'); });
});

t('类象用神的落宫也纳入校验（所问之物本身也要称量）', function () {
  var c = chartAt('2024-04-10T10:00:00');
  var ws = WS.analyze(c);
  var lx = { version: '1.0.0', applicable: true, candidates: [{ symbol: '辛', located: true, gong: '4', terms: ['钥匙'] }] };
  var r = SV.analyze({ chart: c, wangshuai: ws, leixiang: lx });
  var g4 = r.gongs.filter(function (g) { return g.gong === '4'; })[0];
  assert.ok(g4, '类象用神落宫应进入校验');
  assert.ok(g4.roles.some(function (s) { return /类象/.test(s) && /钥匙/.test(s); }), '须记明是所问何物带进来的');
});

console.log('== 不越界：只出禁令，不出吉凶结论 ==');

t('输出里没有任何吉凶断语，只有「不得如何说」', function () {
  var banned = /必凶|必死|此事必|一定会|注定/;
  SAMPLES.slice(0, 40).forEach(function (c) {
    var txt = SV.toPromptBlock(run(c));
    assert.ok(!banned.test(txt), '力量校验不得下吉凶断语：' + txt.slice(0, 120));
  });
});

t('提示块自陈「不是叫你断凶」，并带出整盘口径与依据', function () {
  var withFindings = null;
  for (var i = 0; i < SAMPLES.length && !withFindings; i++) {
    var r = run(SAMPLES[i]);
    if (r.findings.length) withFindings = r;
  }
  assert.ok(withFindings, '样本中应有触发禁令者');
  var txt = SV.toPromptBlock(withFindings);
  assert.ok(/不是叫你断凶/.test(txt));
  assert.ok(/不可只看吉凶不看旺衰/.test(txt));
  assert.ok(/整盘口径/.test(txt));
  assert.ok(/依据：/.test(txt));
  assert.ok(/我能制之/.test(txt) && /不表\*\*事体转吉\*\*/.test(txt),
    '「我能制之≠事体转吉」须随块带出——这是实测里反复出错的一处');
});

t('无触发时不产出文本，也不谎称「一切良好」', function () {
  var clean = null;
  for (var i = 0; i < SAMPLES.length && !clean; i++) {
    var r = run(SAMPLES[i]);
    if (!r.findings.length) clean = r;
  }
  if (clean) {
    assert.strictEqual(SV.toPromptBlock(clean), '');
    assert.ok(/未触发/.test(clean.reason));
    assert.ok(!/良好|无碍|可放心/.test(clean.reason), '未触发禁令不等于盘好，不得如此措辞');
  }
});

console.log('== 整盘口径与确定性 ==');

t('整盘口径只作汇总描述，不得推整盘吉凶、也不得叫模型转悲观', function () {
  assert.ok(RULES.chartVerdict._measured && /无相关/.test(RULES.chartVerdict._measured),
    '须留档「口径与实际结果无相关」这一回测事实，防止日后被当成预测器');
  var txt = JSON.stringify(RULES.chartVerdict.levels);
  assert.ok(!/整盘不宜作乐观断语|偏凶|危重/.test(txt),
    '口径一行不得带整盘吉凶断语——无据的悲观与无据的乐观同样是误判');
  assert.ok(/不得.{0,6}据此笼统转为悲观/.test(RULES.chartVerdict.levels.most));
  assert.ok(/不代表盘好/.test(RULES.chartVerdict.levels.none), 'none 不得被读成「盘好」');
});

t('整盘口径按受折关注宫的比例分三档，且数目自洽', function () {
  SAMPLES.forEach(function (c) {
    var r = run(c);
    if (!r.verdict) return;
    assert.ok(['none', 'some', 'most'].indexOf(r.verdict.level) >= 0);
    assert.strictEqual(r.verdict.impaired, r.verdict.impairedGongs.length);
    assert.ok(r.verdict.impaired <= r.verdict.total);
    if (r.verdict.level === 'most') assert.ok(r.verdict.impaired * 2 >= r.verdict.total);
    if (r.verdict.level === 'none') assert.strictEqual(r.verdict.impaired, 0);
  });
});

t('确定性：同盘同占类，结果与提示块逐字相同', function () {
  var c = chartAt('2024-04-10T10:00:00', '财运');
  var a = run(c, 'wealth'), b = run(c, 'wealth');
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.strictEqual(SV.toPromptBlock(a), SV.toPromptBlock(b));
});

t('多盘稳健：120 张样本盘皆不抛错，findings 皆带出处与禁令', function () {
  SAMPLES.forEach(function (c) {
    var r = run(c);
    r.findings.forEach(function (f) {
      assert.ok(f.basis && f.prohibition && f.detail, f.id + ' 条目不完整');
      assert.ok(/^[1-9]$/.test(f.gong));
      assert.ok(f.roles.length > 0);
    });
    JSON.parse(JSON.stringify(r));
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
