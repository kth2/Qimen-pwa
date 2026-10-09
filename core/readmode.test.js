/**
 * Phase 39 读法（标准 / 全盘象义叙事）回归测试（纯 Node，无框架）。
 * 运行：node core/readmode.test.js
 *
 * 要钉死的几处：
 *   ① 缺省「轮流」——每次随机分一种读法，并把分到哪种、怎么来的记进案例 meta；
 *   ② 评估器只拿随机分到的那些比较，手选的另列、退回的不进任一组；
 *   ③ 叙事读法不送计票类内容（证据包 READING、引擎总体吉凶、旧骨架），但各层照算照存；
 *   ④ 只用于转盘时家（飞盘、山向一律标准读法，零串味）；
 *   ⑤ index.html、sw.js 都带上了象义卡与叙事纲要，离线版本不缺这一层。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

var ROOT = path.join(__dirname, '..');
var APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
var HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
var EVAL = require('./evaluate.js');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function grab(name) {
  var at = APP.indexOf('function ' + name + '(');
  var end = APP.indexOf('\n  }', at);
  assert.ok(at > 0 && end > at, 'app.js 里取不出 ' + name);
  return APP.slice(at, end + 4);
}

console.log('== 界面与离线 ==');
t('index.html 有读法下拉，缺省第一项为「轮流」', function () {
  var at = HTML.indexOf('id="aiReadMode"');
  assert.ok(at > 0, '缺读法下拉');
  var seg = HTML.slice(at, HTML.indexOf('</select>', at));
  var vals = (seg.match(/value="([^"]+)"/g) || []).map(function (s) { return s.slice(7, -1); });
  assert.deepStrictEqual(vals, ['alternate', 'standard', 'narrative']);
});
t('index.html 在 app.js 之前引入 core/xiangka.js', function () {
  var a = HTML.indexOf('core/xiangka.js'), b = HTML.indexOf('src="app.js"');
  assert.ok(a > 0 && a < b);
});
t('sw.js 缓存象义卡、古籍象义表、叙事纲要，并换了缓存名', function () {
  assert.ok(/\.\/core\/xiangka\.js/.test(SW));
  assert.ok(/\.\/knowledge\/classics-xiangyi\.json/.test(SW));
  assert.ok(/\.\/assets\/narrative-method\.md/.test(SW));
  assert.ok(!/qimen-pwa-huitui/.test(SW), '缓存名未换，旧 SW 不会更新');
});
t('sw.js 所列文件全都存在', function () {
  var list = SW.slice(SW.indexOf('const ASSETS'), SW.indexOf('];'));
  (list.match(/'\.\/[^']+'/g) || []).forEach(function (q) {
    var f = q.slice(3, -1);
    if (!f) return;
    assert.ok(fs.existsSync(path.join(ROOT, f)), '缺文件 ' + f);
  });
});

console.log('== 分配 ==');
function mkPick(school, mode, pref, rnd) {
  var src = grab('readModePref') + grab('pickReadMode');
  var $ = function () { return { value: pref }; };
  var M = { random: function () { return rnd; } };
  return new Function('$', 'school', 'mode', 'XK', 'Math', src + '; return pickReadMode();')($, school, mode, {}, M);
}
t('轮流：随机数 < 0.5 分到叙事，否则标准，均记 random', function () {
  assert.deepStrictEqual(mkPick('zhuanpan', 'shijia', 'alternate', 0.2), { mode: 'narrative', assigned: 'random' });
  assert.deepStrictEqual(mkPick('zhuanpan', 'shijia', 'alternate', 0.7), { mode: 'standard', assigned: 'random' });
});
t('手选：照选，记 manual', function () {
  assert.deepStrictEqual(mkPick('zhuanpan', 'shijia', 'narrative', 0.9), { mode: 'narrative', assigned: 'manual' });
  assert.deepStrictEqual(mkPick('zhuanpan', 'shijia', 'standard', 0.1), { mode: 'standard', assigned: 'manual' });
});
t('飞盘、山向：一律标准，记 n/a（零串味）', function () {
  assert.deepStrictEqual(mkPick('feipan', 'shijia', 'narrative', 0.1), { mode: 'standard', assigned: 'n/a' });
  assert.deepStrictEqual(mkPick('zhuanpan', 'shanxiang', 'alternate', 0.1), { mode: 'standard', assigned: 'n/a' });
});
t('分配只在 runAI 里做一次，标题与存档用同一个值', function () {
  assert.strictEqual((APP.match(/= pickReadMode\(\)/g) || []).length, 1);
  assert.ok(/m\.readMode = readMode;/.test(APP) && /m\.readModeAssigned = rm\.assigned;/.test(APP));
  assert.ok(/answerHead\(catName, \(LLM\.lastUsed && LLM\.lastUsed\(\)\) \|\| null, LLM\.info\(\), readMode\)/.test(APP));
});
t('读法偏好存本机，读写都包了 try/catch', function () {
  var at = APP.indexOf("if ($('aiReadMode'))");
  var seg = APP.slice(at, at + 700);
  assert.ok(/try \{[^}]*localStorage\.getItem\(READMODE_LS\)/.test(seg));
  assert.ok(/try \{ localStorage\.setItem\(READMODE_LS/.test(seg));
});

console.log('== 提示词 ==');
t('answerHead：叙事时标出读法，标准不标', function () {
  var answerHead = new Function(grab('answerHead') + '; return answerHead;')();
  var info = { provider: 'gemini', model: 'g' };
  assert.ok(/读法：全盘叙事/.test(answerHead('失物', null, info, 'narrative')));
  assert.ok(!/读法/.test(answerHead('失物', null, info, 'standard')));
  assert.ok(!/读法/.test(answerHead('失物', null, info)));
});
t('narrativeUser：删引擎总体／建议与旧骨架，保留九宫与用神', function () {
  var f = new Function(grab('narrativeUser') + '; return narrativeUser;')();
  var u = '【占问】猫\n【九宫】…\n  1宫(正北): 太阴 天心 开门 | 天丙/地辛 | 小吉 月奇相合\n【引擎·总体】大凶\n【引擎·用神】值符\n【引擎·建议】宜低调\n【用神落宫】\n  - 六合\n\n【请按以下骨架作答】\n1) 能否/吉凶：…';
  var o = f(u);
  assert.ok(!/引擎·总体|引擎·建议|请按以下骨架/.test(o), o);
  assert.ok(/1宫\(正北\)/.test(o) && /【引擎·用神】/.test(o) && /【用神落宫】/.test(o));
  assert.strictEqual(f('无骨架的盘'), '无骨架的盘', '删不到就原样返回');
});
t('narrativeRiShi：只去掉末行「以生克定成败」的判法，落宫照留', function () {
  var f = new Function(grab('narrativeRiShi') + '; return narrativeRiShi;')();
  var b = '\n【日干/时干落宫】\n  - 日干癸：天盘落3宫\n请按纲要「日干为人、时干为事」：先审时干宫对日干宫的生克盗泄定成败';
  var o = f(b);
  assert.ok(/日干癸/.test(o) && !/定成败/.test(o));
});
t('叙事读法不送证据包、不送 AI_DISCIPLINE，改送叙事纲要与象义卡', function () {
  var at = APP.indexOf("if (readMode === 'narrative') {\n        // 应期锚点");
  assert.ok(at > 0, '找不到叙事分支');
  var seg = APP.slice(at, APP.indexOf('} else {', at));
  assert.ok(/narrativeMethod/.test(seg) && /xkBlock/.test(seg));
  assert.ok(!/evBlock|AI_DISCIPLINE|EVIDENCE_DISCIPLINE/.test(seg), '叙事分支混进了计票类内容');
});
t('各层照算照存：叙事分支在证据包构建之后，runOut 仍赋值', function () {
  var ev = APP.indexOf('const evidence = EV.build('), nb = APP.indexOf("let xkBlock = '';");
  assert.ok(ev > 0 && nb > ev);
});
t('象义卡建不出来就退回标准读法，并记 readModeFellBack', function () {
  assert.ok(/readMode = 'standard'; xkBlock = '';/.test(APP));
  assert.ok(/if \(rm\.mode !== readMode\) m\.readModeFellBack = true;/.test(APP));
});

console.log('== 评估器 ==');
function mk(i, rm, assigned, outcome, fellBack) {
  var meta = { provider: 'gemini', model: 'g', label: 'gemini/g' };
  if (rm) { meta.readMode = rm; meta.readModeAssigned = assigned; }
  if (fellBack) meta.readModeFellBack = true;
  return {
    id: 'c' + i, createdAt: '2026-10-10T10:00:00Z', question: 'q' + i, domain: 'general', answer: '…', meta: meta,
    feedback: { outcome: outcome, actual: '实况文本够长够长够长够长够长够长', recordedAt: '2026-10-11T11:00:00Z' }
  };
}
t('无读法记录：不出这一节，旧案例计入「未记录」', function () {
  var r = EVAL.evaluate({ cases: [mk(1, null, null, 'happened')] });
  assert.strictEqual(r.byReadMode.random.length, 0);
  assert.strictEqual(r.byReadMode.unrecorded, 1);
  assert.ok(!/按读法/.test(EVAL.toReport(r)));
});
t('只有随机分到的进比较；手选另列；退回的不进任一组', function () {
  var cs = [], i = 0;
  for (var k = 0; k < 10; k++) cs.push(mk(i++, 'standard', 'random', k < 4 ? 'happened' : 'not_happened'));
  for (var k2 = 0; k2 < 10; k2++) cs.push(mk(i++, 'narrative', 'random', k2 < 7 ? 'happened' : 'not_happened'));
  for (var k3 = 0; k3 < 5; k3++) cs.push(mk(i++, 'narrative', 'manual', 'happened'));
  cs.push(mk(i++, 'standard', 'random', 'happened', true));
  var r = EVAL.evaluate({ cases: cs }, { minSamples: 8 });
  var R = r.byReadMode;
  assert.strictEqual(R.random.length, 2);
  var st = R.random.filter(function (x) { return x.key === 'standard'; })[0];
  var na = R.random.filter(function (x) { return x.key === 'narrative'; })[0];
  assert.strictEqual(st.n, 10); assert.strictEqual(na.n, 10);
  assert.strictEqual(st.exactRate, 40); assert.strictEqual(na.exactRate, 70);
  assert.strictEqual(R.manual[0].n, 5);
  assert.strictEqual(R.fellBack, 1);
  assert.strictEqual(R.comparison.diffExact, 30);
  assert.ok(R.comparison.pTwoSided > 0.1 && R.comparison.pTwoSided < 0.25, 'p=' + R.comparison.pTwoSided);
  var txt = EVAL.toReport(r);
  assert.ok(/按读法/.test(txt) && /叙事减标准/.test(txt) && /手选（不进比较）/.test(txt));
});
t('一组不足门槛：不给差值，明说比不出来', function () {
  var cs = [];
  for (var k = 0; k < 10; k++) cs.push(mk(k, 'standard', 'random', 'happened'));
  for (var k2 = 0; k2 < 3; k2++) cs.push(mk(20 + k2, 'narrative', 'random', 'happened'));
  var r = EVAL.evaluate({ cases: cs }, { minSamples: 8 });
  assert.strictEqual(r.byReadMode.comparison, null);
  assert.ok(/还比不出来/.test(EVAL.toReport(r)));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
