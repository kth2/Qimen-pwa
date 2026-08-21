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
var TM = require('./timing.js');
var DOMAINS = require('../knowledge/domains.json');
var SYMBOLS = require('../knowledge/symbols.json');
var RULES = require('../knowledge/domain-rules.json');
var TIMING_RULES = require('../knowledge/timing-rules.json');

YS.load(DOMAINS);
EV.load(SYMBOLS);
XY.load(RULES);
TM.load(TIMING_RULES);

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
  // 五类既已建成，库中无 pending 者；以合成规则库验证该机制仍在（日后新增占类必经此态）
  XY.load({
    appliesTo: ['zhuanpan'], defaultWeights: RULES.defaultWeights, relationKinds: RULES.relationKinds,
    domains: { fixture_pending: { label: '待建占类', status: 'pending', roles: {}, conditions: [], combinations: [], relations: [] } }
  });
  var xy = XY.analyze({ domain: 'fixture_pending', chart: CHART, wangshuai: WS.analyze(CHART) });
  var ev = EV.build({ question: 'q', domain: 'fixture_pending', chart: CHART, yongshen: YS.resolve({ chart: CHART }), xiangyi: xy });
  assert.strictEqual(typesOf(ev, 'READING').length, 0);
  assert.ok(EV.toPromptBlock(ev).indexOf('规则未建') >= 0);
  XY.load(RULES);
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
t('五个新占类都能产出 READING 并进入证据包', function () {
  var ws = WS.analyze(CHART), got = {};
  ['career', 'relationship', 'health', 'lawsuit', 'lost_item'].forEach(function (dm) {
    var xy = XY.analyze({ domain: dm, chart: CHART, wangshuai: ws });
    var ev = EV.build({ question: 'q', domain: dm, chart: CHART, yongshen: YS.resolve({ domain: dm, chart: CHART }), xiangyi: xy });
    var reads = typesOf(ev, 'READING');
    assert.strictEqual(ev.xiangyi.applicable, true, dm + ' 规则应已建成并生效');
    assert.ok(reads.length > 0, dm + ' 应产出 READING，实得 0');
    reads.forEach(function (r) {
      assert.strictEqual(r.source, 'knowledge/domain-rules.json');
      assert.ok(/纲要|symbols\.json|domains\.json/.test(r.basis), dm + ' 的 ' + r.id + ' 出处不合规');
    });
    got[dm] = reads.length;
  });
  assert.ok(Object.keys(got).length === 5, JSON.stringify(got));
});
t('健康占：安全边界进入证据包与提示块', function () {
  var xy = XY.analyze({ domain: 'health', chart: CHART, wangshuai: WS.analyze(CHART) });
  var ev = EV.build({ question: '身体如何', domain: 'health', chart: CHART, yongshen: YS.resolve({ domain: 'health', chart: CHART }), xiangyi: xy });
  assert.ok(/不得作为医学诊断/.test(ev.xiangyi.safetyNote), '证据包须带健康边界');
  var txt = EV.toPromptBlock(ev);
  assert.ok(txt.indexOf('本占类边界') >= 0 && txt.indexOf('不得作为医学诊断') >= 0, '提示块须显式声明健康边界');
  assert.ok(txt.indexOf('咨询合格医疗专业人士') >= 0, '须提示就医');
});
t('五个新占类在飞盘上均不得混入转盘判读', function () {
  ['career', 'relationship', 'health', 'lawsuit', 'lost_item'].forEach(function (dm) {
    var xy = XY.analyze({ domain: dm, chart: CHART, wangshuai: WS.analyze(CHART), options: { school: 'feipan' } });
    var ev = EV.build({ question: 'q', domain: dm, chart: CHART, yongshen: YS.resolve({ domain: dm, chart: CHART }), xiangyi: xy });
    assert.strictEqual(typesOf(ev, 'READING').length, 0, dm + ' 零串味失守');
    assert.strictEqual(ev.xiangyi.applicable, false);
  });
});
console.log('== Phase 4：应期锚点(TIMING)集成 ==');
function buildWithTiming() {
  var ws = WS.analyze(CHART);
  var xy = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: ws });
  var yq = YQ.analyze(CHART, { yongShenGongs: xy.focus.map(function (f) { return f.gong; }) });
  var tm = TM.analyze({ chart: CHART, yingqi: yq, xiangyi: xy, wangshuai: ws, options: { domain: 'wealth' } });
  return EV.build({ question: '何时可得？', domain: 'wealth', chart: CHART, yongshen: YONG, xiangyi: xy, timing: tm });
}
t('不传 timing 时无 TIMING 条目（Phase 1/2 行为原样不变）', function () {
  var ev = build();
  assert.strictEqual(typesOf(ev, 'TIMING').length, 0);
  assert.strictEqual(ev.timing, null);
  assert.ok(EV.toPromptBlock(ev).indexOf('TIMING') < 0);
});
t('传入 timing 时产出 TIMING 条目，且各带机制与出处', function () {
  var ev = buildWithTiming();
  var ts = typesOf(ev, 'TIMING');
  assert.ok(ts.length > 0, '应有 TIMING 条目');
  ts.forEach(function (x) {
    assert.ok(TIMING_RULES.mechanisms[x.mechanism], '出现了规则库中没有的机制：' + x.mechanism);
    assert.ok(/纲要/.test(x.basis), x.id + ' 缺纲要出处');
    assert.ok(['high', 'medium', 'low'].indexOf(x.strength) >= 0, x.id + ' 强弱非法');
    assert.ok(x.content.length > 0);
  });
});
t('TIMING 与 READING/SYMBOL 分列，来源各自标明', function () {
  var ev = buildWithTiming();
  typesOf(ev, 'TIMING').forEach(function (x) { assert.ok(/timing\.js/.test(x.source), 'TIMING 来源须标明'); });
  typesOf(ev, 'READING').forEach(function (x) { assert.strictEqual(x.source, 'knowledge/domain-rules.json'); });
  var txt = EV.toPromptBlock(ev);
  assert.ok(txt.indexOf('TIMING（应期锚点') >= 0);
  assert.ok(txt.indexOf('READING（占类象义判读') >= 0);
});
t('提示块声明应期与 yingqi 同源，并禁止自造日辰', function () {
  var txt = EV.toPromptBlock(buildWithTiming());
  assert.ok(/取自上方 yingqi 同一组计算/.test(txt), '须声明同源，避免被当成两套推算');
  assert.ok(/不得自造日辰/.test(txt));
    // v5：位次确是该候选下次出现的真实距离；须防的是把它当成「事情必应在那时」
  assert.ok(/历法事实/.test(txt) && /据全盘定夺/.test(txt),
    '位次可作真实距离，但须与「事情是否应在那时」分开说');
  assert.ok(/严禁改用天干或无关地支充数/.test(txt), '机制禁令须带出');
});
t('证据包保留时间线次序、迟速与用神宫河图数', function () {
  var ev = buildWithTiming();
  assert.ok(ev.timing.timeline.length > 0, '应保留时间线');
  for (var i = 1; i < ev.timing.timeline.length; i++) {
    assert.ok(ev.timing.timeline[i - 1].offset <= ev.timing.timeline[i].offset, '时间线须按位次升序');
  }
  assert.ok(ev.timing.numbers.length > 0, '应保留用神宫河图数');
  assert.ok(ev.timing.horizon && /近事看日时/.test(ev.timing.horizon.basis), '应保留断日/月/年之据');
});
t('含应期的证据包仍受体积约束', function () {
  var ev = buildWithTiming();
  assert.ok(typesOf(ev, 'TIMING').length <= 12, 'TIMING 条目过多');
  assert.ok(EV.toPromptBlock(ev).length < 12000, '提示块过长会稀释注意力');
});
t('含判读的证据包可 JSON 序列化且确定性', function () {
  assert.doesNotThrow(function () { JSON.parse(JSON.stringify(buildWithXy())); });
  assert.deepStrictEqual(buildWithXy(), buildWithXy());
});

console.log('== 应期多元性：四级读法必须进到证据包（这是真正送给模型的那一份） ==');

t('TIMING 条目带上四级读法与其出处', function () {
  var ev = buildWithTiming();
  var ts = ev.items.filter(function (x) { return x.type === 'TIMING'; });
  assert.ok(ts.length, '本盘应有应期锚点');
  ts.forEach(function (x) {
    assert.ok(Array.isArray(x.reads) && x.reads.length, x.id + ' 缺四级读法');
    assert.ok(Array.isArray(x.nativeUnits) && x.nativeUnits.length, x.id + ' 缺 nativeUnits');
    x.reads.forEach(function (r) {
      assert.ok(['时', '日', '月', '年'].indexOf(r.unit) >= 0);
      assert.ok(r.source === 'native' || r.source === 'horizon');
    });
  });
});

t('远近须排在锚点之前——排在后面等于模型已经按日断完了', function () {
  var txt = EV.toPromptBlock(buildWithTiming());
  var iHead = txt.indexOf('· TIMING（应期锚点');
  var iHorizon = txt.indexOf('【先定远近】');
  var iAnchor = txt.indexOf('  - [★', iHead);
  assert.ok(iHorizon > iHead, '远近须在 TIMING 段内');
  assert.ok(iHorizon < iAnchor, '远近必须排在第一条锚点之前');
});

t('提示块按时/日/月/年各铺一段，且标明月建以节气分界、年以立春分界', function () {
  var txt = EV.toPromptBlock(buildWithTiming());
  assert.ok(/若断时辰（同一日之内何时/.test(txt), '须能回答「同一天不同时辰」');
  assert.ok(/若断日：/.test(txt));
  assert.ok(/若断月（月建以节气分界，非农历朔望月）/.test(txt), '月建不可与农历朔望月混同');
  assert.ok(/若断年（年以立春分界，所标公历年为约数）/.test(txt), '年的分界与约数性质须写明');
});

t('两级出处在提示词里分得开，且警告不得把跨级当成多次机会', function () {
  var txt = EV.toPromptBlock(buildWithTiming());
  assert.ok(/〔推及〕/.test(txt), '非原文所许的单位须带标记');
  assert.ok(/单位出处：/.test(txt) && /可直接照断/.test(txt));
  assert.ok(/不是多给了一个候选/.test(txt), '须防止把同一支跨级读当成多次命中机会');
  assert.ok(/不要一律断成某日/.test(txt));
});

t('干支称谓：干在时/月/年三柱写作「时干X」，不得写成「X时」', function () {
  var ev = buildWithTiming();
  ev.items.filter(function (x) { return x.type === 'TIMING' && x.kind === 'gan'; }).forEach(function (x) {
    x.reads.forEach(function (r) {
      if (r.unit === '日') assert.strictEqual(r.label, x.value + '日');
      else assert.strictEqual(r.label, r.unit + '干' + x.value);
    });
  });
});

t('无 timing 时证据包照常可用，不因新增单位层而崩', function () {
  var ev = EV.build({ domain: 'wealth', chart: CHART, yongshen: YS.resolve({ domain: 'wealth', chart: CHART }) });
  assert.ok(EV.toPromptBlock(ev).length > 0);
  assert.ok(!ev.items.some(function (x) { return x.type === 'TIMING'; }));
});

console.log('== 类象用神进证据包（Phase 8：所问之物本身也要有代表） ==');
var LX = require('./leixiang.js');
// FACT 的 content 是字符串，SYMBOL/READING 的是数组——统一成串再断言
function textOf(x) { return Array.isArray(x.content) ? textOf(x) : String(x.content || ''); }
LX.load(require('../knowledge/leixiang.json'));

function buildWithLeiXiang(q, school) {
  var chart = CHART;
  var ys = YS.resolve({ domain: 'lost_item', chart: chart });
  var lx = LX.resolve({
    question: q, chart: chart,
    options: {
      school: school || 'zhuanpan', locate: YS.locate, actors: ys.actors,
      domainNames: (ys.examine || []).map(function (m) { return m.name; })
    }
  });
  return EV.build({ question: q, domain: 'lost_item', chart: chart, yongshen: ys, leixiang: lx });
}

t('类象用神进 FACT，并写明所问之词、出处与落宫', function () {
  var ev = buildWithLeiXiang('我的钥匙丢了，能找回吗？');
  var fs_ = ev.items.filter(function (x) { return x.type === 'FACT' && /类象用神/.test(textOf(x)); });
  assert.ok(fs_.length >= 2, '钥匙一问应至少取到玄武与辛两个类象');
  var xin = fs_.filter(function (x) { return /辛/.test(textOf(x)); })[0];
  assert.ok(xin, '钥匙应取辛');
  assert.ok(/钥匙/.test(textOf(xin)), '须写明是所问的哪个词取的象');
  assert.ok(/宫/.test(textOf(xin)) || /盘上未见/.test(textOf(xin)), '须给落宫或明说未见');
  assert.ok(/本层归类/.test(textOf(xin)), '钥匙非纲要原文之词，须标为归类');
});

t('类象用神的象义也进 SYMBOL——只给「辛＝金刃/首饰」四个字断不出情状', function () {
  var ev = buildWithLeiXiang('我的钥匙丢了，能找回吗？');
  var syms = ev.items.filter(function (x) { return x.type === 'SYMBOL'; })
    .map(function (x) { return x.element || x.label; });
  assert.ok(syms.indexOf('辛') >= 0, '辛的象义须进 SYMBOL');
  var lxi = ev.leixiang;
  var located = lxi.candidates.filter(function (c) { return c.located; });
  located.forEach(function (c) {
    assert.ok(syms.some(function (s) { return String(s).indexOf(c.gong) >= 0; }),
      c.symbol + ' 落宫 ' + c.gong + ' 的象义也应进 SYMBOL（失物断方位全靠它）');
  });
});

t('提示块把类象用神紧贴占类用神，并要求逐宫展开', function () {
  var txt = EV.toPromptBlock(buildWithLeiXiang('我的钥匙丢了，能找回吗？'));
  var iDom = txt.indexOf('· 占类用神');
  var iLx = txt.indexOf('· 类象用神');
  var iFact = txt.indexOf('· FACT');
  assert.ok(iLx > 0, '须有类象用神一段');
  assert.ok(iDom > 0 && iLx > iDom, '类象用神须紧跟占类用神');
  assert.ok(iLx < iFact, '类象用神须在证据条目之前，不能塞到包尾');
  assert.ok(/必须把这些类象用神的落宫也逐一展开/.test(txt));
  assert.ok(/不得只写值符、值使、日干宫、时干宫/.test(txt), '这正是用户报的症结，须明写');
  assert.ok(/衍象类象：人\/物\/事各取对应符号/.test(txt), '须引纲要原文为据');
});

t('飞盘不得出现类象用神一段（零串味）', function () {
  var ev = buildWithLeiXiang('我的钥匙丢了', 'feipan');
  assert.ok(!ev.items.some(function (x) { return x.type === 'FACT' && /类象用神/.test(textOf(x)); }));
  assert.ok(EV.toPromptBlock(ev).indexOf('· 类象用神') < 0);
});

t('未匹配到类象时如实交代，并请模型自行取象', function () {
  var txt = EV.toPromptBlock(buildWithLeiXiang('这件事总体如何'));
  assert.ok(/类象用神：本次未在索引中匹配到类象词/.test(txt));
  assert.ok(/自行为所问之人\/物\/事取象/.test(txt));
});

t('不传 leixiang 时证据包一切照旧（向后兼容）', function () {
  var ev = build();
  assert.strictEqual(ev.leixiang, null);
  var txt = EV.toPromptBlock(ev);
  assert.ok(txt.length > 0);
  assert.ok(txt.indexOf('· 类象用神') < 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
