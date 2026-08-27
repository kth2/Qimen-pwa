/**
 * Phase 14 伏吟／反吟层 回归测试（纯 Node，无框架）。
 * 运行：node core/yinju.test.js
 *
 * 锁定的是几条容易在后续扩充中被悄悄破坏的约定：
 *   ① 转盘中宫恒同干，是引擎中宫寄的产物，**不得**当作伏吟报出去；
 *   ② 星层／门层是通行法、干层才是纲要原文，两级出处不得混同；
 *   ③ 干反吟按天干相冲判（用户裁定），不跟引擎自己的「反吟大格」走；
 *   ④ 局与宫分开，一两宫命中不得升格为全盘。
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var Y = require('./yinju.js');
var RULES = require('../knowledge/yinju-rules.json');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function zhuanpan(iso) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
}
function feipan(iso) {
  return QM.feipanQimen.calculate(new Date(iso), { method: '时家', purpose: '综合' });
}
/** 造一张最小盘，只放本层要看的四个字段 */
function fake(cells, extra) {
  var jg = {};
  Object.keys(cells).forEach(function (g) { jg[g] = cells[g]; });
  var c = { jiuGongAnalysis: jg };
  if (extra) Object.keys(extra).forEach(function (k) { c[k] = extra[k]; });
  return c;
}

console.log('\n== 规则库与加载 ==');
Y.load(RULES);
t('规则库能加载', function () { assert.strictEqual(Y.isLoaded(), true); });
t('未加载时不抛异常，只声明跳过', function () {
  var Y2 = require('./yinju.js');
  // 用一个不合格的对象把 DB 打回 null，再复原
  assert.strictEqual(Y2.load({}), false);
  var r = Y2.analyze({ chart: zhuanpan('2026-01-01T15:00:00') });
  assert.strictEqual(r.layers.length, 0);
  assert.ok(/未加载/.test(r.notes.join('')), '应说明本层被跳过');
  Y2.load(RULES);
});
t('盘中无九宫数据时如实说明，不臆造', function () {
  var r = Y.analyze({ chart: {} });
  assert.ok(/无从判起/.test(r.notes.join('')));
});

console.log('\n== 转盘中宫：引擎中宫寄的假伏吟必须排除 ==');
t('转盘中宫天地盘干恒相同（实测前提，若引擎改动此测应先红）', function () {
  var t0 = new Date('2026-01-01T00:00:00').getTime(), n = 0, same = 0;
  for (var i = 0; i < 300; i++) {
    var p = QM.qimen.calculate(new Date(t0 + i * 3600 * 1000 * 7),
      { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
    if (!p || p.error) continue;
    var c = p.jiuGongAnalysis['5'];
    if (c && c.tianGan && c.diGan) { n++; if (c.tianGan === c.diGan) same++; }
  }
  assert.ok(n > 100, '样本足够');
  assert.strictEqual(same, n, '转盘中宫应 100% 同干，实测 ' + same + '/' + n);
});
t('转盘：中宫同干不算干伏吟', function () {
  var r = Y.analyze({ chart: fake({ '5': { tianGan: '乙', diGan: '乙' } }), school: 'zhuanpan' });
  assert.strictEqual(r._counts['gan.fuyin'], 0, '中宫那一条必须被排除掉');
});
t('飞盘：中宫同干照常算（飞盘中宫同干率仅 20%，是真盘象）', function () {
  var r = Y.analyze({ chart: fake({ '5': { tianGan: '乙', diGan: '乙' } }), school: 'feipan' });
  assert.strictEqual(r._counts['gan.fuyin'], 1);
});
t('转盘：中宫以外的同干照常算', function () {
  var r = Y.analyze({ chart: fake({ '3': { tianGan: '庚', diGan: '庚' } }), school: 'zhuanpan' });
  assert.strictEqual(r._counts['gan.fuyin'], 1);
});
t('实盘扫描：转盘绝不出现「中宫干伏吟」', function () {
  var t0 = new Date('2026-03-01T00:00:00').getTime(), bad = 0;
  for (var i = 0; i < 200; i++) {
    var p = QM.qimen.calculate(new Date(t0 + i * 3600 * 1000 * 5),
      { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
    if (!p || p.error) continue;
    var r = Y.analyze({ chart: p });
    r.layers.forEach(function (it) {
      if (it.layer === 'gan' && it.kind === 'fuyin' && it.gongs.indexOf('5') >= 0) bad++;
    });
  }
  assert.strictEqual(bad, 0, '出现了 ' + bad + ' 次中宫假伏吟');
});

console.log('\n== 判定口径 ==');
t('干反吟按天干相冲：丙+壬 成立', function () {
  var r = Y.analyze({ chart: fake({ '3': { tianGan: '丙', diGan: '壬' } }), school: 'zhuanpan' });
  assert.strictEqual(r._counts['gan.fanyin'], 1);
});
t('干反吟不跟引擎走：庚+癸（引擎名「反吟大格」）不算干反吟', function () {
  var r = Y.analyze({ chart: fake({ '3': { tianGan: '庚', diGan: '癸' } }), school: 'zhuanpan' });
  assert.strictEqual(r._counts['gan.fanyin'], 0,
    '用户裁定按天干相冲取义，庚癸非相冲，故不算——引擎自有其命名，本层不据之');
});
t('戊己无冲，不参与反吟', function () {
  var r = Y.analyze({ chart: fake({ '3': { tianGan: '戊', diGan: '己' } }), school: 'zhuanpan' });
  assert.strictEqual(r._counts['gan.fanyin'], 0);
});
t('星伏吟：天蓬归坎一', function () {
  var r = Y.analyze({ chart: fake({ '1': { xing: '天蓬' } }), school: 'zhuanpan' });
  assert.strictEqual(r._counts['xing.fuyin'], 1);
});
t('星反吟：天蓬(本位坎一)落离九', function () {
  var r = Y.analyze({ chart: fake({ '9': { xing: '天蓬' } }), school: 'zhuanpan' });
  assert.strictEqual(r._counts['xing.fanyin'], 1);
});
t('【回归】引擎的「禽芮」须归为天芮——v1 归成了天禽，致天芮从不参与判定', function () {
  assert.strictEqual(Y._internals.normXing('禽芮'), '天芮');
  // 天芮本位坤2、对宫艮8。这两条 v1.0.0 全判不出来
  assert.strictEqual(Y.analyze({ chart: fake({ '2': { xing: '禽芮' } }), school: 'zhuanpan' })._counts['xing.fuyin'], 1);
  assert.strictEqual(Y.analyze({ chart: fake({ '8': { xing: '禽芮' } }), school: 'zhuanpan' })._counts['xing.fanyin'], 1);
});
t('天禽不参与吟的判定：用户所定之表只列八星，禽寄中宫随芮而行', function () {
  var r = Y.analyze({ chart: fake({ '5': { xing: '天禽' } }), school: 'feipan' });
  assert.strictEqual(r._counts['xing.fuyin'], 0, '天禽落中五不作伏吟');
  assert.ok(!('天禽' in require('../knowledge/yinju-rules.json').homes.xing), '本位表里不该有天禽');
});
t('【回归】转盘星层可判宫数应为 8 而非 7', function () {
  var r = Y.analyze({ chart: zhuanpan('2026-01-01T15:00:00') });
  var x = r.layers.filter(function (i) { return i.layer === 'xing'; })[0];
  assert.strictEqual(x.checkable, 8, 'v1 因漏掉天芮只认得 7 宫');
  assert.strictEqual(x.count, 8, '该盘八星俱归本位');
});
t('门伏吟／门反吟：休门本位坎一，落离九为反', function () {
  assert.strictEqual(Y.analyze({ chart: fake({ '1': { men: '休门' } }) })._counts['men.fuyin'], 1);
  assert.strictEqual(Y.analyze({ chart: fake({ '9': { men: '休门' } }) })._counts['men.fanyin'], 1);
});
t('中五宫无门，门层不会因中宫产生命中', function () {
  var r = Y.analyze({ chart: fake({ '5': { men: '' } }) });
  assert.strictEqual(r._counts['men.fuyin'], 0);
});
t('无法判定者一律不成立（空字段、生造星名）', function () {
  var r = Y.analyze({ chart: fake({ '1': { xing: '天某', men: '', tianGan: '', diGan: '丙' } }) });
  assert.strictEqual(r.ju.length + r.layers.length, 0);
});

console.log('\n== 局与宫分开 ==');
t('单宫命中只报该层，不升格为全盘', function () {
  var r = Y.analyze({ chart: fake({ '1': { xing: '天蓬' } }), school: 'zhuanpan' });
  assert.strictEqual(r.ju.length, 0);
  assert.strictEqual(r.layers.length, 1);
  assert.strictEqual(r.layers[0].scope, 'partial');
});
t('只有星全伏、门不伏，**不成局**——局须星门俱全', function () {
  var cells = {};
  ['1','2','3','4','6','7','8','9'].forEach(function (g, i) {
    cells[g] = { xing: ['天蓬','天芮','天冲','天辅','天心','天柱','天任','天英'][i] };
  });
  var r = Y.analyze({ chart: fake(cells), school: 'zhuanpan' });
  assert.strictEqual(r.layers.filter(function (i) { return i.scope === 'full'; }).length, 1, '星层成全盘');
  assert.strictEqual(r.ju.length, 0, '门未伏，不得称伏吟局');
});
t('星门俱全盘方成伏吟局', function () {
  var cells = {};
  ['1','2','3','4','6','7','8','9'].forEach(function (g, i) {
    cells[g] = { xing: ['天蓬','天芮','天冲','天辅','天心','天柱','天任','天英'][i],
                 men: ['休门','死门','伤门','杜门','开门','惊门','生门','景门'][i] };
  });
  var r = Y.analyze({ chart: fake(cells), school: 'zhuanpan' });
  assert.strictEqual(r.ju.length, 1);
  assert.strictEqual(r.ju[0].name, '伏吟局');
  assert.strictEqual(r.ju[0].basedOn.length, 2);
});
t('星门俱落对宫方成反吟局', function () {
  var cells = {};
  // 蓬→离9 任→坤2 冲→兑7 辅→乾6 英→坎1 芮→艮8 柱→震3 心→巽4（用户原表）
  var X = { '9':'天蓬','2':'天任','7':'天冲','6':'天辅','1':'天英','8':'天芮','3':'天柱','4':'天心' };
  var M = { '9':'休门','2':'生门','7':'伤门','6':'杜门','1':'景门','8':'死门','3':'惊门','4':'开门' };
  Object.keys(X).forEach(function (g) { cells[g] = { xing: X[g], men: M[g] }; });
  var r = Y.analyze({ chart: fake(cells), school: 'zhuanpan' });
  assert.strictEqual(r.ju.length, 1);
  assert.strictEqual(r.ju[0].name, '反吟局');
});
t('阈值取自规则库而非硬编码', function () {
  assert.strictEqual(Number(RULES.juThreshold), 6);
  assert.ok(RULES._juThresholdWhy && RULES._juThresholdWhy.length > 20, '阈值须附理由');
});

console.log('\n== 两级出处不得混同 ==');
t('干层标【纲要原文】', function () {
  var r = Y.analyze({ chart: fake({ '3': { tianGan: '庚', diGan: '庚' } }), school: 'zhuanpan' });
  assert.strictEqual(r.layers[0].provenance.level, '纲要原文');
});
t('星层与门层标【用户所定】，不冒充纲要', function () {
  assert.strictEqual(Y.analyze({ chart: fake({ '1': { xing: '天蓬' } }) }).layers[0].provenance.level, '用户所定');
  assert.strictEqual(Y.analyze({ chart: fake({ '1': { men: '休门' } }) }).layers[0].provenance.level, '用户所定');
});
t('局本身也标【用户所定】，并写明可回溯重议', function () {
  var r = Y.analyze({ chart: zhuanpan('2026-01-01T15:00:00') });
  assert.strictEqual(r.ju[0].provenance.level, '用户所定');
  assert.ok(/重议|不可诿为纲要/.test(r.ju[0].provenance.text));
});
t('干反吟标明系用户裁定取义，不冒充纯纲要', function () {
  var r = Y.analyze({ chart: fake({ '3': { tianGan: '丙', diGan: '壬' } }), school: 'zhuanpan' });
  var p = r.layers[0].provenance;
  assert.ok(/裁定/.test(p.level + p.text), '「对冲」的取义来自用户裁定，必须写明');
  assert.ok(/引擎/.test(p.text), '须记下与引擎命名不合这一事实，供日后重议');
});
t('排版块把出处逐条带出，不只在抬头写一句', function () {
  var r = Y.analyze({ chart: fake({ '1': { xing: '天蓬' }, '3': { tianGan: '庚', diGan: '庚' } }) });
  var blk = Y.toPromptBlock(r);
  assert.ok(blk.indexOf('〔纲要原文〕') >= 0);
  assert.ok(blk.indexOf('〔用户所定〕') >= 0);
});
t('成局时星门两层不再单列，同一件事不说两遍', function () {
  var blk = Y.toPromptBlock(Y.analyze({ chart: zhuanpan('2026-01-01T15:00:00') }));
  assert.ok(blk.indexOf('伏吟局') >= 0);
  assert.strictEqual((blk.match(/星伏吟（全盘）/g) || []).length, 0, '已并入局就不该再单列一条');
  assert.ok(/星伏吟（8 宫中 8 宫/.test(blk), '但须在「据」里交代它由哪两层构成');
});
t('排版块声明本层不下吉凶断语', function () {
  var r = Y.analyze({ chart: fake({ '1': { xing: '天蓬' } }) });
  assert.ok(/不下吉凶断语/.test(Y.toPromptBlock(r)));
});
t('无命中时排版块为空串，不占证据包篇幅', function () {
  assert.strictEqual(Y.toPromptBlock(Y.analyze({ chart: fake({ '1': { xing: '天某' } }) })), '');
});

console.log('\n== 应期联动 ==');
t('转盘伏吟 → 抬升马星锚点，且注明系纲要原文', function () {
  var r = Y.analyze({ chart: fake({ '3': { tianGan: '庚', diGan: '庚' } }), school: 'zhuanpan' });
  var f = r.timing.filter(function (x) { return x.kind === 'fuyin'; })[0];
  assert.ok(f, '应产生应期联动');
  assert.strictEqual(f.effect, 'raise');
  assert.strictEqual(f.target, '马星发动');
  assert.strictEqual(f.provenanceLevel, '纲要原文');
});
t('飞盘伏吟不抬马星：马星取期之法只见于转盘纲要（零串味）', function () {
  var r = Y.analyze({ chart: fake({ '3': { tianGan: '庚', diGan: '庚' } }), school: 'feipan' });
  assert.strictEqual(r.timing.filter(function (x) { return x.kind === 'fuyin'; }).length, 0);
});
t('反吟只作提示，不改锚点强弱', function () {
  var r = Y.analyze({ chart: fake({ '3': { tianGan: '丙', diGan: '壬' } }), school: 'zhuanpan' });
  var f = r.timing.filter(function (x) { return x.kind === 'fanyin'; })[0];
  assert.strictEqual(f.effect, 'note');
  assert.ok(/速而不久/.test(f.text));
});

console.log('\n== 星门同吟 ==');
t('【对拍】与用户所列十六条逐字硬编的表完全一致', function () {
  var G = { 坎:'1', 坤:'2', 震:'3', 巽:'4', 乾:'6', 兑:'7', 艮:'8', 离:'9' };
  var FANX = { 天蓬:'离', 天任:'坤', 天冲:'兑', 天辅:'乾', 天英:'坎', 天芮:'艮', 天柱:'震', 天心:'巽' };
  var FANM = { 休门:'离', 生门:'坤', 伤门:'兑', 杜门:'乾', 景门:'坎', 死门:'艮', 惊门:'震', 开门:'巽' };
  var FUX  = { 天蓬:'坎', 天任:'艮', 天冲:'震', 天辅:'巽', 天英:'离', 天芮:'坤', 天柱:'兑', 天心:'乾' };
  var FUM  = { 休门:'坎', 生门:'艮', 伤门:'震', 杜门:'巽', 景门:'离', 死门:'坤', 惊门:'兑', 开门:'乾' };
  function alias(x) { x = String(x || ''); return (x === '禽芮' || x === '天禽芮') ? '天芮' : x; }
  function byTable(pan) {
    var jg = pan.jiuGongAnalysis || {}, xf = 0, xr = 0, mf = 0, mr = 0, xn = 0, mn = 0;
    ['1','2','3','4','5','6','7','8','9'].forEach(function (g) {
      var c = jg[g]; if (!c) return;
      var x = alias(c.xing), m = String(c.men || '');
      if (FUX[x]) { xn++; if (G[FUX[x]] === g) xf++; if (G[FANX[x]] === g) xr++; }
      if (FUM[m]) { mn++; if (G[FUM[m]] === g) mf++; if (G[FANM[m]] === g) mr++; }
    });
    return { fu: xn > 0 && mn > 0 && xf === xn && mf === mn,
             fan: xn > 0 && mn > 0 && xr === xn && mr === mn, xf: xf, xr: xr, mf: mf, mr: mr };
  }
  var t0 = new Date('2026-01-01T00:00:00').getTime(), n = 0, bad = 0;
  for (var i = 0; i < 500; i++) {
    [['zhuanpan', zhuanpan], ['feipan', feipan]].forEach(function (pair) {
      var p = pair[1](new Date(t0 + i * 3600 * 1000 * 3).toISOString());
      if (!p || p.error) return;
      n++;
      var w = byTable(p), r = Y.analyze({ chart: p, school: pair[0] });
      if (r.ju.some(function (j) { return j.kind === 'fuyin'; }) !== w.fu) bad++;
      else if (r.ju.some(function (j) { return j.kind === 'fanyin'; }) !== w.fan) bad++;
      else if (r._counts['xing.fuyin'] !== w.xf || r._counts['xing.fanyin'] !== w.xr) bad++;
      else if (r._counts['men.fuyin'] !== w.mf || r._counts['men.fanyin'] !== w.mr) bad++;
    });
  }
  assert.ok(n > 500, '样本足够，实得 ' + n);
  assert.strictEqual(bad, 0, n + ' 盘中有 ' + bad + ' 盘与用户原表不符');
});

console.log('\n== 两派与确定性 ==');
t('两派都能判，且各自标出所属', function () {
  assert.strictEqual(Y.analyze({ chart: zhuanpan('2026-01-01T15:00:00') }).school, 'zhuanpan');
  assert.strictEqual(Y.analyze({ chart: feipan('2026-01-01T15:00:00') }).school, 'feipan');
});
t('同盘两次分析结果完全一致（确定性）', function () {
  var p = zhuanpan('2026-01-01T15:00:00');
  assert.strictEqual(JSON.stringify(Y.analyze({ chart: p })), JSON.stringify(Y.analyze({ chart: p })));
});
t('实盘：2026-01-01 15:00 判为伏吟局，星门各 8 宫中 8 宫', function () {
  var r = Y.analyze({ chart: zhuanpan('2026-01-01T15:00:00') });
  assert.strictEqual(r.ju.map(function (i) { return i.name; }).join(','), '伏吟局');
  r.ju[0].basedOn.forEach(function (b) {
    assert.strictEqual(b.count, 8, b.name + ' 应中 8 宫，实得 ' + b.count);
    assert.strictEqual(b.checkable, 8);
  });
});
t('实盘：2026-01-07 18:00 判为反吟局', function () {
  var r = Y.analyze({ chart: zhuanpan('2026-01-07T18:00:00') });
  assert.strictEqual(r.ju.map(function (i) { return i.name; }).join(','), '反吟局');
});
t('伏吟与反吟不会在同一层同时成局', function () {
  var t0 = new Date('2026-05-01T00:00:00').getTime(), bad = 0;
  for (var i = 0; i < 200; i++) {
    var p = QM.qimen.calculate(new Date(t0 + i * 3600 * 1000 * 5),
      { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
    if (!p || p.error) continue;
    var r = Y.analyze({ chart: p });
    ['xing', 'men'].forEach(function (L) {
      var f = r.layers.some(function (x) { return x.layer === L && x.kind === 'fuyin' && x.scope === 'full'; });
      var n = r.layers.some(function (x) { return x.layer === L && x.kind === 'fanyin' && x.scope === 'full'; });
      if (f && n) bad++;
    });
  }
  assert.strictEqual(bad, 0);
});


/* ---------- 与证据包、应期层的接线 ---------- */
var EV = require('./evidence.js');
var TM = require('./timing.js');
var YQ = require('./yingqi.js');
EV.load(require('../knowledge/symbols.json'));
TM.load(require('../knowledge/timing-rules.json'));

console.log('\n== 接入证据包 ==');
t('证据包带出伏吟块，且两级出处都在', function () {
  var p = zhuanpan('2026-01-01T15:00:00');
  var yj = Y.analyze({ chart: p });
  var blk = EV.toPromptBlock(EV.build({ chart: p, school: 'zhuanpan', domain: 'general', yinju: yj }));
  assert.ok(blk.indexOf('【伏吟／反吟·先看这一段】') >= 0, '伏吟块应出现在证据包里');
  assert.ok(blk.indexOf('〔纲要原文〕') >= 0, '干层出处');
  assert.ok(blk.indexOf('〔用户所定〕') >= 0, '星门层出处');
});
t('伏吟块排在 FACT 之前——排在包尾等于没有', function () {
  var p = zhuanpan('2026-01-01T15:00:00');
  var blk = EV.toPromptBlock(EV.build({ chart: p, school: 'zhuanpan', domain: 'general', yinju: Y.analyze({ chart: p }) }));
  var iY = blk.indexOf('【伏吟／反吟·先看这一段】'), iF = blk.indexOf('· FACT（');
  assert.ok(iY >= 0 && iF >= 0 && iY < iF, '伏吟块位次 ' + iY + ' 应小于 FACT 位次 ' + iF);
});
t('无伏吟反吟之盘不产生空块，不占篇幅', function () {
  var chart = fake({ '1': { xing: '天某' } });
  var blk = EV.toPromptBlock(EV.build({ chart: chart, school: 'zhuanpan', domain: 'general', yinju: Y.analyze({ chart: chart }) }));
  assert.strictEqual(blk.indexOf('【伏吟／反吟'), -1);
});
t('不传 yinju 时证据包行为不变（向后兼容）', function () {
  var p = zhuanpan('2026-01-01T15:00:00');
  var blk = EV.toPromptBlock(EV.build({ chart: p, school: 'zhuanpan', domain: 'general' }));
  assert.strictEqual(blk.indexOf('【伏吟／反吟'), -1);
});
t('局与宫在证据包里分列，单宫不得冒充全盘', function () {
  // 需一张真盘：EV.toPromptBlock 在 items 为空时直接返回空串，假盘凑不出 items
  var t0 = new Date('2026-01-01T00:00:00').getTime(), p = null;
  for (var i = 0; i < 800 && !p; i++) {
    var c = zhuanpan(new Date(t0 + i * 3600 * 1000 * 3).toISOString());
    if (!c || c.error) continue;
    var r = Y.analyze({ chart: c });
    // 要的是「星或门有命中但未成局」之盘；只有干层命中的不算——干层本就不参与局
    if (!r.ju.length && r.layers.some(function (x) {
      return (x.layer === 'xing' || x.layer === 'men');
    })) p = c;
  }
  assert.ok(p, '八百盘内未找到「星门有命中但未成局」之盘');
  var blk = EV.toPromptBlock(EV.build({ chart: p, school: 'zhuanpan', domain: 'general', yinju: Y.analyze({ chart: p }) }));
  assert.ok(/不得以局论/.test(blk), '星门未成局者须带此告诫');
  assert.ok(/干加干之格（\*\*不参与局的判定\*\*/.test(blk) || blk.indexOf('干加干之格') < 0,
    '干层若列出，须说明它不参与局，不可与「未成局」混为一谈');
  assert.strictEqual(blk.indexOf('（全盘之象，笼罩通篇）'), -1, '未成局就不该出现成局小节');
});

console.log('\n== 接入应期：伏吟抬升马星 ==');
var XY = require('./xiangyi.js');
XY.load(require('../knowledge/domain-rules.json'));
/* 必须连 xiangyi 一起传：应期锚点的强弱＝「机制与用神的关系」，不传象义就没有用神宫，
   全盘锚点一律 low，medium→high 的升格自然无从发生——那样测出来的「没升」是假绿。 */
function timingFor(iso, withYinju, domain) {
  var p = zhuanpan(iso);
  var xy = XY.analyze({ chart: p, domain: domain || 'lost_item', school: 'zhuanpan' });
  var args = { chart: p, yingqi: YQ.analyze(p), xiangyi: xy,
    options: { school: 'zhuanpan', domain: domain || 'lost_item' } };
  if (withYinju) args.yinju = Y.analyze({ chart: p });
  return TM.analyze(args);
}
t('传入伏吟后，落用神宫的马星锚点由中升为高', function () {
  // 扫出一张「见伏吟 且 马星落用神宫」的盘，若全无则本测无从验证，应显式失败
  var t0 = new Date('2026-01-01T00:00:00').getTime(), found = null;
  for (var i = 0; i < 800 && !found; i++) {
    var iso = new Date(t0 + i * 3600 * 1000 * 3).toISOString();
    var a = timingFor(iso, false), b = timingFor(iso, true);
    var ma = a.anchors.filter(function (x) { return x.mechanism === '马星'; })[0];
    var mb = b.anchors.filter(function (x) { return x.mechanism === '马星'; })[0];
    if (ma && mb && ma.strength === 'medium' && mb.strength === 'high') found = { iso: iso, a: ma, b: mb };
  }
  assert.ok(found, '八百盘内未找到「伏吟且马星临用神宫」之盘，此接线无从验证');
  assert.ok(/伏吟主静/.test(found.b.raisedBy), '升格必须写明缘由，实得：' + found.b.raisedBy);
});
t('不见伏吟之盘，马星不被抬升', function () {
  var t0 = new Date('2026-02-01T00:00:00').getTime(), checked = 0;
  for (var i = 0; i < 400; i++) {
    var iso = new Date(t0 + i * 3600 * 1000 * 3).toISOString();
    var p = zhuanpan(iso);
    var yj = Y.analyze({ chart: p });
    if (yj.layers.some(function (x) { return x.kind === 'fuyin'; })) continue;
    var r = TM.analyze({ chart: p, yingqi: YQ.analyze(p), yinju: yj,
      xiangyi: XY.analyze({ chart: p, domain: 'lost_item', school: 'zhuanpan' }),
      options: { school: 'zhuanpan', domain: 'lost_item' } });
    r.anchors.forEach(function (x) {
      if (x.mechanism === '马星') { checked++; assert.notStrictEqual(x.strength, 'high', '无伏吟却抬升了'); }
    });
  }
  assert.ok(checked > 0, '应至少验到若干马星锚点');
});
t('伏吟只抬马星，不碰其余机制', function () {
  var t0 = new Date('2026-01-01T00:00:00').getTime();
  for (var i = 0; i < 200; i++) {
    var iso = new Date(t0 + i * 3600 * 1000 * 3).toISOString();
    var a = timingFor(iso, false), b = timingFor(iso, true);
    var ka = a.anchors.filter(function (x) { return x.mechanism !== '马星'; })
      .map(function (x) { return x.id + '/' + x.strength; }).join(',');
    var kb = b.anchors.filter(function (x) { return x.mechanism !== '马星'; })
      .map(function (x) { return x.id + '/' + x.strength; }).join(',');
    assert.strictEqual(kb, ka, iso + ' 的非马星锚点被改动了');
  }
});
t('不传 yinju 时应期层行为不变（向后兼容）', function () {
  var iso = '2026-01-01T15:00:00';
  var p = zhuanpan(iso);
  var plain = TM.analyze({ chart: p, yingqi: YQ.analyze(p),
    xiangyi: XY.analyze({ chart: p, domain: 'lost_item', school: 'zhuanpan' }),
    options: { school: 'zhuanpan', domain: 'lost_item' } });
  assert.ok(plain.anchors.every(function (x) { return !x.raisedBy; }), '未传伏吟不该出现升格标记');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
