/**
 * 奇门·案例本与校准(Casebook) core —— 纯函数、无副作用、可移植。【Phase 5】
 *
 * 解决的问题：前四期把「按纲要该怎么断」做成了确定性的、可溯源的证据。但纲要说的对不对、
 * 在**你这个人、你问的这类事**上准不准，应用一无所知——每次解读完，结果就丢了。
 * 本模块把「预测 → 对轨现实 → 校准」这条回路的**计算部分**补上：记录案例、回填实际结果、
 * 统计每条规则的符合率、给出校订建议。
 *
 * 【最关键的边界：经验层与教义层严格分离，本模块绝不改写 knowledge/*.json】
 *   前四期的核心资产是两条性质：①每条规则都能追溯到《解断方法纲要》的某一条；
 *   ②同盘同占类必得同一结果。若把用户反馈直接回写进规则库：
 *     · basis 立刻变成假话——规则不再是纲要说的，而是被几十条反馈改过的东西，
 *       可审计性与两派隔离(零串味)一并失效；
 *     · 各人各机的权重不同，"确定性"随之消失，同一张盘在两台手机上结果不同；
 *     · 样本量根本不够——一条规则命中 3 次、符合 2 次，算出的 67% 没有任何统计意义。
 *   故本模块只做三件事：**记录、统计、建议**。建议须经人工采纳，且采纳后也只进入
 *   独立的经验层(overlay)，以 CALIBRATION 条目单独呈现给模型，永不混入 READING。
 *
 * 其它边界：
 *   ① 样本量门槛：低于 MIN_SAMPLES_SHOW 一律不给符合率，只报「样本不足(n/N)」——
 *      宁可不说，也不给一个会被当真的假精度。
 *   ② 归因诚实：默认把整案的结果记到本次触发的每条规则头上，这是**粗归因**
 *      （断错未必是某条规则错，也可能是综合时错），故每条统计都标明 attribution；
 *      用户若逐条标注了判读，则优先用逐条标注，并分别计数。
 *   ③ 不生成「翻转极性」类建议：那等于让应用自创断法，越过纲要。只给复核/升降权重之议。
 *   ④ 纯函数：不碰存储、不碰时间（当前时间由调用方传入），同输入必得同输出。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Casebook = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '5.0.0';

  // 反馈档位。score 用于算符合率；「相反」另行计数——它不只是没应验，是断反了，性质更重。
  var OUTCOMES = {
    'happened': { label: '完全应验', score: 1 },
    'partial': { label: '部分应验', score: 0.5 },
    'not_happened': { label: '未应验', score: 0 },
    'opposite': { label: '结果相反', score: 0 }
  };
  var OUTCOME_KEYS = ['happened', 'partial', 'not_happened', 'opposite'];

  // 低于此数不给符合率——小样本的百分比会被当成精度，害处大于好处
  var MIN_SAMPLES_SHOW = 8;
  // 低于此数不生成校订建议（比展示门槛更严：建议会驱动人去改东西）
  var MIN_SAMPLES_PROPOSE = 12;
  var LOW_RATE = 0.3;    // 符合率低于此值 → 建议复核/降权
  var HIGH_RATE = 0.85;  // 高于此值 → 建议升权

  function isOutcome(k) { return OUTCOME_KEYS.indexOf(k) >= 0; }
  function outcomeLabel(k) { return (OUTCOMES[k] || {}).label || ''; }

  function dedupe(arr) {
    var out = [], i;
    for (i = 0; i < (arr || []).length; i++) if (arr[i] && out.indexOf(arr[i]) < 0) out.push(arr[i]);
    return out;
  }
  function round(n, d) { var p = Math.pow(10, d == null ? 2 : d); return Math.round(n * p) / p; }

  /**
   * 从一次解读中抽出「本次触发了哪些规则」。
   * 这是把案例与规则挂钩的唯一依据——没有它，反馈就无处落脚。
   */
  function firedRules(xiangyi, timing) {
    var rules = [], anchors = [];
    if (xiangyi && xiangyi.applicable) {
      (xiangyi.readings || []).concat(xiangyi.combinations || [], xiangyi.relations || [])
        .forEach(function (r) {
          // label/concept 必须一并存下：日后逐条标注时，用户面对的是「生门(财源) 旺 → 财源有力」，
          // 而不是一串规则 id。没有这两项，逐条标注根本无从下手。
          var label = r.kind === 'combination' ? (r.elements || []).join('+')
            : r.kind === 'relation' ? (r.fromLabel + '→' + r.toLabel)
              : (r.on + (r.aspect ? '(' + r.aspect + ')' : ''));
          rules.push({
            id: r.id, kind: r.kind, polarity: r.polarity, weight: r.weight || 0,
            // 宫际关系一条 id 底下有六种互斥读法，准头天差地别，须按分支各记各的
            branchId: r.branchId || '', trigger: r.trigger || '',
            label: label + (r.trigger ? ' ' + r.trigger : ''),
            concept: (r.concept || []).join('、').slice(0, 60)
          });
        });
    }
    if (timing && timing.applicable) {
      (timing.anchors || []).forEach(function (a) {
        anchors.push({
          mechanism: a.mechanism, value: a.value, kind: a.kind,
          strength: a.strength, gong: a.gong, offset: a.offset
        });
      });
    }
    return { rules: rules, anchors: anchors };
  }

  /**
   * 抽出**本盘实际的象义条目**——用神落在哪一宫、同宫有哪些星门神干、其传统象义是什么。
   *
   * 为什么必须单列这一层：rules 只是 domain-rules.json **命中的规则**。综合占类规则库近乎空白
   * （只有一条宫际关系）、飞盘更是整层停用，此时 rules 为 0-1 条——而盘还是那张盘，
   * 象义一条不少。若标注清单只给 rules，用户看到 AI 大谈「生门临坤、白虎同宫」，
   * 回头却只有一行可标，那清单就名不副实了。
   *
   * 取自 yongshen.examine（**各盘别、各占类都有**，是"最终要看哪些元素"的权威清单），
   * 再用 xiangyi.focus 补角色与旺衰四害、用 evidence 的 SYMBOL 条目补象义词。
   *
   * key 取「元素@宫」而非把同宫元素也编进去：那样每条都独一无二，跨案例永远累计不起来。
   * 「生门@2」这种配置会反复出现，才统计得出「生门临坤二在你这儿准不准」。
   */
  function chartSymbols(args) {
    args = args || {};
    var ys = args.yongshen, xy = args.xiangyi, ev = args.evidence, chart = args.chart || {};
    var examine = (ys && ys.examine) || [];
    if (!examine.length) return [];

    // xiangyi.focus → 角色/权重/旺衰四害（象义层停用时这些就没有，如实留空）
    var focus = {};
    if (xy && xy.applicable) (xy.focus || []).forEach(function (f) { focus[f.name] = f; });

    // evidence 的 SYMBOL 条目 → 象义词（按 element 索引；九宫以宫号为 element）
    var symWords = {};
    if (ev && ev.items) {
      ev.items.forEach(function (it) {
        if (it.type === 'SYMBOL') symWords[it.category + ':' + it.element] = it.content || [];
      });
    }
    var CAT = { men: 'bamen', xing: 'jiuxing', shen: 'bashen', gan: 'tiangan' };

    var out = [], seen = {};
    examine.forEach(function (m) {
      var key = 'sym:' + m.name + '@' + m.gong;
      if (seen[key]) return;
      seen[key] = 1;
      var f = focus[m.name];
      // 同宫元素：这正是「象与象相遇」之处，也是用户在解读里看到的东西
      var withEls = [];
      if (m.xing) withEls.push('星' + m.xing);
      if (m.men) withEls.push('门' + m.men);
      if (m.shen) withEls.push('神' + m.shen);
      if (m.tianGan) withEls.push('天盘' + m.tianGan);
      if (m.diGan) withEls.push('地盘' + m.diGan);
      if (m.anGan) withEls.push('暗干' + m.anGan);

      var marks = [];
      if (f && f.state) marks.push(f.state);
      if (f && f.flags) f.flags.forEach(function (x) { marks.push(x); });
      if (!f) {   // 象义层停用时，空亡/驿马仍可直接由盘面读出，不必臆造
        if (m.kongWang) marks.push('空亡');
        if (m.yiMa) marks.push('驿马');
      }

      // 元素象与宫象**各留配额**：直接拼接再截断，会让干象把宫象整段挤掉，
      // 而宫象正是方位/场所之所本（失物、风水尤依赖它）。
      var cat = CAT[m.kind];
      var elWords = cat ? (symWords[cat + ':' + (m.resolved || m.name)] || symWords[cat + ':' + m.name] || []) : [];
      var gongWords = symWords['jiugong:' + m.gong] || [];
      var words = dedupe(elWords.slice(0, 6)).concat(dedupe(gongWords.slice(0, 4)));

      out.push({
        key: key,
        name: m.name, resolved: (m.resolved && m.resolved !== m.name) ? m.resolved : '',
        kind: m.kind, gong: m.gong, gongName: m.gongName || '', direction: m.direction || '',
        aspect: f ? (f.aspect || '') : '', weight: f ? (f.weight || 0) : 0,
        origin: m.origin || '', marks: marks, withEls: withEls,
        words: dedupe(words),
        label: m.name + (m.resolved && m.resolved !== m.name ? '(' + m.resolved + ')' : '') +
          (f && f.aspect ? '·' + f.aspect : '') +
          ' 落' + m.gong + '宫' + (m.gongName ? '(' + m.gongName + ')' : '') +
          (marks.length ? ' [' + marks.join('·') + ']' : '')
      });
    });
    // 有角色权重的排前（那是本占最该看的），其余按宫号稳定排序
    out.sort(function (a, b) {
      if (a.weight !== b.weight) return b.weight - a.weight;
      return a.key < b.key ? -1 : 1;
    });
    return out;
  }

  /* ================= 反推（复盘）：由实际结果回头对当时的盘 ================= */

  /**
   * 应期反推——**完全确定性**，不含任何猜测。
   * 用户给出事情实际发生的日期，由调用方用排盘引擎算出那天的四柱，本函数只做比对：
   * 当时排的哪几个锚点命中了？命中在日、在月、还是在年？
   *
   * 为什么同时比对日/月/年：纲要·三节应期5「近事看日时、中事看月、远事看年」——
   * 同一个支，近事读作某日、远事读作某年，故三层都要看，并如实标明命中在哪一层。
   *
   * @param {object} rec 案例记录
   * @param {object} actualSiZhu 实际发生的四柱 {year,month,day[,time]}（由引擎算得）。
   *        time 只在用户填了具体时刻时才传——没填就别传，否则等于白送一层蒙中的机会。
   * @returns {object} { hits:[], missed:[], levels:{}, levelsEvaluated:[], chance:number }
   */
  function deriveTimingHits(rec, actualSiZhu) {
    var anchors = (rec && rec.fired && rec.fired.anchors) || [];
    if (!anchors.length || !actualSiZhu || !actualSiZhu.day) {
      return { hits: [], missed: anchors.slice(), levels: {}, chance: null, levelsEvaluated: [] };
    }
    function pair(s) { return { gan: String(s || '').charAt(0), zhi: String(s || '').charAt(1) }; }
    var L = { '日': pair(actualSiZhu.day), '月': pair(actualSiZhu.month), '年': pair(actualSiZhu.year) };
    // 时辰只在用户**真的填了发生时刻**时才评。没填而拿中午顶替，等于凭空多送一次蒙中的机会。
    var order = ['日', '月', '年'];
    if (actualSiZhu.time) { L['时'] = pair(actualSiZhu.time); order.push('时'); }

    var hits = [], missed = [], levels = {};
    anchors.forEach(function (a) {
      var at = [];
      order.forEach(function (lv) {
        var v = a.kind === 'gan' ? L[lv].gan : L[lv].zhi;
        if (v && v === a.value) at.push(lv);
      });
      if (at.length) {
        hits.push({
          mechanism: a.mechanism, value: a.value, kind: a.kind, strength: a.strength,
          gong: a.gong, level: at[0], at: at
        });
        at.forEach(function (lv) { levels[lv] = (levels[lv] || 0) + 1; });
      } else {
        missed.push(a);
      }
    });
    // 随机基准：候选越多、评的层数越多，蒙中的概率越高。不给这个数，用户会把"命中"当成灵验。
    // 层数必须取**实际评了几层**——加了时辰这一层却仍按三层算基准，等于凭空抬高命中率。
    function baselineOf(list) {
      var dz = {}, dg = {};
      list.forEach(function (a) { (a.kind === 'gan' ? dg : dz)[a.value] = 1; });
      var pz = Math.min(1, Object.keys(dz).length / 12);
      var pg = Math.min(1, Object.keys(dg).length / 10);
      var per = 1 - (1 - pz) * (1 - pg);
      return round(Math.min(1, 1 - Math.pow(1 - per, order.length)));
    }
    // 全量锚点的基准往往逼近 1（十来个候选 × 三四层，几乎必中），那样的"命中"没有信息量。
    // 故另算一份**只看 ★强锚点**的：它们数量少、且是纲要明言「须待此时方应」者，
    // 命中率与基准的差距才真正说明问题。
    var highAnchors = anchors.filter(function (a) { return a.strength === 'high'; });
    var highHits = hits.filter(function (h) { return h.strength === 'high'; });
    return {
      hits: hits, missed: missed, levels: levels,
      levelsEvaluated: order.slice(),
      chance: baselineOf(anchors),
      high: {
        total: highAnchors.length, hit: highHits.length,
        chance: highAnchors.length ? baselineOf(highAnchors) : null
      }
    };
  }

  /** 把复盘正解并入记录（纯函数，返回新对象）。正解是「当时该怎么断」，与实况反馈分开存。 */
  function applyCorrection(rec, correction) {
    if (!rec) return rec;
    var out = {};
    for (var k in rec) out[k] = rec[k];
    out.correction = correction || null;
    return out;
  }

  /** 把反推结果并入记录（纯函数，返回新对象）。 */
  function applyTimingDerivation(rec, derivation) {
    if (!rec) return rec;
    var out = {};
    for (var k in rec) out[k] = rec[k];
    out.timingHits = derivation || null;
    return out;
  }

  /**
   * 应期机制的本机命中率。
   * **务必连随机基准一起看**：宫干定日一次给十来个候选，蒙中概率本就高；
   * 若命中率与基准相当，说明这条机制在你这儿并没有提供额外信息。
   */
  function timingCalibration(records, opts) {
    opts = opts || {};
    var minShow = opts.minSamples || MIN_SAMPLES_SHOW;
    var byMech = {}, cases = 0, chanceSum = 0;
    var highCases = 0, highHitCases = 0, highChanceSum = 0;
    (records || []).forEach(function (rec) {
      if (!rec || !rec.timingHits) return;
      cases++;
      if (typeof rec.timingHits.chance === 'number') chanceSum += rec.timingHits.chance;
      // ★强锚点单列：全量基准常逼近 1，唯有强锚点的命中率与基准之差才有信息量
      var h = rec.timingHits.high;
      if (h && h.total > 0) {
        highCases++;
        if (h.hit > 0) highHitCases++;
        if (typeof h.chance === 'number') highChanceSum += h.chance;
      }
      var seen = {};
      (rec.fired.anchors || []).forEach(function (a) {
        if (!byMech[a.mechanism]) byMech[a.mechanism] = { mechanism: a.mechanism, n: 0, hit: 0 };
        if (!seen[a.mechanism]) { byMech[a.mechanism].n++; seen[a.mechanism] = 1; }  // 每案每机制只计一次
      });
      var hitSeen = {};
      (rec.timingHits.hits || []).forEach(function (h) {
        if (byMech[h.mechanism] && !hitSeen[h.mechanism]) { byMech[h.mechanism].hit++; hitSeen[h.mechanism] = 1; }
      });
    });
    var rows = Object.keys(byMech).map(function (m) {
      var s = byMech[m];
      var enough = s.n >= minShow;
      return {
        mechanism: m, n: s.n, hit: s.hit,
        rate: enough ? round(s.hit / s.n) : null, enough: enough,
        display: enough ? (Math.round((s.hit / s.n) * 100) + '%（' + s.hit + '/' + s.n + '）')
          : ('样本不足 ' + s.n + '/' + minShow)
      };
    }).sort(function (a, b) {
      if (a.enough !== b.enough) return a.enough ? -1 : 1;
      return (b.rate || 0) - (a.rate || 0);
    });
    return {
      cases: cases, mechanisms: rows, minSamples: minShow,
      // ★强锚点子集：n 为有强锚点的案例数，rate 为其中至少命中一条的比例
      high: {
        n: highCases, hit: highHitCases,
        rate: highCases >= minShow ? round(highHitCases / highCases) : null,
        baseline: highCases ? round(highChanceSum / highCases) : null,
        enough: highCases >= minShow,
        display: highCases >= minShow
          ? (Math.round((highHitCases / highCases) * 100) + '%（' + highHitCases + '/' + highCases + '）')
          : ('样本不足 ' + highCases + '/' + minShow)
      },
      baseline: cases ? round(chanceSum / cases) : null,
      baselineNote: '随机基准＝当时的候选日在日/月/年三层中任意命中的概率。' +
        '命中率若与基准相当，说明该机制未提供额外信息，不宜据此认为"应期很准"。'
    };
  }

  /* ================= AI 复盘：把实况映射回当时的判读 ================= */

  /**
   * 生成交给模型的复盘提示。**只让它做映射与标注，不让它改规则、不让它重新断卦**。
   * 输出强制为 JSON，便于解析；解析失败时上层照常降级（见 parseReview）。
   */
  // 复盘提示词里 AI 原解读的截断长度。太长会挤掉判读条目本身；
  // 取开头即可——结论与主要论断通常在前半段。
  var REVIEW_ANSWER_CHARS = 4000;

  function reviewPrompt(rec, actualText) {
    var rules = (rec && rec.fired && rec.fired.rules) || [];
    var syms = (rec && rec.fired && rec.fired.symbols) || [];
    var lines = rules.map(function (r) {
      return '- ' + r.id + ' ｜ ' + (r.label || '') + ' → ' + (r.concept || '') +
        ' ｜ 当时倾向：' + (r.polarity === '+' ? '助' : r.polarity === '-' ? '阻' : '中');
    });
    var symLines = syms.map(function (s) {
      return '- ' + s.key + ' ｜ ' + s.label +
        (s.withEls.length ? ' ｜ 同宫：' + s.withEls.join('/') : '') +
        (s.words.length ? ' ｜ 象义：' + s.words.join('、') : '');
    });
    var answer = String(rec && rec.answer || '').slice(0, REVIEW_ANSWER_CHARS);
    return [
      '你在做奇门占例的**复盘**，不是重新断卦。',
      '下面给出：当时这一卦触发的确定性条目、当时实际给出的解读全文、以及事后用户填写的实际发生情况。',
      '你要做两件事：①逐条判断条目是否与实际相符；②指出解读中**具体断错的地方**及其所依据的条目。',
      '',
      '【当时的判读条目（规则层，有出处）】',
      lines.length ? lines.join('\n') : '（本占类规则库未覆盖，无判读条目）',
      '',
      '【当时的盘面象义（用神落宫与同宫之象）】',
      symLines.length ? symLines.join('\n') : '（无）',
      '',
      '【当时实际给出的解读' + (answer.length >= REVIEW_ANSWER_CHARS ? '（节选前 ' + REVIEW_ANSWER_CHARS + ' 字）' : '') + '】',
      answer || '（未记录解读全文）',
      '',
      '【实际发生的情况（用户填写）】',
      actualText || '（未填写）',
      '',
      '【要求】',
      '1. 只对上面列出的条目作判断，不得新增条目、不得改写其内容、不得提出新的断法。',
      '2. 每条给出四档之一：happened(相符) / partial(部分相符) / not_happened(不相符) / opposite(与实际相反)。',
      '3. 实际情况里没有涉及到的条目，**不要勉强判断**——直接省略该条，宁缺勿猜。',
      '4. 断错分析(misreads)：从上面的解读全文中挑出**与实际明显不符**的具体论断，最多 5 条。每条给：',
      '   claim=照抄解读里的原句(不要转述)、basedOn=它所依据的条目 id 或象义 key(对应不上就留空字符串)、',
      '   actual=实际情况如何。断得对的地方不必列；解读没提到的事也不算断错(那属于观察)。',
      '5. 另可给出 0-3 条「观察」：实际情况中出现、但当时解读未提到的现象，供人工参考。观察不是结论。',
      '6. 只输出 JSON，不要任何解释文字或代码块标记。verdicts 用判读条目的 id，',
      '   symbolVerdicts 用盘面象义的 key（形如 sym:生门@2）：',
      '{"verdicts":{"规则id":"happened"},"symbolVerdicts":{"sym:生门@2":"partial"},',
      ' "misreads":[{"claim":"解读原句","basedOn":"规则id或sym:key或空","actual":"实际如何"}],',
      ' "observations":["..."]}'
    ].join('\n');
  }

  /**
   * 解析模型的复盘输出。**严格校验**：未知规则 id、非法档位一律丢弃——
   * 模型可能编出不存在的 id 或自造档位，放进统计就等于污染数据。
   */
  function parseReview(text, rec) {
    var known = {}, knownSym = {};
    ((rec && rec.fired && rec.fired.rules) || []).forEach(function (r) { known[r.id] = 1; });
    ((rec && rec.fired && rec.fired.symbols) || []).forEach(function (s) { knownSym[s.key] = 1; });
    var raw = String(text || '').trim();
    // 容忍模型裹上代码块或前后废话：取第一个 { 到最后一个 }
    var s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s < 0 || e <= s) return { ok: false, verdicts: {}, symbolVerdicts: {}, misreads: [], observations: [], dropped: [], error: '未找到 JSON' };
    var obj;
    try { obj = JSON.parse(raw.slice(s, e + 1)); }
    catch (err) { return { ok: false, verdicts: {}, symbolVerdicts: {}, misreads: [], observations: [], dropped: [], error: 'JSON 解析失败' }; }
    var verdicts = {}, dropped = [];
    var vs = (obj && obj.verdicts) || {};
    Object.keys(vs).forEach(function (id) {
      if (!known[id]) { dropped.push({ id: id, why: '本案未触发此规则' }); return; }
      if (!isOutcome(vs[id])) { dropped.push({ id: id, why: '档位非法：' + vs[id] }); return; }
      verdicts[id] = vs[id];
    });
    var symVerdicts = {};
    var svs = (obj && obj.symbolVerdicts) || {};
    Object.keys(svs).forEach(function (k) {
      if (!knownSym[k]) { dropped.push({ id: k, why: '本案无此象义条目' }); return; }
      if (!isOutcome(svs[k])) { dropped.push({ id: k, why: '档位非法：' + svs[k] }); return; }
      symVerdicts[k] = svs[k];
    });
    // 断错分析：claim/actual 为自由文本（截断即可）；basedOn 必须指向本案真实存在的条目，
    // 否则清空——模型很会编一个看起来像 id 的东西，放着不管就会污染「被指错」计数。
    var misreads = [];
    if (Array.isArray(obj && obj.misreads)) {
      obj.misreads.slice(0, 5).forEach(function (m) {
        if (!m || typeof m.claim !== 'string' || !m.claim.trim()) return;
        var basedOn = typeof m.basedOn === 'string' ? m.basedOn.trim() : '';
        if (basedOn && !known[basedOn] && !knownSym[basedOn]) {
          dropped.push({ id: basedOn, why: '断错分析引了本案不存在的条目，已清空其依据' });
          basedOn = '';
        }
        misreads.push({
          claim: String(m.claim).slice(0, 200),
          basedOn: basedOn,
          actual: typeof m.actual === 'string' ? String(m.actual).slice(0, 200) : ''
        });
      });
    }
    var obs = [];
    if (Array.isArray(obj && obj.observations)) {
      obs = obj.observations.filter(function (x) { return typeof x === 'string' && x.trim(); })
        .slice(0, 3).map(function (x) { return String(x).slice(0, 200); });
    }
    return { ok: true, verdicts: verdicts, symbolVerdicts: symVerdicts, misreads: misreads, observations: obs, dropped: dropped, error: '' };
  }

  /**
   * 生成一条案例记录。**只存必要字段**：完整盘可由「日期+盘别+模式+局」复现，
   * 没必要把九宫全量塞进手机存储里滚雪球。
   * @param {object} a {id, now, question, domain, school, chart, xiangyi, timing, answer, meta}
   */
  function makeCase(a) {
    a = a || {};
    var chart = a.chart || {};
    var sz = chart.siZhu || {};
    var fired = firedRules(a.xiangyi, a.timing);
    // 盘面象义：各盘别、各占类都有，故标注清单不会因规则库未覆盖而落空
    fired.symbols = chartSymbols({
      yongshen: a.yongshen, xiangyi: a.xiangyi, evidence: a.evidence, chart: chart
    });
    return {
      schema: VERSION,
      id: a.id || '',
      createdAt: a.now || '',
      // 复现盘所需的最小信息（不存整盘，省空间且避免存储格式随引擎升级而腐坏）
      chartRef: {
        date: (chart.basicInfo && chart.basicInfo.date) || a.dateISO || '',
        school: a.school || 'zhuanpan',
        mode: a.mode || 'shijia',
        juShu: (chart.juShu && chart.juShu.fullName) || '',
        siZhu: [sz.year, sz.month, sz.day, sz.time].filter(Boolean).join(' ')
      },
      question: a.question || '',
      // 多问拆分提议（Phase 12）。只是**提议**：confirmed=false 时统计一律照旧按整卦算，
      // 直到用户在复盘表单里确认要拆。绝不静默拆开去改统计。
      parts: (function () {
        var sp = splitQuestion(a.question || '');
        if (!sp.parts.length) return null;
        return {
          marker: sp.marker, lead: sp.lead, looksLikeOptions: sp.looksLikeOptions, why: sp.why,
          confirmed: false, source: 'auto',
          items: sp.parts.map(function (p, i) {
            return { i: i, text: String(p).slice(0, 200), outcome: '', actual: '' };
          })
        };
      })(),
      domain: a.domain || '',
      // 预测侧：本次触发的规则与应期锚点，反馈将落到这些 id 上
      fired: fired,
      // 证据合流的档位与弃权（Phase 13/A）。存它是为了日后能算**校准曲线**：
      // 「说是 A 级的，后来对了几成？」——不存下来，这个指标永远算不了。
      converge: (function () {
        var cv = a.converge;
        if (!cv || !cv.version || !cv.applicable) return null;
        return {
          version: cv.version,
          dims: (cv.dimensions || []).map(function (d) {
            var top = (d.candidates || [])[0] || null;
            return {
              dim: d.dim, top: top ? top.value : '', tier: top ? top.tier : 'D',
              independent: top ? top.independent : 0, contested: !!d.contested
            };
          }),
          // 弃权项两种形态都认：converge 给的是 {dim,why} 对象，外部注入时可能只给维度名
          abstained: (cv.abstained || []).map(function (x) {
            return (x && typeof x === 'object') ? x.dim : String(x || '');
          }).filter(Boolean)
        };
      })(),
      /* 吟局 / 八十一格 / 时格 / 力量校验的快照（Phase 14-16）。
       * 与 converge 同一个道理，也是同一个教训：**不存下来，这几层准不准就永远算不出来**。
       * 存的都是极短的摘要（成了什么局、关注宫是什么格、时格有无、触发了几条禁令），
       * 不存整层输出——案例本要能长期堆在手机上。 */
      yinju: (function () {
        var y = a.yinju;
        if (!y || !y.version) return null;
        if (!y.ju.length && !y.layers.length) return { version: y.version, ju: [], layers: [] };
        return {
          version: y.version, school: y.school,
          ju: y.ju.map(function (j) { return j.name; }),
          layers: y.layers.map(function (i) {
            return { name: i.name, scope: i.scope, count: i.count, checkable: i.checkable };
          })
        };
      })(),
      geju: (function () {
        var g = a.geju;
        if (!g || !g.version || !g.items.length) return null;
        // 只留关注宫那几格：全九宫会让每条案例都胖一圈，而要考核的正是用神宫之格
        return {
          version: g.version,
          focus: (g.focus || []).map(function (i) {
            return { gong: i.gong, gan: i.tianGan + '+' + i.diGan, name: i.name, roles: i.roles };
          })
        };
      })(),
      shige: (function () {
        var sg = a.shige;
        if (!sg || !sg.version) return null;
        return {
          version: sg.version, riGan: sg.riGan, shiGan: sg.shiGan,
          hits: (sg.hits || []).map(function (h) { return h.id; })
        };
      })(),
      // 取数层快照（Phase 21）。要考核的问题只有一个：**宫数入候选之后，数字题是不是更准**。
      // 那就得存下「当时可达几个数、用神取的是哪几个宫」——数值本身不存，
      // 因为本层从不选定一个数，选数是解读那一步的事，记在 answer 里。
      qushu: (function () {
        var qs = a.qushu;
        if (!qs || !qs.version || !qs.applicable) return null;
        return {
          version: qs.version, reachable: qs.reachable,
          targets: (qs.targets || []).map(function (x) {
            return { name: x.name, gong: x.gong, adjust: x.adjust };
          })
        };
      })(),
      severity: (function () {
        var sv = a.severity;
        if (!sv || !sv.version || !sv.applicable) return null;
        return {
          version: sv.version,
          findings: (sv.findings || []).map(function (f) {
            return { check: f.check, gong: f.gong, severity: f.severity };
          }),
          impaired: (sv.verdict && sv.verdict.impaired) || 0,
          total: (sv.verdict && sv.verdict.total) || 0
        };
      })(),
      tally: (a.xiangyi && a.xiangyi.tally) || null,
      pace: (a.timing && a.timing.pace) ? { speed: a.timing.pace.speed, from: a.timing.pace.from } : null,
      // AI 全文另存（可能很长，由调用方决定是否截断）
      answer: a.answer || '',
      // 现实侧：待回填
      feedback: null,
      meta: a.meta || {}
    };
  }

  /**
   * 回填反馈。
   * @param {object} rec 案例记录
   * @param {object} fb {outcome, happenedAt, happenedTime, note, now, ruleVerdicts:{ruleId:outcome}}
   * @returns {object} 新记录（不改原对象）
   */
  function applyFeedback(rec, fb) {
    if (!rec) return rec;
    fb = fb || {};
    if (!isOutcome(fb.outcome)) throw new Error('反馈档位非法：' + fb.outcome);
    var verdicts = {};
    var vs = fb.ruleVerdicts || {};
    Object.keys(vs).forEach(function (k) {
      if (isOutcome(vs[k])) verdicts[k] = vs[k];   // 非法档位静默丢弃，不污染统计
    });
    var symVerdicts = {};
    var sv = fb.symbolVerdicts || {};
    Object.keys(sv).forEach(function (k) {
      if (isOutcome(sv[k])) symVerdicts[k] = sv[k];
    });
    var out = {};
    for (var k in rec) out[k] = rec[k];
    out.feedback = {
      outcome: fb.outcome,
      label: outcomeLabel(fb.outcome),
      happenedAt: fb.happenedAt || '',
      // 逐维度标注（Phase A）：{ 维度名: outcome }。有了它，「A 级的后来对了几成」才算得出来
      dimVerdicts: (function () {
        var o = {}, m = fb.dimVerdicts || {};
        for (var k in m) if (OUTCOMES[m[k]]) o[k] = m[k];
        return o;
      })(),
      // 逐问档位（Phase 12）：{ i: outcome }，另有 partActuals { i: 实况文本 }
      partOutcomes: (function () {
        var o = {}, m = fb.partOutcomes || {};
        for (var k in m) if (OUTCOMES[m[k]]) o[k] = m[k];
        return o;
      })(),
      partActuals: (function () {
        var o = {}, m = fb.partActuals || {};
        for (var k in m) if (m[k]) o[k] = String(m[k]).slice(0, 400);
        return o;
      })(),
      happenedTime: fb.happenedTime || '',        // 可选。填了才核对「时辰」一级，见 deriveTimingHits
      // actual＝用户用自己的话写下的实际发生情况。四档太粗，真正能拿来反推的是这段文字。
      actual: fb.actual || fb.note || '',
      note: fb.note || '',
      recordedAt: fb.now || '',
      ruleVerdicts: verdicts,
      // 盘面象义的逐条标注，与规则判读分开统计——前者无 basis，不可混为规则的符合率
      symbolVerdicts: symVerdicts,
      // 逐条标注的来源：manual(用户手标) / ai(AI 复盘建议经用户确认)。统计时可据此分辨可信度。
      verdictSource: fb.verdictSource || ((Object.keys(verdicts).length + Object.keys(symVerdicts).length) ? 'manual' : ''),
      observations: Array.isArray(fb.observations) ? fb.observations.slice(0, 3) : [],
      // 断错分析：哪句断错了、依据哪条、实际如何。这是「规则错在哪」最直接的线索
      misreads: Array.isArray(fb.misreads) ? fb.misreads.slice(0, 5) : []
    };
    return out;
  }

  /**
   * 统计用的键。宫际关系必须**按分支**统计——同一条 general.rel.日干-时干 之下，
   * 「彼宫生我宫」实测 3 例全中、「二者同落一宫」5 例只中 1，混作一条算就成了没有意义的平均数，
   * 也没法只收窄其中一支。
   * 新记录带 branchId；改版之前的老记录没有，但 label 里存着那段触发文本（"我方→事体 我宫克彼宫"），
   * 由它反推同一个键，故既有反馈不会因改版作废。
   */
  function statKey(r) {
    if (!r) return '';
    if (r.branchId) return r.branchId;
    if (r.kind !== 'relation') return r.id;
    var t = r.trigger || '';
    if (!t && r.label) {
      var i = String(r.label).indexOf(' ');
      if (i > 0) t = String(r.label).slice(i + 1);
    }
    return t ? r.id + '#' + t : r.id;
  }


  /* ================= 多问拆分（Phase 12） =================
   * 实测案例本里 32% 的题带多问标记，整卦只给一个应验档位，结果几乎必然是「部分应验」——
   * 36% 的部分应验率有相当一部分是这么来的，既丢信息，也把规则统计拖成一锅粥。
   * 但有个陷阱：「①中医②西医③祝由④开刀」是**选项**不是子问题，硬拆会把选项拆成问题。
   * 故本层只**提议**拆法并给出判据，是否采纳由用户在复盘表单里定——绝不静默拆开去改统计。 */
  var SPLIT_MARKERS = [
    { name: 'circled', src: '[\u2460-\u2469]' },
    { name: 'numbered', src: '(?:^|[\n\uFF1B;\u3002\uFF1A:])\s*[1-9\uFF11-\uFF19][\.\uFF0E\u3001\uFF0C\)\uFF09]' },
    { name: 'paren', src: '[\uFF08(]\s*[1-9\u4E00-\u4E5D]\s*[\uFF09)]' },
    { name: 'cn', src: '(?:^|[\n\uFF1B;\u3002\uFF1A:])\s*[\u4E00-\u4E5D][\u3001\uFF0E]' }
  ];
  var Q_HINT = /[？?]|能否|是否|会不会|能不能|可否|多少|几时|何时|哪|什么|吗|如何|怎样|谁|测/;
  var SKIP_CH = /[\s\n；;。：:]/;

  /**
   * 把一段问句提议拆成若干子问。
   * @returns {object} { parts:[string], lead:string, marker, looksLikeOptions, why }
   *   looksLikeOptions=true 时表示「这多半是选项而非子问题」，界面据此默认不拆。
   */
  function splitQuestion(text) {
    var t = String(text || '');
    if (!t.trim()) return { parts: [], lead: '', marker: '', looksLikeOptions: false, why: '问句为空' };
    for (var i = 0; i < SPLIT_MARKERS.length; i++) {
      var re = new RegExp(SPLIT_MARKERS[i].src, 'g'), at = [], m;
      while ((m = re.exec(t)) !== null) {
        var s = m.index;
        while (s < t.length && SKIP_CH.test(t.charAt(s))) s++;
        at.push(s);
        if (re.lastIndex === m.index) re.lastIndex++;
      }
      if (at.length < 2) continue;
      var lead = t.slice(0, at[0]).trim();
      var parts = [];
      for (var k = 0; k < at.length; k++) {
        parts.push(t.slice(at[k], k + 1 < at.length ? at[k + 1] : t.length).trim());
      }
      parts = parts.filter(Boolean);
      if (parts.length < 2) continue;
      var qn = 0;
      parts.forEach(function (p) { if (Q_HINT.test(p)) qn++; });
      var sameLine = parts.every(function (p) { return p.indexOf('\n') < 0; });
      var optionish = qn * 2 < parts.length || (sameLine && qn < parts.length);
      return {
        marker: SPLIT_MARKERS[i].name, lead: lead, parts: parts, questionish: qn,
        looksLikeOptions: optionish,
        why: optionish
          ? (qn * 2 < parts.length ? '过半不像问句，多半是选项而非子问题' : '并列于同一行且非条条成问，多半是选项')
          : '各自成句且多含疑问，多半是子问题'
      };
    }
    return { parts: [], lead: '', marker: '', looksLikeOptions: false, why: '未见多问标记' };
  }

  /** 由各子问的档位推出整卦档位：全中=完全应验，全不中=未应验，有中有不中=部分应验。 */
  function deriveOutcome(parts) {
    var graded = (parts || []).filter(function (p) { return p && p.outcome && OUTCOMES[p.outcome]; });
    if (!graded.length) return null;
    var hit = 0, opp = 0;
    graded.forEach(function (p) {
      var s = OUTCOMES[p.outcome].score;
      if (s >= 1) hit++;
      if (p.outcome === 'opposite') opp++;
    });
    if (hit === graded.length) return 'happened';
    if (opp === graded.length) return 'opposite';
    if (hit === 0 && opp === 0) return 'not_happened';
    return 'partial';
  }

  /** 各子问档位的平均分。用于校准：四问中三问应验应记 0.75，而不是笼统的「部分＝0.5」。 */
  function partsScore(parts) {
    var graded = (parts || []).filter(function (p) { return p && p.outcome && OUTCOMES[p.outcome]; });
    if (!graded.length) return null;
    var sum = 0;
    graded.forEach(function (p) { sum += OUTCOMES[p.outcome].score; });
    return { score: sum / graded.length, n: graded.length, total: (parts || []).length };
  }

  /**
   * 整卦记分。**已确认拆问且逐问回填过**的，用各问平均分——四问中三问应验记 0.75，
   * 而不是笼统的「部分＝0.5」。其余一律照旧按整卦档位，行为与从前逐字一致。
   * @returns {object} { score, from:'parts'|'case', n, total, outcome }
   */
  function caseScore(rec) {
    var fb = (rec && rec.feedback) || null;
    if (!fb || !fb.outcome) return null;
    var p = partsOf(rec);
    if (p) {
      var ps = partsScore(p);
      if (ps && ps.n) {
        return { score: ps.score, from: 'parts', n: ps.n, total: ps.total, outcome: fb.outcome };
      }
    }
    return { score: OUTCOMES[fb.outcome].score, from: 'case', n: 1, total: 1, outcome: fb.outcome };
  }

  /** 已确认要拆、且带上了逐问档位的子问清单；否则返回 null（表示按整卦算）。 */
  function partsOf(rec) {
    var ps = rec && rec.parts;
    if (!ps || !ps.confirmed || !ps.items || !ps.items.length) return null;
    var po = (rec.feedback && rec.feedback.partOutcomes) || {};
    var out = ps.items.map(function (it) {
      return { i: it.i, text: it.text, outcome: po[it.i] || it.outcome || '' };
    });
    return out.some(function (x) { return x.outcome; }) ? out : null;
  }

  function graded(rec) { return !!(rec && rec.feedback && isOutcome(rec.feedback.outcome)); }

  /**
   * 按规则统计符合率。
   * 两种归因分开计数，绝不混为一谈：
   *   rule —— 用户对该条判读单独标注过（可信）
   *   case —— 由整案结果推及该条规则（粗，断错未必是这条规则的错）
   * 展示时以 rule 优先；样本不足者不给符合率。
   */
  function calibrate(records, opts) {
    opts = opts || {};
    var minShow = opts.minSamples || MIN_SAMPLES_SHOW;
    var byRule = {}, byDomain = {}, totals = { cases: 0, graded: 0, byOutcome: {} };
    OUTCOME_KEYS.forEach(function (k) { totals.byOutcome[k] = 0; });

    (records || []).forEach(function (rec) {
      totals.cases++;
      if (!graded(rec)) return;
      totals.graded++;
      var caseOutcome = rec.feedback.outcome;
      // 已确认拆问且逐问回填者，整案归因用逐问平均分（四问中三问应验＝0.75），
      // 而不是笼统的「部分＝0.5」。未拆问者行为逐字不变。
      var cs_ = caseScore(rec), caseScoreVal = cs_ ? cs_.score : OUTCOMES[caseOutcome].score;
      totals.byOutcome[caseOutcome]++;

      var d = rec.domain || 'unknown';
      if (!byDomain[d]) byDomain[d] = { domain: d, n: 0, score: 0, opposite: 0 };
      byDomain[d].n++;
      byDomain[d].score += caseScoreVal;
      if (caseOutcome === 'opposite') byDomain[d].opposite++;

      ((rec.fired && rec.fired.rules) || []).forEach(function (r) {
        var key = statKey(r);
        if (!byRule[key]) {
          byRule[key] = {
            ruleId: key, baseRuleId: r.id, branch: key !== r.id ? key.slice(r.id.length + 1) : '',
            label: r.label || '', domain: d, polarity: r.polarity,
            ruleN: 0, ruleScore: 0, ruleOpposite: 0,
            caseN: 0, caseScore: 0, caseOpposite: 0,
            misreadN: 0, misreadExamples: []
          };
        }
        var s = byRule[key];
        // 逐条标注挂在 r.id 上（老记录如此，且同一张盘里一条关系只发一支，归属无歧义）；
        // 分支级 id 若日后也被标注，一并认。
        var v = rec.feedback.ruleVerdicts[key] || rec.feedback.ruleVerdicts[r.id];
        if (v) {
          s.ruleN++; s.ruleScore += OUTCOMES[v].score;
          if (v === 'opposite') s.ruleOpposite++;
        } else {
          s.caseN++; s.caseScore += caseScoreVal;
          if (caseOutcome === 'opposite') s.caseOpposite++;
        }
      });

      // 被复盘指为「断错所依据的条目」的次数。这与符合率是**两个不同的信号**：
      // 符合率答「这条准不准」，被指错次数答「解读里出岔子时是不是它在背后」。
      (rec.feedback.misreads || []).forEach(function (m) {
        if (!m || !m.basedOn) return;
        var s2 = byRule[m.basedOn];
        if (!s2) {
          // basedOn 指的是规则 id，而统计已按分支拆开：挂到本案实际发的那一支上。
          // 同一张盘里一条关系只发一支，故归属无歧义。
          var own = ((rec.fired && rec.fired.rules) || []).filter(function (r) { return r.id === m.basedOn; })[0];
          if (own) s2 = byRule[statKey(own)];
        }
        if (!s2) return;                       // 象义 key 或已不在本案的条目，跳过
        s2.misreadN++;
        if (s2.misreadExamples.length < 3) {
          s2.misreadExamples.push({ claim: m.claim, actual: m.actual });
        }
      });
    });

    var rules = Object.keys(byRule).map(function (id) {
      var s = byRule[id];
      // 逐条标注优先；没有逐条标注才退回整案归因，并如实标明
      var useRule = s.ruleN > 0;
      var n = useRule ? s.ruleN : s.caseN;
      var score = useRule ? s.ruleScore : s.caseScore;
      var opposite = useRule ? s.ruleOpposite : s.caseOpposite;
      var enough = n >= minShow;
      return {
        ruleId: s.ruleId, domain: s.domain, polarity: s.polarity,
        attribution: useRule ? 'rule' : 'case',
        n: n, opposite: opposite,
        ruleN: s.ruleN, caseN: s.caseN,
        rate: enough ? round(score / n) : null,
        misreadN: s.misreadN, misreadExamples: s.misreadExamples,
        enough: enough, minSamples: minShow,
        // 供界面直接显示，避免各处各写一套措辞
        display: enough
          ? (round((score / n) * 100, 0) + '%（' + n + ' 例' + (useRule ? '·逐条标注' : '·整案归因') + '）')
          : ('样本不足 ' + n + '/' + minShow)
      };
    });
    rules.sort(function (a, b) {
      if (a.enough !== b.enough) return a.enough ? -1 : 1;
      if (a.enough && a.rate !== b.rate) return a.rate - b.rate;   // 低符合率排前，便于复核
      if (a.misreadN !== b.misreadN) return b.misreadN - a.misreadN;
      return b.n !== a.n ? b.n - a.n : (a.ruleId < b.ruleId ? -1 : 1);
    });

    /* 盘面象义的统计：键为「元素@宫」，与规则符合率**分开呈现**。
       二者性质不同——规则有 basis 可回查纲要，象义条目只是"这盘上有这么个配置"，
       混在一张表里会让人以为象义也有出处。 */
    var bySym = {};
    (records || []).forEach(function (rec) {
      if (!graded(rec)) return;
      var caseOutcome = rec.feedback.outcome;
      // 已确认拆问且逐问回填者，整案归因用逐问平均分（四问中三问应验＝0.75），
      // 而不是笼统的「部分＝0.5」。未拆问者行为逐字不变。
      var cs_ = caseScore(rec), caseScoreVal = cs_ ? cs_.score : OUTCOMES[caseOutcome].score;
      ((rec.fired && rec.fired.symbols) || []).forEach(function (s) {
        if (!bySym[s.key]) {
          bySym[s.key] = { key: s.key, label: s.label, name: s.name, gong: s.gong, aspect: s.aspect,
            symN: 0, symScore: 0, symOpposite: 0, caseN: 0, caseScore: 0, caseOpposite: 0 };
        }
        var st = bySym[s.key];
        var v = (rec.feedback.symbolVerdicts || {})[s.key];
        if (v) {
          st.symN++; st.symScore += OUTCOMES[v].score;
          if (v === 'opposite') st.symOpposite++;
        } else {
          st.caseN++; st.caseScore += caseScoreVal;
          if (caseOutcome === 'opposite') st.caseOpposite++;
        }
      });
    });
    var symbols = Object.keys(bySym).map(function (k) {
      var s = bySym[k];
      var useSym = s.symN > 0;
      var n = useSym ? s.symN : s.caseN;
      var score = useSym ? s.symScore : s.caseScore;
      var opposite = useSym ? s.symOpposite : s.caseOpposite;
      var enough = n >= minShow;
      return {
        key: s.key, label: s.label, name: s.name, gong: s.gong, aspect: s.aspect,
        attribution: useSym ? 'symbol' : 'case',
        n: n, opposite: opposite, symN: s.symN, caseN: s.caseN,
        rate: enough ? round(score / n) : null, enough: enough,
        display: enough
          ? (round((score / n) * 100, 0) + '%（' + n + ' 例' + (useSym ? '·逐条标注' : '·整案归因') + '）')
          : ('样本不足 ' + n + '/' + minShow)
      };
    }).sort(function (a, b) {
      if (a.enough !== b.enough) return a.enough ? -1 : 1;
      if (a.enough && a.rate !== b.rate) return a.rate - b.rate;
      return b.n !== a.n ? b.n - a.n : (a.key < b.key ? -1 : 1);
    });

    var domains = Object.keys(byDomain).map(function (d) {
      var s = byDomain[d];
      var enough = s.n >= minShow;
      return {
        domain: d, n: s.n, opposite: s.opposite,
        rate: enough ? round(s.score / s.n) : null, enough: enough,
        display: enough ? (round((s.score / s.n) * 100, 0) + '%（' + s.n + ' 例）') : ('样本不足 ' + s.n + '/' + minShow)
      };
    }).sort(function (a, b) { return b.n - a.n; });

    return { version: VERSION, totals: totals, rules: rules, symbols: symbols, domains: domains, minSamples: minShow };
  }

  /**
   * 生成校订建议。**只建议，不执行**；且刻意不产出「翻转极性」之议——
   * 那等于让应用自创断法、越过纲要，是本项目从第一期起就守住的线。
   */
  function proposals(cal, opts) {
    opts = opts || {};
    var minN = opts.minSamples || MIN_SAMPLES_PROPOSE;
    var out = [];
    (cal && cal.rules ? cal.rules : []).forEach(function (r) {
      // 被反复指为断错依据者，即便符合率尚可也值得复核——这是符合率看不出来的问题：
      // 条目本身可能没错，错的是它在解读里被用成了那个论断的依据。
      if (r.misreadN >= 3 && (!r.enough || r.rate > LOW_RATE)) {
        out.push({
          ruleId: r.ruleId, domain: r.domain, kind: 'review', severity: 'normal',
          title: '复核：这条常被指为断错的依据',
          detail: '复盘中有 ' + r.misreadN + ' 次把解读的失误归到此条' +
            (r.misreadExamples.length ? '，例如「' + r.misreadExamples[0].claim + '」→ 实际：' + r.misreadExamples[0].actual : '') +
            '。符合率' + (r.enough ? '为 ' + Math.round(r.rate * 100) + '%，尚可' : '样本尚不足') +
            '——问题可能不在条目本身，而在它被用作该论断依据的方式。请对照纲要原文复核其适用边界。',
          suggested: null
        });
      }
      if (!r.enough || r.n < minN) return;
      if (r.rate <= LOW_RATE) {
        out.push({
          ruleId: r.ruleId, domain: r.domain, kind: 'review',
          severity: r.opposite >= Math.ceil(r.n / 2) ? 'high' : 'normal',
          title: '复核此规则',
          detail: '本机 ' + r.n + ' 例中符合率仅 ' + Math.round(r.rate * 100) + '%' +
            (r.opposite ? '，其中 ' + r.opposite + ' 例结果相反' : '') +
            (r.misreadN ? '；另有 ' + r.misreadN + ' 次被复盘指为断错所依据' : '') +
            '（' + (r.attribution === 'rule' ? '逐条标注' : '整案归因，较粗') + '）。' +
            '建议对照纲要原文复核其取用与倾向；若确属误收，请改 knowledge/domain-rules.json 并补出处，' +
            '不要靠反馈去覆盖它。',
          suggested: { action: 'downweight', delta: -1 }
        });
      } else if (r.rate >= HIGH_RATE) {
        out.push({
          ruleId: r.ruleId, domain: r.domain, kind: 'confirm',
          severity: 'normal',
          title: '此规则在本机表现稳定',
          detail: '本机 ' + r.n + ' 例中符合率 ' + Math.round(r.rate * 100) + '%（' +
            (r.attribution === 'rule' ? '逐条标注' : '整案归因，较粗') + '）。可考虑在解读时给予更多着墨。',
          suggested: { action: 'upweight', delta: 1 }
        });
      }
    });
    // 归因质量提醒：整案归因占比过高时，统计的可信度有限，须如实告知
    var caseOnly = (cal && cal.rules ? cal.rules : []).filter(function (r) { return r.attribution === 'case'; }).length;
    var totalRules = (cal && cal.rules ? cal.rules : []).length;
    if (totalRules > 0 && caseOnly / totalRules > 0.8) {
      out.push({
        ruleId: '', domain: '', kind: 'method', severity: 'normal',
        title: '建议逐条标注，而非只给整案结论',
        detail: '目前 ' + caseOnly + '/' + totalRules + ' 条规则的统计来自「整案归因」——' +
          '即把整次解读的对错记到当次触发的每条规则头上。断错未必是某一条规则的错，' +
          '也可能是综合时错。若能对关键判读逐条标注是否符合，统计才谈得上可信。',
        suggested: null
      });
    }
    return out;
  }

  /**
   * 由已采纳的建议生成经验层 overlay。
   * overlay **不参与 xiangyi 的规则求值**，只用于给证据包附一条 CALIBRATION 说明——
   * 这样规则层的确定性(同盘同占类必得同一结果)不受本机历史影响，跨设备仍可复现。
   */
  function buildOverlay(acceptedProposals, cal) {
    var byId = {};
    (cal && cal.rules ? cal.rules : []).forEach(function (r) { byId[r.ruleId] = r; });
    var notes = {};
    (acceptedProposals || []).forEach(function (p) {
      if (!p || !p.ruleId) return;
      var r = byId[p.ruleId];
      if (!r || !r.enough) return;   // 采纳过但样本已不足（如删过案例）则不生效
      notes[p.ruleId] = {
        ruleId: p.ruleId, kind: p.kind,
        rate: r.rate, n: r.n, attribution: r.attribution,
        note: '本机历史：' + r.display + (r.opposite ? '，其中 ' + r.opposite + ' 例结果相反' : '')
      };
    });
    return { version: VERSION, notes: notes, count: Object.keys(notes).length };
  }

  /** overlay + 本次触发的规则 → 证据包用的 CALIBRATION 条目原料。 */
  function calibrationFor(overlay, xiangyi) {
    if (!overlay || !overlay.notes || !xiangyi || !xiangyi.applicable) return [];
    var fired = firedRules(xiangyi, null).rules;
    var out = [];
    fired.forEach(function (r) {
      var n = overlay.notes[r.id];
      if (n) out.push(n);
    });
    return out;
  }

  return {
    VERSION: VERSION,
    OUTCOMES: OUTCOMES, OUTCOME_KEYS: OUTCOME_KEYS,
    MIN_SAMPLES_SHOW: MIN_SAMPLES_SHOW, MIN_SAMPLES_PROPOSE: MIN_SAMPLES_PROPOSE,
    isOutcome: isOutcome, outcomeLabel: outcomeLabel,
    firedRules: firedRules, chartSymbols: chartSymbols,
    makeCase: makeCase, applyFeedback: applyFeedback, graded: graded,
    splitQuestion: splitQuestion, deriveOutcome: deriveOutcome, partsScore: partsScore,
    caseScore: caseScore,
    calibrate: calibrate, proposals: proposals,
    deriveTimingHits: deriveTimingHits, applyTimingDerivation: applyTimingDerivation,
    applyCorrection: applyCorrection,
    timingCalibration: timingCalibration,
    reviewPrompt: reviewPrompt, parseReview: parseReview,
    buildOverlay: buildOverlay, calibrationFor: calibrationFor
  };
});
