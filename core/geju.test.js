/**
 * Phase 15 八十一干加干格局 回归测试（纯 Node，无框架）。
 * 运行：node core/geju.test.js
 *
 * 锁定几条容易被后续改动破坏的约定：
 *   ① 表的方向是「天盘+地盘」——录错方向则整层全反，且不易察觉；
 *   ② 表为用户所供，出处不得标成纲要；
 *   ③ 引擎另有一套命名，20 格与本表不同，须并存而不混；
 *   ④ 本层不造吉凶等级，宫位吉凶仍走引擎。
 */
'use strict';
var path = require('path');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var G = require('./geju.js');
var DB = require('../knowledge/geju-81.json');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function zhuanpan(iso) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
}
var GAN = ['乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];

console.log('\n== 表本身 ==');
G.load(DB);
t('规则库能加载', function () { assert.strictEqual(G.isLoaded(), true); });
t('恰好 81 格，九干×九干无缺无重', function () {
  assert.strictEqual(Object.keys(DB.table).length, 81);
  GAN.forEach(function (a) {
    GAN.forEach(function (b) {
      assert.ok(DB.table[a + '+' + b], '缺 ' + a + '+' + b);
    });
  });
});
t('每格都有名与断语，无空条', function () {
  Object.keys(DB.table).forEach(function (k) {
    var e = DB.table[k];
    assert.ok(e.name && e.name.length >= 2, k + ' 无格名');
    assert.ok(e.text && e.text.length >= 4, k + ' 无断语');
  });
});
t('格名不重复到离谱：81 格里重名者应极少', function () {
  var m = {};
  Object.keys(DB.table).forEach(function (k) { m[DB.table[k].name] = (m[DB.table[k].name] || 0) + 1; });
  var dup = Object.keys(m).filter(function (n) { return m[n] > 1; });
  assert.ok(dup.length <= 2, '重名过多：' + dup.join('、'));
});
t('甲不上盘：表中不含甲', function () {
  assert.ok(!Object.keys(DB.table).some(function (k) { return k.indexOf('甲') >= 0; }));
  assert.strictEqual(G.lookup('甲', '乙'), null);
});

console.log('\n== 方向：键是「天盘+地盘」 ==');
/* 这四格有独立佐证：前三条见纲要 127 行，第四条为引擎实测。方向若录反，四条全错。 */
t('戊+丙＝青龙返首（纲要 127 行原文）', function () {
  assert.strictEqual(G.lookup('戊', '丙').name, '青龙返首');
});
t('丙+戊＝飞鸟跌穴（纲要 127 行原文）', function () {
  assert.strictEqual(G.lookup('丙', '戊').name, '飞鸟跌穴');
});
t('戊+辛＝青龙折足（引擎实测：2026-08-27 10:00 之盘 1 宫）', function () {
  assert.strictEqual(G.lookup('戊', '辛').name, '青龙折足');
  var c = zhuanpan('2026-08-27T10:00:00').jiuGongAnalysis['1'];
  assert.strictEqual(c.tianGan, '戊');
  assert.strictEqual(c.diGan, '辛');
  assert.strictEqual(c.keYing.name, '青龙折足', '引擎自己也这么叫，方向无误');
});
t('辛+乙＝白虎猖狂、乙+辛＝青龙逃走（两向不可颠倒）', function () {
  assert.strictEqual(G.lookup('辛', '乙').name, '白虎猖狂');
  assert.strictEqual(G.lookup('乙', '辛').name, '青龙逃走');
});
t('全盘对拍：与引擎逐宫同键，方向一致', function () {
  var t0 = new Date('2026-01-01T00:00:00').getTime(), n = 0, bad = 0;
  for (var i = 0; i < 300; i++) {
    var p = zhuanpan(new Date(t0 + i * 3600 * 1000 * 5).toISOString());
    if (!p || p.error) continue;
    Object.keys(p.jiuGongAnalysis).forEach(function (g) {
      var c = p.jiuGongAnalysis[g];
      if (!c.keYing) return;
      n++;
      var hit = G.lookup(c.tianGan, c.diGan);
      // 引擎以 tianGan/diGan 两字段自述其格，本层用同一对字段查表；
      // 名字可以不同（20 格有异名），但**必须都查得到**——查不到即方向或键错
      if (!hit) bad++;
    });
  }
  assert.ok(n > 1000, '样本足够，实得 ' + n);
  assert.strictEqual(bad, 0, n + ' 处中有 ' + bad + ' 处查不到');
});

console.log('\n== 与引擎命名并存而不混 ==');
t('18 格附 engineName（原 20，两格经裁定后已与引擎同名）', function () {
  var withE = Object.keys(DB.table).filter(function (k) { return DB.table[k].engineName; });
  assert.strictEqual(withE.length, 18, '实得 ' + withE.length);
  assert.ok(!DB.table['癸+庚'].engineName, '癸+庚 已从引擎，不该再记异名');
  assert.ok(!DB.table['丁+丁'].engineName, '丁+丁 已改名，不该再记异名');
});
t('engineName 只在确实不同时才有，绝不与本表同名', function () {
  Object.keys(DB.table).forEach(function (k) {
    var e = DB.table[k];
    if (e.engineName) assert.notStrictEqual(e.engineName, e.name, k + ' 异名与本名相同，不该记');
  });
});
t('engineName 与引擎实际叫法一致（抽两格核对）', function () {
  assert.strictEqual(DB.table['庚+癸'].engineName, '反吟大格');
  assert.strictEqual(DB.table['丙+壬'].engineName, '火入天网');
});
t('排版块把引擎异名标出来，让两说可辨', function () {
  var r = G.analyze({ chart: zhuanpan('2026-08-27T10:00:00'), focusGongs: ['9'] });
  var blk = G.toPromptBlock(r);
  assert.ok(/火入天罗/.test(blk), '9 宫丙加壬，本表作火入天罗');
  assert.ok(/引擎作「火入天网」/.test(blk), '须同时标出引擎的叫法');
});

console.log('\n== 出处与边界 ==');
t('出处标【用户所供 81 格表】，不冒充纲要', function () {
  assert.strictEqual(G.provenance().level, '用户所供 81 格表');
  assert.ok(/用户/.test(G.provenance().text));
});
t('排版块声明「格之名不等于宫之吉凶」', function () {
  var blk = G.toPromptBlock(G.analyze({ chart: zhuanpan('2026-08-27T10:00:00'), focusGongs: ['1'] }));
  assert.ok(/格之名不等于宫之吉凶/.test(blk));
});
t('本层不造吉凶等级：表中无 jiXiong 字段', function () {
  Object.keys(DB.table).forEach(function (k) {
    assert.ok(!('jiXiong' in DB.table[k]), k + ' 不该有自造的吉凶等级');
  });
});
t('宫位吉凶取自引擎，与格名分列', function () {
  var r = G.analyze({ chart: zhuanpan('2026-08-27T10:00:00'), focusGongs: ['1'] });
  assert.strictEqual(r.focus[0].gongJiXiong, '小吉', '该字段应原样来自引擎 jiXiongText');
  assert.notStrictEqual(r.focus[0].name, r.focus[0].gongJiXiong);
});
console.log('\n== 两处裁定（用户 2026-08-27）==');
t('① 癸+庚 跟随引擎：太户入网 → 太白入网', function () {
  assert.strictEqual(DB.table['癸+庚'].name, '太白入网');
  assert.strictEqual(DB.table['癸+庚'].supersededTableName, '太户入网', '原表内容须留底，改动要可回溯');
  assert.ok(/裁定/.test(DB.table['癸+庚'].supersededWhy));
});
t('② 丁+丁 跟随纲要：由吉义改为伏吟类之义', function () {
  var e = DB.table['丁+丁'];
  assert.strictEqual(e.name, '星奇伏吟');
  assert.ok(/静滞不动|久拖难成/.test(e.text), '义须取纲要伏吟类原文，实得：' + e.text);
  assert.ok(!/喜事从心|万事如意/.test(e.text), '不得再留吉义');
  assert.strictEqual(e.supersededTableName, '星奇入太阴');
  assert.strictEqual(e.supersededText, '喜事从心，万事如意');
});
t('② 丁+丁 的出处改标【纲要原文】，不再挂在「用户所供 81 格表」名下', function () {
  var e = DB.table['丁+丁'];
  assert.ok(e.provenanceOverride, '须有逐条出处');
  assert.strictEqual(e.provenanceOverride.level, '纲要原文');
  assert.ok(/127|193/.test(e.provenanceOverride.text), '须指到纲要的行');
  assert.strictEqual(G.lookup('丁', '丁').provenance.level, '纲要原文', 'lookup 须把它带出来');
});
t('裁定后仍与纲要伏吟类一致：九个同干相加无一为吉', function () {
  ['乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'].forEach(function (g) {
    var e = DB.table[g + '+' + g];
    assert.ok(!/万事如意|喜事从心|大吉大利/.test(e.text),
      g + '+' + g + ' 与纲要「同干相加＝伏吟类，主静滞」相悖：' + e.text);
  });
});
t('裁定记录在案，可回溯', function () {
  assert.ok(DB._resolved && DB._resolved['癸+庚'] && DB._resolved['丁+丁']);
  assert.ok(/可回溯/.test(DB._resolved._why));
  assert.ok(!DB._engineDiff._open, '已决之事不该再挂在存疑里');
  assert.ok(!DB._engineDiff._tension, '同上');
});
t('排版块把裁定过的格标出原表叫法与新出处', function () {
  var r = G.analyze({ chart: { jiuGongAnalysis: { '1': { gongName: '坎', tianGan: '丁', diGan: '丁' } } }, focusGongs: ['1'] });
  var blk = G.toPromptBlock(r);
  assert.ok(/星奇伏吟/.test(blk));
  assert.ok(/〔纲要原文〕/.test(blk), '该格出处与整层不同，须逐条另标');
  assert.ok(/原表作「星奇入太阴」/.test(blk), '改动须对读者可见');
});

console.log('\n== 关注宫与排版 ==');
t('给了关注宫则详列该宫、余宫简列', function () {
  var r = G.analyze({ chart: zhuanpan('2026-08-27T10:00:00'), focusGongs: ['8'], focusRoles: { '8': ['玄武'] } });
  assert.strictEqual(r.focus.length, 1);
  assert.ok(r.rest.length >= 6);
  var blk = G.toPromptBlock(r);
  assert.ok(/〔玄武〕/.test(blk), '关注宫须标明因何要紧');
  assert.ok(/其余各宫：/.test(blk));
});
t('未给关注宫则全部详列，不至于一条详情都没有', function () {
  var r = G.analyze({ chart: zhuanpan('2026-08-27T10:00:00') });
  assert.strictEqual(r.rest.length, 0);
  assert.ok(r.focus.length >= 8);
});
t('空盘与未加载不抛异常', function () {
  assert.strictEqual(G.analyze({ chart: {} }).items.length, 0);
  assert.strictEqual(G.toPromptBlock({ items: [] }), '');
  assert.strictEqual(G.toPromptBlock(null), '');
});
t('确定性：同盘两次结果逐字相同', function () {
  var p = zhuanpan('2026-08-27T10:00:00');
  var a = JSON.stringify(G.analyze({ chart: p, focusGongs: ['1', '8'] }));
  var b = JSON.stringify(G.analyze({ chart: p, focusGongs: ['1', '8'] }));
  assert.strictEqual(a, b);
});
t('两派皆可查（干加干与盘别无关）', function () {
  var f = QM.feipanQimen.calculate(new Date('2026-08-27T10:00:00'), { method: '时家', purpose: '综合' });
  var r = G.analyze({ chart: f });
  assert.ok(r.items.length >= 8, '飞盘同样逐宫查得到，实得 ' + r.items.length);
});


console.log('\n== 接入证据包 ==');
var EV = require('./evidence.js');
EV.load(require('../knowledge/symbols.json'));
t('81 格块进入证据包，并排在 FACT 之前', function () {
  var p = zhuanpan('2026-08-27T10:00:00');
  var gj = G.analyze({ chart: p, focusGongs: ['1'], focusRoles: { '1': ['时干宫'] } });
  var blk = EV.toPromptBlock(EV.build({ chart: p, school: 'zhuanpan', domain: 'general', geju: gj }));
  var i1 = blk.indexOf('【八十一格（干加干）】'), i2 = blk.indexOf('· FACT（');
  assert.ok(i1 >= 0, '81 格块应出现在证据包里');
  assert.ok(i2 >= 0 && i1 < i2, '位次 ' + i1 + ' 应早于 FACT 的 ' + i2);
});
t('证据包里标明「格之名不等于宫之吉凶」', function () {
  var p = zhuanpan('2026-08-27T10:00:00');
  var blk = EV.toPromptBlock(EV.build({ chart: p, school: 'zhuanpan', domain: 'general',
    geju: G.analyze({ chart: p, focusGongs: ['1'] }) }));
  assert.ok(/格之名不等于宫之吉凶/.test(blk));
});
t('引擎异名在证据包里也标出「两说并存」', function () {
  var p = zhuanpan('2026-08-27T10:00:00');
  var blk = EV.toPromptBlock(EV.build({ chart: p, school: 'zhuanpan', domain: 'general',
    geju: G.analyze({ chart: p, focusGongs: ['9'] }) }));
  assert.ok(/两说并存/.test(blk));
});
t('证据包里也带出处行，不只在独立块里有', function () {
  var p = zhuanpan('2026-08-27T10:00:00');
  var blk = EV.toPromptBlock(EV.build({ chart: p, school: 'zhuanpan', domain: 'general',
    geju: G.analyze({ chart: p, focusGongs: ['1'] }) }));
  assert.ok(/〔用户所供 81 格表〕/.test(blk), '出处逐块可见是本架构的底线');
});
t('不传 geju 时证据包行为不变（向后兼容）', function () {
  var blk = EV.toPromptBlock(EV.build({ chart: zhuanpan('2026-08-27T10:00:00'), school: 'zhuanpan', domain: 'general' }));
  assert.strictEqual(blk.indexOf('【八十一格'), -1);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
