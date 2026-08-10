/**
 * 证据包(Evidence) core 单元测试（纯 Node，无框架）。
 * 运行：node core/evidence.test.js
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var YS = require('./yongshen.js');
var EV = require('./evidence.js');
var WS = require('./wangshuai.js');
var YQ = require('./yingqi.js');
var XY = require('./xiangyi.js');
var DOMAINS = require('../knowledge/domains.json');
var SYMBOLS = require('../knowledge/symbols.json');
var RULES = require('../knowledge/domain-rules.json');

YS.load(DOMAINS);
EV.load(SYMBOLS);
XY.load(RULES);

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

// 固定盘，保证断言可重复
var CHART = QM.qimen.calculate(new Date('2024-04-10T10:00:00'), { type: '四柱', method: '时家', purpose: '财运' });
var YONG = YS.resolve({ domain: 'wealth', chart: CHART });

function build(extra) {
  var arg = { question: '今年求财如何？', domain: 'wealth', chart: CHART, yongshen: YONG };
  for (var k in (extra || {})) arg[k] = extra[k];
  return EV.build(arg);
}
function typesOf(ev, ty) {
  return ev.items.filter(function (i) { return i.type === ty; });
}

console.log('== 象义查表 ==');
t('exact lookup 命中', function () {
  var s = EV.getSymbol('bamen', '生门');
  assert.ok(s, '应查到生门');
  assert.strictEqual(s.wuxing, '土');
  assert.ok(s.core.length > 0);
});
t('九宫以宫号查表', function () {
  var s = EV.getSymbol('jiugong', '1');
  assert.ok(s);
  assert.ok(s.places.indexOf('正北') >= 0);
});
t('查不到返回 null，不抛异常', function () {
  assert.strictEqual(EV.getSymbol('bamen', '不存在门'), null);
  assert.strictEqual(EV.getSymbol('不存在类', '生门'), null);
  assert.strictEqual(EV.getSymbol(), null);
});

console.log('== 证据包结构 ==');
t('保留 domain 与问题', function () {
  var ev = build();
  assert.strictEqual(ev.domain, 'wealth');
  assert.strictEqual(ev.question, '今年求财如何？');
});
t('包含 yongshen 映射', function () {
  var ev = build();
  assert.ok(ev.yongshen, '应含 yongshen');
  assert.ok(ev.yongshen.domain.primary.indexOf('生门') >= 0);
});
t('存在 FACT 条目且与盘面一致', function () {
  var ev = build();
  var facts = typesOf(ev, 'FACT');
  assert.ok(facts.length > 0, '应有 FACT');
  var smFact = facts.filter(function (f) { return /生门/.test(f.content); })[0];
  assert.ok(smFact, '应有生门落宫的 FACT');
  var expect = Object.keys(CHART.baMen).filter(function (g) { return CHART.baMen[g] === '生门'; })[0];
  assert.ok(smFact.content.indexOf(expect + '宫') >= 0, 'FACT 宫位须与引擎一致：' + smFact.content);
  facts.forEach(function (f) { assert.strictEqual(f.source, 'chart'); });
});
t('存在 SYMBOL 条目且内容取自 symbols.json', function () {
  var ev = build();
  var syms = typesOf(ev, 'SYMBOL');
  assert.ok(syms.length > 0, '应有 SYMBOL');
  var sm = syms.filter(function (s) { return s.element === '生门'; })[0];
  assert.ok(sm, '应有生门的 SYMBOL');
  assert.strictEqual(sm.source, 'knowledge/symbols.json');
  assert.ok(sm.fields.length > 0, '应记录取自哪几栏');
  assert.ok(Array.isArray(sm.content) && sm.content.length > 0);
  var kb = EV.getSymbol('bamen', '生门');
  sm.content.forEach(function (w) {
    var inKb = kb.core.concat(kb.keywords, kb.events, kb.people, kb.objects, kb.places, kb.industries, kb.psychology, kb.body).indexOf(w) >= 0;
    assert.ok(inKb, '象义须出自知识库，不得杜撰：' + w);
  });
});
t('传入 wangshuai / yingqi 时产出 RULE 条目', function () {
  var ev = build({
    wangshuai: WS.toPromptBlock(CHART, { JIU_GONG: QM.JIU_GONG }),
    yingqi: YQ.toPromptBlock(CHART, { JIU_GONG: QM.JIU_GONG, yongShenGongs: ['2'] })
  });
  var rules = typesOf(ev, 'RULE');
  assert.ok(rules.length >= 2, '应有 wangshuai 与 yingqi 两类 RULE，实得 ' + rules.length);
  var srcs = rules.map(function (r) { return r.source; });
  assert.ok(srcs.indexOf('wangshuai') >= 0, '应保留 wangshuai 输出');
  assert.ok(srcs.indexOf('yingqi') >= 0, '应保留 yingqi 输出');
  rules.forEach(function (r) { assert.ok(r.content && r.content.length > 0); });
});
t('传入 shanxiang 时产出 RULE 条目', function () {
  var sx = require('./shanxiang.js');
  var sxPan = sx.generateShanXiangChart({ sitting: '子', date: new Date('2024-04-10T10:00:00'), purpose: '风水' }, QM);
  var ev = EV.build({ question: '此宅如何', domain: 'general', chart: sxPan, yongshen: YS.resolve({ domain: 'general', chart: sxPan }), shanxiang: sxPan.shanXiang });
  var rules = typesOf(ev, 'RULE').filter(function (r) { return r.source === 'shanxiang'; });
  assert.strictEqual(rules.length, 1, '应有且仅有一条山向 RULE');
});
t('缺省分析结果时不产出对应 RULE，也不报错', function () {
  var ev = build();
  var rules = typesOf(ev, 'RULE');
  var srcs = rules.map(function (r) { return r.source; });
  assert.ok(srcs.indexOf('wangshuai') < 0, '未传入则不应凭空捏造 wangshuai');
  assert.ok(srcs.indexOf('shanxiang') < 0);
});
t('引擎既有分析（格局/九宫吉凶）作为 RULE 保留', function () {
  var ev = build();
  var srcs = typesOf(ev, 'RULE').map(function (r) { return r.source; });
  assert.ok(srcs.indexOf('engine') >= 0, '应保留引擎自身分析结果');
});

console.log('== 不倾倒整个知识库 ==');
t('只收录用神相关元素的象义', function () {
  var ev = build();
  var els = typesOf(ev, 'SYMBOL').map(function (s) { return s.element; });
  // 求财占类不涉及天芮/天心，不应出现
  assert.ok(els.indexOf('天芮') < 0, '不应收录与用神无关的天芮');
  assert.ok(els.indexOf('天心') < 0, '不应收录与用神无关的天心');
});
t('SYMBOL 条目数与体积受限', function () {
  var ev = build();
  var syms = typesOf(ev, 'SYMBOL');
  assert.ok(syms.length <= 24, 'SYMBOL 条目过多：' + syms.length);
  var kbSize = JSON.stringify(SYMBOLS).length;
  var evSize = JSON.stringify(ev).length;
  assert.ok(evSize < kbSize * 0.5, '证据包不应逼近整库体积 ' + evSize + '/' + kbSize);
});
t('每条 SYMBOL 的词条数受限（防长篇倾倒）', function () {
  var ev = build();
  typesOf(ev, 'SYMBOL').forEach(function (s) {
    assert.ok(s.content.length <= 12, s.element + ' 象义词条过多：' + s.content.length);
  });
});

console.log('== 组合与序列化 ==');
t('combined 为去重关键词列表', function () {
  var ev = build();
  assert.ok(Array.isArray(ev.combined));
  assert.strictEqual(ev.combined.length, new Set(ev.combined).size, 'combined 须去重');
});
t('整个证据包可 JSON 序列化', function () {
  var ev = build({ wangshuai: WS.toPromptBlock(CHART, { JIU_GONG: QM.JIU_GONG }) });
  assert.doesNotThrow(function () { JSON.parse(JSON.stringify(ev)); });
});
t('toPromptBlock 产出非空文本且标明三类', function () {
  var ev = build();
  var txt = EV.toPromptBlock(ev);
  assert.ok(txt.length > 0);
  ['FACT', 'RULE', 'SYMBOL'].forEach(function (k) {
    assert.ok(txt.indexOf(k) >= 0, '提示块应标明 ' + k);
  });
});

console.log('== 防御性 ==');
t('空参数不抛异常', function () {
  assert.doesNotThrow(function () { EV.build(); });
  assert.doesNotThrow(function () { EV.build({}); });
});
t('无 domain 时回落 general', function () {
  var ev = EV.build({ chart: CHART, yongshen: YS.resolve({ chart: CHART }) });
  assert.strictEqual(ev.domain, 'general');
});
t('toPromptBlock 收到坏数据返回空串，不阻断解读', function () {
  assert.strictEqual(EV.toPromptBlock(null), '');
  assert.strictEqual(EV.toPromptBlock({}), '');
});

console.log('== Phase 2：占类象义判读(READING)集成 ==');
var XYRES = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WS.analyze(CHART) });
function buildWithXy(extra) {
  var arg = { question: '今年求财如何？', domain: 'wealth', chart: CHART, yongshen: YONG, xiangyi: XYRES };
  for (var k in (extra || {})) arg[k] = extra[k];
  return EV.build(arg);
}
t('不传 xiangyi 时无 READING 条目（Phase 1 行为原样不变）', function () {
  var ev = build();
  assert.strictEqual(typesOf(ev, 'READING').length, 0);
  assert.strictEqual(ev.xiangyi, null);
  assert.ok(EV.toPromptBlock(ev).indexOf('READING') < 0);
});
t('传入 xiangyi 时产出 READING 条目，三种 scope 齐备', function () {
  var ev = buildWithXy();
  var reads = typesOf(ev, 'READING');
  assert.ok(reads.length > 0, '应有 READING');
  var scopes = {};
  reads.forEach(function (r) { scopes[r.scope] = (scopes[r.scope] || 0) + 1; });
  assert.ok(scopes.condition > 0, '应有单象判读');
  assert.ok(scopes.combination > 0, '应有组合判读');
  assert.ok(scopes.relation > 0, '应有宫际关系判读');
});
t('每条 READING 都可回查规则库，且注明出处与触发条件', function () {
  var byId = {};
  Object.keys(RULES.domains).forEach(function (dm) {
    ['conditions', 'combinations', 'relations'].forEach(function (k) {
      (RULES.domains[dm][k] || []).forEach(function (r) { byId[r.id] = r; });
    });
  });
  typesOf(buildWithXy(), 'READING').forEach(function (r) {
    assert.ok(byId[r.id], '证据包出现了规则库中没有的判读：' + r.id);
    assert.strictEqual(r.source, 'knowledge/domain-rules.json');
    assert.ok(r.basis && r.basis.length > 4, r.id + ' 缺出处');
    assert.ok(r.trigger && r.trigger.length > 0, r.id + ' 缺触发条件——只给结论不给"因何而得"，模型无从核验');
    assert.ok(['+', '-', '0'].indexOf(r.polarity) >= 0, r.id + ' polarity 非法');
  });
});
t('READING 与 SYMBOL 分列，不得混为一谈', function () {
  var ev = buildWithXy();
  typesOf(ev, 'SYMBOL').forEach(function (s) { assert.strictEqual(s.source, 'knowledge/symbols.json'); });
  typesOf(ev, 'READING').forEach(function (r) { assert.strictEqual(r.source, 'knowledge/domain-rules.json'); });
  var txt = EV.toPromptBlock(ev);
  assert.ok(txt.indexOf('SYMBOL（知识库通用象义') >= 0, '须说明 SYMBOL 是与占类无关的原料');
  assert.ok(txt.indexOf('READING（占类象义判读') >= 0, '须说明 READING 是本占类下的读法');
});
t('提示块声明判读非吉凶断语', function () {
  var txt = EV.toPromptBlock(buildWithXy());
  assert.ok(txt.indexOf('不是成败断语') >= 0);
  assert.ok(/倾向计数.*非结论/.test(txt), '倾向计数须明标非结论');
});
t('SYMBOL 按占类权重优先（Phase 2.2：重点用神不被截断挤掉）', function () {
  var ev = buildWithXy();
  var els = typesOf(ev, 'SYMBOL').map(function (s) { return s.element; });
  var iSheng = els.indexOf('生门'), iLiu = els.indexOf('六合');
  assert.ok(iSheng >= 0, '★5 的生门必须在列');
  if (iLiu >= 0) assert.ok(iSheng < iLiu, '★5 的生门应排在 ★3 的六合之前，实得 ' + els.join('>'));
});
t('关注点与权重写进提示块，且未见者如实标注', function () {
  var txt = EV.toPromptBlock(buildWithXy());
  assert.ok(txt.indexOf('本占类关注点与权重') >= 0);
  assert.ok(txt.indexOf('★★★★★ 生门＝财源') >= 0, '★5 的财源须明标：\n' + txt.slice(0, 400));
});
t('规则未建的占类：提示块明说是"规则未建"而非"盘上无碍"', function () {
  var xy = XY.analyze({ domain: 'career', chart: CHART, wangshuai: WS.analyze(CHART) });
  var ev = EV.build({ question: 'q', domain: 'career', chart: CHART, yongshen: YS.resolve({ domain: 'career', chart: CHART }), xiangyi: xy });
  assert.strictEqual(typesOf(ev, 'READING').length, 0);
  assert.ok(EV.toPromptBlock(ev).indexOf('规则未建') >= 0);
});
t('飞盘：象义层停用，证据包不得混入转盘判读', function () {
  var xy = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WS.analyze(CHART), options: { school: 'feipan' } });
  var ev = EV.build({ question: 'q', domain: 'wealth', chart: CHART, yongshen: YONG, xiangyi: xy });
  assert.strictEqual(typesOf(ev, 'READING').length, 0, '零串味：飞盘不得出现转盘判读');
  assert.strictEqual(ev.xiangyi.applicable, false);
});
t('含判读的证据包仍受体积约束', function () {
  var ev = buildWithXy({
    wangshuai: WS.toPromptBlock(CHART, { JIU_GONG: QM.JIU_GONG }),
    yingqi: YQ.toPromptBlock(CHART, { JIU_GONG: QM.JIU_GONG, yongShenGongs: ['2'] })
  });
  assert.ok(typesOf(ev, 'READING').length <= 32, 'READING 条目过多：' + typesOf(ev, 'READING').length);
  var txt = EV.toPromptBlock(ev);
  assert.ok(txt.length < 12000, '提示块过长会稀释注意力：' + txt.length);
});
t('含判读的证据包可 JSON 序列化且确定性', function () {
  assert.doesNotThrow(function () { JSON.parse(JSON.stringify(buildWithXy())); });
  assert.deepStrictEqual(buildWithXy(), buildWithXy());
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
