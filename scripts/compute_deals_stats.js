// Считает агрегаты по сделкам Б24 из CSV и печатает JSON
const fs = require('fs');
const CSV = process.argv[2] || 'tmp/deals/deals_utf8.csv';
// CSV из Б24 в cp1251; если файл уже в UTF-8 — оставляем как есть
const buf = fs.readFileSync(CSV);
let txt = new TextDecoder('utf8').decode(buf);
if (txt.includes('�')) txt = new TextDecoder('windows-1251').decode(buf);
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
  id: r[0], title: r[1], stage: r[2], amount: parseFloat(String(r[3]).replace(/\s/g, '').replace(',', '.')) || 0,
  user: r[4], source: r[5],
  created: r[6].trim(),
  close: r[7].trim(),
}));
function parseDate(s) {
  if (!s) return null;
  const [d, t] = s.split(' ');
  const [dd, mm, yy] = d.split('.');
  return `${yy}-${mm}-${dd}`;
}
rows.forEach(r => { r.d = parseDate(r.created); r.dClose = parseDate(r.close); r.day = +r.d.slice(8, 10); });
const ANCHOR = rows.reduce((a, r) => (a == null || r.d > a) ? r.d : a, null); // дата последних данных в выгрузке
const TODAY = ANCHOR;

const SUCCESS = 'УСПЕХ';
const OPEN = ['Входящие', 'Первый контакт', 'Повторный контакт'];
function stateOf(r) { if (r.stage === SUCCESS) return 'success'; return OPEN.includes(r.stage) ? 'open' : 'fail'; }
rows.forEach(r => r.state = stateOf(r));

const wk = s => { const dt = new Date(s + 'T00:00:00Z'); const dow = (dt.getUTCDay() + 6) % 7; return [
  new Date(dt.getTime() - dow * 864e5).toISOString().slice(0, 10),
  new Date(dt.getTime() - dow * 864e5 + 6 * 864e5).toISOString().slice(0, 10)]; };
const dISO = off => new Date(new Date(ANCHOR + 'T00:00:00Z').getTime() + off * 864e5).toISOString().slice(0, 10);
const [wkA, wkB] = wk(ANCHOR);
const prevWkA = dISO(-7);
const m1 = ANCHOR.slice(0, 7) + '-01';                                  // 1-е число месяца якоря
const pm = ANCHOR.slice(5, 7) === '01'
  ? String(Number(ANCHOR.slice(0, 4)) - 1) + '-12'
  : String(Number(ANCHOR.slice(5, 7)) - 1).padStart(2, '0');            // прошлый месяц 'YYYY-MM'
const pmLast = new Date(Date.UTC(Number(ANCHOR.slice(0, 4)) - (pm === '12' ? 1 : 0), Number(pm) - 1 + 1, 0)); // последний день прошлого месяца
const ranges = {
  today: [ANCHOR, ANCHOR],
  curWeek: [wkA, wkB],
  prevWeek: [wk(prevWkA)[0], prevWkA],
  curMonth: [m1, ANCHOR],
  prevMonth: [pm + '-01', pmLast.toISOString().slice(0, 10)],
  d30: [dISO(-29), ANCHOR],
  d31_60: [dISO(-59), dISO(-30)],
};
const meta = {
  csvName: require('path').basename(CSV),
  runDate: new Date().toLocaleDateString('ru-RU'),
  dataDate: ANCHOR,
  monthLabel: ANCHOR.slice(5, 7) + '.' + ANCHOR.slice(0, 4),
};
const inR = (r, [a, b]) => r.d >= a && r.d <= b;
function agg(rs) {
  const total = rs.length;
  const succ = rs.filter(r => r.state === 'success');
  const fail = rs.filter(r => r.state === 'fail');
  const open = rs.filter(r => r.state === 'open');
  const byReason = {};
  fail.forEach(r => byReason[r.stage] = (byReason[r.stage] || 0) + 1);
  return { total, succ: succ.length, fail: fail.length, open: open.length,
    sumAll: rsum(rs), sumSucc: rsum(succ), sumFail: rsum(fail),
    crSucc: total ? +(100 * succ.length / total).toFixed(1) : null,
    crFail: total ? +(100 * fail.length / total).toFixed(1) : null, byReason, openStages: cnt(open, r => r.stage) };
}
const rsum = rs => rs.reduce((a, r) => a + r.amount, 0);
const cnt = (rs, f) => { const o = {}; rs.forEach(r => o[f(r)] = (o[f(r)] || 0) + 1); return o; };

const out = { periods: {}, meta };
for (const [k, rg] of Object.entries(ranges)) out.periods[k] = agg(rows.filter(r => inR(r, rg)));
// по дням 30 дней
out.daily = [];
for (let i = 0; i < 30; i++) {
  const dt = new Date(ANCHOR + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() - i);
  const day = dt.toISOString().slice(0, 10);
  const rs = rows.filter(r => r.d === day);
  out.daily.unshift({ day, n: rs.length, succ: rs.filter(r => r.state === 'success').length, sum: rsum(rs.filter(r => r.state === 'success')) });
}
// по источникам (30д и недели)
const srcAgg = rg => { const o = {}; cnt(rows.filter(r => inR(r, rg)), r => r.source); };
function groupAgg(field, rg) { const o = {}; rows.filter(r => inR(r, rg)).forEach(r => { (o[r[field]] = o[r[field]] || []).push(r); });
  const res = {}; for (const [g, rs] of Object.entries(o)) res[g] = agg(rs); return res; }
out.bySource = groupAgg('source', ranges.d30);
out.bySource.week = groupAgg('source', ranges.curWeek);
out.bySource.prevWeek = groupAgg('source', ranges.prevWeek);
out.byUser = groupAgg('user', ranges.d30);
out.byUser.week = groupAgg('user', ranges.curWeek);
out.byUser.prevWeek = groupAgg('user', ranges.prevWeek);
out.weeklyConv = { sources: {}, users: {} };
const minDate = rows.reduce((a, r) => (a == null || r.d < a) ? r.d : a, null);
const maxDate = rows.reduce((a, r) => (a == null || r.d > a) ? r.d : a, null);
const weeksList = [];
{
  let w0 = wk(minDate)[0]; const wMax = wk(maxDate)[0];
  while (w0 <= wMax) {
    weeksList.push([w0, new Date(new Date(w0 + 'T00:00:00Z').getTime() + 6 * 864e5).toISOString().slice(0, 10)]);
    w0 = new Date(new Date(w0 + 'T00:00:00Z').getTime() + 7 * 864e5).toISOString().slice(0, 10);
  }
}
out.weeksList = weeksList;
for (const [wk0, wk1] of weeksList) {
  const lbl = `${wk0.slice(8,10)}.${wk0.slice(5,7)}–${wk1.slice(8,10)}.${wk1.slice(5,7)}`;
  rows.filter(r => inR(r, [wk0, wk1])).forEach(r => {
    const k = lbl;
    if (r.source) { ((out.weeklyConv.sources[r.source] = out.weeklyConv.sources[r.source] || {})[k] = out.weeklyConv.sources[r.source][k] || { total: 0, succ: 0, sumAll: 0, sumSucc: 0 }); const c = out.weeklyConv.sources[r.source][k]; c.total++; if (r.state === 'success') { c.succ++; c.sumSucc += r.amount; } c.sumAll += r.amount; }
    if (r.user) { ((out.weeklyConv.users[r.user] = out.weeklyConv.users[r.user] || {})[k] = out.weeklyConv.users[r.user][k] || { total: 0, succ: 0, sumAll: 0, sumSucc: 0 }); const c = out.weeklyConv.users[r.user][k]; c.total++; if (r.state === 'success') { c.succ++; c.sumSucc += r.amount; } c.sumAll += r.amount; }
  });
}
// аномалии дат закрытия
out.badClose = rows.filter(r => r.dClose && r.dClose < r.d).map(r => ({ id: r.id, dClose: r.close, d: r.created, stage: r.stage }));
// сделки в работе, возраст
out.openAging = rows.filter(r => r.state === 'open').map(r => ({ id: r.id, stage: r.stage, user: r.user, created: r.created, days: Math.round((new Date(ANCHOR + 'T00:00:00Z') - new Date(r.d + 'T00:00:00Z')) / 864e5) }));
// скорость: даты создания успешных vs остальных (создан -> (дата закрытия планировалась))
out.rows = rows.length;
out.usersList = Object.keys(groupAgg('user', ranges.d30));
out.sourcesList = Object.keys(groupAgg('source', ranges.d30));
fs.writeFileSync('tmp/deals/stats.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
