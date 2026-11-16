// Собирает HTML-дашборд по сделкам Б24 из подготовленного JSON (tmp/deals/stats.json)
// Запуск: node scripts/build_dashboard.js
const fs = require('fs');
const S = JSON.parse(fs.readFileSync('tmp/deals/stats.json', 'utf8'));

// ---------- вспомогательные ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtN = n => Math.round(n).toLocaleString('ru-RU');
const fmtS = n => fmtN(n) + ' ₽';
const fmtP = p => p == null ? '—' : String(p).replace('.', ',') + '%';
const fmtD = d => d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '';

const P = S.periods;
// день для столбиков: "13.10"
S.daily.forEach(d => { d.d = d.day.slice(8, 10) + '.' + d.day.slice(5, 7); });

// ---------- рендеры ----------
// Горизонтальный одноцветный бар (один ряд = категория); color фиксированный или на ряд
function barChart(items, max, color, fmt) {
  const rows = items.map(it => `
    <div class="brow" data-tt="${esc(it.tt || '')}">
      <div class="blab">${esc(it.label)}</div>
      <div class="btrack"><div class="bfill" style="width:${(it.value / max * 100).toFixed(1)}%;background:${it.color || color}"></div></div>
      <div class="bval">${fmt(it.value)}</div>
    </div>`).join('');
  return `<div class="bars">${rows}</div>`;
}

function legend2() {
  return `<div class="lgrow"><span class="lg"><span class="sw" style="background:var(--s1)"></span>Текущая неделя</span><span class="lg"><span class="sw" style="background:var(--s2)"></span>Прошлая неделя</span></div>`;
}

// Стек: долевая полоса (успех/провал/в работе)
function stackedBar(parts) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const segs = parts.map((p, i) =>
    `<div class="seg${i === parts.length - 1 ? ' seg-end' : ''}" style="width:calc(${(p.value / total * 100).toFixed(2)}% - 2px);background:${p.color}" data-tt="${esc(`${p.label}: ${p.value} (${Math.round(p.value / total * 100)}%${p.sum != null ? ', ' + fmtS(p.sum) : ''})`)}, суммарно ${total}" ></div>`
  ).join('');
  const legend = parts.map(p =>
    `<span class="lg"><span class="sw" style="background:${p.color}"></span>${p.label} ${p.value} (${Math.round(p.value / total * 100)}%${p.sum != null ? ' · ' + fmtS(p.sum) : ''})</span>`).join('');
  return `<div class="stack">${segs}</div><div class="lgrow">${legend}</div>`;
}

// Столбики по дням; colorCls — доп. класс для цвета столбиков (напр. 'cchart-green')
function colChart(days, key, fmt, labelEvery, colorCls) {
  const max = Math.max(...days.map(d => +d[key] || 0), 1);
  const cols = days.map((d, i) => {
    const v = +d[key] || 0;
    const h = v / max * 100;
    const isMax = v === max && v > 0;
    return `<div class="ccol${isMax ? ' ccol-max' : ''}" data-tt="${esc(d.tt || `${d.d}: ${fmt(v)}`)}">
      ${isMax ? `<div class="cv">${fmt(v)}</div>` : ''}
      <div class="cfill" style="height:${h}%" ${v ? '' : 'data-zero="1"'}></div>
      <div class="clab${i % labelEvery ? ' clab-off' : ''}">${d.d.replace('.', '.')}</div>
    </div>`;
  }).join('');
  return `<div class="cchart${colorCls ? ' ' + esc(colorCls) : ''}">${cols}</div>`;
}

// Таблица
function table(head, rows, foot) {
  return `<table class="dtable"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="dtd-l"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  ${foot ? `<tfoot><tr>${foot.map((c, i) => `<td${i === 0 ? ' class="dtd-l"' : ''}>${c}</td>`).join('')}</tr></tfoot>` : ''}</table>`;
}

// KPI-плитка
function tile(label, value, delta, deltaTone, sub) {
  return `<div class="tile">
    <div class="tlabel">${esc(label)}</div>
    <div class="tvalue">${esc(value)}</div>
    ${delta ? `<div class="tdelta ${deltaTone || ''}">${delta}</div>` : ''}
    ${sub ? `<div class="tsub">${esc(sub)}</div>` : ''}
  </div>`;
}

// Сравнение 2 периодов — дельта
function delta(cur, prev, fmt, invert) {
  if (prev == null || cur == null) return { txt: '—', tone: '' };
  const d = cur - prev;
  const pct = prev ? Math.round(d / prev * 100) : null;
  const tone = d > 0 ? 'up' : d < 0 ? 'down' : '';
  if (!invert) return { txt: `${d > 0 ? '+' : ''}${fmt(d)}${pct != null ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''}`, tone };
  return { txt: `${d > 0 ? '+' : ''}${fmt(d)}${pct != null ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''}`, tone: d > 0 ? 'down' : d < 0 ? 'up' : '' };
}

// ---------- агрегаты ----------
const SOURCES = S.sourcesList;               // фиксированный порядок каналов
const USERS = S.usersList;
const REASONS = ['Выбрали другого Партнера', 'Отложили принятие решения', 'Не смогли связаться'];
// короткие имена ответственных — для компактных подписей
const shortU = u => u.includes('Толкачев') ? 'Толкачев' : u.includes('Трубаев') ? 'Трубаев' : u.includes('Интегратор') ? 'Георгий' : u;

const d30 = P.d30;
const wk = P.curWeek, pwk = P.prevWeek;
// сравнение по источникам
const srcCmp = SOURCES.map(s => {
  const a = S.bySource.week[s], b = S.bySource.prevWeek[s];
  return {
    label: s,
    week: a || { total: 0, succ: 0, sumSucc: 0, crSucc: null },
    prev: b || { total: 0, succ: 0, sumSucc: 0, crSucc: null },
  };
});
const usrCmp = USERS.map(u => {
  const a = S.byUser.week[u], b = S.byUser.prevWeek[u];
  return { label: shortU(u), week: a || { total: 0, succ: 0, sumSucc: 0, crSucc: null }, prev: b || { total: 0, succ: 0, sumSucc: 0, crSucc: null } };
});

const dSuccW = delta(wk.succ, pwk.succ, fmtN);
const dSuccSm = delta(wk.sumSucc, pwk.sumSucc, fmtN);
const dReqW = delta(wk.total, pwk.total, fmtN);

// тренд-хитмапа: конверсия в успех, %, по неделям
const wkLbl = S.weeksList.map(([a, b], i) => `${a.slice(8, 10)}.${a.slice(5, 7)}–${b.slice(8, 10)}.${b.slice(5, 7)}${i === S.weeksList.length - 1 ? '*' : ''}`);
function weeklyRows(convMap, keys) {
  return keys.map(k => {
    const cells = S.weeksList.map(([a, b]) => {
      const label = `${a.slice(8, 10)}.${a.slice(5, 7)}–${b.slice(8, 10)}.${b.slice(5, 7)}`;
      const c = (convMap[k] || {})[label];
      if (!c || !c.total) return { label, p: null, c: null };
      return { label, p: +(100 * c.succ / c.total).toFixed(0), c };
    });
    return { key: k, cells };
  });
}
const srcTrend = weeklyRows(S.weeklyConv.sources, SOURCES);
const usrTrend = weeklyRows(S.weeklyConv.users, USERS);

function heatmap(trendRows, title, sub) {
  const flat = trendRows.flatMap(r => r.cells.filter(c => c.p != null).map(c => c.p));
  const mx = Math.max(50, ...flat);
  function step(p) {
    if (p == null) return { bg: 'transparent', ink: 'var(--text-muted)' };
    const k = Math.min(9, Math.floor(p / 10));
    return { bg: `var(--heat-${k})`, ink: k >= 4 ? 'var(--ink-on-hi)' : 'var(--ink-on-lo)' };
  }
  const head = `<tr><th></th>${wkLbl.map(l => `<th>${l}</th>`).join('')}</tr>`;
  const body = trendRows.map(r => `<tr><td class="dtd-l">${esc(r.key)}</td>${r.cells.map(c => {
    const st = step(c.p);
    const tip = c.c && c.c.total ? `заявок ${c.c.total}, успех ${c.c.succ} (${fmtS(c.c.sumSucc)}), сумма всех ${fmtS(c.c.sumAll)}` : 'нет заявок';
    return `<td><div class="hcell" style="background:${st.bg};color:${st.ink}" ${c.p == null ? '' : `data-tt="${esc(`${r.key} · ${c.label}: конверсия ${c.p}% — ${tip}`)}"`}>${c.p == null ? '–' : c.p + '%'}</div></td>`;
  }).join('')}</tr>`).join('');
  return `<div class="hm-title">${esc(title)}</div><div class="hm-sub">${esc(sub)}</div>
  <div class="hmwrap"><table class="htable">${head}${body}</table></div>
  <div class="hm-scale"><span>0%</span><span>50%</span><span>100%</span><span class="hm-swatch hm-s0"></span><span class="hm-swatch hm-s1"></span><span class="hm-swatch hm-s2"></span><span class="hm-swatch hm-s3"></span><span class="hm-swatch hm-s4"></span><span class="hm-swatch hm-s5"></span><span class="hm-swatch hm-s6"></span><span class="hm-swatch hm-s7"></span><span class="hm-swatch hm-s8"></span><span class="hm-swatch hm-s9"></span></div>`;
}


// ---------- выводы и рекомендации (генерация по цифрам) ----------
const ALL_CHANNELS = ['Заявка из приложения', 'По рекомендации', 'Существующий клиент', 'Реклама в ВК', 'Рассылка E-mail', 'Вебинар онлайн', 'Сайт (CRM форма)'];
const REASON_REC = {
  'Не смогли связаться': 'ввести SLA первого контакта: новый лид — звонок в течение часа, 3 попытки дозвона',
  'Отложили принятие решения': 'настроить догрев: письмо/звонок через 7–14 дней, часть вернётся — самый дешёвый способ поднять конверсию',
  'Выбрали другого Партнера': 'разобрать 3–5 свежих кейсов (цена, скорость, оффер) и подготовить контроффер',
};
function genConclusions(S) {
  const d30 = S.periods.d30, curW = S.periods.curWeek, prevW = S.periods.prevWeek;
  const items = [];
  const avgConv = d30.crSucc;
  const srcs = S.sourcesList.map(n => ({ n, ...S.bySource[n] })).filter(x => x.total > 0);
  const users = S.usersList.map(n => ({ n, ...S.byUser[n] })).filter(x => x.total > 0);
  const cheque = x => Math.round(x.sumSucc / Math.max(x.succ, 1));
  const big = x => x.total >= 10;

  const bestC = [...srcs].filter(big).sort((a, b) => b.crSucc - a.crSucc)[0];
  if (bestC) items.push(`<li><b>${esc(bestC.n)} — лучший канал по конверсии (${fmtP(bestC.crSucc)} при средней ${fmtP(avgConv)}): масштабировать.</b> Объём ${bestC.total} заявок, средний чек успешных ${fmtN(cheque(bestC))} ₽.${bestC.crSucc < 50 ? ' Резерв — до вытяги: поднять обработку, а не только приток.' : ''}</li>`);

  const bestQ = [...srcs].filter(x => big(x) && x.succ > 0).sort((a, b) => cheque(b) - cheque(a))[0];
  if (bestQ && bestQ !== bestC) items.push(`<li><b>${esc(bestQ.n)} — лучший средний чек (${fmtN(cheque(bestQ))} ₽) при конверсии ${fmtP(bestQ.crSucc)}: усилить.</b> Если это рекомендации — формализовать бонус за рекомендацию; если платные каналы — поднять долю Premium-лидов.</li>`);

  const worst = [...srcs].filter(big).sort((a, b) => a.crSucc - b.crSucc)[0];
  if (worst && worst !== bestC) {
    const topReasons = Object.entries(worst.byReason).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r, k]) => `${r} (${k})`).join(', ');
    items.push(`<li><b>${esc(worst.n)} — объём ${worst.total} заявок, но конверсия всего ${fmtP(worst.crSucc)} (хуже средней ${fmtP(avgConv)}): разобрать качество и скорость.</b> Топ-причины провалов: ${topReasons}. Проверить квалификацию лидов и время первого касания — «остывание» убивает заявки этого канала быстрее всего.</li>`);
  }

  Object.entries(d30.byReason).sort((a, b) => b[1] - a[1]).forEach(([reason, k]) => {
    const share = Math.round(k / d30.total * 100);
    const rec = REASON_REC[reason] || 'назначить ответственного за разбор этой причины';
    const who = S.usersList.filter(u => (S.byUser[u].byReason[reason] || 0) > 0)
      .sort((a, b) => S.byUser[b].byReason[reason] - S.byUser[a].byReason[reason]).slice(0, 2)
      .map(u => `${shortU(u)} — ${S.byUser[u].byReason[reason]}`).join(', ');
    items.push(`<li><b>«${esc(reason)}» — ${k} провалов (${share}% всех заявок): ${rec}.</b>${who ? ` Больше всех: ${esc(who)}.` : ''}</li>`);
  });

  if (users.length) {
    const worstU = [...users].filter(x => x.total >= 15).sort((a, b) => a.crSucc - b.crSucc)[0];
    if (worstU) {
      const others = users.filter(u => u !== worstU).map(u => `${u.n.includes('Толкачев') ? 'Толкачев' : u.n.includes('Трубаев') ? 'Трубаев' : 'Георгий'} ${fmtP(u.crSucc)}`).join(', ');
      const r = Object.entries(worstU.byReason).sort((a, b) => b[1] - a[1])[0];
      items.push(`<li><b>${esc(worstU.n)} — конверсия ${fmtP(worstU.crSucc)} при ${worstU.total} заявках: скрипты и разбор.</b> Для сравнения: ${others}. ${r ? `Топ-причина — «${esc(r[0])}» (${r[1]} из ${worstU.fail} провалов): нужен шаблон следующего шага и разбор на созвоне.` : ''}</li>`);
    }
  }

  const missing = ALL_CHANNELS.filter(c => !srcs.some(x => x.n === c));
  if (missing.length) items.push(`<li><b>Без заявок:${missing.length > 1 ? ' каналы' : ' канал'} ${missing.map(esc).join(', ')}</b> — ${missing.length > 1 ? 'не дали' : 'не дал'} ни одной сделки за период. Проверить, подключён ли канал в CRM; если нет — запустить или исключить из плана.</li>`);

  if (curW.total != null && prevW.total != null) {
    const d = curW.total - prevW.total;
    const pct = prevW.total ? Math.round(d / prevW.total * 100) : null;
    const trend = d < 0 ? `просел с ${prevW.total} до ${curW.total} заявок (${pct}%)` : d > 0 ? `вырос с ${prevW.total} до ${curW.total} заявок (+${pct}%)` : 'без изменений';
    const lag = Math.round((new Date(S.meta.runDate.split('.').reverse().join('-') + 'T00:00:00Z') - new Date(S.meta.dataDate + 'T00:00:00Z')) / 864e5);
    items.push(`<li><b>Поток заявок ${trend}.</b>${lag >= 2 ? ` С последней заявки в таблице прошло ${lag} дн. — проверьте, на что перестало приходить.` : ''} Узкое место — не обработка (${prevW.crSucc != null ? `конверсия ${fmtP(prevW.crSucc)} → ${fmtP(curW.crSucc)}` : ''}), а приток лидов.</li>`);
  }

  if (S.badClose.length) {
    items.push(`<li><b>Качество данных (исправить в Б24):</b> у ${S.badClose.length} сделок (ID ${S.badClose.map(x => x.id).join(', ')}) дата закрытия раньше даты создания; поле «Причины провала (заявки)» в выгрузке пустое — причины живут в названиях стадий; у проваленных сделок заполнено «Сумма», поэтому «сумма провала» (${fmtS(d30.sumFail)}) — не потерянная выручка, а незакрытые суммы.</li>`);
  }
  return '<ol class="concl">' + items.join('\n') + '</ol>';
}

// ---------- HTML ----------
const srcByTotal = [...SOURCES].sort((a, b) => S.bySource[b].total - S.bySource[a].total);
const maxSrc30 = Math.max(...SOURCES.map(s => S.bySource[s].total));

const reqSrcRows = srcByTotal.map(s => ({
  label: s,
  value: S.bySource[s].total,
  tt: `${s}: заявок 30д ${S.bySource[s].total}, неделя ${S.bySource.week[s] ? S.bySource.week[s].total : 0}, успех ${S.bySource[s].succ} (${fmtP(S.bySource[s].crSucc)})`,
}));

const srcCmpRows = SOURCES.map(s => {
  const a = S.bySource[s], w = S.bySource.week[s], p = S.bySource.prevWeek[s];
  return [
    s,
    `${w ? w.total : 0} / ${p ? p.total : 0}`,
    `${a.succ} / ${fmtP(a.crSucc)}`,
    fmtS(a.sumSucc),
    `${a.byReason[REASONS[0]] || 0} · ${a.byReason[REASONS[1]] || 0} · ${a.byReason[REASONS[2]] || 0}`,
  ];
});
const usrCmpRows = USERS.map(u => {
  const a = S.byUser[u], w = S.byUser.week[u], p = S.byUser.prevWeek[u];
  return [
    u,
    `${w ? w.total : 0} / ${p ? p.total : 0}`,
    `${a.succ} / ${fmtP(a.crSucc)}`,
    fmtS(a.sumSucc),
    `${a.byReason[REASONS[0]] || 0} · ${a.byReason[REASONS[1]] || 0} · ${a.byReason[REASONS[2]] || 0}`,
  ];
});

const openAgeRows = S.openAging.map(r => [
  r.id, esc(r.stage), r.user.includes('Толкачев') ? 'Толкачев' : r.user.includes('Трубаев') ? 'Трубаев' : r.user,
  r.created.replace(' 0:00', '').replace(/ \d+:\d+/, ''), `${r.days} дн.`,
]);

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Дашборд маркетинга — сделки Б24</title>
<style>
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb; --page: #f9f9f7;
    --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #898781;
    --grid: #e1e0d9; --baseline: #c3c2b7; --border: rgba(11,11,11,0.10);
    --s1: #2a78d6; --s2: #eb6834;
    --st-good: #0ca30c; --st-crit: #d03b3b; --st-open: #b9b8b0;
    --up-good: #006300;
    --ink-on-lo: var(--text-primary); --ink-on-hi: #ffffff;
    --heat-0:#cde2fb;--heat-1:#9ec5f4;--heat-2:#86b6ef;--heat-3:#5598e7;--heat-4:#3987e5;--heat-5:#2a78d6;--heat-6:#256abf;--heat-7:#1c5cab;--heat-8:#184f95;--heat-9:#104281;
  }
  .viz-root {
    color-scheme: light;
    --surface-1: #fcfcfb; --page: #f9f9f7;
    --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #898781;
    --grid: #e1e0d9; --baseline: #c3c2b7; --border: rgba(11,11,11,0.10);
    --s1: #2a78d6; --s2: #eb6834;
    --st-good: #0ca30c; --st-crit: #d03b3b; --st-open: #b9b8b0;
    --up-good: #006300;
    --ink-on-lo: var(--text-primary); --ink-on-hi: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --surface-1: #1a1a19; --page: #0d0d0d;
      --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #898781;
      --grid: #2c2c2a; --baseline: #383835; --border: rgba(255,255,255,0.10);
      --s1: #3987e5; --s2: #d95926;
      --st-good: #0ca30c; --st-crit: #d03b3b; --st-open: #5a5951;
      --up-good: #0ca30c;
      --ink-on-lo: #f0efec; --ink-on-hi: #0d0d0d;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-1: #1a1a19; --page: #0d0d0d;
    --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #898781;
    --grid: #2c2c2a; --baseline: #383835; --border: rgba(255,255,255,0.10);
    --s1: #3987e5; --s2: #d95926;
    --st-good: #0ca30c; --st-crit: #d03b3b; --st-open: #5a5951;
    --up-good: #0ca30c;
    --ink-on-lo: #f0efec; --ink-on-hi: #0d0d0d;
  }
  /* тёмные ступени heatmap — только в тёмной теме */
  :root[data-theme="dark"] {
    --heat-0:#184f95;--heat-1:#1c5cab;--heat-2:#256abf;--heat-3:#2a78d6;--heat-4:#3987e5;--heat-5:#5598e7;--heat-6:#6da7ec;--heat-7:#86b6ef;--heat-8:#9ec5f4;--heat-9:#b7d3f6;
  }
  @media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) { --heat-0:#184f95;--heat-1:#1c5cab;--heat-2:#256abf;--heat-3:#2a78d6;--heat-4:#3987e5;--heat-5:#5598e7;--heat-6:#6da7ec;--heat-7:#86b6ef;--heat-8:#9ec5f4;--heat-9:#b7d3f6; } }

  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--text-primary);
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .viz-root { max-width: 1160px; margin: 0 auto; padding: 24px 20px 48px; }
  header.hd { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
  h1 { font-size: 20px; margin: 0; }
  .hd-meta { color: var(--text-secondary); font-size: 12.5px; }
  .theme-btn { margin-left: auto; font: inherit; font-size: 12px; color: var(--text-secondary);
    background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 4px 10px; cursor: pointer; }

  .krow { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 14px 0 22px; }
  .tile { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
  .tlabel { color: var(--text-secondary); font-size: 12px; }
  .tvalue { font-size: 26px; font-weight: 600; margin-top: 2px; }
  .tdelta { font-size: 12px; margin-top: 2px; color: var(--text-secondary); }
  .tdelta.up { color: var(--up-good); }
  .tdelta.down { color: var(--st-crit); }
  .tsub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

  section.card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px;
    padding: 16px 18px 14px; margin-bottom: 16px; overflow: hidden; }
  h2 { font-size: 15px; margin: 0 0 2px; }
  .csub { color: var(--text-secondary); font-size: 12.5px; margin: 0 0 12px; }
  h3 { font-size: 13px; margin: 14px 0 8px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
  .grid2 > * { min-width: 0; }
  @media (max-width: 820px) { .grid2 { grid-template-columns: 1fr; } }

  .brow { display: grid; grid-template-columns: 170px 1fr 90px; gap: 10px; align-items: center; padding: 3px 0; }
  .blab { color: var(--text-secondary); font-size: 12.5px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btrack { background: transparent; display: flex; align-items: stretch; height: 16px; }
  .bfill { border-radius: 0 4px 4px 0; min-width: 2px; }
  .bval { font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--text-primary); }

  .stack { display: flex; gap: 2px; height: 22px; margin: 6px 0 10px; }
  .seg { min-width: 0; }
  .seg:first-child { border-radius: 4px 0 0 4px; }
  .seg-end { border-radius: 0 4px 4px 0; }
  .lgrow { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12.5px; color: var(--text-secondary); }
  .lg { display: inline-flex; align-items: center; gap: 6px; }
  .sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

  .cchart { display: flex; align-items: flex-end; gap: 2px; height: 178px; padding-bottom: 2px; min-width: 0; }
  .ccol { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; height: 100%; position: relative; padding-top: 15px; }
  .ccol:hover .cfill { filter: brightness(1.12); }
  .cfill { background: var(--s1); border-radius: 3px 3px 0 0; min-height: 0; cursor: default; }
  .cchart-green .cfill { background: var(--st-good); }
  .ccol[data-zero="1"] .cfill, .cfill[data-zero] { background: var(--grid); }
  .cv { position: absolute; top: 0; left: 0; right: 0; text-align: center; font-size: 10.5px; font-weight: 600;
    color: var(--text-primary); white-space: nowrap; z-index: 2; overflow: visible; }
  .clab { font-size: 8.5px; color: var(--text-muted); text-align: center; padding-top: 4px; font-variant-numeric: tabular-nums; }
  .clab-off { visibility: hidden; }
  .ccol-max .clab { color: var(--text-secondary); }

  .dtable { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  .dtable th { color: var(--text-secondary); font-weight: 600; text-align: left; padding: 6px 10px 6px 0;
    border-bottom: 1px solid var(--baseline); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .dtable td { padding: 6px 10px 6px 0; border-bottom: 1px solid var(--grid);
    font-variant-numeric: tabular-nums; color: var(--text-primary); }
  .dtd-l { color: var(--text-secondary); }
  .dtable th:not(:first-child), .dtable td:not(:first-child) { text-align: left; }
  details.tbl { margin-top: 10px; }
  details.tbl summary { cursor: pointer; color: var(--text-secondary); font-size: 12.5px; }
  details.tbl summary:hover { color: var(--text-primary); }
  details[open] summary { margin-bottom: 8px; }

  .hmwrap { overflow-x: auto; }
  .htable { border-collapse: separate; border-spacing: 3px; font-size: 12.5px; margin-left: -3px; }
  .htable th { color: var(--text-secondary); font-weight: 600; padding: 4px 8px; white-space: nowrap; }
  .htable td:first-child { color: var(--text-secondary); text-align: right; padding-right: 10px; white-space: nowrap; }
  .hcell { min-width: 78px; padding: 7px 8px; border-radius: 6px; text-align: center; cursor: default; }
  .hm-title { font-size: 13px; font-weight: 600; }
  .hm-sub { font-size: 12px; color: var(--text-secondary); margin: 2px 0 8px; }
  .hm-scale { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-muted); margin-top: 6px; }
  .hm-scale span { font-variant-numeric: tabular-nums; }
  .hm-swatch { width: 18px; height: 10px; border-radius: 2px; display: inline-block; }
  .hm-s0{background:var(--heat-0)}.hm-s1{background:var(--heat-1)}.hm-s2{background:var(--heat-2)}.hm-s3{background:var(--heat-3)}
  .hm-s4{background:var(--heat-4)}.hm-s5{background:var(--heat-5)}.hm-s6{background:var(--heat-6)}.hm-s7{background:var(--heat-7)}
  .hm-s8{background:var(--heat-8)}.hm-s9{background:var(--heat-9)}

  .note { font-size: 12.5px; color: var(--text-secondary); background: var(--page); border-radius: 8px; padding: 10px 12px; margin-top: 12px; }
  ol.concl { margin: 8px 0 0; padding-left: 20px; }
  ol.concl li { margin-bottom: 10px; }
  ol.concl b { font-weight: 600; }
  footer.ft { color: var(--text-muted); font-size: 12px; margin-top: 20px; }

  /* tooltip */
  #tt { position: fixed; z-index: 9; background: var(--surface-1); color: var(--text-primary);
    border: 1px solid var(--border); box-shadow: 0 4px 16px rgba(0,0,0,0.14); border-radius: 8px;
    padding: 7px 10px; font-size: 12px; pointer-events: none; max-width: 300px; display: none; white-space: pre-line; }
  [data-tt] { cursor: default; }

  /* печать / PDF */
  @page { size: A4 landscape; margin: 10mm; }
  @media print {
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { background: #fcfcfb; }
    .viz-root { max-width: none; padding: 0; }
    .theme-btn, #tt { display: none !important; }
    .brow, .tile, .krow, .hcell { break-inside: avoid; }
    .cchart, .stack + .lgrow, .dtable { break-inside: avoid; }
    body.pdf { zoom: 0.88; }
  }
</style>
</head>
<body data-palette="#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300">
<div class="viz-root">
  <header class="hd">
    <h1>Дашборд маркетинга — сделки Б24</h1>
    <span class="hd-meta">данные: ${S.daily.filter(d => d.n > 0)[0].d}–${S.meta.dataDate.slice(8, 10)}.${S.meta.dataDate.slice(5, 7)} · файл «${S.meta.csvName}» (${S.meta.runDate}) · последние 30 дней по ${S.meta.dataDate.slice(8, 10)}.${S.meta.dataDate.slice(5, 7)}</span>
    <button class="theme-btn" id="themeBtn">Тема</button>
  </header>

  <div class="krow">
    ${tile('Заявки, 30 дней', d30.total)}
    ${tile('Заявки в суммах, 30 дней', fmtS(d30.sumAll), null, null, 'сумма по всем заявкам')}
    ${tile('Конверсия в успех', fmtP(d30.crSucc), null, null)}
    ${tile('Успешные сделки, 30 дней', d30.succ, null, null, fmtS(d30.sumSucc))}
    ${tile('Провал, 30 дней', d30.fail, null, null, fmtP(d30.crFail))}
    ${tile('В работе', d30.open, null, null, 'сделок на входящих стадиях')}
  </div>

  <section class="card">
    <h2>1. Заявки по дням и каналам</h2>
    <p class="csub">За последние 30 дней по ${S.meta.dataDate.slice(8,10)}.${S.meta.dataDate.slice(5,7)}; месяц — ${S.meta.monthLabel.slice(3)} г.</p>
    <div class="grid2">
      <div>
        <h3>По дням, шт</h3>
        ${colChart(S.daily, 'n', v => String(v), 2)}
      </div>
      <div>
        <h3>По каналам (Источник), шт</h3>
        ${barChart(reqSrcRows, maxSrc30, 'var(--s1)', v => String(v))}
      </div>
    </div>
    <h3>По ответственным, шт</h3>
    ${barChart(USERS.map((u, i) => ({
      label: shortU(u),
      value: S.byUser[u].total,
      tt: `${u}: заявок 30д ${S.byUser[u].total}, неделя ${S.byUser.week[u] ? S.byUser.week[u].total : 0}, успех ${S.byUser[u].succ} (${fmtP(S.byUser[u].crSucc)})`,
    })), Math.max(...USERS.map(u => S.byUser[u].total)), 'var(--s1)', v => String(v))}
    <details class="tbl"><summary>Таблица — заявки по периодам и каналам</summary>
      ${table(['Канал', 'Сегодня', 'Неделя (26–30)', 'Месяц (= 30 дн.)', '30 дней'],
        SOURCES.map(s => [
          s,
          '0',
          S.bySource.week[s] ? S.bySource.week[s].total : 0,
          S.bySource[s].total,
          S.bySource[s].total,
        ]))}
      ${table(['Ответственный', 'Сегодня', 'Неделя (26–30)', 'Месяц (= 30 дн.)', '30 дней'],
        USERS.map(u => [u,
          '0',
          S.byUser.week[u] ? S.byUser.week[u].total : 0,
          S.byUser[u].total,
          S.byUser[u].total,
        ]))}
    </details>
  </section>

  <section class="card">
    <h2>2. Конверсия в успех и в провал</h2>
    <p class="csub">30 дней: 76 сделок. Причины провала хранятся в названиях провальных стадий выгрузки (поле «Причины провала» пустое).</p>
    ${stackedBar([
      { label: 'Успех', value: d30.succ, color: 'var(--st-good)', sum: d30.sumSucc },
      { label: 'Провал', value: d30.fail, color: 'var(--st-crit)', sum: d30.sumFail },
      { label: 'В работе', value: d30.open, color: 'var(--st-open)' },
    ])}
    <div class="grid2">
      <div>
        <h3>Причины провала, шт (30 дней)</h3>
        ${barChart(REASONS.map((r, i) => ({ label: r, value: d30.byReason[r] || 0, tt: `${r}: ${d30.byReason[r] || 0} провалов (${Math.round((d30.byReason[r] || 0) / d30.fail * 100)}% провалов, ${d30.byReason[r] ? Math.round((d30.byReason[r] || 0) / d30.total * 100) : 0}% всех заявок)` })),
          Math.max(...REASONS.map(r => d30.byReason[r] || 0)), 'var(--st-crit)', v => String(v))}
      </div>
      <div>
        <h3>Конверсия в успех по каналам, % (30 дней)</h3>
        ${barChart(srcByTotal.map(s => ({
          label: s, value: S.bySource[s].crSucc,
          tt: `${s}: успех ${S.bySource[s].succ} из ${S.bySource[s].total}, провал ${S.bySource[s].fail} (${fmtP(S.bySource[s].crFail)})`,
        })), 100, 'var(--s1)', fmtP)}
        <h3>Конверсия в успех по ответственным, % (30 дней)</h3>
        ${barChart(USERS.map(u => ({
          label: shortU(u), value: S.byUser[u].crSucc,
          tt: `${u}: успех ${S.byUser[u].succ} из ${S.byUser[u].total}, провал ${S.byUser[u].fail} (${fmtP(S.byUser[u].crFail)})`,
        })), 100, 'var(--s1)', fmtP)}
      </div>
    </div>
    <details class="tbl" open><summary>Таблица — конверсия по каналам (30 дней)</summary>
      ${table(['Канал', 'Успех, шт', 'Конверсия в успех', 'Провал, шт', 'Конверсия в провал'],
        SOURCES.map(s => [s, S.bySource[s].succ, fmtP(S.bySource[s].crSucc), S.bySource[s].fail, fmtP(S.bySource[s].crFail)]),
        ['Итого', d30.succ, fmtP(d30.crSucc), d30.fail, fmtP(d30.crFail)])}
    </details>
  </section>

  <section class="card">
    <h2>3. Скорость обработки новых сделок</h2>
    <p class="csub">В выгрузке нет даты перевода на стадию «Первый контакт» (нужна история стадий), поэтому точная скорость пока не считается.
    Ближайшая доступная метрика — сколько свежих сделок осталось на входящих стадиях и их возраст.</p>
    <div class="krow">
      ${tile('В работе сейчас', d30.open, null, null, 'из них дольше 3 дней: ' + S.openAging.filter(r => r.days > 3).length)}
      ${tile('Максимальный возраст', Math.max(...S.openAging.map(r => r.days)) + ' дн.', null, null, 'дня(ей) с момента создания')}
      ${tile('«Не смогли связаться»', d30.byReason['Не смогли связаться'], null, null, 'провалов из-за связи за 30 дней')}
    </div>
    ${table(['ID', 'Стадия', 'Ответственный', 'Создана', 'Возраст'],
      openAgeRows)}
    <div class="note">Старейшие сделки в работе (созданы в первой половине месяца) — первые кандидаты на прозвон сегодня.
    Для полноценной метрики скорости: добавьте в выгрузку поля «Дата изменения» / историю стадий (или используйте отчёт «Аналитика → Продажи» в Б24).</div>
  </section>

  <section class="card">
    <h2>4. Успешные сделки: количество и сумма</h2>
    <p class="csub">Суммы — по полю «Сумма» при стадии «Успех».</p>
    <div class="krow">
      ${tile('Сегодня', P.today.succ, null, null, fmtS(P.today.sumSucc))}
      ${tile('Текущая неделя', wk.succ, null, null, fmtS(wk.sumSucc))}
      ${tile('Текущий месяц', P.curMonth.succ, null, null, fmtS(P.curMonth.sumSucc))}
      ${tile('30 дней', d30.succ, null, null, fmtS(d30.sumSucc))}
    </div>
    <div class="grid2">
      <div>
        <h3>Успешные сделки по дням, шт</h3>
        ${colChart(S.daily, 'succ', v => String(v), 2)}
      </div>
      <div>
        <h3>Сумма успешных сделок по дням, тыс. ₽</h3>
        ${colChart(S.daily.map(d => ({ ...d, d: d.d, sumK: d.sum / 1000, tt: `${d.d}: ${fmtS(d.sum)}` })), 'sumK', v => fmtN(v), 2, 'cchart-green')}
      </div>
    </div>
    <details class="tbl"><summary>Таблица — по каналам и ответственным (30 дней)</summary>
      ${table(['Канал', 'Успех, шт', 'Сумма', 'Доля суммы'],
        srcByTotal.map(s => [s, S.bySource[s].succ, fmtS(S.bySource[s].sumSucc), fmtP(+((100 * S.bySource[s].sumSucc / d30.sumSucc).toFixed(1)))]),
        ['Итого', d30.succ, fmtS(d30.sumSucc), '100%'])}
      ${table(['Ответственный', 'Успех, шт', 'Сумма', 'Ср. чек'],
        USERS.map(u => [u, S.byUser[u].succ, fmtS(S.byUser[u].sumSucc), fmtN(S.byUser[u].sumSucc / Math.max(S.byUser[u].succ, 1)) + ' ₽']),
        ['Итого', d30.succ, fmtS(d30.sumSucc), fmtN(d30.sumSucc / Math.max(d30.succ, 1)) + ' ₽'])}
    </details>
  </section>

  <section class="card">
    <h2>5. Сравнение с прошлыми периодами</h2>
    <p class="csub">Текущая неделя (${S.weeksList[S.weeksList.length-1][0].slice(8,10)}.${S.weeksList[S.weeksList.length-1][0].slice(5,7)}–${S.weeksList[S.weeksList.length-1][1].slice(8,10)}.${S.weeksList[S.weeksList.length-1][1].slice(5,7)}) — в данных ${Math.round((new Date(S.meta.dataDate+'T00:00:00Z')-new Date(S.weeksList[S.weeksList.length-1][0]+'T00:00:00Z'))/864e5)+1} дн. из 7 — сравнение осторожно, неделя ещё не закрыта.
    Прошлый месяц и период 31–60 дней: выгрузка данных не содержит (в ней только октябрь) — дельта не считается.</p>
    <div class="krow">
      ${tile('Успешные, шт (неделя)', wk.succ, `${dSuccW.txt} к прошлой неделе`, dSuccW.tone, 'прошлая неделя: ' + pwk.succ)}
      ${tile('Сумма, ₽ (неделя)', fmtS(wk.sumSucc), `${dSuccSm.txt} к прошлой неделе`, dSuccSm.tone, 'прошлая неделя: ' + fmtS(pwk.sumSucc))}
      ${tile('Заявки, шт (неделя)', wk.total, `${dReqW.txt} к прошлой неделе`, dReqW.tone, 'прошлая неделя: ' + pwk.total)}
      ${tile('Месяц vs прошл. месяц', '—', null, null, 'в выгрузке нет сделок за сентябрь')}
      ${tile('30 дн. vs 31–60 дн.', '—', null, null, 'в выгрузке нет сделок за 31–60 дней')}
    </div>
    <div class="grid2">
      <div>
        <h3>Успешные сделки по каналам: тек. неделя vs прошлая, шт</h3>
        ${legend2()}
        ${barChart(srcCmp.flatMap(c => [
          { label: c.label + ' · тек.', value: c.week.succ, color: 'var(--s1)', tt: `${c.label}: тек. ${c.week.succ} (${fmtP(c.week.crSucc)}) vs прош. ${c.prev.succ} (${fmtP(c.prev.crSucc)})` },
          { label: c.label + ' · прош.', value: c.prev.succ, color: 'var(--s2)', tt: `${c.label}: тек. ${c.week.succ} vs прош. ${c.prev.succ}` },
        ]).filter(x => x.value > 0), Math.max(...srcCmp.map(c => Math.max(c.week.succ, c.prev.succ), 1)) * 2, 'var(--s1)', v => String(v))}
        <div class="note">В каждой паре — текущая (синий) и прошлая (оранжевый) неделя. Показаны только каналы с успехом хотя бы в одном из периодов.</div>
      </div>
      <div>
        <h3>По ответственным: тек. неделя vs прошлая, шт</h3>
        ${barChart(usrCmp.flatMap(c => [
          { label: c.label + ' · тек.', value: c.week.succ, color: 'var(--s1)', tt: `${c.label}: тек. ${c.week.succ} vs прош. ${c.prev.succ}` },
          { label: c.label + ' · прош.', value: c.prev.succ, color: 'var(--s2)', tt: '' },
        ]).filter(x => x.value > 0), Math.max(...usrCmp.map(c => Math.max(c.week.succ, c.prev.succ), 1)) * 2, 'var(--s1)', v => String(v))}
        <details class="tbl"><summary>Таблица — сравнение по каналам и ответственным</summary>
          ${table(['Канал', 'Заявки тек./прош.', 'Успех 30д / конв.', 'Сумма успеха 30д', 'Провалы по причинам (др.·отл.·связ.)'],
            srcCmpRows)}
          ${table(['Ответственный', 'Заявки тек./прош.', 'Успех 30д / конв.', 'Сумма успеха 30д', 'Провалы по причинам (др.·отл.·связ.)'],
            usrCmpRows)}
        </details>
      </div>
    </div>
  </section>

  <section class="card">
    <h2>6. Тренды: конверсия в успех по неделям</h2>
    <p class="csub">Недель в данных — ${S.weeksList.length}. Цвет ячейки — конверсия в успех в штуках; подсказка содержит суммы.
    * последняя неделя ещё не закрыта (данных на её конец нет).</p>
    <div class="grid2">
      <div>${heatmap(srcTrend, 'По каналам', 'конверсия в успех, %')}</div>
      <div>${heatmap(usrTrend.map(r => ({ ...r, key: shortU(r.key) })), 'По ответственным', 'конверсия в успех, %')}</div>
    </div>
    <details class="tbl"><summary>Таблица — суммы по неделям</summary>
      ${table(['Канал', 'Неделя', 'Заявок', 'Успех, шт', 'Сумма успеха'],
        SOURCES.flatMap(s => srcTrend.find(r => r.key === s).cells.filter(c => c.c).map(c =>
          [s, c.label, c.c.total, c.c.succ, fmtS(c.c.sumSucc)])))}
      ${table(['Ответственный', 'Неделя', 'Заявок', 'Успех, шт', 'Сумма успеха'],
        USERS.flatMap(u => usrTrend.find(r => r.key === u).cells.filter(c => c.c).map(c =>
          [u, c.label, c.c.total, c.c.succ, fmtS(c.c.sumSucc)])))}
    </details>
  </section>

  <section class="card">
    <h2>7. Выводы и рекомендации</h2>
    ${genConclusions(S)}
  </section>

  <footer class="ft">Построено автоматически из «Сделки из Б24.csv» (папка data) скриптом scripts/build_dashboard.js · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · периоды: неделя Пн–Вс, месяц — октябрь</footer>
</div>
<div id="tt" role="status"></div>
<script>
  (function () {
    var tt = document.getElementById('tt');
    document.addEventListener('mousemove', function (e) {
      var t = e.target.closest('[data-tt]');
      if (t && t.getAttribute('data-tt')) {
        tt.textContent = t.getAttribute('data-tt');
        tt.style.display = 'block';
        var x = Math.min(e.clientX + 14, window.innerWidth - tt.offsetWidth - 10);
        var y = Math.min(e.clientY + 16, window.innerHeight - tt.offsetHeight - 10);
        tt.style.left = x + 'px'; tt.style.top = y + 'px';
      } else { tt.style.display = 'none'; }
    });
    var btn = document.getElementById('themeBtn');
    btn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      btn.textContent = next === 'dark' ? 'Светлая тема' : 'Тёмная тема';
    });
    // для PDF: раскрыть все таблицы и пометить тело как pdf-версию
    if (location.search.indexOf('print') !== -1) {
      document.body.classList.add('pdf');
      document.querySelectorAll('details').forEach(function (d) { d.open = true; });
    }
  })();
</script>
</body>
</html>`;

const htmlName = 'reports/dashboard-marketing_' + S.meta.runDate + '.html'; // дд.мм.гггг
fs.writeFileSync(htmlName, html);
console.log('OK', htmlName, html.length, 'bytes');