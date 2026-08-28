/**
 * 占类选择 回归测试（纯 Node，无框架）。
 * 运行：node core/domainpick.test.js
 *
 * 实测过的 bug：用户在 AI 面板选了「学业」，界面标签正确显示「按 功名 断（你指定的）」，
 * 整篇却仍按 求财 断，连用神都取的求财那套（生门/戊 财星，而非景门/天辅 文书）。
 *
 * 根因：预览与真跑走了**两条不同的路**——
 *   预览 → builder.classifyQuestion(q, fb)      认 fb，会听用户的
 *   真跑 → builder.buildPrompt(pan, q, opts)    **只认 opts.category，不认 opts.fallbackCategory**
 * 而 app 一直只传 fallbackCategory。于是「选对占类」这件事根本做不到，
 * 而占类判错是本仓实测里最贵的一类错（整篇建在错的用神上）。
 *
 * 本文件锁住三件事：① 引擎的这一行为差异（我们依赖它，它变了要先红）；
 * ② app 显式选择时必须传 category；③ 预览与真跑必须共用同一个解析口径。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var YS = require('./yongshen.js');
YS.load(require('../knowledge/domains.json'));

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function chart() {
  return QM.qimen.calculate(new Date('2026-08-27T10:00:00'),
    { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
}
// 关键词偏「财」而实问学业——正是能把两条路的分歧照出来的那种问句
var Q = '我这笔投资的学业进修课程能顺利完成吗';

console.log('\n== 引擎行为：我们依赖的那条差异 ==');
t('buildPrompt 只认 opts.category，不认 opts.fallbackCategory', function () {
  var B = QM.zhuanpanPredict, p = chart();
  assert.strictEqual(B.buildPrompt(p, Q, { methodText: 'x', fallbackCategory: '功名' }).context.category, '求财',
    'fallbackCategory 若忽然生效了也要先红——那意味着可以简化 app 的传参');
  assert.strictEqual(B.buildPrompt(p, Q, { methodText: 'x', category: '功名' }).context.category, '功名');
});
t('classifyQuestion 则认 fallback（两者行为确实不同）', function () {
  var B = QM.zhuanpanPredict;
  assert.strictEqual((B.classifyQuestion(Q, '功名') || {}).category, '功名');
  assert.strictEqual((B.classifyQuestion(Q, '综合') || {}).category, '求财');
});
t('飞盘同此', function () {
  var f = QM.feipanQimen.calculate(new Date('2026-08-27T10:00:00'), { method: '时家', purpose: '综合' });
  assert.strictEqual(QM.feipanPredict.buildPrompt(f, Q, { methodText: 'x', fallbackCategory: '功名' }).context.category, '求财');
  assert.strictEqual(QM.feipanPredict.buildPrompt(f, Q, { methodText: 'x', category: '功名' }).context.category, '功名');
});

console.log('\n== 指定占类后，用神必须跟着换 ==');
t('选功名 → 用神取景门/天辅(文书)，而非生门/戊(财星)', function () {
  var B = QM.zhuanpanPredict, p = chart();
  var bad = B.buildPrompt(p, Q, { methodText: 'x', fallbackCategory: '功名' }).context.yong;
  var good = B.buildPrompt(p, Q, { methodText: 'x', category: '功名' }).context.yong;
  var names = function (y) { return (y.located || []).map(function (l) { return l.name; }).join('、'); };
  assert.strictEqual(bad.category, '求财', '这就是修复前的样子：用神取了财星');
  assert.strictEqual(good.category, '功名');
  assert.ok(/景门|天辅/.test(names(good)), '功名用神应为文书类，实得 ' + names(good));
  assert.ok(!/生门/.test(names(good)), '不该再出现财星用神');
});
t('六个占类逐一指定，引擎都照办', function () {
  var B = QM.zhuanpanPredict, p = chart();
  ['功名', '求财', '疾病', '失物', '婚姻', '出行'].forEach(function (c) {
    var got = B.buildPrompt(p, Q, { methodText: 'x', category: c }).context.category;
    assert.strictEqual(got, c, '指定 ' + c + ' 却得 ' + got);
  });
});

console.log('\n== app.js 源码守卫 ==');
t('显式选择时必须传 opts.category', function () {
  assert.ok(/if \(rc\.explicit\) opts\.category = rc\.category;/.test(APP),
    '真跑路径若不传 category，用户的选择就会被静默丢弃');
});
t('预览与真跑共用同一个解析口径 resolveCategory()', function () {
  assert.ok(/function resolveCategory\(\)/.test(APP), '须有统一口径');
  var calls = (APP.match(/resolveCategory\(\)/g) || []).length;
  assert.ok(calls >= 3, '定义 + 预览 + 真跑，至少三处，实得 ' + calls);
  // 预览不得再自己算一套
  assert.ok(!/const picked = sel\.value \|\| \$\('inPurpose'\)\.value;/.test(APP),
    '预览里的旧口径应已删除，否则两条路会再次漂移');
});
t('显式选择时预览不再过分类器（免得它推翻用户）', function () {
  var seg = APP.slice(APP.indexOf('function previewDomain'), APP.indexOf('function previewDomain') + 1400);
  assert.ok(/if \(!rc\.explicit\)[\s\S]{0,120}classifyQuestion/.test(seg),
    'classifyQuestion 只该在非显式时被调用');
});

console.log('\n== 占类两级：引擎占类 vs 规则占类 ==');
t('功名在知识库里无专条，归 general——这是事实，不是判错', function () {
  assert.strictEqual(YS.normalizeDomain('功名'), 'general');
  assert.ok(YS.domainIds().indexOf('gongming') < 0, '确无功名专条');
});
t('两级不同时，证据包须点明「规则未建，不是判错」', function () {
  var EV = require('./evidence.js');
  EV.load(require('../knowledge/symbols.json'));
  var p = chart();
  var prompt = QM.zhuanpanPredict.buildPrompt(p, Q, { methodText: 'x', category: '功名' });
  // 走真实的 YS.resolve，拿到与 app 同一形状的 yongshen——自造形状测不出真问题
  // engineYong 必须放在 options 里——resolve 读的是 args.options.engineYong
  var ys = YS.resolve({ chart: p, domain: 'general',
    options: { engineYong: prompt.context.yong, school: 'zhuanpan' } });
  assert.strictEqual(ys.engineRule && ys.engineRule.category, '功名', '引擎占类应原样带进来');
  var blk = EV.toPromptBlock(EV.build({ chart: p, school: 'zhuanpan', domain: 'general', question: Q, yongshen: ys }));
  assert.ok(/占类两级/.test(blk), '两级不同时须另起一行说明，实际未见');
  assert.ok(/规则未建.*不是占类判错|不是占类判错/.test(blk));
});
t('【回归】ev.category 必须真的有值——曾误读 ys.engine（实为 engineRule）而恒空', function () {
  var EV2 = require('./evidence.js');
  EV2.load(require('../knowledge/symbols.json'));
  var p = chart();
  var prompt = QM.zhuanpanPredict.buildPrompt(p, Q, { methodText: 'x', category: '功名' });
  var ys = YS.resolve({ chart: p, domain: 'general',
    options: { engineYong: prompt.context.yong, school: 'zhuanpan' } });
  var ev = EV2.build({ chart: p, school: 'zhuanpan', domain: 'general', question: Q, yongshen: ys });
  assert.strictEqual(ev.category, '功名', 'ev.category 恒空则「占类两级」那段永远不会出现');
});
t('界面标签也把「规则未建」说出来', function () {
  assert.ok(/象义规则库暂无此占类专条/.test(APP));
  assert.ok(/是规则未建，不是判错/.test(APP));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
