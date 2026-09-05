/**
 * 占类三套词表的一致性 回归测试（纯 Node，无框架）。
 * 运行：node core/categorymap.test.js
 *
 * 占类有三套并不同名的词表：
 *   ① 界面「目的」  综合/事业/财运/婚姻/健康/学业/…（index.html）
 *   ② 引擎占类      综合/事业/求财/婚姻/疾病/功名/…（engine.bundle.js）
 *   ③ 规则占类      general/wealth/career/…（knowledge/domains.json）
 * 三者靠 uiPurposeToEngineCategory 与 uiPurposes/engineCategories 串起来。
 * 任一处漏一项都不会报错，只会让某个占类**静默降级**——这类问题实测已出过两次：
 *   · 用户选「学业」而整篇按求财断（fallbackCategory 被 buildPrompt 忽略）；
 *   · 飞盘选「失物」而引擎落回综合、一个用神都不给，界面却仍写「你指定的」。
 * 本文件把三套词表钉在一起，并把「引擎支持度」对着活引擎核一遍。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

global.window = {};
require(path.join(__dirname, '..', 'engine.bundle.js'));
var QM = global.window.QM;
var YS = require('./yongshen.js');
var DOMAINS = require('../knowledge/domains.json');
YS.load(DOMAINS);

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
/** 界面下拉的真实取值——直接从 index.html 读，免得测试里另抄一份而与界面漂移。
 * 从前读的是排盘栏的 <select id="inPurpose">。Phase 22 撤掉了那个下拉（自 Phase 17 起
 * 它对解读已不起作用，两处并存反而误导人），选项表整个搬进了 <select id="aiDomain">，
 * 故此处改读 aiDomain。它头一项 value="" 是「跟随问句自动判定」，不是占类，须滤掉。 */
function uiPurposes() {
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var at = html.indexOf('<select id="aiDomain">');
  assert.ok(at >= 0, 'index.html 里找不到占类下拉 aiDomain');
  var seg = html.slice(at, html.indexOf('</select>', at));
  var out = [], m, re = /value="([^"]*)"/g;
  while ((m = re.exec(seg))) if (m[1]) out.push(m[1]);   // 空值＝自动判定，不计入占类
  return out;
}
var UI = uiPurposes();

console.log('\n== 三套词表串得上 ==');
t('界面下拉有 16 个占类，且从 index.html 直接读取（不另抄一份）', function () {
  assert.strictEqual(UI.length, 16, '实得 ' + UI.length + '：' + UI.join('、'));
  assert.ok(UI.indexOf('综合') >= 0 && UI.indexOf('学业') >= 0 && UI.indexOf('股市') >= 0);
});
t('每个界面选项都能解析出引擎占类与规则占类，无一落空', function () {
  UI.forEach(function (u) {
    var m = YS.categoryMap(u, 'zhuanpan');
    assert.ok(m.engineCategory, u + ' 解析不出引擎占类');
    assert.ok(m.ruleDomain, u + ' 解析不出规则占类');
    assert.ok(YS.domainIds().indexOf(m.ruleDomain) >= 0, u + ' 落到了不存在的占类 ' + m.ruleDomain);
  });
});
t('每个界面选项在 domains.json 的 uiPurposes 里恰好出现一次', function () {
  var seen = {};
  YS.domainIds().forEach(function (id) {
    ((YS.getDomain(id) || {}).uiPurposes || []).forEach(function (u) {
      assert.ok(!seen[u], u + ' 出现在多个占类里：' + seen[u] + ' 与 ' + id);
      seen[u] = id;
    });
  });
  UI.forEach(function (u) { assert.ok(seen[u], u + ' 未被任何占类收录'); });
});
t('uiPurposeToEngineCategory 的键都是真实存在的界面选项', function () {
  Object.keys(DOMAINS.uiPurposeToEngineCategory || {}).forEach(function (k) {
    assert.ok(UI.indexOf(k) >= 0, '映射表里的「' + k + '」不是界面选项，已成死条目');
  });
});
t('规则占类与引擎占类的对应是双向自洽的', function () {
  UI.forEach(function (u) {
    var m = YS.categoryMap(u, 'zhuanpan');
    var d = YS.getDomain(m.ruleDomain) || {};
    assert.ok((d.engineCategories || []).indexOf(m.engineCategory) >= 0,
      u + '→' + m.engineCategory + ' 未列在 ' + m.ruleDomain + ' 的 engineCategories 里');
  });
});


t('【股市】与「财运」同走引擎「求财」，但规则占类必须分得开', function () {
  var a = YS.categoryMap('财运', 'zhuanpan'), b = YS.categoryMap('股市', 'zhuanpan');
  assert.strictEqual(a.engineCategory, '求财');
  assert.strictEqual(b.engineCategory, '求财', '股市映到求财，以取得生门/戊两个财星');
  assert.strictEqual(a.ruleDomain, 'wealth');
  assert.strictEqual(b.ruleDomain, 'stock', '若从引擎占类反推，股市会被 wealth 抢走，专条永远跑不到');
  // 反向：直接以引擎占类问，仍应得 wealth（插入序在前），不因新增 stock 而改变
  assert.strictEqual(YS.normalizeDomain('求财'), 'wealth');
});
t('app 显式选择时用 categoryMap.ruleDomain，不从引擎占类反推', function () {
  var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/rc\.explicit && catMap && catMap\.ruleDomain/.test(APP),
    '否则「财运」与「股市」这类同引擎占类的选项分不开');
});
t('【回归】catMap 必须由**界面选项**算出，不得传已转换的引擎占类', function () {
  var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  // 传 rc.category（引擎占类「求财」）进去，categoryMap 会算回 wealth，
  // 股市专条又跑不到——这一步实际写错过一次，故钉死。
  assert.ok(/YS\.categoryMap\(rc\.uiPick \|\| rc\.category \|\| fallbackCategory/.test(APP),
    '真跑处未以 rc.uiPick 起头');
  assert.ok(/YS\.categoryMap\(rc\.uiPick \|\| cat,/.test(APP), '预览处未以 rc.uiPick 起头');
  assert.ok(/uiPick: uiPick/.test(APP), 'resolveCategory 未返回 uiPick');
});
console.log('\n== 引擎支持度：记录必须与活引擎一致 ==');
/** 与 domains.json 的 _measured 同一口径：四个时刻全中才算支持 */
function liveSupport(school, cat) {
  var times = ['2026-01-01T03:00:00', '2026-04-15T11:00:00', '2026-08-27T10:00:00', '2026-11-09T21:00:00'];
  return times.every(function (iso) {
    var p = school === 'feipan'
      ? QM.feipanQimen.calculate(new Date(iso), { method: '时家', purpose: '综合' })
      : QM.qimen.calculate(new Date(iso), { type: '四柱', method: '时家', purpose: '综合', location: '默认位置' });
    var B = school === 'feipan' ? QM.feipanPredict : QM.zhuanpanPredict;
    var c = B.buildPrompt(p, '测试', { methodText: 'x', category: cat }).context;
    return c.category === cat && c.yong && c.yong.matched;
  });
}
['zhuanpan', 'feipan'].forEach(function (sch) {
  t('【' + (sch === 'feipan' ? '飞盘' : '转盘') + '】记录的支持列表与实测逐项相符', function () {
    var wrong = [];
    UI.forEach(function (u) {
      var m = YS.categoryMap(u, sch);
      if (m.isZongHe) return;                     // 综合本就 matched=false，属设计
      var live = liveSupport(sch, m.engineCategory);
      if (live !== m.engineSupported) {
        wrong.push(u + '(' + m.engineCategory + ')：记录' + m.engineSupported + ' 实测' + live);
      }
    });
    assert.deepStrictEqual(wrong, [], '引擎行为与记录不符——引擎变了就该先红：' + wrong.join('；'));
  });
});
t('飞盘确不支持事业与失物，且各附了缘由', function () {
  ['事业', '失物'].forEach(function (u) {
    var m = YS.categoryMap(u, 'feipan');
    assert.strictEqual(m.engineSupported, false, u + ' 在飞盘上应为不支持');
    assert.strictEqual(m.degradedTo, '综合');
    assert.ok(m.degradeWhy && m.degradeWhy.length > 10, u + ' 须写明为何不支持');
  });
});
t('转盘则两者皆支持——不许把一派的限制推给另一派', function () {
  ['事业', '失物'].forEach(function (u) {
    assert.strictEqual(YS.categoryMap(u, 'zhuanpan').engineSupported, true, u);
  });
});

console.log('\n== 有无专条：不得凭名字猜 ==');
t('health 的 label 是「健康」而引擎占类叫「疾病」，仍算有专条', function () {
  var m = YS.categoryMap('健康', 'zhuanpan');
  assert.strictEqual(m.engineCategory, '疾病');
  assert.strictEqual(m.ruleDomain, 'health');
  assert.strictEqual(m.hasDedicatedRules, true, '曾用「label===引擎占类名」判断，此处即会判错');
});
t('学业→功名 现已有 study 专条（Phase 19 之前落 general）', function () {
  var m = YS.categoryMap('学业', 'zhuanpan');
  assert.strictEqual(m.engineCategory, '功名', '引擎占类名仍是功名，不随规则占类改名');
  assert.strictEqual(m.ruleDomain, 'study');
  assert.strictEqual(m.hasDedicatedRules, true);
});
t('综合仍落 general，且被认作「就是通用占类」而非降级', function () {
  var m = YS.categoryMap('综合', 'zhuanpan');
  assert.strictEqual(m.ruleDomain, 'general');
  assert.strictEqual(m.isZongHe, true, '综合须被单独认出，免得界面把它报成「无专条」');
});
t('十四个占类皆有专条，只余「综合」用通用条（Phase 19 之后）', function () {
  var yes = [], no = [];
  UI.forEach(function (u) {
    var m = YS.categoryMap(u, 'zhuanpan');
    (m.hasDedicatedRules ? yes : no).push(u);
  });
  assert.deepStrictEqual(no, ['综合'], '除综合外都该有专条，实际退用通用条的是：' + no.join('、'));
  assert.strictEqual(yes.length, 15, '实得 ' + yes.length);
});

console.log('\n== 数据未到位时必须说不知道 ==');
t('知识库未加载时 categoryMap 报 loaded:false，不给确定答案', function () {
  var Y2 = require('./yongshen.js');
  Y2.load(null);
  var m = Y2.categoryMap('失物', 'zhuanpan');
  assert.strictEqual(m.loaded, false);
  assert.strictEqual(m.engineSupported, null, '不知道就该是 null，不能是 true');
  assert.strictEqual(m.hasDedicatedRules, null);
  Y2.load(DOMAINS);
  assert.strictEqual(Y2.categoryMap('失物', 'zhuanpan').loaded, true);
});
t('app.js 在数据未到位时不渲染结论，且首屏就会去加载', function () {
  var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/if \(m && m\.loaded === false\) notes = '';/.test(APP), '未加载时应不下结论');
  assert.ok(/markUnsupportedDomains\(\)[\s\S]{0,80}previewDomain\(\)/.test(APP));
  assert.ok(/loadKnowledge\(\)\.then\(\(\) => \{ markUnsupportedDomains\(\); previewDomain\(\); \}\)/.test(APP),
    '首屏须主动加载知识库并在加载后重算——否则预览永远是在数据缺席下算的');
});
t('markUnsupportedDomains 在未加载时直接返回，不乱标', function () {
  var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/!YS\.isLoaded \|\| !YS\.isLoaded\(\)\) return;/.test(APP));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
