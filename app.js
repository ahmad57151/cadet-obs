'use strict';
/* Cadet Observations — Stage 1
   All data stays on this device (IndexedDB). No network calls except loading the app itself. */

const APP_VERSION = '0.3.0';
const OBS_DEFAULT = [
  'Precis not in possession', 'Writing material not in possession', 'Arriving late', 'Missing from class',
  'Asg not submitted', 'Public speaking not prepared', 'Sleeping in class', 'Not behaving'
];
const PUN = [
  { id: 'back', label: 'Stand at the back', pending: false, cls: '' },
  { id: 'warn', label: 'Verbal warning', pending: false, cls: '' },
  { id: 'plcomd', label: 'Talk to Pl Comd', pending: true, cls: 'amb' },
  { id: 'sitrep', label: 'Initiate sitrep', pending: true, cls: 'red' }
];
const punLabel = (id) => (PUN.find((p) => p.id === id) || { label: 'Not decided' }).label;

/* ---------- storage ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('cadetobs', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  get(k) {
    return new Promise((res, rej) => {
      const q = this.db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  },
  set(k, v) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  }
};

const today = () => new Date().toISOString().slice(0, 10);
let S = null; // persisted state
const freshState = () => ({
  v: 1, cadets: {}, classes: [], entries: [], comds: [],
  settings: { currentClass: null, termStart: today(), obs: OBS_DEFAULT.slice() }
});
async function save() { await DB.set('state', S); }

/* ---------- ui state ---------- */
const U = {
  view: 'record', mode: 'cadet', pl: 'All', q: '',
  cadet: null, selObs: null, note: '', showNote: false,
  batchObs: null, batchSel: new Set(), batchPun: 'back',
  profile: null, sheet: null, toast: null, preview: null
};

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-'.])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const termTs = () => new Date(S.settings.termStart + 'T00:00:00').getTime();
const fmtWhen = (ts) => {
  const d = new Date(ts), now = new Date();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === now.toDateString()) return 'Today ' + t;
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + t;
};
const curClass = () => S.classes.find((c) => c.id === S.settings.currentClass) || null;
const className = (c) => c ? `${c.subject} · ${c.course} · Gp ${c.gp}` : '';
const classCadets = (c) => !c ? [] : Object.values(S.cadets)
  .filter((x) => x.active && x.course === c.course && x.gp === c.gp)
  .sort((a, b) => a.pl.localeCompare(b.pl) || a.gc - b.gc);
const termEntries = (gc) => S.entries.filter((e) => e.gc === gc && e.ts >= termTs());
const countPill = (n) => n === 0 ? '<span class="pill p-ok">Clear</span>' : `<span class="pill ${n >= 4 ? 'p-red' : 'p-amb'}">${n} obs</span>`;
const pendingCount = () => S.entries.filter((e) => e.status === 'pending').length;
const comdFor = (role, key) => S.comds.find((m) => m.role === role && m.key === key);

const ICON = {
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5B5B55" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8FD19E" stroke-width="2.5" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  nav: {
    record: 'M12 5v14M5 12h14',
    pending: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18',
    reports: 'M5 19V10M12 19V5M19 19v-7',
    settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4'
  }
};

/* ---------- render ---------- */
function render() {
  if (U.lock) { $('#app').innerHTML = lockHtml(); return; }
  let html = '';
  if (U.view === 'record') html = U.cadet ? viewCadet() : viewRecord();
  else if (U.view === 'profile') html = viewProfile();
  else if (U.view === 'pending') html = viewPending();
  else if (U.view === 'reports') html = viewReports();
  else if (U.view === 'settings') html = viewSettings();
  else if (U.view === 'class') html = viewClass();
  html += navHtml();
  if (U.toast) html += toastHtml();
  if (U.sheet) html += sheetHtml();
  $('#app').innerHTML = html;
  const s = $('#q'); if (s && U._focusSearch) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); U._focusSearch = false; }
}

function navHtml() {
  const items = [['record', 'Record'], ['pending', 'Pending'], ['reports', 'Reports'], ['settings', 'Settings']];
  const pc = pendingCount();
  return `<nav class="nav">${items.map(([k, l]) => `<button class="${U.view === k || (k === 'record' && U.view === 'profile') ? 'on' : ''}" data-act="nav" data-arg="${k}">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${ICON.nav[k]}"/></svg>${l}
    ${k === 'pending' && pc ? `<span class="badge">${pc}</span>` : ''}</button>`).join('')}</nav>`;
}

function toastHtml() {
  const t = U.toast;
  return `<div class="toast ${U.view === 'record' && !U.cadet && U.mode === 'batch' ? 'high' : ''}" role="status">${ICON.check}<div class="grow"><b style="font-size:14px">${esc(t.msg)}</b><span>${esc(t.sub)}</span></div>
    ${t.undo ? '<button data-act="undo">UNDO</button>' : ''}</div>`;
}

function classHeader(kicker) {
  const c = curClass();
  return `<div class="row"><h1>${kicker}</h1><span class="kicker">${new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
    <button class="classbtn" data-act="openClasses"><span class="l"><small>CURRENT CLASS</small><b>${c ? esc(className(c)) : 'Tap to add a class'}</b></span>
    <span style="font-size:13px;font-weight:600;color:#D9E3DA;display:flex;gap:4px;align-items:center">Change ${ICON.down}</span></button>`;
}

function viewRecord() {
  const c = curClass();
  let body;
  if (!c) {
    body = `<div class="empty"><b>Set up your first class</b><span>A class is Subject + Course + Gp, e.g. ICT · 158 L/C · Gp A. Create the class, then import or add its cadets.</span>
      <button class="btn pri" data-act="openClasses">Add class</button></div>`;
  } else {
    const cadets = classCadets(c);
    const pls = ['All', ...new Set(cadets.map((x) => x.pl))];
    if (!pls.includes(U.pl)) U.pl = 'All';
 body = backupBanner() + `<label class="search">${ICON.search}<input id="q" type="text" inputmode="search" placeholder="Last digits of GC No, or name" aria-label="Search cadet" value="${esc(U.q)}"></label>
      ${U.mode === 'batch' ? batchObsHtml() : ''}
      <div class="chips">${pls.map((p) => `<button class="chip ${U.pl === p ? 'on' : ''}" data-act="pl" data-arg="${esc(p)}">${esc(p)}</button>`).join('')}
      <span style="flex:1;text-align:right" class="small">${cadets.length} cadets</span></div>
      <div id="list" class="list">${listHtml()}</div>
`;
    if (U.mode === 'batch') body += batchFootHtml();
  }
  return `<header class="hdr">${classHeader('Record')}
    ${c ? `<div class="seg"><button class="${U.mode === 'cadet' ? 'on' : ''}" data-act="mode" data-arg="cadet">Cadet first</button><button class="${U.mode === 'batch' ? 'on' : ''}" data-act="mode" data-arg="batch">Observation first</button></div>` : ''}
    </header><main class="body" style="${U.mode === 'batch' && c ? 'padding-bottom:260px' : ''}">${body}</main>`;
}

function filteredCadets() {
  const q = U.q.trim().toLowerCase();
  return classCadets(curClass()).filter((x) => (U.pl === 'All' || x.pl === U.pl) &&
    (!q || String(x.gc).endsWith(q) || String(x.gc).includes(q) || x.name.toLowerCase().includes(q)));
}

function listHtml() {
  const rows = filteredCadets();
  if (!rows.length) return classCadets(curClass()).length ? '<div class="empty"><span>No cadet matches.</span></div>'
    : `<div class="empty"><b>No cadets in this class yet</b><span>Import the class list from Excel/CSV, or add cadets one by one.</span>
      <button class="btn pri" data-act="openClass" data-arg="${curClass().id}">Import / add cadets</button></div>`;
  if (U.mode === 'batch') {
    return rows.map((x) => {
      const on = U.batchSel.has(x.gc);
      const n = U.batchObs ? termEntries(x.gc).filter((e) => e.obs === U.batchObs).length : 0;
      return `<button class="crow ${on ? 'sel' : ''}" data-act="batchToggle" data-arg="${x.gc}" aria-pressed="${on}">
        <input type="checkbox" tabindex="-1" ${on ? 'checked' : ''} aria-hidden="true">
        <span class="grow"><span class="nm">${esc(x.name)}${x.tag ? `<span class="tag">${esc(x.tag)}</span>` : ''}</span><span class="sub">GC ${x.gc} · ${esc(x.pl)}</span></span>
        ${U.batchObs && on ? `<span class="pill ${n >= 2 ? 'p-red' : 'p-grey'}">${ord(n + 1)} time</span>` : ''}</button>`;
    }).join('');
  }
  return rows.map((x) => `<button class="crow" data-act="openCadet" data-arg="${x.gc}">
    <span class="av">${esc(initials(x.name))}</span>
    <span class="grow"><span class="nm">${esc(x.name)}${x.tag ? `<span class="tag">${esc(x.tag)}</span>` : ''}${x.appt ? `<span class="tag" style="background:#EFEDE5;color:#3F3F3A">${esc(x.appt)}</span>` : ''}</span>
    <span class="sub">GC ${x.gc} · ${esc(x.pl)}</span></span>${countPill(termEntries(x.gc).length)}</button>`).join('');
}

function batchObsHtml() {
  return `<span class="label">1 · Observation</span><div class="chips">${S.settings.obs.map((o, i) =>
    `<button class="chip sm ${U.batchObs === o ? 'on' : ''}" data-act="batchObs" data-arg="${i}">${esc(o)}</button>`).join('')}</div>
    <div class="between"><span class="label">2 · Tick cadets</span>${U.batchSel.size ? '<button class="chip sm" style="border:0" data-act="batchClear">Clear all</button>' : ''}</div>`;
}

function batchFootHtml() {
  const n = U.batchSel.size, ok = n && U.batchObs;
  return `<div class="foot"><label class="field"><span class="label">3 · Punishment for all ticked</span>
    <select id="batchPun">${PUN.map((p) => `<option value="${p.id}" ${U.batchPun === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}
    <option value="" ${U.batchPun === '' ? 'selected' : ''}>Decide later (each cadet)</option></select></label>
    <button class="btn pri" data-act="batchSave" ${ok ? '' : 'disabled'}>${ok ? `Save “${esc(U.batchObs)}” for ${n} cadet${n > 1 ? 's' : ''}` : (U.batchObs ? 'Tick cadets' : 'Choose an observation')}</button></div>`;
}

function viewCadet() {
  const x = S.cadets[U.cadet];
  const te = termEntries(x.gc);
  const obsHtml = S.settings.obs.map((o, i) => {
    const n = te.filter((e) => e.obs === o).length, on = U.selObs === o;
    return `<button class="obs ${on ? 'on' : ''}" data-act="selObs" data-arg="${i}"><b>${esc(o)}</b><span>${n === 0 ? 'Never' : n + '× before'}</span></button>`;
  }).join('');
  let hint = '';
  if (U.selObs) {
    const prev = te.filter((e) => e.obs === U.selObs).sort((a, b) => b.ts - a.ts);
    hint = prev.length
      ? `<div class="hint"><span><b>${ord(prev.length + 1)} time</b> ${esc(U.selObs.toLowerCase())} this term · last: ${esc(punLabel(prev[0].pun))} (${esc(fmtWhen(prev[0].ts))})</span></div>`
      : `<div class="hint ok"><span><b>1st time</b> this term</span></div>`;
  }
  const dis = U.selObs ? '' : 'disabled';
  return `<header class="hdr"><div class="row" style="justify-content:flex-start">
    <button class="back" data-act="back" aria-label="Back">${ICON.back}</button>
    <span class="grow"><span style="font-size:18px;font-weight:700">${esc(x.name)}</span><span style="font-size:12px;color:#D9E3DA">GC ${x.gc} · ${esc(x.pl)} · ${esc(className(curClass()))}</span></span>
    <button class="hbtn" data-act="openProfile" data-arg="${x.gc}">History</button></div></header>
    <main class="body">
    <span class="label">1 · Observation</span><div class="grid2">${obsHtml}</div>${hint}
    <span class="label" style="padding-top:4px">2 · Punishment — tap to save</span>
    <div class="grid2">${PUN.map((p) => `<button class="pun ${p.cls}" data-act="savePun" data-arg="${p.id}" ${dis}>${p.label}</button>`).join('')}
    <button class="pun later" data-act="savePun" data-arg="" ${dis}>Decide later</button></div>
    ${U.showNote ? `<label class="field"><span>Note (optional — kept for sitrep)</span><textarea id="note" placeholder="e.g. Arrived 12 min late, no reason given">${esc(U.note)}</textarea></label>`
      : '<button class="btn dashed" data-act="showNote">+ Add note (optional)</button>'}
    </main>`;
}

function viewProfile() {
  const x = S.cadets[U.profile];
  const te = termEntries(x.gc);
  const all = S.entries.filter((e) => e.gc === x.gc).sort((a, b) => b.ts - a.ts);
  const byType = S.settings.obs.map((o) => [o, te.filter((e) => e.obs === o).length]).filter(([, n]) => n);
  const max = Math.max(1, ...byType.map(([, n]) => n));
  const pend = all.filter((e) => e.status === 'pending').length;
  const pl = comdFor('Pl Comd', x.pl), tc = comdFor('Term Comd', x.course);
  const comdRow = (role, m) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #EFEDE5">
    <span class="grow"><span class="small" style="font-weight:600">${role}</span><span style="font-size:14px;font-weight:600">${m ? esc([m.rank, m.name].filter(Boolean).join(' ')) + (m.unit ? ' · ' + esc(m.unit) : '') : 'Not saved'}</span></span>
    ${m && m.phone ? `<a class="btn sm" style="display:flex;align-items:center;text-decoration:none" href="tel:${esc(m.phone)}">Call</a><a class="btn sm" style="display:flex;align-items:center;text-decoration:none" href="${waLink(m.phone, waText(x))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>`;
  return `<header class="hdr"><div class="row"><button class="back" data-act="back" aria-label="Back">${ICON.back}</button><button class="hbtn" data-act="editCadet" data-arg="${x.gc}">Edit cadet</button></div>
    <div style="display:flex;gap:14px;align-items:center"><span class="av" style="width:56px;height:56px;border-radius:28px;font-size:19px">${esc(initials(x.name))}</span>
    <span class="grow"><span style="font-size:20px;font-weight:700;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${esc(x.name)}${x.tag ? `<span class="tag">${esc(x.tag)}</span>` : ''}</span>
    <span style="font-size:13px;color:#D9E3DA">GC ${x.gc} · ${esc(x.appt || 'GC')} · ${esc(x.pl)} · ${esc(x.course)} Gp ${esc(x.gp)}</span></span></div></header>
    <main class="body">
    <div class="grid3 tiles"><div class="t"><b style="color:${te.length >= 4 ? '#A1271B' : '#1C1C1A'}">${te.length}</b><span>This term</span></div>
    <div class="t"><b>${all.length}</b><span>All time</span></div><div class="t"><b style="color:${pend ? '#7A4300' : '#1C1C1A'}">${pend}</b><span>Pending</span></div></div>
    ${byType.length ? `<span class="label">By type · this term</span><div class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:9px">${byType.map(([o, n]) =>
      `<div class="bar"><span class="n">${esc(o)}</span><span class="track"><span class="fill" style="display:block;width:${Math.round(n / max * 100)}%"></span></span><span class="c">${n}</span></div>`).join('')}</div>` : ''}
    <span class="label">Comds</span><div class="card">${comdRow('PL COMD · ' + esc(x.pl), pl)}${comdRow('TERM COMD · ' + esc(x.course), tc)}</div>
    <div class="between"><span class="label">History</span><span class="small">Tap to edit</span></div>
    <div class="list">${all.length ? all.map((e) => histHtml(e, e.ts < termTs())).join('') : '<div class="empty"><span>No observations recorded.</span></div>'}</div>
    </main>`;
}

function histHtml(e, old) {
  const n = S.entries.filter((y) => y.gc === e.gc && y.obs === e.obs && y.ts >= termTs() && y.ts <= e.ts).length;
  const cls = S.classes.find((c) => c.id === e.classId);
  return `<button class="hist" data-act="editEntry" data-arg="${e.id}" style="${old ? 'opacity:.6' : ''}">
    <span class="between" style="width:100%"><span style="font-size:14px;font-weight:600">${esc(e.obs)}${old ? '' : ` <span style="font-weight:500;color:#5B5B55">· ${ord(n)}</span>`}</span><span class="small">${esc(fmtWhen(e.ts))}</span></span>
    <span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="pill p-grey">${esc(punLabel(e.pun))}</span>
    <span class="pill ${e.status === 'pending' ? 'p-amb' : 'p-ok'}">${e.status === 'pending' ? 'Pending' : 'Done'}</span>
    ${cls ? `<span class="small">${esc(cls.subject)}</span>` : ''}${old ? '<span class="small">previous term</span>' : ''}</span>
    ${e.note ? `<span class="small" style="color:#3F3F3A">“${esc(e.note)}”</span>` : ''}</button>`;
}

function waText(x) {
  const te = termEntries(x.gc);
  const parts = S.settings.obs.map((o) => [o, te.filter((e) => e.obs === o).length]).filter(([, n]) => n).map(([o, n]) => `${n}× ${o}`);
  return `AoA Sir. GC ${x.gc} ${x.name} (${x.pl}), ${x.course}: ${te.length} observation${te.length === 1 ? '' : 's'} this term — ${parts.join(', ')}. Request your attention.`;
}
function waLink(phone, text) {
  let p = String(phone).replace(/\D/g, '');
  if (p.startsWith('0')) p = '92' + p.slice(1);
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

function classListRows(c) {
  const q = (U.cq || '').trim().toLowerCase();
  const rows = Object.values(S.cadets).filter((x) => x.course === c.course && x.gp === c.gp &&
    (!q || String(x.gc).includes(q) || x.name.toLowerCase().includes(q) || x.pl.toLowerCase().includes(q)))
    .sort((a, b) => (b.active - a.active) || a.pl.localeCompare(b.pl) || a.gc - b.gc);
  return rows.length ? rows.map((x) => `<button class="crow" style="min-height:54px;${x.active ? '' : 'opacity:.55'}" data-act="editCadet" data-arg="${x.gc}">
    <span class="grow"><span class="nm">${esc(x.name)}${x.tag ? `<span class="tag">${esc(x.tag)}</span>` : ''}${x.appt ? `<span class="tag" style="background:#EFEDE5;color:#3F3F3A">${esc(x.appt)}</span>` : ''}${x.active ? '' : '<span class="pill p-grey">Inactive</span>'}</span>
    <span class="sub">GC ${x.gc} · ${esc(x.pl)}</span></span></button>`).join('')
    : `<div class="empty"><span>${q ? 'No cadet matches.' : 'No cadets yet.'}</span></div>`;
}

function viewClass() {
  const c = S.classes.find((y) => y.id === U.classId);
  if (!c) { U.view = 'settings'; return viewSettings(); }
  const act = Object.values(S.cadets).filter((x) => x.active && x.course === c.course && x.gp === c.gp);
  const pls = {}; act.forEach((x) => { pls[x.pl] = (pls[x.pl] || 0) + 1; });
  const shared = S.classes.filter((y) => y.id !== c.id && y.course === c.course && y.gp === c.gp);
  const isCur = c.id === S.settings.currentClass;
  return `<header class="hdr"><div class="row" style="justify-content:flex-start"><button class="back" data-act="back" aria-label="Back">${ICON.back}</button>
    <span class="grow"><span class="kicker">Class</span><span style="font-size:19px;font-weight:700">${esc(className(c))}</span></span></div></header>
    <main class="body">
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <b style="font-size:15px">${act.length} cadet${act.length === 1 ? '' : 's'}${Object.keys(pls).length ? ' · ' + Object.entries(pls).sort().map(([k, v]) => `${esc(k)} (${v})`).join(', ') : ''}</b>
      <div class="grid2"><button class="btn pri sm" data-act="pickFile" data-arg="${c.id}">Import list</button><button class="btn sm" data-act="newCadet">+ Add cadet</button></div>
      <span class="small">Excel/CSV with columns GC No, Name, Pl (Appt optional). If the file also has Course and Gp, only rows for ${esc(c.course)} Gp ${esc(c.gp)} are taken. Importing again updates the list — nothing recorded is lost.</span>
      ${shared.length ? `<span class="small">Same cadets as: ${shared.map((y) => esc(className(y))).join(', ')}</span>` : ''}
    </div>
    ${isCur ? '' : `<button class="btn" data-act="useClass" data-arg="${c.id}">Use this class for recording</button>`}
    <span class="label">Cadets</span>
    <label class="search">${ICON.search}<input id="ccq" type="text" placeholder="GC No, name or Pl" value="${esc(U.cq || '')}"></label>
    <div id="clsList" class="list">${classListRows(c)}</div>
    <button class="btn danger" data-act="delClass" data-arg="${c.id}">Remove this class</button>
    </main>`;
}

function viewPending() {
  const list = S.entries.filter((e) => e.status === 'pending').sort((a, b) => b.ts - a.ts);
  const card = (e) => {
    const x = S.cadets[e.gc] || { name: 'Unknown', gc: e.gc, pl: '', course: '' };
    const cls = S.classes.find((c) => c.id === e.classId);
    const m = e.pun === 'plcomd' ? comdFor('Pl Comd', x.pl) : null;
    return `<div class="card" style="padding:14px;display:flex;flex-direction:column;gap:8px">
      <div class="between"><b style="font-size:15px">${esc(x.name)} <span style="font-weight:500;color:#5B5B55">· GC ${x.gc}</span></b><span class="small">${esc(fmtWhen(e.ts))}</span></div>
      <span class="sub" style="color:#3F3F3A">${esc(e.obs)}${cls ? ' · ' + esc(className(cls)) : ''}</span>
      ${e.note ? `<span class="small">“${esc(e.note)}”</span>` : ''}
      ${e.pun === 'plcomd' ? `<div style="background:#F5F4EF;border-radius:10px;padding:10px 12px" class="small"><b style="color:#1C1C1A">Pl Comd ${esc(x.pl)}:</b> ${m ? esc([m.rank, m.name, m.unit, m.phone].filter(Boolean).join(' · ')) : 'not saved yet (import Comds sheet)'}</div>` : ''}
      <div style="display:flex;gap:8px">
      ${!e.pun ? `<button class="btn sm pri" style="flex:1" data-act="editEntry" data-arg="${e.id}">Decide punishment</button>` : ''}
      ${m && m.phone ? `<a class="btn sm" style="flex:1;display:flex;align-items:center;justify-content:center;text-decoration:none" href="tel:${esc(m.phone)}">Call</a>
        <a class="btn sm" style="flex:1;display:flex;align-items:center;justify-content:center;text-decoration:none" href="${waLink(m.phone, waText(x))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      ${e.pun ? `<button class="btn sm pri" style="flex:1" data-act="markDone" data-arg="${e.id}">${e.pun === 'sitrep' ? 'Mark sent' : 'Done'}</button>` : ''}</div></div>`;
  };
  const groups = [['plcomd', 'Talk to Pl Comd'], ['sitrep', 'Sitrep to initiate'], [null, 'Punishment not decided']];
  const body = list.length ? groups.map(([k, l]) => {
    const g = list.filter((e) => (e.pun || null) === k);
    return g.length ? `<span class="label">${l}</span>${g.map(card).join('')}` : '';
  }).join('') : '<div class="empty"><b>All clear</b><span>No pending actions.</span></div>';
  return `<header class="hdr"><span class="kicker">All classes · ${list.length} to do</span><h1>Pending actions</h1></header><main class="body">${body}</main>`;
}

/* ---------- reports ---------- */
function repRange() {
  const r = U.rep, now = new Date();
  if (r.period === 'week') { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
  if (r.period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (r.period === 'all') return 0;
  return termTs();
}
function repEntries() {
  const r = U.rep, from = repRange();
  return S.entries.filter((e) => e.ts >= from && (r.cls === 'all' || e.classId === r.cls));
}
const PERIODS = [['week', 'Week'], ['month', 'Month'], ['term', 'Term'], ['all', 'All']];

function viewReports() {
  const r = U.rep || (U.rep = { cls: S.settings.currentClass || 'all', period: 'term' });
  if (r.cls !== 'all' && !S.classes.some((c) => c.id === r.cls)) r.cls = 'all';
  const es = repEntries();
  const byObs = {}; es.forEach((e) => { byObs[e.obs] = (byObs[e.obs] || 0) + 1; });
  const obsRows = Object.entries(byObs).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...obsRows.map(([, n]) => n));
  const byPun = {}; es.forEach((e) => { byPun[e.pun || ''] = (byPun[e.pun || ''] || 0) + 1; });
  const byCadet = {}; es.forEach((e) => { byCadet[e.gc] = (byCadet[e.gc] || 0) + 1; });
  const top = Object.entries(byCadet).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const pend = es.filter((e) => e.status === 'pending').length;
  return `<header class="hdr"><div class="row"><h1>Reports</h1></div>
    <select id="repCls" aria-label="Class" style="background:#183026;color:#fff;border:0;font-weight:600">
      <option value="all" ${r.cls === 'all' ? 'selected' : ''}>All classes</option>
      ${S.classes.map((c) => `<option value="${c.id}" ${r.cls === c.id ? 'selected' : ''}>${esc(className(c))}</option>`).join('')}</select>
    <div class="seg">${PERIODS.map(([k, l]) => `<button class="${r.period === k ? 'on' : ''}" data-act="repPeriod" data-arg="${k}">${l}</button>`).join('')}</div></header>
    <main class="body">
    <div class="grid3 tiles"><div class="t"><b>${es.length}</b><span>Observations</span></div><div class="t"><b>${Object.keys(byCadet).length}</b><span>Cadets</span></div>
    <div class="t"><b style="color:${pend ? '#7A4300' : '#1C1C1A'}">${pend}</b><span>Pending</span></div></div>
    ${es.length ? `<span class="label">By observation</span>
    <div class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:9px">${obsRows.map(([o, n]) =>
      `<div class="bar"><span class="n">${esc(o)}</span><span class="track"><span class="fill" style="display:block;width:${Math.round(n / max * 100)}%"></span></span><span class="c">${n}</span></div>`).join('')}</div>
    <span class="label">Punishments</span>
    <div class="grid2">${PUN.map((pn) => `<div class="card" style="padding:10px 12px;display:flex;justify-content:space-between;align-items:center"><span class="small" style="color:#1C1C1A">${pn.label}</span><b>${byPun[pn.id] || 0}</b></div>`).join('')}
    <div class="card" style="padding:10px 12px;display:flex;justify-content:space-between;align-items:center;grid-column:1/-1"><span class="small" style="color:#1C1C1A">Not decided yet</span><b>${byPun[''] || 0}</b></div></div>
    <span class="label">Most observations</span>
    <div class="list">${top.map(([gc, n], i) => { const x = S.cadets[gc] || { name: '?', pl: '' };
      return `<button class="crow" style="min-height:56px" data-act="openProfile" data-arg="${gc}"><span style="width:20px;font-weight:700;color:#5B5B55">${i + 1}</span>
      <span class="grow"><span class="nm">${esc(x.name)}</span><span class="sub">GC ${gc} · ${esc(x.pl)}</span></span><span class="pill ${n >= 4 ? 'p-red' : n >= 2 ? 'p-amb' : 'p-grey'}">${n} obs</span></button>`; }).join('')}</div>`
    : '<div class="empty"><span>No observations in this period.</span></div>'}
    <div class="grid2"><button class="btn pri" data-act="exportXlsx" data-arg="save" ${es.length ? '' : 'disabled'}>Export to Excel</button>
    <button class="btn" data-act="exportXlsx" data-arg="share" ${es.length && canShareFiles() ? '' : 'disabled'}>Share Excel</button></div>
    </main>`;
}

function buildXlsx() {
  const r = U.rep, es = repEntries().sort((a, b) => a.ts - b.ts);
  const cls = (id) => S.classes.find((c) => c.id === id);
  const rows = es.map((e) => {
    const x = S.cadets[e.gc] || {}, d = new Date(e.ts), c = cls(e.classId);
    return { Date: d.toLocaleDateString('en-GB'), Time: d.toTimeString().slice(0, 5), 'GC No': e.gc, Name: x.name || '', Pl: x.pl || '', Course: x.course || '', Gp: x.gp || '',
      Class: c ? className(c) : '', Observation: e.obs, Punishment: punLabel(e.pun), Status: e.status === 'pending' ? 'Pending' : 'Done', Note: e.note || '' };
  });
  const obsList = [...new Set(es.map((e) => e.obs))];
  const per = {};
  es.forEach((e) => { const k = e.gc; per[k] = per[k] || { total: 0 }; per[k].total++; per[k][e.obs] = (per[k][e.obs] || 0) + 1; });
  const summary = Object.entries(per).sort((a, b) => b[1].total - a[1].total).map(([gc, v]) => {
    const x = S.cadets[gc] || {};
    const row = { 'GC No': +gc, Name: x.name || '', Pl: x.pl || '', Course: x.course || '', Gp: x.gp || '', Total: v.total };
    obsList.forEach((o) => { row[o] = v[o] || 0; });
    return row;
  });
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(rows); ws1['!cols'] = [10, 6, 8, 28, 8, 9, 4, 24, 28, 18, 8, 30].map((w) => ({ wch: w }));
  const ws2 = XLSX.utils.json_to_sheet(summary); ws2['!cols'] = [{ wch: 8 }, { wch: 28 }, { wch: 8 }, { wch: 9 }, { wch: 4 }, { wch: 6 }].concat(obsList.map(() => ({ wch: 14 })));
  XLSX.utils.book_append_sheet(wb, ws1, 'Observations');
  XLSX.utils.book_append_sheet(wb, ws2, 'By cadet');
  const c = r.cls === 'all' ? null : cls(r.cls);
  const tag = (c ? `${c.subject}_${c.course}_Gp${c.gp}` : 'AllClasses').replace(/[^A-Za-z0-9]+/g, '_');
  const name = `CadetObs_${tag}_${r.period}_${today()}.xlsx`;
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([data], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ---------- files out ---------- */
function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] })); } catch (e) { return false; }
}
function downloadFile(file) {
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function shareFile(file) {
  try { await navigator.share({ files: [file], title: file.name }); return true; }
  catch (e) { if (e.name !== 'AbortError') alert('Could not share: ' + e.message); return false; }
}

/* ---------- backup ---------- */
function backupFile() {
  const data = JSON.stringify({ app: 'cadet-obs', v: 1, exported: Date.now(), state: S });
  return new File([data], `CadetObs_backup_${today()}.json`, { type: 'application/json' });
}
const daysSince = (ts) => ts ? Math.floor((Date.now() - ts) / 86400000) : null;
function backupBanner() {
  if (!S.entries.length) return '';
  const d = daysSince(S.settings.lastBackup);
  if (d !== null && d < 7) return '';
  return `<div class="warn" style="display:flex;align-items:center;gap:10px"><span style="flex:1">${d === null ? 'No backup yet.' : `Last backup ${d} days ago.`} Save a backup so your records are safe if the phone is lost or reset.</span>
    <button class="btn sm" style="flex:none" data-act="backup" data-arg="save">Back up</button></div>`;
}

function viewSettings() {
  const act = Object.values(S.cadets).filter((x) => x.active).length;
  const lb = S.settings.lastBackup, d = daysSince(lb);
  return `<header class="hdr"><span class="kicker">Set up once</span><h1>Settings</h1></header><main class="body">
    <div class="between"><span class="label">My classes</span><button class="chip sm" style="border:0;color:#23402F" data-act="openClasses">+ Add class</button></div>
    <div class="card" style="overflow:hidden">
      ${S.classes.length ? S.classes.map((c) => { const n = classCadets(c).length;
        return `<button class="crow" style="border:0;border-bottom:1px solid #EFEDE5;border-radius:0" data-act="openClass" data-arg="${c.id}">
        <span class="grow"><span class="nm">${esc(className(c))}${c.id === S.settings.currentClass ? '<span class="pill p-ok">Recording</span>' : ''}</span>
        <span class="sub">${n} cadet${n === 1 ? '' : 's'} · tap to import / add / edit</span></span><span aria-hidden="true">›</span></button>`; }).join('')
      : '<div style="padding:14px" class="small">No classes yet. Tap “+ Add class”.</div>'}</div>
    <button class="btn sm" data-act="openCadetList">Search all cadets (${act} active)</button>

    <span class="label">Term</span>
    <label class="card field" style="padding:14px"><span>Term start date — “1st / 2nd time” counts start from here</span>
      <input type="date" id="termStart" value="${esc(S.settings.termStart)}"></label>

    <div class="between"><span class="label">Comds directory</span><button class="chip sm" style="border:0;color:#23402F" data-act="editComd" data-arg="new">+ Add</button></div>
    <div class="card" style="overflow:hidden">
      ${S.comds.length ? S.comds.slice().sort((a, b) => a.role.localeCompare(b.role) || a.key.localeCompare(b.key)).map((m) => `<button class="crow" style="border:0;border-bottom:1px solid #EFEDE5;border-radius:0" data-act="editComd" data-arg="${S.comds.indexOf(m)}">
        <span style="width:84px;font-size:11px;font-weight:700;color:${m.role === 'Term Comd' ? '#1F3A5F' : '#23402F'}">${m.role === 'Term Comd' ? 'TERM' : 'PL'} · ${esc(m.key)}</span>
        <span class="grow"><span style="font-size:14px;font-weight:600">${esc([m.rank, m.name].filter(Boolean).join(' '))}</span><span class="small">${esc([m.unit, m.phone].filter(Boolean).join(' · ') || 'No phone saved')}</span></span></button>`).join('')
      : '<div style="padding:14px" class="small">None yet. Tap “+ Add”, or include a Comds sheet in a class import file.</div>'}</div>

    <span class="label">Backup &amp; restore</span>
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <span style="font-size:14px;font-weight:600;color:${d === null || d >= 7 ? '#A1271B' : '#23402F'}">${lb ? `Last backup: ${esc(fmtWhen(lb))}` : 'No backup yet'}</span>
      <div class="grid2"><button class="btn sm pri" data-act="backup" data-arg="save">Save backup file</button>
      <button class="btn sm" data-act="backup" data-arg="share" ${canShareFiles() ? '' : 'disabled'}>Share backup</button></div>
      <button class="btn sm" data-act="pickRestore">Restore from backup…</button>
      <span class="small">The backup is one .json file with everything (cadets, classes, records, Comds). Keep it in Google Drive or send it to yourself. Restoring replaces all data on this phone.</span>
    </div>

    <span class="label">Security</span>
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <span style="font-size:14px;font-weight:600">PIN lock: ${S.settings.pinHash ? 'On' : 'Off'}</span>
      ${S.settings.pinHash ? '<div class="grid2"><button class="btn sm" data-act="pinSetup">Change PIN</button><button class="btn sm" data-act="pinOff">Turn off</button></div>'
        : '<button class="btn sm pri" data-act="pinSetup">Set a 4-digit PIN</button>'}
      <span class="small">Asked when the app opens and after 1 minute in the background. If you forget the PIN, the only way in is to erase all data — keep a backup.</span>
    </div>

    <button class="btn danger" data-act="eraseAll">Erase all data on this phone</button>
    <span class="small" style="text-align:center;padding-top:8px">Cadet Obs v${APP_VERSION} · data stored only on this phone</span>
    </main>`;
}

/* ---------- PIN ---------- */
async function hashPin(pin) {
  const salt = S.settings.pinSalt || (S.settings.pinSalt = uid());
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function lockHtml() {
  const L = U.lock;
  const dots = [0, 1, 2, 3].map((i) => `<span style="width:16px;height:16px;border-radius:8px;border:2px solid #fff;background:${i < L.pin.length ? '#fff' : 'transparent'}"></span>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  const title = L.mode === 'unlock' ? 'Enter PIN' : L.mode === 'set1' ? 'Choose a 4-digit PIN' : 'Enter the PIN again';
  return `<div style="position:fixed;inset:0;background:#23402F;color:#fff;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:24px">
    <img src="icons/icon-192.png" alt="" width="64" height="64" style="border-radius:16px">
    <b style="font-size:20px">${title}</b>
    <div style="display:flex;gap:16px">${dots}</div>
    <span style="min-height:20px;color:#F7C873;font-size:14px">${esc(L.msg || '')}</span>
    <div style="display:grid;grid-template-columns:repeat(3,76px);gap:14px">${keys.map((k) => k === '' ? '<span></span>'
      : `<button data-act="pinKey" data-arg="${k}" aria-label="${k === '⌫' ? 'Delete' : k}" style="height:76px;border-radius:38px;border:0;background:${k === '⌫' ? 'transparent' : '#183026'};color:#fff;font-size:26px;font-weight:600">${k}</button>`).join('')}</div>
    ${L.mode === 'unlock' ? '<button data-act="forgotPin" style="border:0;background:transparent;color:#D9E3DA;font-size:14px;height:44px">Forgot PIN?</button>'
      : '<button data-act="pinCancel" style="border:0;background:transparent;color:#D9E3DA;font-size:14px;height:44px">Cancel</button>'}
  </div>`;
}

/* ---------- sheets ---------- */
function sheetHtml() {
  const s = U.sheet;
  let inner = '';
  if (s.type === 'classes') inner = classesSheet();
  else if (s.type === 'edit') inner = editSheet(s.id);
  else if (s.type === 'import') inner = importSheet();
  else if (s.type === 'cadet') inner = cadetSheet();
  else if (s.type === 'cadetList') inner = cadetListSheet();
  else if (s.type === 'comd') inner = comdSheet();
  return `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${inner}</div></div>`;
}

function classHint(f) {
  const found = Object.values(S.cadets).filter((x) => x.active && x.course === f.course && x.gp === f.gp);
  const pls = [...new Set(found.map((x) => x.pl))].join(', ');
  return f.course ? (found.length ? `${found.length} cadets already in the app for ${esc(f.course)} Gp ${esc(f.gp)} (${esc(pls)}) — they will be in this class.`
    : 'Next you will import or add the cadets of this class.') : 'Type the course, e.g. 158 L/C.';
}

function classesSheet() {
  const act = Object.values(S.cadets).filter((x) => x.active);
  const courses = [...new Set(act.map((x) => x.course))].sort();
  const f = U.sheet.form || (U.sheet.form = { subject: '', course: courses[0] || '', gp: 'A' });
  const rows = S.classes.map((c) => {
    const on = c.id === S.settings.currentClass, n = classCadets(c).length;
    const pl = [...new Set(classCadets(c).map((x) => x.pl))].join(', ');
    return `<div style="display:flex;gap:6px;align-items:center"><button class="crow ${on ? 'sel' : ''}" data-act="pickClass" data-arg="${c.id}">
      <span class="grow"><span class="nm" style="font-size:16px">${esc(className(c))}</span><span class="sub">${esc(pl || 'no cadets')} · ${n} cadets</span></span>${on ? '✓' : ''}</button>
      <button class="btn sm" style="flex:none" data-act="openClass" data-arg="${c.id}">Cadets</button></div>`;
  }).join('');
  return `<h2>My classes</h2>${rows || '<span class="small">No classes yet.</span>'}
    <div style="border-top:1px solid #E6E4DC;padding-top:14px;display:flex;flex-direction:column;gap:10px">
    <span class="label">Add a class</span>
    <label class="field"><span>Subject</span><input type="text" id="fSubject" placeholder="e.g. ICT or GIS" value="${esc(f.subject)}"></label>
    <div class="grid2"><label class="field"><span>Course</span><input type="text" id="fCourse" list="courseList" placeholder="e.g. 158 L/C" value="${esc(f.course)}"></label>
    <label class="field"><span>Group</span><select id="fGp">${['A', 'B'].map((g) => `<option value="${g}" ${g === f.gp ? 'selected' : ''}>Gp ${g}</option>`).join('')}</select></label></div>
    <datalist id="courseList">${courses.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <span class="small" id="fHint">${classHint(f)}</span>
    <button class="btn pri" data-act="addClass">Add class</button>
    </div><button class="btn" data-act="closeSheet">Close</button>`;
}

function editSheet(id) {
  const e = S.entries.find((y) => y.id === id);
  if (!e) return '<span>Entry not found.</span><button class="btn" data-act="closeSheet">Close</button>';
  const x = S.cadets[e.gc];
  return `<h2>Edit entry</h2><span class="small">${esc(x ? x.name : e.gc)} · GC ${e.gc} · ${esc(fmtWhen(e.ts))}</span>
    <label class="field"><span>Observation</span><select id="eObs">${S.settings.obs.concat(S.settings.obs.includes(e.obs) ? [] : [e.obs]).map((o) => `<option ${o === e.obs ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
    <label class="field"><span>Punishment</span><select id="ePun">${PUN.map((p) => `<option value="${p.id}" ${p.id === e.pun ? 'selected' : ''}>${p.label}</option>`).join('')}<option value="" ${!e.pun ? 'selected' : ''}>Not decided</option></select></label>
    <label class="field"><span>Status</span><select id="eStatus"><option value="done" ${e.status === 'done' ? 'selected' : ''}>Done</option><option value="pending" ${e.status === 'pending' ? 'selected' : ''}>Pending</option></select></label>
    <label class="field"><span>Note</span><textarea id="eNote">${esc(e.note || '')}</textarea></label>
    <button class="btn pri" data-act="saveEdit" data-arg="${e.id}">Save changes</button>
    <div class="grid2"><button class="btn danger" data-act="delEntry" data-arg="${e.id}">Delete</button><button class="btn" data-act="closeSheet">Cancel</button></div>`;
}

function cadetSheet() {
  const s = U.sheet, x = s.gc ? S.cadets[s.gc] : null, c = S.classes.find((y) => y.id === s.classId) || curClass();
  const d = x || s.prefill || { gc: '', name: '', tag: '', pl: '', appt: '', course: c ? c.course : '', gp: c ? c.gp : 'A', active: true };
  const all = Object.values(S.cadets);
  const pls = [...new Set(all.filter((y) => !d.course || y.course === d.course).map((y) => y.pl))].sort();
  const courses = [...new Set(all.map((y) => y.course).concat(S.classes.map((y) => y.course)))].sort();
  return `<h2>${x ? 'Edit cadet' : 'Add cadet'}</h2>
    <label class="field"><span>GC No</span><input type="text" id="cGc" inputmode="numeric" value="${esc(d.gc)}" ${x ? 'readonly style="background:#F1F0EA"' : ''}></label>
    <label class="field"><span>Name — add (PN), (PAF) etc. at the end if needed</span><input type="text" id="cName" value="${esc(d.name ? d.name + (d.tag ? ` (${d.tag})` : '') : '')}" autocapitalize="words"></label>
    <div class="grid2"><label class="field"><span>Pl</span><input type="text" id="cPl" list="plList" value="${esc(d.pl)}" autocapitalize="characters"></label>
    <label class="field"><span>Appt (blank = GC)</span><input type="text" id="cAppt" value="${esc(d.appt)}" placeholder="e.g. CSUO" autocapitalize="characters"></label></div>
    ${x ? `<div class="grid2"><label class="field"><span>Course</span><input type="text" id="cCourse" list="cCourseList" value="${esc(d.course)}"></label>
    <label class="field"><span>Group</span><select id="cGp">${['A', 'B'].map((g) => `<option value="${g}" ${g === d.gp ? 'selected' : ''}>Gp ${g}</option>`).join('')}</select></label></div>
    <span class="small">Changing course or group moves the cadet to that class.</span>`
    : `<div class="hint ok"><span>Adding to <b>${esc(className(c))}</b></span></div>`}
    <datalist id="plList">${pls.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
    <datalist id="cCourseList">${courses.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
    ${x ? `<label class="check"><input type="checkbox" id="cActive" ${x.active ? 'checked' : ''}><span>Active (untick if relegated / withdrawn — history is kept)</span></label>` : ''}
    <button class="btn pri" data-act="saveCadet">${x ? 'Save changes' : 'Save'}</button>
    ${x ? '' : '<button class="btn" data-act="saveCadet" data-arg="more">Save &amp; add another</button>'}
    <button class="btn" data-act="closeSheet">Cancel</button>`;
}

function cadetListRows() {
  const q = (U.sheet.q || '').trim().toLowerCase();
  const rows = Object.values(S.cadets).filter((x) => !q || String(x.gc).includes(q) || x.name.toLowerCase().includes(q) || x.course.toLowerCase().includes(q) || x.pl.toLowerCase().includes(q))
    .sort((a, b) => a.course.localeCompare(b.course) || a.gp.localeCompare(b.gp) || a.pl.localeCompare(b.pl) || a.gc - b.gc);
  return rows.length ? rows.map((x) => `<button class="crow" style="min-height:54px;${x.active ? '' : 'opacity:.55'}" data-act="editCadet" data-arg="${x.gc}">
    <span class="grow"><span class="nm">${esc(x.name)}${x.tag ? `<span class="tag">${esc(x.tag)}</span>` : ''}${x.active ? '' : '<span class="pill p-grey">Inactive</span>'}</span>
    <span class="sub">GC ${x.gc} · ${esc(x.pl)} · ${esc(x.course)} Gp ${esc(x.gp)}${x.appt ? ' · ' + esc(x.appt) : ''}</span></span></button>`).join('')
    : '<div class="empty"><span>No cadets.</span></div>';
}
function cadetListSheet() {
  return `<h2>All cadets</h2><span class="small">To add cadets, open a class and use Import or + Add cadet.</span>
    <label class="search">${ICON.search}<input id="cq" type="text" placeholder="GC No, name, Pl or course" value="${esc(U.sheet.q || '')}"></label>
    <div id="clist" class="list">${cadetListRows()}</div><button class="btn" data-act="closeSheet">Close</button>`;
}

function comdSheet() {
  const i = U.sheet.idx, m = i === 'new' ? { role: 'Pl Comd', key: '', rank: '', name: '', unit: '', phone: '' } : S.comds[+i];
  const pls = [...new Set(Object.values(S.cadets).map((x) => x.pl))].sort();
  const courses = [...new Set(Object.values(S.cadets).map((x) => x.course).concat(S.classes.map((x) => x.course)))].sort();
  return `<h2>${i === 'new' ? 'Add Comd' : 'Edit Comd'}</h2>
    <div class="grid2"><label class="field"><span>Role</span><select id="mRole"><option ${m.role === 'Pl Comd' ? 'selected' : ''}>Pl Comd</option><option ${m.role === 'Term Comd' ? 'selected' : ''}>Term Comd</option></select></label>
    <label class="field"><span>Pl (Pl Comd) / Course (Term Comd)</span><input type="text" id="mKey" list="mKeyList" value="${esc(m.key)}"></label></div>
    <datalist id="mKeyList">${pls.concat(courses).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
    <div class="grid2"><label class="field"><span>Rank</span><input type="text" id="mRank" value="${esc(m.rank)}" placeholder="e.g. Capt"></label>
    <label class="field"><span>Unit</span><input type="text" id="mUnit" value="${esc(m.unit)}"></label></div>
    <label class="field"><span>Name</span><input type="text" id="mName" value="${esc(m.name)}"></label>
    <label class="field"><span>Phone</span><input type="tel" id="mPhone" value="${esc(m.phone)}" placeholder="03XX-XXXXXXX"></label>
    <button class="btn pri" data-act="saveComd">Save</button>
    <div class="grid2">${i === 'new' ? '' : '<button class="btn danger" data-act="delComd">Delete</button>'}<button class="btn" data-act="closeSheet" style="${i === 'new' ? 'grid-column:1/-1' : ''}">Cancel</button></div>`;
}

function importSheet() {
  const p = U.preview, cls = S.classes.find((c) => c.id === p.classId);
  return `<h2>Import into class</h2>
    <span class="small"><b style="color:#1C1C1A;font-size:14px">${esc(className(cls))}</b><br>${esc(p.file)} · ${p.rows.length} cadet${p.rows.length === 1 ? '' : 's'} for this class${p.comds.length ? ` · ${p.comds.length} Comds` : ''}</span>
    ${p.errors.map((m) => `<div class="err">${esc(m)}</div>`).join('')}
    ${p.warnings.map((m) => `<div class="warn">${esc(m)}</div>`).join('')}
    ${p.rows.length ? `<table class="prev"><thead><tr><th>New</th><th>Updated</th><th>Same</th><th>Not in file</th></tr></thead>
    <tbody><tr><td><b>${p.add}</b></td><td>${p.upd}</td><td>${p.same}</td><td>${p.missing.length}</td></tr></tbody></table>
    ${p.moved ? `<span class="small">${p.moved} of the updated cadets move into this class from another course or group.</span>` : ''}
    ${p.missing.length ? `<label class="check"><input type="checkbox" id="markInactive"><span>Mark the ${p.missing.length} cadet${p.missing.length > 1 ? 's' : ''} of this class “not in file” as inactive (relegated / withdrawn). Their history is kept.</span></label>` : ''}` : ''}
    <div class="grid2"><button class="btn pri" data-act="applyImport" ${p.rows.length || p.comds.length ? '' : 'disabled'}>Import</button><button class="btn" data-act="closeSheet">Cancel</button></div>`;
}

/* ---------- import ---------- */
const HEAD = {
  gc: ['gc no', 'gc no.', 'gcno', 'gc number', 'gc', 'gc #'],
  name: ['name', 'gc name', 'cadet name'],
  pl: ['pl', 'platoon', 'pl.'],
  appt: ['appt', 'appointment', 'appt.'],
  course: ['course', 'crs', 'course no'],
  gp: ['gp', 'group', 'gp.']
};
const norm = (s) => String(s == null ? '' : s).trim();
function findCols(row) {
  const cols = {};
  row.forEach((h, i) => {
    const k = norm(h).toLowerCase().replace(/\s+/g, ' ');
    for (const [f, names] of Object.entries(HEAD)) if (names.includes(k) && cols[f] == null) cols[f] = i;
  });
  return cols;
}
function parseName(raw) {
  let n = norm(raw).replace(/\s+/g, ' ');
  let tag = '';
  const m = n.match(/\(([^)]+)\)\s*$/);
  if (m) { tag = m[1].trim().toUpperCase(); n = n.slice(0, m.index).trim(); }
  return { name: n === n.toUpperCase() ? titleCase(n) : n, tag };
}
function normGp(g) { return norm(g).toUpperCase().replace(/^GP\.?\s*|^GROUP\s*/, ''); }
function normCourse(c) { return norm(c).replace(/\s+/g, ' ').replace(/l\/c/i, 'L/C'); }

// Builds an import preview for ONE class. Course/Gp columns are optional:
// rows without them go into this class; rows for another course/group are skipped.
function buildPreview(wb, file, cls) {
  const errors = [], warnings = [], rows = [], comds = [];
  const cname = wb.SheetNames.find((n) => /cadet/i.test(n)) || wb.SheetNames.find((n) => !/how|comd/i.test(n)) || wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[cname], { header: 1, defval: '', raw: true });
  const hi = aoa.findIndex((r) => { const c = findCols(r); return c.gc != null && c.name != null; });
  if (hi < 0) errors.push(`Could not find the heading row in sheet “${cname}”. Headings needed: GC No, Name, Pl (Appt, Course, Gp optional).`);
  else {
    const cols = findCols(aoa[hi]);
    if (cols.pl == null) errors.push('Column “Pl” is missing.');
    if (cols.course != null) { // Excel drag-fill guard: many different courses with 1–2 cadets each
      const cc = {};
      aoa.slice(hi + 1).forEach((r) => { const v = normCourse(r[cols.course]); if (v) cc[v] = (cc[v] || 0) + 1; });
      const ks = Object.keys(cc);
      if (ks.length >= 5 && ks.filter((k) => cc[k] <= 2).length / ks.length > 0.7)
        errors.push(`The Course column has ${ks.length} different values with only 1–2 cadets each (${ks.slice(0, 3).join(', ')}…). This looks like Excel drag-fill, so nothing was imported. Fix the Course column, or delete the Course and Gp columns so every row goes into this class.`);
    }
    if (!errors.length) {
      const seen = new Set(), bad = [], dup = [], other = {};
      aoa.slice(hi + 1).forEach((r, i) => {
        if (r.every((v) => norm(v) === '')) return;
        const gc = parseInt(String(r[cols.gc]).replace(/\D/g, ''), 10);
        const { name, tag } = parseName(r[cols.name]);
        const pl = norm(r[cols.pl]).toUpperCase();
        const rc = cols.course != null ? normCourse(r[cols.course]) : '';
        const rg = cols.gp != null ? normGp(r[cols.gp]) : '';
        let appt = cols.appt != null ? norm(r[cols.appt]).toUpperCase() : '';
        if (appt === 'GC') appt = '';
        if (!gc || !name || !pl) { bad.push(hi + i + 2); return; }
        if ((rc && rc !== cls.course) || (rg && rg !== cls.gp)) { const k = `${rc || cls.course} Gp ${rg || cls.gp}`; other[k] = (other[k] || 0) + 1; return; }
        if (seen.has(gc)) { dup.push(gc); return; }
        seen.add(gc);
        rows.push({ gc, name, tag, pl, appt, course: cls.course, gp: cls.gp });
      });
      if (bad.length) warnings.push(`${bad.length} row(s) skipped — missing GC No, Name or Pl (Excel row ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? '…' : ''}).`);
      if (dup.length) warnings.push(`Duplicate GC No in file, only first kept: ${dup.slice(0, 8).join(', ')}.`);
      const ok = Object.entries(other);
      if (ok.length) {
        const n = ok.reduce((a, [, v]) => a + v, 0);
        warnings.push(`${n} row(s) belong to other classes and were left out: ${ok.slice(0, 4).map(([k, v]) => `${k} (${v})`).join(', ')}${ok.length > 4 ? ` and ${ok.length - 4} more` : ''}. Import them from those classes.`);
        if (!rows.length) warnings.push(`No rows match ${cls.course} Gp ${cls.gp}. Check the Course/Gp columns, or delete them so every row goes into this class.`);
      }
    }
  }
  const mname = wb.SheetNames.find((n) => /comd/i.test(n));
  if (mname) {
    const ma = XLSX.utils.sheet_to_json(wb.Sheets[mname], { header: 1, defval: '' });
    const h = (ma[0] || []).map((v) => norm(v).toLowerCase());
    const ix = (k) => h.findIndex((v) => v.startsWith(k));
    const iR = ix('role'), iK = ix('pl'), iRk = ix('rank'), iN = ix('name'), iU = ix('unit'), iP = ix('phone');
    ma.slice(1).forEach((r) => {
      const role = /term/i.test(r[iR]) ? 'Term Comd' : /pl/i.test(r[iR]) ? 'Pl Comd' : '';
      const name = norm(r[iN]);
      if (!role || !norm(r[iK]) || !name || /^\[.*\]$/.test(name)) return;
      const phone = norm(r[iP]);
      comds.push({ role, key: role === 'Term Comd' ? normCourse(r[iK]) : norm(r[iK]).toUpperCase(), rank: norm(r[iRk]), name, unit: /^\[.*\]$/.test(norm(r[iU])) ? '' : norm(r[iU]), phone: /X/i.test(phone) ? '' : phone });
    });
  }
  let add = 0, upd = 0, same = 0, moved = 0;
  rows.forEach((x) => {
    const old = S.cadets[x.gc];
    if (!old) add++;
    else if (['name', 'tag', 'pl', 'appt', 'course', 'gp'].some((k) => old[k] !== x[k]) || !old.active) { upd++; if (old.course !== x.course || old.gp !== x.gp) moved++; }
    else same++;
  });
  const inFile = new Set(rows.map((x) => x.gc));
  const missing = rows.length ? Object.values(S.cadets).filter((c) => c.active && c.course === cls.course && c.gp === cls.gp && !inFile.has(c.gc)).map((c) => c.gc) : [];
  if (!rows.length && !errors.length && !warnings.length) errors.push('No cadet rows found.');
  return { file, classId: cls.id, rows, comds, errors, warnings, add, upd, same, moved, missing };
}

async function handleFile(f) {
  const cls = S.classes.find((c) => c.id === (U.importClassId || (U.view === 'class' ? U.classId : null)));
  if (!cls) return;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    U.preview = buildPreview(wb, f.name, cls);
  } catch (err) {
    U.preview = { file: f.name, classId: cls.id, rows: [], comds: [], errors: ['Could not read this file: ' + err.message], warnings: [], add: 0, upd: 0, same: 0, moved: 0, missing: [] };
  }
  U.sheet = { type: 'import' }; pushNav(); render();
}

async function applyImport() {
  const p = U.preview;
  const inactive = $('#markInactive') && $('#markInactive').checked;
  p.rows.forEach((x) => { S.cadets[x.gc] = Object.assign({}, S.cadets[x.gc] || {}, x, { active: true }); });
  if (inactive) p.missing.forEach((gc) => { if (S.cadets[gc]) S.cadets[gc].active = false; });
  p.comds.forEach((m) => {
    const i = S.comds.findIndex((y) => y.role === m.role && y.key === m.key);
    if (i >= 0) S.comds[i] = m; else S.comds.push(m);
  });
  S.lastImport = { file: p.file, ts: Date.now() };
  await save();
  U.sheet = null; U.preview = null; silentBack();
  showToast(`Imported ${p.rows.length} cadets`, p.comds.length ? `${p.comds.length} Comds saved` : 'Class list updated', null);
}

/* ---------- actions ---------- */
let toastTimer = null;
function showToast(msg, sub, undo) {
  U.toast = { msg, sub, undo };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { U.toast = null; render(); }, undo ? 7000 : 3500);
}

function addEntry(gc, obs, pun, note) {
  const p = PUN.find((y) => y.id === pun);
  const e = { id: uid(), ts: Date.now(), gc, classId: S.settings.currentClass, obs, pun: pun || null, status: !pun || p.pending ? 'pending' : 'done', note: note || '' };
  S.entries.push(e);
  return e;
}

function pushNav() { history.pushState({ d: Date.now() }, ''); }
// Close a pushed screen ourselves (state already updated) without goBack() undoing more.
function silentBack() { U._skipPop = true; history.back(); }
function goBack() {
  if (U._skipPop) { U._skipPop = false; render(); return; }
  if (U.sheet) { U.sheet = null; U.preview = null; }
  else if (U.view === 'profile') { U.view = U.profileFrom || 'record'; U.profile = null; }
  else if (U.view === 'class') { U.view = U.classFrom || 'record'; }
  else if (U.cadet) { U.cadet = null; U.selObs = null; U.note = ''; U.showNote = false; }
  render();
}

const A = {
  nav(k) { U.view = k; U.cadet = null; U.profile = null; U.selObs = null; render(); window.scrollTo(0, 0); },
  mode(m) { U.mode = m; render(); },
  pl(p) { U.pl = p; render(); },
  openCadet(gc) { U.cadet = +gc; U.selObs = null; U.note = ''; U.showNote = false; pushNav(); render(); window.scrollTo(0, 0); },
  selObs(i) { U.selObs = S.settings.obs[+i]; render(); },
  showNote() { U.showNote = true; render(); const n = $('#note'); if (n) n.focus(); },
  async savePun(pun) {
    if (!U.selObs) return;
    const x = S.cadets[U.cadet];
    const n = termEntries(x.gc).filter((e) => e.obs === U.selObs).length + 1;
    const e = addEntry(x.gc, U.selObs, pun, U.note.trim());
    await save();
    showToast(`${U.selObs} · ${punLabel(pun || null)}`, `GC ${x.gc} ${x.name} · ${ord(n)} time`, [e.id]);
    U.cadet = null; U.selObs = null; U.note = ''; U.showNote = false;
    silentBack(); render();
  },
  async undo() {
    const ids = new Set(U.toast.undo);
    S.entries = S.entries.filter((e) => !ids.has(e.id));
    await save();
    U.toast = { msg: 'Undone', sub: `${ids.size} entr${ids.size > 1 ? 'ies' : 'y'} removed`, undo: null };
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { U.toast = null; render(); }, 2500);
    render();
  },
  batchObs(i) { U.batchObs = S.settings.obs[+i]; render(); },
  batchToggle(gc) { gc = +gc; U.batchSel.has(gc) ? U.batchSel.delete(gc) : U.batchSel.add(gc); render(); },
  batchClear() { U.batchSel.clear(); render(); },
  async batchSave() {
    if (!U.batchObs || !U.batchSel.size) return;
    const ids = [...U.batchSel].map((gc) => addEntry(gc, U.batchObs, U.batchPun, '').id);
    await save();
    showToast(`${U.batchObs} · ${punLabel(U.batchPun || null)}`, `Saved for ${ids.length} cadet${ids.length > 1 ? 's' : ''}`, ids);
    U.batchSel.clear();
    render();
  },
  openProfile(gc) { U.profileFrom = U.view === 'profile' ? U.profileFrom : U.view; U.profile = +gc; U.view = 'profile'; U.cadet = null; pushNav(); render(); window.scrollTo(0, 0); },
  editEntry(id) { U.sheet = { type: 'edit', id }; pushNav(); render(); },
  async saveEdit(id) {
    const e = S.entries.find((y) => y.id === id);
    e.obs = $('#eObs').value; e.pun = $('#ePun').value || null; e.status = $('#eStatus').value; e.note = $('#eNote').value.trim();
    if (!e.pun) e.status = 'pending';
    await save(); U.sheet = null; silentBack(); showToast('Entry updated', e.obs, null); render();
  },
  async delEntry(id) {
    if (!confirm('Delete this entry permanently?')) return;
    S.entries = S.entries.filter((e) => e.id !== id);
    await save(); U.sheet = null; silentBack(); showToast('Entry deleted', '', null); render();
  },
  async markDone(id) {
    const e = S.entries.find((y) => y.id === id); e.status = 'done';
    await save(); showToast('Marked done', punLabel(e.pun), null); render();
  },
  openClasses() { U.sheet = { type: 'classes' }; pushNav(); render(); },
  openClass(id) {
    if (U.sheet) U.sheet = null; else pushNav(); // from the classes sheet: reuse its history entry
    if (U.view !== 'class') U.classFrom = U.view;
    U.view = 'class'; U.classId = id; U.cq = ''; render(); window.scrollTo(0, 0);
  },
  async useClass(id) { S.settings.currentClass = id; await save(); showToast('Recording in', className(S.classes.find((c) => c.id === id)), null); render(); },
  async pickClass(id) { S.settings.currentClass = id; U.pl = 'All'; U.batchSel.clear(); await save(); U.sheet = null; silentBack(); render(); },
  async addClass() {
    const f = U.sheet.form;
    f.subject = $('#fSubject').value.trim(); f.course = normCourse($('#fCourse').value); f.gp = $('#fGp').value;
    if (!f.subject) { alert('Enter the subject, e.g. ICT'); return; }
    if (!f.course) { alert('Enter the course, e.g. 158 L/C'); return; }
    if (S.classes.some((c) => c.subject.toLowerCase() === f.subject.toLowerCase() && c.course === f.course && c.gp === f.gp)) { alert('This class already exists.'); return; }
    const c = { id: uid(), subject: f.subject, course: f.course, gp: f.gp };
    S.classes.push(c); S.settings.currentClass = c.id;
    await save();
    // the classes sheet's history entry is reused for the class screen
    U.sheet = null; U.classFrom = U.view === 'class' ? 'settings' : U.view; U.view = 'class'; U.classId = c.id; U.cq = '';
    showToast('Class added', className(c), null); render(); window.scrollTo(0, 0);
  },
  async delClass(id) {
    const c = S.classes.find((y) => y.id === id);
    if (!confirm(`Remove class “${className(c)}”? Recorded entries are kept.`)) return;
    S.classes = S.classes.filter((y) => y.id !== id);
    if (S.settings.currentClass === id) S.settings.currentClass = S.classes[0] ? S.classes[0].id : null;
    await save(); history.back(); showToast('Class removed', 'Cadets and entries are kept', null);
  },
  newCadet() {
    U.sheet = { type: 'cadet', gc: null, classId: U.view === 'class' ? U.classId : S.settings.currentClass };
    pushNav();
    render(); const g = $('#cGc'); if (g) g.focus();
  },
  editCadet(gc) {
    const sub = U.sheet && U.sheet.type === 'cadetList';
    U.sheet = { type: 'cadet', gc: +gc, back: sub ? { type: 'cadetList', q: U.sheet.q } : null };
    if (!sub) pushNav();
    render();
  },
  async saveCadet(more) {
    const old = U.sheet.gc ? S.cadets[U.sheet.gc] : null;
    const gc = old ? old.gc : parseInt($('#cGc').value.replace(/\D/g, ''), 10);
    const { name, tag } = parseName($('#cName').value);
    const cls = S.classes.find((y) => y.id === U.sheet.classId) || curClass();
    const pl = norm($('#cPl').value).toUpperCase();
    const course = old ? normCourse($('#cCourse').value) : cls.course, gp = old ? $('#cGp').value : cls.gp;
    let appt = norm($('#cAppt').value).toUpperCase(); if (appt === 'GC') appt = '';
    if (!gc) { alert('Enter the GC No (numbers only).'); return; }
    if (!name || !pl || !course) { alert('Name, Pl and Course are required.'); return; }
    if (!old && S.cadets[gc]) { alert(`GC ${gc} already exists: ${S.cadets[gc].name} (${S.cadets[gc].course}). Edit that cadet instead.`); return; }
    const active = old ? $('#cActive').checked : true;
    S.cadets[gc] = Object.assign({}, old || {}, { gc, name, tag, pl, appt, course, gp, active });
    await save();
    if (more === 'more') {
      U.sheet = { type: 'cadet', gc: null, classId: U.sheet.classId, back: U.sheet.back, prefill: { gc: '', name: '', tag: '', pl, appt: '', course, gp } };
      showToast('Cadet saved', `GC ${gc} ${name}`, null); render(); $('#cGc').focus(); return;
    }
    showToast(old ? 'Cadet updated' : 'Cadet added', `GC ${gc} ${name}`, null);
    if (U.sheet.back) { U.sheet = U.sheet.back; render(); } else { U.sheet = null; silentBack(); }
    if (U.view === 'class') render();
  },
  openCadetList() { U.sheet = { type: 'cadetList', q: '' }; pushNav(); render(); },
  editComd(i) { U.sheet = { type: 'comd', idx: i }; pushNav(); render(); },
  async saveComd() {
    const role = $('#mRole').value, rawKey = norm($('#mKey').value);
    const m = { role, key: role === 'Term Comd' ? normCourse(rawKey) : rawKey.toUpperCase(), rank: norm($('#mRank').value), name: norm($('#mName').value), unit: norm($('#mUnit').value), phone: norm($('#mPhone').value) };
    if (!m.key || !m.name) { alert('Pl/Course and Name are required.'); return; }
    const i = U.sheet.idx;
    const dup = S.comds.findIndex((y) => y.role === m.role && y.key === m.key);
    if (i === 'new') { if (dup >= 0) S.comds[dup] = m; else S.comds.push(m); } else S.comds[+i] = m;
    await save(); U.sheet = null; silentBack(); showToast('Comd saved', `${m.role} ${m.key}`, null);
  },
  async delComd() {
    if (!confirm('Delete this Comd?')) return;
    S.comds.splice(+U.sheet.idx, 1); await save(); U.sheet = null; silentBack();
  },
  repPeriod(k) { U.rep.period = k; render(); },
  exportXlsx(how) {
    const f = buildXlsx();
    if (how === 'share') shareFile(f); else { downloadFile(f); showToast('Excel saved', f.name + ' (Downloads)', null); render(); }
  },
  async backup(how) {
    const f = backupFile();
    const ok = how === 'share' ? await shareFile(f) : (downloadFile(f), true);
    if (ok) { S.settings.lastBackup = Date.now(); await save(); showToast('Backup saved', how === 'share' ? f.name : f.name + ' (Downloads)', null); render(); }
  },
  pickRestore() { $('#restoreInput').value = ''; $('#restoreInput').click(); },
  pinSetup() { U.lock = { mode: 'set1', pin: '', first: '', msg: '' }; render(); },
  async pinOff() { if (!confirm('Turn off PIN lock?')) return; delete S.settings.pinHash; await save(); showToast('PIN lock off', '', null); render(); },
  pinCancel() { U.lock = null; render(); },
  async pinKey(k) {
    const L = U.lock;
    if (k === '⌫') { L.pin = L.pin.slice(0, -1); L.msg = ''; render(); return; }
    if (L.pin.length >= 4) return;
    L.pin += k; render();
    if (L.pin.length < 4) return;
    if (L.mode === 'unlock') {
      if (await hashPin(L.pin) === S.settings.pinHash) { U.lock = null; render(); }
      else { L.pin = ''; L.msg = 'Wrong PIN'; render(); }
    } else if (L.mode === 'set1') { L.first = L.pin; L.pin = ''; L.mode = 'set2'; L.msg = ''; render(); }
    else if (L.pin === L.first) { S.settings.pinHash = await hashPin(L.pin); await save(); U.lock = null; showToast('PIN set', 'Asked when the app opens', null); render(); }
    else { L.mode = 'set1'; L.pin = ''; L.first = ''; L.msg = 'PINs did not match — try again'; render(); }
  },
  async forgotPin() {
    if (prompt('Without the PIN, the only option is to ERASE ALL DATA on this phone (you can restore a backup afterwards).\n\nType ERASE to continue.') !== 'ERASE') return;
    S = freshState(); await save(); U.lock = null; U.view = 'record'; render();
  },
  async eraseAll() {
    if (prompt('This deletes ALL cadets, classes, records and Comds on this phone.\nMake a backup first if you may need them.\n\nType ERASE to continue.') !== 'ERASE') return;
    S = freshState(); await save(); U.view = 'record'; U.cadet = null; showToast('All data erased', '', null); render();
  },
  pickFile(id) { U.importClassId = id || U.classId; $('#fileInput').value = ''; $('#fileInput').click(); },
  applyImport() { applyImport(); },
  closeSheet() { if (U.sheet && U.sheet.back) { U.sheet = U.sheet.back; render(); } else history.back(); },
  scrim(_, el, ev) { if (ev.target === el) history.back(); },
  back() { history.back(); }
};

/* ---------- events ---------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.act];
  if (fn) fn(el.dataset.arg, el, ev);
});
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'q') { U.q = t.value; const l = $('#list'); if (l) l.innerHTML = listHtml(); }
  else if (t.id === 'note') U.note = t.value;
  else if (t.id === 'fSubject' && U.sheet && U.sheet.form) U.sheet.form.subject = t.value;
  else if (t.id === 'fCourse' && U.sheet && U.sheet.form) U.sheet.form.course = t.value;
  else if (t.id === 'cq') { U.sheet.q = t.value; $('#clist').innerHTML = cadetListRows(); }
  else if (t.id === 'ccq') { U.cq = t.value; $('#clsList').innerHTML = classListRows(S.classes.find((c) => c.id === U.classId)); }
});
document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.id === 'batchPun') U.batchPun = t.value;
  else if (t.id === 'fCourse' || t.id === 'fGp') {
    const f = U.sheet.form;
    f.subject = $('#fSubject').value; f.course = normCourse($('#fCourse').value); f.gp = $('#fGp').value;
    $('#fHint').innerHTML = classHint(f); // update hint only: a full redraw would swallow the tap on Add class
  } else if (t.id === 'termStart' && t.value) { S.settings.termStart = t.value; await save(); showToast('Term start saved', t.value, null); render(); }
  else if (t.id === 'fileInput' && t.files[0]) handleFile(t.files[0]);
  else if (t.id === 'repCls') { U.rep.cls = t.value; render(); }
  else if (t.id === 'restoreInput' && t.files[0]) restoreFrom(t.files[0]);
});
window.addEventListener('popstate', goBack);

async function restoreFrom(f) {
  let b;
  try { b = JSON.parse(await f.text()); } catch (e) { alert('This is not a valid backup file.'); return; }
  if (!b || b.app !== 'cadet-obs' || !b.state || !b.state.cadets) { alert('This is not a Cadet Obs backup file.'); return; }
  const st = b.state;
  const msg = `Restore backup from ${new Date(b.exported).toLocaleString()}?\n\n${Object.keys(st.cadets).length} cadets · ${st.classes.length} classes · ${st.entries.length} records\n\nThis REPLACES all data currently on this phone.`;
  if (!confirm(msg)) return;
  S = Object.assign(freshState(), st);
  S.settings = Object.assign(freshState().settings, st.settings || {});
  await save(); U.view = 'record'; U.cadet = null; U.rep = null;
  showToast('Backup restored', `${st.entries.length} records`, null); render();
}

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (S && S.settings.pinHash && !U.lock && hiddenAt && Date.now() - hiddenAt > 60000) { U.lock = { mode: 'unlock', pin: '', msg: '' }; render(); }
});

/* ---------- boot ---------- */
(async function boot() {
  try {
    await DB.open();
    S = (await DB.get('state')) || freshState();
    S.settings = Object.assign(freshState().settings, S.settings);
    if (S.settings.pinHash) U.lock = { mode: 'unlock', pin: '', msg: '' };
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (err) {
    $('#app').innerHTML = `<div class="boot">Storage is not available: ${esc(err.message)}</div>`;
    return;
  }
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
