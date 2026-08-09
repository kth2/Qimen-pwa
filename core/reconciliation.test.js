/**
 * Phase 1.1 —— 用神来源归属与两派隔离 回归测试（纯 Node，无框架）。
 * 运行：node core/reconciliation.test.js
 *
 * 这些测试锁定审计结论，防止后续扩充知识库时重新把三个概念揉成一团：
 *   ① 引擎用神（本盘实际算出的用神）
 *   ② 占类用神（这类问题"应该看什么"）
 *   ③ 证据（呈现给 LLM 的内容）
 * 以及最关键的一条：domains.json 规则源自转盘，不得渗入飞盘解读（零串味铁律）。
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var YS = require('./yongshen.js');
var EV = require('./evidence.js');
var DOMAINS = require('../knowledge/domains.json');
var SYMBOLS = require('../knowledge/symbols.json');

YS.load(DOMAINS);
EV.load(SYMBOLS);

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

var DATE = new Date('2024-04-10T10:00:00');
function zp(purpose) { return QM.qimen.calculate(DATE, { type: '四柱', method: '时家', purpose: purpose || '综合' }); }
function fp(purpose) { return QM.feipanQimen.calculate(DATE, { method: '时家', purpose: purpose || '综合' }); }
function engYong(school, chart, q, purpose) {
  var b = school === 'feipan' ? QM.feipanPredict : QM.zhuanpanPredict;
  // 镜像 app.js：回落须传引擎占类名，而非界面「目的」值
  return b.buildPrompt(chart, q, { methodText: 'M', fallbackCategory: YS.toEngineCategory(purpose) }).context.yong;
}
function names(list) { return (list || []).map(function (x) { return x.name; }); }

console.log('== 1. 引擎用神被原样保留 ==');
t('engineRule 完整保留引擎的占类/注解/落宫，未被改写', function () {
  var chart = zp('财运');
  var ey = engYong('zhuanpan', chart, '今年求财如何', '财运');
  var r = YS.resolve({ domain: 'wealth', chart: chart, options: { engineYong: ey } });
  assert.ok(r.engineRule, '应有 engineRule');
  assert.strictEqual(r.engineRule.category, ey.category);
  assert.strictEqual(r.engineRule.note, ey.note);
  assert.strictEqual(r.engineRule.matched, ey.matched);
  // 引擎算出的落宫必须逐条原样保留，不得被 domain 层重算或覆盖
  assert.deepStrictEqual(names(r.engineRule.located), names(ey.located));
  ey.located.forEach(function (e) {
    var mine = r.engineRule.located.filter(function (x) { return x.name === e.name; })[0];
    assert.strictEqual(mine.gong, e.gong, e.name + ' 宫位须与引擎一致');
  });
});
t('引擎未匹配到占类时如实记录 matched=false', function () {
  var chart = zp('综合');
  var ey = engYong('zhuanpan', chart, '随便看看', '综合');
  var r = YS.resolve({ domain: 'general', chart: chart, options: { engineYong: ey } });
  assert.strictEqual(r.engineRule.matched, false);
});

console.log('== 2. 占类用神被原样保留 ==');
t('domainRule 严格等于 domains.json，不被引擎结果污染', function () {
  var chart = zp('财运');
  var ey = engYong('zhuanpan', chart, '今年求财如何', '财运');
  var r = YS.resolve({ domain: 'wealth', chart: chart, options: { engineYong: ey } });
  var kb = DOMAINS.domains.wealth.yongshen;
  assert.deepStrictEqual(r.domainRule.self, kb.self);
  assert.deepStrictEqual(r.domainRule.primary, kb.primary);
  assert.deepStrictEqual(r.domainRule.secondary, kb.secondary, 'secondary 不得被塞入引擎用神');
  assert.deepStrictEqual(r.domainRule.opponent, kb.opponent);
});
t('传入引擎结果与否，domainRule 完全相同', function () {
  var chart = zp('婚姻');
  var a = YS.resolve({ domain: 'relationship', chart: chart });
  var b = YS.resolve({ domain: 'relationship', chart: chart, options: { engineYong: engYong('zhuanpan', chart, '感情能成吗', '婚姻') } });
  assert.deepStrictEqual(a.domainRule, b.domainRule);
});

console.log('== 3. 优先级确定且可复现 ==');
t('引擎匹配成功时 authority=engine', function () {
  var chart = zp('财运');
  var r = YS.resolve({ domain: 'wealth', chart: chart, options: { engineYong: engYong('zhuanpan', chart, '今年求财如何', '财运') } });
  assert.strictEqual(r.resolution.authority, 'engine');
  assert.ok(r.resolution.reason, '须给出裁定理由');
});
t('无引擎结果 / 引擎未匹配时 authority=domain', function () {
  var chart = zp('财运');
  assert.strictEqual(YS.resolve({ domain: 'wealth', chart: chart }).resolution.authority, 'domain');
  var ey = engYong('zhuanpan', chart, '随便看看', '综合');
  var r = YS.resolve({ domain: 'general', chart: chart, options: { engineYong: ey } });
  assert.strictEqual(r.resolution.authority, 'domain');
});
t('同输入多次调用裁定结果完全一致（确定性）', function () {
  var chart = zp('官司');
  var ey = engYong('zhuanpan', chart, '官司能赢吗', '官司');
  var a = JSON.stringify(YS.resolve({ domain: 'lawsuit', chart: chart, options: { engineYong: ey } }));
  var b = JSON.stringify(YS.resolve({ domain: 'lawsuit', chart: chart, options: { engineYong: ey } }));
  assert.strictEqual(a, b);
});
t('examine 中每个元素都标明来源 origin', function () {
  var chart = zp('财运');
  var r = YS.resolve({ domain: 'wealth', chart: chart, options: { engineYong: engYong('zhuanpan', chart, '今年求财如何', '财运') } });
  assert.ok(r.examine.length > 0);
  r.examine.forEach(function (x) {
    assert.ok(['engine', 'domain', 'both'].indexOf(x.origin) >= 0, x.name + ' 缺少合法 origin：' + x.origin);
  });
  // 生门同时见于引擎与 domains.json → both
  var sm = r.examine.filter(function (x) { return x.name === '生门'; })[0];
  assert.strictEqual(sm.origin, 'both');
  // 庚 仅 domains.json 有 → domain
  var geng = r.examine.filter(function (x) { return x.name === '庚'; })[0];
  assert.strictEqual(geng.origin, 'domain');
});

console.log('== 4. 证据包暴露裁定过程 ==');
t('Evidence 分列 domain / engine / resolution，不再合成单一 yongshen', function () {
  var chart = zp('财运');
  var r = YS.resolve({ domain: 'wealth', chart: chart, options: { engineYong: engYong('zhuanpan', chart, '今年求财如何', '财运') } });
  var ev = EV.build({ question: '今年求财如何', domain: 'wealth', chart: chart, yongshen: r });
  assert.ok(ev.yongshen.domain, '应有 yongshen.domain');
  assert.ok(ev.yongshen.engine, '应有 yongshen.engine');
  assert.ok(ev.yongshen.resolution, '应有 yongshen.resolution');
  assert.strictEqual(ev.yongshen.resolution.authority, 'engine');
});
t('提示词文本写明权威来源，供模型据此取舍', function () {
  var chart = zp('财运');
  var r = YS.resolve({ domain: 'wealth', chart: chart, options: { engineYong: engYong('zhuanpan', chart, '今年求财如何', '财运') } });
  var txt = EV.toPromptBlock(EV.build({ question: 'q', domain: 'wealth', chart: chart, yongshen: r }));
  assert.ok(/引擎用神/.test(txt), '应标出引擎用神');
  assert.ok(/占类参考|占类用神/.test(txt), '应标出占类用神');
  assert.ok(/以引擎为准|权威/.test(txt), '应写明优先级');
});
t('SYMBOL 条目记录取自知识库的哪几栏（provenance）', function () {
  var chart = zp('财运');
  var r = YS.resolve({ domain: 'wealth', chart: chart });
  var ev = EV.build({ question: 'q', domain: 'wealth', chart: chart, yongshen: r });
  var syms = ev.items.filter(function (i) { return i.type === 'SYMBOL'; });
  assert.ok(syms.length > 0);
  syms.forEach(function (s) {
    assert.strictEqual(s.source, 'knowledge/symbols.json');
    assert.ok(Array.isArray(s.fields) && s.fields.length > 0, s.element + ' 缺少 fields 溯源');
    // 声明的每一栏都必须真的在知识库里存在
    var kb = EV.getSymbol(s.category, s.element);
    s.fields.forEach(function (f) { assert.ok(Array.isArray(kb[f]), s.element + ' 声明了不存在的栏位 ' + f); });
  });
});

console.log('== 5/6. 两派隔离：飞盘仍是飞盘，转盘仍是转盘 ==');
t('自动识别盘别', function () {
  assert.strictEqual(YS.detectSchool(zp('财运')), 'zhuanpan');
  assert.strictEqual(YS.detectSchool(fp('财运')), 'feipan');
});
t('飞盘不得混入转盘专属取用（戊为财星、庚为竞争）', function () {
  var chart = fp('财运');
  var r = YS.resolve({ domain: 'wealth', chart: chart, options: { engineYong: engYong('feipan', chart, '今年求财如何', '财运') } });
  var ns = names(r.examine);
  assert.ok(ns.indexOf('戊') < 0, '飞盘不应出现转盘的财星戊：' + ns.join(','));
  assert.ok(ns.indexOf('庚') < 0, '飞盘不应出现转盘的竞争庚：' + ns.join(','));
  assert.ok(r.resolution.excluded.length > 0, '被排除的转盘取用须留痕');
  assert.ok(/转盘|串味|feipan|飞盘/.test(r.resolution.reason + JSON.stringify(r.resolution.excluded)), '须说明排除理由');
});
t('飞盘的用神落宫取自飞盘盘面（renPanMen），非转盘 baMen', function () {
  var chartF = fp('财运'), chartZ = zp('财运');
  var rf = YS.resolve({ domain: 'wealth', chart: chartF, options: { engineYong: engYong('feipan', chartF, '求财', '财运') } });
  var smF = rf.examine.filter(function (x) { return x.name === '生门'; })[0];
  assert.ok(smF, '飞盘应定位到生门');
  var expectF = Object.keys(chartF.renPanMen).filter(function (g) { return chartF.renPanMen[g] === '生门'; })[0];
  assert.strictEqual(smF.gong, expectF, '飞盘生门须取自 renPanMen');
  // 同一时刻两派生门宫位本就不同，若相同说明取错了盘
  var expectZ = Object.keys(chartZ.baMen).filter(function (g) { return chartZ.baMen[g] === '生门'; })[0];
  assert.notStrictEqual(expectF, expectZ, '前提：本例两派生门宫位应不同');
});
t('转盘不受飞盘规则影响，domains.json 取用照常生效', function () {
  var chart = zp('财运');
  var r = YS.resolve({ domain: 'wealth', chart: chart, options: { engineYong: engYong('zhuanpan', chart, '求财', '财运') } });
  var ns = names(r.examine);
  assert.ok(ns.indexOf('戊') >= 0 && ns.indexOf('庚') >= 0, '转盘应保留 domains.json 取用');
  assert.strictEqual(r.resolution.excluded.length, 0, '转盘不应有排除项');
});
t('飞盘证据包不含转盘专属符号条目', function () {
  var chart = fp('财运');
  var r = YS.resolve({ domain: 'wealth', chart: chart, options: { engineYong: engYong('feipan', chart, '求财', '财运') } });
  var ev = EV.build({ question: 'q', domain: 'wealth', chart: chart, yongshen: r });
  var els = ev.items.filter(function (i) { return i.type === 'SYMBOL'; }).map(function (s) { return s.element; });
  assert.ok(els.indexOf('戊') < 0, '飞盘证据不应含戊之象：' + els.join(','));
});
t('school 字段贯穿 resolve 与 evidence', function () {
  var chart = fp('财运');
  var r = YS.resolve({ domain: 'wealth', chart: chart });
  var ev = EV.build({ question: 'q', domain: 'wealth', chart: chart, yongshen: r });
  assert.strictEqual(r.school, 'feipan');
  assert.strictEqual(ev.school, 'feipan');
});
t('山向盘复用转盘机器，按转盘处理', function () {
  var SX = require('./shanxiang.js');
  var sxPan = SX.generateShanXiangChart({ sitting: '子', date: DATE, purpose: '风水' }, QM);
  assert.strictEqual(YS.detectSchool(sxPan), 'zhuanpan');
});

console.log('== 7. 既有 15 目的行为不变 ==');
var UI_PURPOSES = ['综合', '事业', '财运', '婚姻', '健康', '学业', '出行', '失物', '寻人', '怀孕', '官司', '风水', '射覆', '天气', '竞赛'];
t('15 个目的的引擎占类识别结果不受本层影响', function () {
  var expect = {
    '综合': '综合', '事业': '事业', '财运': '求财', '婚姻': '婚姻', '健康': '疾病',
    '学业': '功名', '出行': '出行', '失物': '失物', '寻人': '寻人', '怀孕': '怀孕',
    '官司': '官司', '风水': '风水', '射覆': '射覆', '天气': '天气', '竞赛': '竞赛'
  };
  UI_PURPOSES.forEach(function (p) {
    var chart = zp(p);
    var ey = engYong('zhuanpan', chart, '请断此事', p);
    assert.strictEqual(ey.category, expect[p], p + ' 引擎占类应为 ' + expect[p] + '，实得 ' + ey.category);
  });
});
t('未映射为专门 domain 的目的，引擎专用用神不被丢弃', function () {
  // 学业→功名(景门/天辅)、天气→天蓬/天英、竞赛→值符/天冲：这些落在 general，
  // 但引擎取用必须照样进入 examine，否则就是用泛化逻辑replace掉了好的专门逻辑
  [['学业', ['景门', '天辅']], ['天气', ['天蓬', '天英']], ['竞赛', ['值符', '天冲']],
   ['寻人', ['六合', '太阴']], ['怀孕', ['天芮', '生门']], ['风水', ['生门', '死门']]].forEach(function (c) {
    var chart = zp(c[0]);
    var ey = engYong('zhuanpan', chart, '请断此事', c[0]);
    var r = YS.resolve({ domain: YS.normalizeDomain(ey.category), chart: chart, options: { engineYong: ey } });
    var ns = names(r.examine);
    c[1].forEach(function (n) {
      assert.ok(ns.indexOf(n) >= 0, c[0] + ' 的引擎用神 ' + n + ' 丢失了：' + ns.join(','));
    });
  });
});
t('15 个目的全流程均产出完整证据包，无异常', function () {
  UI_PURPOSES.forEach(function (p) {
    var chart = zp(p);
    var ey = engYong('zhuanpan', chart, '请断此事', p);
    var r = YS.resolve({ domain: YS.normalizeDomain(ey.category), chart: chart, options: { engineYong: ey } });
    var ev = EV.build({ question: '请断此事', domain: r.domain, chart: chart, yongshen: r });
    assert.ok(EV.toPromptBlock(ev).length > 0, p + ' 证据块为空');
    assert.ok(ev.items.filter(function (i) { return i.type === 'FACT'; }).length > 0, p + ' 缺 FACT');
  });
});

console.log('== 8. 回落行为不变 ==');
t('不传 domain → general，且不抛异常', function () {
  var r = YS.resolve({ chart: zp('综合') });
  assert.strictEqual(r.domain, 'general');
});
t('知识库未加载时 resolve/build 不崩（退回原有流程）', function () {
  var Y2 = require('./yongshen.js');
  // 另起一个未 load 的实例语义：直接用未知 domain 与空盘
  assert.doesNotThrow(function () { Y2.resolve({ domain: '不存在', chart: null }); });
  assert.doesNotThrow(function () { EV.build({ domain: '不存在' }); });
});
t('缺 chart 时 examine 为空但结构完整', function () {
  var r = YS.resolve({ domain: 'wealth' });
  assert.deepStrictEqual(r.examine, []);
  assert.ok(r.domainRule, '结构仍应完整');
  assert.ok(r.resolution);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
