/**
 * 奇门·极简 Markdown 渲染(MdLite) —— 纯函数、无副作用、无依赖。【Phase 25】
 *
 * 解决的问题：AI 的解读本来就是 Markdown（骨架里要求「### ① 结论」「- 逐条」，
 * 遇到逐宫对照、应期候选、比分这类内容它还会出表格），而答案框一直是
 * `textContent` + `white-space: pre-wrap` —— 于是表格原样显示成一堆竖线：
 *
 *     | 宫 | 星 | 门 |
 *     |---|---|---|
 *     | 4 | 天英 | 惊门 |
 *
 * 只把它渲染出来即可，**不必反过来禁止模型用表格**：逐宫对照这类内容，表格本就是
 * 更该用的形式，改成条列反而更难看。
 *
 * **安全**：这段文本来自模型，一律当不可信处理。做法是**先把整段转义，再插入本模块
 * 自己的标签**——转义在前、生成在后，故模型写出 <script> 也只会变成字面量。
 * 本模块**从不原样放行任何外来标签**，也不产出 href/src 一类可被利用的属性。
 *
 * 支持的构件只覆盖模型实际会写的那些，不做通用 Markdown：
 *   标题 # ~ ######｜表格（GFM 竖线表，含对齐行）｜有序/无序列表（含缩进嵌套）
 *   引用 >｜分隔线 ---｜围栏代码块 ```｜行内 **粗** *斜* `码` ~~删~~
 * 不支持链接与图片——本用途不需要，且那是最容易出安全岔子的一处。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MdLite = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  /** 一切的第一步。& 必须最先换，否则会把后面换出来的实体再转义一遍。 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 行内标记。入参**必须已转义**——本函数只认标记符，不做转义。 */
  function inline(t) {
    return String(t == null ? '' : t)
      // 先取行内代码：代码里的 * _ ~ 不该再被当成标记
      .replace(/`([^`]+)`/g, function (_, c) { return '<code>' + c + '</code>'; })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      // 单星/下划线的斜体：两侧不得贴着字母数字，免得把 a_b_c 这类误伤
      .replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1<em>$2</em>')
      .replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>');
  }

  function isHr(l) { return /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l); }
  /**
   * 表头下的对齐行。
   * 必须**含竖线**——不含竖线的 `---` 是分隔线，不是对齐行；少了这一条，
   * 「一段文字 + --- + 另一段」会被整个误当成表格。
   * 又必须允许**单列**（`|---|`）：初版的正则要求至少两列，于是一列的表
   * 整张认不出来，原样显示成竖线。
   */
  function isTableSep(l) {
    var t = String(l).trim();
    if (t.indexOf('|') < 0) return false;
    if (!/^[|\-: \t]+$/.test(t)) return false;
    if (t.indexOf('-') < 0) return false;
    var cs = cells(t);
    return cs.length > 0 && cs.every(function (c) { return /^:?-+:?$/.test(c); });
  }
  /** 竖线表的一行 → 单元格数组。首尾的竖线是可有可无的。 */
  function cells(l) {
    var s = l.trim().replace(/^\|/, '').replace(/\|$/, '');
    return s.split('|').map(function (x) { return x.trim(); });
  }
  function aligns(sep) {
    return cells(sep).map(function (c) {
      var l = c.charAt(0) === ':', r = c.charAt(c.length - 1) === ':';
      return (l && r) ? 'center' : r ? 'right' : l ? 'left' : '';
    });
  }
  function listMark(l) {
    var m = /^(\s*)([-*+]|\d{1,9}[.)、])\s+(.*)$/.exec(l);
    if (!m) return null;
    return { indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), text: m[3] };
  }

  /**
   * 渲染。
   * @param {string} md 模型给的原文（不可信）
   * @returns {string} 安全的 HTML 片段
   */
  function render(md) {
    var src = String(md == null ? '' : md).replace(/\r\n?/g, '\n');
    var lines = src.split('\n');
    var out = [], i = 0;

    // 列表用一个「层级栈」做嵌套：缩进比栈顶深就开新层，浅就收层。
    var stack = [];
    function closeLists(toIndent) {
      while (stack.length && stack[stack.length - 1].indent >= toIndent) {
        out.push('</li></' + (stack.pop().ordered ? 'ol' : 'ul') + '>');
      }
    }
    function closeAllLists() { closeLists(-1); }

    while (i < lines.length) {
      var line = lines[i];

      // ① 围栏代码块：整块原样（已转义）吐出，内部不再解析任何标记
      // 开栏的信息串允许是任意文字（CommonMark 亦然）。初版要求它只能是一个不含空格的
      // 词，于是「``` --> </script>」这类行**既不开栏、也不被段落分支接受**，
      // i 永远停在原地——浏览器整个卡死。这不是排版瑕疵，是挂起。
      var fence = /^\s*```+(.*)$/.exec(line);
      if (fence) {
        closeAllLists();
        var buf = [];
        i++;
        while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;   // 吃掉收尾的围栏；没有收尾也照样收场，不把后文全吞进代码块
        out.push('<pre class="md-pre"><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // ② 表格：本行含竖线，且下一行是对齐行
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        closeAllLists();
        var head = cells(line), al = aligns(lines[i + 1]);
        i += 2;
        var body = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim() !== '') {
          body.push(cells(lines[i])); i++;
        }
        var th = head.map(function (c, k) {
          return '<th' + (al[k] ? ' style="text-align:' + al[k] + '"' : '') + '>' + inline(esc(c)) + '</th>';
        }).join('');
        var tr = body.map(function (row) {
          // 列数对不齐是常事（模型少写一个竖线）：按表头列数补齐，不丢内容也不塌版
          var r = [];
          for (var k = 0; k < head.length; k++) {
            r.push('<td' + (al[k] ? ' style="text-align:' + al[k] + '"' : '') + '>' +
              inline(esc(row[k] == null ? '' : row[k])) + '</td>');
          }
          // 多出来的列并进最后一格，宁可挤一点也不让它凭空消失
          if (row.length > head.length) {
            var extra = row.slice(head.length).map(function (x) { return inline(esc(x)); }).join(' ');
            r[r.length - 1] = r[r.length - 1].replace(/<\/td>$/, ' ' + extra + '</td>');
          }
          return '<tr>' + r.join('') + '</tr>';
        }).join('');
        out.push('<div class="md-tablewrap"><table class="md-table"><thead><tr>' + th +
          '</tr></thead>' + (tr ? '<tbody>' + tr + '</tbody>' : '') + '</table></div>');
        continue;
      }

      // ③ 分隔线
      if (isHr(line)) { closeAllLists(); out.push('<hr class="md-hr">'); i++; continue; }

      // ④ 标题
      var h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) {
        closeAllLists();
        var lv = h[1].length;
        out.push('<div class="md-h md-h' + lv + '">' + inline(esc(h[2])) + '</div>');
        i++; continue;
      }

      // ⑤ 引用：连续的 > 行并成一段
      if (/^\s{0,3}>\s?/.test(line)) {
        closeAllLists();
        var q = [];
        while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
          q.push(inline(esc(lines[i].replace(/^\s{0,3}>\s?/, '')))); i++;
        }
        out.push('<blockquote class="md-quote">' + q.join('<br>') + '</blockquote>');
        continue;
      }

      // ⑥ 列表项
      var li = listMark(line);
      if (li) {
        // 收掉比自己深的层，再看要不要开新层
        while (stack.length && stack[stack.length - 1].indent > li.indent) {
          out.push('</li></' + (stack.pop().ordered ? 'ol' : 'ul') + '>');
        }
        var top = stack[stack.length - 1];
        // 同一缩进但序号形态变了（「- 甲」之后接「1. 一」），那是**另起一张单子**，
        // 不是同一张单子的下一项。不分开的话有序列表会被并进上面的 ul 渲染成圆点，
        // 而解读骨架正是靠 ①②③ 的次序撑起来的。
        if (top && top.indent === li.indent && top.ordered !== li.ordered) {
          out.push('</li></' + (stack.pop().ordered ? 'ol' : 'ul') + '>');
          top = stack[stack.length - 1];
        }
        if (!top || top.indent < li.indent) {
          stack.push({ indent: li.indent, ordered: li.ordered });
          out.push('<' + (li.ordered ? 'ol' : 'ul') + ' class="md-list"><li>');
        } else {
          out.push('</li><li>');
        }
        out.push(inline(esc(li.text)));
        i++; continue;
      }

      // ⑦ 空行：收掉列表，段落断开
      if (!line.trim()) { closeAllLists(); i++; continue; }

      // ⑧ 普通段落：连续非空行并成一段，行内换行保留
      closeAllLists();
      var para = [];
      while (i < lines.length && lines[i].trim() && !listMark(lines[i]) && !isHr(lines[i]) &&
             !/^\s{0,3}#{1,6}\s/.test(lines[i]) && !/^\s{0,3}>\s?/.test(lines[i]) &&
             !/^\s*```+/.test(lines[i]) &&
             !(lines[i].indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
        para.push(inline(esc(lines[i]))); i++;
      }
      if (!para.length) {
        // 兜底：上面所有分支都没吃掉这一行（判据之间只要有一处不一致就会这样），
        // 那就把它当普通一行吃掉。宁可排版差一点，也绝不让 i 停在原地把标签页卡死。
        para.push(inline(esc(lines[i]))); i++;
      }
      out.push('<p class="md-p">' + para.join('<br>') + '</p>');
    }
    closeAllLists();
    return out.join('');
  }

  /** 这段文本里有没有值得渲染的 Markdown？没有就别折腾，纯文本照旧显示。 */
  function looksMarkdown(md) {
    var s = String(md == null ? '' : md);
    return /^\s*\|.*\|/m.test(s) || /^\s{0,3}#{1,6}\s/m.test(s) ||
      /^\s*([-*+]|\d{1,9}[.)、])\s+\S/m.test(s) || /\*\*[^*]+\*\*/.test(s) || /```/.test(s);
  }

  return { VERSION: VERSION, render: render, looksMarkdown: looksMarkdown, _esc: esc, _inline: inline };
});
