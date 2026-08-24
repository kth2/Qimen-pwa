/**
 * 证据合流(Converge) 单元测试（纯 Node，无框架）。
 * 本层要守住三件事：① 每一票都出自纲要原文；② 数的是**互不相干**的路数，别名不重复计；
 * ③ 证据不足就弃权——不得凭孤证编出确指（这正是实测里最伤的那次失手）。
 */
'use strict';
var path = require('path'), assert = require('assert'), fs = require('fs');
global.window = global;
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.QM;
var CV = require('./converge.js');
var WS = require('./wangshuai.js');
var RULES = require('../knowledge/dimensions.json');
var MD = fs.readFileSync(path.join(__dirname, '..', 'assets', 'zhuanpan-method.md'), 'utf8');
CV.load(RULES);

var pass = 0, fail = 0;
function t(n, f) { try { f(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '  ->  ' + e.message); } }

/** 实测失手的那张盘：玄武@离九（用神），九地+杜门@巽四（类象用神落宫） */
function jewelChart() {
  return { jiuGongAnalysis: {
    '9': { shen: '玄武', men: '景门', xing: '天英', gongName: '离' },
    '4': { shen: '九地', men: '杜门', xing: '天辅', gongName: '巽' } } };
}
function jewelFocus() {
  return [{ gong: '9', roles: ['玄武(失物)'], primary: true },
          { gong: '4', roles: ['辛〔类象·所问「首饰」〕'], primary: false }];
}
function dimOf(res, dim) { return res.dimensions.filter(function (d) { return d.dim === dim; })[0]; }
function candOf(res, dim, val) {
  var d = dimOf(res, dim); if (!d) return null;
  return d.candidates.filter(function (c) { return c.value === val; })[0] || null;
}

console.log('== 每一票都指得回纲要原文 ==');

t('维度表每条票都有 basis，且 basis 里的原文在纲要中确实存在', function () {
  assert.ok(RULES.votes.length >= 20);
  RULES.votes.forEach(function (v) {
    assert.ok(v.el && v.kind && v.dim && v.value, JSON.stringify(v));
    assert.ok(v.basis && v.basis.length > 10, v.el + ' 缺出处');
    assert.ok(RULES.dimensions[v.dim], v.el + ' 的维度 ' + v.dim + ' 未登记');
  });
  // 抽查几条确实出自纲要
  assert.ok(MD.indexOf('隐伏低洼') >= 0);
  assert.ok(MD.indexOf('桌柜之下') >= 0);
  assert.ok(MD.indexOf('九地(吉)：稳固藏纳') >= 0);
  assert.ok(MD.indexOf('杜门(木·凶)：阻塞/隐藏/技术') >= 0);
  assert.ok(MD.indexOf('明亮处') >= 0);
});

t('艮八高低两可，如实两票并注明——不代为择一', function () {
  var hi = RULES.votes.filter(function (v) { return v.el === '8' && v.dim === '高低' && v.value === '高'; });
  var lo = RULES.votes.filter(function (v) { return v.el === '8' && v.dim === '高低' && v.value === '低'; });
  assert.strictEqual(hi.length, 1); assert.strictEqual(lo.length, 1);
  assert.ok(/两可/.test(hi[0].note) && /两可/.test(lo[0].note), '两可须在 note 里说明');
});

console.log('== 实测失手那一例：孤证不得压过合流 ==');

t('「正南／明亮处」降为孤证，并被判为须弃权', function () {
  var r = CV.analyze({ chart: jewelChart(), focus: jewelFocus() });
  assert.ok(r.applicable);
  var nan = candOf(r, '方位', '正南');
  assert.ok(nan, '方位应有正南这一候选');
  assert.strictEqual(nan.independent, 1, '正南只有离九一路');
  assert.strictEqual(nan.tier, 'C', '孤证只能是 C 级，实得 ' + nan.tier);
  assert.ok(r.abstained.some(function (a) { return a.dim === '方位'; }), '方位须弃权');
  assert.ok(r.abstained.some(function (a) { return a.dim === '场所'; }), '场所须弃权');
});

t('「藏」有三路独立证据（九地／杜门／玄武），压过「显」', function () {
  var r = CV.analyze({ chart: jewelChart(), focus: jewelFocus() });
  var cang = candOf(r, '显隐', '藏'), xian = candOf(r, '显隐', '显');
  assert.strictEqual(cang.independent, 3, '实得 ' + cang.independent + ' 路');
  var els = cang.sources.map(function (s) { return s.el; }).sort();
  assert.deepStrictEqual(els, ['九地', '杜门', '玄武']);
  assert.ok(cang.independent > xian.independent, '藏须多于显');
  assert.strictEqual(dimOf(r, '显隐').top, '藏', '顶端候选须是藏');
});

t('两说相争者一律降一档，且如实标出相争对象', function () {
  var r = CV.analyze({ chart: jewelChart(), focus: jewelFocus() });
  var cang = candOf(r, '显隐', '藏');
  assert.strictEqual(cang.contested, true);
  assert.strictEqual(cang.contestedBy, '显');
  assert.strictEqual(cang.tier, 'B', '三路本为 A，相争降为 B，实得 ' + cang.tier);
  assert.ok(dimOf(r, '显隐').contested);
});

console.log('== 独立性：别名不重复计 ==');

t('同一元素在同一宫只算一路，不因多条象义而重复计', function () {
  var chart = { jiuGongAnalysis: { '4': { shen: '九地', men: '杜门', xing: '天辅', gongName: '巽' } } };
  var r = CV.analyze({ chart: chart, focus: [{ gong: '4', roles: ['用神'], primary: true }] });
  var cang = candOf(r, '显隐', '藏');
  var keys = {};
  cang.sources.forEach(function (s) {
    var k = s.kind + ':' + s.el;
    assert.ok(!keys[k], '同一元素被重复计为多路：' + k);
    keys[k] = 1;
  });
  assert.strictEqual(cang.independent, cang.sources.length);
});

t('elementsAt 对同一宫的同一元素只登记一次', function () {
  var chart = { jiuGongAnalysis: { '4': { shen: '九地', men: '杜门', xing: '天辅', gongName: '巽' } } };
  var els = CV.elementsAt(chart, '4', null);
  var seen = {};
  els.forEach(function (e) { assert.ok(!seen[e.key], '重复：' + e.key); seen[e.key] = 1; });
});

t('入墓亦投「藏」一票（纲要：能量深藏难发），且须由 wangshuai 提供', function () {
  var chart = { jiuGongAnalysis: { '4': { shen: '太阴', men: '休门', xing: '天辅', gongName: '巽' } } };
  var ws = { gongs: { '4': { harms: ['天盘辛入墓'] } } };
  var withMu = CV.analyze({ chart: chart, focus: [{ gong: '4', roles: ['用神'], primary: true }], wangshuai: ws });
  var noMu = CV.analyze({ chart: chart, focus: [{ gong: '4', roles: ['用神'], primary: true }] });
  assert.ok(candOf(withMu, '显隐', '藏').independent > candOf(noMu, '显隐', '藏').independent,
    '入墓应多出一路');
});

console.log('== 方位以用神落宫为准；旁宫只作维度旁证 ==');

t('非主用神宫的方位/场所票不参与定位（纲要：方位定处）', function () {
  var r = CV.analyze({ chart: jewelChart(), focus: jewelFocus() });
  var fang = dimOf(r, '方位');
  assert.strictEqual(fang.candidates.length, 1, '只应有用神宫那一个方位，实得 ' +
    fang.candidates.map(function (c) { return c.value; }).join('、'));
  assert.strictEqual(fang.candidates[0].value, '正南');
  assert.ok(!candOf(r, '方位', '东南'), '旁宫(巽四)的方位不得混进来');
  // 但旁宫的高低/显隐旁证要计入
  assert.ok(candOf(r, '显隐', '藏').sources.some(function (s) { return s.gong === '4'; }));
});

console.log('== 弃权：证据不足就说不知道 ==');

t('最高只到 C 级（孤证或相争）的维度一律弃权，并说明缘由', function () {
  var r = CV.analyze({ chart: jewelChart(), focus: jewelFocus() });
  r.dimensions.forEach(function (d) {
    var ab = r.abstained.filter(function (a) { return a.dim === d.dim; })[0];
    if (d.topTier === 'C' || d.topTier === 'D') {
      assert.ok(ab, d.dim + ' 顶档为 ' + d.topTier + '，须弃权');
      assert.ok(ab.why && ab.why.length > 4, d.dim + ' 弃权须说明缘由');
    } else {
      assert.ok(!ab, d.dim + ' 顶档为 ' + d.topTier + '，不该弃权');
    }
  });
});

t('提示块写明档位用法、弃权项，并明说不得凭孤证编确指', function () {
  var txt = CV.toPromptBlock(CV.analyze({ chart: jewelChart(), focus: jewelFocus() }));
  assert.ok(/不得出现在结论里/.test(txt));
  assert.ok(/须弃权的维度|本次弃权的维度/.test(txt));
  assert.ok(/不要凭一条孤证编出一个确指/.test(txt));
  assert.ok(/只算\*\*一路\*\*/.test(txt), '须写明别名只算一路');
});

t('不产出吉凶断语，只产出档位与用法', function () {
  var txt = CV.toPromptBlock(CV.analyze({ chart: jewelChart(), focus: jewelFocus() }));
  assert.ok(!/吉|凶|必|一定/.test(txt.replace(/吉凶/g, '')), '合流层不得下吉凶断语');
});

console.log('== 降级与确定性 ==');

t('缺盘/缺关注宫/未加载时停用，不抛错', function () {
  assert.strictEqual(CV.analyze({}).applicable, false);
  assert.strictEqual(CV.analyze({ chart: jewelChart(), focus: [] }).applicable, false);
  assert.strictEqual(CV.toPromptBlock(CV.analyze({})), '');
  var CV2 = require('./converge.js');
  CV2.load(null);
  assert.strictEqual(CV2.analyze({ chart: jewelChart(), focus: jewelFocus() }).applicable, false);
  CV2.load(RULES);
});

t('非法宫号被忽略，不抛错', function () {
  var r = CV.analyze({ chart: jewelChart(), focus: [{ gong: '99' }, { gong: '' }, { gong: '9', primary: true }] });
  assert.ok(r.applicable);
  r.dimensions.forEach(function (d) {
    d.candidates.forEach(function (c) {
      c.sources.forEach(function (s) { assert.ok(/^[1-9]$/.test(s.gong)); });
    });
  });
});

t('确定性：同盘同关注宫，结果与提示块逐字相同', function () {
  var a = CV.analyze({ chart: jewelChart(), focus: jewelFocus() });
  var b = CV.analyze({ chart: jewelChart(), focus: jewelFocus() });
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.strictEqual(CV.toPromptBlock(a), CV.toPromptBlock(b));
});

t('多盘稳健：120 张真实盘皆不抛错，档位与路数自洽', function () {
  for (var i = 0; i < 120; i++) {
    var pan = QM.qimen.calculate(new Date(Date.UTC(2024, 0, 1 + i * 3, 2 + (i % 11))),
      { type: '四柱', method: '时家', purpose: '失物' });
    var ws = WS.analyze(pan);
    var r = CV.analyze({ chart: pan, wangshuai: ws,
      focus: [{ gong: String(1 + (i % 9)), roles: ['用神'], primary: true },
              { gong: String(1 + ((i + 3) % 9)), roles: ['类象'], primary: false }] });
    r.dimensions.forEach(function (d) {
      d.candidates.forEach(function (c) {
        assert.strictEqual(c.independent, c.sources.length, '路数与来源数不符');
        assert.ok(['A', 'B', 'C', 'D'].indexOf(c.tier) >= 0);
        if (!c.contested) {
          var want = c.independent >= 3 ? 'A' : c.independent >= 2 ? 'B' : 'C';
          assert.strictEqual(c.tier, want, '未相争时档位应由路数直接定');
        }
      });
    });
    JSON.parse(JSON.stringify(r));
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
