/**
 * Phase 38 回归测试：问句方向 + 分支级断语范围送达 + 据案例本 2026-10-05 的收窄（纯 Node，无框架）。
 * 运行：node core/framing.test.js
 *
 * 本期全部出自用户 2026-10-05 导出的案例本（396 例／379 回填），逐例人工判读实况后得出。钉住四件事：
 *   ① 问句方向检出：宁漏勿错——背景句里的「检查没有胎心」「公安局的公务员」不得误检；
 *   ② 检出后证据包与系统提示词（E30）把 [助]/[阻] 的换算说出来，但**不改任何判读极性**；
 *   ③ 分支级 answersNote 真的送达模型（Phase 23 写进知识库后一直没送到，本期修）；
 *   ④ 收窄只改「答什么」，纲要原句（basis）一字不动，且样本数、出处随条记下。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var FR = require('./framing.js');
var XY = require('./xiangyi.js');
var WS = require('./wangshuai.js');
var YS = require('./yongshen.js');
var EV = require('./evidence.js');
var EVAL = require('./evaluate.js');
var RULES = require('../knowledge/domain-rules.json');
var DOMAINS = require('../knowledge/domains.json');
var SYMBOLS = require('../knowledge/symbols.json');
var ROOT = path.join(__dirname, '..');
var APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
var HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
var ZP = fs.readFileSync(path.join(ROOT, 'assets', 'zhuanpan-method.md'), 'utf8');

XY.load(RULES); YS.load(DOMAINS); EV.load(SYMBOLS);

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function adverse(q) { return FR.detect(q).direction === 'adverse'; }

console.log('\n== 问句方向：检出怕发生之事 ==');
t('案例本里的原句逐条检出', function () {
  [
    '别墅装修遭村民会不会被举报？',
    '公司被查多次抓人，这女测她男人安全吗会不会被抓？',
    '预测远在美国的工程会遭到投诉吗？',
    '去广东干钢筋工怎么样，马上要走了，会出问题吗？',
    '昨天下午闯红灯被抓拍了吗?',
    '癸未男来问看会不会被处分？',
    '问:弟弟会不会坐牢?因为什么事情?',
    '父亲面测，问儿子是否有牢狱之灾',
    '一男占:不经意闯了红灯会不会被罚款?',
    '八八年的会不会拘刑？',
    '22岁男神色慌张地来问卦，最近犯了事儿，会有牢狱 之灾吗?',
    '男问:此店会关门吗？如果倒闭大概是什么时候？',
    '这回还会不会漏？',
    '刚刚来医院拍了CT，就一个问题，有没有伤到骨头？',
    '体检喉咙长了点东西，今天去复检会有大问题要动手术吗?',
    '问题1，上级部门会不会来他们厂检查？'
  ].forEach(function (q) { assert.ok(adverse(q), '漏检：' + q); });
});
t('繁体问句同样检出（案例本里真有）', function () {
  var r = FR.detect('男測：「這次裁員名單裡，有沒有我？」');
  assert.strictEqual(r.direction, 'adverse');
  assert.strictEqual(r.event, '裁员');
});
t('宁漏勿错：盼发生之事与背景句不得误检', function () {
  [
    '手机掉了，能找到不? 在哪找到的?',
    '男问:报考当地县公安局的公务员能考上吗?',
    '妻子腹中的胎儿能保住吗? 背景:前阶段去医院检查没有胎心了',
    '一男年命丁微信问测，这次被起诉，9月22日开庭。官司是赢是输？',
    '车祸现场是什么样子？',
    '跟女友还能复合吗?分手后女友有没有交上新的男朋友?',
    '今日工资会不会到账?',
    '本人藏柜中的雪茄被盗，警方是否立案？能抓到小偷吗？',
    ''
  ].forEach(function (q) { assert.ok(!adverse(q), '误检：' + q + ' → ' + FR.detect(q).phrase); });
});
t('未检出时只说「未检出」，不冒充「盼发生」', function () {
  var r = FR.detect('今日工资会不会到账?');
  assert.strictEqual(r.direction, 'unflagged');
  assert.ok(!/desired/.test(JSON.stringify(r)));
});
t('纯函数：同句两次结果一致，且不依赖盘', function () {
  assert.deepStrictEqual(FR.detect('会不会被抓？'), FR.detect('会不会被抓？'));
});

console.log('\n== 证据包：说出换算，但不改极性 ==');
var CHART = QM.qimen.calculate(new Date('2024-04-10T10:00:00'), { type: '四柱', method: '时家', purpose: '综合' });
function evFor(q) {
  var ys = YS.resolve({ domain: 'general', chart: CHART });
  var xy = XY.analyze({ domain: 'general', chart: CHART, wangshuai: WS.analyze(CHART) });
  return { xy: xy, ev: EV.build({ question: q, domain: 'general', chart: CHART, yongshen: ys, xiangyi: xy, framing: FR.detect(q) }) };
}
t('检出时证据包有「⚠ 问句方向」一行，点名事件与 E30', function () {
  var txt = EV.toPromptBlock(evFor('他会不会被抓？').ev);
  assert.ok(/问句方向：所问之事「被抓」/.test(txt), '缺问句方向行');
  assert.ok(/恰好相反/.test(txt) && /E30/.test(txt));
  assert.ok(/本题问的是怕发生之事/.test(txt), '倾向计数行须一并提醒');
});
t('未检出时一字不加', function () {
  var txt = EV.toPromptBlock(evFor('面试能成功吗？').ev);
  assert.ok(!/问句方向/.test(txt));
  assert.ok(!/本题问的是怕发生之事/.test(txt));
});
t('READING 的极性不因问句方向而变（换算交给模型按纲要原句做）', function () {
  var a = evFor('他会不会被抓？').xy, b = evFor('面试能成功吗？').xy;
  assert.deepStrictEqual(a.tally, b.tally);
});
t('倾向计数带上实测：与实况几乎无关，不得据以定成败', function () {
  var txt = EV.toPromptBlock(evFor('面试能成功吗？').ev);
  assert.ok(/实测·案例本 2026-10-05·是非题 199 例/.test(txt));
  assert.ok(/62% 如愿、为负者 53%/.test(txt) && /基线 57%/.test(txt));
  assert.ok(/不得以助多阻少或阻多助少定成败/.test(txt));
});

console.log('\n== E30 进了系统提示词 ==');
t('E30 在 E29 之后、带实测数与两级出处', function () {
  var i = APP.indexOf("'E30."), j = APP.indexOf("'E29.");
  assert.ok(i > j && j > 0, 'E30 须在 E29 之后');
  var seg = APP.slice(i, APP.indexOf("'E20.", i));
  assert.ok(/实际发生的只有 7 例/.test(seg) && /18 例/.test(seg), '须带样本数');
  assert.ok(/0\.36/.test(seg) && /0\.52/.test(seg), '须带两组加权分');
  assert.ok(/6 例断「会发生」而实际没发生/.test(seg), '须点出错的方向');
  assert.ok(/凶神落时干宫，只说明所问之事本身是件凶事/.test(seg), '须写明凶象是题面已知');
  assert.ok(/本层归纳/.test(seg) && /本仓未测过它准不准/.test(seg), '换算须标为本层归纳且未测');
});
t('E30 引的两句纲要确在纲要里', function () {
  assert.ok(/时干宫空亡主事虚悬待填实/.test(ZP));
  assert.ok(/用神空亡：所问之事多虚/.test(ZP));
});
t('页面与离线缓存都载入 framing.js，且在 evidence/evaluate 之前', function () {
  var f = HTML.indexOf('core/framing.js');
  assert.ok(f > 0 && f < HTML.indexOf('core/evidence.js') && f < HTML.indexOf('core/evaluate.js'));
  assert.ok(/'\.\/core\/framing\.js'/.test(SW));
  assert.ok(/FR\.detect\(q\)/.test(APP) && /framing,/.test(APP), 'app.js 须算出并传给证据包');
});

console.log('\n== 分支级断语范围：真的送达 ==');
// 找一张综合类盘，其日干—时干恰为指定的那一支。按时辰顺扫，结果确定。
function findBranch(kind) {
  var base = new Date('2024-01-01T00:00:00').getTime();
  for (var h = 0; h < 24 * 400; h += 2) {
    var c = QM.qimen.calculate(new Date(base + h * 3600e3), { type: '四柱', method: '时家', purpose: '综合' });
    var r = XY.analyze({ domain: 'general', chart: c, wangshuai: WS.analyze(c) });
    var hit = (r.relations || []).filter(function (x) { return x.id === 'general.rel.日干-时干' && x.branch === kind; })[0];
    if (hit) return hit;
  }
  return null;
}
t('「我宫克彼宫」一支的收窄说明到得了模型（此前只读规则级，一直没送到）', function () {
  var x = findBranch('from_ke_to');
  assert.ok(x, '扫不到这一支');
  assert.strictEqual(x.answers, '我方有无余力张罗此事');
  assert.ok(/不答「此事成不成」/.test(x.answersNote), '送达的仍是规则级说明：' + x.answersNote.slice(0, 30));
});
t('「我宫生彼宫」一支收窄为「我方的投入与耗费」', function () {
  var x = findBranch('from_sheng_to');
  assert.ok(x, '扫不到这一支');
  assert.strictEqual(x.answers, '我方的投入与耗费');
  assert.ok(/不答「此事成不成」/.test(x.answersNote));
});
t('未收窄的支仍送规则级说明（不断迟速、不断幅度）', function () {
  var x = findBranch('to_ke_from');
  assert.ok(x, '扫不到这一支');
  assert.strictEqual(x.answers, '成败倾向');
  assert.ok(/不断迟速/.test(x.answersNote));
});

console.log('\n== 收窄只改「答什么」，纲要原句不动 ==');
function cond(dm, id) {
  return (RULES.domains[dm].conditions || []).filter(function (c) { return c.id === id; })[0];
}
t('三条空亡：只断虚实与应期，样本与出处随条', function () {
  [['general.时干.空亡', 16, 11], ['general.值使.空亡', 15, 8], ['general.值符.空亡', 10, 2]].forEach(function (a) {
    var c = cond('general', a[0]);
    assert.ok(/虚实与应期/.test(c.answers), a[0] + ' answers');
    assert.ok(/不断成/.test(c.answersNote), a[0] + ' 须禁断成败');
    assert.strictEqual(c._measured.n, a[1]); assert.strictEqual(c._measured.citedAsMisread, a[2]);
    assert.ok(/2026-10-05/.test(c._measured.source) && /Phase 38/.test(c._measured.provenance));
    assert.strictEqual(c.polarity, '-', a[0] + ' 极性不得改');
    assert.ok(/^纲要·一节/.test(c.basis), a[0] + ' basis 不得改');
  });
  assert.ok(/时干宫空亡主事虚悬待填实/.test(cond('general', 'general.时干.空亡').basis));
  assert.ok(/17 例（71%）/.test(cond('general', 'general.时干.空亡').answersNote), '须带实况判读数');
});
t('两套「我宫生彼宫」：纲要原句「泄气费力难成」仍在 basis 里', function () {
  ['general', 'career'].forEach(function (dm) {
    var r = RULES.domains[dm].relations.filter(function (x) { return x.id === dm + '.rel.日干-时干'; })[0];
    assert.ok(/泄气费力难成/.test(r.basis), dm + ' basis 被动过');
    var e = r.map.from_sheng_to;
    assert.strictEqual(e.polarity, '-', dm + ' 极性不得改');
    assert.ok(e._measured && e._measured.n >= 10 && e._measured.citedAsMisread >= 6);
  });
});
t('开门空亡／开门+六合：只记录不加权（37 次检验里一两条过线属常态）', function () {
  var a = cond('career', 'career.开门.空亡');
  var b = (RULES.domains.career.combinations || []).concat(RULES.domains.career.conditions)
    .filter(function (x) { return x.id === 'career.开门+六合'; })[0];
  [a, b].forEach(function (x) {
    assert.ok(x._measured && /只记录、不加权、不进提示词/.test(x._measured.note));
    assert.ok(!x.answersNote || !/2026-10-05/.test(x.answersNote), '不得进提示词');
  });
});

console.log('\n== 评估器：按问句方向单列 ==');
t('分两组，其余不冒充「盼发生」', function () {
  var mk = function (q, o) { return { id: q, question: q, domain: 'general', feedback: { outcome: o } }; };
  var cases = [];
  for (var i = 0; i < 8; i++) cases.push(mk('第' + i + '回会不会被抓？', 'not_happened'));
  for (var j = 0; j < 8; j++) cases.push(mk('第' + j + '回面试能成吗？', 'happened'));
  var r = EVAL.evaluate(cases, { now: 'x' });
  var rows = r.byFraming.rows;
  assert.strictEqual(rows[0].key, 'adverse'); assert.strictEqual(rows[0].n, 8);
  assert.strictEqual(rows[0].weightedScore, 0);
  assert.strictEqual(rows[1].key, 'other'); assert.strictEqual(rows[1].weightedScore, 1);
  assert.ok(/不等于/.test(r.byFraming._note));
  assert.ok(/■ 按问句方向/.test(EVAL.toReport(r)));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
