/**
 * Phase 27 按模型比较应验率 回归测试（纯 Node，无框架）。
 * 运行：node core/bymodel.test.js
 *
 * 用户问「可不可以加个统计看 Gemini 还是 Agnes 的回答应验得多」。
 * 做这件事有个前提，也是最容易做错的一处：**归属必须是实际作答的那一路**。
 * 备用链会接管——Gemini 过载改由自定义端点答话时，LLM.info() 仍报 Gemini，
 * 拿它记账就会把这条记成 Gemini。记错的统计比没有统计更坏。
 *
 * 另外两条分寸，本文件同样钉死：
 *   ① 旧案例没有这一栏，一律归「未记录」且不参与比较——摊进任何一家都是编的；
 *   ② 这不是对照实验（两家拿到的盘与问题不同、样本非随机分配），
 *      故只答「用某一路的那些盘对了几成」，不答「甲比乙强」。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); }
};
var LLM = require(path.join(__dirname, '..', 'llm.js'));
var EV = require(path.join(__dirname, 'evaluate.js'));

var pass = 0, fail = 0;
function t(name, fn) {
  var p;
  try { p = fn(); } catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); return Promise.resolve(); }
  return Promise.resolve(p).then(
    function () { pass++; console.log('  ✓ ' + name); },
    function (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
  );
}
function sse(obj) {
  return new Response('data: ' + JSON.stringify(obj) + '\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
var G_OK = { candidates: [{ content: { parts: [{ text: '答' }] }, finishReason: 'STOP' }] };
var C_OK = { choices: [{ delta: { content: '答' }, finish_reason: 'stop' }] };

function mk(i, label, provider, outcome, fellBack) {
  return {
    id: 'c' + i, createdAt: '2026-09-16T10:00:00Z', question: 'q' + i, domain: 'general', answer: '…',
    meta: label ? { provider: provider, model: label.split('/')[1], label: label, fellBack: !!fellBack } : undefined,
    feedback: { outcome: outcome, actual: '实况文本够长够长够长够长够长够长', recordedAt: '2026-09-16T11:00:00Z' }
  };
}
function book(rows) { return { cases: rows }; }

function run() {
  console.log('\n== 归属：必须是实际作答的那一路 ==');
  return t('正常作答：lastUsed 记下 provider/model，fellBack=false', function () {
    LLM.saveCfg({ provider: 'gemini', geminiKey: 'K', geminiModel: 'gemini-flash-latest', fallbackProvider: 'none' });
    global.fetch = function () { return Promise.resolve(sse(G_OK)); };
    return LLM.chat('s', 'u').then(function () {
      var u = LLM.lastUsed();
      assert.strictEqual(u.provider, 'gemini');
      assert.strictEqual(u.model, 'gemini-flash-latest');
      assert.strictEqual(u.fellBack, false);
      assert.strictEqual(u.configured, 'gemini');
    });
  }).then(function () {
    return t('备用接管：记的是接管者，不是配置里选的那一路（info() 会记反）', function () {
      LLM.saveCfg({
        provider: 'gemini', geminiKey: 'K', geminiModel: 'g-model', maxRetries: 1,
        fallbackProvider: 'custom', customUrl: 'https://x.test/v1', customKey: 'K', customModel: 'agnes-2.5'
      });
      global.fetch = function (u) {
        return Promise.resolve(String(u).indexOf('generativelanguage') >= 0
          ? new Response('busy', { status: 503 }) : sse(C_OK));
      };
      return LLM.chat('s', 'u').then(function () {
        var u = LLM.lastUsed();
        assert.strictEqual(u.provider, 'custom', '应归给接管者');
        assert.strictEqual(u.model, 'agnes-2.5');
        assert.strictEqual(u.fellBack, true, '须标出这是接管的');
        assert.strictEqual(u.configured, 'gemini', '配置值也留着，便于日后分辨');
        assert.strictEqual(LLM.info().provider, 'gemini', '前提：info() 确实报的是配置值');
        assert.notStrictEqual(LLM.info().provider, u.provider, '两者确实会不同——这正是不能用 info() 的原因');
      });
    });
  }).then(function () {
    return t('调用失败时不留下 lastUsed（不许把失败记成某家答过）', function () {
      LLM.saveCfg({ provider: 'gemini', geminiKey: 'K', geminiModel: 'm', fallbackProvider: 'none', maxRetries: 1 });
      global.fetch = function () { return Promise.resolve(new Response('nope', { status: 500 })); };
      return LLM.chat('s', 'u').then(
        function () { throw new Error('本该抛错'); },
        function () { assert.strictEqual(LLM.lastUsed(), null, '失败后 lastUsed 应为 null'); });
    });
  }).then(function () {
    console.log('\n== 统计：够格才给率，旧案例不参与 ==');
    return t('两家各自成行，加权分与完全应验率算得对', function () {
      var rows = [];
      var i = 0;
      ['happened', 'happened', 'happened', 'happened', 'happened', 'happened',
       'partial', 'partial', 'partial', 'not_happened', 'not_happened', 'opposite']
        .forEach(function (o) { rows.push(mk(i++, 'Gemini/gemini-flash-latest', 'gemini', o)); });
      ['happened', 'happened', 'partial', 'partial', 'partial',
       'not_happened', 'not_happened', 'not_happened', 'opposite', 'opposite']
        .forEach(function (o, k) { rows.push(mk(i++, '自定义/agnes-2.5', 'custom', o, k < 2)); });
      var bm = EV.evaluate(book(rows)).byModel;
      var g = bm.rows.filter(function (r) { return /Gemini/.test(r.label); })[0];
      var a = bm.rows.filter(function (r) { return /agnes/.test(r.label); })[0];
      assert.strictEqual(g.n, 12); assert.strictEqual(a.n, 10);
      assert.strictEqual(g.exactRate, 50, 'Gemini 6/12');
      assert.strictEqual(a.exactRate, 20, 'agnes 2/10');
      // 加权：中 1、部分 0.5、不中 0 → Gemini (6+1.5)/12=0.625，agnes (2+1.5)/10=0.35
      assert.strictEqual(g.weightedScore, 0.625);
      assert.strictEqual(a.weightedScore, 0.35);
      assert.strictEqual(a.fellBack, 2, '接管的例数须单独留着');
      assert.strictEqual(bm.comparable, 2);
      assert.strictEqual(bm.spread, 0.275);
    });
  }).then(function () {
    return t('样本不足者不给率，照实写「n/门槛」', function () {
      var rows = [mk(1, 'Ollama/qwen', 'local', 'happened'),
                  mk(2, 'Ollama/qwen', 'local', 'partial'),
                  mk(3, 'Ollama/qwen', 'local', 'not_happened')];
      var bm = EV.evaluate(book(rows)).byModel;
      assert.strictEqual(bm.rows[0].enough, false);
      assert.strictEqual(bm.rows[0].exactRate, null, '不足门槛不得给率');
      assert.ok(/样本不足 3\/8/.test(bm.rows[0].display));
      assert.strictEqual(bm.comparable, 0);
      assert.strictEqual(bm.spread, null, '不足两家不得给差距');
    });
  }).then(function () {
    return t('旧案例（无 meta）归入 unlabeled，且不摊进任何一家', function () {
      var rows = [mk(1, 'Gemini/g', 'gemini', 'happened'), mk(2, null, null, 'happened'), mk(3, null, null, 'opposite')];
      var bm = EV.evaluate(book(rows)).byModel;
      assert.strictEqual(bm.unlabeled, 2);
      assert.strictEqual(bm.rows.length, 1, '未记录的不得自成一家、也不得并进别家');
      assert.strictEqual(bm.rows[0].n, 1);
      assert.ok(/不参与比较/.test(bm._note));
    });
  }).then(function () {
    return t('只有一家够格时，报告明说「还比不出来」而不是摆个单行表', function () {
      var rows = [];
      for (var i = 0; i < 9; i++) rows.push(mk(i, 'Gemini/g', 'gemini', 'happened'));
      var txt = EV.toReport(EV.evaluate(book(rows)));
      assert.ok(/目前还比不出来/.test(txt), txt.slice(txt.indexOf('按模型'), txt.indexOf('按模型') + 300));
      assert.ok(/两家都够格才谈得上比较/.test(txt));
    });
  }).then(function () {
    return t('一条带模型的案例都没有时，报告照实说、不报空表', function () {
      var txt = EV.toReport(EV.evaluate(book([mk(1, null, null, 'happened')])));
      assert.ok(/尚无带模型标记的案例/.test(txt));
    });
  }).then(function () {
    console.log('\n== 分寸：不许被读成「甲比乙强」 ==');
    return t('每次出表都附「这不是对照实验」', function () {
      var rows = [];
      for (var i = 0; i < 9; i++) rows.push(mk(i, 'Gemini/g', 'gemini', 'happened'));
      for (var j = 9; j < 18; j++) rows.push(mk(j, '自定义/agnes', 'custom', 'partial'));
      var rep = EV.evaluate(book(rows));
      assert.ok(/不是对照实验/.test(rep.byModel._caveat));
      assert.ok(/不回答「甲比乙强」/.test(rep.byModel._caveat));
      assert.ok(/不是对照实验/.test(EV.toReport(rep)), '报告正文里也要出现，不能只留在数据里');
    });
  }).then(function () {
    return t('notMeasured 里单列一条「模型之间的优劣」，并给出真要比该怎么做', function () {
      var rep = EV.evaluate(book([mk(1, 'Gemini/g', 'gemini', 'happened')]));
      var row = rep.notMeasured.filter(function (x) { return /模型之间的优劣/.test(x.metric); })[0];
      assert.ok(row, '未列入算不了的指标');
      assert.ok(/同一批盘两家各答一遍/.test(row.why), '须写明真要比该怎么做');
    });
  }).then(function () {
    console.log('\n== 接线守卫 ==');
    var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    return t('案例本记的是 LLM.lastUsed()，不是 LLM.info()', function () {
      var seg = APP.slice(APP.indexOf('_lastReading = {'), APP.indexOf('_lastReading = {') + 2200);
      assert.ok(/meta:/.test(seg), '_lastReading 未带 meta');
      assert.ok(/LLM\.lastUsed\(\)/.test(seg), '未取实际作答者');
      assert.ok(/fellBack/.test(seg), '未留下「是否备用接管」');
    });
  }).then(function () {
    var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    return t('统计面板不另算一套口径，直接取评估器的 byModel', function () {
      assert.ok(/window\.Evaluate\.evaluate\(rows\)\s*\|\|\s*\{\}\)\.byModel/.test(APP.replace(/\s+/g, ' ')) ||
        /\)\.byModel/.test(APP), '界面应复用评估器的 byModel');
      assert.ok(/目前还比不出来/.test(APP), '界面也要有「比不出来」的说法');
      assert.ok(/不参与比较/.test(APP), '界面也要说明旧案例不参与');
    });
  }).then(function () {
    return t('casebook 原样透传 meta（不丢字段）', function () {
      var CB = require(path.join(__dirname, 'casebook.js'));
      var rec = CB.makeCase({
        question: 'q', domain: 'general', chart: { siZhu: { day: '乙亥', time: '辛巳' } },
        meta: { provider: 'custom', model: 'agnes-2.5', label: '自定义/agnes-2.5', fellBack: true }
      });
      assert.strictEqual(rec.meta.label, '自定义/agnes-2.5');
      assert.strictEqual(rec.meta.fellBack, true);
    });
  }).then(function () {
    var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    return t('界面里不留 Markdown 星号（统计面板走 innerHTML，** 会原样显示）', function () {
      var seg = APP.slice(APP.indexOf('const mdHtml'), APP.indexOf('const psHtml'));
      assert.ok(!/\*\*/.test(seg.replace(/replace\(\/\\\*\\\*\/g[^)]*\)/g, '')),
        '「按模型」一节里仍有 ** ，界面上会显示成星号');
      assert.ok(/_caveat\)\.replace\(/.test(APP), '取自评估器的 _caveat 里带 **，界面上须剥掉');
    });
  }).then(function () {
    var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    return t('案例列表容得下字段不齐的行（案例本支持导入，坏一行不该白屏整栏）', function () {
      // 造这批假案例时炸出来的：没有 chart / fired 的行会让整栏渲染中断。
      // 真实存下的案例字段都齐，但导入来的不一定齐——那正是它最该扛住的场合。
      // 「有没有设防」不能靠「有没有出现这个串」来判——(r.chartRef && r.chartRef.siZhu)
      // 这种正确写法里本就含着那个串。改为：**每一处**取用都必须紧跟在同名的存在性判断之后。
      function allGuarded(prop) {
        var re = new RegExp('(\\w+)\\.' + prop.replace('.', '\\.'), 'g'), m, bad = [];
        while ((m = re.exec(APP))) {
          var before = APP.slice(Math.max(0, m.index - 60), m.index);
          if (!new RegExp(m[1] + '\\.' + prop.split('.')[0] + '\\s*&&\\s*$').test(before)) {
            bad.push(APP.slice(Math.max(0, m.index - 40), m.index + 30).replace(/\n/g, ' '));
          }
        }
        return bad;
      }
      ['chartRef.siZhu', 'fired.rules', 'fired.anchors'].forEach(function (pr) {
        var bad = allGuarded(pr);
        assert.deepStrictEqual(bad, [], pr + ' 有未设防的取用：' + bad.join(' ｜ '));
      });
    });
  }).then(function () {
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  });
}
run();
