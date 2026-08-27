/**
 * Phase 16 时格层（五不遇时 / 天显时格）回归测试（纯 Node，无框架）。
 * 运行：node core/shige.test.js
 *
 * 锁定的约定：
 *   ① 五不遇时按定义现算，且必须与传统所列十组完全吻合；
 *   ② 天显时格是**最弱一档**——用户原话「吉的几率不显着」，不得被日后调重；
 *   ③ 这不是禁令层，措辞里不许出现硬约束口吻；
 *   ④ 效应未测，任何地方都不得声称此类盘更准／更不准。
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var S = require('./shige.js');
var DB = require('../knowledge/shige-rules.json');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
var GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
function chartAt(iso, feipan) {
  return feipan
    ? QM.feipanQimen.calculate(new Date(iso), { method: '时家', purpose: '综合' })
    : QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
}
function fake(day, time) { return { siZhu: { day: day, time: time } }; }

console.log('\n== 加载与边界 ==');
S.load(DB);
t('规则库能加载', function () { assert.strictEqual(S.isLoaded(), true); });
t('无四柱时如实说明，不臆造', function () {
  var r = S.analyze({ chart: {} });
  assert.strictEqual(r.hits.length, 0);
  assert.ok(/无从判起/.test(r.notes.join('')));
});
t('未加载时只声明跳过，不抛异常', function () {
  var S2 = require('./shige.js');
  assert.strictEqual(S2.load({}), false);
  assert.ok(/未加载/.test(S2.analyze({ chart: fake('乙亥', '辛巳') }).notes.join('')));
  S2.load(DB);
});

console.log('\n== 五不遇时：时干克日干且阴阳同性 ==');
t('十干各推出且仅推出一个时干', function () {
  GAN.forEach(function (ri) {
    var hits = GAN.filter(function (shi) { return S._internals.isWuBuYu(ri, shi); });
    assert.strictEqual(hits.length, 1, '日' + ri + ' 推出 ' + hits.length + ' 个：' + hits.join('/'));
  });
});
t('与传统所列十组完全吻合（甲庚 乙辛 丙壬 丁癸 戊甲 己乙 庚丙 辛丁 壬戊 癸己）', function () {
  var want = { 甲: '庚', 乙: '辛', 丙: '壬', 丁: '癸', 戊: '甲', 己: '乙', 庚: '丙', 辛: '丁', 壬: '戊', 癸: '己' };
  GAN.forEach(function (ri) {
    var got = GAN.filter(function (shi) { return S._internals.isWuBuYu(ri, shi); })[0];
    assert.strictEqual(got, want[ri], '日' + ri + ' 应为时' + want[ri] + '，实得时' + got);
  });
});
t('规则库里的对照表与现算结果一致（表只作校验，实现不据表查）', function () {
  Object.keys(DB.checks.wubuyu.pairs).forEach(function (ri) {
    assert.strictEqual(S._internals.isWuBuYu(ri, DB.checks.wubuyu.pairs[ri]), true, ri);
  });
});
t('阴阳不同性者不算：如日甲(阳木)遇时辛(阴金)，虽克而不成格', function () {
  assert.strictEqual(S._internals.isWuBuYu('甲', '辛'), false);
  assert.strictEqual(S._internals.isWuBuYu('乙', '庚'), false);
});
t('生我、我生、同类一概不算', function () {
  assert.strictEqual(S._internals.isWuBuYu('甲', '壬'), false, '水生木，非克');
  assert.strictEqual(S._internals.isWuBuYu('甲', '丙'), false, '木生火，非克');
  assert.strictEqual(S._internals.isWuBuYu('甲', '甲'), false, '同类不自克');
});
t('实盘取样：乙亥日辛巳时确为五不遇时', function () {
  var r = S.analyze({ chart: fake('乙亥', '辛巳') });
  assert.strictEqual(r.hits.length, 1);
  assert.strictEqual(r.hits[0].name, '五不遇时');
});

console.log('\n== 天显时格：时干与日干相同 ==');
t('十干各自成格', function () {
  GAN.forEach(function (g) { assert.strictEqual(S._internals.isTianXian(g, g), true, g); });
});
t('不同即不成', function () {
  assert.strictEqual(S._internals.isTianXian('甲', '乙'), false);
});
t('实盘取样：乙亥日乙酉时确为天显时格', function () {
  var r = S.analyze({ chart: fake('乙亥', '乙酉') });
  assert.strictEqual(r.hits[0].name, '天显时格');
});
t('【分量】天显时格必须是最弱一档——用户原话「吉的几率不显着」', function () {
  assert.strictEqual(DB.checks.tianxian.strength, 'weak');
  assert.ok(/不显/.test(DB.checks.tianxian.meaning), '义里须保留「不显著」');
  assert.ok(/不得据此加重吉断/.test(DB.checks.tianxian.howToUse));
  assert.ok(/不显着.*用户原话|用户原话.*不显着/.test(DB.checks.tianxian.provenance.text),
    '须记明此分量出自用户原话，防日后被悄悄调重');
});
t('排版块把「分量很轻」写在明面上', function () {
  var blk = S.toPromptBlock(S.analyze({ chart: fake('乙亥', '乙酉') }));
  assert.ok(/分量很轻/.test(blk));
  assert.ok(/不得据此加重吉断/.test(blk));
});

console.log('\n== 两格互斥 ==');
t('一干不能自克，故两格绝不同时成立', function () {
  GAN.forEach(function (ri) {
    GAN.forEach(function (shi) {
      assert.ok(!(S._internals.isWuBuYu(ri, shi) && S._internals.isTianXian(ri, shi)),
        ri + '日' + shi + '时 竟同时成两格');
    });
  });
});
t('实盘扫描 2000 时辰，从未同时命中', function () {
  var t0 = new Date('2026-01-01T00:00:00').getTime(), n = 0, both = 0, wu = 0, tx = 0;
  for (var i = 0; i < 2000; i++) {
    var p = chartAt(new Date(t0 + i * 3600 * 1000 * 2).toISOString());
    if (!p || p.error || !p.siZhu) continue;
    n++;
    var r = S.analyze({ chart: p });
    if (r.hits.length > 1) both++;
    r.hits.forEach(function (h) { if (h.id === 'wubuyu') wu++; else tx++; });
  }
  assert.ok(n > 1500, '样本足够，实得 ' + n);
  assert.strictEqual(both, 0);
  // 各约一成：十干各配一个时干，12 时辰里遇 1~2 次
  assert.ok(wu / n > 0.05 && wu / n < 0.16, '五不遇时发生率 ' + (100 * wu / n).toFixed(1) + '% 不合常理');
  assert.ok(tx / n > 0.05 && tx / n < 0.16, '天显时格发生率 ' + (100 * tx / n).toFixed(1) + '%');
});

console.log('\n== 不是禁令层，效应未测 ==');
t('措辞不得出现禁令口吻（那是 severity 层的性质）', function () {
  var blk = S.toPromptBlock(S.analyze({ chart: fake('乙亥', '辛巳') }));
  assert.ok(/不是禁令/.test(blk), '须明写这不是禁令');
  assert.ok(!/必不成|必然|一律不得断/.test(blk.replace(/不等于此事必不成/g, '')),
    '不许出现「必然如此」的口吻');
});
t('明写效应未测，不得声称此类盘更准或更不准', function () {
  var blk = S.toPromptBlock(S.analyze({ chart: fake('乙亥', '辛巳') }));
  assert.ok(/从未测过/.test(blk) && /更准／更不准|更准|更不准/.test(blk));
  assert.ok(DB._measured._effectNotMeasured && /尚无数据/.test(DB._measured._effectNotMeasured));
});
t('未擅造解法——用户此次未给', function () {
  var s = JSON.stringify(DB);
  assert.ok(/宁缺勿造/.test(s) || /不写任何解法/.test(s), '须记明为何没有解法');
  assert.ok(!/可用三奇解|得值符可解/.test(s), '不得凭记忆补一套解法');
});
t('出处标【用户所定】，两格皆然', function () {
  assert.strictEqual(DB.checks.wubuyu.provenance.level, '用户所定');
  assert.strictEqual(DB.checks.tianxian.provenance.level, '用户所定');
  assert.ok(/不可诿为纲要/.test(DB.checks.wubuyu.provenance.text));
});

console.log('\n== 两派与确定性 ==');
t('飞盘同样判得出（判据是四柱，与派别无关）', function () {
  var f = chartAt('2026-08-27T10:00:00', true);
  assert.ok(f.siZhu && f.siZhu.day, '飞盘有四柱');
  var r = S.analyze({ chart: f });
  assert.strictEqual(r.riGan, String(f.siZhu.day).charAt(0));
});
t('同盘两次结果逐字相同', function () {
  var p = chartAt('2026-01-01T15:00:00');
  assert.strictEqual(JSON.stringify(S.analyze({ chart: p })), JSON.stringify(S.analyze({ chart: p })));
});
t('无命中时排版块为空串，不占证据包篇幅', function () {
  assert.strictEqual(S.toPromptBlock(S.analyze({ chart: fake('甲子', '乙丑') })), '');
});

console.log('\n== 接入证据包 ==');
var EV = require('./evidence.js');
EV.load(require('../knowledge/symbols.json'));
t('时格块进入证据包，并排在 FACT 之前', function () {
  var p = chartAt('2026-01-01T15:00:00');
  // 造一张必中五不遇时的盘：直接改四柱不动其余
  var c = Object.assign({}, p, { siZhu: Object.assign({}, p.siZhu, { day: '乙亥', time: '辛巳' }) });
  var blk = EV.toPromptBlock(EV.build({ chart: c, school: 'zhuanpan', domain: 'general', shige: S.analyze({ chart: c }) }));
  var i1 = blk.indexOf('【时格】'), i2 = blk.indexOf('· FACT（');
  assert.ok(i1 >= 0, '时格块应出现在证据包里');
  assert.ok(i2 >= 0 && i1 < i2, '位次 ' + i1 + ' 应早于 FACT 的 ' + i2);
});
t('证据包里保留「不是禁令」与「效应未测」两句', function () {
  var p = chartAt('2026-01-01T15:00:00');
  var c = Object.assign({}, p, { siZhu: Object.assign({}, p.siZhu, { day: '乙亥', time: '辛巳' }) });
  var blk = EV.toPromptBlock(EV.build({ chart: c, school: 'zhuanpan', domain: 'general', shige: S.analyze({ chart: c }) }));
  assert.ok(/不是禁令/.test(blk));
  assert.ok(/从未测过/.test(blk));
});
t('不传 shige 时证据包行为不变（向后兼容）', function () {
  var blk = EV.toPromptBlock(EV.build({ chart: chartAt('2026-01-01T15:00:00'), school: 'zhuanpan', domain: 'general' }));
  assert.strictEqual(blk.indexOf('【时格】'), -1);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
