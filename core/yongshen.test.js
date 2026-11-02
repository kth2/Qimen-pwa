/**
 * 用神(YongShen) core 单元测试（纯 Node，无框架）。
 * 运行：node core/yongshen.test.js
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var YS = require('./yongshen.js');
var DOMAINS = require('../knowledge/domains.json');

YS.load(DOMAINS);

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

// 固定盘：同一时刻必得同一盘，测试才可重复
function pan(purpose) {
  return QM.qimen.calculate(new Date('2024-04-10T10:00:00'), { type: '四柱', method: '时家', purpose: purpose || '综合' });
}
// roles 各槽合并成扁平名单，便于断言"某用神在册"
function allNames(r) {
  var d = r.domainRule;   // Phase 1.1：占类用神已与引擎用神分列，此处只看占类侧
  return [].concat(d.self, d.primary, d.secondary, d.opponent);
}

console.log('== 占类归一化 ==');
t('中文界面「目的」→ domain id', function () {
  assert.strictEqual(YS.normalizeDomain('财运'), 'wealth');
  assert.strictEqual(YS.normalizeDomain('事业'), 'career');
  assert.strictEqual(YS.normalizeDomain('婚姻'), 'relationship');
  assert.strictEqual(YS.normalizeDomain('健康'), 'health');
  assert.strictEqual(YS.normalizeDomain('官司'), 'lawsuit');
  assert.strictEqual(YS.normalizeDomain('失物'), 'lost_item');
});
t('引擎既有中文占类 → domain id', function () {
  assert.strictEqual(YS.normalizeDomain('求财'), 'wealth');
  assert.strictEqual(YS.normalizeDomain('疾病'), 'health');
  assert.strictEqual(YS.normalizeDomain('寻物'), 'lost_item');
});
t('英文 domain id 原样通过', function () {
  assert.strictEqual(YS.normalizeDomain('wealth'), 'wealth');
  assert.strictEqual(YS.normalizeDomain('general'), 'general');
});
t('未知/缺省一律回落 general（向后兼容的关键）', function () {
  assert.strictEqual(YS.normalizeDomain(''), 'general');
  assert.strictEqual(YS.normalizeDomain(null), 'general');
  assert.strictEqual(YS.normalizeDomain(undefined), 'general');
  assert.strictEqual(YS.normalizeDomain('毫无关系的字串'), 'general');
  // 「天气」曾因无专条而回落 general；Phase 19 补了 weather 专条后它自有归属。
  // 回落 general 这条兜底仍在，只是不再拿一个**已有专条**的占类去验它。
  assert.strictEqual(YS.normalizeDomain('天气'), 'weather');
});

console.log('== 各占类用神映射（规格要求的最低集合）==');
t('wealth → 生门 / 日干 / 庚', function () {
  var r = YS.resolve({ domain: 'wealth', chart: pan('财运') });
  assert.strictEqual(r.domain, 'wealth');
  assert.ok(r.domainRule.primary.indexOf('生门') >= 0, 'primary 应含生门');
  assert.ok(r.domainRule.self.indexOf('日干') >= 0, 'self 应为日干');
  assert.ok(r.domainRule.opponent.indexOf('庚') >= 0, 'opponent 应含庚');
});
t('career → 开门 / 日干 / 值符 / 庚', function () {
  var r = YS.resolve({ domain: 'career', chart: pan('事业') });
  var n = allNames(r);
  ['开门', '日干', '值符', '庚'].forEach(function (x) {
    assert.ok(n.indexOf(x) >= 0, '应含 ' + x);
  });
});
t('relationship → 六合 / 日干', function () {
  var r = YS.resolve({ domain: 'relationship', chart: pan('婚姻') });
  var n = allNames(r);
  assert.ok(n.indexOf('六合') >= 0, '应含六合');
  assert.ok(n.indexOf('日干') >= 0, '应含日干');
});
t('health → 天芮 / 天心 / 生门', function () {
  var r = YS.resolve({ domain: 'health', chart: pan('健康') });
  var n = allNames(r);
  ['天芮', '天心', '生门'].forEach(function (x) {
    assert.ok(n.indexOf(x) >= 0, '应含 ' + x);
  });
});
t('lawsuit → 惊门 / 值符 / 庚', function () {
  var r = YS.resolve({ domain: 'lawsuit', chart: pan('官司') });
  var n = allNames(r);
  ['惊门', '值符', '庚'].forEach(function (x) {
    assert.ok(n.indexOf(x) >= 0, '应含 ' + x);
  });
});
t('lost_item → 玄武 / 伤门（隐匿看杜门）', function () {
  var r = YS.resolve({ domain: 'lost_item', chart: pan('失物') });
  var n = allNames(r);
  ['玄武', '伤门', '杜门'].forEach(function (x) {
    assert.ok(n.indexOf(x) >= 0, '应含 ' + x);
  });
});

console.log('== 落宫定位 ==');
t('用神元素能定位到具体宫位', function () {
  var p = pan('财运');
  var r = YS.resolve({ domain: 'wealth', chart: p });
  assert.ok(Array.isArray(r.examine), 'examine 应为数组');
  var sm = r.examine.filter(function (x) { return x.name === '生门'; })[0];
  assert.ok(sm, '应定位到生门');
  // 与引擎排盘直接核对，杜绝"编造宫位"
  var expect = Object.keys(p.baMen).filter(function (g) { return p.baMen[g] === '生门'; })[0];
  assert.strictEqual(sm.gong, expect, '生门宫位须与引擎 baMen 一致');
  assert.ok(sm.gongName, '应带宫名');
});
t('日干解析为四柱实际日干并定位天盘', function () {
  var p = pan('财运');
  var r = YS.resolve({ domain: 'wealth', chart: p });
  assert.strictEqual(r.actors.riGan, p.siZhu.day.charAt(0));
  assert.strictEqual(r.actors.shiGan, p.siZhu.time.charAt(0));
});
t('值使定位到引擎给出的值使宫（不另算）', function () {
  var p = pan('综合');
  var r = YS.resolve({ domain: 'general', chart: p });
  var zs = r.examine.filter(function (x) { return x.name === '值使'; })[0];
  assert.ok(zs, '应定位到值使');
  assert.strictEqual(zs.gong, String(p.zhiShiGong));
});

console.log('== 确定性与不越界 ==');
t('同盘同占类两次调用结果完全一致', function () {
  var p = pan('财运');
  var a = JSON.stringify(YS.resolve({ domain: 'wealth', chart: p }));
  var b = JSON.stringify(YS.resolve({ domain: 'wealth', chart: p }));
  assert.strictEqual(a, b);
});
t('不产出吉凶判定（只指出该看什么）', function () {
  var r = YS.resolve({ domain: 'wealth', chart: pan('财运') });
  var s = JSON.stringify(r);
  assert.ok(!/"judgment"|"jiXiong"|"conclusion"/.test(s), '不得含吉凶结论字段');
  assert.strictEqual(r.source, 'domain-rule');
});
t('引擎既有用神判定被保留而非取代', function () {
  var p = pan('财运');
  var eng = QM.zhuanpanPredict.classifyQuestion('今年求财如何');
  var r = YS.resolve({ domain: 'wealth', chart: p, options: { engineYong: eng } });
  assert.ok(r.engineRule, '应保留 engineRule 字段');
  assert.strictEqual(r.engineRule.category, '求财');
  assert.ok(r.engineRule.note, '应保留引擎注解');
  assert.strictEqual(r.resolution.authority, 'engine', '引擎匹配时应以引擎为准');
});
t('结果可 JSON 序列化', function () {
  var r = YS.resolve({ domain: 'career', chart: pan('事业') });
  assert.doesNotThrow(function () { JSON.parse(JSON.stringify(r)); });
});

console.log('== 防御性 ==');
t('缺 domain 时按 general 处理（向后兼容）', function () {
  var r = YS.resolve({ chart: pan('综合') });
  assert.strictEqual(r.domain, 'general');
});
t('缺 chart 不抛异常，located 为空', function () {
  var r = YS.resolve({ domain: 'wealth' });
  assert.strictEqual(r.domain, 'wealth');
  assert.deepStrictEqual(r.examine, []);
});
t('完全空参数不抛异常', function () {
  assert.doesNotThrow(function () { YS.resolve(); });
  assert.doesNotThrow(function () { YS.resolve({}); });
});
t('飞盘（不同 schema）亦可定位，不报错', function () {
  var fp = QM.feipanQimen.calculate(new Date('2024-04-10T10:00:00'), { method: '时家', purpose: '财运' });
  var ey = QM.feipanPredict.buildPrompt(fp, '今年求财如何', { methodText: 'M', fallbackCategory: '求财' }).context.yong;
  var r = YS.resolve({ domain: 'wealth', chart: fp, options: { engineYong: ey } });
  assert.strictEqual(r.school, 'feipan', '应识别为飞盘');
  assert.ok(r.examine.length > 0, '飞盘应至少定位到一个元素');
  // 定位须取自飞盘盘面，不得读转盘的 baMen
  var sm = r.examine.filter(function (x) { return x.name === '生门'; })[0];
  var expect = Object.keys(fp.renPanMen).filter(function (g) { return fp.renPanMen[g] === '生门'; })[0];
  assert.strictEqual(sm.gong, expect);
});
t('飞盘在无引擎取用时，不得擅自套用转盘占类取用', function () {
  var fp = QM.feipanQimen.calculate(new Date('2024-04-10T10:00:00'), { method: '时家', purpose: '财运' });
  var r = YS.resolve({ domain: 'wealth', chart: fp });
  assert.strictEqual(r.examine.length, 0, '无引擎依据时飞盘不应凭转盘规则取用');
  assert.ok(r.resolution.excluded.length > 0, '排除须留痕而非静默丢弃');
});

console.log('== 主用神 pickMain（Phase 44）==');
function mainOf(ui, sch, date, nm) {
  var ec = YS.toEngineCategory(ui, sch);
  var p = sch === 'feipan' ? QM.feipanQimen.calculate(date, { method: '时家', purpose: ui })
    : QM.qimen.calculate(date, { type: '四柱', method: '时家', purpose: ui, location: '默认位置' });
  var b = sch === 'feipan' ? QM.feipanPredict : QM.zhuanpanPredict;
  var ctx = (b.buildPrompt(p, '', { category: ec, fallbackCategory: ec, nianMingGan: nm || '' }) || {}).context || {};
  return { pan: p, m: YS.pickMain(YS.resolve({ domain: ui, chart: p, options: { engineYong: ctx.yong, school: sch, nianMingGan: nm || '' } })) };
}
var D1 = new Date(2026, 9, 30, 12, 46);   // 阴遁
var D2 = new Date(2026, 3, 10, 9, 0);     // 阳遁
t('引擎本盘分析不认的占类也有主用神：股市→生门（按求财）、行人→开门', function () {
  var s = mainOf('股市', 'zhuanpan', D1);
  assert.ok(!(s.pan.analysis && s.pan.analysis.yongShen), '前提：引擎本盘分析不认股市');
  assert.strictEqual(s.m.name, '生门'); assert.strictEqual(s.m.source, 'engine'); assert.strictEqual(s.m.category, '求财');
  assert.strictEqual(String(s.pan.baMen[s.m.gong]), '生门');
  assert.strictEqual(mainOf('行人', 'zhuanpan', D1).m.name, '开门');
});
t('引擎无此占类（按综合排）→ 取占类表 primary：终身局→年命、异梦→腾蛇；终身局无年命则无', function () {
  var a = mainOf('终身局', 'zhuanpan', D1, '庚').m;
  assert.strictEqual(a.name, '年命'); assert.strictEqual(a.source, 'domain');
  assert.strictEqual(mainOf('异梦', 'zhuanpan', D1).m.name, '腾蛇');
  assert.strictEqual(mainOf('终身局', 'zhuanpan', D1, '').m, null);
  assert.strictEqual(mainOf('综合', 'zhuanpan', D1).m, null, '综合（通用占类）不挑，照旧综观全盘');
});
t('飞盘阳遁无白虎：出行顺延到开门；阴遁照取白虎。盗贼阳遁无玄武即无，不以朱雀代', function () {
  var y = mainOf('出行', 'feipan', D2);
  assert.strictEqual(y.pan.juShu.type, 'yang');
  assert.strictEqual(y.m.name, '开门');
  var n = mainOf('出行', 'feipan', D1);
  assert.strictEqual(n.pan.juShu.type, 'yin');
  assert.strictEqual(n.m.name, '白虎');
  assert.strictEqual(mainOf('盗贼', 'feipan', D2).m, null);
});
t('转盘天芮写作「禽芮」：主用神取其宫（与 locate 的星名合称规则一致）', function () {
  var s = mainOf('健康', 'zhuanpan', D1);
  assert.strictEqual(s.m.name, '天芮');
  assert.ok(/芮/.test(s.pan.jiuXing[s.m.gong]));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
