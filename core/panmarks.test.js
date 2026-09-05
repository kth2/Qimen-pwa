/**
 * Phase 22 盘面四害标记 与 撤掉排盘栏「目的」 回归测试（纯 Node，无框架）。
 * 运行：node core/panmarks.test.js
 *
 * 两件事都是界面上的，但都不是装饰：
 *
 *   ① **四害此前在九宫格里一个字都没有**。门迫、击刑、入墓只出现在下方「九宫详解」的
 *      文字里与喂给模型的证据包里，看盘的人从格子上看不出来。而纲要把这四样并称四害、
 *      明令「断成败必须称量，不可略过」——盘上不显，等于每次都要低头去别处对。
 *
 *   ② **排盘栏的「目的」下拉自 Phase 17 起已不起作用**：真正决定取用与判读的是
 *      AI 面板的「占类」（走 opts.category 那一路），而「目的」只进 calculate()。
 *      两个下拉并存、语义又不一样，是实测里误导过人的地方。故撤掉，只留一个。
 *
 * 界面代码没有单元可测的纯函数，故本文件是**源码守卫**：钉住结构与不变量，
 * 让「改回去」或「漏改一处」当场红。渲染实效另由浏览器实测核对（见 README）。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

var ROOT = path.join(__dirname, '..');
var APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
var HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var CSS = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

console.log('\n== 四害进九宫格：三样此前一个字都没有 ==');
t('门迫／击刑／入墓三样都有角标文字与提示语', function () {
  ['迫', '刑', '墓'].forEach(function (c) {
    assert.ok(new RegExp("'" + c + "'").test(APP), '缺角标文字「' + c + '」');
  });
  assert.ok(/门迫：门克宫/.test(APP), '门迫缺提示语');
  assert.ok(/击刑：六仪落其刑宫/.test(APP), '击刑缺提示语');
  assert.ok(/入墓：仅余两成力/.test(APP), '入墓缺提示语');
});
t('入墓／击刑判定取自 WangShuai，不在界面另写一套表', function () {
  assert.ok(/window\.WangShuai/.test(APP), '未取 WangShuai');
  assert.ok(/W\.isRuMu\(/.test(APP) && /W\.isJiXing\(/.test(APP), '未调用 isRuMu/isJiXing');
  // 界面里不得出现自抄的墓宫/刑宫表——两份表迟早对不上
  assert.ok(!/RU_MU_GONG\s*=/.test(APP), 'app.js 里另抄了一份墓宫表');
  assert.ok(!/JI_XING_GONG\s*=/.test(APP), 'app.js 里另抄了一份刑宫表');
});
t('门迫取引擎 jiuGongAnalysis.menPo，与 wangshuai 同源', function () {
  assert.ok(/function menPoAt\([\s\S]{0,200}jiuGongAnalysis/.test(APP), '门迫未读 jiuGongAnalysis');
  var WS = fs.readFileSync(path.join(ROOT, 'core', 'wangshuai.js'), 'utf8');
  assert.ok(/d\.menPo/.test(WS), 'wangshuai 也该读同一处（两边同源才不会各说各话）');
});
t('WangShuai 缺席时一律不标——宁可不标，不可乱标', function () {
  var seg = APP.slice(APP.indexOf('function ganHarms('), APP.indexOf('function menPoAt('));
  assert.ok(/if \(!W \|\| !gan\) return \[\];/.test(seg), '缺 WangShuai 时须返回空，不得猜');
});
t('转盘格：门标迫、天地盘干各标各的墓刑', function () {
  var seg = APP.slice(APP.indexOf('function cellZhuanpan('), APP.indexOf('function cellFeipan('));
  assert.ok(/ganHarms\(tg, g\)/.test(seg) && /ganHarms\(dg, g\)/.test(seg), '天地盘干须各判各的');
  assert.ok(/glyph\(men, po\)/.test(seg), '门未标迫');
  assert.ok(/glyph\(tg, ht\)/.test(seg) && /glyph\(dg, hd\)/.test(seg), '干未标墓刑');
  assert.ok(/kong \? 'gong-kong' : ''/.test(seg), '空亡宫未加整格标记');
});
t('飞盘格同样标（四害两派通用，飞盘纲要亦有「四害」一节）', function () {
  var seg = APP.slice(APP.indexOf('function cellFeipan('), APP.indexOf('function renderChart('));
  assert.ok(/ganHarms\(tYi, g\)/.test(seg) && /ganHarms\(dYi, g\)/.test(seg), '飞盘天地盘仪未标');
  assert.ok(/glyph\(mMen, po\)/.test(seg), '飞盘人盘明门未标迫');
  assert.ok(/kong \? 'gong-kong' : ''/.test(seg), '飞盘空亡宫未加整格标记');
  var FP = fs.readFileSync(path.join(ROOT, 'assets', 'feipan-method.md'), 'utf8');
  assert.ok(/四害（门迫 \/ 击刑 \/ 空亡 \/ 入墓）/.test(FP), '飞盘纲要须确有四害一节，否则不该照标');
});
t('诸害合成一个角标，不是各出一个（右列装不下两个）', function () {
  var seg = APP.slice(APP.indexOf('function harmBadge('), APP.indexOf('function glyph('));
  assert.ok(/ks\.map\(k => HARM_TXT\[k\]\)\.join\(''\)/.test(seg), '未合成一个角标');
  assert.ok(/HARM_ORDER/.test(APP), '未定次序');
  var m = APP.match(/const HARM_ORDER = \[([^\]]+)\]/);
  assert.ok(m && m[1].indexOf("'mu'") < m[1].indexOf("'xing'"), '墓最重（仅余两成），须居首');
});
t('无害之字不多套一层标签（免得平白改变字的排版）', function () {
  var seg = APP.slice(APP.indexOf('function glyph('), APP.indexOf('function ganHarms('));
  assert.ok(/if \(!text \|\| !kinds\.length\) return esc\(text\);/.test(seg), '无害时应原样输出');
});
t('图例随盘一同渲染，且五样俱全', function () {
  assert.ok(/HARM_LEGEND/.test(APP));
  var seg = APP.slice(APP.indexOf('const HARM_LEGEND'), APP.indexOf('const HARM_LEGEND') + 900);
  ['门迫', '击刑', '入墓', '空亡', '驿马'].forEach(function (n) {
    assert.ok(seg.indexOf(n) >= 0, '图例缺「' + n + '」');
  });
  assert.ok(/门迫\/击刑各减半/.test(seg) && /入墓仅余两成/.test(seg), '图例须写明减力口径');
  assert.ok(/\+ HARM_LEGEND;/.test(APP), 'renderChart 未附上图例');
});

console.log('\n== 配色：不许把五行读乱 ==');
t('四害用角标与描边，不改字色——字色仍归五行', function () {
  ['.harm-po', '.harm-xing', '.harm-mu'].forEach(function (c) {
    assert.ok(CSS.indexOf(c) >= 0, 'CSS 缺 ' + c);
  });
  ['.harm-box-po', '.harm-box-xing', '.harm-box-mu'].forEach(function (c) {
    assert.ok(CSS.indexOf(c) >= 0, 'CSS 缺 ' + c);
  });
  // 五行色规则不得被四害规则改写
  var harmSeg = CSS.slice(CSS.indexOf('四害在九宫格里的标记'));
  assert.ok(!/\.wuxing-/.test(harmSeg), '四害样式段动了五行色，五行读法会被搅乱');
});
t('三种害的色值互不相同，也不与五行色重合', function () {
  var pick = function (sel) {
    var m = CSS.match(new RegExp('\\' + sel + '\\s*\\{[^}]*background:\\s*(#[0-9A-Fa-f]{6})'));
    return m && m[1].toUpperCase();
  };
  var c = ['.harm-po', '.harm-xing', '.harm-mu'].map(pick);
  c.forEach(function (x, i) { assert.ok(x, '取不到色值：' + i); });
  assert.strictEqual(new Set(c).size, 3, '三色须互不相同：' + c.join(','));
  // 五行色（木绿 火红 土褐 金橙 水蓝）见 .border-* 一节
  var wx = ['#4CAF50', '#F44336', '#996633', '#FF8109', '#2196F3'];
  c.forEach(function (x) { assert.ok(wx.indexOf(x) < 0, x + ' 与五行色撞了'); });
});
t('角标绝对定位，不占横向宽度（右列只有约 34px，字身已占 18px）', function () {
  var seg = CSS.slice(CSS.indexOf('.hg > .harm-mark'), CSS.indexOf('.hg > .harm-mark') + 260);
  assert.ok(/position:\s*absolute/.test(seg), '角标须绝对定位，否则必撑破右列');
});

console.log('\n== 撤掉排盘栏「目的」：一件事只留一个开关 ==');
t('index.html 里已无 inPurpose', function () {
  assert.ok(HTML.indexOf('inPurpose') < 0, '排盘栏「目的」下拉仍在');
});
t('app.js 里再无一处读 inPurpose（留一处就会在它缺席时炸）', function () {
  assert.ok(APP.indexOf('inPurpose') < 0, 'app.js 仍在读 inPurpose');
});
t('占类下拉自带全部选项，不再靠启动时从「目的」搬（那个下拉已没了，再搬就搬空）', function () {
  var at = HTML.indexOf('<select id="aiDomain">');
  assert.ok(at >= 0, '找不到占类下拉');
  var seg = HTML.slice(at, HTML.indexOf('</select>', at));
  var vals = (seg.match(/value="[^"]*"/g) || []);
  assert.strictEqual(vals.length, 17, '应为 1 个「自动判定」+ 16 个占类，实得 ' + vals.length);
  assert.ok(/value=""/.test(seg), '缺「跟随问句自动判定」');
  ['综合', '学业', '股市', '天气'].forEach(function (v) {
    assert.ok(seg.indexOf('value="' + v + '"') >= 0, '缺选项 ' + v);
  });
  assert.ok(!/inPurpose'\)\.options/.test(APP), '仍在从已撤下拉搬选项');
});
t('排盘的 purpose 改向占类下拉要值，两条排盘路径都用同一个来源', function () {
  assert.ok(/function purposeNow\(\)/.test(APP), '缺 purposeNow');
  var seg = APP.slice(APP.indexOf('function purposeNow()'), APP.indexOf('function purposeNow()') + 200);
  assert.ok(/aiDomain/.test(seg) && /'综合'/.test(seg), '缺省须回到综合，与从前默认值一致');
  assert.ok(/const purpose = purposeNow\(\);/.test(APP), '山向盘未改');
  assert.ok(/purpose = purposeNow\(\), juShu/.test(APP), '时家盘未改');
});
t('resolveCategory 只认一个来源，source 不再有 purpose 这一档', function () {
  var seg = APP.slice(APP.indexOf('function resolveCategory()'), APP.indexOf('function resolveCategory()') + 700);
  assert.ok(/aiDomain/.test(seg), '未读占类下拉');
  assert.ok(!/purpose/.test(seg.replace(/uiPick/g, '')), 'resolveCategory 仍掺着「目的」那一路');
  assert.ok(/source: uiPick \? 'ai' : 'auto'/.test(seg), 'source 档位未收敛为两档');
});
t('改占类会重画「分析与建议」，且不动 window._pan', function () {
  assert.ok(/addEventListener\('change', refreshAnalysisForPurpose\)/.test(APP), '未挂上重画');
  var at = APP.indexOf('function refreshAnalysisForPurpose()');
  assert.ok(at > 0, '缺 refreshAnalysisForPurpose');
  var seg = APP.slice(at, APP.indexOf('\n  }', APP.indexOf('renderAnalysis(p);', at)));
  assert.ok(!/window\._pan\s*=/.test(seg), '重画时动了 _pan——「存为案例」的素材会被无故作废');
  assert.ok(!/_lastReading\s*=/.test(seg), '重画时作废了解读素材');
  assert.ok(/if \(!p \|\| p\.error\) return;/.test(seg), '排不出时应维持原样，不拿错误盖掉已有分析');
});
t('markUnsupportedDomains 只标占类下拉一处', function () {
  var seg = APP.slice(APP.indexOf('function markUnsupportedDomains()'), APP.indexOf('function previewDomain()'));
  assert.ok(/aiDomain/.test(seg));
  assert.ok(seg.indexOf('inPurpose') < 0, '仍在标已撤的下拉');
});

console.log('\n== 窄屏：角标不许压到邻字，也不许把字顶出格子 ==');
t('宫格内容盒改用 border-box——content-box 下 height:100% 加内边距会顶出格子', function () {
  // 这是本就存在的老账：.gong{overflow:hidden}，而 .gong-content 高 100% 再加 4px 内边距，
  // 盒子比宫格高出 8px，最后一行（地盘干/宫名/宫数）被裁掉。宽屏行高富余看不出来，
  // 窄屏一量就现形：375px 下 150 张盘里 81 处字被裁。量宽度时顺手量出来的。
  var seg = CSS.slice(CSS.indexOf('.gong-content {'), CSS.indexOf('.gong-content {') + 900);
  assert.ok(/box-sizing:\s*border-box/.test(seg), '.gong-content 缺 border-box');
  var seg2 = CSS.slice(CSS.indexOf('.feipan-gong-content {'), CSS.indexOf('.feipan-gong-content {') + 600);
  assert.ok(/box-sizing:\s*border-box/.test(seg2), '.feipan-gong-content 缺 border-box');
});
t('两派各有一套按宽度缩放的档位，且最窄一档只留描边', function () {
  ['439px', '392px', '375px', '359px'].forEach(function (w) {
    assert.ok(CSS.indexOf('max-width: ' + w) >= 0, '缺 max-width:' + w + ' 一档（转盘）');
  });
  assert.ok(CSS.indexOf('max-width: 419px') >= 0, '缺 max-width:419px 一档（飞盘）');
  // 最窄一档：两派都只留描边、收起角标文字
  var narrow = CSS.slice(CSS.indexOf('@media (max-width: 359px)'));
  assert.ok((narrow.match(/\.hg > \.harm-mark \{ display: none/g) || []).length >= 1,
    '359px 一档须收起角标文字，只留描边');
});
t('窄屏覆盖必须排在基准规则之后（媒体查询不加特异度，同选择器时后来者胜）', function () {
  // 起初把它们写在基准规则前面，实测量出来角标位置仍是基准值，那一档等于整个没生效。
  // 取**首次**出现处＝基准规则（媒体查询里的那几条都排在文件后段）
  var base = CSS.indexOf('.feipan-gong-content .hg > .harm-mark {');
  var media = CSS.indexOf('@media (max-width: 419px)');
  assert.ok(base >= 0 && media >= 0, '基准规则或飞盘窄屏档位缺失');
  assert.ok(media > base, '飞盘窄屏覆盖排在了基准规则前面，会被基准值盖掉');
  var zbase = CSS.indexOf('.hg > .harm-mark {');          // 通用基准（转盘走这一条）
  assert.ok(zbase >= 0);
  assert.ok(CSS.indexOf('@media (max-width: 439px)') > zbase, '转盘窄屏覆盖排在了基准规则前面');
});
t('飞盘只给带角标的那一行腾空间，无害之盘排版一点不动', function () {
  var seg = APP.slice(APP.indexOf('function cellFeipan('), APP.indexOf('function renderChart('));
  assert.ok(/ht\.length \? ' fp-row-harm' : ''/.test(seg), '天盘行未按需加类');
  assert.ok(/po\.length \? ' fp-row-harm' : ''/.test(seg), '人盘行未按需加类');
  assert.ok(/hd\.length \? ' fp-row-harm' : ''/.test(seg), '地盘行未按需加类');
  assert.ok(/\.fp-row-harm/.test(CSS), 'CSS 未定义 .fp-row-harm');
});
t('图例并列角标与色环——窄屏只剩描边时，得凭颜色认得出是哪一害', function () {
  var seg = APP.slice(APP.indexOf('const HARM_LEGEND'), APP.indexOf('const HARM_LEGEND') + 1100);
  ['harm-box-po', 'harm-box-xing', 'harm-box-mu'].forEach(function (c) {
    assert.ok(seg.indexOf('lg-ring ' + c) >= 0, '图例缺 ' + c + ' 的色环');
  });
  assert.ok(/\.harm-legend \.lg-ring/.test(CSS), 'CSS 未定义色环');
});

console.log('\n== 缓存版本：改了界面就得换 CACHE，否则老用户看不到 ==');
// 这条钉的是**当前**的名字，不是「变了就行」——变没变机器判不出，只有人知道。
// 钉死之后，下次改界面的人必然要来动这一行，也就必然会想起换 CACHE 这回事。
// 本条第一次跑就抓到了这次的疏漏：改完九宫格与下拉，CACHE 还停在上一期的名字。
t('sw.js 的 CACHE 名已随本次改动更新（改界面必换，否则老用户看的还是旧版）', function () {
  var SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  var m = SW.match(/const CACHE = '([^']+)'/);
  assert.ok(m, '找不到 CACHE');
  assert.strictEqual(m[1], 'qimen-pwa-panmarks2',
    '本期 CACHE 应为 qimen-pwa-panmarks2；若你又改了界面，请换个新名并同步改这一行');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
