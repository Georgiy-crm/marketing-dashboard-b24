// Одноразовый патч build_dashboard.js: авто-выводы, динамическая шапка и подписи
const fs = require('fs');
const p = 'scripts/build_dashboard.js';
let s = fs.readFileSync(p, 'utf8');

// 1) генератор выводов — вставить перед сборкой HTML
const genFn = `
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
  if (bestC) items.push(\`<li><b>\${esc(bestC.n)} — лучший канал по конверсии (\${fmtP(bestC.crSucc)} при средней \${fmtP(avgConv)}): масштабировать.</b> Объём \${bestC.total} заявок, средний чек успешных \${fmtN(cheque(bestC))} ₽.\${bestC.crSucc < 50 ? ' Резерв — до вытяги: поднять обработку, а не только приток.' : ''}</li>\`);

  const bestQ = [...srcs].filter(x => big(x) && x.succ > 0).sort((a, b) => cheque(b) - cheque(a))[0];
  if (bestQ && bestQ !== bestC) items.push(\`<li><b>\${esc(bestQ.n)} — лучший средний чек (\${fmtN(cheque(bestQ))} ₽) при конверсии \${fmtP(bestQ.crSucc)}: усилить.</b> Если это рекомендации — формализовать бонус за рекомендацию; если платные каналы — поднять долю Premium-лидов.</li>\`);

  const worst = [...srcs].filter(big).sort((a, b) => a.crSucc - b.crSucc)[0];
  if (worst && worst !== bestC) {
    const topReasons = Object.entries(worst.byReason).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r, k]) => \`\${r} (\${k})\`).join(', ');
    items.push(\`<li><b>\${esc(worst.n)} — объём \${worst.total} заявок, но конверсия всего \${fmtP(worst.crSucc)} (хуже средней \${fmtP(avgConv)}): разобрать качество и скорость.</b> Топ-причины провалов: \${topReasons}. Проверить квалификацию лидов и время первого касания — «остывание» убивает заявки этого канала быстрее всего.</li>\`);
  }

  Object.entries(d30.byReason).sort((a, b) => b[1] - a[1]).forEach(([reason, k]) => {
    const share = Math.round(k / d30.total * 100);
    const rec = REASON_REC[reason] || 'назначить ответственного за разбор этой причины';
    const who = S.usersList.filter(u => (S.byUser[u].byReason[reason] || 0) > 0)
      .sort((a, b) => S.byUser[b].byReason[reason] - S.byUser[a].byReason[reason]).slice(0, 2)
      .map(u => \`\${shortU(u)} — \${S.byUser[u].byReason[reason]}\`).join(', ');
    items.push(\`<li><b>«\${esc(reason)}» — \${k} провалов (\${share}% всех заявок): \${rec}.</b>\${who ? \` Больше всех: \${esc(who)}.\` : ''}</li>\`);
  });

  if (users.length) {
    const worstU = [...users].filter(x => x.total >= 15).sort((a, b) => a.crSucc - b.crSucc)[0];
    if (worstU) {
      const others = users.filter(u => u !== worstU).map(u => \`\${u.n.includes('Толкачев') ? 'Толкачев' : u.n.includes('Трубаев') ? 'Трубаев' : 'Георгий'} \${fmtP(u.crSucc)}\`).join(', ');
      const r = Object.entries(worstU.byReason).sort((a, b) => b[1] - a[1])[0];
      items.push(\`<li><b>\${esc(worstU.n)} — конверсия \${fmtP(worstU.crSucc)} при \${worstU.total} заявках: скрипты и разбор.</b> Для сравнения: \${others}. \${r ? \`Топ-причина — «\${esc(r[0])}» (\${r[1]} из \${worstU.fail} провалов): нужен шаблон следующего шага и разбор на созвоне.\` : ''}</li>\`);
    }
  }

  const missing = ALL_CHANNELS.filter(c => !srcs.some(x => x.n === c));
  if (missing.length) items.push(\`<li><b>Без заявок:\${missing.length > 1 ? ' каналы' : ' канал'} \${missing.map(esc).join(', ')}</b> — \${missing.length > 1 ? 'не дали' : 'не дал'} ни одной сделки за период. Проверить, подключён ли канал в CRM; если нет — запустить или исключить из плана.</li>\`);

  if (curW.total != null && prevW.total != null) {
    const d = curW.total - prevW.total;
    const pct = prevW.total ? Math.round(d / prevW.total * 100) : null;
    const trend = d < 0 ? \`просел с \${prevW.total} до \${curW.total} заявок (\${pct}%)\` : d > 0 ? \`вырос с \${prevW.total} до \${curW.total} заявок (+\${pct}%)\` : 'без изменений';
    const lag = Math.round((new Date(S.meta.runDate.split('.').reverse().join('-') + 'T00:00:00Z') - new Date(S.meta.dataDate + 'T00:00:00Z')) / 864e5);
    items.push(\`<li><b>Поток заявок \${trend}.</b>\${lag >= 2 ? \` С последней заявки в таблице прошло \${lag} дн. — проверьте, на что перестало приходить.\` : ''} Узкое место — не обработка (\${prevW.crSucc != null ? \`конверсия \${fmtP(prevW.crSucc)} → \${fmtP(curW.crSucc)}\` : ''}), а приток лидов.</li>\`);
  }

  if (S.badClose.length) {
    items.push(\`<li><b>Качество данных (исправить в Б24):</b> у \${S.badClose.length} сделок (ID \${S.badClose.map(x => x.id).join(', ')}) дата закрытия раньше даты создания; поле «Причины провала (заявки)» в выгрузке пустое — причины живут в названиях стадий; у проваленных сделок заполнено «Сумма», поэтому «сумма провала» (\${fmtS(d30.sumFail)}) — не потерянная выручка, а незакрытые суммы.</li>\`);
  }
  return '<ol class="concl">' + items.join('\\n') + '</ol>';
}
`;
s = s.replace('// ---------- HTML ----------', genFn + '\n// ---------- HTML ----------');

// 2) шапка — динамическая
s = s.replace(/<span class="hd-meta">данные:[^<]*<\/span>/,
'<span class="hd-meta">данные: ${S.daily.filter(d => d.n > 0)[0].d}–${S.meta.dataDate.slice(8, 10)}.${S.meta.dataDate.slice(5, 7)} · файл «${S.meta.csvName}» (${S.meta.runDate}) · последние 30 дней по ${S.meta.dataDate.slice(8, 10)}.${S.meta.dataDate.slice(5, 7)}</span>');

// 3) выводы — генерация вместо готового списка
s = s.replace(/<ol class="concl">[\s\S]*?<\/ol>/, '${genConclusions(S)}');

// 4) подпись раздела 1 — динамическая
s = s.replace('За последние 30 дней (совпадают с текущим месяцем — выгрузка за октябрь).',
'За последние 30 дней по ${S.meta.dataDate.slice(8,10)}.${S.meta.dataDate.slice(5,7)}; месяц — ${S.meta.monthLabel.slice(3)} г.');

// 5) подпись раздела 5 — динамическая (сколько дней недели прошло)
s = s.replace('Текущая неделя 26–30 октября ещё неполная (5 из 7 дней) — сравнение осторожно, к воскресенью цифры могут вырасти.',
'Текущая неделя (${S.weeksList[S.weeksList.length-1][0].slice(8,10)}.${S.weeksList[S.weeksList.length-1][0].slice(5,7)}–${S.weeksList[S.weeksList.length-1][1].slice(8,10)}.${S.weeksList[S.weeksList.length-1][1].slice(5,7)}) — в данных ${Math.round((new Date(S.meta.dataDate+\'T00:00:00Z\')-new Date(S.weeksList[S.weeksList.length-1][0]+\'T00:00:00Z\'))/864e5)+1} дн. из 7 — сравнение осторожно, неделя ещё не закрыта.');

if (!(s.includes('genConclusions') && s.includes('hd-meta">данные: ${'))) throw new Error('patch failed');
fs.writeFileSync(p, s);
console.log('patched build OK');