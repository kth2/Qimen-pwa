/**
 * Phase 33「行人」占类 回归测试（纯 Node，无框架）。
 * 运行：node core/traveler.test.js
 *
 * 起因：用户问「他什么时候回来」，界面报「转盘不支持『行人』占类，本次会落回『综合』且取不到专用用神」。
 * 这句是**误报**：两派引擎 YONG_SHEN_RULES 都有「行人→开门」，按问句自动判出行人时当场就取好了开门。
 * 错在知识库的支持表——08-27 只测了界面下拉映射到的占类，引擎自有而下拉没有的「行人」从未入表，
 * 查表查不到便报不支持；且 domains.json 初版把「行人」挂在 general 下，规则层也就无专条可用。
 *
 * 本期：支持表按引擎全表重测（见 categorymap.test.js）；新立规则占类 traveler(行人)；
 * 象义专条**只收纲要有原文者**，每句引文须能在纲要里逐字找到——本文件逐句核对。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

var ROOT = path.join(__dirname, '..');
global.window = {};
require(path.join(ROOT, 'engine.bundle.js'));
var QM = global.window.QM;
var DOMAINS = require('../knowledge/domains.json');
var RULES = require('../knowledge/domain-rules.json');
var YS = require('./yongshen.js'); YS.load(DOMAINS);
var XY = require('./xiangyi.js'); XY.load(RULES);
var WS = require('./wangshuai.js');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function pan(iso) { return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合' }); }
function kaiMenGong(p) { return Object.keys(p.baMen).filter(function (g) { return p.baMen[g] === '开门'; })[0]; }

var MA = '2026-01-02T10:30:00';     // 开门落 6 宫，驿马亦在 6 宫
var KONG = '2026-01-03T10:30:00';   // 开门落 3 宫，旬空 8、3

console.log('== 引擎本来就支持行人（那句「不支持」是误报） ==');
t('转盘引擎按问句自动判出行人，且当场取到开门', function () {
  var p = pan(MA);
  ['我朋友今天会不会回来', '他何时到', '出差的人什么时候回来'].forEach(function (q) {
    var c = QM.zhuanpanPredict.buildPrompt(p, q, { methodText: 'x' }).context;
    assert.strictEqual(c.category, '行人', q);
    assert.ok(c.yong && c.yong.matched, q + ' 未 matched');
    assert.ok(c.yong.located.some(function (x) { return x.name === '开门'; }), q + ' 未取开门');
  });
});
t('支持表两派都已记上行人', function () {
  assert.ok(DOMAINS.engineSupport.zhuanpan.indexOf('行人') >= 0);
  assert.ok(DOMAINS.engineSupport.feipan.indexOf('行人') >= 0);
});
t('界面预览不再报「转盘不支持行人」', function () {
  var m = YS.categoryMap('行人', 'zhuanpan');
  assert.strictEqual(m.engineSupported, true);
  assert.strictEqual(m.ruleDomain, 'traveler');
});

console.log('== 规则占类 traveler(行人) ==');
t('domains.json：用神依引擎与纲要，辅用神与象义只收有出处者', function () {
  var d = DOMAINS.domains.traveler;
  assert.ok(d, '缺 traveler');
  assert.strictEqual(d.label, '行人');
  assert.deepStrictEqual(d.uiPurposes, ['行人']);
  assert.deepStrictEqual(d.engineCategories, ['行人']);
  assert.deepStrictEqual(d.yongshen.primary, ['开门'], '主用神须与引擎「行人→开门」一致');
  assert.deepStrictEqual(d.yongshen.self, ['日干']);
  assert.deepStrictEqual(d.yongshen.secondary, [], '纲要未给辅用神，不添');
  assert.ok(DOMAINS._domainOrder.indexOf('traveler') > DOMAINS._domainOrder.indexOf('travel'));
  assert.ok(DOMAINS.domains.general.engineCategories.indexOf('行人') < 0, '行人不得再挂在 general 下');
});
t('YS.resolve 取得到开门与日干', function () {
  var r = YS.resolve({ domain: 'traveler', chart: pan(MA) });
  var names = r.examine.map(function (x) { return x.name; });
  assert.ok(names.indexOf('开门') >= 0 && names.indexOf('日干') >= 0, names.join(','));
});

console.log('== 象义专条：只收纲要有原文者，逐句可核 ==');
var T = RULES.domains.traveler;
t('标 core 而非 complete：纲要只给六条条件、未给组合，不为凑数另编', function () {
  assert.strictEqual(T.status, 'core');
  assert.strictEqual((T.conditions || []).length, 6);
  assert.deepStrictEqual(T.combinations, []);
  assert.ok(/不为凑数另编/.test(T._focusNote));
});
t('每一条 basis 都以「纲要·」起头，不冒用〔用户所定〕', function () {
  var all = [];
  Object.keys(T.roles).forEach(function (k) { all.push(['role ' + k, T.roles[k].basis]); });
  T.conditions.forEach(function (c) { all.push([c.id, c.basis]); });
  T.relations.forEach(function (r) { all.push([r.id, r.basis]); });
  all.forEach(function (x) {
    assert.ok(/^纲要·/.test(x[1]), x[0] + ' 未以纲要·起头');
    assert.ok(!/用户所定/.test(x[1]), x[0] + ' 冒用了用户所定');
  });
});
t('每句「纲要·X：」之后的引文，都能在转盘纲要里逐字找到', function () {
  // 比对时只抹掉排版差异：markdown 粗体、空白、全半角括号引号标点、列表连接符
  var norm = function (s) {
    return String(s).replace(/\*\*/g, '').replace(/[\s　]/g, '').replace(/（/g, '(').replace(/）/g, ')')
      .replace(/[“”"]/g, '"').replace(/，/g, ',').replace(/；/g, ';').replace(/：/g, ':');
  };
  var G = norm(fs.readFileSync(path.join(ROOT, 'assets', 'zhuanpan-method.md'), 'utf8').replace(/\n\s*-\s*/g, ''));
  var bases = [];
  Object.keys(T.roles).forEach(function (k) { bases.push(['role ' + k, T.roles[k].basis]); });
  T.conditions.forEach(function (c) { bases.push([c.id, c.basis]); });
  T.relations.forEach(function (r) { bases.push([r.id, r.basis]); });
  var bad = [], n = 0;
  bases.forEach(function (b) {
    String(b[1]).split(/。(?=纲要·|〔)/).forEach(function (cl) {
      if (!cl || /^〔本层说明〕/.test(cl)) return;
      var m = cl.match(/^纲要·[^：]*：(.*)$/);
      if (!m) { bad.push(b[0] + '（无纲要标签）：' + cl); return; }
      m[1].split('；').forEach(function (q) { n++; if (G.indexOf(norm(q)) < 0) bad.push(b[0] + '：' + q); });
    });
  });
  assert.deepStrictEqual(bad, [], '以下引文在纲要里找不到原句：\n    ' + bad.join('\n    '));
  assert.ok(n >= 30, '可核引文太少：' + n);
});
t('只断迟速的两条写明了「只答什么、别的看哪里」', function () {
  T.conditions.filter(function (c) { return /gongState/.test(c.id); }).forEach(function (c) {
    assert.strictEqual(c.answers, '迟速', c.id);
    assert.ok(/不断来不来/.test(c.answersNote), c.id + ' 未说明不答来否');
  });
});

console.log('== 判读实际命中 ==');
function reads(iso) {
  var p = pan(iso), ws = WS.analyze(p);
  return { p: p, r: XY.analyze({ domain: 'traveler', chart: p, wangshuai: ws, options: { school: 'zhuanpan' } }) };
}
function fired(r, id) { return (r.readings || []).filter(function (x) { return x.id === id; })[0]; }
t('开门临驿马 → 驿马条命中，为「助」', function () {
  var o = reads(MA);
  assert.strictEqual(String(o.p.maStar.gong), kaiMenGong(o.p), '前提：开门与驿马同宫');
  var f = fired(o.r, 'traveler.开门.flags-驿马');
  assert.ok(f, '驿马条未命中');
  assert.strictEqual(f.polarity, '+');
});
t('开门空亡 → 空亡条命中，为「阻」', function () {
  var o = reads(KONG);
  assert.ok((o.p.kongWangGong || []).map(String).indexOf(kaiMenGong(o.p)) >= 0, '前提：开门落空亡宫');
  var f = fired(o.r, 'traveler.开门.flags-空亡');
  assert.ok(f, '空亡条未命中');
  assert.strictEqual(f.polarity, '-');
});
t('日干—开门关系条逐盘都有判读（六种关系各有其读法）', function () {
  var o = reads(MA);
  var rel = (o.r.relations || []).filter(function (x) { return x.id && x.id.indexOf('traveler.rel.') === 0; });
  assert.ok(rel.length >= 1, '关系条未出');
  var kinds = Object.keys(T.relations[0].map);
  ['same_gong', 'to_sheng_from', 'same_element', 'from_ke_to', 'to_ke_from', 'from_sheng_to'].forEach(function (k) {
    assert.ok(kinds.indexOf(k) >= 0, '缺关系读法 ' + k);
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
