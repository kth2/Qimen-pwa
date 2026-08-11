/**
 * 应期时间线(Timing) core 单元测试（纯 Node，无框架）。
 * 运行：node core/timing.test.js
 *
 * 重点守住五件事：
 *   ① 绝不重算干支——每个锚点的支/干都必须能在 yingqi 的输出里原样找到；
 *   ② 强弱＝机制与用神的关系，由规则库显式声明，不是打分；
 *   ③ 距今位次算得对（地支 12 循环、天干 10 循环），且时间线确实按位次排序；
 *   ④ 零串味到机制一级：马星只在转盘启用，飞盘下不得出现；
 *   ⑤ 缺件降级：无 yingqi 一律停用，绝不自行推算。
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var TM = require('./timing.js');
var YQ = require('./yingqi.js');
var WS = require('./wangshuai.js');
var XY = require('./xiangyi.js');
var RULES = require('../knowledge/timing-rules.json');
var DOMAIN_RULES = require('../knowledge/domain-rules.json');

TM.load(RULES);
XY.load(DOMAIN_RULES);

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

function chartAt(iso) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '财运' });
}
/** 完整链路：wangshuai → xiangyi → yingqi → timing */
function run(chart, domain, opts) {
  opts = opts || {};
  var ws = WS.analyze(chart);
  var xy = opts.noXiangyi ? null : XY.analyze({ domain: domain || 'wealth', chart: chart, wangshuai: ws, options: opts.xyOptions });
  var gongs = xy && xy.applicable ? xy.focus.map(function (f) { return f.gong; }) : (opts.yongShenGongs || []);
  var yq = opts.noYingqi ? null : YQ.analyze(chart, { yongShenGongs: gongs });
  return TM.analyze({
    chart: chart, yingqi: yq, xiangyi: xy, wangshuai: opts.noWangshuai ? null : ws,
    options: { domain: domain || 'wealth', school: opts.school, yongShenGongs: opts.yongShenGongs }
  });
}

var CHART = chartAt('2024-04-10T10:00:00');
var RES = run(CHART, 'wealth');

var SAMPLES = (function () {
  var out = [], d = new Date('2024-01-01T09:00:00');
  for (var i = 0; i < 90; i++) out.push(chartAt(new Date(d.getTime() + i * 41 * 3600 * 1000).toISOString()));
  return out;
})();

console.log('== 规则库自检 ==');
t('规则库可加载，机制齐备且各带出处', function () {
  assert.ok(TM.isLoaded());
  ['填实', '冲实', '冲墓', '马星', '宫干定日'].forEach(function (k) {
    var m = RULES.mechanisms[k];
    assert.ok(m, '缺机制 ' + k);
    assert.ok(m.basis && /纲要/.test(m.basis), k + ' 的 basis 须引纲要：' + m.basis);
    assert.ok(['zhi', 'gan'].indexOf(m.kind) >= 0, k + ' kind 非法');
    assert.ok(RULES.strengthLevels[m.onTarget], k + ' onTarget 未在 strengthLevels 中声明：' + m.onTarget);
    assert.ok((m.appliesTo || []).length > 0, k + ' 缺 appliesTo');
  });
});
t('两派通用的机制，basis 须同时注明两份纲要（非由一派推及另一派）', function () {
  Object.keys(RULES.mechanisms).forEach(function (k) {
    var m = RULES.mechanisms[k];
    if (m.appliesTo.length < 2) return;
    assert.ok(/转盘纲要/.test(m.basis) && /飞盘纲要/.test(m.basis),
      k + ' 声称两派通用，basis 却未分别引两份纲要：' + m.basis);
  });
});
t('只在转盘启用的机制，须写明为何不及飞盘', function () {
  Object.keys(RULES.mechanisms).forEach(function (k) {
    var m = RULES.mechanisms[k];
    if (m.appliesTo.length !== 1) return;
    assert.strictEqual(m.appliesTo[0], 'zhuanpan');
    assert.ok(m._schoolOmit && /飞盘/.test(m._schoolOmit), k + ' 须说明为何不在飞盘启用');
  });
});
t('地支/天干序表正确', function () {
  assert.strictEqual(RULES.zhiOrder.length, 12);
  assert.strictEqual(RULES.ganOrder.length, 10);
  assert.deepStrictEqual(RULES.zhiOrder.slice(0, 3), ['子', '丑', '寅']);
  assert.deepStrictEqual(RULES.ganOrder.slice(0, 3), ['甲', '乙', '丙']);
});

console.log('== 绝不重算干支：锚点必可在 yingqi 输出中找到 ==');
t('每个锚点的干支都出自 yingqi，未自造日辰', function () {
  var checked = 0;
  SAMPLES.forEach(function (c) {
    var ws = WS.analyze(c);
    var xy = XY.analyze({ domain: 'wealth', chart: c, wangshuai: ws });
    var yq = YQ.analyze(c, { yongShenGongs: xy.focus.map(function (f) { return f.gong; }) });
    var r = TM.analyze({ chart: c, yingqi: yq, xiangyi: xy, wangshuai: ws, options: { domain: 'wealth' } });
    // 收集 yingqi 认可的全部干支
    var okZhi = {}, okGan = {};
    (yq.kongWang.tianShi || []).forEach(function (d) { okZhi[d.charAt(0)] = 1; });
    (yq.kongWang.chongShi || []).forEach(function (d) { okZhi[d.charAt(0)] = 1; });
    (yq.ruMu || []).forEach(function (m) { okZhi[m.chongMu.charAt(0)] = 1; });
    if (yq.maXing && yq.maXing.zhi) okZhi[yq.maXing.zhi] = 1;
    Object.keys(yq.gongGan || {}).forEach(function (g) {
      okGan[yq.gongGan[g].tianGan] = 1; okGan[yq.gongGan[g].diGan] = 1;
    });
    r.anchors.forEach(function (a) {
      checked++;
      if (a.kind === 'zhi') assert.ok(okZhi[a.value], a.id + ' 的支 ' + a.value + ' 不在 yingqi 输出中——疑似自造');
      else assert.ok(okGan[a.value], a.id + ' 的干 ' + a.value + ' 不在 yingqi 输出中——疑似自造');
    });
  });
  assert.ok(checked > 200, '应检验到足量锚点，实得 ' + checked);
});
t('填实之支恒等于本盘空亡支，冲实之支恒为其六冲', function () {
  var checked = 0;
  SAMPLES.forEach(function (c) {
    var r = run(c, 'wealth');
    var kwZhi = (c.kongWangZhi || []).map(String);
    r.anchors.forEach(function (a) {
      if (a.mechanism === '填实') {
        checked++;
        assert.ok(kwZhi.indexOf(a.value) >= 0, '填实取了非空亡支 ' + a.value + '（本盘空亡 ' + kwZhi.join('/') + '）');
      }
      if (a.mechanism === '冲实') {
        checked++;
        assert.ok(kwZhi.some(function (z) { return YQ.chongOf(z) === a.value; }),
          '冲实取了非六冲支 ' + a.value + '（本盘空亡 ' + kwZhi.join('/') + '）');
      }
    });
  });
  assert.ok(checked > 30, '应检验到足量填实/冲实锚点，实得 ' + checked);
});
t('填实/冲实一律为地支，绝不用天干充数（实测错法的回归）', function () {
  var GAN = RULES.ganOrder;
  SAMPLES.forEach(function (c) {
    run(c, 'wealth').anchors.forEach(function (a) {
      if (['填实', '冲实', '冲墓', '马星'].indexOf(a.mechanism) < 0) return;
      assert.strictEqual(a.kind, 'zhi', a.mechanism + ' 必须是地支类');
      assert.ok(GAN.indexOf(a.value) < 0, a.mechanism + ' 取了天干 ' + a.value + '——正是纲要严禁的错法');
      assert.ok(RULES.zhiOrder.indexOf(a.value) >= 0, a.mechanism + ' 的值不是合法地支：' + a.value);
    });
  });
});
t('宫干定日一律为天干，且确为该宫天/地盘干', function () {
  var checked = 0;
  SAMPLES.forEach(function (c) {
    var r = run(c, 'wealth');
    r.anchors.forEach(function (a) {
      if (a.mechanism !== '宫干定日') return;
      checked++;
      assert.strictEqual(a.kind, 'gan');
      var tg = (c.tianPan || {})[a.gong], dg = (c.diPan || {})[a.gong];
      assert.ok(a.value === tg || a.value === dg,
        a.gong + '宫干日取了 ' + a.value + '，但该宫天盘=' + tg + ' 地盘=' + dg);
    });
  });
  assert.ok(checked > 50, '应检验到足量宫干锚点，实得 ' + checked);
});

console.log('== 强弱：机制与用神的关系，非打分 ==');
t('强弱级别由规则库显式声明，不由描述字段推断', function () {
  SAMPLES.forEach(function (c) {
    run(c, 'wealth').anchors.forEach(function (a) {
      var m = RULES.mechanisms[a.mechanism];
      var expect = a.targets.length ? m.onTarget : 'low';
      assert.strictEqual(a.strength, expect, a.id + ' 强弱应为 ' + expect);
    });
  });
});
t('落在用神宫的填实/冲实/冲墓为 high，宫干定日与马星为 medium', function () {
  var seen = {};
  SAMPLES.forEach(function (c) {
    run(c, 'wealth').anchors.forEach(function (a) {
      if (!a.targets.length) return;
      seen[a.mechanism] = a.strength;
    });
  });
  ['填实', '冲实', '冲墓'].forEach(function (k) {
    if (seen[k]) assert.strictEqual(seen[k], 'high', k + ' 落用神宫应为 high');
  });
  ['宫干定日', '马星'].forEach(function (k) {
    if (seen[k]) assert.strictEqual(seen[k], 'medium', k + ' 应为 medium（非解开某一害）');
  });
  assert.ok(Object.keys(seen).length >= 3, '样本应覆盖多种机制，实得 ' + Object.keys(seen).join('/'));
});
t('非用神宫的锚点一律 low，且如实标注', function () {
  var got = 0;
  SAMPLES.forEach(function (c) {
    run(c, 'wealth').anchors.forEach(function (a) {
      if (a.targets.length) return;
      got++;
      assert.strictEqual(a.strength, 'low');
      assert.ok(/非本占用神宫/.test(a.why), '非用神宫锚点须说明缘由：' + a.why);
    });
  });
  // 非用神宫锚点未必每盘都有，只要出现就必须合规
  assert.ok(got >= 0);
});
t('锚点的 targets 确实落在该宫（用神与宫位对得上）', function () {
  SAMPLES.forEach(function (c) {
    var ws = WS.analyze(c);
    var xy = XY.analyze({ domain: 'wealth', chart: c, wangshuai: ws });
    var yq = YQ.analyze(c, { yongShenGongs: xy.focus.map(function (f) { return f.gong; }) });
    var r = TM.analyze({ chart: c, yingqi: yq, xiangyi: xy, wangshuai: ws, options: { domain: 'wealth' } });
    r.anchors.forEach(function (a) {
      a.targets.forEach(function (tg) {
        var f = xy.focus.filter(function (x) { return x.name === tg.name; })[0];
        assert.ok(f, a.id + ' 引了不存在的用神 ' + tg.name);
        assert.strictEqual(f.gong, a.gong, tg.name + ' 实落 ' + f.gong + ' 宫，锚点却记 ' + a.gong);
        assert.strictEqual(tg.weight, f.weight, tg.name + ' 权重与 xiangyi 不符');
      });
    });
  });
});

console.log('== 距今位次与时间线 ==');
t('offsetIn：地支 12 循环、天干 10 循环，回绕正确', function () {
  var Z = RULES.zhiOrder, G = RULES.ganOrder;
  assert.strictEqual(TM.offsetIn(Z, '子', '子'), 0);
  assert.strictEqual(TM.offsetIn(Z, '子', '丑'), 1);
  assert.strictEqual(TM.offsetIn(Z, '亥', '子'), 1, '亥→子应回绕为 1');
  assert.strictEqual(TM.offsetIn(Z, '午', '巳'), 11, '午→巳应回绕为 11');
  assert.strictEqual(TM.offsetIn(G, '甲', '癸'), 9);
  assert.strictEqual(TM.offsetIn(G, '癸', '甲'), 1, '癸→甲应回绕为 1');
  assert.strictEqual(TM.offsetIn(Z, '子', '不存在'), null);
});
t('锚点的 offset 与本盘日支/日干一致', function () {
  SAMPLES.forEach(function (c) {
    var r = run(c, 'wealth');
    var dz = c.siZhu.day.charAt(1), dg = c.siZhu.day.charAt(0);
    assert.strictEqual(r.dayZhi, dz);
    assert.strictEqual(r.dayGan, dg);
    r.anchors.forEach(function (a) {
      var order = a.kind === 'gan' ? RULES.ganOrder : RULES.zhiOrder;
      var from = a.kind === 'gan' ? dg : dz;
      assert.strictEqual(a.offset, TM.offsetIn(order, from, a.value), a.id + ' 位次算错');
      assert.ok(a.offset >= 0 && a.offset < order.length, a.id + ' 位次越界');
    });
  });
});
t('timeline 严格按距今位次升序（同位次以强弱优先）', function () {
  SAMPLES.forEach(function (c) {
    var tl = run(c, 'wealth').timeline;
    for (var i = 1; i < tl.length; i++) {
      var p = tl[i - 1].offset == null ? 99 : tl[i - 1].offset;
      var q = tl[i].offset == null ? 99 : tl[i].offset;
      assert.ok(p <= q, '时间线未按位次升序：' + tl[i - 1].value + '(' + p + ') 在 ' + tl[i].value + '(' + q + ') 之前');
    }
  });
});
t('anchors 按强弱→权重→位次排序（与 timeline 各司其职）', function () {
  var RANK = { high: 3, medium: 2, low: 1 };
  SAMPLES.forEach(function (c) {
    var an = run(c, 'wealth').anchors;
    for (var i = 1; i < an.length; i++) {
      var a = an[i - 1], b = an[i];
      var sa = RANK[a.strength], sb = RANK[b.strength];
      assert.ok(sa > sb || (sa === sb && (a.weight > b.weight ||
        (a.weight === b.weight && ((a.offset == null ? 99 : a.offset) <= (b.offset == null ? 99 : b.offset))))),
        '锚点排序不稳定：' + a.id + ' 在 ' + b.id + ' 之前');
    }
  });
});
t('锚点数受上限约束，超出时留痕', function () {
  SAMPLES.forEach(function (c) {
    var r = run(c, 'wealth');
    assert.ok(r.anchors.length <= 12, '锚点超上限：' + r.anchors.length);
    if (r.notes.some(function (n) { return /取前/.test(n); })) {
      assert.strictEqual(r.anchors.length, 12, '声称截断则应正好取满上限');
    }
  });
});

console.log('== 迟速（纲要·三节应期5） ==');
t('迟速取权重最高之用神的旺衰，且与规则库映射一致', function () {
  var checked = 0;
  SAMPLES.forEach(function (c) {
    var ws = WS.analyze(c);
    var xy = XY.analyze({ domain: 'wealth', chart: c, wangshuai: ws });
    var yq = YQ.analyze(c, { yongShenGongs: xy.focus.map(function (f) { return f.gong; }) });
    var r = TM.analyze({ chart: c, yingqi: yq, xiangyi: xy, wangshuai: ws, options: { domain: 'wealth' } });
    if (!r.pace) return;
    checked++;
    var lead = xy.focus[0];
    assert.strictEqual(r.pace.from, lead.name, '迟速须取权重最高之用神');
    assert.strictEqual(r.pace.gong, lead.gong);
    assert.strictEqual(r.pace.speed, RULES.pace.map[r.pace.state].speed, '迟速与规则库映射不符');
    assert.ok(/纲要/.test(r.pace.basis), '迟速须带纲要出处');
  });
  assert.ok(checked > 30, '应检验到足量迟速判定，实得 ' + checked);
});
t('用神入墓/空亡时，迟速须附「须待冲墓/填实方发」之注', function () {
  var seenMu = 0, seenKong = 0;
  SAMPLES.forEach(function (c) {
    var ws = WS.analyze(c);
    var xy = XY.analyze({ domain: 'wealth', chart: c, wangshuai: ws });
    var yq = YQ.analyze(c, { yongShenGongs: xy.focus.map(function (f) { return f.gong; }) });
    var r = TM.analyze({ chart: c, yingqi: yq, xiangyi: xy, wangshuai: ws, options: { domain: 'wealth' } });
    if (!r.pace) return;
    var flags = xy.focus[0].flags || [];
    if (flags.indexOf('入墓') >= 0) { seenMu++; assert.ok(/冲墓/.test(r.pace.note), '入墓须注明待冲墓：' + r.pace.note); }
    if (flags.indexOf('空亡') >= 0) { seenKong++; assert.ok(/填实/.test(r.pace.note), '空亡须注明待填实：' + r.pace.note); }
  });
  assert.ok(seenMu + seenKong > 0, '样本中应出现用神入墓或空亡的情形');
});
t('无 wangshuai 时不产出迟速（不臆断）', function () {
  var r = run(CHART, 'wealth', { noWangshuai: true });
  assert.strictEqual(r.pace, null, '缺旺衰数据时不得凭空判定迟速');
});

console.log('== 零串味：机制一级的盘别隔离 ==');
t('马星只在转盘启用，飞盘下不得出现', function () {
  var seenZhuan = 0;
  SAMPLES.forEach(function (c) {
    if (run(c, 'wealth').anchors.some(function (a) { return a.mechanism === '马星'; })) seenZhuan++;
    var fp = run(c, 'wealth', { school: 'feipan', yongShenGongs: ['1', '2'] });
    assert.ok(!fp.anchors.some(function (a) { return a.mechanism === '马星'; }),
      '飞盘下不得出现马星取期（飞盘纲要应期节未列此法）');
  });
  assert.ok(seenZhuan > 0, '转盘下应出现马星锚点，实得 ' + seenZhuan);
});
t('飞盘下两派通用的机制仍照常工作（不是整层关掉）', function () {
  var fp = run(CHART, 'wealth', { school: 'feipan', yongShenGongs: ['2', '6'] });
  assert.strictEqual(fp.school, 'feipan');
  assert.ok(fp.anchors.length > 0, '填实/冲实/冲墓/宫干定日两派通用，飞盘下应仍有锚点');
  fp.anchors.forEach(function (a) {
    assert.ok((RULES.mechanisms[a.mechanism].appliesTo).indexOf('feipan') >= 0,
      a.mechanism + ' 不适用于飞盘却出现了');
  });
});
t('飞盘下用神取用退回引擎，绝不带入转盘占类取用', function () {
  var fpChart = { renPanMen: { '1': '生门' }, tianPanYi: { '1': '戊' }, siZhu: CHART.siZhu };
  var xy = XY.analyze({ domain: 'wealth', chart: fpChart });
  assert.strictEqual(xy.applicable, false, '前提：转盘占类层在飞盘上已停用');
  var yq = YQ.analyze(CHART, { yongShenGongs: ['2'] });
  var r = TM.analyze({ chart: CHART, yingqi: yq, xiangyi: xy, wangshuai: WS.analyze(CHART), options: { school: 'feipan', yongShenGongs: ['2'] } });
  assert.strictEqual(r.targetSource, 'engine', '飞盘须退回引擎用神宫');
  r.anchors.forEach(function (a) {
    a.targets.forEach(function (tg) {
      assert.strictEqual(tg.name, '用神', '飞盘下不得出现转盘占类角色名：' + tg.name);
      assert.strictEqual(tg.weight, 0, '飞盘下无占类权重，须如实记 0 而非编造');
    });
  });
});

console.log('== 缺件降级 ==');
t('未传 yingqi 一律停用，绝不自行推算干支', function () {
  var r = run(CHART, 'wealth', { noYingqi: true });
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.anchors.length, 0);
  assert.ok(/绝不自行推算|停用/.test(r.reason), r.reason);
  assert.strictEqual(TM.toPromptBlock(r), '');
});
t('规则库未加载时停用而非崩溃', function () {
  TM.load(null);
  var r = run(CHART, 'wealth');
  assert.strictEqual(r.applicable, false);
  assert.ok(/未加载/.test(r.reason));
  TM.load(RULES);
});
t('无 xiangyi 时退回引擎用神宫，仍可产出锚点', function () {
  var yq = YQ.analyze(CHART, { yongShenGongs: ['2', '8'] });
  var r = TM.analyze({ chart: CHART, yingqi: yq, wangshuai: WS.analyze(CHART), options: { yongShenGongs: ['2', '8'] } });
  assert.strictEqual(r.targetSource, 'engine');
  assert.ok(r.anchors.length > 0);
});
t('既无 xiangyi 又无 yongShenGongs 时，锚点全记参考级并留痕', function () {
  var yq = YQ.analyze(CHART, {});
  var r = TM.analyze({ chart: CHART, yingqi: yq, options: {} });
  assert.strictEqual(r.targetSource, '');
  r.anchors.forEach(function (a) { assert.strictEqual(a.strength, 'low'); });
  assert.ok(r.notes.some(function (n) { return /参考级/.test(n); }), '须留痕说明无法排主次');
});

console.log('== 确定性与防御性 ==');
t('同盘同占类两次调用结果完全一致', function () {
  assert.deepStrictEqual(run(CHART, 'wealth'), run(CHART, 'wealth'));
});
t('不同占类的锚点主次随用神而变（应期确实是占类相关的）', function () {
  var w = run(CHART, 'wealth'), h = run(CHART, 'health');
  var names = function (r) {
    return r.anchors.filter(function (a) { return a.strength === 'high'; })
      .map(function (a) { return a.targets.map(function (t) { return t.name; }).join('/'); }).join('|');
  };
  assert.notStrictEqual(names(w), names(h), '两个占类的高强锚点用神不应完全相同');
});
t('空参数不抛异常', function () {
  assert.doesNotThrow(function () { TM.analyze(); });
  assert.doesNotThrow(function () { TM.analyze({}); });
  assert.doesNotThrow(function () { TM.analyze({ chart: CHART }); });
});
t('toPromptBlock 收到坏数据返回空串，不阻断解读', function () {
  assert.strictEqual(TM.toPromptBlock(null), '');
  assert.strictEqual(TM.toPromptBlock({}), '');
});
t('结果可 JSON 序列化', function () {
  assert.doesNotThrow(function () { JSON.parse(JSON.stringify(RES)); });
});
t('盘别判定与 xiangyi 一致', function () {
  [CHART, { renPanMen: {} }, { tianPanYi: {} }, { diPanShen: {} }, null, {}].forEach(function (c) {
    assert.strictEqual(TM.detectSchool(c), XY.detectSchool(c), '盘别判定分歧');
  });
});

console.log('== 提示块 ==');
t('提示块声明干支同源、禁止自造日辰，并带出机制禁令', function () {
  var txt = TM.toPromptBlock(RES);
  assert.ok(txt.length > 0);
  assert.ok(/取自上方【应期与数字】块的同一组计算/.test(txt), '须声明与 yingqi 同源，避免被当成两套推算');
  assert.ok(/不得自造日辰/.test(txt));
  assert.ok(/严禁改用天干或无关地支充数/.test(txt), '机制禁令须带出——这是实测最易被绕过之处');
  assert.ok(/仅表先到后到/.test(txt), '位次不得被读成"几天后"');
});
t('提示块不把锚点写成"必于某日应验"', function () {
  var banned = /必于|必在.{0,3}日应|铁定|一定应在/;
  SAMPLES.slice(0, 30).forEach(function (c) {
    assert.ok(!banned.test(TM.toPromptBlock(run(c, 'wealth'))), '应期提示块出现了确定性断言');
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
