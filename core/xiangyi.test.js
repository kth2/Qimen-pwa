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
t('六大占类规则均已建成（Phase 2 求财 + Phase 2.3 五类）', function () {
  ['wealth', 'career', 'relationship', 'health', 'lawsuit', 'lost_item'].forEach(function (id) {
    assert.strictEqual(XY.domainStatus(id), 'complete', id + ' 应已建成');
  });
  // general 曾是空壳（0 条件/0 组合/1 关系），却占了实测案例的四成——纲要一节
  // 「断局总纲」本就写了诸占通用的一层，只是没收进来。现已补齐，不得再退回空壳。
  assert.strictEqual(XY.domainStatus('general'), 'core');
  var gen = RULES.domains.general;
  assert.ok((gen.conditions || []).length >= 12,
    'general 须覆盖日干/时干/值符/值使的旺衰、空亡、门迫、入墓、击刑，实得 ' + (gen.conditions || []).length);
  ['general.时干.空亡', 'general.日干.空亡', 'general.值符.宫旺相', 'general.值使.空亡'].forEach(function (id) {
    assert.ok((gen.conditions || []).some(function (c) { return c.id === id; }), '缺 ' + id);
  });
});
t('综合类的生克关系只断成败倾向，不得拿去断迟速与幅度', function () {
  // 实测：「谋为可成(但费些气力)」屡被读成「会延误/需久等/幅度不大/只是小胜」，
  // 而实况反而更快更大更顺——那是把成败之辞挪去答了迟速与幅度之问。
  // 字段名为 answers（「这条只答哪一类问题」）——evidence 里的 scope 另有其义（单象/组合/宫际），不可混用
  var rel = RULES.domains.general.relations[0];
  assert.strictEqual(rel.answers, '成败倾向');
  assert.ok(/不断迟速/.test(rel.answersNote) && /不断幅度/.test(rel.answersNote));
  assert.ok(/应期5/.test(rel.answersNote), '须指明迟速另有其法');
  Object.keys(rel.map).forEach(function (k) {
    assert.strictEqual(rel.map[k].answers, '成败倾向', k + ' 缺 answers');
  });
});
t('标 complete 者必须真有规则（不得空壳冒充已建成）', function () {
  Object.keys(RULES.domains).forEach(function (id) {
    var d = RULES.domains[id];
    if ((d.status || 'pending') !== 'complete') return;
    assert.ok(Object.keys(d.roles || {}).length >= 3, id + ' 角色过少，不足以称已建成');
    assert.ok((d.conditions || []).length >= 12, id + ' 条件规则仅 ' + (d.conditions || []).length + ' 条');
    assert.ok((d.combinations || []).length >= 6, id + ' 组合规则仅 ' + (d.combinations || []).length + ' 条');
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
        } else if (n.charAt(0) === '天' && n.length === 2) {
          // 引擎的九星可能写作「禽芮」等合称，故按特征字比对（与 xiangyi/yongshen 的还原同义）
          var ch = n.charAt(1);
          assert.ok(atG.some(function (v) { return v && String(v).indexOf(ch) >= 0; }),
            x.id + '：' + n + ' 并不在 ' + g + ' 宫（该宫九星为 ' + atG[1] + '），同宫判定有误');
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
// 五类占类既已建成，规则库中不再有 pending 者。但该机制仍须守住——日后新增占类必先经此态，
// 故以合成规则库验证，而不是为了测试而把某个占类故意留白。
t('pending 占类不产出判读，且明说是"规则未建"', function () {
  XY.load({
    appliesTo: ['zhuanpan'], defaultWeights: RULES.defaultWeights, relationKinds: RULES.relationKinds,
    domains: { fixture_pending: { label: '待建占类', status: 'pending', roles: {}, conditions: [], combinations: [], relations: [] } }
  });
  var r = run(CHART, 'fixture_pending');
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.status, 'pending');
  assert.strictEqual(r.readings.length, 0);
  assert.ok(/规则未建|尚未建成/.test(r.reason), '须区分"规则未建"与"盘上无碍"：' + r.reason);
  assert.ok(/不得据此认定无阻/.test(r.reason), '须明说不得据此认定无阻：' + r.reason);
  XY.load(RULES);
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
    // 含九星：引擎会把天禽寄宫写成「禽芮」合称，两处还原逻辑不得分岔
    // （曾因此让疾病占的首要用神天芮整个消失，此守卫即为钉死该回归）
    ['生门', '开门', '戊', '庚', '六合', '日干', '时干', '值符', '值使',
      '天芮', '天心', '天辅', '天蓬', '天禽', '玄武', '乙', '死门', '休门', '景门', '惊门', '杜门'].forEach(function (n) {
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

console.log('== Phase 2.3：五占类各自断言 ==');
/** 在样本中找出第一个命中指定规则 id 的盘，返回该条判读；找不到返回 null。 */
function findRule(domain, id) {
  var got = null;
  SAMPLES.some(function (c) {
    var r = run(c, domain);
    var hit = r.readings.concat(r.combinations, r.relations).filter(function (x) { return x.id === id; })[0];
    if (hit) { got = hit; return true; }
    return false;
  });
  return got;
}
function expectRule(domain, id, polarity) {
  var hit = findRule(domain, id);
  assert.ok(hit, '样本中应能命中 ' + id + '（规则从未触发说明条件写错或元素定位不到）');
  if (polarity != null) assert.strictEqual(hit.polarity, polarity, id + ' 倾向应为 ' + polarity);
  assert.ok(hit.concept.length > 0 && /纲要|symbols\.json|domains\.json/.test(hit.basis), id + ' 缺概念或出处');
  return hit;
}

t('career：开门旺相为助、空亡为阻，值符/日干旺相为助', function () {
  expectRule('career', 'career.开门.旺相', '+');
  expectRule('career', 'career.开门.空亡', '-');
  expectRule('career', 'career.值符.宫旺相', '+');
  expectRule('career', 'career.日干.旺相', '+');
});
t('career：开门+值符 组合可命中且为助', function () {
  expectRule('career', 'career.开门+值符', '+');
});
t('career：不为庚单立竞争强弱条件（纲要事业行未以庚为对头）', function () {
  var ids = (RULES.domains.career.conditions || []).map(function (r) { return r.id; });
  assert.ok(ids.every(function (i) { return i.indexOf('career.庚.') !== 0; }),
    '事业占不得凭空给庚立旺衰判读——那是官司行的取用');
  assert.ok(!RULES.domains.career.roles['天辅'], '天辅系于功名/考试行，不得挪用于事业');
});

t('relationship：六合旺相为助、空亡为阻', function () {
  expectRule('relationship', 'relationship.六合.宫旺相', '+');
  expectRule('relationship', 'relationship.六合.空亡', '-');
});
t('relationship：乙+庚 与 六合+乙+庚 组合可命中且为助', function () {
  expectRule('relationship', 'relationship.乙+庚', '+');
  var three = findRule('relationship', 'relationship.六合+乙+庚');
  if (three) {
    assert.strictEqual(three.polarity, '+');
    assert.strictEqual(three.elements.length, 3, '三象组合须三元素齐备');
  } else {
    // 三象同宫较罕见，样本可能碰不到；此时至少确认规则已声明且形状正确
    var decl = RULES.domains.relationship.combinations.filter(function (r) { return r.id === 'relationship.六合+乙+庚'; })[0];
    assert.ok(decl && decl.elements.length === 3, '三象组合规则须已声明');
  }
});
t('relationship：乙/庚 的旺衰只报力量、不预设吉凶', function () {
  ['relationship.乙.旺相', 'relationship.乙.休囚死', 'relationship.庚.旺相', 'relationship.庚.休囚死'].forEach(function (id) {
    var r = RULES.domains.relationship.conditions.filter(function (x) { return x.id === id; })[0];
    assert.ok(r, id + ' 应存在');
    assert.strictEqual(r.polarity, '0', id + ' 不得把「力量强」直接判成吉或凶');
  });
  assert.strictEqual(RULES.domains.relationship.roles['乙'].roleType, 'party');
  assert.strictEqual(RULES.domains.relationship.roles['庚'].roleType, 'party');
});

t('health：天芮旺为阻、天心/生门旺为助、死门旺为阻', function () {
  expectRule('health', 'health.天芮.旺相', '-');
  expectRule('health', 'health.天心.旺相', '+');
  expectRule('health', 'health.生门.旺相', '+');
  expectRule('health', 'health.死门.旺相', '-');
});
t('health：天心+生门 组合可命中且为助', function () {
  expectRule('health', 'health.天心+生门', '+');
});
t('health：天芮（含「禽芮」合称）必被定位，不得整个消失', function () {
  var merged = 0, located = 0;
  SAMPLES.forEach(function (c) {
    var raw = c.jiuXing[Object.keys(c.jiuXing).filter(function (g) {
      return c.jiuXing[g] && c.jiuXing[g].indexOf('芮') >= 0;
    })[0]] || '';
    if (raw && raw !== '天芮') merged++;
    var r = run(c, 'health');
    if (r.focus.some(function (f) { return f.name === '天芮'; })) located++;
  });
  assert.ok(merged > 0, '样本中应出现「禽芮」这类合称星名');
  assert.strictEqual(located, SAMPLES.length, '天芮为疾病占首要用神，任何一盘都不得定位不到');
});
t('health：安全边界随占类送达，且不产出医学结论', function () {
  var r = run(CHART, 'health');
  assert.ok(r.safetyNote && /不得作为医学诊断/.test(r.safetyNote), '健康占须带非医学诊断边界');
  assert.ok(XY.toPromptBlock(r).indexOf('不得作为医学诊断') >= 0, '边界须出现在提示块中');
  // 判读用词不得出现确诊式断言
  var banned = /确诊|癌|你患有|必然患|停药|无需就医|不必看医生/;
  SAMPLES.forEach(function (c) {
    var x = run(c, 'health');
    x.readings.concat(x.combinations, x.relations).forEach(function (o) {
      o.concept.forEach(function (w) { assert.ok(!banned.test(w), '健康判读出现越界用词：' + w); });
    });
  });
});
t('health：安全边界在本层停用时照样送达', function () {
  var fp = XY.analyze({ domain: 'health', chart: CHART, wangshuai: WS.analyze(CHART), options: { school: 'feipan' } });
  assert.strictEqual(fp.applicable, false);
  assert.ok(fp.safetyNote && /不得作为医学诊断/.test(fp.safetyNote), '停用不等于边界消失');
});

t('lawsuit：庚旺为阻、庚空亡为助、日干旺为助', function () {
  expectRule('lawsuit', 'lawsuit.庚.旺相', '-');
  expectRule('lawsuit', 'lawsuit.庚.空亡', '+');
  expectRule('lawsuit', 'lawsuit.日干.旺相', '+');
});
t('lawsuit：日干宫克庚宫为助、庚宫克日干宫为阻', function () {
  var seenKe = 0, seenBeiKe = 0;
  SAMPLES.forEach(function (c) {
    run(c, 'lawsuit').relations.forEach(function (x) {
      if (x.id !== 'lawsuit.rel.日干-庚') return;
      if (x.relation === 'from_ke_to') { seenKe++; assert.strictEqual(x.polarity, '+', '我克对头应为优势证据'); }
      if (x.relation === 'to_ke_from') { seenBeiKe++; assert.strictEqual(x.polarity, '-', '对头克我应为劣势证据'); }
    });
  });
  assert.ok(seenKe > 0 && seenBeiKe > 0, '两向生克都应在样本中出现（克 ' + seenKe + '、被克 ' + seenBeiKe + '）');
});
t('lawsuit：不把「克庚」写成必胜（不下胜败断语）', function () {
  var banned = /必胜|必输|必赢|一定胜|稳赢|包赢/;
  SAMPLES.forEach(function (c) {
    var r = run(c, 'lawsuit');
    r.readings.concat(r.combinations, r.relations).forEach(function (o) {
      o.concept.forEach(function (w) { assert.ok(!banned.test(w), '官司判读出现胜败断语：' + w); });
    });
  });
});

t('lost_item：玄武判读存在，且方位判读取自纲要三节方位表', function () {
  var got = 0;
  SAMPLES.forEach(function (c) {
    var r = run(c, 'lost_item');
    var loc = r.readings.filter(function (x) { return /lost_item\.玄武\.临/.test(x.id); });
    assert.ok(loc.length <= 1, '玄武只落一宫，方位判读不应多于一条');
    if (loc.length) {
      got++;
      var xw = Object.keys(c.baShen).filter(function (g) { return c.baShen[g] === '玄武'; })[0];
      assert.strictEqual(loc[0].gong, String(xw), '方位判读之宫须与玄武实际落宫一致');
      assert.ok(/纲要·三节方位/.test(loc[0].basis), '方位判读须引纲要三节方位表：' + loc[0].basis);
    }
  });
  assert.ok(got > 0, '样本中应命中玄武方位判读');
});
t('lost_item：玄武+杜门 / 玄武+驿马 规则可命中', function () {
  expectRule('lost_item', 'lost_item.玄武+杜门');
  expectRule('lost_item', 'lost_item.玄武.驿马');
});
t('lost_item：不为失物本身立固定符号，也不臆造宫际生克', function () {
  var d = RULES.domains.lost_item;
  assert.deepStrictEqual(d.relations, [], '纲要失物行以方位/类象为法，未以生克断失物，不得杜撰关系');
  assert.ok(!d.roles['失物'] && !d.roles['物品'], '不得为失物本身造一个固定符号——纲要作「类象定物」');
  var banned = /一定被偷|必被盗|肯定在|必然在|一定在/;
  SAMPLES.forEach(function (c) {
    run(c, 'lost_item').readings.forEach(function (o) {
      o.concept.forEach(function (w) { assert.ok(!banned.test(w), '失物判读出现绝对断言：' + w); });
    });
  });
});

console.log('== 出处守卫（basis 反模式） ==');
t('每条规则的 basis 必须指向纲要或既有知识库，禁止含糊措辞', function () {
  var vague = /^(传统奇门|常识|通行说法|一般认为|common sense|traditional|standard interpretation)/i;
  var checked = 0;
  Object.keys(RULES.domains).forEach(function (dm) {
    ['conditions', 'combinations', 'relations'].forEach(function (k) {
      (RULES.domains[dm][k] || []).forEach(function (r) {
        checked++;
        assert.ok(r.basis && r.basis.trim().length >= 8, r.id + ' 的 basis 过短或缺失');
        assert.ok(!vague.test(r.basis.trim()), r.id + ' 的 basis 含糊：' + r.basis);
        assert.ok(/纲要|symbols\.json|domains\.json/.test(r.basis),
          r.id + ' 的 basis 未指向纲要或既有知识库：' + r.basis);
      });
    });
  });
  assert.ok(checked > 150, '应检验到全部规则，实得 ' + checked);
});
t('角色登记同样须有出处与 roleType', function () {
  Object.keys(RULES.domains).forEach(function (dm) {
    var roles = RULES.domains[dm].roles || {};
    Object.keys(roles).forEach(function (n) {
      assert.ok(/纲要|symbols\.json|domains\.json/.test(roles[n].basis || ''), dm + '.' + n + ' 角色缺出处');
      assert.ok(RULES.roleTypes[roles[n].roleType], dm + '.' + n + ' roleType 未在 roleTypes 中声明');
    });
  });
});
t('新增占类的引用元素都能被盘面定位（无死规则）', function () {
  var idx = XY.indexChart(CHART);
  var names = {};
  ['career', 'relationship', 'health', 'lawsuit', 'lost_item'].forEach(function (dm) {
    Object.keys(RULES.domains[dm].roles).forEach(function (n) { names[n] = dm; });
    (RULES.domains[dm].combinations || []).forEach(function (r) {
      (r.elements || []).forEach(function (n) { names[n] = dm; });
    });
  });
  Object.keys(names).forEach(function (n) {
    assert.ok(XY.resolveElement(n, idx), names[n] + ' 引用的 ' + n + ' 在盘上定位不到，规则永不触发');
  });
});

console.log('== Phase 2.3 新增 DSL ==');
t('gongState：八神以宫旺衰论力，且与 wangshuai 一致', function () {
  var checked = 0;
  SAMPLES.forEach(function (c) {
    var ws = WS.analyze(c);
    ['career', 'relationship', 'lawsuit', 'lost_item'].forEach(function (dm) {
      XY.analyze({ domain: dm, chart: c, wangshuai: ws }).readings.forEach(function (x) {
        if (!x.matched.gongState) return;
        checked++;
        assert.strictEqual(x.matched.gongState, ws.gongs[x.gong].gongState,
          x.id + ' 宫旺衰与 wangshuai 不符');
      });
    });
  });
  assert.ok(checked > 20, '应检验到足量宫旺衰判读，实得 ' + checked);
});
t('八神仍不参五行：对八神写 state 永不命中', function () {
  var idx = XY.indexChart(CHART), ws = WS.analyze(CHART);
  ['六合', '玄武', '太阴', '九地'].forEach(function (n) {
    var el = XY.resolveElement(n, idx);
    assert.ok(el, n + ' 应在盘上');
    var r = run(CHART, 'relationship');
    // 规则库中不得对八神写 state（写了也不会命中，等于死规则）
    Object.keys(RULES.domains).forEach(function (dm) {
      (RULES.domains[dm].conditions || []).forEach(function (rule) {
        if (rule.on === n && rule.when && rule.when.state) {
          assert.fail(rule.id + ' 对八神写了 state，永不命中——应改用 gongState');
        }
      });
    });
  });
});
t('chong：对宫相冲与 yingqi 六冲表一致（宫支逐对回推）', function () {
  var YQ = require('./yingqi.js');
  var GONG_ZHI = { '1': ['子'], '2': ['未', '申'], '3': ['卯'], '4': ['辰', '巳'], '6': ['戌', '亥'], '7': ['酉'], '8': ['丑', '寅'], '9': ['午'] };
  Object.keys(XY._TABLES.GONG_CHONG).forEach(function (a) {
    var b = XY._TABLES.GONG_CHONG[a];
    var za = GONG_ZHI[a], zb = GONG_ZHI[b];
    assert.ok(za && zb, a + '/' + b + ' 宫支缺失');
    assert.strictEqual(za.length, zb.length, a + '↔' + b + ' 宫支数不等，不构成整体相冲');
    za.forEach(function (z, i) {
      assert.strictEqual(YQ.chongOf(z), zb[i], a + '宫' + z + ' 之冲应为 ' + zb[i] + '，实为 ' + YQ.chongOf(z));
    });
  });
  assert.ok(!XY._TABLES.GONG_CHONG['5'], '中五无支，不参相冲');
});
t('chong 与生克并存：相冲另行加判，不覆盖生克那一条', function () {
  var both = 0;
  SAMPLES.forEach(function (c) {
    var byId = {};
    run(c, 'relationship').relations.forEach(function (x) {
      byId[x.id] = byId[x.id] || [];
      byId[x.id].push(x.relation);
    });
    Object.keys(byId).forEach(function (id) {
      if (byId[id].indexOf('chong') >= 0 && byId[id].length > 1) both++;
      assert.ok(byId[id].filter(function (k) { return k === 'chong'; }).length <= 1, id + ' 冲只应判一次');
    });
  });
  assert.ok(both > 0, '样本中应出现「既生克又相冲」并存的情形，实得 ' + both);
});
t('chong 只在规则声明 map.chong 时产出', function () {
  SAMPLES.forEach(function (c) {
    ['wealth', 'career', 'health', 'lawsuit'].forEach(function (dm) {
      run(c, dm).relations.forEach(function (x) {
        if (x.relation !== 'chong') return;
        var rule = (RULES.domains[dm].relations || []).filter(function (r) { return r.id === x.id; })[0];
        assert.ok(rule && rule.map.chong, x.id + ' 未声明 map.chong 却产出了冲');
      });
    });
  });
});

console.log('== 零串味：五占类在飞盘上一律不执行 ==');
t('五占类遇飞盘均整体停用，且不漏出任何转盘取用', function () {
  var fp = { renPanMen: { '1': '开门' }, tianPanYi: { '1': '庚' }, siZhu: { day: '甲子', month: '丙寅', time: '庚午' } };
  ['career', 'relationship', 'health', 'lawsuit', 'lost_item'].forEach(function (dm) {
    var r = XY.analyze({ domain: dm, chart: fp });
    assert.strictEqual(r.applicable, false, dm + ' 不得在飞盘上执行');
    assert.strictEqual(r.readings.length, 0, dm + ' 飞盘上不得有判读');
    assert.strictEqual(r.combinations.length, 0);
    assert.strictEqual(r.relations.length, 0);
    assert.strictEqual(r.focus.length, 0);
    assert.ok(/零串味/.test(r.reason), dm + ' 须说明因盘别隔离而停用');
    var txt = XY.toPromptBlock(r);
    ['开门', '六合', '天芮', '玄武', '庚', '★'].forEach(function (leak) {
      assert.ok(txt.indexOf(leak) < 0, dm + ' 飞盘提示块漏出了转盘取用：' + leak);
    });
  });
});
t('显式 school=feipan 时五占类同样停用（不依赖 schema 猜测）', function () {
  ['career', 'relationship', 'health', 'lawsuit', 'lost_item'].forEach(function (dm) {
    var r = XY.analyze({ domain: dm, chart: CHART, wangshuai: WS.analyze(CHART), options: { school: 'feipan' } });
    assert.strictEqual(r.applicable, false, dm + ' 显式飞盘时须停用');
    assert.strictEqual(r.readings.length + r.combinations.length + r.relations.length, 0);
  });
});
t('appliesTo 机制未被削弱：仍只认转盘', function () {
  assert.deepStrictEqual(RULES.appliesTo, ['zhuanpan'], 'appliesTo 不得放宽');
  assert.ok(!RULES.domains.career.appliesTo, '不得给单个占类开后门绕过全局 appliesTo');
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

t('据实测复盘改正的两条判读：范围限定齐备且指明别的该看哪里', function () {
  function findCond(dom, id) {
    return (RULES.domains[dom].conditions || []).filter(function (c) { return c.id === id; })[0];
  }
  // ① 玄武休囚死：原作「藏得不深」，纲要无据且与二节「方位定处」相抵触
  var xw = findCond('lost_item', 'lost_item.玄武.宫休囚死');
  assert.ok(xw, '缺 lost_item.玄武.宫休囚死');
  assert.strictEqual(xw.answers, '显隐');
  assert.ok(!/藏得不深/.test(xw.concept.join('')), '「藏得不深」纲要无据，不得留在 concept 里');
  assert.ok(/不断远近/.test(xw.answersNote) && /方位定处/.test(xw.answersNote),
    '须指明远近处所由落宫方位定');
  assert.ok(xw._authoringFix && /撰写之误/.test(xw._authoringFix), '撰写之误须留档，不得悄悄改掉');
  // ② 事业生门旺相：纲要事业行取的是开门+值符，生门只是辅用；向背由时干宫断
  var sm = findCond('career', 'career.生门.旺相');
  assert.strictEqual(sm.answers, '事体有无实利');
  assert.ok(/不断对方是否履约/.test(sm.answersNote));
  assert.ok(/时干宫/.test(sm.answersNote), '须指明向背该看时干宫');
  assert.ok(/开门 \+ 值符/.test(sm.answersNote), '须点明纲要事业行取的并非生门');
});
t('凡带 answersNote 者必同时带 answers，反之亦然（不得只写一半）', function () {
  Object.keys(RULES.domains).forEach(function (id) {
    var d = RULES.domains[id];
    [].concat(d.conditions || [], d.combinations || []).forEach(function (c) {
      if (c.answers || c.answersNote) {
        assert.ok(c.answers && c.answersNote, c.id + ' 的范围限定只写了一半');
        assert.ok(c.answersNote.length >= 20, c.id + ' 的范围说明过短，说不清「别的该看哪里」');
      }
    });
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
