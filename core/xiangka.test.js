/**
 * 九宫象义卡 core 单元测试（纯 Node，无框架）。
 * 运行：node core/xiangka.test.js
 * 要害：① 九宫一宫不漏；② 每条象都带出处，且出处只有纲要/统宗/旨归/集成四家；
 *       ③ 角色宫取法（含甲）与 app.js、xiangyi 同一口径；④ 飞盘不用本层（零串味）；
 *       ⑤ 不判吉凶、不算力量——卡里不得出现吉凶分数。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var XK = require('./xiangka.js');
var WS = require('./wangshuai.js');
var LXJ = require('../knowledge/leixiang.json');
var CLJ = require('../knowledge/classics-xiangyi.json');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function chart(iso) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
}

console.log('== 加载 ==');
t('未加载时 build 不适用，并说明原因', function () {
  var r = XK.build({ chart: chart('2026-08-27T14:00:00') });
  assert.strictEqual(r.applicable, false);
  assert.ok(/未加载/.test(r.reason), r.reason);
  assert.strictEqual(XK.toPromptBlock(r), '');
});
t('纲要类象表必需，古籍表可缺', function () {
  assert.strictEqual(XK.load(null, CLJ), false);
  assert.strictEqual(XK.load(LXJ, null), true);
  var r = XK.build({ chart: chart('2026-08-27T14:00:00') });
  assert.ok(r.applicable);
  var block = XK.toPromptBlock(r);
  assert.ok(/〔纲要〕/.test(block));
  assert.ok(!/〔统宗〕|〔旨归|〔集成〕/.test(block), '古籍表未注入却出现了古籍出处');
  assert.ok(XK.load(LXJ, CLJ));
});

console.log('== 九宫 ==');
var DATES = ['2026-08-27T14:00:00', '2025-09-30T09:30:00', '2026-03-03T23:10:00', '2024-12-21T06:00:00', '2026-06-21T12:00:00'];
t('五张盘：九宫一宫不漏，按 1..9 排列', function () {
  DATES.forEach(function (d) {
    var r = XK.build({ chart: chart(d) });
    assert.ok(r.applicable, d);
    assert.deepStrictEqual(r.cards.map(function (c) { return c.gong; }), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });
});
t('八个外宫各有一门，中五无门', function () {
  DATES.forEach(function (d) {
    var r = XK.build({ chart: chart(d) });
    r.cards.forEach(function (c) {
      var n = c.items.filter(function (it) { return it.layer === '门'; }).length;
      if (c.gong === '5') assert.strictEqual(n, 0, d + ' 中五有门');
      else assert.strictEqual(n, 1, d + ' ' + c.gong + '宫门数 ' + n);
    });
  });
});
t('每条象都带出处，出处只有纲要/统宗/旨归/集成四家', function () {
  DATES.forEach(function (d) {
    var r = XK.build({ chart: chart(d) });
    r.cards.forEach(function (c) {
      c.items.forEach(function (it) {
        it.xiang.forEach(function (x) {
          assert.ok(/^〔(纲要|统宗|集成|旨归·[休生伤杜景死惊开]加[坎坤震巽乾兑艮离])〕/.test(x), d + ' 无出处：' + x);
        });
      });
    });
  });
});
t('方位与场所照抄纲要三节九宫表', function () {
  var r = XK.build({ chart: chart('2026-08-27T14:00:00') });
  var m = {}; r.cards.forEach(function (c) { m[c.gong] = c; });
  assert.strictEqual(m['1'].dir, '正北'); assert.ok(/卫浴/.test(m['1'].place));
  assert.strictEqual(m['7'].dir, '正西'); assert.ok(/口形器物/.test(m['7'].place));
  assert.strictEqual(m['8'].dir, '东北'); assert.ok(/桌柜/.test(m['8'].place));
});
t('白虎、玄武按统宗「勾陈（下有白虎）」「朱雀（下有玄武）」取象', function () {
  var hit = { '白虎': 0, '玄武': 0 };
  DATES.forEach(function (d) {
    var r = XK.build({ chart: chart(d) });
    r.cards.forEach(function (c) {
      c.items.forEach(function (it) {
        if (it.layer === '神' && hit[it.name] != null) {
          hit[it.name]++;
          assert.ok(it.xiang.some(function (x) { return /^〔统宗〕/.test(x); }), it.name + ' 未取到统宗之象');
        }
      });
    });
  });
  assert.ok(hit['白虎'] > 0 && hit['玄武'] > 0, '五张盘里竟无白虎或玄武');
});

console.log('== 角色宫 ==');
t('日干、时干、值符、值使四个角色都落了宫', function () {
  DATES.forEach(function (d) {
    var r = XK.build({ chart: chart(d) });
    var all = [].concat.apply([], Object.keys(r.roles).map(function (g) { return r.roles[g]; }));
    ['日干（我）', '时干（所问之事）', '值符（大势·开端）', '值使（经过·落点）'].forEach(function (k) {
      assert.ok(all.indexOf(k) >= 0, d + ' 缺角色 ' + k);
    });
  });
});
t('非甲时干：取天盘该干所落之宫', function () {
  var p = chart('2026-08-27T14:00:00');
  var shi = p.siZhu.time.charAt(0);
  assert.notStrictEqual(shi, '甲');
  var g = null; for (var k in p.tianPan) if (p.tianPan[k] === shi) g = k;
  assert.ok(g, '天盘未见时干');
  assert.ok(XK.roles(p)[g].indexOf('时干（所问之事）') >= 0);
});
t('时干为甲：以值符落宫论', function () {
  var found = 0;
  for (var h = 0; h < 24 * 12 && found < 3; h += 2) {
    var p = chart(new Date(Date.UTC(2026, 0, 1, h, 30)).toISOString());
    if (p.siZhu.time.charAt(0) !== '甲') continue;
    found++;
    var zf = String(p.zhiFuLuoGong || p.zhiFuGong);
    assert.ok(XK.roles(p)[zf].indexOf('时干（所问之事）') >= 0, p.siZhu.time);
  }
  assert.ok(found > 0, '十二天里竟找不到甲时');
});
t('日干为甲：按本日之甲所遁之仪取宫，不取值符', function () {
  var DUN = { '甲子': '戊', '甲戌': '己', '甲申': '庚', '甲午': '辛', '甲辰': '壬', '甲寅': '癸' };
  var found = 0;
  for (var d = 0; d < 30 && found < 2; d++) {
    var p = chart(new Date(Date.UTC(2026, 1, 1 + d, 4, 0)).toISOString());
    if (p.siZhu.day.charAt(0) !== '甲') continue;
    found++;
    var yi = DUN[p.siZhu.day], g = null;
    for (var k in p.tianPan) if (p.tianPan[k] === yi) g = k;
    if (!g) for (var k2 in p.diPan) if (p.diPan[k2] === yi) g = k2;
    assert.ok(XK.roles(p)[g].indexOf('日干（我）') >= 0, p.siZhu.day + ' 应取 ' + yi + ' 落宫 ' + g);
  }
  assert.ok(found > 0, '三十天里竟找不到甲日');
});
t('调用方所给的用神角色照实标注', function () {
  var r = XK.build({ chart: chart('2026-08-27T14:00:00'), extraRoles: [{ name: '六合', role: '六合（所寻之猫）', gong: '6' }] });
  var c6 = r.cards.filter(function (c) { return c.gong === '6'; })[0];
  assert.ok(c6.roles.indexOf('六合（所寻之猫）') >= 0);
});

console.log('== 状态与文本块 ==');
t('旺衰照抄 wangshuai，空亡照抄引擎', function () {
  var p = chart('2026-08-27T14:00:00');
  var ws = WS.analyze(p);
  var r = XK.build({ chart: p, wangshuai: ws });
  r.cards.forEach(function (c) {
    var w = ws.gongs[c.gong] || {};
    if (w.gongState) assert.ok(c.state.indexOf('宫' + w.gongState) === 0, c.gong + '：' + c.state);
    var kong = (p.kongWangGong || []).map(String).indexOf(c.gong) >= 0;
    assert.strictEqual(/空亡/.test(c.state), kong, c.gong + ' 空亡标记不符');
  });
});
t('文本块：角色宫排在前面，九宫俱在', function () {
  var r = XK.build({ chart: chart('2026-08-27T14:00:00') });
  var lines = XK.toPromptBlock(r).split('\n').filter(function (l) { return /^\S+宫·/.test(l); });
  assert.strictEqual(lines.length, 9);
  var firstNoRole = lines.findIndex(function (l) { return /角色：无/.test(l); });
  lines.slice(firstNoRole).forEach(function (l) { assert.ok(/角色：无/.test(l), '角色宫排到了旁证宫之后：' + l); });
});
t('不判吉凶、不算力量：卡里没有吉凶分数', function () {
  DATES.forEach(function (d) {
    var b = XK.toPromptBlock(XK.build({ chart: chart(d), wangshuai: WS.analyze(chart(d)) }));
    assert.ok(!/[大小]?[吉凶]\s*[（(]?\s*[-+]?\d/.test(b), d + ' 卡中出现吉凶分');
    assert.ok(!/力量\s*\d/.test(b), d + ' 卡中出现力量值');
  });
});
t('文本块长度适中（< 5000 字）', function () {
  DATES.forEach(function (d) {
    var b = XK.toPromptBlock(XK.build({ chart: chart(d), wangshuai: WS.analyze(chart(d)) }));
    assert.ok(b.length > 1200 && b.length < 5000, d + ' 长度 ' + b.length);
  });
});

console.log('== 零串味 ==');
t('飞盘不用本层', function () {
  var f = QM.feipanQimen.calculate(new Date('2026-08-27T10:00:00'), { method: '时家', purpose: '综合' });
  var r = XK.build({ chart: f });
  assert.strictEqual(r.applicable, false);
  assert.ok(/飞盘/.test(r.reason));
  assert.strictEqual(XK.toPromptBlock(r), '');
});
t('无盘不崩', function () {
  assert.strictEqual(XK.build({}).applicable, false);
  assert.strictEqual(XK.build().applicable, false);
});
t('古籍象义表声明只适用于转盘', function () {
  assert.ok(JSON.stringify(CLJ).indexOf('zhuanpan') >= 0);
  assert.ok(!/"appliesTo"\s*:\s*\[[^\]]*feipan/.test(JSON.stringify(CLJ)));
});

console.log('== 叙事纲要 ==');
var NM = fs.readFileSync(path.join(__dirname, '..', 'assets', 'narrative-method.md'), 'utf8');
t('叙事纲要：九宫都过一遍、象只取自卡、每句标宫', function () {
  assert.ok(/九宫/.test(NM) && /象义卡/.test(NM));
  assert.ok(/标.{0,6}宫/.test(NM));
});
t('叙事纲要：保留病情不宽慰、不作医学诊断两条', function () {
  assert.ok(/宽慰/.test(NM) && /医学诊断/.test(NM));
});
t('叙事纲要：应期只在锚点里选', function () {
  assert.ok(/锚点/.test(NM));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
