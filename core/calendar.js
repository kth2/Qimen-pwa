/**
 * 万年历（纯函数，奇门 app 与奇门穿壬共用）。历法全用 tyme4ts（6tail）；四柱与排盘引擎逐时辰比对一致（core/calendar.test.js）：
 *   · 年柱以立春换年，月柱以节换月（都在交节那一刻换，交节当天前后不同），日柱以零点换日；
 *     23:00 后的夜子时算次日（与奇门引擎一致）。
 * 调用方把 tyme4ts 传进来（浏览器是全局 tyme4ts，Node 是 require('tyme4ts')），本文件不自己载入。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WanNianLi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WEEK = '日一二三四五六';
  const ZHI = '子丑寅卯辰巳午未申酉戌亥';
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  /** 一天的格子：公历、农历（初一显示月名）、日干支、节气、节日 */
  function cell(T, y, m, d) {
    const sd = T.SolarDay.fromYmd(y, m, d);
    const ld = sd.getLunarDay();
    const lm = ld.getLunarMonth();
    const td = sd.getTermDay();
    const term = td.getDayIndex() === 0 ? td.getSolarTerm().getName() : '';
    const fs = sd.getFestival(), fl = ld.getFestival();
    return {
      date: ymd(y, m, d), y, m, d,
      lunar: ld.getName() === '初一' ? lm.getName() : ld.getName(),
      lunarFull: ld.toString(),
      dayGZ: sd.getSixtyCycleDay().getSixtyCycle().getName(),
      term,
      festival: [fl && fl.getName(), fs && fs.getName()].filter(Boolean).join('·'),
      week: sd.getWeek().getIndex(),   // 0＝周日
    };
  }

  /**
   * 一个月的月历：一周从周一排起，前后用上下月补满整周。
   * @returns { y, m, title, cells: [cell & { inMonth }], terms: [{ name, date }], yearGZs }
   */
  function month(T, y, m) {
    const first = T.SolarDay.fromYmd(y, m, 1);
    const days = T.SolarMonth.fromYm(y, m).getDayCount();
    const lead = (first.getWeek().getIndex() + 6) % 7;   // 周一为 0
    const cells = [];
    for (let i = lead; i > 0; i--) {
      const sd = first.next(-i);
      cells.push(Object.assign(cell(T, sd.getYear(), sd.getMonth(), sd.getDay()), { inMonth: false }));
    }
    for (let d = 1; d <= days; d++) cells.push(Object.assign(cell(T, y, m, d), { inMonth: true }));
    let last = T.SolarDay.fromYmd(y, m, days);
    while (cells.length % 7) { last = last.next(1); cells.push(Object.assign(cell(T, last.getYear(), last.getMonth(), last.getDay()), { inMonth: false })); }
    const terms = cells.filter((c) => c.inMonth && c.term).map((c) => ({ name: c.term, date: c.date }));
    const yearGZs = [...new Set(cells.filter((c) => c.inMonth).map((c) => T.SolarDay.fromYmd(c.y, c.m, c.d).getSixtyCycleDay().getYear().getName()))];
    return { y, m, title: `${y} 年 ${m} 月`, cells, terms, yearGZs, weekHead: '一二三四五六日'.split('') };
  }

  /** 一天的详情：年月日柱、农历、节气、十二时辰的时柱（含 23 点后的夜子时，算次日） */
  function day(T, y, m, d) {
    const c = cell(T, y, m, d);
    const sd = T.SolarDay.fromYmd(y, m, d);
    const scd = sd.getSixtyCycleDay();
    const term = sd.getTermDay();
    const hourGZ = (h) => T.SolarTime.fromYmdHms(y, m, d, h, 0, 0).getSixtyCycleHour();
    const H = (h, o) => { const x = hourGZ(h); return Object.assign({ gz: x.getSixtyCycle().getName(), yearGZ: x.getYear().getName(), monthGZ: x.getMonth().getName(), h }, o); };
    const hours = [H(0, { zhi: '子', label: '早子', range: '00:00–00:59' })];
    for (let i = 1; i < 12; i++) {
      const h = i * 2;   // 丑 1–3 点取 2 点，……亥 21–23 点取 22 点
      hours.push(H(h, { zhi: ZHI[i], label: ZHI[i], range: `${pad(h - 1)}:00–${pad(h)}:59` }));
    }
    const late = hourGZ(23);
    hours.push(H(23, { zhi: '子', label: '夜子', range: '23:00–23:59', nextDay: late.getDay().getName() }));
    // 交「节」当天：年柱（立春）、月柱在交节那一刻换，前后不同，要按出生时刻分
    let jie = null;
    if (term.getDayIndex() === 0 && term.getSolarTerm().isJie()) {
      // 交节落在哪个时辰里：那个时辰前后半截的年月柱不同
      const st0 = term.getSolarTerm().getJulianDay().getSolarTime(), mins = st0.getHour() * 60 + st0.getMinute();
      for (const h of hours) {
        const [a, b] = h.range.split('–').map((t) => +t.slice(0, 2) * 60 + +t.slice(3, 5));
        if (mins >= a && mins <= b) h.jieInside = true;
      }
      const st = term.getSolarTerm().getJulianDay().getSolarTime();
      const before = T.SolarTime.fromYmdHms(y, m, d, 0, 0, 0).getSixtyCycleHour(), after = T.SolarTime.fromYmdHms(y, m, d, 23, 59, 0).getSixtyCycleHour();
      jie = { name: term.getSolarTerm().getName(), time: `${pad(st.getHour())}:${pad(st.getMinute())}`,
        before: { yearGZ: before.getYear().getName(), monthGZ: before.getMonth().getName() },
        after: { yearGZ: after.getYear().getName(), monthGZ: after.getMonth().getName() } };
    }
    return Object.assign(c, {
      week: '星期' + WEEK[c.week],
      yearGZ: scd.getYear().getName(), monthGZ: scd.getMonth().getName(),
      termNow: term.getSolarTerm().getName() + (term.getDayIndex() ? ` 第 ${term.getDayIndex() + 1} 天` : ' 当天'),
      jie, hours,
    });
  }

  const GAN = '甲乙丙丁戊己庚辛壬癸';
  /** 从一段文字里取出干支（容忍空格、逗号、「年月日时」字样）；不是六十甲子的（如甲丑）记为错 */
  function parsePillars(text) {
    const out = [], bad = [];
    const re = /([甲乙丙丁戊己庚辛壬癸])([子丑寅卯辰巳午未申酉戌亥])/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
      if (GAN.indexOf(m[1]) % 2 === ZHI.indexOf(m[2]) % 2) out.push(m[0]); else bad.push(m[0]);
    }
    return { pillars: out, bad };
  }
  /** 六十甲子，甲子起 */
  const JIAZI = Array.from({ length: 60 }, (_, i) => GAN[i % 10] + ZHI[i % 12]);
  /** 五虎遁：年干定十二月柱，寅月起（正月寅……十二月丑） */
  function monthPillars(yearGZ) {
    const start = ((GAN.indexOf(yearGZ[0]) % 5) * 2 + 2) % 10;   // 甲己丙寅、乙庚戊寅、丙辛庚寅、丁壬壬寅、戊癸甲寅
    return Array.from({ length: 12 }, (_, i) => GAN[(start + i) % 10] + ZHI[(2 + i) % 12]);
  }
  /** 五鼠遁：日干定十二时柱 */
  function hourPillars(dayGZ) {
    const start = (GAN.indexOf(dayGZ[0]) % 5) * 2;   // 甲己起甲子，乙庚起丙子……
    return ZHI.split('').map((z, i) => GAN[(start + i) % 10] + z);
  }

  /**
   * 四柱反查日期：给年月日（三柱）或年月日时（四柱），在 fromY–toY 年间找出所有对得上的日子／时辰。
   * 时柱为子时的，零点后的早子与前一天 23 点后的夜子都算（夜子算次日，与奇门引擎一致）。
   * @returns { ok, error, results: [{ date, time, label, range }] }  date 为公历日（夜子是前一天的日期）
   */
  function findByPillars(T, pillars, fromY, toY) {
    fromY = fromY || 1800; toY = toY || 2200;
    if (!Array.isArray(pillars) || pillars.length < 3 || pillars.length > 4) return { ok: false, error: '请给年、月、日三柱，或年、月、日、时四柱', results: [] };
    const [yg, mg, dg, hg] = pillars;
    const hours = hg ? [hg] : hourPillars(dg);
    const seen = new Set(), results = [];
    const add = (st, isLate) => {
      const date = ymd(st.getYear(), st.getMonth(), st.getDay());
      const h = st.getHour();
      const zi = ZHI[Math.floor(((h + 1) % 24) / 2)];
      const key = hg ? date + ' ' + h : date;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ date, time: `${pad(h)}:00`, zhi: zi,
        label: isLate ? '夜子时（算次日）' : (h === 0 ? '早子时' : zi + '时'),
        range: isLate ? '23:00–23:59' : h === 0 ? '00:00–00:59' : `${pad(h - 1)}:00–${pad(h)}:59` });
    };
    for (const hp of hours) {
      let list = [];
      try { list = new T.EightChar(yg, mg, dg, hp).getSolarTimes(fromY, toY); } catch (e) { list = []; }
      for (const st of list) {
        add(st, false);
        if (hg && hp[1] === '子') {   // 只给三柱时不收夜子：那是前一天，日期会误导
          // 前一天 23 点后的夜子时也是这一柱：照引擎口径核一遍再收
          const prev = T.SolarDay.fromYmd(st.getYear(), st.getMonth(), st.getDay()).next(-1);
          const lt = T.SolarTime.fromYmdHms(prev.getYear(), prev.getMonth(), prev.getDay(), 23, 0, 0);
          const x = lt.getSixtyCycleHour();
          if (x.getYear().getName() === yg && x.getMonth().getName() === mg && x.getDay().getName() === dg && x.getSixtyCycle().getName() === hp) add(lt, true);
        }
      }
    }
    results.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    if (!hg) {   // 三柱：一天只列一次
      const byDay = []; const s2 = new Set();
      for (const r of results) if (!s2.has(r.date)) { s2.add(r.date); byDay.push({ date: r.date, time: '', label: '', range: '' }); }
      return { ok: true, error: '', results: byDay };
    }
    return { ok: true, error: '', results };
  }

  return { month, day, cell, ymd, JIAZI, parsePillars, monthPillars, hourPillars, findByPillars };
});
