/**
 * Phase 20 股市占类 回归测试（纯 Node，无框架）。
 * 运行：node core/stock.test.js
 *
 * 本套出自用户所供《奇门解盘·断股市浮沉涨跌》。该文**自带四条戒律**
 * （一卦一事／不锁定点位／不作投资建议／伏反吟之诫），与判读同等要紧——
 * 那不是外加的免责声明，是原文的一部分。本文件把戒律与判读一起钉住。
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
var D = RULES.domains.stock;
var PROV = '〔用户所供·断股市浮沉涨跌·2026-08-27〕';
function zp(iso) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
}
function run(p) {
  return XY.analyze({ chart: p, domain: 'stock', wangshuai: WS.analyze(p), options: { school: 'zhuanpan' } });
}

console.log('\n== 用神：日干定盘势、时干观人心 ==');
t('主用神为日干（大盘/个股）与时干（股民/市场情绪），权重最高', function () {
  assert.strictEqual(D.roles['日干'].aspect, '大盘/个股');
  assert.strictEqual(D.roles['时干'].aspect, '市场情绪');
  assert.strictEqual(D.roles['日干'].weight, 5);
  assert.strictEqual(D.roles['时干'].weight, 5);
});
t('财星四位齐备：戊(本金)、生门(收益)、值符(主力)、景门(消息)', function () {
  assert.strictEqual(D.roles['戊'].aspect, '本金');
  assert.strictEqual(D.roles['生门'].aspect, '收益');
  assert.strictEqual(D.roles['值符'].aspect, '主力');
  assert.strictEqual(D.roles['景门'].aspect, '消息');
});
t('时干、值符、景门定为 party：本身不预设吉凶', function () {
  ['时干', '值符', '景门'].forEach(function (k) {
    assert.strictEqual(D.roles[k].roleType, 'party',
      k + ' 不该预设吉凶——人气旺、主力强、消息多，都不等于涨');
  });
});

console.log('\n== 生克口诀五条：本占的核心 ==');
t('五条口诀逐一落在 时干→日干 的关系表里', function () {
  var rel = D.relations.filter(function (r) { return r.from === '时干' && r.to === '日干'; })[0];
  assert.ok(rel, '缺少时干→日干的关系条目');
  var m = rel.map;
  // ①时干生日干→大涨 ②同宫/比和→上涨 ③时干克日干→大跌 ④日干生时干→下跌 ⑤日干克时干→不定
  assert.strictEqual(m.from_sheng_to.polarity, '+');
  assert.ok(/大涨/.test(m.from_sheng_to.concept.join('')), '①时干生日干应主大涨');
  assert.strictEqual(m.same_gong.polarity, '+');
  assert.strictEqual(m.same_element.polarity, '+');
  assert.strictEqual(m.from_ke_to.polarity, '-');
  assert.ok(/大跌/.test(m.from_ke_to.concept.join('')), '③时干克日干应主大跌');
  assert.strictEqual(m.to_sheng_from.polarity, '-');
  assert.ok(/下跌/.test(m.to_sheng_from.concept.join('')), '④日干生时干应主下跌');
  assert.strictEqual(m.to_ke_from.polarity, '0', '⑤日干克时干为涨跌不定，不得判成单向');
  assert.ok(/不定/.test(m.to_ke_from.concept.join('')));
});
t('第五条明写「须结合两宫旺衰综合决断，不可单执此条」', function () {
  var rel = D.relations.filter(function (r) { return r.from === '时干'; })[0];
  assert.ok(/不可单执此条/.test(rel.map.to_ke_from.concept.join('')));
});
t('关系条目的 basis 写明「方向由本表定，幅度与点位另看」', function () {
  var rel = D.relations.filter(function (r) { return r.from === '时干'; })[0];
  assert.ok(/方向由本表定/.test(rel.basis));
  assert.ok(/幅度另看时干宫旺衰/.test(rel.basis) && /点位另看日干宫旺衰/.test(rel.basis));
});

console.log('\n== 取数：只分大小，不给具体数字 ==');
t('日干宫旺相取大数、休囚取小数，且各自说明所定为何', function () {
  var big = D.conditions.filter(function (c) { return c.on === '日干' && /旺/.test(JSON.stringify(c.when)); })[0];
  var small = D.conditions.filter(function (c) { return c.on === '日干' && /休/.test(JSON.stringify(c.when)); })[0];
  assert.ok(/取大数/.test(big.concept.join('')));
  assert.ok(/取小数/.test(small.concept.join('')));
  assert.ok(/收盘点位/.test(big.basis), '日干宫定的是收盘点位');
});
t('时干宫定涨跌幅度，且旺衰两条都判为中性（幅度大不等于方向好）', function () {
  var cs = D.conditions.filter(function (c) { return c.on === '时干' && /gongState/.test(JSON.stringify(c.when)); });
  assert.strictEqual(cs.length, 2);
  cs.forEach(function (c) {
    assert.strictEqual(c.polarity, '0', '幅度不是方向，不得判成助或阻：' + c.id);
    assert.ok(/幅度/.test(c.concept.join('')));
  });
});
t('规则库不代为指派具体数字', function () {
  assert.ok(/不代为指派具体数字/.test(D._omittedNote));
});

console.log('\n== 四条戒律：出自原文，必须送达 ==');
t('戒律写在 safetyNote（生效字段）而非带下划线的注释字段', function () {
  assert.ok(D.safetyNote && D.safetyNote.length > 100, '缺 safetyNote');
  assert.ok(!D._boundaryNote, '不得只留在带下划线的注释字段里——那种字段从不送达');
});
t('四条戒律逐条在案', function () {
  var s = D.safetyNote;
  assert.ok(/一卦一事/.test(s), '缺①一卦一事');
  assert.ok(/不能精准锁定/.test(s), '缺②不锁定点位');
  assert.ok(/非为博利之竿|绝非投机赌博的利器/.test(s), '缺③不作投资建议');
  assert.ok(/伏吟/.test(s) && /反吟/.test(s), '缺④伏反吟之诫');
});
t('戒律确实进了证据包（xiangyi → evidence 全程）', function () {
  var p = zp('2026-08-27T10:00:00');
  var blk = EV.toPromptBlock(EV.build({
    chart: p, school: 'zhuanpan', domain: 'stock', question: '大盘明天涨吗', xiangyi: run(p) }));
  assert.ok(/本占类边界/.test(blk), '边界未出现在证据包里');
  assert.ok(/一卦一事/.test(blk));
  assert.ok(/不能精准锁定/.test(blk));
});
t('E24 已进系统提示词，且四条俱全', function () {
  var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/'E24\. 占类为\*\*股市\*\*时/.test(APP), '缺 E24');
  var seg = APP.slice(APP.indexOf("'E24."), APP.indexOf("'E24.") + 1400);
  assert.ok(/一卦一事/.test(seg));
  assert.ok(/不得报出具体点位或精确涨跌幅/.test(seg));
  assert.ok(/不得出现「建议买入\/卖出\/加仓\/满仓」一类操作指令/.test(seg));
  assert.ok(/不得承诺收益/.test(seg));
  assert.ok(/伏吟局/.test(seg) && /反吟局/.test(seg));
});
t('判读文本里不出现操作指令与获利承诺', function () {
  // 只查**判读**（concept/label），不查 safetyNote——那里引的正是原文的告诫，
  // 「并不是一张稳赚不赔的藏宝图」本身是否定句，扫全文会把它误当禁语。
  var texts = [];
  ['conditions', 'combinations'].forEach(function (k) {
    (D[k] || []).forEach(function (r) { texts.push(r.concept.join('')); });
  });
  (D.relations || []).forEach(function (r) {
    Object.keys(r.map).forEach(function (kk) { texts.push(r.map[kk].concept.join('')); });
  });
  var body = texts.join('　');
  ['建议买入', '建议卖出', '可加仓', '满仓', '稳赚', '必涨', '必跌', '保证收益', '大胆买入'].forEach(function (w) {
    assert.ok(body.indexOf(w) < 0, '判读里出现了禁语「' + w + '」');
  });
  assert.ok(texts.length > 30, '应查到全部判读文本，实得 ' + texts.length);
});
t('戒律里则**应当**保留原文的否定句（那是告诫，不是承诺）', function () {
  assert.ok(/并不是一张稳赚不赔的藏宝图/.test(D.safetyNote), '原文这句告诫不该被删掉');
});

console.log('\n== 判读能跑，且出处可辨 ==');
t('四十盘试跑无零命中，命中率与既有占类同级', function () {
  var t0 = new Date('2026-01-01T00:00:00').getTime(), tot = 0, zero = 0, n = 0;
  for (var i = 0; i < 40; i++) {
    var p = zp(new Date(t0 + i * 3600 * 1000 * 37).toISOString());
    if (!p || p.error) continue;
    n++;
    var r = run(p);
    tot += r.readings.length;
    if (!r.readings.length) zero++;
  }
  assert.strictEqual(zero, 0, '有 ' + zero + '/' + n + ' 盘一条都没命中');
  assert.ok(tot / n >= 3 && tot / n <= 12, '平均 ' + (tot / n).toFixed(1) + ' 条，超出合理区间');
});
t('每条 basis 都以〔用户所供·断股市浮沉涨跌〕起头，不冒充纲要', function () {
  var bad = [];
  ['conditions', 'combinations', 'relations'].forEach(function (k) {
    (D[k] || []).forEach(function (r) { if (String(r.basis).indexOf(PROV) !== 0) bad.push(r.id); });
  });
  Object.keys(D.roles).forEach(function (n) {
    if (String(D.roles[n].basis).indexOf(PROV) !== 0) bad.push('role ' + n);
  });
  assert.deepStrictEqual(bad, [], '未标明出处：' + bad.join('、'));
});
t('多处直引原文，可回溯核对', function () {
  var all = JSON.stringify(D);
  ['日干以定盘势', '时干以观人心', '戊为资财', '生为利禄', '值符掌主力之动向',
   '九天冲高', '九地沉伏'].forEach(function (w) {
    assert.ok(all.indexOf(w) >= 0, '未引用原文「' + w + '」');
  });
});
t('零串味：飞盘上一条都不跑', function () {
  var f = QM.feipanQimen.calculate(new Date('2026-08-27T10:00:00'), { method: '时家', purpose: '综合' });
  var r = XY.analyze({ chart: f, domain: 'stock', wangshuai: WS.analyze(f), options: { school: 'feipan' } });
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.readings.length, 0);
});
t('同盘两次结果逐字相同（确定性）', function () {
  var p = zp('2026-08-27T10:00:00');
  assert.strictEqual(JSON.stringify(run(p)), JSON.stringify(run(p)));
});

console.log('\n== 顺带修好的：怀孕的安全边界此前从未送达 ==');
t('pregnancy 的 safetyNote 已改为生效字段并真的进了证据包', function () {
  var pg = RULES.domains.pregnancy;
  assert.ok(pg.safetyNote, 'pregnancy 缺 safetyNote');
  assert.ok(!pg._safetyNote, '带下划线的字段从不送达，不得只留在那里');
  var p = zp('2026-08-27T10:00:00');
  var xy = XY.analyze({ chart: p, domain: 'pregnancy', wangshuai: WS.analyze(p), options: { school: 'zhuanpan' } });
  var blk = EV.toPromptBlock(EV.build({ chart: p, school: 'zhuanpan', domain: 'pregnancy', question: 'x', xiangyi: xy }));
  assert.ok(/不得作医学诊断/.test(blk), '怀孕的安全边界仍未送达');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
