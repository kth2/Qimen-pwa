/**
 * Phase 23 据案例本复盘改纲领 回归测试（纯 Node，无框架）。
 * 运行：node core/casefeedback.test.js
 *
 * 本期的改动**一条都不是我想出来的**，全部出自用户 2026-09-07 导出的案例本
 * （159 例／152 回填／353 条断错分析）。故本文件钉的是两样东西：
 *   ① 改了的地方，其**样本数与符合率必须随条记下**——日后回看才知道当初凭什么改；
 *   ② 数据**不支持**的地方必须原样承认不改（取数 13 例分不出方向、吟局仅 4 例），
 *      不许把「样本不足」偷偷写成「已验证」。
 *
 * 最要紧的一条是 E28：旺衰与四害只论分量、不论有无。
 * 353 条断错里，以力量/四害为由推出「不成／排除该选项／伤轻」者 15 条，实况逐条相反，
 * 其中两条是拿力弱去排除射覆选项（实际正是被排除那项）、一条断车祸伤者「伤情相对可控」
 * （实际去世）。这不是新立的规矩——纲要解读流程 3.5 本就写着「吉凶定方向，
 * 旺衰定成败大小与迟速」，是本仓的用法把分量读成了有无。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

var ROOT = path.join(__dirname, '..');
var APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
var RULES = require('../knowledge/domain-rules.json');
var SEV = require('../knowledge/severity-rules.json');
var QS = require('../knowledge/qushu-rules.json');
var YJ = require('../knowledge/yinju-rules.json');
var ZP = fs.readFileSync(path.join(ROOT, 'assets', 'zhuanpan-method.md'), 'utf8');

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function condOf(id) {
  var out = null;
  Object.keys(RULES.domains).forEach(function (dm) {
    (RULES.domains[dm].conditions || []).forEach(function (c) { if (c.id === id) out = c; });
  });
  return out;
}

console.log('\n== E28：旺衰四害只论分量，不论有无 ==');
t('纲要本就这么写——不是新立的规矩，故可引原文', function () {
  assert.ok(/吉凶定方向，旺衰定成败大小与迟速/.test(ZP),
    '纲要解读流程 3.5 应有此句；若纲要改了，本期的立论前提也要重议');
  // 四害表通篇是分量语，没有一处说「无此事」
  var seg = ZP.slice(ZP.indexOf('### 奇门四害'), ZP.indexOf('### 奇门四害') + 900);
  assert.ok(/减半/.test(seg) && /仅余约两成/.test(seg), '四害表应为分量语');
});
t('severity 的 mustDo 里写死了三条硬禁', function () {
  var all = SEV.mustDo.join('\n');
  assert.ok(/只论「分量」，不论「有无」/.test(all), '缺总纲');
  assert.ok(/不得以某宫力弱断/.test(all), '缺「不得断不成」');
  assert.ok(/不得拿力弱或空亡去排除射覆、选择题的某个选项/.test(all), '缺「不得排除选项」');
  assert.ok(/不得以某人年命宫力弱断其/.test(all), '缺「不得断伤轻」');
});
t('越界的实测记录在案：15 例、三条最严重者逐条留名', function () {
  var m = SEV._measuredOverreach;
  assert.ok(m, '缺 _measuredOverreach');
  assert.ok(/15 条，实况逐条相反/.test(m.sample), '样本数须写明');
  assert.strictEqual(m.worst.length, 3, '三条最严重者须留名');
  assert.ok(m.worst.some(function (x) { return /腰椎间盘/.test(x); }));
  assert.ok(m.worst.some(function (x) { return /阿姨冲突/.test(x); }));
  assert.ok(m.worst.some(function (x) { return /去世/.test(x); }));
});
t('两级出处分得开：纲要本有之意 vs 本次所补的推论', function () {
  var m = SEV._measuredOverreach;
  assert.ok(/纲要本有此意而未被照办/.test(m.basis), '须说明纲要本有此意');
  assert.ok(/纲要未明言/.test(m._addedRule) && /用户所定·2026-09-07/.test(m._addedRule),
    '「不得排除选项/断伤轻」这一步须标为本次所补');
});
t('E28 已进系统提示词，三条硬禁与实测数俱在', function () {
  assert.ok(/E28\./.test(APP));
  var seg = APP.slice(APP.indexOf('E28.'), APP.indexOf('E29.'));
  assert.ok(/只论「分量」，不论「有无」/.test(seg));
  assert.ok(/不得拿力弱或空亡去排除射覆、选择题的某个选项/.test(seg));
  assert.ok(/15 条，实况逐条相反/.test(seg), '须带上样本数');
  assert.ok(/吉凶定方向，旺衰定成败大小与迟速/.test(seg), '须点明这是纲要本有之意');
});

console.log('\n== E29：应期实测偏晚 12:1 ==');
t('E29 已进系统提示词，且点名 offset 0 是正当候选', function () {
  assert.ok(/E29\./.test(APP));
  var seg = APP.slice(APP.indexOf('E29.'), APP.indexOf('E20.'));
  assert.ok(/offset 0/.test(seg), '须点名 offset 0');
  assert.ok(/断得比实际晚者 12 例、早者 1 例/.test(seg), '须带上 12:1');
  assert.ok(/不是「此刻不能应」的禁令/.test(seg), '须澄清空亡填实是应期之说');
  assert.ok(/纲要只写了填实冲实之法，未言早晚/.test(seg), '须说明纲要未言早晚');
});
t('TIMING 段本身也把「当下这一档」摆出来（提示词里模型真正看的是这一份）', function () {
  var EVS = fs.readFileSync(path.join(ROOT, 'core', 'evidence.js'), 'utf8');
  assert.ok(/先看「当下这一档」/.test(EVS), '证据包的 TIMING 段未加告诫');
  assert.ok(/offset === 0/.test(EVS), '未从 byUnit 里挑出 offset 0 的锚点');
  var TM = fs.readFileSync(path.join(ROOT, 'core', 'timing.js'), 'utf8');
  assert.ok(/先看「当下这一档」/.test(TM), 'timing 独立块也应一致（两处口径不许分家）');
});
t('offset 0 的锚点本就算得出来——这不是新增机制，是从没被优先看过', function () {
  var TM = fs.readFileSync(path.join(ROOT, 'core', 'timing.js'), 'utf8');
  assert.ok(/off === 0 \? '即今日'/.test(TM), '日一级的 offset 0 措辞');
  assert.ok(/off === 0 \? '即当下这个时辰'/.test(TM), '时一级的 offset 0 措辞');
});

console.log('\n== 五条实测低命中率条目：收窄并记下样本 ==');
[['general.时干.休囚死', '36%', 11],
 ['general.值符.宫休囚死', '44%', 8],
 ['general.值使.宫休囚死', '45%', 11]].forEach(function (row) {
  t('收窄 ' + row[0] + '（实测 ' + row[1] + '，' + row[2] + ' 例）', function () {
    var c = condOf(row[0]);
    assert.ok(c, '条目不存在');
    assert.ok(c.answers && /力量与迟速/.test(c.answers), '须限定为「力量与迟速」');
    assert.ok(/不断成/.test(c.answersNote) || /不断成与不成/.test(c.answersNote), '须明写不断成败');
    assert.ok(c._measured && c._measured.rate === row[1] && c._measured.n === row[2],
      '样本数与符合率须随条记下');
    assert.ok(/用户所定·2026-09-07/.test(c._measured.provenance), '须标出处');
    // 教义不改：basis 仍是纲要原文，收窄只加在 answers/answersNote 上
    assert.ok(/纲要/.test(c.basis), 'basis 应仍引纲要——教义层不因反馈改写');
  });
});
t('收窄 general.rel.日干-时干#我宫克彼宫（46%，12 例，被指错 5 次·全仓之最）', function () {
  var r = null;
  Object.keys(RULES.domains).forEach(function (dm) {
    (RULES.domains[dm].relations || []).forEach(function (x) { if (x.id === 'general.rel.日干-时干') r = x; });
  });
  assert.ok(r, '关系条目不存在');
  var m = r.map.from_ke_to;
  assert.ok(m._measured && m._measured.n === 12 && m._measured.citedAsMisread === 5, '样本须记下');
  assert.ok(/不答「此事成不成」/.test(m.answersNote), '须限定范围');
  assert.ok(/我能制之只表谋为可成/.test(m._measured.note), '须点出 severity 早有此戒仍被越界');
});
t('lost_item 玄武两条：旺衰只管遮蔽，不管得失', function () {
  var a = condOf('lost_item.玄武.宫休囚死'), b = condOf('lost_item.玄武.宫旺相');
  assert.ok(a && b);
  assert.ok(/绝不据以断「能否寻回」/.test(a.answersNote), '休囚死一条须禁断得失');
  assert.ok(a._measured.n === 12 && a._measured.citedAsMisread === 4);
  assert.ok(/不答能否寻回/.test(b.answers), '旺相一条也须限定');
  assert.ok(/深浅与得失是两件事/.test(b.answersNote));
  // 两面反例都要在，免得日后只记得一面
  assert.ok(/旺相得生.*没找到/.test(a.answersNote.replace(/\s/g, '')) ||
            /失物未远，能找回」→ 没找到/.test(a.answersNote), '缺旺相那一面的反例');
});

console.log('\n== 数据不支持的，原样承认不改 ==');
t('取数：13 例分不出方向，不加任何修正系数', function () {
  var f = QS._measured.firstData;
  assert.ok(f, '缺第一批数据');
  assert.ok(/偏低 9 条、偏高 4 条/.test(f.direction));
  assert.ok(/不足以断定本层系统性偏低或偏高/.test(f.direction), '不得声称有方向');
  assert.ok(/不改数源、不改组合法、不加偏差修正/.test(f.whatFollows), '不得偷偷加系数');
});
t('取数：宫数一路仅有的两条实测记录皆为反例，且照实说', function () {
  var f = QS._measured.firstData;
  assert.ok(/皆为反例/.test(f.gongNumberCases), '须承认两条都是反例');
  assert.ok(/绝不能说它有效/.test(f.gongNumberCases), '不得因样本少就含糊过去');
  assert.ok(/仍无定论/.test(QS._measured._effectNotMeasured), '效应仍须标为未定');
});
t('吟局：4 例带反馈，明写样本不足、不作调整', function () {
  var m = YJ._measuredOutcome;
  assert.ok(m, '缺记录');
  assert.ok(/样本不足，不作任何调整/.test(m.verdict));
  assert.ok(/必多次往返/.test(m.oneCounterExample) && /纲要无此文/.test(m.oneCounterExample),
    '那条反例的性质（用法之误，非吟局之误）须写清');
});
t('教义层未被反馈改写：纲要两文件原样未动', function () {
  // 本期一个字都没改纲要。改的是 app 的判读层，且逐条标了出处与样本数。
  // 纲要原文这句带着 markdown 粗体（「**休囚死**→…」），故按去掉星号后比对
  assert.ok(/休囚死\*\*→力弱、难成、应迟/.test(ZP) || /休囚死→力弱、难成、应迟/.test(ZP),
    '纲要原句应仍在——本仓的做法是收窄用法，不是回头改教义');
  var c = condOf('general.时干.休囚死');
  assert.ok(/休囚死→力弱、难成、应迟/.test(c.basis), 'basis 仍照录纲要原句');
  assert.ok(/不断成与不成/.test(c.answersNote), '限制加在 answersNote，不动 basis');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
