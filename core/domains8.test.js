/**
 * Phase 19 新增八占类（学业/出行/寻人/怀孕/风水/射覆/天气/竞赛）回归测试。
 * 运行：node core/domains8.test.js
 *
 * 这八套专条**不出自纲要**，其主用神／辅用神／旺衰四害读法／助阻清单皆由用户
 * 于 2026-08-27 逐条给定。故本文件除了验「规则能跑」，更要钉住两件事：
 *   ① **出处逐条可辨**——每一条 basis 必须以〔用户所定〕起头，绝不冒充纲要；
 *   ② **零串味**——appliesTo 仍是 zhuanpan，八套一条都不许在飞盘上跑。
 * 另加一条怀孕的安全边界：涉母子安危，凶象须写重，但不得作医学诊断、不得单条下死断。
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var WS = require('./wangshuai.js');
var XY = require('./xiangyi.js');
var YS = require('./yongshen.js');
var RULES = require('../knowledge/domain-rules.json');
var DOMAINS = require('../knowledge/domains.json');
XY.load(RULES); YS.load(DOMAINS);

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
var NEW = ['study', 'travel', 'find_person', 'pregnancy', 'fengshui', 'shefu', 'weather', 'contest'];
var OLD = ['wealth', 'career', 'relationship', 'health', 'lawsuit', 'lost_item', 'general'];
var PROV = '〔用户所定·2026-08-27〕';
function zp(iso) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
}
function fp(iso) { return QM.feipanQimen.calculate(new Date(iso), { method: '时家', purpose: '综合' }); }
function run(chart, dom, school) {
  return XY.analyze({ chart: chart, domain: dom, wangshuai: WS.analyze(chart),
    options: { school: school || 'zhuanpan' } });
}
/** 遍历一套专条里的每一条 basis（conditions / combinations / relations / roles） */
function eachBasis(dom, cb) {
  var d = RULES.domains[dom];
  (d.conditions || []).forEach(function (x) { cb(x.basis, dom + ' condition ' + x.id); });
  (d.combinations || []).forEach(function (x) { cb(x.basis, dom + ' combination ' + x.id); });
  (d.relations || []).forEach(function (x) { cb(x.basis, dom + ' relation ' + x.id); });
  Object.keys(d.roles || {}).forEach(function (k) { cb(d.roles[k].basis, dom + ' role ' + k); });
}

console.log('\n== 八套专条都在，且结构完整 ==');
t('八个占类均已收录，且 status=complete', function () {
  NEW.forEach(function (dm) {
    assert.ok(RULES.domains[dm], dm + ' 未收录');
    assert.strictEqual(RULES.domains[dm].status, 'complete', dm);
    assert.ok(DOMAINS.domains[dm], dm + ' 未在 domains.json 中登记用神');
  });
});
t('每套都有 roles / conditions，且条目数不至于敷衍', function () {
  NEW.forEach(function (dm) {
    var d = RULES.domains[dm];
    assert.ok(Object.keys(d.roles || {}).length >= 3, dm + ' roles 过少');
    assert.ok((d.conditions || []).length >= 10, dm + ' conditions 仅 ' + (d.conditions || []).length + ' 条');
  });
});
t('每条 condition 的 on 都登记在 roles 里，无孤儿条目', function () {
  NEW.forEach(function (dm) {
    var d = RULES.domains[dm];
    (d.conditions || []).forEach(function (c) {
      assert.ok(d.roles[c.on], dm + ' 的 ' + c.id + ' 所据元素「' + c.on + '」未登记在 roles');
    });
  });
});
t('combination 的每个元素也都登记在 roles 里', function () {
  NEW.forEach(function (dm) {
    var d = RULES.domains[dm];
    (d.combinations || []).forEach(function (k) {
      k.elements.forEach(function (e) {
        // 八神（太阴/腾蛇/白虎/玄武/六合/青龙/九天/九地）不必登记为角色，
        // 它们是「情态」而非用神，按通用象义读即可
        var SHEN = ['太阴', '腾蛇', '白虎', '玄武', '六合', '青龙', '九天', '九地', '值符'];
        if (SHEN.indexOf(e) >= 0) return;
        assert.ok(d.roles[e], dm + ' 的组合 ' + k.id + ' 用到未登记的「' + e + '」');
      });
    });
  });
});

console.log('\n== 出处：逐条可辨，绝不冒充纲要 ==');
t('八套的每一条 basis 都以〔用户所定〕起头', function () {
  var bad = [];
  NEW.forEach(function (dm) {
    eachBasis(dm, function (basis, where) {
      if (String(basis || '').indexOf(PROV) !== 0) bad.push(where);
    });
  });
  assert.deepStrictEqual(bad.slice(0, 5), [], '共 ' + bad.length + ' 条未标明用户出处：' + bad.slice(0, 5).join('；'));
});
t('八套的 basis 里不得出现「纲要」字样——那是另一层的出处', function () {
  var bad = [];
  NEW.forEach(function (dm) {
    eachBasis(dm, function (basis, where) {
      // 允许在说明「纲要未载」时提及，但不得作为依据来源
      if (/纲要·|纲要第|据纲要/.test(String(basis || ''))) bad.push(where);
    });
  });
  assert.deepStrictEqual(bad, [], '这些条目把用户所定说成了纲要：' + bad.join('；'));
});
t('原有七套仍标纲要出处，两层未被混同', function () {
  var n = 0;
  OLD.forEach(function (dm) {
    eachBasis(dm, function (basis) {
      if (/纲要/.test(String(basis || ''))) n++;
      assert.ok(String(basis || '').indexOf(PROV) !== 0, dm + ' 的条目被误标成了用户所定');
    });
  });
  assert.ok(n > 50, '原有占类应大量引纲要，实得 ' + n);
});
t('顶层 _provenance 写明了哪八套出自用户、可回溯重议', function () {
  var p = RULES._provenance;
  NEW.forEach(function (dm) { assert.ok(p.indexOf(dm) >= 0, '_provenance 未点名 ' + dm); });
  assert.ok(/不可诿为纲要/.test(p));
});

console.log('\n== 规则真的会跑 ==');
t('四十盘逐一试跑，八个占类皆无零命中之盘', function () {
  var t0 = new Date('2026-01-01T00:00:00').getTime();
  NEW.forEach(function (dm) {
    var zero = 0, n = 0, tot = 0;
    for (var i = 0; i < 40; i++) {
      var p = zp(new Date(t0 + i * 3600 * 1000 * 37).toISOString());
      if (!p || p.error) continue;
      n++;
      var r = run(p, dm);
      tot += r.readings.length;
      if (!r.readings.length) zero++;
    }
    assert.strictEqual(zero, 0, dm + ' 有 ' + zero + '/' + n + ' 盘一条都没命中');
    assert.ok(tot / n >= 2, dm + ' 平均仅 ' + (tot / n).toFixed(1) + ' 条，过于稀疏');
  });
});
t('命中率与既有七套同一量级，不是凑数也不是滥发', function () {
  var t0 = new Date('2026-02-01T00:00:00').getTime();
  function avg(dm) {
    var tot = 0, n = 0;
    for (var i = 0; i < 25; i++) {
      var p = zp(new Date(t0 + i * 3600 * 1000 * 29).toISOString());
      if (!p || p.error) continue;
      n++; tot += run(p, dm).readings.length;
    }
    return tot / n;
  }
  var oldAvg = OLD.map(avg), newAvg = NEW.map(avg);
  var lo = Math.min.apply(null, oldAvg), hi = Math.max.apply(null, oldAvg);
  newAvg.forEach(function (a, i) {
    assert.ok(a >= lo * 0.4 && a <= hi * 1.6,
      NEW[i] + ' 平均 ' + a.toFixed(1) + ' 条，落在既有区间 [' + lo.toFixed(1) + ',' + hi.toFixed(1) + '] 之外过远');
  });
});
t('同盘同占类两次结果逐字相同（确定性）', function () {
  var p = zp('2026-06-15T09:00:00');
  NEW.forEach(function (dm) {
    assert.strictEqual(JSON.stringify(run(p, dm)), JSON.stringify(run(p, dm)), dm);
  });
});

console.log('\n== 零串味：八套一条都不许在飞盘上跑 ==');
t('appliesTo 仍只有 zhuanpan', function () {
  assert.deepStrictEqual(RULES.appliesTo, ['zhuanpan']);
});
t('飞盘上八个占类皆 applicable=false 且判读为空', function () {
  var f = fp('2026-08-27T10:00:00');
  NEW.forEach(function (dm) {
    var r = XY.analyze({ chart: f, domain: dm, wangshuai: WS.analyze(f), options: { school: 'feipan' } });
    assert.strictEqual(r.applicable, false, dm + ' 竟在飞盘上生效');
    assert.strictEqual(r.readings.length, 0, dm + ' 在飞盘上跑出了 ' + r.readings.length + ' 条');
  });
});

console.log('\n== 怀孕：安全边界 ==');
t('凡涉母子安危的条目都写明须就医，且不作医学诊断', function () {
  var d = RULES.domains.pregnancy;
  // 字段名必须是 safetyNote（无下划线）——带下划线的一律被当注释，从不送达。
  // Phase 20 修好之前，这里写的正是 _safetyNote，那条边界从未到过模型手上。
  assert.ok(!d._safetyNote, '不得留在带下划线的注释字段里');
  assert.ok(/不得作医学诊断/.test(d.safetyNote), '须有安全边界说明');
  assert.ok(/建议就医/.test(d.safetyNote));
  var all = JSON.stringify(d);
  ['你患有', '你有癌', '停止药物', '不需要看医生', '不必就医'].forEach(function (w) {
    assert.ok(all.indexOf(w) < 0, '出现了禁语「' + w + '」');
  });
});
t('时干入墓/空亡一类重警只作重警，明写不得单条下断', function () {
  var d = RULES.domains.pregnancy;
  var heavy = d.conditions.filter(function (c) {
    return c.on === '时干' && /入墓|空亡/.test(JSON.stringify(c.when));
  });
  assert.ok(heavy.length >= 2, '应有两条重警，实得 ' + heavy.length);
  heavy.forEach(function (c) {
    assert.ok(/不得单条下断/.test(c.basis), c.id + ' 未写明不得单条下断');
    assert.ok(!/必死|子必死|母必凶/.test(c.concept.join('')), c.id + ' 措辞过死');
  });
});

console.log('\n== 各占类的分寸 ==');
t('天气无 self 角色——本占不问人事，不产出助阻于人的判读', function () {
  var d = RULES.domains.weather;
  var selves = Object.keys(d.roles).filter(function (k) { return d.roles[k].roleType === 'self'; });
  assert.deepStrictEqual(selves, [], '天气不该有 self，实得 ' + selves.join('、'));
  assert.ok(/不设 self 角色/.test(d._omittedNote));
});
t('竞赛只采一套主客口径，不并行两套「己方」', function () {
  var d = RULES.domains.contest;
  var selves = Object.keys(d.roles).filter(function (k) { return d.roles[k].roleType === 'self'; });
  assert.deepStrictEqual(selves, ['日干'], '己方应唯一，实得 ' + selves.join('、'));
  assert.ok(/不并行两套主客口径/.test(d._omittedNote));
});
t('风水把阴宅阳宅分开，未混为一谈', function () {
  var d = RULES.domains.fengshui;
  assert.ok(/先分阴宅阳宅/.test(d._focusNote));
  var siMen = d.conditions.filter(function (c) { return c.on === '死门'; });
  assert.ok(siMen.some(function (c) { return /阴宅|阳宅/.test(c.concept.join('')); }),
    '死门条须点明阴阳宅判读迥异');
});
t('凡须另取宫/干者一律记入 _omittedNote，不代为指派落宫', function () {
  ['study', 'travel', 'find_person', 'pregnancy', 'fengshui', 'shefu', 'weather', 'contest'].forEach(function (dm) {
    var d = RULES.domains[dm];
    assert.ok(d._omittedNote && d._omittedNote.length > 20, dm + ' 缺 _omittedNote');
    assert.ok(/不代为|不得凭空|不代/.test(d._omittedNote), dm + ' 未写明不代为指派');
  });
});
t('每套都有 _focusNote，把用户所给的「特殊注意」落到实处', function () {
  NEW.forEach(function (dm) {
    assert.ok(RULES.domains[dm]._focusNote && RULES.domains[dm]._focusNote.length > 20, dm);
  });
  assert.ok(/文科重丁奇/.test(RULES.domains.study._focusNote));
  assert.ok(/近行看九地/.test(RULES.domains.travel._focusNote));
  assert.ok(/以月令为基/.test(RULES.domains.weather._focusNote));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
