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
  assert.strictEqual(r.ju.length, 0);
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
    r.ju.concat(r.gong).forEach(function (it) {
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
t('天禽寄芮：「禽芮」归一为天禽，本位中五，恒不命中', function () {
  assert.strictEqual(Y._internals.normXing('禽芮'), '天禽');
  var r = Y.analyze({ chart: fake({ '2': { xing: '禽芮' } }), school: 'zhuanpan' });
  assert.strictEqual(r._counts['xing.fuyin'], 0);
  assert.strictEqual(r._counts['xing.fanyin'], 0);
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
  assert.strictEqual(r.ju.length + r.gong.length, 0);
});

console.log('\n== 局与宫分开 ==');
t('单宫命中报「宫」，不升格为全盘', function () {
  var r = Y.analyze({ chart: fake({ '1': { xing: '天蓬' } }), school: 'zhuanpan' });
  assert.strictEqual(r.ju.length, 0);
  assert.strictEqual(r.gong.length, 1);
  assert.strictEqual(r.gong[0].scope, 'gong');
});
t('达阈值报「局」', function () {
  var cells = { '1': { xing: '天蓬' }, '2': { xing: '天芮' }, '3': { xing: '天冲' },
                '4': { xing: '天辅' }, '6': { xing: '天心' }, '7': { xing: '天柱' } };
  var r = Y.analyze({ chart: fake(cells), school: 'zhuanpan' });
  assert.strictEqual(r.ju.length, 1);
  assert.strictEqual(r.ju[0].scope, 'ju');
  assert.strictEqual(r.ju[0].count, 6);
});
t('阈值取自规则库而非硬编码', function () {
  assert.strictEqual(Number(RULES.juThreshold), 6);
  assert.ok(RULES._juThresholdWhy && RULES._juThresholdWhy.length > 20, '阈值须附理由');
});

console.log('\n== 两级出处不得混同 ==');
t('干层标【纲要原文】', function () {
  var r = Y.analyze({ chart: fake({ '3': { tianGan: '庚', diGan: '庚' } }), school: 'zhuanpan' });
  assert.strictEqual(r.gong[0].provenance.level, '纲要原文');
});
t('星层与门层标【非本纲要·通行法】', function () {
  var rx = Y.analyze({ chart: fake({ '1': { xing: '天蓬' } }) });
  var rm = Y.analyze({ chart: fake({ '1': { men: '休门' } }) });
  assert.strictEqual(rx.gong[0].provenance.level, '非本纲要·通行法');
  assert.strictEqual(rm.gong[0].provenance.level, '非本纲要·通行法');
});
t('干反吟标明系用户裁定取义，不冒充纯纲要', function () {
  var r = Y.analyze({ chart: fake({ '3': { tianGan: '丙', diGan: '壬' } }), school: 'zhuanpan' });
  var p = r.gong[0].provenance;
  assert.ok(/裁定/.test(p.level + p.text), '「对冲」的取义来自用户裁定，必须写明');
  assert.ok(/引擎/.test(p.text), '须记下与引擎命名不合这一事实，供日后重议');
});
t('排版块把出处逐条带出，不只在抬头写一句', function () {
  var r = Y.analyze({ chart: fake({ '1': { xing: '天蓬' }, '3': { tianGan: '庚', diGan: '庚' } }) });
  var blk = Y.toPromptBlock(r);
  assert.ok(blk.indexOf('〔纲要原文〕') >= 0);
  assert.ok(blk.indexOf('〔非本纲要·通行法〕') >= 0);
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
t('星门俱成局才报同吟，只成一层不报', function () {
  var only = {};
  ['1','2','3','4','6','7','8','9'].forEach(function (g, i) {
    only[g] = { xing: ['天蓬','天芮','天冲','天辅','天心','天柱','天任','天英'][i] };
  });
  var r1 = Y.analyze({ chart: fake(only), school: 'zhuanpan' });
  assert.strictEqual(r1.combos.length, 0, '只有星伏吟，不该报星门同吟');
  ['1','2','3','4','6','7','8','9'].forEach(function (g, i) {
    only[g].men = ['休门','死门','伤门','杜门','开门','惊门','生门','景门'][i];
  });
  var r2 = Y.analyze({ chart: fake(only), school: 'zhuanpan' });
  assert.strictEqual(r2.combos.length, 1);
  assert.ok(/星门同吟（伏）/.test(r2.combos[0].name));
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
t('实盘：星门皆伏吟之盘确被判出，且干层同时成局', function () {
  var r = Y.analyze({ chart: zhuanpan('2026-01-01T15:00:00') });
  var names = r.ju.map(function (i) { return i.name; }).sort().join(',');
  assert.strictEqual(names, '干伏吟,星伏吟,门伏吟', '实得：' + names);
  assert.strictEqual(r.ju.filter(function (i) { return i.name === '星伏吟'; })[0].count, 7,
    '天禽寄芮不占宫，故八宫中命中七宫');
});
t('实盘：星门皆反吟之盘确被判出', function () {
  var r = Y.analyze({ chart: zhuanpan('2026-01-07T18:00:00') });
  var names = r.ju.map(function (i) { return i.name; }).sort().join(',');
  assert.ok(/星反吟/.test(names) && /门反吟/.test(names), '实得：' + names);
});
t('伏吟与反吟不会在同一层同时成局', function () {
  var t0 = new Date('2026-05-01T00:00:00').getTime(), bad = 0;
  for (var i = 0; i < 200; i++) {
    var p = QM.qimen.calculate(new Date(t0 + i * 3600 * 1000 * 5),
      { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
    if (!p || p.error) continue;
    var r = Y.analyze({ chart: p });
    ['xing', 'men'].forEach(function (L) {
      var f = r.ju.some(function (x) { return x.layer === L && x.kind === 'fuyin'; });
      var n = r.ju.some(function (x) { return x.layer === L && x.kind === 'fanyin'; });
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
  assert.ok(blk.indexOf('〔非本纲要·通行法〕') >= 0, '星门层出处');
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
    if (!r.ju.length && r.gong.length) p = c;   // 只有逐宫、未成局
  }
  assert.ok(p, '八百盘内未找到「只有逐宫命中、未成局」之盘');
  var blk = EV.toPromptBlock(EV.build({ chart: p, school: 'zhuanpan', domain: 'general', yinju: Y.analyze({ chart: p }) }));
  assert.ok(/不得当作全盘之象/.test(blk), '逐宫条目须带此告诫');
  assert.strictEqual(blk.indexOf('成局（全盘之象'), -1, '未成局就不该出现成局小节');
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
    if (yj.ju.concat(yj.gong).some(function (x) { return x.kind === 'fuyin'; })) continue;
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
