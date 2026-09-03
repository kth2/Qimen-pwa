/**
 * Phase 21 取数层 回归测试（纯 Node，无框架）。
 * 运行：node core/qushu.test.js
 *
 * 起因是一例断错：2026-09-03 用户报来一张高考分数盘，AI 断 560～580，实际 620，
 * 事后 AI 自陈「按纲要断不出这个结果」。问题不在算错，在**数源只有一路**——
 * 用神宫天地盘干的河图数。用神所落之宫本身的宫数（后天洛书数／先天卦数）
 * 从来不在候选里；纲要「范围大则乘宫数/层数」一句里，宫数只当倍率使。
 *
 * 本层补的是数源，**不是准头**。故本文件除了钉住数源与出处，还专门钉住三件事：
 *   ① 可达度量必须出——数源一多，事后总凑得出实际值，那是拟合不是断准；
 *   ② 连读与定量级两法出自〔用户所定〕，纲要无此文，措辞不得冒充纲要；
 *   ③ 效应未测这句话不许被删——宫数入候选是否更准，本仓一个数据都没有。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var WS = require('./wangshuai.js');
var YS = require('./yongshen.js');
var EV = require('./evidence.js');
var QS = require('./qushu.js');
var RULES = require('../knowledge/qushu-rules.json');
QS.load(RULES);
YS.load(require('../knowledge/domains.json'));
EV.load(require('../knowledge/symbols.json'));

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function zp(iso, purpose) {
  return QM.qimen.calculate(new Date(iso), {
    type: '四柱', method: '时家', purpose: purpose || '综合', location: '默认位置'
  });
}
function ysOf(pan, domain) {
  return YS.resolve({ domain: domain || 'study', chart: pan, options: { school: 'zhuanpan' } });
}
function run(pan, domain) {
  return QS.analyze({ yongshen: ysOf(pan, domain), wangshuai: WS.analyze(pan), options: { school: 'zhuanpan' } });
}

console.log('\n== 数源：宫数这一路此前根本不存在 ==');
t('先天八卦数：乾一兑二离三震四巽五坎六艮七坤八，中五无卦', function () {
  assert.strictEqual(QS.xianTianOf('6'), 1, '乾居后天六宫，先天数一');
  assert.strictEqual(QS.xianTianOf('7'), 2);
  assert.strictEqual(QS.xianTianOf('9'), 3);
  assert.strictEqual(QS.xianTianOf('3'), 4);
  assert.strictEqual(QS.xianTianOf('4'), 5);
  assert.strictEqual(QS.xianTianOf('1'), 6);
  assert.strictEqual(QS.xianTianOf('8'), 7);
  assert.strictEqual(QS.xianTianOf('2'), 8);
  assert.strictEqual(QS.xianTianOf('5'), null, '中五宫无先天卦数，须返回 null 而非 0 或 5');
});
t('后天宫数即宫号，1～9 之外一律不认', function () {
  for (var i = 1; i <= 9; i++) assert.strictEqual(QS.houTianOf(String(i)), i);
  assert.strictEqual(QS.houTianOf('0'), null);
  assert.strictEqual(QS.houTianOf('10'), null);
  assert.strictEqual(QS.houTianOf(''), null);
});
t('河图数与纲要表一致（甲乙3·8 丙丁7·2 戊己5·10 庚辛9·4 壬癸1·6）', function () {
  var want = { '甲': 3, '乙': 8, '丙': 7, '丁': 2, '戊': 5, '己': 10, '庚': 9, '辛': 4, '壬': 1, '癸': 6 };
  Object.keys(want).forEach(function (g) { assert.strictEqual(QS.heTuOf(g), want[g], g); });
});
t('每个用神都同时给出四路数源（两路河图 + 两路宫数）', function () {
  var r = run(zp('2026-06-07T09:30:00'));
  assert.ok(r.applicable, '应可排');
  assert.ok(r.targets.length > 0);
  r.targets.forEach(function (x) {
    assert.ok('hetuTian' in x.sources && 'hetuDi' in x.sources, x.name + ' 缺河图数栏');
    assert.ok('houtian' in x.sources && 'xiantian' in x.sources, x.name + ' 缺宫数栏');
    if (x.gong !== '5') assert.strictEqual(typeof x.sources.houtian, 'number', x.name + ' 后天宫数应为数');
  });
});

console.log('\n== 用户那一例：宫数入候选之后，62 才够得着 ==');
t('丁@乾六取6、时干@坤二取2，连读得 62——此前这条路走不通', function () {
  // 直接照用户所述的落宫构造，不依赖某一张具体的盘：本条钉的是**算法能不能到**，
  // 不是那一天的盘长什么样。
  var r = QS.analyze({
    yongshen: {
      examine: [
        { name: '丁', gong: '6', tianGan: '丁', diGan: '壬', gongName: '乾', direction: '西北' },
        { name: '时干', resolved: '庚', gong: '2', tianGan: '庚', diGan: '庚', gongName: '坤', direction: '西南' }
      ]
    }
  });
  var got = r.candidates.filter(function (c) { return c.value === 62; });
  assert.ok(got.length > 0, '连读 6、2 应得 62');
  assert.strictEqual(got[0].method, 'concat');
  assert.strictEqual(got[0].level, '用户所定', '连读法出自用户所定，纲要无此文');
  // 反向：只靠河图数一路够不着——丁2、壬1、庚9、庚9，无论单取相加都到不了 62
  var heTuOnly = r.candidates.filter(function (c) { return c.method === 'single' || c.method === 'sum'; });
  assert.ok(heTuOnly.every(function (c) { return c.value !== 62; }), '河图数与单取相加皆不应凑出 62');
});
t('连读两序皆出——正因两序皆通，用此法必须先说清凭什么是这个次序', function () {
  var r = QS.analyze({
    yongshen: { examine: [
      { name: 'A', gong: '6', tianGan: '丁', diGan: '丁' },
      { name: 'B', gong: '2', tianGan: '庚', diGan: '庚' }
    ] }
  });
  var vals = r.candidates.filter(function (c) { return c.method === 'concat'; })
    .map(function (c) { return c.value; });
  assert.ok(vals.indexOf(62) >= 0 && vals.indexOf(26) >= 0, '62 与 26 都应在候选里，得 ' + vals.join(','));
});

console.log('\n== 反事后凑数：可达度量必须出 ==');
t('报出可达的相异数值个数与全部取值', function () {
  var r = run(zp('2026-06-07T09:30:00'));
  assert.strictEqual(typeof r.reachable, 'number');
  assert.ok(r.reachable > 0);
  assert.ok(r.span && Array.isArray(r.span.values));
  assert.strictEqual(r.span.values.length, r.reachable, 'reachable 须等于相异取值个数');
  var sorted = r.span.values.slice().sort(function (a, b) { return a - b; });
  assert.deepStrictEqual(r.span.values, sorted, '取值须已排序，便于人眼核对');
  assert.strictEqual(new Set(r.span.values).size, r.span.values.length, '不得有重复值');
});
t('可达数确实随用神个数增长——多列用神就是多开凑数的门', function () {
  var base = { name: '', gong: '', tianGan: '', diGan: '' };
  function mk(n) {
    var ex = [
      { name: 'A', gong: '6', tianGan: '丁', diGan: '壬' },
      { name: 'B', gong: '2', tianGan: '庚', diGan: '庚' },
      { name: 'C', gong: '9', tianGan: '戊', diGan: '戊' },
      { name: 'D', gong: '3', tianGan: '辛', diGan: '丙' }
    ].slice(0, n);
    return QS.analyze({ yongshen: { examine: ex } }).reachable;
  }
  assert.ok(mk(1) < mk(2) && mk(2) < mk(4), '一个 ' + mk(1) + ' → 两个 ' + mk(2) + ' → 四个 ' + mk(4));
});
t('用神过多时截断并说明缘由，不无声吞掉', function () {
  var ex = [];
  for (var i = 1; i <= 8; i++) ex.push({ name: 'X' + i, gong: String(i), tianGan: '丁', diGan: '壬' });
  var r = QS.analyze({ yongshen: { examine: ex } });
  assert.ok(r.targets.length <= 4, '缺省最多取 4 个用神');
  assert.ok(r.notes.some(function (n) { return /只列权重最高/.test(n); }), '须说明截断了');
});
t('提示块把可达数与「凭什么选中它」一并写出', function () {
  var r = run(zp('2026-06-07T09:30:00'));
  var b = QS.toPromptBlock(r);
  assert.ok(/可达/.test(b) && new RegExp(String(r.reachable)).test(b), '提示块须报可达数');
  assert.ok(/拟合/.test(b), '须点明「凑得出来不等于断得出来」');
  assert.ok(/弃权|无据/.test(b), '须允许弃权');
});

console.log('\n== 出处：五条纲要、四条用户所定，一条都不许混 ==');
t('河图数/单取/相加/足数减半/乘宫数皆标纲要原文', function () {
  assert.strictEqual(RULES.sources.hetuTian.level, '纲要原文');
  assert.strictEqual(RULES.sources.hetuDi.level, '纲要原文');
  assert.strictEqual(RULES.adjust.level, '纲要原文');
  ['single', 'sum', 'scale'].forEach(function (id) {
    var c = RULES.compose.filter(function (x) { return x.id === id; })[0];
    assert.ok(c, id + ' 未定义');
    assert.strictEqual(c.level, '纲要原文', id + ' 出处应为纲要原文');
  });
});
t('后天宫数作独立候选、先天卦数、连读、定量级四条皆标用户所定并带日期', function () {
  var us = [RULES.sources.houtian, RULES.sources.xiantian]
    .concat(RULES.compose.filter(function (x) { return x.id === 'concat' || x.id === 'magnitude'; }));
  assert.strictEqual(us.length, 4);
  us.forEach(function (x) {
    assert.strictEqual(x.level, '用户所定', JSON.stringify(x.label) + ' 出处应为用户所定');
    assert.ok(/〔用户所定·\d{4}-\d{2}-\d{2}〕/.test(x.basis), x.label + ' 的 basis 须带日期');
  });
});
t('先天卦数明写「纲要未载」，不含糊', function () {
  assert.ok(/纲要.*未载|未载此数/.test(RULES.sources.xiantian.basis));
});
t('候选逐条带出处，提示块也把两级分开写', function () {
  var r = run(zp('2026-06-07T09:30:00'));
  r.candidates.forEach(function (c) {
    assert.ok(c.level && c.basis, c.method + ' 缺出处');
  });
  var b = QS.toPromptBlock(r);
  assert.ok(/〔纲要原文〕/.test(b) && /〔用户所定〕/.test(b), '提示块须两级并见');
});

console.log('\n== 分寸：本层不给答案，也不吹效果 ==');
t('输出里没有任何选定之数，只有候选与算法', function () {
  var r = run(zp('2026-06-07T09:30:00'));
  // 只扫**判读性内容**（候选本身），不扫 discipline/notes——那两处正是叫人「给出答案时
  // 须说明凭什么」的纪律文本，里头出现「答案」二字是应该的。这条曾误伤过自己：
  // 一律 JSON.stringify 全扫，纪律里的告诫会被当成结论抓出来。
  r.candidates.forEach(function (c) {
    assert.ok(!/应为|即为|断为|答案是/.test(c.how), '候选说明不得出结论：' + c.how);
    assert.ok(c.method && c.level, '候选须带算法与出处');
  });
  assert.strictEqual(r.chosen, undefined, '不得有「选定之数」这样的字段');
  assert.strictEqual(r.answer, undefined, '不得有「答案」这样的字段');
  assert.ok(!('value' in r), '顶层不得只给一个数');
});
t('明写效应未测——宫数入候选是否更准，本仓无数据', function () {
  var b = QS.toPromptBlock(run(zp('2026-06-07T09:30:00')));
  assert.ok(/一个数据都没有|未测/.test(b), '提示块须自陈效应未测');
  assert.ok(/_effectNotMeasured/.test(JSON.stringify(RULES)), '规则库须留下未测声明');
});
t('宫数一律出足数，且把「纲要没说宫数该不该打折」讲明白', function () {
  var r = run(zp('2026-06-07T09:30:00'));
  r.targets.forEach(function (x) {
    assert.ok(/纲要/.test(x.gongNumNote) && /河图数/.test(x.gongNumNote), '须点明这一句只对河图数说过');
  });
  // 休囚之宫的宫数不得被偷偷减半
  var half = r.targets.filter(function (x) { return x.adjust === 'half'; });
  half.forEach(function (x) {
    if (x.sources.houtian != null) assert.strictEqual(x.sources.houtian, Number(x.gong), '后天宫数被打折了');
  });
});
// 本条原先拿**宫**的旺衰当裁量依据（stub 只给 gongState）。那是错的：纲要
// 「旺相足数、休囚减半或取个位」紧接河图数而言，旺相的主语是**那个干**——数是干的数。
// 实机上一眼看出来的：证据包里出现「日干落4宫·宫死·力量约1」旁边跟着
// 「天盘庚河图=9(减半4)」，宫与干一衰一旺，拿宫去裁干的数，减对了也是碰巧。
// 故改为逐干各判各的，并另立一条专测「干与宫不同档」。
t('旺相足数、休囚另出减半与个位两个备选（纲要两法并存，不代为择一）', function () {
  var r = QS.analyze({
    yongshen: { examine: [{ name: 'A', gong: '1', tianGan: '己', diGan: '己' }] },
    wangshuai: { gongs: { '1': { gongState: '旺', tianGanState: '囚', diGanState: '囚', power: 0.3, harms: [] } } }
  });
  var singles = r.candidates.filter(function (c) { return c.method === 'single'; });
  var hows = singles.map(function (c) { return c.how; }).join('|');
  assert.ok(/足数/.test(hows) && /减半/.test(hows) && /个位/.test(hows), '三者须并出：' + hows);
  // 己河图数 10 → 减半 5、个位 0
  var vals = singles.map(function (c) { return c.value; });
  assert.ok(vals.indexOf(10) >= 0 && vals.indexOf(5) >= 0 && vals.indexOf(0) >= 0, vals.join(','));
});
t('减半与否论干不论宫：宫旺而干囚，河图数照样减半', function () {
  var r = QS.analyze({
    yongshen: { examine: [{ name: 'A', gong: '1', tianGan: '己', diGan: '己' }] },
    wangshuai: { gongs: { '1': { gongState: '旺', tianGanState: '囚', diGanState: '囚', power: 1, harms: [] } } }
  });
  assert.strictEqual(r.targets[0].sources.hetuTian.adjust, 'half', '干囚就该减半，哪怕宫旺');
  assert.ok(/论的是\*\*干\*\*的旺衰/.test(r.targets[0].adjustNote), '须写明论的是干');
});
t('天地两干各判各的——一宫之内一干旺一干衰是常事，不折成同一档', function () {
  var r = QS.analyze({
    yongshen: { examine: [{ name: 'A', gong: '1', tianGan: '己', diGan: '甲' }] },
    wangshuai: { gongs: { '1': { gongState: '相', tianGanState: '旺', diGanState: '死', power: 1, harms: [] } } }
  });
  var s = r.targets[0].sources;
  assert.strictEqual(s.hetuTian.adjust, 'full', '天盘干旺，取足数');
  assert.strictEqual(s.hetuDi.adjust, 'half', '地盘干死，须减半');
  var hows = r.candidates.filter(function (c) { return c.method === 'single'; })
    .map(function (c) { return c.how; }).join('|');
  assert.ok(!/天盘己旺·河图数减半/.test(hows), '旺的那一干不该出减半');
  assert.ok(/地盘甲死·河图数减半/.test(hows), '死的那一干应出减半：' + hows);
});

console.log('\n== 降级与确定性 ==');
t('规则库未载入时停用而非崩溃', function () {
  var Fresh = require(require.resolve('./qushu.js'));
  // 用一个未 load 的干净副本：清掉 require 缓存重新取
  delete require.cache[require.resolve('./qushu.js')];
  var Q2 = require('./qushu.js');
  var r = Q2.analyze({ yongshen: { examine: [{ name: 'A', gong: '1', tianGan: '丁', diGan: '壬' }] } });
  assert.strictEqual(r.applicable, false);
  assert.ok(/未载入/.test(r.reason));
  delete require.cache[require.resolve('./qushu.js')];
  QS = require('./qushu.js'); QS.load(RULES);   // 复原，后续用例照常
  assert.ok(Fresh);
});
t('无用神时如实说取数无据，并点明纲要要求以用神宫为据', function () {
  var r = QS.analyze({ yongshen: { examine: [] } });
  assert.strictEqual(r.applicable, false);
  assert.ok(/无所依附|无据/.test(r.reason));
  assert.ok(r.notes.some(function (n) { return /用神宫/.test(n); }));
});
t('缺旺衰时降级说明，河图数按足数列并另附两个备选', function () {
  var r = QS.analyze({ yongshen: { examine: [{ name: 'A', gong: '1', tianGan: '己', diGan: '己' }] } });
  assert.ok(r.applicable);
  assert.ok(/旺衰/.test(r.degraded), '须写明降级缘由');
  var vals = r.candidates.map(function (c) { return c.value; });
  assert.ok(vals.indexOf(5) >= 0 && vals.indexOf(0) >= 0, '旺衰不明时减半与个位仍须列为备选');
});
t('空参数与坏数据不抛异常', function () {
  assert.doesNotThrow(function () { QS.analyze({}); });
  assert.doesNotThrow(function () { QS.analyze(); });
  assert.doesNotThrow(function () { QS.toPromptBlock(null); });
  assert.doesNotThrow(function () { QS.analyze({ yongshen: { examine: [{ name: 'X' }] } }); });
  assert.strictEqual(QS.toPromptBlock(null), '');
});
t('确定性：同盘两次结果与提示块逐字相同', function () {
  var p = zp('2026-06-07T09:30:00');
  var a = run(p), b = run(p);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.strictEqual(QS.toPromptBlock(a), QS.toPromptBlock(b));
});
t('多盘稳健：60 张盘皆不抛错，宫数与落宫自洽', function () {
  for (var i = 0; i < 60; i++) {
    var d = new Date(2026, 0, 1 + i * 6, (i * 5) % 24, 0, 0);
    var p = QM.qimen.calculate(d, { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
    var r = QS.analyze({ yongshen: ysOf(p, 'study'), wangshuai: WS.analyze(p), options: { school: 'zhuanpan' } });
    r.targets.forEach(function (x) {
      if (x.sources.houtian != null) assert.strictEqual(x.sources.houtian, Number(x.gong), '第 ' + i + ' 盘后天宫数与落宫不符');
      if (x.gong === '5') assert.strictEqual(x.sources.xiantian, null, '中五宫不得有先天卦数');
    });
    assert.strictEqual(r.reachable, r.span ? r.span.values.length : 0);
  }
});
t('两派通用：飞盘同样排得出（河图数与卦数不涉排盘断法）', function () {
  var p = zp('2026-06-07T09:30:00');
  var r = QS.analyze({ yongshen: ysOf(p, 'study'), wangshuai: WS.analyze(p), options: { school: 'feipan' } });
  assert.strictEqual(r.school, 'feipan');
  assert.ok(r.applicable || r.reason, '飞盘上要么排得出，要么说明缘由');
  assert.strictEqual(RULES.appliesTo.indexOf('feipan') >= 0, true);
});

console.log('\n== 接入证据包 ==');
t('取数段进入证据包，并把宫数标为新补的一路', function () {
  var p = zp('2026-06-07T09:30:00');
  var q = run(p);
  var ev = EV.build({ question: '高考能考多少分', domain: 'study', chart: p, yongshen: ysOf(p, 'study'), qushu: q });
  var b = EV.toPromptBlock(ev);
  assert.ok(/【取数】/.test(b), '证据包须含取数段');
  assert.ok(/后天宫数/.test(b) && /先天卦数/.test(b), '两路宫数都要出现');
  assert.ok(/可达 \d+ 个相异数值/.test(b), '可达度量须进证据包（这才是真正送给模型的那一份）');
  assert.ok(/〔用户所定〕/.test(b), '宫数一路须标用户所定');
});
t('证据包保留取数元信息，日后才考核得了这一层', function () {
  var p = zp('2026-06-07T09:30:00');
  var ev = EV.build({ question: 'q', domain: 'study', chart: p, yongshen: ysOf(p, 'study'), qushu: run(p) });
  assert.ok(ev.qushu, '须留下 qushu 元信息');
  assert.strictEqual(typeof ev.qushu.reachable, 'number');
  assert.ok(Array.isArray(ev.qushu.targets) && ev.qushu.targets.length);
  assert.doesNotThrow(function () { JSON.stringify(ev); });
});
t('不传 qushu 时证据包行为不变（向后兼容）', function () {
  var p = zp('2026-06-07T09:30:00');
  var a = EV.toPromptBlock(EV.build({ question: 'q', domain: 'study', chart: p, yongshen: ysOf(p, 'study') }));
  assert.ok(!/【取数】/.test(a));
  assert.ok(a.length > 200, '其余内容照旧');
});
t('取数排不出时如实交代，不静默消失', function () {
  var p = zp('2026-06-07T09:30:00');
  var ev = EV.build({
    question: 'q', domain: 'study', chart: p, yongshen: ysOf(p, 'study'),
    qushu: QS.analyze({ yongshen: { examine: [] } })
  });
  assert.ok(/【取数】本次不排/.test(EV.toPromptBlock(ev)));
});

console.log('\n== app.js 源码守卫：这一层会不会真的跑起来 ==');
var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
t('取数层已接线：加载规则库、排层、进证据包、存案例', function () {
  assert.ok(/window\.QuShu/.test(APP), '未取 window.QuShu');
  assert.ok(/knowledge\/qushu-rules\.json/.test(APP), '未加载取数规则库');
  assert.ok(/QS\.analyze\(/.test(APP), '未调用 QS.analyze');
  assert.ok(/qushu,\s*calibration|qushu,/.test(APP), '未传进 EV.build');
  assert.ok(/qushu:\s*runOut\.qushu/.test(APP), '未存进案例本——不存则永远考核不了这一层');
});
t('E25/E26 已进系统提示词，且四件事与弃权俱在', function () {
  assert.ok(/E25\./.test(APP) && /E26\./.test(APP));
  var seg = APP.slice(APP.indexOf('E25.'), APP.indexOf('E20.'));
  assert.ok(/先声明/.test(seg) && /之前/.test(seg), 'E25 须要求先声明后取数');
  assert.ok(/用户所定·2026-09-03/.test(seg), '须点名哪几条出自用户所定');
  assert.ok(/弃权|无据/.test(seg), 'E26 须允许弃权');
  assert.ok(/一个数据都没有/.test(seg), '须禁止声称这一路更准');
});
t('index.html 与 sw.js 都带上了取数层（否则离线版本缺这一层）', function () {
  var idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.ok(/core\/qushu\.js/.test(idx), 'index.html 未引入');
  assert.ok(/core\/qushu\.js/.test(sw) && /knowledge\/qushu-rules\.json/.test(sw), 'sw.js 未缓存');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
