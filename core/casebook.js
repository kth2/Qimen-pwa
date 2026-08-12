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
          rules.push({ id: r.id, kind: r.kind, polarity: r.polarity, weight: r.weight || 0 });
        });
    }
    if (timing && timing.applicable) {
      (timing.anchors || []).forEach(function (a) {
        anchors.push({ mechanism: a.mechanism, value: a.value, kind: a.kind, strength: a.strength, gong: a.gong });
      });
    }
    return { rules: rules, anchors: anchors };
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
      domain: a.domain || '',
      // 预测侧：本次触发的规则与应期锚点，反馈将落到这些 id 上
      fired: fired,
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
   * @param {object} fb {outcome, happenedAt, note, now, ruleVerdicts:{ruleId:outcome}}
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
    var out = {};
    for (var k in rec) out[k] = rec[k];
    out.feedback = {
      outcome: fb.outcome,
      label: outcomeLabel(fb.outcome),
      happenedAt: fb.happenedAt || '',
      note: fb.note || '',
      recordedAt: fb.now || '',
      ruleVerdicts: verdicts
    };
    return out;
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
      totals.byOutcome[caseOutcome]++;

      var d = rec.domain || 'unknown';
      if (!byDomain[d]) byDomain[d] = { domain: d, n: 0, score: 0, opposite: 0 };
      byDomain[d].n++;
      byDomain[d].score += OUTCOMES[caseOutcome].score;
      if (caseOutcome === 'opposite') byDomain[d].opposite++;

      ((rec.fired && rec.fired.rules) || []).forEach(function (r) {
        if (!byRule[r.id]) {
          byRule[r.id] = {
            ruleId: r.id, domain: d, polarity: r.polarity,
            ruleN: 0, ruleScore: 0, ruleOpposite: 0,
            caseN: 0, caseScore: 0, caseOpposite: 0
          };
        }
        var s = byRule[r.id];
        var v = rec.feedback.ruleVerdicts[r.id];
        if (v) {
          s.ruleN++; s.ruleScore += OUTCOMES[v].score;
          if (v === 'opposite') s.ruleOpposite++;
        } else {
          s.caseN++; s.caseScore += OUTCOMES[caseOutcome].score;
          if (caseOutcome === 'opposite') s.caseOpposite++;
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
      return b.n !== a.n ? b.n - a.n : (a.ruleId < b.ruleId ? -1 : 1);
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

    return { version: VERSION, totals: totals, rules: rules, domains: domains, minSamples: minShow };
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
      if (!r.enough || r.n < minN) return;
      if (r.rate <= LOW_RATE) {
        out.push({
          ruleId: r.ruleId, domain: r.domain, kind: 'review',
          severity: r.opposite >= Math.ceil(r.n / 2) ? 'high' : 'normal',
          title: '复核此规则',
          detail: '本机 ' + r.n + ' 例中符合率仅 ' + Math.round(r.rate * 100) + '%' +
            (r.opposite ? '，其中 ' + r.opposite + ' 例结果相反' : '') +
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
    firedRules: firedRules,
    makeCase: makeCase, applyFeedback: applyFeedback, graded: graded,
    calibrate: calibrate, proposals: proposals,
    buildOverlay: buildOverlay, calibrationFor: calibrationFor
  };
});
