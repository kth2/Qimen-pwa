/**
 * 奇门·复盘正解与规则修订(Revise) core —— 纯函数、无副作用、可移植。【Phase 6】
 *
 * 这一层回答三件事：
 *   ① **修正当时的分析**：拿实况回头看那一盘，按纲要正确地断该是什么样？原断法偏在哪条证据上？
 *   ② **反推规则偏差**：把「部分应验/未应验/结果相反」的案例聚起来，反推易理，产出候选修订。
 *   ③ **应验者作反证**：一条修订若与已应验的案例矛盾，就该被拦下——8 例应验不该被 2 例未应验推翻。
 *
 * 【为什么修订落在独立层，而不是改 knowledge/domain-rules.json】
 *   纲要层的价值在于「每条规则都能追溯到《解断方法纲要》的某一条」。一旦把反推出来的东西
 *   写回去，basis 就成了假话——它不再是纲要说的。故修订自成一集(revision set)：
 *   纲要文件一字不动，修订带着自己的出处（易理依据 + 支撑案例 id + 冲突案例 id）另行存放，
 *   可导出、可停用、可逐条查看。确定性也没丢，只是从「同盘同占类」变成
 *   「同盘 + 同占类 + 同修订集」——故修订集带哈希，随证据包一并呈现。
 *
 * 【最要紧的一条硬约束：修订只能收窄，不能新造】
 *   允许的操作只有三种：narrow(追加条件，收窄适用范围) / reweight(调权重) / mute(停用)。
 *   **不允许从错例反推出一条全新规则**——象数系统里任何结果都能被事后圆回来，
 *   放开新造断法，等于让应用自创一套没有出处的奇门。收窄与降权则不同：
 *   它们只会让应用「少说」，说错的风险单调下降。
 *
 * 【防事后诸葛亮】
 *   正解与偏差反推都必须指向**当时证据里已有的具体条目**；指不出来时，必须如实回答
 *   「按纲要断不出此结果」。这个出口是刻意留的——没有它，模型每次都能编出一套自洽的说法。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Revise = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '6.0.0';

  // 允许的修订操作。**没有 add/create**——见文件头「只能收窄，不能新造」。
  var OPS = {
    narrow: '收窄适用范围（追加一个必须同时满足的条件）',
    reweight: '调整权重（改变着墨详略，不改变取用）',
    mute: '停用此条（本机不再产出该判读）'
  };
  var OP_KEYS = ['narrow', 'reweight', 'mute'];

  // 生成候选修订所需的最少失败案例数。低于此数不谈修订——
  // 两三例不顺就改规则，改的是噪音不是偏差。
  var MIN_FAIL_CASES = 4;
  // 一条修订若与这么多已应验案例冲突，直接拦下
  var MAX_CONFLICTS = 1;
  // 权重调整幅度上限：修订只该微调详略，不该把 ★5 压成 ★1
  var MAX_WEIGHT_DELTA = 2;

  var FAIL_OUTCOMES = ['partial', 'not_happened', 'opposite'];

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  /**
   * 与 casebook.statKey 同一把键：宫际关系按**分支**统计与修订。
   * 一条 relation id 底下六种互斥读法准头天差地别（实测：同一条规则「彼宫生我宫」3 例全中、
   * 「二者同落一宫」5 例只中 1），混作一条既看不出问题，也没法只收窄其中一支——
   * mute 整条会把准的那一支一起杀掉。
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
  function graded(rec) { return !!(rec && rec.feedback && rec.feedback.outcome); }
  function isFail(rec) { return graded(rec) && FAIL_OUTCOMES.indexOf(rec.feedback.outcome) >= 0; }
  function isHit(rec) { return graded(rec) && rec.feedback.outcome === 'happened'; }

  /** 稳定哈希：修订集参与规则求值，必须能一眼看出「这次用的是哪一版修订」。 */
  function hashOf(revisions) {
    var s = (revisions || []).map(function (r) {
      return [r.id, r.ruleId, r.op, JSON.stringify(r.payload || {})].join('|');
    }).sort().join('\n');
    var h = 5381, i;
    for (i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  /* ================= ① 复盘正解 ================= */

  /**
   * 「当时该怎么断」的提示词。
   * 关键设计：**必须指出偏在哪条已有证据上**，且必须保留「断不出来」这个出口。
   * 没有这个出口，模型会把任何结果都圆成一套自洽的说法——那不是复盘，是编故事。
   */
  function correctionPrompt(rec, actualText, methodNote) {
    var rules = (rec && rec.fired && rec.fired.rules) || [];
    var syms = (rec && rec.fired && rec.fired.symbols) || [];
    var answer = String(rec && rec.answer || '').slice(0, 3000);
    return [
      '你在为一则奇门占例写**正解**：已知实际结果，回头看当时那一盘，',
      '按《解断方法纲要》**正确地断**应该是什么样，以及当时那份解读偏在哪里。',
      '',
      '【当时盘上的判读条目（规则层，有纲要出处）】',
      rules.length ? rules.map(function (r) {
        return '- ' + r.id + ' ｜ ' + r.label + ' → ' + r.concept +
          ' ｜ 倾向：' + (r.polarity === '+' ? '助' : r.polarity === '-' ? '阻' : '中');
      }).join('\n') : '（本占类规则库未覆盖）',
      '',
      '【当时盘上的象义（用神落宫与同宫之象）】',
      syms.length ? syms.map(function (s) {
        return '- ' + s.key + ' ｜ ' + s.label +
          (s.withEls.length ? ' ｜ 同宫：' + s.withEls.join('/') : '') +
          (s.words.length ? ' ｜ 象义：' + s.words.join('、') : '');
      }).join('\n') : '（无）',
      '',
      '【当时给出的解读】',
      answer || '（未记录）',
      '',
      '【实际结果】',
      actualText || '（未填写）',
      '',
      methodNote ? '【本占类边界】' + methodNote + '\n' : '',
      '【要求——这几条是防止你事后圆说的，务必遵守】',
      '1. 正解**只能建立在上面已列出的条目之上**。不得引入盘上没有的元素，不得新造断法，',
      '   不得使用《解断方法纲要》之外的体系。',
      '2. 必须指明当时**具体偏在哪一条**：是某条判读被高估/低估了，还是某个象被漏看了。',
      '   逐条给出 itemId（规则 id 或 sym: 开头的象义 key）。指不出具体条目的，不要写。',
      '3. **如果按纲要根本断不出这个结果**，就如实说——把 verdict 设为 "not_derivable" 并说明',
      '   为何断不出（纲要未涉及此类事 / 盘上无相应之象 / 问法太笼统）。这是允许且重要的答案，',
      '   强行圆出一套说法比承认断不出更有害。',
      '4. 正解要写得像一份断语（结论 + 依据），而不是对实际结果的复述。',
      '5. 只输出 JSON，不要解释文字或代码块标记：',
      '{"verdict":"derivable|partly_derivable|not_derivable",',
      ' "correction":"当时正确的断语（含依据）",',
      ' "misweighted":[{"itemId":"规则id或sym:key","how":"overrated|underrated|missed","why":"依纲要该如何看"}],',
      ' "whyNotDerivable":"verdict 为 not_derivable 时填，否则空字符串"}'
    ].filter(Boolean).join('\n');
  }

  /** 解析正解。itemId 必须是本案真实存在的条目，编造的一律清空。 */
  function parseCorrection(text, rec) {
    var known = {};
    ((rec && rec.fired && rec.fired.rules) || []).forEach(function (r) { known[r.id] = 1; known[statKey(r)] = 1; });
    ((rec && rec.fired && rec.fired.symbols) || []).forEach(function (s) { known[s.key] = 1; });
    var empty = { ok: false, verdict: '', correction: '', misweighted: [], whyNotDerivable: '', dropped: [], error: '' };
    var raw = String(text || '').trim();
    var a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) { empty.error = '未找到 JSON'; return empty; }
    var obj;
    try { obj = JSON.parse(raw.slice(a, b + 1)); }
    catch (e) { empty.error = 'JSON 解析失败'; return empty; }

    var verdicts = ['derivable', 'partly_derivable', 'not_derivable'];
    var verdict = verdicts.indexOf(obj.verdict) >= 0 ? obj.verdict : '';
    if (!verdict) { empty.error = 'verdict 非法'; return empty; }

    var dropped = [], mis = [];
    var HOW = ['overrated', 'underrated', 'missed'];
    (Array.isArray(obj.misweighted) ? obj.misweighted : []).slice(0, 8).forEach(function (m) {
      if (!m || typeof m.itemId !== 'string') return;
      var id = m.itemId.trim();
      if (!known[id]) { dropped.push({ id: id, why: '本案无此条目' }); return; }
      if (HOW.indexOf(m.how) < 0) { dropped.push({ id: id, why: 'how 非法：' + m.how }); return; }
      mis.push({ itemId: id, how: m.how, why: String(m.why || '').slice(0, 300) });
    });
    return {
      ok: true, verdict: verdict,
      correction: String(obj.correction || '').slice(0, 2000),
      misweighted: mis,
      whyNotDerivable: verdict === 'not_derivable' ? String(obj.whyNotDerivable || '').slice(0, 500) : '',
      dropped: dropped, error: ''
    };
  }

  /* ================= ② 规则偏差反推 ================= */

  /**
   * 汇总某条规则在失败案例中的表现，供反推使用。
   * 只看**失败**案例——应验的那些走统计，不进反推（它们的作用是当反证，见 ③）。
   */
  function failureDigest(records, opts) {
    opts = opts || {};
    var minFail = opts.minFailCases || MIN_FAIL_CASES;
    var byRule = {};
    (records || []).forEach(function (rec) {
      if (!isFail(rec)) return;
      var fb = rec.feedback;
      ((rec.fired && rec.fired.rules) || []).forEach(function (r) {
        // 逐条标注优先：整案失败不代表这一条错了
        var v = (fb.ruleVerdicts || {})[statKey(r)] || (fb.ruleVerdicts || {})[r.id];
        var bad = v ? FAIL_OUTCOMES.indexOf(v) >= 0 : true;
        if (!bad) return;
        var key = statKey(r);
        if (!byRule[key]) {
          byRule[key] = {
            ruleId: key, baseRuleId: r.id, label: r.label, concept: r.concept, polarity: r.polarity,
            failN: 0, marked: 0, cases: [], misreads: []
          };
        }
        var s = byRule[key];
        s.failN++;
        if (v) s.marked++;
        if (s.cases.length < 12) s.cases.push(rec.id);
        (fb.misreads || []).forEach(function (m) {
          if ((m.basedOn === r.id || m.basedOn === key) && s.misreads.length < 5) {
            s.misreads.push({ claim: m.claim, actual: m.actual, caseId: rec.id });
          }
        });
      });
    });
    return Object.keys(byRule).map(function (k) { return byRule[k]; })
      .filter(function (s) { return s.failN >= minFail; })
      .sort(function (a, b) { return b.failN - a.failN; });
  }

  /**
   * 反推提示词：从失败聚类推「偏在哪、易理上为什么、该如何收窄」。
   * 明确禁止新造规则——只许收窄/降权/停用。
   */
  function biasPrompt(digest, domainLabel) {
    return [
      '你在为一套奇门规则做**偏差反推**：下面是本机实测中反复不应验的规则条目，',
      '连同用户填写的实际情况。请据《解断方法纲要》的易理，判断这些条目偏在哪里。',
      '',
      '【占类】' + (domainLabel || '未指明'),
      '',
      '【反复不应验的条目】',
      digest.map(function (s) {
        return [
          '- ' + s.ruleId,
          '  判读：' + s.label + ' → ' + s.concept + '（倾向：' + (s.polarity === '+' ? '助' : s.polarity === '-' ? '阻' : '中') + '）',
          '  不应验 ' + s.failN + ' 次' + (s.marked ? '（其中 ' + s.marked + ' 次为逐条标注，较可信）' : '（均为整案归因，较粗）'),
          s.misreads.length ? '  实测断错例：' + s.misreads.map(function (m) {
            return '「' + m.claim + '」→ 实际：' + m.actual;
          }).join('；') : ''
        ].filter(Boolean).join('\n');
      }).join('\n'),
      '',
      '【要求——这几条是硬约束】',
      '1. 只能提出三种修订，**不得新造规则、不得改变取用、不得引入纲要之外的体系**：',
      '   narrow  —— 收窄适用范围：追加一个必须同时满足的条件（如仅在某旺衰、某四害、某宫时才成立）',
      '   reweight—— 调整权重：改变着墨详略（delta 取 -2..+2 的整数）',
      '   mute    —— 停用此条',
      '   为什么不许新造：象数系统里任何结果都能被事后圆回来。收窄与降权只会让应用「少说」，',
      '   说错的风险单调下降；新造断法则是凭几个案例自创一套没有出处的奇门。',
      '2. 每条修订必须给出 **reasoning：反推的易理依据**——要落到五行生克、旺衰、四害、',
      '   门宫格、宫位象这些纲要已有的道理上，说明「为什么这条在那种情形下不成立」。',
      '   给不出易理依据的，不要提。',
      '3. 若某条其实没问题、是解读时用错了（把倾向说成了必然之类），请标 op 为 "none" 并说明——',
      '   那要改的是解读纪律，不是规则。',
      '4. 只输出 JSON：',
      '{"revisions":[{"ruleId":"…","op":"narrow|reweight|mute|none",',
      ' "payload":{"when":{"state":["休","囚","死"]}} 或 {"delta":-1} 或 {},',
      ' "reasoning":"反推的易理依据","confidence":"high|medium|low"}]}',
      '',
      'narrow 的 payload.when 只能用这几个键：state（旺相休囚死）、gongState、',
      'flags（空亡/门迫/驿马/入墓/击刑）、with（同宫某元素）、gong（宫号）。'
    ].join('\n');
  }

  /** 解析候选修订。ruleId 必须已知，op 必须合法，payload 必须与 op 匹配，reasoning 必填。 */
  function parseBias(text, knownRuleIds) {
    var known = {};
    (knownRuleIds || []).forEach(function (k) { known[k] = 1; });
    var out = { ok: false, revisions: [], notes: [], dropped: [], error: '' };
    var raw = String(text || '').trim();
    var a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) { out.error = '未找到 JSON'; return out; }
    var obj;
    try { obj = JSON.parse(raw.slice(a, b + 1)); }
    catch (e) { out.error = 'JSON 解析失败'; return out; }

    var WHEN_KEYS = ['state', 'gongState', 'flags', 'with', 'gong'];
    (Array.isArray(obj.revisions) ? obj.revisions : []).slice(0, 20).forEach(function (r) {
      if (!r || typeof r.ruleId !== 'string') return;
      var id = r.ruleId.trim();
      if (!known[id]) { out.dropped.push({ id: id, why: '规则库中无此条' }); return; }
      // 门槛按中文算：「土重埋金之故」才 6 字，已是完整的易理陈述。
      // 定太高会把真依据当成缺依据丢掉；定太低又拦不住「因为不准」这类废话。
      if (!r.reasoning || String(r.reasoning).trim().length < 6) {
        out.dropped.push({ id: id, why: '缺易理依据' }); return;
      }
      if (r.op === 'none') {
        out.notes.push({ ruleId: id, reasoning: String(r.reasoning).slice(0, 400) });
        return;
      }
      if (OP_KEYS.indexOf(r.op) < 0) { out.dropped.push({ id: id, why: 'op 非法：' + r.op }); return; }
      var payload = {};
      if (r.op === 'narrow') {
        var w = (r.payload && r.payload.when) || {};
        var kept = {};
        Object.keys(w).forEach(function (k) {
          if (WHEN_KEYS.indexOf(k) < 0) return;      // 未知条件键一律丢弃，不让模型自造 DSL
          kept[k] = w[k];
        });
        if (!Object.keys(kept).length) { out.dropped.push({ id: id, why: 'narrow 缺合法条件' }); return; }
        payload = { when: kept };
      } else if (r.op === 'reweight') {
        var d = Math.round(Number((r.payload || {}).delta));
        if (!isFinite(d) || d === 0) { out.dropped.push({ id: id, why: 'reweight 缺有效 delta' }); return; }
        payload = { delta: clamp(d, -MAX_WEIGHT_DELTA, MAX_WEIGHT_DELTA) };
      }
      out.revisions.push({
        ruleId: id, op: r.op, payload: payload,
        reasoning: String(r.reasoning).slice(0, 600),
        confidence: ['high', 'medium', 'low'].indexOf(r.confidence) >= 0 ? r.confidence : 'medium'
      });
    });
    out.ok = true;
    return out;
  }

  /* ================= ③ 应验案例作反证 ================= */

  /**
   * 冲突检查：一条修订若会让**已应验**的案例失去其判读，就说明它收得太狠。
   * 8 例应验不该被 2 例未应验推翻——这是本层最重要的刹车。
   *
   * 判定方式：该规则在应验案例中触发过，且用户没把它单独标为不符 → 计为一次冲突。
   * mute 与 narrow 都会让这些案例里的该条判读消失，故一并计入。
   */
  function conflictCheck(revision, records, opts) {
    opts = opts || {};
    var maxConf = opts.maxConflicts == null ? MAX_CONFLICTS : opts.maxConflicts;
    var conflicts = [], supports = [];
    (records || []).forEach(function (rec) {
      if (!graded(rec)) return;
      var fired = ((rec.fired && rec.fired.rules) || []).some(function (r) {
        return statKey(r) === revision.ruleId || r.id === revision.ruleId;
      });
      if (!fired) return;
      var v = (rec.feedback.ruleVerdicts || {})[revision.ruleId];
      var itemOk = v ? v === 'happened' : isHit(rec);
      var itemBad = v ? FAIL_OUTCOMES.indexOf(v) >= 0 : isFail(rec);
      if (itemOk) conflicts.push({ caseId: rec.id, question: rec.question, marked: !!v });
      else if (itemBad) supports.push({ caseId: rec.id, question: rec.question, marked: !!v });
    });
    // reweight 只改详略、不改取用，故不因应验案例而拦下——但仍如实报出计数
    var blocking = revision.op !== 'reweight' && conflicts.length > maxConf;
    return {
      ruleId: revision.ruleId, op: revision.op,
      conflicts: conflicts, supports: supports,
      conflictN: conflicts.length, supportN: supports.length,
      blocked: blocking,
      reason: blocking
        ? '该条在 ' + conflicts.length + ' 例**已应验**案例中也曾触发；' +
          '仅凭 ' + supports.length + ' 例不应验就收窄/停用，会连带损害那些断对的情形。'
        : ''
    };
  }

  /** 批量评审：把候选修订与冲突检查合并成可供人工采纳的清单。 */
  function review(candidates, records, opts) {
    return (candidates || []).map(function (r) {
      var c = conflictCheck(r, records, opts);
      return {
        revision: r, check: c,
        recommend: c.blocked ? 'reject' : (c.supportN >= MIN_FAIL_CASES ? 'accept' : 'hold'),
        recommendWhy: c.blocked ? c.reason
          : (c.supportN >= MIN_FAIL_CASES
            ? '有 ' + c.supportN + ' 例不应验支撑，且未与已应验案例冲突。'
            : '支撑仅 ' + c.supportN + ' 例，尚不足以动规则（需 ' + MIN_FAIL_CASES + ' 例）。')
      };
    });
  }

  /* ================= 修订集 ================= */

  /** 采纳：生成一条带完整出处的修订记录。 */
  function adopt(reviewed, now) {
    var r = reviewed.revision, c = reviewed.check;
    return {
      id: 'rev-' + r.ruleId + '-' + r.op,
      ruleId: r.ruleId, op: r.op, payload: r.payload,
      reasoning: r.reasoning, confidence: r.confidence,
      supportCases: c.supports.map(function (x) { return x.caseId; }),
      conflictCases: c.conflicts.map(function (x) { return x.caseId; }),
      adoptedAt: now || '', enabled: true,
      // 出处三件套：这条修订不是纲要说的，而是从这些案例反推来的，理由在此
      provenance: '本机经验修订（非《解断方法纲要》）：据 ' + c.supportN + ' 例不应验反推'
    };
  }

  /** 只取启用中的，并按 ruleId 建索引，供 XiangYi 求值时查。 */
  function indexRevisions(revisions) {
    var byRule = {}, active = [];
    (revisions || []).forEach(function (r) {
      if (!r || !r.enabled || !r.ruleId || OP_KEYS.indexOf(r.op) < 0) return;
      byRule[r.ruleId] = r;
      active.push(r);
    });
    return { byRule: byRule, list: active, hash: hashOf(active), count: active.length };
  }

  return {
    VERSION: VERSION, OPS: OPS, OP_KEYS: OP_KEYS, statKey: statKey,
    MIN_FAIL_CASES: MIN_FAIL_CASES, MAX_WEIGHT_DELTA: MAX_WEIGHT_DELTA,
    isFail: isFail, isHit: isHit,
    correctionPrompt: correctionPrompt, parseCorrection: parseCorrection,
    failureDigest: failureDigest, biasPrompt: biasPrompt, parseBias: parseBias,
    conflictCheck: conflictCheck, review: review, adopt: adopt,
    indexRevisions: indexRevisions, hashOf: hashOf
  };
});
