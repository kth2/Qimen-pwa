/**
 * Phase 24 两路 provider 的提示词一致性 回归测试（纯 Node，无框架）。
 * 运行：node core/provider-parity.test.js
 *
 * 起因：用户报「Gemini 与自定义端点解读不同，前者更贴题」，问是不是提示词的差别。
 *
 * 把两路请求体逐字比对之后，答案是**不是**：system 与 user 完全相同，
 * temperature 与 token 上限也相同。差别在模型本身，不在提示词。
 *
 * 但「现在相同」不等于「以后还相同」——两个 provider 各有一段拼请求体的代码，
 * 任何一边动一下都可能悄悄分家，而分家之后的表现差异会被误当成模型差异去查。
 * 故本文件把这件事钉死：**同一次调用，两路收到的 system/user 必须逐字一致，
 * 生成参数也必须同源。** 这是「对齐」这件事唯一守得住的形式。
 */
'use strict';
var path = require('path');
var assert = require('assert');

// llm.js 直接读 localStorage 与 fetch，先备好最小环境
var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
var LLM = require(path.join(__dirname, '..', 'llm.js'));

var pass = 0, fail = 0;
function t(name, fn) {
  // fn 同步抛出时不能让它逃出 Promise 链——否则整个测试进程被未捕获异常打断，
  // 后面的用例一个都跑不到（本文件第一版正是这么炸的）。
  var p;
  try { p = fn(); } catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); return Promise.resolve(); }
  return Promise.resolve(p).then(
    function () { pass++; console.log('  ✓ ' + name); },
    function (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
  );
}
/** 取 tailAnchor 的**文档注释 + 函数体**：结论写在注释里，只切函数体会漏掉。 */
function tailAnchorSrc(APP) {
  var fn = APP.indexOf('function tailAnchor(');
  var doc = APP.lastIndexOf('/**', fn);
  return APP.slice(doc >= 0 ? doc : fn, APP.indexOf('async function runAI()'));
}

/** 截获一次 chat 调用的请求体。返回 {url, body}。 */
function capture(cfg, system, user, reply) {
  var seen = null;
  var realFetch = global.fetch;
  global.fetch = function (url, opt) {
    seen = { url: String(url), headers: (opt && opt.headers) || {}, body: JSON.parse(opt.body) };
    return Promise.resolve(new Response('data: ' + JSON.stringify(reply) + '\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  };
  LLM.saveCfg(cfg);
  return LLM.chat(system, user, null, null)
    .then(function (text) { return { seen: seen, text: text }; })
    .finally(function () { global.fetch = realFetch; });
}

var SYS = '【系统】只按纲要断。\nE1. 甲\nE2. 乙';
// 刻意做长一点，且末尾像真实提示词那样以一堆词收尾——正是本期要处理的形状
var USR = '【占问】钥匙丢了能找到吗？\n' + '【盘面】'.repeat(200) + '\n· 关键词池：悦、口舌、毁折';
var G_REPLY = { candidates: [{ content: { parts: [{ text: '答' }] }, finishReason: 'STOP' }] };
var C_REPLY = { choices: [{ delta: { content: '答' }, finish_reason: 'stop' }] };
var GCFG = { provider: 'gemini', geminiKey: 'K', geminiModel: 'm-g', fallbackProvider: 'none' };
var CCFG = { provider: 'custom', customUrl: 'https://x.test/v1', customKey: 'K', customModel: 'm-c', fallbackProvider: 'none' };

function run() {
  var G, C;
  return capture(GCFG, SYS, USR, G_REPLY).then(function (r) { G = r.seen; })
    .then(function () { return capture(CCFG, SYS, USR, C_REPLY); }).then(function (r) { C = r.seen; })
    .then(function () {
      console.log('\n== 提示词：两路必须逐字相同 ==');
      var gSys = G.body.system_instruction.parts[0].text;
      var gUsr = G.body.contents[0].parts[0].text;
      var cSys = C.body.messages.filter(function (m) { return m.role === 'system'; })[0].content;
      var cUsr = C.body.messages.filter(function (m) { return m.role === 'user'; })[0].content;

      return t('system 逐字相同', function () {
        assert.strictEqual(gSys, cSys, 'system 分家了');
        assert.strictEqual(gSys, SYS, 'system 被中途改写');
      }).then(function () {
        return t('user 逐字相同', function () {
          assert.strictEqual(gUsr, cUsr, 'user 分家了');
          assert.strictEqual(gUsr, USR, 'user 被中途改写');
        });
      }).then(function () {
        return t('两路都真的带上了 system——不是一路带、一路丢', function () {
          assert.ok(gSys && gSys.length, 'Gemini 缺 system_instruction');
          assert.ok(cSys && cSys.length, '自定义端点缺 role:system 消息');
          assert.strictEqual(C.body.messages.length, 2, '自定义端点应恰有 system + user 两条');
          assert.strictEqual(C.body.messages[0].role, 'system', 'system 必须排在最前');
        });
      }).then(function () {
        return t('生成参数同源：温度与 token 上限一致', function () {
          assert.strictEqual(G.body.generationConfig.temperature, C.body.temperature, '温度分家');
          assert.strictEqual(G.body.generationConfig.maxOutputTokens, C.body.max_tokens, 'token 上限分家');
          assert.strictEqual(G.body.generationConfig.temperature, LLM.DEF.temperature);
          assert.strictEqual(C.body.max_tokens, LLM.DEF.maxTokens);
        });
      }).then(function () {
        return t('自定义端点必须开流式（不开则长回答必撞总超时）', function () {
          assert.strictEqual(C.body.stream, true);
        });
      }).then(function () {
        return t('用户改了温度/上限，两路一起改——设置只有一份', function () {
          var cfgG = Object.assign({}, GCFG, { temperature: 0.9, maxTokens: 2048 });
          var cfgC = Object.assign({}, CCFG, { temperature: 0.9, maxTokens: 2048 });
          return capture(cfgG, SYS, USR, G_REPLY).then(function (a) {
            return capture(cfgC, SYS, USR, C_REPLY).then(function (b) {
              assert.strictEqual(a.seen.body.generationConfig.temperature, 0.9);
              assert.strictEqual(b.seen.body.temperature, 0.9);
              assert.strictEqual(a.seen.body.generationConfig.maxOutputTokens, 2048);
              assert.strictEqual(b.seen.body.max_tokens, 2048);
            });
          });
        });
      });
    })
    .then(function () {
      console.log('\n== 截断：两路都要认得出「没写完」==');
      return t('Gemini 的 MAX_TOKENS 与自定义端点的 length，同样都要报未写完', function () {
        return capture(GCFG, SYS, USR,
          { candidates: [{ content: { parts: [{ text: '断在这' }] }, finishReason: 'MAX_TOKENS' }] })
          .then(function (a) {
            assert.ok(/未写完/.test(a.text), 'Gemini 截断未报出');
            return capture(CCFG, SYS, USR,
              { choices: [{ delta: { content: '断在这' }, finish_reason: 'length' }] });
          }).then(function (b) {
            assert.ok(/未写完/.test(b.text), '自定义端点截断未报出');
            assert.ok(/maxTokens/.test(b.text), '应指出是 token 上限所致');
          });
      });
    })
    .then(function () {
      console.log('\n== 收尾锚：把问题钉在整条消息的最末尾 ==');
      var fs = require('fs');
      var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
      return t('userMsg 以 tailAnchor 收尾，且 tailAnchor 排在最后一项', function () {
        var m = APP.match(/const userMsg = ([\s\S]{0,200}?);/);
        assert.ok(m, '找不到 userMsg 的拼接');
        assert.ok(/tailAnchor\(q, rc, catMap\)\s*;?\s*$/.test(m[1].trim()),
          'tailAnchor 必须是最后一项，否则近因效应无从谈起：' + m[1].trim());
      }).then(function () {
        return t('收尾锚重述问题、占类与三条硬约束', function () {
          var seg = tailAnchorSrc(APP);
          assert.ok(/回到你要回答的问题/.test(seg), '缺问题重述');
          assert.ok(/占类/.test(seg), '缺占类重述');
          assert.ok(/用神以上方【用神落宫】所列为准/.test(seg), '缺用神约束');
          assert.ok(/不得自造日辰/.test(seg), '缺应期约束');
          assert.ok(/问句里有几问就答几问/.test(seg), '缺「逐问作答」');
        });
      }).then(function () {
        return t('空问句不产出收尾锚（不给模型一段空壳）', function () {
          var seg = tailAnchorSrc(APP);
          assert.ok(/if \(!q\) return '';/.test(seg), '空问句须直接返回空串');
        });
      }).then(function () {
        return t('注释里写明「实测两路提示词相同」，免得日后又往提示词上找原因', function () {
          var seg = tailAnchorSrc(APP);
          assert.ok(/不是提示词的差别/.test(seg), '须写明结论');
          assert.ok(/13538|14214/.test(seg), '须留下实测的字数，便于日后复核');
        });
      });
    })
    .then(function () {
      console.log('\n' + pass + ' passed, ' + fail + ' failed');
      process.exit(fail ? 1 : 0);
    });
}
run();
