'use strict';
/* Cadet Observations — Stage 1
   All data stays on this device (IndexedDB). No network calls except loading the app itself. */

const APP_VERSION = '0.1.0';
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
  let html = '';
  if (U.view === 'record') html = U.cadet ? viewCadet() : viewRecord();
  else if (U.view === 'profile') html = viewProfile();
  else if (U.view === 'pending') html = viewPending();
  else if (U.view === 'reports') html = viewReports();
  else if (U.view === 'settings') html = viewSettings();
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
  if (!Object.keys(S.cadets).length) {
    body = `<div class="empty"><b>No cadets yet</b><span>Import your cadet list (Excel or CSV) to begin.</span>
      <button class="btn pri" data-act="pickFile">Import cadet list</button></div>`;
  } else if (!c) {
    body = `<div class="empty"><b>Add your first class</b><span>A class is Subject + Course + Gp, e.g. ICT · 158 L/C · Gp A.</span>
      <button class="btn pri" data-act="openClasses">Add class</button></div>`;
  } else {
    const cadets = classCadets(c);
    const pls = ['All', ...new Set(cadets.map((x) => x.pl))];
    if (!pls.includes(U.pl)) U.pl = 'All';
    body = `<label class="search">${ICON.search}<input id="q" type="text" inputmode="search" placeholder="Last digits of GC No, or name" aria-label="Search cadet" value="${esc(U.q)}"></label>
      ${U.mode === 'batch' ? batchObsHtml() : ''}
      <div class="chips">${pls.map((p) => `<button class="chip ${U.pl === p ? 'on' : ''}" data-act="pl" data-arg="${esc(p)}">${esc(p)}</button>`).join('')}
      <span style="flex:1;text-align:right" class="small">${cadets.length} cadets</span></div>
      <div id="list" class="list">${listHtml()}</div>`;
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
  if (!rows.length) return '<div class="empty"><span>No cadet matches.</span></div>';
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
  return `<header class="hdr"><div class="row" style="justify-content:flex-start"><button class="back" data-act="back" aria-label="Back">${ICON.back}</button></div>
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

function viewReports() {
  return `<header class="hdr"><h1>Reports</h1></header><main class="body"><div class="empty"><b>Coming in Stage 3</b>
    <span>Week / month / term summaries, most observations, punishments given and Export to Excel.</span></div></main>`;
}

function viewSettings() {
  const cadets = Object.values(S.cadets);
  const courses = {};
  cadets.forEach((x) => { const k = x.course; courses[k] = courses[k] || { a: 0, i: 0, gps: new Set() }; x.active ? courses[k].a++ : courses[k].i++; courses[k].gps.add(x.gp); });
  return `<header class="hdr"><span class="kicker">Set up once</span><h1>Settings</h1></header><main class="body">
    <span class="label">Cadet list</span>
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <b style="font-size:15px">${cadets.filter((x) => x.active).length} active cadets · ${Object.keys(courses).length} course${Object.keys(courses).length === 1 ? '' : 's'}</b>
      ${Object.entries(courses).sort().map(([k, v]) => `<span class="small">${esc(k)} — Gp ${[...v.gps].sort().join(', ')} · ${v.a} active${v.i ? ` · ${v.i} inactive` : ''}</span>`).join('')}
      ${S.lastImport ? `<span class="small">Last import: ${esc(S.lastImport.file)} · ${esc(fmtWhen(S.lastImport.ts))}</span>` : ''}
      <button class="btn pri" data-act="pickFile">Import Excel / CSV</button>
      <span class="small">Import one course or several at a time. Cadets are matched by GC No — nothing recorded is lost.</span>
    </div>
    <span class="label">Classes</span>
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:8px">
      <span style="font-size:15px;font-weight:600">${S.classes.length} class${S.classes.length === 1 ? '' : 'es'}</span>
      <button class="btn" data-act="openClasses">Manage classes</button></div>
    <span class="label">Term</span>
    <label class="card field" style="padding:14px"><span>Term start date — “1st / 2nd time” counts start from here</span>
      <input type="date" id="termStart" value="${esc(S.settings.termStart)}"></label>
    <span class="label">Comds directory</span>
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:6px">
      ${S.comds.length ? S.comds.map((m) => `<span class="small"><b style="color:#1C1C1A">${esc(m.role)} ${esc(m.key)}:</b> ${esc([m.rank, m.name, m.unit, m.phone].filter(Boolean).join(' · '))}</span>`).join('') : '<span class="small">None yet. Fill the Comds sheet in the template and import it.</span>'}
      <span class="small">Adding/editing a single Comd or cadet in the app: Stage 2.</span></div>
    <span class="small" style="text-align:center;padding-top:8px">Cadet Obs v${APP_VERSION} · data stored only on this phone</span>
    </main>`;
}

/* ---------- sheets ---------- */
function sheetHtml() {
  const s = U.sheet;
  let inner = '';
  if (s.type === 'classes') inner = classesSheet();
  else if (s.type === 'edit') inner = editSheet(s.id);
  else if (s.type === 'import') inner = importSheet();
  return `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${inner}</div></div>`;
}

function classesSheet() {
  const act = Object.values(S.cadets).filter((x) => x.active);
  const courses = [...new Set(act.map((x) => x.course))].sort();
  const f = U.sheet.form || (U.sheet.form = { subject: '', course: courses[0] || '', gp: '' });
  if (!courses.includes(f.course)) f.course = courses[0] || '';
  const gps = [...new Set(act.filter((x) => x.course === f.course).map((x) => x.gp))].sort();
  if (!gps.includes(f.gp)) f.gp = gps[0] || '';
  const found = act.filter((x) => x.course === f.course && x.gp === f.gp);
  const pls = [...new Set(found.map((x) => x.pl))].join(', ');
  const rows = S.classes.map((c) => {
    const on = c.id === S.settings.currentClass, n = classCadets(c).length;
    const pl = [...new Set(classCadets(c).map((x) => x.pl))].join(', ');
    return `<div style="display:flex;gap:6px;align-items:center"><button class="crow ${on ? 'sel' : ''}" data-act="pickClass" data-arg="${c.id}">
      <span class="grow"><span class="nm" style="font-size:16px">${esc(className(c))}</span><span class="sub">${esc(pl || 'no cadets')} · ${n} cadets</span></span>${on ? '✓' : ''}</button>
      <button class="x" data-act="delClass" data-arg="${c.id}" aria-label="Remove class ${esc(className(c))}">×</button></div>`;
  }).join('');
  return `<h2>My classes</h2>${rows || '<span class="small">No classes yet.</span>'}
    <div style="border-top:1px solid #E6E4DC;padding-top:14px;display:flex;flex-direction:column;gap:10px">
    <span class="label">Add a class</span>
    ${courses.length ? `<label class="field"><span>Subject</span><input type="text" id="fSubject" placeholder="e.g. ICT or GIS" value="${esc(f.subject)}"></label>
    <div class="grid2"><label class="field"><span>Course</span><select id="fCourse">${courses.map((c) => `<option ${c === f.course ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    <label class="field"><span>Group</span><select id="fGp">${gps.map((g) => `<option value="${esc(g)}" ${g === f.gp ? 'selected' : ''}>Gp ${esc(g)}</option>`).join('')}</select></label></div>
    <span class="small">${found.length} cadets found${pls ? ' · ' + esc(pls) : ''}</span>
    <button class="btn pri" data-act="addClass">Add class</button>` : '<span class="small">Import your cadet list first.</span><button class="btn pri" data-act="pickFile">Import cadet list</button>'}
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

function importSheet() {
  const p = U.preview;
  const courseRows = Object.entries(p.byCourse).sort().map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${v.add}</td><td>${v.upd}</td><td>${v.same}</td><td>${v.missing.length}</td></tr>`).join('');
  const missingTotal = Object.values(p.byCourse).reduce((a, v) => a + v.missing.length, 0);
  return `<h2>Import preview</h2><span class="small">${esc(p.file)} · ${p.rows.length} cadet rows${p.comds.length ? ` · ${p.comds.length} Comds` : ''}</span>
    ${p.errors.map((m) => `<div class="err">${esc(m)}</div>`).join('')}
    ${p.warnings.map((m) => `<div class="warn">${esc(m)}</div>`).join('')}
    ${p.rows.length ? `<table class="prev"><thead><tr><th>Course</th><th>New</th><th>Updated</th><th>Same</th><th>Not in file</th></tr></thead><tbody>${courseRows}</tbody></table>
    <span class="small">Other courses already in the app are not touched.</span>
    ${missingTotal ? `<label class="check"><input type="checkbox" id="markInactive"><span>Mark the ${missingTotal} cadet${missingTotal > 1 ? 's' : ''} “not in file” as inactive (relegated / withdrawn). Their history is kept.</span></label>` : ''}` : ''}
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
function normGp(g) { const s = norm(g).toUpperCase().replace(/^GP\.?\s*|^GROUP\s*/, ''); return s; }
function normCourse(c) { return norm(c).replace(/\s+/g, ' ').replace(/l\/c/i, 'L/C'); }

function buildPreview(wb, file) {
  const errors = [], warnings = [], rows = [], comds = [];
  const cname = wb.SheetNames.find((n) => /cadet/i.test(n)) || wb.SheetNames.find((n) => !/how|comd/i.test(n)) || wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[cname], { header: 1, defval: '', raw: true });
  let hi = aoa.findIndex((r) => { const c = findCols(r); return c.gc != null && c.name != null; });
  if (hi < 0) errors.push(`Could not find the heading row in sheet “${cname}”. Headings needed: GC No, Name, Pl, Course, Gp (Appt optional).`);
  else {
    const cols = findCols(aoa[hi]);
    ['pl', 'course', 'gp'].forEach((f) => { if (cols[f] == null) errors.push(`Column “${f === 'gp' ? 'Gp' : f === 'pl' ? 'Pl' : 'Course'}” is missing.`); });
    if (!errors.length) {
      const seen = new Set(); const bad = []; const dup = [];
      aoa.slice(hi + 1).forEach((r, i) => {
        const line = hi + i + 2;
        if (r.every((v) => norm(v) === '')) return;
        const gc = parseInt(String(r[cols.gc]).replace(/\D/g, ''), 10);
        const { name, tag } = parseName(r[cols.name]);
        const pl = norm(r[cols.pl]), course = normCourse(r[cols.course]), gp = normGp(r[cols.gp]);
        let appt = cols.appt != null ? norm(r[cols.appt]).toUpperCase() : '';
        if (appt === 'GC') appt = '';
        if (!gc || !name || !pl || !course || !gp) { bad.push(line); return; }
        if (seen.has(gc)) { dup.push(gc); return; }
        seen.add(gc);
        rows.push({ gc, name, tag, pl, appt, course, gp });
      });
      if (bad.length) warnings.push(`${bad.length} row(s) skipped — missing GC No, Name, Pl, Course or Gp (Excel row ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? '…' : ''}).`);
      if (dup.length) warnings.push(`Duplicate GC No in file, only first kept: ${dup.slice(0, 8).join(', ')}.`);
      const cc = {}; rows.forEach((x) => { cc[x.course] = (cc[x.course] || 0) + 1; });
      const ks = Object.keys(cc);
      if (ks.length >= 5 && ks.filter((k) => cc[k] <= 2).length / ks.length > 0.7)
        warnings.push(`${ks.length} different courses with only 1–2 cadets each (e.g. ${ks.slice(0, 3).join(', ')}). This looks like Excel drag-fill. Please check the Course column before importing.`);
      const gpBad = [...new Set(rows.filter((x) => !['A', 'B'].includes(x.gp)).map((x) => x.gp))];
      if (gpBad.length) warnings.push(`Unusual Gp value(s): ${gpBad.join(', ')}. Expected A or B.`);
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
      comds.push({ role, key: role === 'Term Comd' ? normCourse(r[iK]) : norm(r[iK]), rank: norm(r[iRk]), name, unit: /^\[.*\]$/.test(norm(r[iU])) ? '' : norm(r[iU]), phone: /X/i.test(phone) ? '' : phone });
    });
  }
  const byCourse = {};
  rows.forEach((x) => {
    const b = byCourse[x.course] = byCourse[x.course] || { add: 0, upd: 0, same: 0, missing: [] };
    const old = S.cadets[x.gc];
    if (!old) b.add++;
    else if (['name', 'tag', 'pl', 'appt', 'course', 'gp'].some((k) => old[k] !== x[k]) || !old.active) b.upd++;
    else b.same++;
  });
  const inFile = new Set(rows.map((x) => x.gc));
  Object.values(S.cadets).forEach((c) => { if (c.active && byCourse[c.course] && !inFile.has(c.gc)) byCourse[c.course].missing.push(c.gc); });
  if (!rows.length && !errors.length) errors.push('No cadet rows found.');
  return { file, rows, comds, errors, warnings, byCourse };
}

async function handleFile(f) {
  try {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    U.preview = buildPreview(wb, f.name);
    U.sheet = { type: 'import' }; pushNav();
  } catch (err) {
    U.preview = { file: f.name, rows: [], comds: [], errors: ['Could not read this file: ' + err.message], warnings: [], byCourse: {} };
    U.sheet = { type: 'import' }; pushNav();
  }
  render();
}

async function applyImport() {
  const p = U.preview;
  const inactive = $('#markInactive') && $('#markInactive').checked;
  p.rows.forEach((x) => { S.cadets[x.gc] = Object.assign({}, S.cadets[x.gc] || {}, x, { active: true }); });
  if (inactive) Object.values(p.byCourse).forEach((v) => v.missing.forEach((gc) => { if (S.cadets[gc]) S.cadets[gc].active = false; }));
  p.comds.forEach((m) => {
    const i = S.comds.findIndex((y) => y.role === m.role && y.key === m.key);
    if (i >= 0) S.comds[i] = m; else S.comds.push(m);
  });
  S.lastImport = { file: p.file, ts: Date.now() };
  await save();
  U.sheet = null; U.preview = null; silentBack();
  showToast(`Imported ${p.rows.length} cadets`, p.comds.length ? `${p.comds.length} Comds saved` : 'Cadet list updated', null);
  render();
  if (!S.classes.length) setTimeout(() => { U.sheet = { type: 'classes' }; pushNav(); render(); }, 150);
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
  else if (U.view === 'profile') { U.view = 'record'; U.profile = null; }
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
  openProfile(gc) { U.profile = +gc; U.view = 'profile'; U.cadet = null; pushNav(); render(); window.scrollTo(0, 0); },
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
  async pickClass(id) { S.settings.currentClass = id; U.pl = 'All'; U.batchSel.clear(); await save(); U.sheet = null; silentBack(); render(); },
  async addClass() {
    const f = U.sheet.form;
    f.subject = $('#fSubject').value.trim();
    if (!f.subject) { alert('Enter the subject, e.g. ICT'); return; }
    if (S.classes.some((c) => c.subject.toLowerCase() === f.subject.toLowerCase() && c.course === f.course && c.gp === f.gp)) { alert('This class already exists.'); return; }
    const c = { id: uid(), subject: f.subject, course: f.course, gp: f.gp };
    S.classes.push(c); S.settings.currentClass = c.id;
    await save(); U.sheet = null; silentBack(); showToast('Class added', className(c), null); render();
  },
  async delClass(id) {
    const c = S.classes.find((y) => y.id === id);
    if (!confirm(`Remove class “${className(c)}”? Recorded entries are kept.`)) return;
    S.classes = S.classes.filter((y) => y.id !== id);
    if (S.settings.currentClass === id) S.settings.currentClass = S.classes[0] ? S.classes[0].id : null;
    await save(); render();
  },
  pickFile() { $('#fileInput').value = ''; $('#fileInput').click(); },
  applyImport() { applyImport(); },
  closeSheet() { history.back(); },
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
});
document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.id === 'batchPun') U.batchPun = t.value;
  else if (t.id === 'fCourse' || t.id === 'fGp') {
    const f = U.sheet.form; f.subject = $('#fSubject').value;
    if (t.id === 'fCourse') { f.course = t.value; f.gp = ''; } else f.gp = t.value;
    render();
  } else if (t.id === 'termStart' && t.value) { S.settings.termStart = t.value; await save(); showToast('Term start saved', t.value, null); render(); }
  else if (t.id === 'fileInput' && t.files[0]) handleFile(t.files[0]);
});
window.addEventListener('popstate', goBack);

/* ---------- boot ---------- */
(async function boot() {
  try {
    await DB.open();
    S = (await DB.get('state')) || freshState();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (err) {
    $('#app').innerHTML = `<div class="boot">Storage is not available: ${esc(err.message)}</div>`;
    return;
  }
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
