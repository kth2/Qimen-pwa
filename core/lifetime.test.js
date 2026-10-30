/**
 * Phase 42 回归测试：新增占类「终身局」「异梦」（纯 Node，无框架）。
 * 运行：node core/lifetime.test.js
 *
 * 取用为〔用户所定·2026-10-25〕（用户采纳了草案）——转盘纲要无此二占类原文。钉住五件事：
 *   ① 三套词表串得上：界面「终身局／异梦」→ 引擎「综合」→ 规则 lifetime／dream；
 *      飞盘未立取用，照实标「不支持」、规则退回通用条，不拿转盘那套去顶；
 *   ② 年命定得了宫：传了才有（甲年须连年支、按所遁之仪），不传就没有；终身局未选年命时自动取本盘年柱；
 *   ③ 两套判读真的产出，且只来自规则库；纲要引文逐字（citation.test 全占类守着），其余标〔用户所定〕；
 *   ④ 安全边界随占类送达：终身局不断寿元，异梦不断「必是鬼神作祟」、不劝花钱化解；
 *   ⑤ 别的占类不受影响：给 xiangyi 传年命，旧占类的结果逐字不变。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');
var vm = require('vm');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var XY = require('./xiangyi.js');
var WS = require('./wangshuai.js');
var YS = require('./yongshen.js');
var YQ = require('./yingqi.js');
var TM = require('./timing.js');
var EV = require('./evidence.js');
var RULES = require('../knowledge/domain-rules.json');
var DOMAINS = require('../knowledge/domains.json');
var SYMBOLS = require('../knowledge/symbols.json');
var TIMING_RULES = require('../knowledge/timing-rules.json');
var ROOT = path.join(__dirname, '..');
var APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
var HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

XY.load(RULES); YS.load(DOMAINS); EV.load(SYMBOLS); TM.load(TIMING_RULES);

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function chartAt(iso) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合' });
}
// 一张固定的「出生盘」：1993-05-20 08:30（癸酉年）
var BIRTH = chartAt('1993-05-20T08:30:00');
function run(domain, chart, nianMing) {
  return XY.analyze({ domain: domain, chart: chart, wangshuai: WS.analyze(chart), options: { nianMing: nianMing } });
}
function ids(r) { return r.readings.concat(r.combinations, r.relations).map(function (x) { return x.id; }); }

console.log('\n== 三套词表：转盘可用，飞盘照实标不支持 ==');
t('转盘：终身局→综合→lifetime，异梦→综合→dream，皆有专条', function () {
  [['终身局', 'lifetime'], ['异梦', 'dream']].forEach(function (a) {
    var m = YS.categoryMap(a[0], 'zhuanpan');
    assert.strictEqual(m.engineCategory, '综合');
    assert.strictEqual(m.engineSupported, true);
    assert.strictEqual(m.ruleDomain, a[1]);
    assert.strictEqual(m.hasDedicatedRules, true);
  });
});
t('飞盘：标不支持、报的是界面占类名（不是「综合」）、规则退回通用条', function () {
  ['终身局', '异梦'].forEach(function (u) {
    var m = YS.categoryMap(u, 'feipan');
    assert.strictEqual(m.engineSupported, false, u + ' 飞盘应标不支持');
    assert.strictEqual(m.unsupportedName, u);
    assert.strictEqual(m.ruleDomain, 'general', '飞盘上不得跑转盘那套取用');
    assert.ok(/飞盘/.test(m.degradeWhy) && /用户所定·2026-10-25/.test(m.degradeWhy));
  });
});
t('证据包的「不支持」一句点名「终身局」，而非「不支持综合」', function () {
  var cm = YS.categoryMap('终身局', 'feipan');
  var ev = EV.build({ question: '看一生', domain: 'general', chart: BIRTH, categoryMap: cm,
    yongshen: YS.resolve({ domain: 'general', chart: BIRTH }) });
  var txt = EV.toPromptBlock(ev);
  assert.ok(/不支持「终身局」占类/.test(txt), txt.slice(0, 300));
  assert.ok(!/不支持「综合」/.test(txt));
});
t('别的占类不受「schools」一项影响（其余 25 个界面选项映射逐一不变）', function () {
  assert.strictEqual(YS.categoryMap('财运', 'feipan').ruleDomain, 'wealth');
  assert.strictEqual(YS.categoryMap('事业', 'feipan').engineSupported, false, '飞盘不认事业，照旧');
  assert.strictEqual(YS.categoryMap('事业', 'feipan').unsupportedName, '', '引擎层的不支持不填 unsupportedName');
});

console.log('\n== 年命：传了才有，甲年按遁仪 ==');
t('不传年命：年命盘上未见，不拿年柱或旬首顶', function () {
  var r = run('lifetime', BIRTH, '');
  assert.ok(r.absent.some(function (x) { return x.name === '年命' && /盘上未见/.test(x.note); }), '未传年命却定了宫');
  assert.ok(!r.focus.some(function (x) { return x.name === '年命'; }));
  assert.ok(!ids(r).some(function (i) { return /年命/.test(i); }), '年命未定宫却产出了年命判读');
});
t('传年命（非甲）：落在该干天盘之宫，且产出年命判读', function () {
  var gan = BIRTH.siZhu.year.charAt(0);
  var r = run('lifetime', BIRTH, gan);
  var f = r.focus.filter(function (x) { return x.name === '年命'; })[0];
  assert.ok(f && f.gong, '年命未定宫');
  assert.strictEqual(String(f.gong), String(XY.resolveElement(gan, XY.indexChart(BIRTH)).gong), '年命宫应即该干落宫');
  assert.ok(ids(r).some(function (i) { return /^lifetime\.年命\./.test(i); }), '应有年命判读');
});
t('年命为甲：须连年支，按所遁之仪取宫；只给「甲」定不了宫', function () {
  var idxOk = XY.indexChart(BIRTH, { nianMing: '甲子' });
  var e = XY.resolveElement('年命', idxOk);
  assert.ok(e, '甲子年命应能定宫');
  assert.strictEqual(String(e.gong), String(idxOk.primary['戊']), '甲子遁戊，应以戊落宫论');
  assert.ok(/甲子遁于戊/.test(e.via));
  assert.strictEqual(XY.resolveElement('年命', XY.indexChart(BIRTH, { nianMing: '甲' })), null, '只给甲不得硬取');
});
t('app.js 的 effectiveNianMing：终身局未选时取本盘年柱（甲年连年支），别的占类没选就是没有', function () {
  var at = APP.indexOf('function effectiveNianMing');
  assert.ok(at > 0, '缺 effectiveNianMing');
  var src = APP.slice(at, APP.indexOf('\n  }\n', at) + 4);
  function make(sel) {
    var ctx = { $: function () { return { value: sel }; }, String: String };
    vm.runInNewContext(src + '; this.f = effectiveNianMing;', ctx);
    return ctx.f;
  }
  var panYi = { siZhu: { year: '癸酉' } }, panJia = { siZhu: { year: '甲子' } };
  assert.strictEqual(make('')('lifetime', panYi), '癸');
  assert.strictEqual(make('')('lifetime', panJia), '甲子', '甲年须连年支');
  assert.strictEqual(make('')('wealth', panYi), '', '别的占类不得拿起盘年柱顶年命');
  assert.strictEqual(make('丙')('lifetime', panYi), '丙', '用户选了以用户为准');
  assert.ok(/nianMing: nianMing/.test(APP), 'xiangyi 须收到年命');
  assert.ok(/riShiGanBlock\(pan, nianMing\)/.test(APP), '提示词的年命宫须用同一个年命');
});

console.log('\n== 判读：两套都产出，且只来自规则库 ==');
var byId = {};
Object.keys(RULES.domains).forEach(function (dm) {
  ['conditions', 'combinations', 'relations'].forEach(function (k) {
    (RULES.domains[dm][k] || []).forEach(function (r) { byId[r.id] = r; });
  });
});
// 扫一批盘，确保条件、组合、关系各至少命中过一次（只靠一张盘会因排布而漏）
function sweep(domain, nm) {
  var seen = {}, base = new Date('2024-01-01T00:00:00').getTime();
  for (var h = 0; h < 24 * 60; h += 5) {
    var c = chartAt(new Date(base + h * 3600e3).toISOString());
    var r = run(domain, c, nm ? c.siZhu.year.charAt(0) === '甲' ? c.siZhu.year : c.siZhu.year.charAt(0) : '');
    ids(r).forEach(function (i) { seen[i] = 1; });
    r.readings.concat(r.combinations, r.relations).forEach(function (x) {
      assert.ok(byId[x.id], '产出了规则库中不存在的判读：' + x.id);
      assert.ok(x.id.indexOf(domain + '.') === 0, domain + ' 混入了别的占类：' + x.id);
    });
  }
  return Object.keys(seen);
}
t('终身局：单象、组合、年命与开门/生门的宫际生克都产出过', function () {
  var s = sweep('lifetime', true);
  assert.ok(s.some(function (i) { return /^lifetime\.年命\./.test(i); }), '无年命单象');
  assert.ok(s.some(function (i) { return /^lifetime\.(年命|乙)\+/.test(i); }), '无组合');
  assert.ok(s.indexOf('lifetime.rel.年命-开门') >= 0 && s.indexOf('lifetime.rel.年命-生门') >= 0, '无年命宫际生克');
});
t('异梦：腾蛇单象、腾蛇同宫组合、日干—腾蛇生克都产出过', function () {
  var s = sweep('dream', false);
  assert.ok(s.some(function (i) { return /^dream\.腾蛇\./.test(i); }), '无腾蛇单象');
  assert.ok(s.some(function (i) { return /^dream\.腾蛇\+/.test(i); }), '无腾蛇组合');
  assert.ok(s.indexOf('dream.rel.日干-腾蛇') >= 0, '无日干—腾蛇生克');
});
t('出处：每条要么引纲要原句、要么标〔用户所定·2026-10-25〕；腾蛇引的是那句原文', function () {
  ['lifetime', 'dream'].forEach(function (dm) {
    var d = RULES.domains[dm];
    var all = Object.keys(d.roles).map(function (k) { return d.roles[k].basis; })
      .concat([].concat(d.conditions, d.combinations, d.relations).map(function (r) { return r.basis; }));
    all.forEach(function (b) { assert.ok(/^纲要·|^〔用户所定·2026-10-25〕/.test(b), dm + ' 出处不明：' + b.slice(0, 40)); });
  });
  assert.ok(/纲要·四节八神：腾蛇\(凶\)：虚惊怪异/.test(RULES.domains.dream.roles['腾蛇'].basis));
  assert.ok(/太阴\(吉\)：暗助谋密/.test(RULES.domains.dream.roles['太阴'].basis), '太阴照纲要作吉神，不改作阴灵');
});
t('两套都如实标 core（条件不足 12 条，不为凑数另编）', function () {
  assert.strictEqual(RULES.domains.lifetime.status, 'core');
  assert.strictEqual(RULES.domains.dream.status, 'core');
});

console.log('\n== 安全边界与提示词 ==');
t('安全边界随判读送达：终身局不断寿元，异梦先排除身心原因、不劝花钱化解', function () {
  var r1 = run('lifetime', BIRTH, BIRTH.siZhu.year.charAt(0)), r2 = run('dream', BIRTH, '');
  assert.ok(/不断寿元、死期/.test(r1.safetyNote));
  assert.ok(/排除睡眠、情绪、用药与身体原因/.test(r2.safetyNote) && /不劝人花钱做法事/.test(r2.safetyNote));
  var ev = EV.build({ question: '老做怪梦', domain: 'dream', chart: BIRTH, xiangyi: r2,
    yongshen: YS.resolve({ domain: 'dream', chart: BIRTH }) });
  assert.ok(/本占类边界：.*不得断定「必是鬼神作祟」/.test(EV.toPromptBlock(ev)));
});
t('终身局的 TIMING 段写明「自出生时起算」', function () {
  var ws = WS.analyze(BIRTH), xy = run('lifetime', BIRTH, BIRTH.siZhu.year.charAt(0));
  var yq = YQ.analyze(BIRTH, { yongShenGongs: xy.focus.map(function (f) { return f.gong; }) });
  var tm = TM.analyze({ chart: BIRTH, yingqi: yq, xiangyi: xy, wangshuai: ws, options: { domain: 'lifetime' } });
  var mk = function (dm) {
    return EV.toPromptBlock(EV.build({ question: 'q', domain: dm, chart: BIRTH, xiangyi: xy, timing: tm,
      yongshen: YS.resolve({ domain: dm, chart: BIRTH }) }));
  };
  var txt = mk('lifetime');
  assert.ok(/TIMING/.test(txt), '应有 TIMING 段');
  assert.ok(/本盘为终身局，按出生年月日时起/.test(txt) && /自\*\*出生时\*\*起算/.test(txt));
  assert.ok(!/本盘为终身局/.test(mk('general')), '别的占类不加这句');
});
t('E31 进了系统提示词：两级出处、年为单位、不断寿元、不断鬼神作祟', function () {
  var i = APP.indexOf("'E31."), seg = APP.slice(i, APP.indexOf("'E20.", i));
  assert.ok(i > 0);
  assert.ok(/用户所定·2026-10-25/.test(seg) && /转盘纲要无此二占类原文/.test(seg));
  assert.ok(/出生那年/.test(seg) && /虚岁/.test(seg));
  assert.ok(/不断寿元、死期/.test(seg));
  assert.ok(/不得断定「必是鬼神作祟」/.test(seg) && /日干宫空亡主自身心神不定/.test(seg));
});
t('界面：下拉有两项、选终身局时提醒改填出生时间；离线缓存换了新名', function () {
  assert.ok(/<option value="终身局">/.test(HTML) && /<option value="异梦">/.test(HTML));
  assert.ok(/终身局须按出生年月日时起盘/.test(APP));
  assert.ok(/qimen-pwa-wannianli/.test(SW));
});

console.log('\n== 别的占类不受影响 ==');
t('给 xiangyi 传年命，旧占类结果逐字不变（它们的规则没有一条引年命）', function () {
  ['wealth', 'health', 'general', 'lost_item'].forEach(function (dm) {
    var a = run(dm, BIRTH, ''), b = run(dm, BIRTH, '丙');
    assert.deepStrictEqual(ids(a), ids(b), dm + ' 因年命而变了');
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
