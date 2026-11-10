/**
 * core/reading.js（AI 解读的共用编排）自检。node core/reading.test.js
 * 编排本身搬出前后是否一字不变，靠的是对整个 app 的提示词做前后比对（见 PR 说明）；
 * 这里只钉住对外的接口与「缺模块时安静退回」两件事，免得日后改坏了另一个 app。
 */
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var pass = 0, fail = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(function () { pass++; console.log('  ✓ ' + name); },
    function (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); });
}
var ROOT = path.join(__dirname, '..');
var RD = require('./reading.js');

t('对外接口齐全', function () {
  ['loadKnowledge', 'evidenceFor', 'riShiGanBlock', 'tailAnchor', 'ready'].forEach(function (k) {
    assert.strictEqual(typeof RD[k], 'function', k);
  });
  assert.ok(/只许按|纲要/.test(RD.AI_DISCIPLINE));
  assert.ok(/结构化证据（Evidence）使用规则/.test(RD.EVIDENCE_DISCIPLINE));
}).then(function () {
  return t('缺用神层或证据层时 loadKnowledge 返回 false，evidenceFor 给空证据包（调用方退回旧流程）', function () {
    return RD.loadKnowledge().then(function (ok) {
      assert.strictEqual(ok, false);
      return RD.evidenceFor({ pan: {}, q: '问', school: 'zhuanpan', prompt: { context: {} }, rc: {}, catMap: null,
        nianMing: '', fallbackCategory: '综合', ysGongs: [], wsBlock: 'W', yqBlock: 'Y' });
    }).then(function (r) {
      assert.strictEqual(r.evBlock, '');
      assert.strictEqual(r.sysExtra, '');
      assert.strictEqual(r.runOut.evidence, null);
    });
  });
}).then(function () {
  return t('空问句不产出收尾锚；有问句时以问句收束', function () {
    assert.strictEqual(RD.tailAnchor('', {}, null), '');
    assert.ok(/「能成吗」/.test(RD.tailAnchor('能成吗', { category: '综合' }, null)));
  });
}).then(function () {
  return t('app.js 不再自带这几段，只调共用模块（两处各留一份就会走样）', function () {
    var APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    assert.ok(!/async function loadKnowledge\(/.test(APP));
    assert.ok(!/const EVIDENCE_DISCIPLINE = \[/.test(APP));
    assert.ok(/RD\.evidenceFor\(/.test(APP));
  });
}).then(function () {
  return t('index.html 与 sw.js 都带上了 core/reading.js，且排在 app.js 之前', function () {
    var H = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    var S = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    assert.ok(H.indexOf('core/reading.js') > 0 && H.indexOf('core/reading.js') < H.indexOf('src="app.js"'));
    assert.ok(S.indexOf('./core/reading.js') > 0);
  });
}).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
