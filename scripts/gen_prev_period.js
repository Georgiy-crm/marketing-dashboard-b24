// Формирует повтор предыдущих 76 сделок с датами создания 01–12.10.2026
// (только рабочие дни; выходные — сделки не поступали).
// Источник: tmp/deals/deals_utf8.csv (конвертированная utf-8 копия «data/Сделки из Б24.csv»).
// Выход: reports/tmp CSV → data/Сделки из Б24_30.10.2026.csv (cp1251, через iconv снаружи).
// Запуск: node scripts/gen_prev_period.js
const fs = require('fs');
const txt = fs.readFileSync('tmp/deals/deals_utf8.csv', 'utf8');
const lines = txt.split(/\r?\n/).filter(l => l.trim());
function parse(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ';') { out.push(cur); cur = ''; } else cur += c; }
  }
  out.push(cur); return out;
}
const rows = lines.slice(1).map(parse).map(r => ({
  id: +r[0], title: r[1], stage: r[2], amount: r[3], user: r[4], source: r[5],
}));
if (rows.length !== 76) { console.error('ожидалось 76 строк, получено ' + rows.length); process.exit(1); }
console.log('исходных строк:', rows.length);

// --- воспроизводимый ГПСЧ ---
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261030);
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// --- перераспределение источников: итог 15/14/17/8/11/11 (заявка из приложения - из остатка) ---
// меняем 11 строк «Заявка из приложения»: +4 Существующий клиент, +2 Реклама в ВК, +5 По рекомендации
const SRC_CHANGE = shuffle(rows.filter(r => r.source === 'Заявка из приложения'))
  .slice(0, 11).map((r, i) => (r.newSource = ['Существующий клиент', 'Существующий клиент', 'Существующий клиент', 'Существующий клиент',
    'Реклама в ВК', 'Реклама в ВК', 'По рекомендации', 'По рекомендации', 'По рекомендации', 'По рекомендации', 'По рекомендации'][i], r));

// --- перераспределение ответственных: итог Трубаев 25 (+6), Георгий 20 (+4), Толкачев 31 (-10) ---
// меняем 10 строк Толкачева: 6 → Трубаев, 4 → Георгий (кроме уже сменивших источник — так меньше искажений)
const srcChanged = new Set(SRC_CHANGE.map(r => r.id));
const USER_CHANGE = shuffle(rows.filter(r => r.user.includes('Толкачев') && !srcChanged.has(r.id)))
  .slice(0, 10).map((r, i) => (r.newUser = ['Трубаев Валерий', 'Трубаев Валерий', 'Трубаев Валерий', 'Трубаев Валерий', 'Трубаев Валерий', 'Трубаев Валерий',
    '(Интегратор) Георгий', '(Интегратор) Георгий', '(Интегратор) Георгий', '(Интегратор) Георгий'][i], r));

// --- даты создания: рабочие дни 01–12.10.2026 ---
// 01.10 чт, 02.10 пт, 05.10 пн, 06.10 вт, 07.10 ср, 08.10 чт, 09.10 пт, 12.10 пн (03-04 и 10-11 — выходные, сделок нет)
const weekdays = [1, 2, 5, 6, 7, 8, 9, 12];
// 76 сделок: четыре дня по 10 и четыре по 9
const dayCounts = [10, 10, 10, 10, 9, 9, 9, 9];
const zero2 = d => (d < 10 ? '0' : '') + d;
const datePool2 = [];
weekdays.forEach((d, i) => { for (let k = 0; k < dayCounts[i]; k++) datePool2.push(`${zero2(d)}.10.2026`); });
const dates = shuffle(datePool2);
if (dates.length !== 76) { console.error('пул дат: ' + dates.length); process.exit(1); }

// --- сборка повторных записей ---
const pad = n => String(n);
let nextId = 14173; // ниже минимального существующего (14174)
const synth = rows.map((r, i) => {
  const src = r.newSource || r.source;
  const user = r.newUser || r.user;
  const created = dates[i];
  const [dd, mm, yy] = created.split('.');
  const base = new Date(Date.UTC(+yy, +mm - 1, +dd));
  let close;
  if (r.stage === 'УСПЕХ') {
    base.setUTCDate(base.getUTCDate() + 2 + Math.floor(rnd() * 3)); // +2..4 дня
    close = `${zero2(base.getUTCDate())}.${zero2(base.getUTCMonth() + 1)}.${base.getUTCFullYear()}`;
  } else {
    close = '12.10.2026';
  }
  return {
    id: nextId--, title: r.title, stage: r.stage, amount: r.amount,
    user, source: src, created, close,
    interest: '', failReason: '',
  };
});

// --- CSV: 76 исходных + 76 повторных, сортировка по ID по убыванию ---
const escCsv = v => {
  const s = String(v);
  return /[;\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const header = lines[0];
const all = [...synth, ...rows.map(r => ({
  id: r.id, title: r.title, stage: r.stage, amount: r.amount, user: r.user, source: r.source,
  created: '13.10.2026', close: '', interest: '', failReason: '',
  _keepOriginalDate: true, _orig: r,
}))];
// для исходных 76 строк — их исходные даты создания/закрытия
const origDates = new Map();
txt.split(/\r?\n/).filter(l => l.trim()).slice(1).forEach(l => {
  const p = parse(l); origDates.set(+p[0], [p[6], p[7], p[8], p[9]]);
});
const outRows = all.sort((a, b) => b.id - a.id).map(r => {
  if (r._keepOriginalDate) { const [c, cl, int, fr] = origDates.get(r.id); return [r.id, r.title, r.stage, r.amount, r.user, r.source, c, cl, int, fr]; }
  return [r.id, r.title, r.stage, r.amount, r.user, r.source, r.created, r.close, r.interest, r.failReason];
});
const csv = [header, ...outRows.map(r => r.map(escCsv).join(';'))].join('\n') + '\n';
fs.writeFileSync('tmp/deals/merged_utf8.csv', csv, 'utf8');

// --- отчёт ---
const agg = (rows, f) => { const o = {}; rows.forEach(r => o[f(r)] = (o[f(r)] || 0) + 1); return o; };
console.log('повторные записи по источникам:', JSON.stringify(agg(synth, r => r.source)));
console.log('повторные записи по ответственным:', JSON.stringify(agg(synth, r => r.user)));
console.log('по дням:', JSON.stringify(dates.reduce((a, d) => (a[d] = (a[d] || 0) + 1, a), {})));
console.log('УСПЕХ среди повторных:', synth.filter(r => r.stage === 'УСПЕХ').length);
console.log('всего строк в файле:', outRows.length);