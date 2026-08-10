/**
 * 占类象义推理层(XiangYi) core 单元测试（纯 Node，无框架）。
 * 运行：node core/xiangyi.test.js
 *
 * 重点守住四件事：
 *   ① 判读只能来自 domain-rules.json，不得凭空产出（逐条回查规则库）；
 *   ② 同一个「旺」在不同角色下必须得出相反倾向——这是本层存在的理由；
 *   ③ 落宫与四害必须与盘面/wangshuai 一致，本层只读不改；
 *   ④ 零串味与常量漂移：飞盘整体停用；与 wangshuai/yongshen 各自留存的常量副本不得走样。
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var XY = require('./xiangyi.js');
var WS = require('./wangshuai.js');
var YS = require('./yongshen.js');
var RULES = require('../knowledge/domain-rules.json');
var DOMAINS = require('../knowledge/domains.json');

XY.load(RULES);
YS.load(DOMAINS);

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

function chartAt(iso, purpose) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: purpose || '财运' });
}
function run(chart, domain, withWs) {
  return XY.analyze({
    domain: domain || 'wealth', chart: chart,
    wangshuai: withWs === false ? null : WS.analyze(chart)
  });
}

// 固定盘，保证断言可重复
var CHART = chartAt('2024-04-10T10:00:00');
var RES = run(CHART, 'wealth');

/** 扫一批盘，找出满足条件者。用于覆盖固定盘上碰不到的四害组合。 */
function sample(n) {
  var out = [], d = new Date('2024-01-01T09:00:00');
  for (var i = 0; i < (n || 120); i++) {
    out.push(chartAt(new Date(d.getTime() + i * 37 * 3600 * 1000).toISOString()));
  }
  return out;
}
var SAMPLES = sample(120);

console.log('== 规则库自检（数据本身先立得住） ==');
t('规则库可加载且限定转盘', function () {
  assert.ok(XY.isLoaded());
  assert.deepStrictEqual(RULES.appliesTo, ['zhuanpan']);
});
t('求财规则已建成，其余占类如实标 pending', function () {
  assert.strictEqual(XY.domainStatus('wealth'), 'complete');
  assert.strictEqual(XY.domainStatus('general'), 'minimal');
  ['career', 'relationship', 'health', 'lawsuit', 'lost_item'].forEach(function (id) {
    assert.strictEqual(XY.domainStatus(id), 'pending', id + ' 应如实标 pending，不得假装已建成');
  });
});
t('规则 id 全局唯一', function () {
  var seen = {}, dup = [];
  Object.keys(RULES.domains).forEach(function (dm) {
    ['conditions', 'combinations', 'relations'].forEach(function (k) {
      (RULES.domains[dm][k] || []).forEach(function (r) {
        if (seen[r.id]) dup.push(r.id);
        seen[r.id] = 1;
      });
    });
  });
  assert.deepStrictEqual(dup, [], '规则 id 重复：' + dup.join('、'));
});
t('每条规则都有 concept 与 basis（不得无出处）', function () {
  Object.keys(RULES.domains).forEach(function (dm) {
    (RULES.domains[dm].conditions || []).concat(RULES.domains[dm].combinations || []).forEach(function (r) {
      assert.ok(r.concept && r.concept.length, r.id + ' 缺 concept');
      assert.ok(r.basis && r.basis.length > 4, r.id + ' 缺 basis 出处');
      assert.ok(['+', '-', '0'].indexOf(r.polarity) >= 0, r.id + ' polarity 非法：' + r.polarity);
    });
    (RULES.domains[dm].relations || []).forEach(function (r) {
      assert.ok(r.basis && r.basis.length > 4, r.id + ' 缺 basis 出处');
      Object.keys(r.map).forEach(function (k) {
        assert.ok(RULES.relationKinds[k], r.id + ' 用了未声明的关系类型 ' + k);
        assert.ok(r.map[k].concept && r.map[k].concept.length, r.id + '.' + k + ' 缺 concept');
        assert.ok(['+', '-', '0'].indexOf(r.map[k].polarity) >= 0, r.id + '.' + k + ' polarity 非法');
      });
    });
  });
});
t('权重在 1-5 之间，且 roles 与规则所引元素相符', function () {
  var w = RULES.domains.wealth;
  Object.keys(w.roles).forEach(function (n) {
    var wt = w.roles[n].weight;
    assert.ok(wt >= 1 && wt <= 5, n + ' 权重越界：' + wt);
    assert.ok(w.roles[n].aspect && w.roles[n].roleType, n + ' 缺 aspect/roleType');
  });
  w.conditions.forEach(function (r) {
    assert.ok(w.roles[r.on], '条件规则 ' + r.id + ' 所断元素 ' + r.on + ' 未在 roles 登记，权重无从谈起');
  });
  w.relations.forEach(function (r) {
    assert.ok(w.roles[r.from] && w.roles[r.to], r.id + ' 关系两端须均已登记角色');
  });
});
t('用户所定权重被如实落库（生门/日干★5、戊★4、开门/六合/庚★3）', function () {
  var R = RULES.domains.wealth.roles;
  assert.strictEqual(R['生门'].weight, 5);
  assert.strictEqual(R['日干'].weight, 5);
  assert.strictEqual(R['戊'].weight, 4);
  assert.strictEqual(R['开门'].weight, 3);
  assert.strictEqual(R['六合'].weight, 3);
  assert.strictEqual(R['庚'].weight, 3);
});

console.log('== 焦点与权重（Phase 2.2） ==');
t('focus 按权重降序，重点在前', function () {
  for (var i = 1; i < RES.focus.length; i++) {
    assert.ok(RES.focus[i - 1].weight >= RES.focus[i].weight,
      '权重未降序：' + RES.focus[i - 1].name + '(' + RES.focus[i - 1].weight + ') 在 ' +
      RES.focus[i].name + '(' + RES.focus[i].weight + ') 之前');
  }
});
t('focus 每条都带角色与出处，落宫与盘面一致', function () {
  assert.ok(RES.focus.length > 0);
  RES.focus.forEach(function (f) {
    assert.ok(f.aspect, f.name + ' 缺 aspect');
    assert.ok(f.basis, f.name + ' 缺 basis');
    assert.ok(/^[1-9]$/.test(f.gong), f.name + ' 落宫非法：' + f.gong);
  });
  var sm = RES.focus.filter(function (f) { return f.name === '生门'; })[0];
  var expect = Object.keys(CHART.baMen).filter(function (g) { return CHART.baMen[g] === '生门'; })[0];
  assert.strictEqual(sm.gong, expect, '生门落宫须与引擎一致');
});
t('盘上未见者进 absent，不得代为安置落宫', function () {
  RES.absent.forEach(function (a) {
    assert.ok(a.name && a.note);
    assert.ok(RES.focus.every(function (f) { return f.name !== a.name; }), a.name + ' 不应同时出现在 focus');
  });
});

console.log('== 占类相关性：同一个「旺」，角色不同则倾向相反 ==');
t('生门旺相判为助、庚旺相判为阻（这正是本层存在的理由）', function () {
  var sm = RULES.domains.wealth.conditions.filter(function (r) { return r.id === 'wealth.生门.旺相'; })[0];
  var gn = RULES.domains.wealth.conditions.filter(function (r) { return r.id === 'wealth.庚.旺相'; })[0];
  assert.strictEqual(sm.polarity, '+');
  assert.strictEqual(gn.polarity, '-');
  assert.deepStrictEqual(sm.when.state, gn.when.state, '两条的触发条件必须完全相同，差别只在角色');
});
t('庚空亡/入墓判为助（阻力落空反利我），生门空亡/入墓判为阻', function () {
  var by = {};
  RULES.domains.wealth.conditions.forEach(function (r) { by[r.id] = r; });
  assert.strictEqual(by['wealth.庚.空亡'].polarity, '+');
  assert.strictEqual(by['wealth.庚.入墓'].polarity, '+');
  assert.strictEqual(by['wealth.生门.空亡'].polarity, '-');
  assert.strictEqual(by['wealth.生门.入墓'].polarity, '-');
});
t('实盘上确实按角色给出相反倾向', function () {
  var hit = null;
  SAMPLES.some(function (c) {
    var r = run(c, 'wealth');
    var sm = r.readings.filter(function (x) { return x.id === 'wealth.生门.旺相'; })[0];
    var gn = r.readings.filter(function (x) { return x.id === 'wealth.庚.旺相'; })[0];
    if (sm && gn) { hit = { sm: sm, gn: gn }; return true; }
    return false;
  });
  assert.ok(hit, '样本中应能找到生门与庚同时旺相的盘');
  assert.strictEqual(hit.sm.polarity, '+');
  assert.strictEqual(hit.gn.polarity, '-');
});

console.log('== 判读只能来自规则库 ==');
t('每条判读都能回查到规则库中的同 id 规则', function () {
  var byId = {};
  Object.keys(RULES.domains).forEach(function (dm) {
    ['conditions', 'combinations', 'relations'].forEach(function (k) {
      (RULES.domains[dm][k] || []).forEach(function (r) { byId[r.id] = r; });
    });
  });
  SAMPLES.slice(0, 40).forEach(function (c) {
    var r = run(c, 'wealth');
    r.readings.concat(r.combinations, r.relations).forEach(function (x) {
      assert.ok(byId[x.id], '产出了规则库中不存在的判读：' + x.id);
      assert.ok(x.concept.length > 0 && x.basis.length > 0, x.id + ' 判读缺 concept/basis');
    });
  });
});
t('判读的 concept 与规则库原文逐字一致（不得改写）', function () {
  var byId = {};
  RULES.domains.wealth.conditions.forEach(function (r) { byId[r.id] = r; });
  RES.readings.forEach(function (x) {
    assert.deepStrictEqual(x.concept, byId[x.id].concept, x.id + ' 的 concept 被改写了');
  });
});

console.log('== 条件求值与盘面一致 ==');
t('空亡判读只在该元素落宫确为空亡时出现', function () {
  var checked = 0;
  SAMPLES.forEach(function (c) {
    var r = run(c, 'wealth');
    var kw = (c.kongWangGong || []).map(String);
    r.readings.forEach(function (x) {
      if ((x.matched.flags || []).indexOf('空亡') < 0) return;
      checked++;
      assert.ok(kw.indexOf(x.gong) >= 0, x.id + ' 断空亡，但 ' + x.gong + ' 宫不在空亡宫 ' + kw.join('/'));
    });
  });
  assert.ok(checked > 0, '样本中应有空亡判读被检验到');
});
t('旺衰判读与 wangshuai 逐条对齐（本层只读不改）', function () {
  var checked = 0;
  SAMPLES.forEach(function (c) {
    var ws = WS.analyze(c), r = XY.analyze({ domain: 'wealth', chart: c, wangshuai: ws });
    r.readings.forEach(function (x) {
      if (!x.matched.state) return;
      var g = ws.gongs[x.gong], on = x.on;
      var expect = on === '生门' || on === '开门' ? g.menState
        : (on === '戊' || on === '庚') ? (g.tianGan === on ? g.tianGanState : g.diGan === on ? g.diGanState : null)
          : null;
      if (expect === null) return;
      checked++;
      assert.strictEqual(x.matched.state, expect, x.id + ' 于 ' + x.gong + ' 宫旺衰与 wangshuai 不符');
    });
  });
  assert.ok(checked > 20, '应检验到足量旺衰判读，实得 ' + checked);
});
t('入墓判读两路都与 wangshuai 同源：干自身墓 / 所落宫内有干墓（后者须写明缘由）', function () {
  var ganChecked = 0, gongChecked = 0;
  SAMPLES.forEach(function (c) {
    var ws = WS.analyze(c), idx = XY.indexChart(c);
    var r = XY.analyze({ domain: 'wealth', chart: c, wangshuai: ws });
    r.readings.forEach(function (x) {
      if ((x.matched.flags || []).indexOf('入墓') < 0) return;
      var el = XY.resolveElement(x.on, idx);
      var onPlate = el.kind === 'gan' && (el.layer === 'tianGan' || el.layer === 'diGan');
      if (onPlate) {
        ganChecked++;
        assert.strictEqual(XY._TABLES.RU_MU_GONG[el.resolved], x.gong, x.on + '(' + el.resolved + ') 入墓宫不符');
        // 与 wangshuai 同源：该干确在此宫的天/地盘上，wangshuai 亦必判此宫入墓
        assert.ok(ws.gongs[x.gong].ruMu, x.id + ' 断入墓但 wangshuai 未判——两处四害不得各说各话');
      } else {
        gongChecked++;
        assert.ok(ws.gongs[x.gong].ruMu, x.id + ' 断入墓但该宫 wangshuai 未判入墓');
        assert.ok(x.matched.why && x.matched.why.length,
          x.id + ' 非上盘之干与门/星/神的"入墓"实为宫内有干入墓，必须写明缘由，否则会被读成其自身入墓');
      }
    });
  });
  assert.ok(ganChecked > 0 && gongChecked > 0, '两路都应被检验到（干自身墓 ' + ganChecked + '，宫内墓 ' + gongChecked + '）');
});
t('日干为甲时不硬断甲墓于坤二（甲不上天盘，须与 wangshuai 口径一致）', function () {
  var checked = 0;
  SAMPLES.forEach(function (c) {
    if (c.siZhu.day.charAt(0) !== '甲') return;
    var ws = WS.analyze(c);
    var r = XY.analyze({ domain: 'wealth', chart: c, wangshuai: ws });
    var f = r.focus.filter(function (x) { return x.name === '日干'; })[0];
    if (!f) return;
    checked++;
    if (f.flags.indexOf('入墓') >= 0) {
      assert.ok(ws.gongs[f.gong].ruMu, '日干甲断入墓时，须是其所落之宫确有干入墓');
      assert.ok(f.flagWhy['入墓'], '须写明是宫内之干入墓，而非甲自身入墓');
    }
  });
  assert.ok(checked > 0, '样本中应有日干为甲的盘');
});
t('驿马判读只在驿马落宫出现', function () {
  SAMPLES.forEach(function (c) {
    var r = run(c, 'wealth');
    var ma = (c.maStar && c.maStar.gong != null) ? String(c.maStar.gong) : '';
    r.readings.forEach(function (x) {
      if ((x.matched.flags || []).indexOf('驿马') < 0) return;
      assert.strictEqual(x.gong, ma, x.id + ' 断驿马但驿马实落 ' + ma + ' 宫');
    });
  });
});

console.log('== 组合判读（Phase 3 的地基） ==');
t('组合只在两象确实同宫时命中（含天盘/地盘/暗干各层）', function () {
  var checked = 0;
  SAMPLES.forEach(function (c) {
    var r = run(c, 'wealth');
    r.combinations.forEach(function (x) {
      checked++;
      var g = x.gong;
      var atG = [c.baMen[g], c.jiuXing[g], c.baShen[g], c.tianPan[g], c.diPan[g], (c.anGan || {})[g]];
      x.elements.forEach(function (n) {
        if (n === '日干' || n === '时干') {
          var gan = (n === '日干' ? c.siZhu.day : c.siZhu.time).charAt(0);
          var ok = atG.indexOf(gan) >= 0 ||
            (gan === '甲' && String(c.zhiFuLuoGong || c.zhiFuGong) === g);
          assert.ok(ok, x.id + '：' + n + '(' + gan + ') 并不在 ' + g + ' 宫');
        } else {
          assert.ok(atG.indexOf(n) >= 0, x.id + '：' + n + ' 并不在 ' + g + ' 宫，同宫判定有误');
        }
      });
    });
  });
  assert.ok(checked > 30, '样本中应命中足量组合，实得 ' + checked);
});
t('组合权重取两象中较高者', function () {
  var R = RULES.domains.wealth.roles, def = RULES.defaultWeights;
  RES.combinations.forEach(function (x) {
    var expect = Math.max.apply(null, x.elements.map(function (n) {
      return R[n] ? R[n].weight : (n.charAt(1) === '门' ? def.men : n.charAt(0) === '天' ? def.xing : def.shen);
    }));
    assert.strictEqual(x.weight, expect, x.id + ' 权重应为 ' + expect);
  });
});
t('不做全排列：只产出规则表列出的组合', function () {
  var declared = {};
  RULES.domains.wealth.combinations.forEach(function (r) { declared[r.id] = 1; });
  SAMPLES.slice(0, 40).forEach(function (c) {
    run(c, 'wealth').combinations.forEach(function (x) {
      assert.ok(declared[x.id], '产出了未声明的组合 ' + x.id + '——组合必须由占类相关性约束，否则爆炸');
    });
  });
});

console.log('== 宫际生克 ==');
t('relationKind 五行判定正确', function () {
  assert.strictEqual(XY.relationKind('2', '2', '土', '土'), 'same_gong');
  assert.strictEqual(XY.relationKind('2', '8', '土', '土'), 'same_element');
  assert.strictEqual(XY.relationKind('2', '9', '土', '火'), 'to_sheng_from', '火生土＝彼生我');
  assert.strictEqual(XY.relationKind('2', '6', '土', '金'), 'from_sheng_to', '土生金＝我生彼');
  assert.strictEqual(XY.relationKind('2', '1', '土', '水'), 'from_ke_to', '土克水＝我克彼');
  assert.strictEqual(XY.relationKind('2', '3', '土', '木'), 'to_ke_from', '木克土＝彼克我');
});
t('关系判读的宫与五行与 wangshuai 一致', function () {
  var checked = 0;
  SAMPLES.slice(0, 40).forEach(function (c) {
    var ws = WS.analyze(c), r = XY.analyze({ domain: 'wealth', chart: c, wangshuai: ws });
    r.relations.forEach(function (x) {
      checked++;
      assert.strictEqual(x.fromElement, ws.gongs[x.fromGong].gongElement);
      assert.strictEqual(x.toElement, ws.gongs[x.toGong].gongElement);
      assert.strictEqual(x.relation, XY.relationKind(x.fromGong, x.toGong, x.fromElement, x.toElement));
    });
  });
  assert.ok(checked > 30, '应检验到足量关系判读，实得 ' + checked);
});
t('同宫优先于比和：同宫时必判 same_gong', function () {
  SAMPLES.forEach(function (c) {
    run(c, 'wealth').relations.forEach(function (x) {
      if (x.fromGong === x.toGong) assert.strictEqual(x.relation, 'same_gong');
    });
  });
});

console.log('== 零串味：飞盘整体停用 ==');
t('飞盘盘面不套用转盘规则，且说明原因', function () {
  var fp = { renPanMen: { '1': '生门' }, tianPanYi: { '1': '戊' }, siZhu: { day: '甲子', month: '丙寅', time: '庚午' } };
  var r = XY.analyze({ domain: 'wealth', chart: fp });
  assert.strictEqual(r.school, 'feipan');
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.readings.length, 0);
  assert.strictEqual(r.combinations.length, 0);
  assert.strictEqual(r.relations.length, 0);
  assert.strictEqual(r.focus.length, 0);
  assert.ok(/零串味/.test(r.reason), '须说明因盘别隔离而停用：' + r.reason);
});
t('显式下传 school=feipan 时同样停用（不依赖 schema 猜测）', function () {
  var r = XY.analyze({ domain: 'wealth', chart: CHART, wangshuai: WS.analyze(CHART), options: { school: 'feipan' } });
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.readings.length, 0);
});
t('飞盘提示块明示停用，不留可被误用的残余取用', function () {
  var r = XY.analyze({ domain: 'wealth', chart: { renPanMen: {}, tianPanYi: { '1': '戊' }, siZhu: {} } });
  var txt = XY.toPromptBlock(r);
  assert.ok(txt.indexOf('生门') < 0 && txt.indexOf('★') < 0, '停用时不得漏出任何转盘取用');
});

console.log('== 规则未建 ≠ 盘上无碍 ==');
t('pending 占类不产出判读，且明说是"规则未建"', function () {
  var r = run(CHART, 'career');
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.status, 'pending');
  assert.strictEqual(r.readings.length, 0);
  assert.ok(/规则未建|尚未建成/.test(r.reason), '须区分"规则未建"与"盘上无碍"：' + r.reason);
});
t('未知占类不崩，如实说明', function () {
  var r = run(CHART, '不存在的占类');
  assert.strictEqual(r.applicable, false);
  assert.ok(r.reason.length > 0);
});

console.log('== 缺件降级（degraded） ==');
t('未传 wangshuai 时停用旺衰与宫际规则，但不报错', function () {
  var r = run(CHART, 'wealth', false);
  assert.strictEqual(r.degraded, true);
  assert.strictEqual(r.relations.length, 0, '无旺衰则宫际五行无从取，须停用');
  r.readings.forEach(function (x) {
    assert.ok(!x.matched.state, '无 wangshuai 时不得产出旺衰类判读：' + x.id);
  });
  assert.ok(r.notes.some(function (n) { return /wangshuai/.test(n); }), '须留痕说明本次停用了哪些规则');
});
t('缺 wangshuai 时空亡/驿马类判读仍可用（这些只依赖盘面）', function () {
  var got = SAMPLES.some(function (c) {
    return run(c, 'wealth', false).readings.some(function (x) {
      return (x.matched.flags || []).indexOf('空亡') >= 0;
    });
  });
  assert.ok(got, '空亡只依赖 kongWangGong，降级后仍应可判');
});

console.log('== 确定性 ==');
t('同盘同占类两次调用结果完全一致', function () {
  var a = run(CHART, 'wealth'), b = run(CHART, 'wealth');
  assert.deepStrictEqual(a, b);
});
t('输出顺序稳定：权重降序、同权按 id 字典序', function () {
  [RES.readings, RES.combinations, RES.relations].forEach(function (list) {
    for (var i = 1; i < list.length; i++) {
      var p = list[i - 1], c = list[i];
      assert.ok(p.weight > c.weight || (p.weight === c.weight && p.id <= c.id),
        '排序不稳定：' + p.id + ' 在 ' + c.id + ' 之前');
    }
  });
});
t('条目数受上限约束（不得无限膨胀）', function () {
  SAMPLES.forEach(function (c) {
    var r = run(c, 'wealth');
    assert.ok(r.readings.length <= 20, '单象判读超上限：' + r.readings.length);
    assert.ok(r.combinations.length <= 12, '组合判读超上限：' + r.combinations.length);
  });
});

console.log('== 常量漂移守卫（各 core 各存一份副本，任一处改动而另一处未跟进即失败） ==');
t('五行生克表与 wangshuai 一致', function () {
  assert.deepStrictEqual(XY._TABLES.SHENG, WS.SHENG);
  assert.deepStrictEqual(XY._TABLES.KE, WS.KE);
});
t('入墓/击刑宫表与 wangshuai 一致', function () {
  assert.deepStrictEqual(XY._TABLES.RU_MU_GONG, WS.RU_MU_GONG);
  assert.deepStrictEqual(XY._TABLES.JI_XING_GONG, WS.JI_XING_GONG);
});
t('九宫方位表与 yongshen 一致', function () {
  assert.deepStrictEqual(XY._TABLES.GONG_INFO, YS.GONG_INFO);
});
t('盘别判定与 yongshen 一致', function () {
  [CHART, { renPanMen: {} }, { tianPanYi: {} }, { diPanShen: {} }, null, {}].forEach(function (c) {
    assert.strictEqual(XY.detectSchool(c), YS.detectSchool(c), '盘别判定分歧');
  });
});
t('元素落宫与 yongshen.locate 一致（两处定位逻辑不得分岔）', function () {
  var checked = 0;
  SAMPLES.slice(0, 40).forEach(function (c) {
    var idx = XY.indexChart(c);
    var actors = { riGan: c.siZhu.day.charAt(0), shiGan: c.siZhu.time.charAt(0) };
    ['生门', '开门', '戊', '庚', '六合', '日干', '时干', '值符', '值使'].forEach(function (n) {
      var a = XY.resolveElement(n, idx);
      var b = YS.locate(c, n, actors);
      if (!a && !b) return;
      assert.ok(a && b, n + ' 一处定到一处未定到');
      checked++;
      assert.strictEqual(a.gong, b.gong, n + ' 落宫分歧：xiangyi=' + a.gong + ' yongshen=' + b.gong);
    });
  });
  assert.ok(checked > 100, '应比对足量元素，实得 ' + checked);
});

console.log('== 防御性 ==');
t('空参数不抛异常', function () {
  assert.doesNotThrow(function () { XY.analyze(); });
  assert.doesNotThrow(function () { XY.analyze({}); });
  assert.doesNotThrow(function () { XY.analyze({ domain: 'wealth' }); });
});
t('规则库未加载时停用而非崩溃', function () {
  XY.load(null);
  var r = run(CHART, 'wealth');
  assert.strictEqual(r.applicable, false);
  assert.ok(/未加载/.test(r.reason));
  assert.strictEqual(XY.toPromptBlock(r), '');
  XY.load(RULES);   // 复原，勿影响后续用例
});
t('toPromptBlock 收到坏数据返回空串，不阻断解读', function () {
  assert.strictEqual(XY.toPromptBlock(null), '');
  assert.strictEqual(XY.toPromptBlock({}), '');
});
t('结果可 JSON 序列化', function () {
  assert.doesNotThrow(function () { JSON.parse(JSON.stringify(RES)); });
});

console.log('== 提示块 ==');
t('提示块含关注点/判读/免责，且倾向计数明标非结论', function () {
  var txt = XY.toPromptBlock(RES);
  assert.ok(txt.indexOf('★') >= 0, '须给出权重');
  assert.ok(txt.indexOf('依据：') >= 0, '每条判读须带出处');
  assert.ok(txt.indexOf('不是最终吉凶断语') >= 0, '须声明本层不下吉凶结论');
  assert.ok(/倾向计数.*非结论/.test(txt), '计数须明标非结论，防被当成打分');
});
t('倾向计数与判读条目数吻合', function () {
  var t2 = RES.tally;
  var all = RES.readings.concat(RES.combinations, RES.relations);
  assert.strictEqual(t2.support + t2.obstruct + t2.neutral, all.length);
  assert.strictEqual(t2.support, all.filter(function (x) { return x.polarity === '+'; }).length);
  assert.strictEqual(t2.obstruct, all.filter(function (x) { return x.polarity === '-'; }).length);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
