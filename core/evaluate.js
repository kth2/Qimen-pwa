/**
 * 奇门·案例本评估器(Evaluate) core —— 纯函数、无副作用、可移植。【Phase A】
 *
 * 为什么要有这一层：改进若不能被测量，就只是换个说法而已。本模块把一份案例本导出
 * 跑成一张**可重复、可比对**的成绩单，作为此后一切改动的基准线。
 *
 * 最要紧的设计原则，是**只报能算的，并把算不了的连同原因一并列出**：
 *   · 「逐条断言准确率」算不了——案例本只记了**断错**的那些（misreads），没记全部断言，
 *     分母根本不存在。硬凑一个数出来比不报更有害。
 *   · 「方位/处所属性准确率」算不了——预测侧没有结构化地存下「断的是哪个方位」。
 *   · 「置信度校准曲线」暂时算不了——此前没有存过置信度；证据合流层已开始产出档位，
 *     从今往后的新案例才具备这个字段。
 * 这些一律列进 notMeasured，写明缘由，绝不用近似值冒充。
 *
 * 能算的那些也一律带**样本门槛**与**随机基准**：小样本的百分比会被当成精度，
 * 故不足门槛者只报「样本不足 n/N」。
 *
 * 依赖：core/casebook.js 的 calibrate / timingCalibration / caseScore（由调用方注入，
 *       或在 Node 下自动 require），本模块不重算统计口径，只做汇总与呈现。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./casebook.js'));
  else root.Evaluate = factory(root.Casebook);
})(typeof self !== 'undefined' ? self : this, function (CB) {
  'use strict';

  var VERSION = '1.0.0';
  var SHORT_ACTUAL = 20;      // 实况短于此字数者，多半不足以核验一条完整断语
  var REV_ID = '__revisions__';

  function pct(a, b) { return b ? Math.round(1000 * a / b) / 10 : null; }
  function round(x, n) { var p = Math.pow(10, n == null ? 3 : n); return Math.round(x * p) / p; }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * 主入口。
   * @param {Array|Object} input 案例数组，或案例本导出对象（{cases:[...]}）
   * @param {object} opts .minSamples 覆盖展示门槛（缺省沿用 casebook 的口径）
   */
  function evaluate(input, opts) {
    opts = opts || {};
    var all = (input && input.cases) ? input.cases : (input || []);
    var cases = all.filter(function (c) { return c && c.id !== REV_ID; });
    var graded = cases.filter(function (c) { return c && c.feedback && c.feedback.outcome; });

    var rep = {
      version: VERSION,
      generatedAt: opts.now || new Date().toISOString(),
      fingerprint: '', n: {}, coverage: {}, outcomes: {}, byDomain: [],
      rules: {}, symbols: {}, timing: {}, claims: {}, verifiability: {},
      notMeasured: [], notes: []
    };
    if (!cases.length) { rep.notes.push('案例本为空，无从评估。'); return rep; }

    /* ---------- 规模与指纹（两次评估要能对得上是不是同一批数据） ---------- */
    var dates = cases.map(function (c) { return String(c.createdAt || '').slice(0, 10); })
      .filter(Boolean).sort();
    rep.n = { cases: cases.length, graded: graded.length };
    rep.fingerprint = cases.length + '例/' + graded.length + '回填/' +
      (dates.length ? dates[0] + '→' + dates[dates.length - 1] : '无日期');

    /* ---------- 覆盖率：这决定了后面哪些数字有意义 ---------- */
    function has(f) { return graded.filter(f).length; }
    rep.coverage = {
      gradedRate: pct(graded.length, cases.length),
      withAnswer: pct(cases.filter(function (c) { return c.answer; }).length, cases.length),
      withVerdicts: pct(has(function (c) {
        var f = c.feedback;
        return (f.ruleVerdicts && Object.keys(f.ruleVerdicts).length) ||
               (f.symbolVerdicts && Object.keys(f.symbolVerdicts).length);
      }), graded.length),
      withDate: pct(has(function (c) { return c.feedback.happenedAt; }), graded.length),
      withTime: pct(has(function (c) { return c.feedback.happenedTime; }), graded.length),
      withMisreads: pct(has(function (c) { return (c.feedback.misreads || []).length; }), graded.length),
      withParts: pct(cases.filter(function (c) { return c.parts && c.parts.confirmed; }).length, cases.length)
    };

    /* ---------- 结果分布。加权分用 casebook 的 caseScore：已拆问者按逐问平均 ---------- */
    var byOut = { happened: 0, partial: 0, not_happened: 0, opposite: 0 };
    var scoreSum = 0, scoreN = 0, fromParts = 0;
    graded.forEach(function (c) {
      if (byOut[c.feedback.outcome] != null) byOut[c.feedback.outcome]++;
      var s = CB && CB.caseScore ? CB.caseScore(c) : null;
      if (s) { scoreSum += s.score; scoreN++; if (s.from === 'parts') fromParts++; }
    });
    rep.outcomes = {
      counts: byOut,
      exactRate: pct(byOut.happened, graded.length),
      partialRate: pct(byOut.partial, graded.length),
      failRate: pct(byOut.not_happened + byOut.opposite, graded.length),
      oppositeRate: pct(byOut.opposite, graded.length),
      weightedScore: scoreN ? round(scoreSum / scoreN) : null,
      weightedFromParts: fromParts,
      _note: '「加权分」把完全应验记 1、部分记 0.5、未应验与结果相反记 0；已确认拆问者改按逐问平均分。'
    };

    /* ---------- 按占类。样本少的照实标出，不给百分比以外的解读 ---------- */
    var dm = {};
    graded.forEach(function (c) {
      var d = c.domain || 'unknown';
      var s = (dm[d] = dm[d] || { domain: d, n: 0, happened: 0, partial: 0, fail: 0, score: 0 });
      s.n++;
      if (c.feedback.outcome === 'happened') s.happened++;
      else if (c.feedback.outcome === 'partial') s.partial++;
      else s.fail++;
      var sc = CB && CB.caseScore ? CB.caseScore(c) : null;
      if (sc) s.score += sc.score;
    });
    var minN = opts.minSamples || (CB && CB.MIN_SAMPLES) || 8;
    rep.byDomain = Object.keys(dm).map(function (k) {
      var s = dm[k];
      var enough = s.n >= minN;
      return {
        domain: s.domain, n: s.n, enough: enough,
        exactRate: enough ? pct(s.happened, s.n) : null,
        failRate: enough ? pct(s.fail, s.n) : null,
        weightedScore: enough ? round(s.score / s.n) : null,
        display: enough
          ? '完全应验 ' + pct(s.happened, s.n) + '%　未应验/相反 ' + pct(s.fail, s.n) + '%　加权 ' + round(s.score / s.n)
          : '样本不足 ' + s.n + '/' + minN + '（不给率，小样本的百分比会被当成精度）'
      };
    }).sort(function (a, b) { return b.n - a.n; });

    /* ---------- 规则与象义可靠度：直接取 casebook 的口径，不另算一套 ---------- */
    if (CB && CB.calibrate) {
      var cal = CB.calibrate(cases);
      var rs = cal.rules || [], ss = cal.symbols || [];
      rep.rules = {
        total: rs.length,
        measurable: rs.filter(function (r) { return r.enough; }).length,
        minSamples: cal.minSamples,
        sampleHistogram: (function () {
          var h = { '1': 0, '2-3': 0, '4-7': 0, '8+': 0 };
          rs.forEach(function (r) {
            var n = r.ruleN + r.caseN;
            if (n >= 8) h['8+']++; else if (n >= 4) h['4-7']++; else if (n >= 2) h['2-3']++; else if (n >= 1) h['1']++;
          });
          return h;
        })(),
        top: rs.filter(function (r) { return r.enough; }).slice(0, 10).map(function (r) {
          return { ruleId: r.ruleId, display: r.display, misreadN: r.misreadN };
        }),
        mostBlamed: rs.filter(function (r) { return r.misreadN > 0; })
          .sort(function (a, b) { return b.misreadN - a.misreadN; }).slice(0, 8)
          .map(function (r) { return { ruleId: r.ruleId, misreadN: r.misreadN, display: r.display }; })
      };
      rep.symbols = {
        total: ss.length,
        measurable: ss.filter(function (s) { return s.enough; }).length,
        top: ss.filter(function (s) { return s.enough; }).slice(0, 8).map(function (s) {
          return { key: s.key, display: s.display, misreadN: s.misreadN };
        })
      };
    }

    /* ---------- 应期：命中率必须连随机基准一起给，否则「命中」会被当成灵验 ---------- */
    if (CB && CB.timingCalibration) {
      var tc = CB.timingCalibration(cases);
      rep.timing = {
        cases: tc.cases, baseline: tc.baseline,
        high: tc.high ? { n: tc.high.n, rate: tc.high.rate, baseline: tc.high.baseline, enough: tc.high.enough } : null,
        mechanisms: (tc.mechanisms || []).map(function (m) {
          return { mechanism: m.mechanism, display: m.display, enough: m.enough, rate: m.rate };
        }),
        _note: '全量锚点的随机基准往往逼近 1（十来个候选×多层，几乎必中），故只有 ★强子集与基准的差距才说明问题。'
      };
    }

    /* ---------- 断言：能算的只有「断错」这一侧，且要分清挂不挂得上证据 ---------- */
    var misTotal = 0, untraceable = 0, perCase = [];
    graded.forEach(function (c) {
      var ms = c.feedback.misreads || [];
      misTotal += ms.length; perCase.push(ms.length);
      ms.forEach(function (m) { if (!m || !String(m.basedOn || '').trim()) untraceable++; });
    });
    rep.claims = {
      misreadTotal: misTotal,
      perGradedCase: graded.length ? round(misTotal / graded.length, 2) : null,
      untraceable: untraceable,
      untraceableRate: pct(untraceable, misTotal),
      _note: '「挂不上证据的断错」＝复盘指出它错了、却指不出它依据本盘哪一条——' +
        '那多半是解读跑到了证据包之外。这是本评估器唯一能算的「未支撑断言」口径，' +
        '**不等于**全部断言里未支撑者的比例（那个分母案例本里没有）。'
    };

    /* ---------- 可核验性：实况太短则那条反馈本身就撑不起核验 ---------- */
    var lens = graded.map(function (c) { return String(c.feedback.actual || '').length; });
    rep.verifiability = {
      actualMedianChars: median(lens),
      tooShort: lens.filter(function (x) { return x < SHORT_ACTUAL; }).length,
      tooShortRate: pct(lens.filter(function (x) { return x < SHORT_ACTUAL; }).length, graded.length),
      threshold: SHORT_ACTUAL,
      _note: '实况不足 ' + SHORT_ACTUAL + ' 字者，往往只够判「大体中没中」，不足以核验方位、应期、数量这类具体断言。' +
        '这类案例进得了整卦档位统计，撑不起逐条核验。'
    };

    /* ---------- 校准曲线：说是 A 级的，后来对了几成 ---------- */
    var tiers = {};
    graded.forEach(function (c) {
      var cv = c.converge, dv = (c.feedback && c.feedback.dimVerdicts) || null;
      if (!cv || !cv.dims || !dv) return;
      cv.dims.forEach(function (d) {
        var v = dv[d.dim];
        if (!v) return;
        var t = (tiers[d.tier] = tiers[d.tier] || { tier: d.tier, n: 0, score: 0 });
        t.n++;
        t.score += (v === 'happened' ? 1 : v === 'partial' ? 0.5 : 0);
      });
    });
    var tierRows = Object.keys(tiers).sort().map(function (k) {
      var t = tiers[k];
      var enough = t.n >= minN;
      return {
        tier: t.tier, n: t.n, enough: enough,
        rate: enough ? round(t.score / t.n) : null,
        display: enough ? (Math.round(100 * t.score / t.n) + '%（' + t.n + ' 例）')
          : ('样本不足 ' + t.n + '/' + minN)
      };
    });
    rep.calibration = {
      rows: tierRows, total: tierRows.reduce(function (s, r) { return s + r.n; }, 0),
      _note: '档位若名副其实，A 级的符合率应明显高于 B、B 高于 C。' +
        '这一项需要新案例——旧案例存档时还没有合流档位与逐维度标注。'
    };

    /* ---------- 明说算不了的，以及为什么 ---------- */
    rep.notMeasured = [
      { metric: '逐条断言准确率', why: '案例本只记了**断错**的断言（misreads），未记全部断言；分母不存在。要算须在解读侧先把断言结构化存下。' },
      { metric: '方位/处所属性准确率', why: '预测侧没有结构化存下「断的是哪个方位/处所」，只有自由文本。要算须让证据合流层把候选与最终采用值一并入案。' },
      { metric: '时辰级应期准确率', why: '仅 ' + rep.coverage.withTime + '% 的案例填了实际时刻（' +
          graded.filter(function (c) { return c.feedback.happenedTime; }).length + '/' + graded.length + '），样本不足以成率。' },
      { metric: '置信度校准曲线', why: rep.calibration.total
          ? ('已开始可算：现有 ' + rep.calibration.total + ' 条带档位的逐维度标注，达 ' + minN + ' 例的档位才出率。')
          : '尚无数据。本版起，新案例会存下合流档位；复盘时逐维度标一下，此项即可开始累积。' },
      { metric: '改动前后的因果效应', why: '本报告是横截面，不是对照实验。要归因某次改动，须比对**改动前后各自积累**的案例，且盘与问题分布相当。' }
    ];
    return rep;
  }

  /** 报告 → 可读文本。刻意不加任何解读性结论，只铺数字与口径。 */
  function toReport(r) {
    if (!r || !r.n) return '';
    // 空案例本也要给一句交代，而不是抛错——本项目的一贯口径：坏数据不阻断，如实说明
    if (!r.n.cases) {
      return '【案例本评估 Evaluate v' + r.version + '】案例本为空，无从评估。\n' +
        '先解读几卦、点「存为案例」，事后回填结果，再回来生成报告。';
    }
    var L = [];
    function line(k, v) { L.push('  ' + k + '：' + v); }
    L.push('【案例本评估 Evaluate v' + r.version + '】' + r.fingerprint);
    L.push('生成于 ' + r.generatedAt);
    L.push('');
    L.push('■ 覆盖率（决定后面哪些数字有意义）');
    line('已回填', r.coverage.gradedRate + '%（' + r.n.graded + '/' + r.n.cases + '）');
    line('存了解读全文', r.coverage.withAnswer + '%');
    line('做了逐条标注', r.coverage.withVerdicts + '%');
    line('填了实际日期', r.coverage.withDate + '%　填了实际时刻 ' + r.coverage.withTime + '%');
    line('有断错分析', r.coverage.withMisreads + '%　已拆多问 ' + r.coverage.withParts + '%');
    L.push('');
    L.push('■ 结果分布（n=' + r.n.graded + '）');
    line('完全应验', r.outcomes.exactRate + '%（' + r.outcomes.counts.happened + '）');
    line('部分应验', r.outcomes.partialRate + '%（' + r.outcomes.counts.partial + '）');
    line('未应验/结果相反', r.outcomes.failRate + '%（' + (r.outcomes.counts.not_happened + r.outcomes.counts.opposite) +
      '，其中结果相反 ' + r.outcomes.counts.opposite + '）');
    line('加权分', r.outcomes.weightedScore + '　' + r.outcomes._note);
    L.push('');
    L.push('■ 按占类');
    r.byDomain.forEach(function (d) { line(d.domain + '(n=' + d.n + ')', d.display); });
    L.push('');
    if (r.rules && r.rules.total != null) {
      L.push('■ 规则可靠度（分支级）');
      line('条目总数', r.rules.total + '　达 ' + r.rules.minSamples + ' 例门槛者 ' + r.rules.measurable + ' 条');
      line('样本分布', 'n=1: ' + r.rules.sampleHistogram['1'] + '　n=2-3: ' + r.rules.sampleHistogram['2-3'] +
        '　n=4-7: ' + r.rules.sampleHistogram['4-7'] + '　n≥8: ' + r.rules.sampleHistogram['8+']);
      r.rules.top.forEach(function (x) { line('  ' + x.ruleId, x.display + (x.misreadN ? '　被指错 ' + x.misreadN : '')); });
      if (r.rules.mostBlamed.length) {
        L.push('  被指为断错依据最多者（与符合率是两个独立信号）：');
        r.rules.mostBlamed.forEach(function (x) { L.push('    · ' + x.ruleId + '　被指错 ' + x.misreadN + '　' + x.display); });
      }
      L.push('');
    }
    if (r.timing && r.timing.cases != null) {
      L.push('■ 应期（n=' + r.timing.cases + '）');
      if (r.timing.high) {
        line('★强锚点', (r.timing.high.enough ? (Math.round(r.timing.high.rate * 100) + '%') : '样本不足') +
          '　随机基准 ' + (r.timing.high.baseline == null ? '—' : Math.round(r.timing.high.baseline * 100) + '%'));
      }
      line('全量基准', (r.timing.baseline == null ? '—' : Math.round(r.timing.baseline * 100) + '%') + '　' + r.timing._note);
      L.push('');
    }
    L.push('■ 断错与未支撑断言');
    line('断错分析总数', r.claims.misreadTotal + '　平均每例 ' + r.claims.perGradedCase + ' 条');
    line('挂不上证据者', r.claims.untraceable + '（' + r.claims.untraceableRate + '%）');
    L.push('  ' + r.claims._note);
    L.push('');
    L.push('■ 可核验性');
    line('实况文本中位字数', r.verifiability.actualMedianChars);
    line('不足 ' + r.verifiability.threshold + ' 字者', r.verifiability.tooShort + '（' + r.verifiability.tooShortRate + '%）');
    L.push('  ' + r.verifiability._note);
    L.push('');
    if (r.calibration && r.calibration.rows.length) {
      L.push('■ 档位校准（说是 A 级的，后来对了几成）');
      r.calibration.rows.forEach(function (x) { line(x.tier + '级', x.display); });
      L.push('  ' + r.calibration._note);
      L.push('');
    }
    L.push('■ 本报告**算不了**的指标（列出来，免得被人当成没测或测过了）');
    r.notMeasured.forEach(function (x) { L.push('  · ' + x.metric + '：' + x.why); });
    return L.join('\n');
  }

  var api = { VERSION: VERSION, evaluate: evaluate, toReport: toReport, SHORT_ACTUAL: SHORT_ACTUAL };

  // Node 下可直接当命令行用：node core/evaluate.js <导出的案例本.json>
  if (typeof module === 'object' && module.exports && require.main === module) {
    var file = process.argv[2];
    if (!file) { console.error('用法：node core/evaluate.js <案例本导出.json> [--json]'); process.exit(1); }
    var data = JSON.parse(require('fs').readFileSync(file, 'utf8'));
    var rep = evaluate(data);
    console.log(process.argv.indexOf('--json') >= 0 ? JSON.stringify(rep, null, 2) : toReport(rep));
  }
  return api;
});
