/**
 * 类象取用(LeiXiang) 单元测试（纯 Node，无框架）。
 * 要害有三：① 转盘专有，绝不推及飞盘；② 每条类象都指得回纲要原文；
 * ③ 原文所许与本层归类两级分得开——这是不把断法悄悄推广的关键。
 */
var assert = require('assert');
var path = require('path');
global.window = global;
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.QM;

var LX = require('./leixiang.js');
var YS = require('./yongshen.js');
var RULES = require('../knowledge/leixiang.json');
var METHOD = require('fs').readFileSync(path.join(__dirname, '..', 'assets', 'zhuanpan-method.md'), 'utf8');
var FEIPAN_METHOD = require('fs').readFileSync(path.join(__dirname, '..', 'assets', 'feipan-method.md'), 'utf8');

LX.load(RULES);
YS.load(require('../knowledge/domains.json'));

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function chartAt(iso, purpose) {
  return QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: purpose || '综合' });
}
var CHART = chartAt('2024-04-10T10:00:00', '失物');
function run(q, opts) {
  opts = opts || {};
  var ys = YS.resolve({ domain: opts.domain || 'lost_item', chart: opts.chart || CHART });
  return LX.resolve({
    question: q, chart: opts.chart || CHART,
    options: {
      school: opts.school || 'zhuanpan', locate: opts.noLocate ? null : YS.locate,
      actors: ys.actors, domainNames: (ys.examine || []).map(function (m) { return m.name; }),
      extra: opts.extra
    }
  });
}
function symbolsOf(r) { return r.candidates.map(function (c) { return c.symbol; }); }

console.log('== 规则库自检：每条类象都指得回纲要原文 ==');

t('四张类象表逐字与纲要一致（九星/八门/八神/十干）', function () {
  // 断言的是**纲要里的原字符串**，故写法须与纲要一致（八门/八神/九星写作「名(五行·吉凶)：类象」）
  var checks = [
    ['十干', '甲', ['栋梁', '首领'], '甲(栋梁/首领)'],
    ['十干', '辛', ['金刃', '错误', '首饰'], '辛(金刃/错误/首饰)'],
    ['十干', '戊', ['财货', '墙宅'], '戊(财货/墙宅)'],
    ['八门', '死门', ['死丧', '停滞', '坟', '医'], '死门(土·凶)：死丧/停滞/坟/医'],
    ['八门', '伤门', ['伤损', '捕猎', '讨债', '车'], '伤门(木·凶)：伤损/捕猎/讨债/车'],
    ['八神', '玄武', ['盗贼', '欺诈', '暗昧'], '玄武(凶)：盗贼欺诈暗昧'],
    ['九星', '天芮', ['病符', '迟钝', '医药'], '天芮(土)：病符/迟钝/医药']
  ];
  checks.forEach(function (c) {
    assert.deepStrictEqual(RULES.tables[c[0]].items[c[1]], c[2], c[1] + ' 类象与纲要不符');
    assert.ok(METHOD.indexOf(c[3]) >= 0, '纲要中找不到原文「' + c[3] + '」');
    // 表的 basis 必须是**逐字**引用，不能是转述——转述久了就会与纲要漂移
    assert.ok(RULES.tables[c[0]].basis.indexOf(c[3]) >= 0,
      c[0] + ' 表的 basis 未逐字引用纲要原文「' + c[3] + '」');
  });
});

t('四表齐全且元素数目正确', function () {
  assert.strictEqual(Object.keys(RULES.tables['十干'].items).length, 10);
  assert.strictEqual(Object.keys(RULES.tables['八门'].items).length, 8);
  assert.strictEqual(Object.keys(RULES.tables['八神'].items).length, 8);
  assert.strictEqual(Object.keys(RULES.tables['九星'].items).length, 9);
  assert.strictEqual(Object.keys(RULES.bagua.items).length, 9);
});

t('索引每一条都有 basis、matched 与置信度，且 symbol 在其表内', function () {
  RULES.index.forEach(function (e) {
    assert.ok(e.terms && e.terms.length, '缺 terms');
    assert.ok(RULES.tables[e.table], e.symbol + ' 的表不存在');
    assert.ok(RULES.tables[e.table].items[e.symbol], e.symbol + ' 不在 ' + e.table + ' 表内');
    assert.ok(e.basis && e.basis.length > 10, e.symbol + ' 缺出处');
    assert.ok(['high', 'medium', 'low'].indexOf(e.confidence) >= 0, e.symbol + ' 置信度非法');
    assert.ok(e.matched, e.symbol + ' 未写明匹配到纲要哪个类象词');
  });
});

t('非 high 的条目必须写明为何这么归类——归类而不说理由等于自造', function () {
  RULES.index.forEach(function (e) {
    if (e.confidence === 'high') return;
    assert.ok(e.why && e.why.length >= 6, e.symbol + '(' + e.matched + ') 是本层归类，须写明归类理由');
  });
});

t('刻意未采纳者须留档（如「辛为尸骨」不在本仓库纲要内）', function () {
  assert.ok(RULES._notAdopted && RULES._notAdopted.length >= 2);
  var txt = RULES._notAdopted.join(' ');
  assert.ok(/辛/.test(txt) && /尸/.test(txt), '须写明「辛为尸骨」一说未采纳及其理由');
  assert.ok(METHOD.indexOf('辛(金刃/错误/首饰)') >= 0);
  assert.ok(!/辛.{0,6}尸/.test(METHOD), '若纲要真写了辛为尸，本条须重估');
});

console.log('== 零串味：类象取用是转盘专法 ==');

t('规则库声明只适用于转盘，并写明为何不及飞盘', function () {
  assert.deepStrictEqual(RULES.appliesTo, ['zhuanpan']);
  assert.ok(RULES._schoolOmit && /飞盘/.test(RULES._schoolOmit));
});

t('纲要依据确实在转盘一侧：转盘有「用神类象」，飞盘用神章没有', function () {
  assert.ok(/用神类象/.test(METHOD), '转盘纲要失物一条应写有「用神类象」');
  assert.ok(/衍象类象：人\/物\/事各取对应符号/.test(METHOD), '转盘纲要二节表尾应有取象总则');
  var yongShenSection = FEIPAN_METHOD.slice(
    FEIPAN_METHOD.indexOf('## 二、用神取用'),
    FEIPAN_METHOD.indexOf('## 三、'));
  assert.ok(yongShenSection.length > 100, '未取到飞盘用神章');
  assert.ok(!/类象/.test(yongShenSection), '飞盘用神章若出现类象取用，本层的隔离前提须重估');
});

t('飞盘一律停用，且说明原因；不产出任何候选', function () {
  var r = run('我的钥匙丢了', { school: 'feipan' });
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.candidates.length, 0);
  assert.ok(/转盘专法/.test(r.reason));
  assert.strictEqual(LX.toPromptBlock(r), '', '飞盘下不得产出任何提示词文本');
});

t('盘别自动判定：飞盘盘面自动停用', function () {
  var fp = QM.feipanQimen.calculate(new Date('2024-04-10T10:00:00'), { method: '时家', purpose: '失物' });
  assert.strictEqual(LX.detectSchool(fp), 'feipan');
  var r = LX.resolve({ question: '钥匙丢了', chart: fp, options: { locate: YS.locate } });
  assert.strictEqual(r.applicable, false);
});

console.log('== 取象：用户实测提出的那几类 ==');

t('测钱财取戊(财货)——纲要「戊(财货/墙宅)」', function () {
  assert.ok(symbolsOf(run('测今年钱财如何')).indexOf('戊') >= 0);
  assert.ok(symbolsOf(run('这笔货款收得回来吗')).indexOf('戊') >= 0);
  assert.ok(symbolsOf(run('工资什么时候发')).indexOf('戊') >= 0);
});

t('测钥匙取辛(金刃/首饰)，且标为本层归类而非纲要原文', function () {
  var r = run('我的钥匙丢了，能找回吗？');
  var xin = r.candidates.filter(function (c) { return c.symbol === '辛'; })[0];
  assert.ok(xin, '钥匙应取辛');
  assert.strictEqual(xin.provenance, '本层归类', '钥匙不是纲要原文的词，须标为归类');
  assert.strictEqual(xin.matched, '金刃/首饰');
  assert.ok(/金刃/.test(xin.basis) && /辛/.test(xin.basis));
  assert.deepStrictEqual(xin.words, ['金刃', '错误', '首饰'], '须带出该象的全部类象');
});

t('首饰/戒指/项链同取辛；「错误」一词则是纲要原文', function () {
  ['戒指', '项链', '手镯', '珠宝'].forEach(function (w) {
    assert.ok(symbolsOf(run('我的' + w + '不见了')).indexOf('辛') >= 0, w + ' 应取辛');
  });
  var r = run('这个错误要紧吗');
  var xin = r.candidates.filter(function (c) { return c.symbol === '辛'; })[0];
  assert.strictEqual(xin.provenance, '纲要原文', '「错误」就是纲要写的那个词');
});

t('测尸体/丧葬取死门(死丧/坟)——本仓库纲要以死门为死丧之象', function () {
  ['尸体', '遗体', '丧事', '坟墓', '出殡'].forEach(function (w) {
    assert.ok(symbolsOf(run('那具' + w + '在哪里')).indexOf('死门') >= 0, w + ' 应取死门');
  });
  assert.ok(!symbolsOf(run('那具尸体在哪里')).some(function (s) { return s === '辛'; }),
    '本仓库纲要未载「辛为尸骨」，不得据此取辛');
});

t('测车取伤门(车)、测文书取丁(文书)、测病取天芮(病符)', function () {
  assert.ok(symbolsOf(run('我的车能卖掉吗')).indexOf('伤门') >= 0);
  assert.ok(symbolsOf(run('合同能签成吗')).indexOf('丁') >= 0);
  assert.ok(symbolsOf(run('他的病能好吗')).indexOf('天芮') >= 0);
  assert.ok(symbolsOf(run('妻子会回来吗')).indexOf('乙') >= 0);
  assert.ok(symbolsOf(run('我丈夫在哪')).indexOf('庚') >= 0);
});

t('长词优先：「现金」取戊(财货)，不得被「金」吃成辛(首饰)', function () {
  var s = symbolsOf(run('现金什么时候到账'));
  assert.ok(s.indexOf('戊') >= 0, '现金应取戊');
  assert.ok(s.indexOf('辛') < 0, '「现金」不该被拆出「金」而取辛');
  var s2 = symbolsOf(run('那条金项链丢了'));
  assert.ok(s2.indexOf('辛') >= 0, '金项链仍应取辛');
});

console.log('== 候选而非替代；定宫；未匹配时的交代 ==');

t('候选会在盘上定宫，并标出是否已在占类用神之列', function () {
  var r = run('我的钥匙丢了，能找回吗？');
  r.candidates.forEach(function (c) {
    assert.ok(typeof c.located === 'boolean');
    if (c.located) {
      assert.ok(/^[1-9]$/.test(c.gong), c.symbol + ' 宫位非法：' + c.gong);
      assert.ok(c.gongName || c.direction, c.symbol + ' 应带宫名或方位');
    } else {
      assert.ok(c.locateNote, '盘上未见者须说明，不得代为安置落宫');
    }
    assert.ok(typeof c.inDomain === 'boolean');
  });
  var xw = r.candidates.filter(function (c) { return c.symbol === '玄武'; })[0];
  assert.ok(xw && xw.inDomain, '失物占类本就含玄武，应标为已在占类用神之列');
});

t('未注入 locate 时只给符号不给宫，不臆造宫位', function () {
  var r = run('我的钥匙丢了', { noLocate: true });
  assert.ok(r.applicable);
  r.candidates.forEach(function (c) {
    assert.strictEqual(c.located, false);
    assert.strictEqual(c.gong, '');
  });
});

t('匹配不到时如实说明并交回模型，绝不说「盘上没有此物」', function () {
  var r = run('这件事总体如何');
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.unmatched, true);
  var txt = LX.toPromptBlock(r);
  assert.ok(/未在索引中匹配到类象词/.test(txt));
  assert.ok(/自行为所问之人\/物\/事取象/.test(txt), '须请模型自行取象');
  assert.ok(!/没有|无此物|不存在/.test(txt.replace(/不得因索引未匹配就略过类象用神/, '')),
    '不得出现否定盘面的措辞');
});

t('缺问句时停用，不抛错', function () {
  var r = LX.resolve({ question: '', chart: CHART, options: { school: 'zhuanpan' } });
  assert.strictEqual(r.applicable, false);
  assert.ok(/未提供占问文字/.test(r.reason));
});

t('规则库未加载时停用，不抛错', function () {
  var LX2 = require('./leixiang.js');
  var saved = RULES;
  LX2.load(null);
  assert.strictEqual(LX2.isLoaded(), false);
  var r = LX2.resolve({ question: '钥匙丢了', chart: CHART, options: { school: 'zhuanpan' } });
  assert.strictEqual(r.applicable, false);
  LX2.load(saved);
  assert.strictEqual(LX2.isLoaded(), true);
});

console.log('== 提示词与确定性 ==');

t('提示块讲明「所问之物本身也要取用神」，并要求逐宫展开', function () {
  var txt = LX.toPromptBlock(run('我的钥匙丢了，能找回吗？'));
  assert.ok(/所问的具体人事物本身也要取一个用神/.test(txt));
  assert.ok(/不能只看值符值使日干时干/.test(txt));
  assert.ok(/衍象类象：人\/物\/事各取对应符号/.test(txt), '须引纲要原文为据');
  assert.ok(/纲要原文/.test(txt) && /本层归类/.test(txt), '两级出处须分得开');
  assert.ok(/不相取代/.test(txt), '须写明与占类用神并列而非替代');
});

t('候选上限：命中过多时截断并说明', function () {
  var q = '钱财 钥匙 车 合同 病 妻子 丈夫 官司 尸体 老师 医生 小偷 房子 田地 下雨';
  var r = run(q);
  assert.ok(r.candidates.length <= 8, '候选不得超过上限');
  assert.ok(r.notes.some(function (n) { return /候选过多/.test(n); }), '截断须说明');
});

t('确定性：同一问句同一张盘，结果逐字相同', function () {
  var a = run('我的钥匙丢了，能找回吗？在哪里找？');
  var b = run('我的钥匙丢了，能找回吗？在哪里找？');
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.strictEqual(LX.toPromptBlock(a), LX.toPromptBlock(b));
});

t('多盘多问句稳健：不抛错、宫位皆合法、候选皆有出处', function () {
  var qs = ['钥匙丢了', '钱财如何', '车祸严重吗', '尸体在哪', '妻子会回来吗',
    '合同能签吗', '病能好吗', '官司会赢吗', '房子能卖吗', '这事如何'];
  for (var i = 0; i < 40; i++) {
    var c = chartAt(new Date(Date.UTC(2024, 0, 1 + i * 7, 3 + (i % 9))).toISOString(), '综合');
    qs.forEach(function (q) {
      var r = run(q, { chart: c, domain: 'general' });
      r.candidates.forEach(function (x) {
        assert.ok(x.basis && x.basis.length > 10, x.symbol + ' 缺出处');
        assert.ok(!x.located || /^[1-9]$/.test(x.gong), x.symbol + ' 宫位非法');
        assert.ok(x.words.length, x.symbol + ' 缺类象词');
      });
    });
  }
});

t('结果可 JSON 序列化（要进案例本与证据包）', function () {
  var r = run('我的钥匙丢了');
  assert.strictEqual(typeof JSON.parse(JSON.stringify(r)).candidates[0].symbol, 'string');
});

console.log('== 不止失物：各占类通用 ==');

t('索引覆盖各占类，且新增条目仍条条有出处', function () {
  var syms = {};
  RULES.index.forEach(function (e) { syms[e.symbol] = 1; });
  ['戊', '辛', '丁', '乙', '庚', '甲', '癸',
   '开门', '生门', '伤门', '死门', '景门',
   '六合', '玄武', '九地', '值符', '太阴',
   '天芮', '天心', '天辅', '天冲'].forEach(function (s) {
    assert.ok(syms[s], '索引应覆盖 ' + s);
  });
  RULES.index.forEach(function (e) {
    assert.ok(e.basis && e.basis.length > 10, e.symbol + '(' + e.matched + ') 缺出处');
  });
});

t('各占类的代表性问句都能取到象（不只失物）', function () {
  var cases = [
    ['求财', '这笔货款收得回来吗', '戊'],
    ['求财', '我的房子能卖掉吗', '戊'],
    ['事业', '我这份工作能升职吗', '开门'],
    ['事业', '老板会同意吗', '甲'],
    ['功名', '孩子考试能录取吗', '天辅'],
    ['婚姻', '这门婚事能成吗', '六合'],
    ['婚姻', '我老婆会回来吗', '乙'],
    ['疾病', '他的病能好吗', '天芮'],
    ['疾病', '这个医生靠谱吗', '天心'],
    ['官司', '这次开庭会赢吗', '开门'],
    ['出行', '出差顺利吗', '开门'],
    ['怀孕', '这胎能顺产吗', '生门'],
    ['竞赛', '这次投标能中吗', '天冲'],
    ['风水', '祖坟有问题吗', '九地'],
    ['寻人', '走失的人能找到吗', '六合'],
    ['天气', '明天会下雨吗', '癸']
  ];
  cases.forEach(function (c) {
    var got = symbolsOf(run(c[1], { domain: 'general' }));
    assert.ok(got.indexOf(c[2]) >= 0,
      c[0] + '「' + c[1] + '」应取到 ' + c[2] + '，实得：' + (got.join('、') || '(无)'));
  });
});

t('甲可定宫：甲不上天盘，遁于旬首，以值符落宫论——否则测老板永远「盘上未见」', function () {
  var r = run('老板会同意吗');
  var jia = r.candidates.filter(function (c) { return c.symbol === '甲'; })[0];
  assert.ok(jia, '老板应取甲(栋梁/首领)');
  assert.ok(jia.located, '甲须能定宫，不得因三盘无甲就记为盘上未见');
  assert.ok(/^[1-9]$/.test(jia.gong));
  assert.ok(/遁于旬首/.test(jia.via || ''), '须写明是以值符落宫论，不是盘上真有个甲');
  var zf = String(CHART.zhiFuLuoGong || CHART.zhiFuGong);
  assert.strictEqual(jia.gong, zf, '甲之宫须等于值符落宫');
});

t('低置信度的候选（律师/男友/女友）标为 low 并说明取用前须斟酌', function () {
  ['律师', '男朋友', '女朋友'].forEach(function (w) {
    var r = run('我的' + w + '怎么样');
    var low = r.candidates.filter(function (c) { return c.confidence === 'low'; });
    assert.ok(low.length > 0, w + ' 应列为低度候选而非直接断定');
    low.forEach(function (c) {
      assert.strictEqual(c.provenance, '本层归类');
      assert.ok(c.why.length >= 6);
    });
  });
});

console.log('== 占类提示：判错时也要提（实测里最贵的一类错） ==');

function hintIdx() {
  return YS.domainIds().map(function (id) {
    var d = YS.getDomain(id) || {};
    return { name: id, label: d.label, yongshen: d.yongshen };
  });
}
function withHint(q, domain) {
  return LX.resolve({
    question: q, chart: CHART,
    options: { school: 'zhuanpan', locate: YS.locate, domain: domain,
      domainLabel: (YS.getDomain(domain) || {}).label || domain, domainsForHint: hintIdx() }
  });
}

t('占类判错时提示：钱包丢了被判成求财，应提示失物', function () {
  var r = withHint('网测，女士今天下午钱包丢了，问还能不能找到？', 'wealth');
  assert.ok(r.suggestedDomains.some(function (s) { return s.domain === 'lost_item'; }),
    '应提示 lost_item，实得：' + JSON.stringify(r.suggestedDomains));
  var note = r.notes.join(' ');
  assert.ok(/别的占类/.test(note) && /核对本次占类是否判对/.test(note));
  assert.ok(/占类判错则用神与规则整套皆错/.test(note), '须说清判错的代价');
});

t('占类本就相符时不提示，免得每次都吵', function () {
  var r = withHint('我的钥匙丢了，能找回吗？', 'lost_item');
  assert.ok(!r.suggestedDomains.some(function (s) { return s.domain === 'lost_item'; }),
    '与本次占类相同者不该再提示');
});

t('占类为「其他」时，措辞是「一并合参」而非「你判错了」', function () {
  var r = withHint('他的病能好吗', 'general');
  assert.ok(r.suggestedDomains.some(function (s) { return s.domain === 'health'; }));
  var note = r.notes.join(' ');
  assert.ok(/一并合参/.test(note));
  assert.ok(!/核对本次占类是否判对/.test(note), '综合类不是判错，措辞须区分');
});

t('未传 domainsForHint 时不产出提示，不凭空猜占类', function () {
  var r = LX.resolve({ question: '钱包丢了', chart: CHART, options: { school: 'zhuanpan', domain: 'wealth' } });
  assert.deepStrictEqual(r.suggestedDomains, []);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
