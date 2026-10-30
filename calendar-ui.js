/* 万年历界面（奇门 app 与奇门穿壬共用这一份）
 * 月历：公历、农历（初一显示月名）、节气、节日、日干支；点一天看年月日柱与十二时辰（含夜子时算次日）。
 * 「用此日排盘」把日期填回排盘栏；「设为年命」把那天的年柱填进年命（查出生那天即得年命，立春换年已算好）。
 * 四柱反查：从下拉选年月日（时）干支——月柱随年干、时柱随日干只列配得上的，选不出错的组合——
 *   列出 1800–2200 年间对得上的日子与时辰，可直接排盘。
 * 历法：core/calendar.js（tyme4ts）；四柱与排盘引擎逐时辰比对一致（core/calendar.test.js）。
 * 宿主钩子 window.CalendarHost = { cast(), setNianMing(干支) }，可选；没给就照奇门 app 的界面办（见下）。 */
(function () {
  const CAL = window.WanNianLi, T = window.tyme4ts;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (!CAL || !T || !$('calBtn')) return;
  // 没给宿主钩子就照奇门 app：排盘＝按 #castBtn；设年命＝填 #aiNianMing（甲年连年支、余年只填天干，与该下拉一致）
  const host = () => window.CalendarHost || {
    cast: () => { const b = $('castBtn'); if (b) b.click(); },
    setNianMing: (gz) => {
      const s = $('aiNianMing'); if (!s || !gz) return;
      s.value = gz[0] === '甲' ? gz : gz[0];
      s.dispatchEvent(new Event('change', { bubbles: true }));
    },
  };

  const now = new Date(), pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  let y, m, sel = '', findHtml = '', findOpen = false;
  // 四柱反查：四个下拉，只给合法的组合——月柱按年干（五虎遁）、时柱按日干（五鼠遁）只列 12 个
  const nowH = T.SolarTime.fromYmdHms(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), 0).getSixtyCycleHour();
  const fsel = { y: nowH.getYear().getName(), m: nowH.getMonth().getName(), d: nowH.getDay().getName(), h: nowH.getSixtyCycle().getName() };
  const keepZhi = (list, cur) => list.find((p) => p[1] === (cur || '')[1]) || list[0];
  function findSelects() {
    const opt = (list, cur) => list.map((p) => `<option${p === cur ? ' selected' : ''}>${p}</option>`).join('');
    return `<label>年<select data-cal="fy">${opt(CAL.JIAZI, fsel.y)}</select></label>
      <label>月<select data-cal="fm">${opt(CAL.monthPillars(fsel.y), fsel.m)}</select></label>
      <label>日<select data-cal="fd">${opt(CAL.JIAZI, fsel.d)}</select></label>
      <label>时<select data-cal="fh"><option value=""${fsel.h ? '' : ' selected'}>不限</option>${opt(CAL.hourPillars(fsel.d), fsel.h)}</select></label>`;
  }

  function openAt(dateStr) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? dateStr : todayStr;
    y = +d.slice(0, 4); m = +d.slice(5, 7); sel = d;
    $('calPanel').style.display = 'block';
    draw();
  }
  function shift(k) { m += k; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } draw(); }

  function draw() {
    const mo = CAL.month(T, y, m);
    const ys = []; for (let i = 1900; i <= 2100; i++) ys.push(`<option${i === y ? ' selected' : ''}>${i}</option>`);
    const ms = []; for (let i = 1; i <= 12; i++) ms.push(`<option value="${i}"${i === m ? ' selected' : ''}>${i} 月</option>`);
    const cells = mo.cells.map((c) => {
      const sub = c.term ? `<div class="l t">${esc(c.term)}</div>` : c.festival ? `<div class="l f">${esc(c.festival)}</div>` : `<div class="l">${esc(c.lunar)}</div>`;
      const cls = ['cal-c', c.inMonth ? '' : 'out', c.date === todayStr ? 'today' : '', c.date === sel ? 'sel' : '', (c.week === 0 || c.week === 6) ? 'we' : ''].join(' ');
      return `<div class="${cls}" data-date="${c.date}"><div class="n">${c.d}</div>${sub}<div class="g">${esc(c.dayGZ)}</div></div>`;
    }).join('');
    $('calPanel').innerHTML = `
      <div class="cal-nav">
        <b>万年历</b>
        <button class="btn" type="button" data-cal="prev" style="padding:2px 8px;">◀</button>
        <select data-cal="y">${ys.join('')}</select><select data-cal="m">${ms.join('')}</select>
        <button class="btn" type="button" data-cal="next" style="padding:2px 8px;">▶</button>
        <button class="btn" type="button" data-cal="today" style="padding:2px 8px;background:#666;">今天</button>
        <button class="btn" type="button" data-cal="close" style="padding:2px 8px;background:#999;margin-left:auto;">✕ 收起</button>
      </div>
      <div class="muted" style="margin-top:4px;">年柱 ${mo.yearGZs.map(esc).join(' → ')}${mo.terms.length ? '　本月交节：' + mo.terms.map((t) => `${esc(t.name)} ${+t.date.slice(8)} 日`).join('、') : ''}
        <span style="font-size:11px;">（年柱以立春换，月柱以节换）</span></div>
      <div class="cal-grid">${mo.weekHead.map((w) => `<div class="cal-wh">${w}</div>`).join('')}${cells}</div>
      <div class="cal-d" id="calDay">${sel ? dayHtml(sel) : '<span class="muted">点一天看四柱与十二时辰。</span>'}</div>
      <details class="cal-fbox" id="calFindBox"${findOpen ? ' open' : ''}><summary><b>🔎 四柱反查</b> <span class="muted">已知干支，找公历日期与时辰</span></summary>
        <div class="cal-find">${findSelects()}
          <button class="btn" type="button" data-cal="find" style="padding:2px 10px;">查找</button></div>
        <div class="muted" style="font-size:11px;">月柱随年干、时柱随日干只列配得上的 12 个；时柱可选「不限」只查日子。</div>
        <div id="calFind">${findHtml}</div>
      </details>`;
  }

  function dayHtml(dateStr) {
    const [yy, mm, dd] = dateStr.split('-').map(Number);
    const x = CAL.day(T, yy, mm, dd);
    const hours = x.hours.map((h) => `<div>${esc(h.label)}时 <span class="muted">${esc(h.range)}</span> <b>${esc(h.gz)}</b>${h.nextDay ? `<span class="muted">（算次日 ${esc(h.nextDay)}）</span>` : ''}${h.jieInside ? `<span style="color:#8a6d3b;">（${esc(x.jie.time)} 交节，此时辰前后不同）</span>` : ''}</div>`).join('');
    const j = x.jie;
    const nmBtns = j && j.before.yearGZ !== j.after.yearGZ
      ? `<button class="btn" type="button" data-cal="nm" data-gz="${esc(j.before.yearGZ)}" style="background:#8a6d3b;">设为年命：${esc(j.time)} 前出生（${esc(j.before.yearGZ)}）</button>
         <button class="btn" type="button" data-cal="nm" data-gz="${esc(j.after.yearGZ)}" style="background:#8a6d3b;">${esc(j.time)} 后出生（${esc(j.after.yearGZ)}）</button>`
      : `<button class="btn" type="button" data-cal="nm" data-gz="${esc(x.yearGZ)}" style="background:#8a6d3b;">设为年命（年柱 ${esc(x.yearGZ)}）</button>`;
    return `<div><b>${esc(x.date)}</b> ${esc(x.week)}　${esc(x.lunarFull)}　<span class="muted">${esc(x.termNow)}</span>${x.festival ? '　' + esc(x.festival) : ''}</div>
      <div>年柱 <b>${esc(x.yearGZ)}</b>　月柱 <b>${esc(x.monthGZ)}</b>　日柱 <b>${esc(x.dayGZ)}</b></div>
      ${j ? `<div style="color:#8a6d3b;">今天 ${esc(j.time)} 交${esc(j.name)}：之前为 ${esc(j.before.yearGZ)}年 ${esc(j.before.monthGZ)}月，之后为 ${esc(j.after.yearGZ)}年 ${esc(j.after.monthGZ)}月。</div>` : ''}
      <div class="cal-h">${hours}</div>
      <div style="margin-top:6px;">
        <button class="btn" type="button" data-cal="use" data-date="${esc(x.date)}">用此日排盘</button>
        ${nmBtns}
        <div class="muted" style="font-size:11px;">排盘时间沿用排盘栏现有的时间。查年命：翻到出生那天按「设为年命」，立春前后已按立春换年算好。</div>
      </div>`;
  }

  /** 四柱反查：1800–2200 年间对得上的日子（给了时柱就到时辰） */
  function runFind() {
    const p = { pillars: [fsel.y, fsel.m, fsel.d].concat(fsel.h ? [fsel.h] : []) };
    const r = CAL.findByPillars(T, p.pillars, 1800, 2200);
    const head = `<b>${p.pillars.map(esc).join(' ')}</b>：`;
    if (!r.results.length) {
      findHtml = `<div class="muted">${head}1800–2200 年间找不到。月柱须与年干相配（五虎遁），${p.pillars[3] ? '时柱须与日干相配（五鼠遁，此日可用：' + CAL.hourPillars(p.pillars[2]).join(' ') + '），' : ''}请核对。</div>`;
    } else {
      const wk = (d) => '日一二三四五六'[T.SolarDay.fromYmd(+d.slice(0, 4), +d.slice(5, 7), +d.slice(8, 10)).getWeek().getIndex()];
      findHtml = `<div class="muted">${head}1800–2200 年间共 ${r.results.length} 处（六十年一轮）</div>` + r.results.map((x) =>
        `<div class="cal-hit"><b>${esc(x.date)}</b> 周${wk(x.date)}${x.label ? ` ${esc(x.label)} <span class="muted">${esc(x.range)}</span>` : ''}
          <button class="btn" type="button" data-cal="use" data-date="${esc(x.date)}"${x.time ? ` data-time="${esc(x.time)}"` : ''} style="padding:1px 8px;font-size:12px;">用此${x.time ? '时' : '日'}排盘</button>
          <button class="btn" type="button" data-cal="goto" data-date="${esc(x.date)}" style="padding:1px 8px;font-size:12px;background:#666;">看这天</button></div>`).join('');
    }
    draw();
  }

  $('calBtn').addEventListener('click', () => {
    if ($('calPanel').style.display === 'block') { $('calPanel').style.display = 'none'; return; }
    openAt($('inDate').value);
  });
  $('calPanel').addEventListener('change', (e) => {
    const k = e.target.dataset.cal;
    if (k === 'fy') { fsel.y = e.target.value; fsel.m = keepZhi(CAL.monthPillars(fsel.y), fsel.m); draw(); return; }
    if (k === 'fm') { fsel.m = e.target.value; return; }
    if (k === 'fd') { fsel.d = e.target.value; if (fsel.h) fsel.h = keepZhi(CAL.hourPillars(fsel.d), fsel.h); draw(); return; }
    if (k === 'fh') { fsel.h = e.target.value; return; }
    if (k === 'y') { y = +e.target.value; draw(); }
    if (k === 'm') { m = +e.target.value; draw(); }
  });
  $('calPanel').addEventListener('click', (e) => {
    const c = e.target.closest('.cal-c');
    if (c) {
      sel = c.dataset.date;
      const cy = +sel.slice(0, 4), cm = +sel.slice(5, 7);
      if (cy !== y || cm !== m) { y = cy; m = cm; }
      draw();
      return;
    }
    const b = e.target.closest('[data-cal]'); if (!b || b.tagName === 'SELECT') return;
    const k = b.dataset.cal;
    if (k === 'prev') shift(-1);
    else if (k === 'next') shift(1);
    else if (k === 'today') openAt(todayStr);
    else if (k === 'close') $('calPanel').style.display = 'none';
    else if (k === 'find') { findOpen = true; runFind(); }
    else if (k === 'goto') { sel = b.dataset.date; y = +sel.slice(0, 4); m = +sel.slice(5, 7); draw(); }
    else if (k === 'use') {
      $('inDate').value = b.dataset.date;
      if (b.dataset.time) $('inTime').value = b.dataset.time;
      $('calPanel').style.display = 'none';
      host().cast();
      const top = $('basicInfo'); if (top && top.scrollIntoView) top.scrollIntoView({ behavior: 'smooth' });
    } else if (k === 'nm') {
      host().setNianMing(b.dataset.gz);
      b.textContent = '已设为年命 ✓';
    }
  });
  $('calPanel').addEventListener('toggle', (e) => { if (e.target.id === 'calFindBox') findOpen = e.target.open; }, true);
  window.CalendarUI = { openAt, runFind, fsel };
})();
