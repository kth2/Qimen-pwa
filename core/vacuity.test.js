/**
 * Phase 21b 虚克 与 天辅去向 回归测试（纯 Node，无框架）。
 * 运行：node core/vacuity.test.js
 *
 * 两条都出自 2026-09-03 的同一次复盘（高考分数：断 560～580，实际 620）：
 *
 *   ① **虚克**——当时断语说「4 宫克 5 宫，直接压制分数突破空间、封死上限」。
 *      而 4 宫力量只有 0.03（夏木休囚 + 天地盘壬皆入墓皆击刑）。宫际关系此前
 *      **只判五行、不问施方有没有那个力气**：力量 0.03 的宫去克，与力量 1.0 的宫
 *      去克，读出来分量一模一样。
 *
 *   ② **天辅去向**——当时只把天辅当分数的助阻读，漏了它对学校性质与方位的对应。
 *      实际考上师范（天辅主文教，象中了），方位则在震三而天辅在巽四（邻宫，**没中**）。
 *
 * 本文件同时钉住两个方向：虚克要减得下去，也不许被拿去把凶断翻成吉断；
 * 天辅去向要出得来，也不许把邻宫算成命中。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var WS = require('./wangshuai.js');
var XY = require('./xiangyi.js');
var YS = require('./yongshen.js');
var EV = require('./evidence.js');
var RULES = require('../knowledge/domain-rules.json');
XY.load(RULES); YS.load(require('../knowledge/domains.json')); EV.load(require('../knowledge/symbols.json'));

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function zp(iso) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
}
function run(p, domain) {
  return XY.analyze({ chart: p, domain: domain || 'study', wangshuai: WS.analyze(p), options: { school: 'zhuanpan' } });
}
var VA = RULES.vacuousActor;

console.log('\n== 虚克：配置本身 ==');
t('阈值与 severity 同源同值，两处不得各定一套', function () {
  var SEV = require('../knowledge/severity-rules.json');
  assert.strictEqual(VA.thresholds.critical, SEV.thresholds.critical);
  assert.strictEqual(VA.thresholds.weak, SEV.thresholds.weak);
});
t('施方判定：我克/我生取 from，被克/被生取 to；比和同宫相冲无施方', function () {
  assert.strictEqual(VA.actorOf.from_ke_to, 'from');
  assert.strictEqual(VA.actorOf.from_sheng_to, 'from');
  assert.strictEqual(VA.actorOf.to_ke_from, 'to');
  assert.strictEqual(VA.actorOf.to_sheng_from, 'to');
  ['same_gong', 'same_element', 'chong'].forEach(function (k) {
    assert.strictEqual(VA.actorOf[k], undefined, k + ' 无单一施方，不该配施方');
  });
});
t('出处标用户所定并注明是「据纲要推」的一步，不冒充纲要原文', function () {
  assert.ok(/〔用户所定·\d{4}-\d{2}-\d{2}/.test(VA.basis));
  assert.ok(/纲要未明言|不冒充原文/.test(VA.basis), '须自陈纲要未明言');
});
t('用法双向写死：减的只是这一路，不许反过来翻成吉断', function () {
  assert.ok(/不得.*直接压制|不得.*封死/.test(VA.howToUse), '须禁止「直接压制/封死上限」');
  assert.ok(/不是把凶断翻成吉断/.test(VA.howToUse), '须堵住反向滥用');
});
t('明写效应未测——虚克折减能不能提高准头，本仓无数据', function () {
  assert.ok(/无数据/.test(VA._notMeasured));
});

console.log('\n== 虚克：真的会标出来 ==');
function relsOf(r) { return (r.relations || []); }
t('施方极衰时，该路生克带上 vacuity 并注明力量与所犯之害', function () {
  var found = null;
  for (var i = 0; i < 400 && !found; i++) {
    var p = QM.qimen.calculate(new Date(2026, 0, 1 + i, (i * 7) % 24, 0, 0),
      { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
    relsOf(run(p)).forEach(function (rl) { if (rl.vacuity && !found) found = { rl: rl, pan: p }; });
  }
  assert.ok(found, '400 张盘里应至少遇上一次施方极衰的生克');
  var v = found.rl.vacuity;
  assert.ok(['critical', 'weak'].indexOf(v.level) >= 0);
  assert.ok(typeof v.power === 'number' && v.power <= VA.thresholds.weak, '力量须确实在阈值内：' + v.power);
  assert.strictEqual(v.gong, v.side === 'from' ? found.rl.fromGong : found.rl.toGong, '施方宫取错了边');
  assert.ok(v.label && v.howToUse && v.basis, '标注须自带用法与出处');
});
t('施方有力时不标——null 与「已判定为有力」不可混为一谈', function () {
  var seen = 0, marked = 0;
  for (var i = 0; i < 200; i++) {
    var p = QM.qimen.calculate(new Date(2026, 3, 1 + i, (i * 5) % 24, 0, 0),
      { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
    var ws = WS.analyze(p);
    relsOf(run(p)).forEach(function (rl) {
      var side = VA.actorOf[rl.relation];
      if (!side) { assert.strictEqual(rl.vacuity, null, '无施方之关系不得标虚实'); return; }
      seen++;
      var cell = ws.gongs[side === 'from' ? rl.fromGong : rl.toGong];
      if (cell.power > VA.thresholds.weak) assert.strictEqual(rl.vacuity, null, '施方有力却标了虚');
      else marked++;
    });
  }
  assert.ok(seen > 0 && marked > 0, '样本里应同时有标与不标两种：seen=' + seen + ' marked=' + marked);
});
t('比和/同宫/相冲一律不判虚实（无单一施方）', function () {
  for (var i = 0; i < 150; i++) {
    var p = QM.qimen.calculate(new Date(2026, 6, 1 + i, (i * 3) % 24, 0, 0),
      { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
    relsOf(run(p)).forEach(function (rl) {
      if (['same_gong', 'same_element', 'chong'].indexOf(rl.relation) >= 0) {
        assert.strictEqual(rl.vacuity, null, rl.relation + ' 不该带虚实');
      }
    });
  }
});
t('单象与组合不带 vacuity——那是宫际关系才有的东西', function () {
  var p = zp('2026-06-07T09:30:00');
  var r = run(p);
  (r.readings || []).forEach(function (x) { assert.ok(!x.vacuity, '单象不该有 vacuity'); });
  (r.combinations || []).forEach(function (x) { assert.ok(!x.vacuity, '组合不该有 vacuity'); });
});

console.log('\n== 虚克：进得了证据包与提示词 ==');
t('证据包把「施方力量仅 x、此路作虚读」写在那一条判读后面', function () {
  var hit = null;
  for (var i = 0; i < 400 && !hit; i++) {
    var p = QM.qimen.calculate(new Date(2026, 0, 1 + i, (i * 7) % 24, 0, 0),
      { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
    var xy = run(p);
    if (relsOf(xy).some(function (rl) { return !!rl.vacuity; })) hit = { p: p, xy: xy };
  }
  assert.ok(hit, '未找到样本');
  var b = EV.toPromptBlock(EV.build({
    question: '高考能考多少分', domain: 'study', chart: hit.p,
    yongshen: YS.resolve({ domain: 'study', chart: hit.p, options: { school: 'zhuanpan' } }),
    xiangyi: hit.xy
  }));
  assert.ok(/施方.*力量仅/.test(b), '证据包须写出施方力量');
  assert.ok(/虚|力薄/.test(b), '须给出虚/力薄的读法');
  assert.ok(/〔出处：〔用户所定/.test(b), '须随条带出处');
});
t('E27 已进系统提示词，且双向都堵住了', function () {
  var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/E27\./.test(APP));
  var seg = APP.slice(APP.indexOf('E27.'), APP.indexOf('E20.'));
  assert.ok(/直接压制|封死上限/.test(seg), '须点名要禁的那几句话');
  assert.ok(/不许反过来|不等于此事转吉/.test(seg), '须堵住反向滥用');
  assert.ok(/不得说成纲要明文/.test(seg), '须点明这是推的一步');
});

console.log('\n== 天辅去向：漏读的那一路 ==');
var TF = RULES.domains.study.conditions.filter(function (c) { return c.id === 'study.天辅.去向'; })[0];
t('条目在案，且只答去向不答分数', function () {
  assert.ok(TF, 'study.天辅.去向 未建');
  assert.strictEqual(TF.polarity, '0', '去向不是助也不是阻');
  assert.ok(/只答去向/.test(TF.answersNote));
  assert.ok(/不答分数/.test(TF.answersNote), '须明写不答分数高低');
});
t('中五宫不触发——那里本就无方位可断，写进触发条件而非只写在叮嘱里', function () {
  assert.deepStrictEqual(TF.when.gong, ['1', '2', '3', '4', '6', '7', '8', '9']);
});
t('休囚入墓击刑只减得力与否，不改去向所指', function () {
  assert.ok(/不改去向所指/.test(TF.answersNote));
});
t('方位断正位，邻宫不算命中——那一例巽四对震三就是断错了', function () {
  assert.ok(/邻宫不算命中/.test(TF.answersNote));
  assert.ok(/巽四|东南.*东/.test(TF.answersNote), '须把那一例的实情写进去');
  assert.ok(/不得事后说/.test(TF.answersNote), '须堵住事后圆成命中');
});
t('性质与方位分开认账，可以只中一路', function () {
  assert.ok(/分开陈述、分开认账/.test(TF.answersNote));
});
t('出处标用户所定；纲要来的材料另立一栏，不写进 basis 充背书', function () {
  assert.ok(TF.basis.indexOf('〔用户所定·2026-09-03〕') === 0);
  assert.ok(!/纲要·/.test(TF.basis), 'basis 不得引纲要作依据');
  assert.ok(/纲要·四节九星/.test(TF._ingredients), '材料出处应记在 _ingredients');
  assert.ok(/断法不是|纲要无此条/.test(TF._ingredients), '须点明断法非纲要所有');
});
t('天辅落宫可断时，这一条真的会产出', function () {
  var got = 0, tried = 0;
  for (var i = 0; i < 120; i++) {
    var p = QM.qimen.calculate(new Date(2026, 1, 1 + i * 2, (i * 5) % 24, 0, 0),
      { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
    var r = run(p, 'study');
    if (!r.applicable) continue;
    tried++;
    if ((r.readings || []).some(function (x) { return x.id === 'study.天辅.去向'; })) got++;
  }
  assert.ok(tried > 0 && got > tried * 0.5, '天辅多数时候都在八宫内，应常常触发：' + got + '/' + tried);
});
t('零串味：这一条不在飞盘上跑', function () {
  var p = zp('2026-06-07T09:30:00');
  var r = XY.analyze({ chart: p, domain: 'study', wangshuai: WS.analyze(p), options: { school: 'feipan' } });
  assert.strictEqual(r.applicable, false);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
