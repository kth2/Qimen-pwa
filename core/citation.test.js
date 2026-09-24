/**
 * 象义专条「纲要·」引文逐字 回归测试（纯 Node，无框架）。
 * 运行：node core/citation.test.js
 *
 * 起因（Phase 34）：旧七套出自纲要的专条（求财/综合/事业/感情/健康/官司/失物），依据写作
 * 「纲要·X节：……」，按逐字量，一半是转述、节录或作者据纲要推出的话——如「年命生用神(脱泄)→耗损」
 * 纲要原句是「用神宫脱泄年命(我生用神) → 耗损、多不成」；「戊墓于乾六宫」是由墓表推出的；
 * 「二者同宫则贵人在侧」纲要根本没有。「纲要·」这个标签让读的人（和模型）以为是原文。
 *
 * 逐条校过：能找到原句的换成原句；找不到的（作者的归纳、说明）保留原话，改标〔本层归纳〕／〔本层说明〕。
 * **只改依据文字，不动任何规则的命中条件、助阻与概念。**
 *
 * 本文件把这条规矩钉死：**凡「纲要·X：」之后的每一句，都须能在两份纲要里逐字找到**
 * （只抹去标点、空白与 markdown 粗体——字与字序须一致）。写转述，就得标〔本层归纳〕。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

var ROOT = path.join(__dirname, '..');
var RULES = require('../knowledge/domain-rules.json');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
var strip = function (s) { return String(s).replace(/\*\*/g, '').replace(/[^一-鿿A-Za-z0-9]/g, ''); };
var G = strip(fs.readFileSync(path.join(ROOT, 'assets', 'zhuanpan-method.md'), 'utf8'));

/** 逐条取出一个占类的全部依据 */
function allBases(id) {
  var d = RULES.domains[id], out = [];
  Object.keys(d.roles || {}).forEach(function (k) { out.push([id + ' role:' + k, d.roles[k].basis]); });
  ['conditions', 'combinations', 'relations'].forEach(function (k) {
    (d[k] || []).forEach(function (x) { out.push([x.id, x.basis]); });
  });
  return out;
}
/** 依据串 → 各段。段以「纲要·」「〔」或他源（symbols/domains.json）起头；原句内部可含句号，不在那里切 */
function parts(b) { return String(b || '').split(/。(?=纲要·|〔|symbols|knowledge|domains)/); }

var OLD7 = ['wealth', 'general', 'career', 'relationship', 'health', 'lawsuit', 'lost_item'];

console.log('== 凡「纲要·X：」之后的引文，须能在纲要里逐字找到 ==');
Object.keys(RULES.domains).forEach(function (id) {
  t(id + '：纲要标签下每一句皆为原句', function () {
    var bad = [];
    allBases(id).forEach(function (x) {
      parts(x[1]).forEach(function (p) {
        var m = p.match(/^纲要·[^：]*：([\s\S]*)$/);
        if (!m) return;
        m[1].split('；').forEach(function (s) {
          if (strip(s) && G.indexOf(strip(s)) < 0) bad.push(x[0] + '｜' + s);
        });
      });
    });
    assert.deepStrictEqual(bad, [], '以下挂着「纲要·」却不是原句（转述请标〔本层归纳〕）：\n    ' + bad.join('\n    '));
  });
});

console.log('== 旧七套：结构 ==');
t('每条依据都以「纲要·」起头（不再有「四节八门：」这类缺前缀的标签）', function () {
  var bad = [];
  OLD7.forEach(function (id) {
    allBases(id).forEach(function (x) { if (!/^纲要·/.test(x[1])) bad.push(x[0] + '｜' + String(x[1]).slice(0, 30)); });
  });
  assert.deepStrictEqual(bad, [], bad.join('\n    '));
});
t('段首只有三种：纲要·原句／〔本层说明·归纳〕／他源（symbols.json、domains.json）', function () {
  var bad = [];
  OLD7.forEach(function (id) {
    allBases(id).forEach(function (x) {
      parts(x[1]).forEach(function (p) {
        if (!/^(纲要·[^：]+：|〔本层(说明|归纳)[^〕]*〕|(knowledge\/)?(symbols|domains)\.json)/.test(p)) bad.push(x[0] + '｜' + p.slice(0, 30));
      });
    });
  });
  assert.deepStrictEqual(bad, [], bad.join('\n    '));
});
t('作者归纳确实留着（校的是标签，不是把话删掉）', function () {
  var n = 0;
  OLD7.forEach(function (id) { allBases(id).forEach(function (x) { if (/〔本层(说明|归纳)/.test(x[1])) n++; }); });
  assert.ok(n >= 60, '本层说明/归纳段太少：' + n);
});
t('由「旺相之凶格，凶亦有力」反推出的一句，标明是反推、纲要未明言', function () {
  var hit = [];
  OLD7.forEach(function (id) { allBases(id).forEach(function (x) { if (/休囚之凶格，凶亦无力/.test(x[1])) hit.push(x[1]); }); });
  assert.ok(hit.length >= 1, '找不到那一句');
  hit.forEach(function (b) { assert.ok(/由上句反推，纲要未明言/.test(b), b); });
});
t('典型转述已换回原句', function () {
  var all = [];
  OLD7.forEach(function (id) { allBases(id).forEach(function (x) { all.push(x[1]); }); });
  var txt = all.join('\n');
  assert.ok(txt.indexOf('年命生用神(脱泄)') < 0, '「年命生用神(脱泄)」应已换成纲要原句');
  assert.ok(/用神宫脱泄年命\(我生用神\) → 耗损、多不成/.test(txt));
  assert.ok(txt.indexOf('戊墓于乾六宫') < 0, '「戊墓于乾六宫」应已换成墓表原句');
  assert.ok(/乙丙戊→乾六/.test(txt));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
