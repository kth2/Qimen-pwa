/**
 * Phase 25 极简 Markdown 渲染 回归测试（纯 Node，无框架）。
 * 运行：node core/mdlite.test.js
 *
 * 起因：用户报「AI 给的答案有时是表格，但框里排不成表」。答案框一直是
 * textContent + white-space:pre-wrap，Markdown 表格于是原样显示成一堆竖线。
 *
 * 本模块是**全 app 第一处 innerHTML**，而那段文本来自模型、属不可信输入。
 * 故本文件里分量最重的一节是安全：**先转义、再生成**，任何外来标签都不许放行。
 * 一条都不许放松——渲染得好看是次要的，放进去一个 <script> 是另一回事。
 */
'use strict';
var path = require('path');
var assert = require('assert');
var fs = require('fs');
var M = require(path.join(__dirname, 'mdlite.js'));

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
/** 渲染结果里，除本模块自产的标签外，不得出现任何别的标签。 */
var ALLOWED = ['div', 'p', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'ul', 'ol', 'li', 'strong', 'em', 'del', 'code', 'pre', 'blockquote'];
function tagsIn(html) {
  var out = [], m, re = /<\/?([a-zA-Z][\w-]*)/g;
  while ((m = re.exec(html))) out.push(m[1].toLowerCase());
  return out;
}

console.log('\n== 安全：先转义、再生成 ==');
t('script / img onerror / svg onload 一律只成字面量', function () {
  ['<script>alert(1)</script>',
   '<img src=x onerror=alert(1)>',
   '<svg onload=alert(1)>',
   '<iframe src="javascript:alert(1)">',
   '<a href="javascript:alert(1)">点我</a>',
   '<style>*{display:none}</style>'].forEach(function (bad) {
    var h = M.render(bad);
    tagsIn(h).forEach(function (tg) {
      assert.ok(ALLOWED.indexOf(tg) >= 0, bad + ' 漏出了标签 <' + tg + '>');
    });
    assert.ok(h.indexOf('&lt;') >= 0, bad + ' 未被转义');
  });
});
t('危险内容藏在表格单元格、标题、列表、引用里也照样转义', function () {
  var srcs = [
    '| a | b |\n|---|---|\n| <img src=x onerror=alert(1)> | ok |',
    '### <script>alert(1)</script>',
    '- <script>alert(1)</script>',
    '> <script>alert(1)</script>',
    '```\n<script>alert(1)</script>\n```'
  ];
  srcs.forEach(function (s) {
    var h = M.render(s);
    assert.ok(h.indexOf('<script') < 0, '漏了：' + s);
    assert.ok(h.indexOf('onerror=') < 0 || h.indexOf('&lt;img') >= 0, '属性漏了：' + s);
    tagsIn(h).forEach(function (tg) { assert.ok(ALLOWED.indexOf(tg) >= 0, '<' + tg + '> 不该出现'); });
  });
});
t('不产出 href/src/on* 一类可被利用的属性——本模块只出 style:text-align', function () {
  var h = M.render('| a |\n|:-:|\n| x |\n\n[链接](javascript:alert(1))\n\n![图](x)');
  assert.ok(!/\s(href|src|on\w+)\s*=/i.test(h), '出现了可被利用的属性：' + h);
  var attrs = (h.match(/\s[a-zA-Z-]+\s*=\s*"[^"]*"/g) || []);
  attrs.forEach(function (a) {
    assert.ok(/^\s(class|style)=/.test(a), '只许 class 与 style，实得 ' + a);
    if (/^\sstyle=/.test(a)) assert.ok(/^\sstyle="text-align:(left|right|center)"$/.test(a), 'style 只许对齐：' + a);
  });
});
t('& < > " \' 五个字符都转义，且 & 最先换（否则实体会被二次转义）', function () {
  assert.strictEqual(M._esc('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.strictEqual(M._esc('a & b'), 'a &amp; b');
  assert.ok(M.render('AT&T 与 <b>').indexOf('&amp;T') >= 0);
});
t('随机塞 200 段带标签的乱文，都不得漏出标签', function () {
  var bits = ['<script>', '</script>', '<img', 'onerror=1', '"', "'", '&', '|---|', '**x**',
    '# h', '- li', '> q', '```', '<svg/onload=1>', '<!--', '-->', '<a href=x>'];
  for (var i = 0; i < 200; i++) {
    var s = '';
    for (var j = 0; j < 8; j++) s += bits[(i * 7 + j * 3) % bits.length] + (j % 3 ? ' ' : '\n');
    var h = M.render(s);
    tagsIn(h).forEach(function (tg) { assert.ok(ALLOWED.indexOf(tg) >= 0, '第 ' + i + ' 段漏出 <' + tg + '>'); });
  }
});

console.log('\n== 表格：本次要修的正主 ==');
t('竖线表渲染成 table，表头与数据分列', function () {
  var h = M.render('| 宫 | 星 |\n|---|---|\n| 4 | 天英 |\n| 9 | 天芮 |');
  assert.ok(/<table class="md-table">/.test(h));
  assert.ok(/<th>宫<\/th><th>星<\/th>/.test(h));
  assert.strictEqual((h.match(/<tr>/g) || []).length, 3, '表头 1 行 + 数据 2 行');
  assert.ok(/<td>天英<\/td>/.test(h));
});
t('对齐行认得出左/中/右', function () {
  var h = M.render('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
  assert.ok(/text-align:left/.test(h) && /text-align:center/.test(h) && /text-align:right/.test(h));
});
t('首尾竖线可有可无', function () {
  var a = M.render('| a | b |\n|---|---|\n| 1 | 2 |');
  var b = M.render('a | b\n---|---\n1 | 2');
  assert.ok(/<table/.test(a) && /<table/.test(b), '无首尾竖线的表也要认');
});
t('列数不齐：少了补空、多了并进末格，都不丢内容也不塌版', function () {
  var h = M.render('| a | b | c |\n|---|---|---|\n| 1 | 2 |\n| 1 | 2 | 3 | 4 |');
  var rows = h.match(/<tr>(?:(?!<\/tr>).)*<\/tr>/g);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual((rows[1].match(/<td/g) || []).length, 3, '少的一行须补到 3 格');
  assert.strictEqual((rows[2].match(/<td/g) || []).length, 3, '多的一行也是 3 格');
  assert.ok(/3 4/.test(rows[2]), '多出来的那格不许凭空消失');
});
t('单元格里的粗体等行内标记照常生效', function () {
  var h = M.render('| a |\n|---|\n| **重** |');
  assert.ok(/<td><strong>重<\/strong><\/td>/.test(h));
});
t('只有一行竖线、没有对齐行的，不当表格（那多半是正文里提到了竖线）', function () {
  var h = M.render('日干 | 时干 两宫相较');
  assert.ok(!/<table/.test(h), '误判成表格了');
});
t('表格外面包了可横向滚动的壳（窄屏不许把整页撑宽）', function () {
  assert.ok(/<div class="md-tablewrap">/.test(M.render('|a|\n|---|\n|1|')));
  var css = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/\.md-tablewrap\s*\{[^}]*overflow-x:\s*auto/.test(css), '壳须能横向滚');
});

console.log('\n== 其余构件 ==');
t('标题一到六级', function () {
  for (var i = 1; i <= 6; i++) {
    var h = M.render(new Array(i + 1).join('#') + ' 标题');
    assert.ok(new RegExp('md-h' + i).test(h), i + ' 级标题');
  }
});
t('有序与无序列表，且同层换了形态就另起一张单子', function () {
  var h = M.render('- 甲\n- 乙\n1. 一\n2. 二');
  assert.ok(/<ul class="md-list"><li>甲<\/li><li>乙<\/li><\/ul>/.test(h), 'ul 不对：' + h);
  assert.ok(/<ol class="md-list"><li>一<\/li><li>二<\/li><\/ol>/.test(h), '有序列表被并进 ul 了：' + h);
});
t('缩进的子项嵌进去，不是平铺', function () {
  var h = M.render('- 甲\n  - 子\n- 乙');
  assert.ok(/<ul class="md-list"><li>甲<ul class="md-list"><li>子<\/li><\/ul><\/li><li>乙/.test(h), h);
});
t('行内：粗体/斜体/删除线/代码', function () {
  var h = M.render('**粗** *斜* ~~删~~ `码`');
  assert.ok(/<strong>粗<\/strong>/.test(h) && /<em>斜<\/em>/.test(h) &&
            /<del>删<\/del>/.test(h) && /<code>码<\/code>/.test(h), h);
});
t('行内代码里的星号不当标记（免得把代码改花）', function () {
  var h = M.render('`a*b*c`');
  assert.ok(/<code>a\*b\*c<\/code>/.test(h), h);
});
t('分隔线与引用', function () {
  assert.ok(/<hr class="md-hr">/.test(M.render('---')));
  assert.ok(/<blockquote class="md-quote">话<\/blockquote>/.test(M.render('> 话')));
});
t('围栏代码块整块原样（内部不再解析标记）', function () {
  var h = M.render('```\n# 不是标题\n| 不是 | 表 |\n```');
  assert.ok(/<pre class="md-pre"><code># 不是标题/.test(h), h);
  assert.ok(!/md-h/.test(h) && !/<table/.test(h), '代码块里的东西被当成标记解析了');
});
t('没有收尾围栏也照样收场，不把后文全吞进代码块', function () {
  var h = M.render('```\n代码\n\n后面还有正文');
  assert.ok(/<pre/.test(h));
  assert.ok(!/<script/.test(h));
});
t('段落内换行保留为 <br>（断语常靠换行分句）', function () {
  var h = M.render('第一行\n第二行');
  assert.ok(/<p class="md-p">第一行<br>第二行<\/p>/.test(h), h);
});

console.log('\n== looksMarkdown：没标记就别折腾 ==');
t('纯文本不认作 Markdown', function () {
  assert.ok(!M.looksMarkdown('今天能找到钥匙，方位在东南。'));
  assert.ok(!M.looksMarkdown(''));
  assert.ok(!M.looksMarkdown(null));
});
t('有表格/标题/列表/粗体/代码块的，都认', function () {
  assert.ok(M.looksMarkdown('| a |\n|---|\n| 1 |'));
  assert.ok(M.looksMarkdown('### 结论'));
  assert.ok(M.looksMarkdown('- 一条'));
  assert.ok(M.looksMarkdown('1. 一条'));
  assert.ok(M.looksMarkdown('**粗**'));
  assert.ok(M.looksMarkdown('```\nx\n```'));
});

console.log('\n== 防御与确定性 ==');
t('空/null/怪数据不抛异常', function () {
  [null, undefined, '', '\n\n\n', '|||', '```', '#', '- ', '>'].forEach(function (x) {
    assert.doesNotThrow(function () { M.render(x); }, JSON.stringify(x));
  });
});
t('任何输入都必须在有限步内收场——不许原地打转把标签页卡死', function () {
  // 实测炸过一次：「``` --> </script>」既不开围栏（当时开栏要求信息串是单个词），
  // 也不被段落分支接受（段落遇 ``` 就停），于是 i 停在原地，out.push 到数组溢出。
  // 这不是排版瑕疵，是浏览器挂起，故单列一条守着。
  ['``` --> </script>', '```js 还有别的字', '``` ```', '|', '||', '|-|-|',
   '> ', '#', '#######不是标题', '- \n- \n- ', '<script>\nonerror=1 & # h\n``` --> </script>\n" '
  ].forEach(function (x) {
    var done = false;
    var timer = setTimeout(function () {}, 0); clearTimeout(timer);
    assert.doesNotThrow(function () { M.render(x); done = true; }, JSON.stringify(x));
    assert.ok(done, JSON.stringify(x) + ' 没能收场');
  });
});
t('单列表格也认得出（初版的对齐行正则要求至少两列，一列的表整张漏掉）', function () {
  var h = M.render('| 项 |\n|---|\n| 甲 |');
  assert.ok(/<table class="md-table">/.test(h), h);
  assert.ok(/<th>项<\/th>/.test(h) && /<td>甲<\/td>/.test(h));
});
t('不含竖线的 --- 仍是分隔线，不得被当成对齐行把前后两段吞成表格', function () {
  var h = M.render('段落\n\n---\n\n另一段');
  assert.ok(/<hr class="md-hr">/.test(h) && !/<table/.test(h), h);
});
t('同一段文本两次渲染逐字相同', function () {
  var s = '### 甲\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- 乙\n  - 丙\n\n**粗**';
  assert.strictEqual(M.render(s), M.render(s));
});
t('标签闭合齐整（简单配对检查）', function () {
  var h = M.render('### 甲\n\n| a |\n|---|\n| 1 |\n\n- 乙\n  - 丙\n\n> 引\n\n```\nx\n```');
  ['div', 'table', 'ul', 'li', 'blockquote', 'pre', 'code', 'p'].forEach(function (tg) {
    var open = (h.match(new RegExp('<' + tg + '(?=[\\s>])', 'g')) || []).length;
    var close = (h.match(new RegExp('</' + tg + '>', 'g')) || []).length;
    assert.strictEqual(open, close, tg + ' 未闭合：开 ' + open + ' 闭 ' + close);
  });
});

console.log('\n== app.js 接线守卫 ==');
var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
t('流式期间不渲染——写到一半的表格不该被画成怪样', function () {
  var seg = APP.slice(APP.indexOf('function streamAnswer('), APP.indexOf('async function runAI()'));
  assert.ok(/textContent = text/.test(seg), '流式须走 textContent');
  assert.ok(!/innerHTML/.test(seg), '流式期间不得渲染');
  assert.ok(/streamAnswer\(head \+ \(full \|\| ''\)\)/.test(APP), 'onToken 须走 streamAnswer');
});
t('收尾只渲染一次，且渲染的是清理后的全文', function () {
  assert.ok(/_answerRaw = head \+ \(\(!streamed \|\| !answer\)/.test(APP), '收尾未取完整文本');
  assert.ok(/paintAnswer\(\);/.test(APP), '收尾未调用 paintAnswer');
});
t('innerHTML 只喂 MdLite 的产物，不喂别的', function () {
  var hits = APP.match(/\.innerHTML\s*=\s*([^\n;]+)/g) || [];
  hits.forEach(function (h) {
    if (/aiAnswer/.test(h) || /box\.innerHTML/.test(h)) {
      assert.ok(/MD\.render\(/.test(h), '答案框的 innerHTML 必须来自 MD.render：' + h);
    }
  });
  assert.ok(/box\.innerHTML = MD\.render\(_answerRaw\)/.test(APP), '未找到预期的渲染调用');
});
t('原文随时可看，且存进案例本的是原文不是 HTML', function () {
  assert.ok(/aiRawToggle/.test(APP), '缺「查看原文」开关');
  assert.ok(/_answerShowRaw = !_answerShowRaw/.test(APP), '开关未切换');
  // _lastReading.answer 取的仍是 LLM 返回的 answer，与渲染无关
  assert.ok(/answer: String\(answer \|\| ''\)\.slice\(0, 8000\)/.test(APP),
    '案例本存的必须是模型原文');
});
t('MdLite 缺席时退回纯文本，不崩', function () {
  assert.ok(/const MD = window\.MdLite;/.test(APP));
  var seg = APP.slice(APP.indexOf('function paintAnswer('), APP.indexOf('function streamAnswer('));
  assert.ok(/!!\(MD && MD\.render\)/.test(seg), '未判断 MdLite 是否在场');
  assert.ok(/box\.textContent = _answerRaw/.test(seg), '缺退回纯文本的分支');
});
t('index.html 与 sw.js 都带上了 mdlite', function () {
  var idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.ok(/core\/mdlite\.js/.test(idx) && /core\/mdlite\.js/.test(sw));
  assert.ok(/#aiAnswer\.md-on \{ white-space: normal/.test(idx),
    '渲染模式下须关掉 pre-wrap，否则标签之间的换行会被画出来');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
