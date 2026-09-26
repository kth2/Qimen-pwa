/**
 * Phase 35「快速复盘」回归测试（纯 Node，无框架；源码守卫）。
 * 运行：node core/review.test.js
 *
 * 起因：复盘表单每次要逐条判 15–30 项（盘面象义 4–6 行、规则判读 2–15 行、逐维度若干），
 * 用户嫌麻烦。按用户两次整本评估（152 例／72 例）重估各栏的实际用处：
 *   · 改了纲领的发现（15 条「分量读成有无」、应期 12:1 只晚不早）全出自**实况文字与断错分析**；
 *   · 逐条勾选做了 93%，而 177 个规则分支里够 8 例门槛的只有 1 个；
 *   · 盘面象义的逐条标注只进「校准统计」里一张按「元素@宫」分的表，不进任何修订——样本永远攒不够。
 * 用户定：撤掉盘面象义逐条标注；「AI 代标并保存」做主按钮；细标折叠。
 *
 * DOM 行为另在 Chromium 里端到端实测过（见 README Phase 35）；本文件守住源码结构，免得改回去。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function fnSrc(name) {
  var at = APP.indexOf('function ' + name + '(');
  assert.ok(at > 0, '找不到 ' + name);
  var next = APP.indexOf('\n  async function ', at + 10), next2 = APP.indexOf('\n  function ', at + 10);
  var end = [next, next2].filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; })[0] || APP.length;
  return APP.slice(at, end);
}
var OPEN = fnSrc('openReview');

console.log('== 首屏只留三样，主按钮是「AI 代标并保存」 ==');
t('首屏有 ① 实况、② 日期、③ 整体判断', function () {
  assert.ok(/id="reviewActual"/.test(OPEN) && /id="reviewDate"/.test(OPEN) && /name="reviewOutcome"/.test(OPEN));
});
t('主按钮「AI 代标并保存」排在「仅保存」之前，且都在细标之外', function () {
  var a = OPEN.indexOf('id="reviewAiSaveBtn"'), s = OPEN.indexOf('id="reviewSaveBtn"'), f = OPEN.indexOf('<details id="reviewFine"');
  assert.ok(a > 0 && s > a, '主按钮须在仅保存之前');
  assert.ok(f > s, '两个保存按钮须在细标（折叠区）之外');
  assert.ok(/AI 代标并保存/.test(OPEN) && /仅保存/.test(OPEN));
});
t('「占问当天」「次日」快捷键，取自存档盘的占问日期', function () {
  assert.ok(/id="reviewDayAsk"/.test(OPEN) && /id="reviewDayNext"/.test(OPEN));
  assert.ok(/chartRef && rec\.chartRef\.date/.test(OPEN), '占问日期须取自 chartRef.date');
});

console.log('== 细标折叠；盘面象义逐条标注已撤 ==');
t('细标是默认折叠的 <details>，内含规则判读与逐维度', function () {
  var f = OPEN.indexOf('<details id="reviewFine"'), e = OPEN.indexOf('</details>', f);
  assert.ok(f > 0 && e > f);
  var fine = OPEN.slice(f, e);
  assert.ok(!/<details id="reviewFine"[^>]*\bopen\b/.test(OPEN), '细标不得默认展开');
  assert.ok(/rulesHtml/.test(fine) && /dimsFormHtml\(rec\)/.test(fine), '规则判读与逐维度须在细标里');
});
t('表单与保存都不再有盘面象义的下拉', function () {
  assert.ok(APP.indexOf('data-symverdict') < 0, '仍有 data-symverdict');
  assert.ok(!/symsHtml/.test(OPEN), '仍在生成象义逐条行');
});

console.log('== 保存：旧标注不丢，来源如实记 ==');
var SAVE = fnSrc('saveReview');
t('旧案例当初的象义标注原样带过，不因重新保存而丢', function () {
  assert.ok(/symbolVerdicts = Object\.assign\(\{\}, \(\(_reviewRec\.feedback \|\| \{\}\)\.symbolVerdicts\)/.test(SAVE));
});
t('标注来源：人手改过 → manual；只由 AI 代标 → ai；不能一律记 manual', function () {
  assert.ok(/_reviewRec\._touched \? 'manual' : _reviewRec\._aiDone \? 'ai'/.test(SAVE));
  assert.ok(!/anyManual \? 'manual'/.test(SAVE), '旧的「有值即 manual」写法仍在');
  assert.ok(/\$\('reviewFine'\)\.addEventListener\('change'/.test(OPEN), '须在细标上侦测人手改动');
});

console.log('== 主按钮：代标失败不自动保存；已代标过不重跑 ==');
var AS = (function () { try { return fnSrc('aiAndSave'); } catch (e) { return ''; } })();
t('先校验实况与整体判断', function () {
  assert.ok(/请先填写 ①/.test(AS) && /请先选择 ③/.test(AS));
});
t('已代标过（先代标、看过再存）不重跑——重跑会冲掉细标里的改动', function () {
  assert.ok(/let ok = !!_reviewRec\._aiDone;/.test(AS));
});
t('代标失败：写明原因、不保存（保存会收起面板，失败的消息就看不见了）', function () {
  var f = AS.indexOf('if (!ok) {'), s = AS.indexOf('await saveReview()');
  assert.ok(f > 0 && s > f, '失败分支须在保存之前');
  assert.ok(/return;\s*\}\s*await saveReview\(\)/.test(AS), '失败分支须 return，不落到保存');
  assert.ok(/未保存/.test(AS));
});
t('AI 代标会填逐维度（此前只能手填）', function () {
  var AI = fnSrc('aiReview');
  assert.ok(/parsed\.dimVerdicts/.test(AI) && /input\[name="dim_/.test(AI));
  assert.ok(!/symbolVerdicts/.test(AI), 'aiReview 不得再填象义');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
