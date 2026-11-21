'use strict';
/* GC's Obsn - PMA (cadet observations)
   All data stays on this device (IndexedDB). No network calls except loading the app itself. */

const APP_VERSION = '0.5.1';
const APP_NAME = "GC's Obsn - PMA";
const FILE_TAG = 'GCs_Obsn_PMA';
const CREDIT = 'Developed by Maj Ahmad Mujtaba, AEC (Cptr Sc)';
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
/* Terms: Summer (about 15 May – 15 Oct) and Winter (about 15 Nov – 15 Apr).
   The name comes from the start date: May–Oct = Summer YYYY; Nov–Dec = Winter YYYY;
   Jan–Apr = Winter of the previous year (the winter that began in November). */
function seasonOf(d) {
  const [y, m] = d.split('-').map(Number);
  if (m >= 5 && m <= 10) return { name: `Summer ${y}`, summer: true, year: y };
  return m >= 11 ? { name: `Winter ${y}`, summer: false, year: y } : { name: `Winter ${y - 1}`, summer: false, year: y - 1 };
}
const termEnd = (t) => { const s = seasonOf(t.start); return s.summer ? `${s.year}-10-15` : `${s.year + 1}-04-15`; };
const nextTermStart = (t) => { const s = seasonOf(t.start); return s.summer ? `${s.year}-11-15` : `${s.year + 1}-05-15`; };
function firstTermStart() { // the nominal start of the season we are in, but never in the future
  const s = seasonOf(today()), d = s.summer ? `${s.year}-05-15` : `${s.year}-11-15`;
  return d > today() ? today() : d;
}
const fmtD = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const freshState = () => {
  const start = firstTermStart();
  return {
    v: 1, cadets: {}, classes: [], entries: [], comds: [], terms: [{ id: uid(), name: seasonOf(start).name, start }],
    settings: { currentClass: null, termStart: start, obs: OBS_DEFAULT.slice() }
  };
};
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
const liveClasses = () => S.classes.filter((c) => !c.archived);
const curClass = () => liveClasses().find((c) => c.id === S.settings.currentClass) || null;
const curTerm = () => S.terms[S.terms.length - 1];
const termOf = (c) => S.terms.find((t) => t.id === c.termId);
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

/* ---------- in-app dialogs (instead of the browser's alert/confirm/prompt,
   which show the website address as their title) ---------- */
function uiDialog(o) {
  return new Promise((res) => {
    U.dialog = Object.assign({ title: '', msg: '', ok: 'OK', cancel: 'Cancel', danger: false, input: null, err: '' }, o, { res });
    renderDialog();
  });
}
const uiAlert = (msg, title) => uiDialog({ title: title || 'Please check', msg, cancel: null });
const uiConfirm = (msg, o) => uiDialog(Object.assign({ msg }, o || {}));
function renderDialog() {
  let box = document.getElementById('dlg');
  if (!box) { box = document.createElement('div'); box.id = 'dlg'; document.body.appendChild(box); }
  const d = U.dialog;
  box.innerHTML = !d ? '' : `<div class="scrim" style="align-items:center;z-index:200;padding:20px">
    <div class="card" role="alertdialog" aria-modal="true" style="width:100%;max-width:400px;padding:20px;display:flex;flex-direction:column;gap:14px">
    ${d.title ? `<b style="font-size:18px">${esc(d.title)}</b>` : ''}
    <span style="font-size:15px;line-height:1.45;white-space:pre-line;color:#3F3F3A">${esc(d.msg)}</span>
    ${d.input ? `<label class="field"><span>Type ${esc(d.input)} to confirm</span><input type="text" id="dlgInput" autocapitalize="characters" autocomplete="off"></label>` : ''}
    ${d.err ? `<span style="color:#A1271B;font-size:13px">${esc(d.err)}</span>` : ''}
    <div class="${d.cancel ? 'grid2' : ''}" style="${d.cancel ? '' : 'display:flex'}">
      ${d.cancel ? `<button class="btn" data-act="dlgCancel">${esc(d.cancel)}</button>` : ''}
      <button class="btn ${d.danger ? 'danger' : 'pri'}" style="${d.cancel ? '' : 'flex:1'}${d.danger ? ';background:#A1271B;color:#fff;border-color:#A1271B' : ''}" data-act="dlgOk">${esc(d.ok)}</button>
    </div></div></div>`;
  const i = document.getElementById('dlgInput'); if (i) i.focus();
}
function closeDialog(val) { const d = U.dialog; U.dialog = null; renderDialog(); d.res(val); }

const LOGO = (px) => `<img src="icons/logo.png" alt="" width="${px}" height="${px}" style="flex:none;display:block">`;
const title = (t) => `<div style="display:flex;align-items:center;gap:10px;min-width:0">${LOGO(34)}<h1>${t}</h1></div>`;

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
  return `<div class="row"><div style="display:flex;align-items:center;gap:10px;min-width:0">${LOGO(34)}<h1 style="white-space:nowrap;font-size:min(21px,5.4vw)">${kicker}</h1></div><span class="kicker" style="white-space:nowrap;flex:none">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></div>
    <button class="classbtn" data-act="openClasses"><span class="l"><small>CURRENT CLASS</small><b>${c ? esc(className(c)) : 'Tap to add a class'}</b></span>
    <span style="color:#D9E3DA;display:flex;align-items:center;flex:none" aria-label="Change class">${ICON.down.replace('width="14" height="14"', 'width="20" height="20"')}</span></button>`;
}

function viewRecord() {
  const c = curClass();
  let body;
  if (!c) {
    body = `<div class="empty">${LOGO(96)}<b>Set up your first class</b><span>A class is Subject + Course + Gp, e.g. ICT · 158 L/C · Gp A. Create the class, then import or add its cadets.</span>
      <button class="btn pri" data-act="openClasses">Add class</button>
      ${!isInstalled() && installEvt ? '<button class="btn" data-act="install">Install app on this phone</button>' : ''}
      <span class="small" style="padding-top:24px">${CREDIT}</span></div>`;
  } else {
    const cadets = classCadets(c);
    const pls = ['All', ...new Set(cadets.map((x) => x.pl))];
    if (!pls.includes(U.pl)) U.pl = 'All';
 body = termBanner() + backupBanner() + `<label class="search">${ICON.search}<input id="q" type="text" inputmode="search" placeholder="GC No or name" aria-label="Search cadet" value="${esc(U.q)}"></label>
      ${U.mode === 'batch' ? batchObsHtml() : ''}
      <div class="chips">${pls.map((p) => `<button class="chip ${U.pl === p ? 'on' : ''}" data-act="pl" data-arg="${esc(p)}">${esc(p)}</button>`).join('')}
      <span class="small count-note">${cadets.length} cadets</span></div>
      <div id="list" class="list">${listHtml()}</div>
`;
    if (U.mode === 'batch') body += batchFootHtml();
  }
  return `<header class="hdr">${classHeader(esc(APP_NAME))}
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
  const hasOld = all.some((e) => e.ts < termTs());
  const scoped = U.histAll ? all : all.filter((e) => e.ts >= termTs());
  const cnt = {}; scoped.forEach((e) => { cnt[e.obs] = (cnt[e.obs] || 0) + 1; });
  const byType = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  if (U.histObs && !cnt[U.histObs]) U.histObs = null;
  const hf = U.histObs, shown = scoped.filter((e) => !hf || e.obs === hf);
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
    ${all.length ? `<div class="between"><span class="label">By type · tap to filter history</span>
      ${hasOld ? `<span class="chips" style="gap:4px"><button class="chip sm ${U.histAll ? '' : 'on'}" data-act="histScope" data-arg="term">This term</button><button class="chip sm ${U.histAll ? 'on' : ''}" data-act="histScope" data-arg="all">All time</button></span>` : ''}</div>
      <div class="card" style="padding:6px;display:flex;flex-direction:column;gap:2px">${byType.length ? byType.map(([o, n]) => filterBar('histObs', o, o, n, max, hf)).join('')
        : '<span class="small" style="padding:8px">Nothing this term. Tap “All time” to see earlier terms.</span>'}</div>` : ''}
    <span class="label">Comds</span><div class="card">${comdRow('PL COMD · ' + esc(x.pl), pl)}${comdRow('TERM COMD · ' + esc(x.course), tc)}</div>
    <div class="between"><span class="label">History${hf ? ' · ' + esc(hf) : ''}</span>${hf ? '<button class="chip sm" data-act="histObs" data-arg="">Clear ✕</button>' : '<span class="small">Tap an entry to edit</span>'}</div>
    <div class="list">${all.length ? (shown.length ? shown.map((e) => histHtml(e, e.ts < termTs())).join('') : '<div class="empty"><span>No entries for this filter.</span></div>') : '<div class="empty"><span>No observations recorded.</span></div>'}</div>
    </main>`;
}

// A stats row that doubles as a filter button (used on the profile and in Reports).
function filterBar(act, arg, label, n, max, selected) {
  const on = selected === arg, dim = selected != null && selected !== '' && !on;
  return `<button class="fbar ${on ? 'on' : ''} ${dim ? 'dim' : ''}" data-act="${act}" data-arg="${esc(arg)}" aria-pressed="${on}">
    <span class="n">${esc(label)}</span><span class="track"><span class="fill" style="display:block;width:${Math.round(n / max * 100)}%"></span></span><span class="c">${n}</span></button>`;
}

function histFilterHtml(all) {
  if (all.length < 2) return '';
  const types = {}; all.forEach((e) => { types[e.obs] = (types[e.obs] || 0) + 1; });
  const old = all.some((e) => e.ts < termTs());
  const chip = (arg, label, on) => `<button class="chip sm ${on ? 'on' : ''}" data-act="histObs" data-arg="${esc(arg)}">${esc(label)}</button>`;
  return `<div class="chips">${chip('', `All (${all.length})`, !U.histObs)}${Object.entries(types).sort((a, b) => b[1] - a[1]).map(([o, n]) => chip(o, `${o} (${n})`, U.histObs === o)).join('')}</div>
    ${old ? `<label class="check" style="font-size:13px"><input type="checkbox" id="histTerm" ${U.histTerm ? 'checked' : ''}><span>This term only</span></label>` : ''}`;
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
  const q = (U.cq || '').trim().toLowerCase(), sel = U.clsSel;
  const rows = Object.values(S.cadets).filter((x) => x.course === c.course && x.gp === c.gp && (x.active ? true : U.showRemoved && !sel) &&
    (!q || String(x.gc).includes(q) || x.name.toLowerCase().includes(q) || x.pl.toLowerCase().includes(q)))
    .sort((a, b) => (b.active - a.active) || a.pl.localeCompare(b.pl) || a.gc - b.gc);
  return rows.length ? rows.map((x) => `<button class="crow ${sel && sel.has(x.gc) ? 'sel' : ''}" style="min-height:54px;${x.active ? '' : 'opacity:.55'}" data-act="${sel ? 'clsToggle' : 'editCadet'}" data-arg="${x.gc}">
    ${sel ? `<input type="checkbox" tabindex="-1" aria-hidden="true" ${sel.has(x.gc) ? 'checked' : ''}>` : ''}
    <span class="grow"><span class="nm">${esc(x.name)}${x.tag ? `<span class="tag">${esc(x.tag)}</span>` : ''}${x.appt ? `<span class="tag" style="background:#EFEDE5;color:#3F3F3A">${esc(x.appt)}</span>` : ''}${x.active ? '' : '<span class="pill p-grey">Removed</span>'}</span>
    <span class="sub">GC ${x.gc} · ${esc(x.pl)}</span></span></button>`).join('')
    : `<div class="empty"><span>${q ? 'No cadet matches.' : 'No cadets in this class.'}</span></div>`;
}

function viewClass() {
  const c = S.classes.find((y) => y.id === U.classId);
  if (!c) { U.view = 'settings'; return viewSettings(); }
  const act = Object.values(S.cadets).filter((x) => x.active && x.course === c.course && x.gp === c.gp);
  const pls = {}; act.forEach((x) => { pls[x.pl] = (pls[x.pl] || 0) + 1; });
  const shared = S.classes.filter((y) => y.id !== c.id && y.course === c.course && y.gp === c.gp);
  const isCur = c.id === S.settings.currentClass;
  const removed = Object.values(S.cadets).filter((x) => !x.active && x.course === c.course && x.gp === c.gp).length;
  return `<header class="hdr"><div class="row" style="justify-content:flex-start"><button class="back" data-act="back" aria-label="Back">${ICON.back}</button>
    <span class="grow"><span class="kicker">Class</span><span style="font-size:19px;font-weight:700">${esc(className(c))}</span></span></div></header>
    <main class="body">
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <b style="font-size:15px">${act.length} cadet${act.length === 1 ? '' : 's'}${Object.keys(pls).length ? ' · ' + Object.entries(pls).sort().map(([k, v]) => `${esc(k)} (${v})`).join(', ') : ''}</b>
      <div class="grid2"><button class="btn pri sm" data-act="pickFile" data-arg="${c.id}">Import list</button><button class="btn sm" data-act="newCadet">Add cadet</button></div>
      <span class="small">Excel/CSV with columns GC No, Name, Pl (Appt optional). If the file also has Course and Gp, only rows for ${esc(c.course)} Gp ${esc(c.gp)} are taken. Importing again updates the list — nothing recorded is lost.</span>
      ${shared.length ? `<span class="small">Same cadets as: ${shared.map((y) => esc(className(y))).join(', ')}</span>` : ''}
    </div>
    ${isCur ? '' : `<button class="btn" data-act="useClass" data-arg="${c.id}">Use this class for recording</button>`}
    <div class="between"><span class="label">Cadets</span>
      ${U.clsSel ? `<button class="chip sm" style="border:0;color:#23402F" data-act="clsAll">${U.clsSel.size === act.length ? 'Select none' : 'Select all'}</button>`
        : (act.length ? '<button class="chip sm" style="border:0;color:#A1271B" data-act="clsSelect">Remove cadets…</button>' : '')}</div>
    <label class="search">${ICON.search}<input id="ccq" type="text" placeholder="GC No, name or Pl" value="${esc(U.cq || '')}"></label>
    <div id="clsList" class="list">${classListRows(c)}</div>
    ${removed && !U.clsSel ? `<button class="btn sm" data-act="toggleRemoved">${U.showRemoved ? 'Hide' : 'Show'} removed cadets (${removed})</button>` : ''}
    ${U.clsSel ? '' : `<button class="btn danger" data-act="delClass" data-arg="${c.id}">Remove this class</button>`}
    </main>
    ${U.clsSel ? `<div class="foot"><span class="small">Removed cadets disappear from this class. Their records are kept, and importing the list again brings them back.</span>
      <div class="grid2"><button class="btn" data-act="clsCancel">Cancel</button>
      <button class="btn danger" style="background:#A1271B;color:#fff;border-color:#A1271B" data-act="clsRemove" ${U.clsSel.size ? '' : 'disabled'}>Remove ${U.clsSel.size || ''}</button></div></div>` : ''}`;
}

function viewPending() {
  const list = S.entries.filter((e) => e.status === 'pending').sort((a, b) => b.ts - a.ts);
  const card = (e) => {
    const x = S.cadets[e.gc] || { name: 'Unknown', gc: e.gc, pl: '', course: '' };
    const cls = S.classes.find((c) => c.id === e.classId);
    const m = e.pun === 'plcomd' ? comdFor('Pl Comd', x.pl) : null;
    return `<div class="card" style="padding:14px;display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline"><b style="font-size:15px;min-width:0">${esc(x.name)}</b><span class="small" style="white-space:nowrap">${esc(fmtWhen(e.ts))}</span></div>
      <span class="sub">GC ${x.gc} · ${esc(x.pl)}</span>
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
  return `<header class="hdr">${title('Pending actions')}<span class="kicker">All classes · ${list.length} to do</span></header><main class="body">${body}</main>`;
}

/* ---------- reports ---------- */
function repRange() { // [from, to)
  const r = U.rep, now = new Date();
  if (r.period === 'week') { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [d.getTime(), Infinity]; }
  if (r.period === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), Infinity];
  if (r.period === 'all') return [0, Infinity];
  const i = Math.max(0, S.terms.findIndex((t) => t.id === r.term));
  const t = S.terms[i] || curTerm(), next = S.terms[i + 1];
  return [new Date(t.start + 'T00:00:00').getTime(), next ? new Date(next.start + 'T00:00:00').getTime() : Infinity];
}
function repEntries() {
  const r = U.rep, [from, to] = repRange();
  return S.entries.filter((e) => e.ts >= from && e.ts < to && (r.cls === 'all' || e.classId === r.cls));
}
const punKey = (e) => e.pun || 'none';
const repMatch = (e, skip) => (skip === 'obs' || !U.rep.obs || e.obs === U.rep.obs) && (skip === 'pun' || !U.rep.pun || punKey(e) === U.rep.pun);
const repFiltered = () => repEntries().filter((e) => repMatch(e));
const PERIODS = [['week', 'Week'], ['month', 'Month'], ['term', 'Term'], ['all', 'All']];

function viewReports() {
  const r = U.rep || (U.rep = { cls: S.settings.currentClass || 'all', period: 'term', term: curTerm().id });
  if (r.cls !== 'all' && !S.classes.some((c) => c.id === r.cls)) r.cls = 'all';
  if (!S.terms.some((t) => t.id === r.term)) r.term = curTerm().id;
  const arch = S.classes.filter((c) => c.archived);
  const base = repEntries(), es = base.filter((e) => repMatch(e));
  // each group's counts respect the OTHER group's filter, so choices narrow each other
  const byObs = {}; base.filter((e) => repMatch(e, 'obs')).forEach((e) => { byObs[e.obs] = (byObs[e.obs] || 0) + 1; });
  const obsRows = Object.entries(byObs).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...obsRows.map(([, n]) => n));
  const byPun = {}; base.filter((e) => repMatch(e, 'pun')).forEach((e) => { byPun[punKey(e)] = (byPun[punKey(e)] || 0) + 1; });
  const pmax = Math.max(1, ...Object.values(byPun));
  const byCadet = {}; es.forEach((e) => { byCadet[e.gc] = (byCadet[e.gc] || 0) + 1; });
  const ranked = Object.entries(byCadet).sort((a, b) => b[1] - a[1]);
  const top = r.allTop ? ranked : ranked.slice(0, 10);
  const pend = es.filter((e) => e.status === 'pending').length;
  const filt = [r.obs, r.pun ? punLabel(r.pun === 'none' ? null : r.pun) : null].filter(Boolean);
  return `<header class="hdr"><div class="row">${title('Reports')}</div>
    <select id="repCls" aria-label="Class" style="background:#183026;color:#fff;border:0;font-weight:600">
      <option value="all" ${r.cls === 'all' ? 'selected' : ''}>All classes</option>
      ${liveClasses().map((c) => `<option value="${c.id}" ${r.cls === c.id ? 'selected' : ''}>${esc(className(c))}</option>`).join('')}
      ${arch.length ? `<optgroup label="Previous terms">${arch.map((c) => `<option value="${c.id}" ${r.cls === c.id ? 'selected' : ''}>${esc(className(c))} (${esc((termOf(c) || {}).name || 'old')})</option>`).join('')}</optgroup>` : ''}</select>
    <div class="seg">${PERIODS.map(([k, l]) => `<button class="${r.period === k ? 'on' : ''}" data-act="repPeriod" data-arg="${k}">${l}</button>`).join('')}</div>
    ${r.period === 'term' && S.terms.length > 1 ? `<select id="repTerm" aria-label="Term" style="background:#183026;color:#fff;border:0">${S.terms.slice().reverse().map((t) =>
      `<option value="${t.id}" ${r.term === t.id ? 'selected' : ''}>${esc(t.name)} (from ${esc(fmtD(t.start))})${t === curTerm() ? ' · current' : ''}</option>`).join('')}</select>` : ''}</header>
    <main class="body">
    <div class="grid3 tiles"><div class="t"><b>${es.length}</b><span>Observations</span></div><div class="t"><b>${Object.keys(byCadet).length}</b><span>Cadets</span></div>
    <div class="t"><b style="color:${pend ? '#7A4300' : '#1C1C1A'}">${pend}</b><span>Pending</span></div></div>
    ${base.length ? `<span class="label">By observation · tap to filter</span>
    <div class="card" style="padding:6px;display:flex;flex-direction:column;gap:2px">${obsRows.length ? obsRows.map(([o, n]) => filterBar('repObs', o, o, n, max, r.obs)).join('') : '<span class="small" style="padding:8px">None for this punishment.</span>'}</div>
    <span class="label">Punishments · tap to filter</span>
    <div class="card" style="padding:6px;display:flex;flex-direction:column;gap:2px">${PUN.map((pn) => [pn.id, pn.label]).concat([['none', 'Not decided yet']])
      .filter(([k]) => byPun[k] || r.pun === k).map(([k, l]) => filterBar('repPun', k, l, byPun[k] || 0, pmax, r.pun)).join('') || '<span class="small" style="padding:8px">None for this observation.</span>'}</div>
    <div class="between"><span class="label">${filt.length ? 'Cadets · ' + esc(filt.join(' + ')) : 'Most observations'}</span>${filt.length ? '<button class="chip sm" data-act="repClear">Clear ✕</button>' : ''}</div>
    <div class="list">${top.map(([gc, n], i) => { const x = S.cadets[gc] || { name: '?', pl: '' };
      return `<button class="crow" style="min-height:56px" data-act="openProfile" data-arg="${gc}"><span style="width:20px;font-weight:700;color:#5B5B55">${i + 1}</span>
      <span class="grow"><span class="nm">${esc(x.name)}</span><span class="sub">GC ${gc} · ${esc(x.pl)}</span></span><span class="pill ${n >= 4 ? 'p-red' : n >= 2 ? 'p-amb' : 'p-grey'}">${n}${filt.length ? '×' : ' obs'}</span></button>`; }).join('') || '<div class="empty"><span>No cadets for this filter.</span></div>'}</div>
    ${ranked.length > 10 ? `<button class="btn sm" data-act="repAllTop">${r.allTop ? 'Show top 10' : `Show all ${ranked.length} cadets`}</button>` : ''}`
    : '<div class="empty"><span>No observations in this period.</span></div>'}
    ${filt.length ? '<span class="small">Excel export includes only the filtered entries.</span>' : ''}
    <div class="grid2"><button class="btn pri" data-act="exportXlsx" data-arg="save" ${es.length ? '' : 'disabled'}>Export Excel</button>
    <button class="btn" data-act="exportXlsx" data-arg="share" ${es.length && navigator.share ? '' : 'disabled'}>Share Excel</button></div>
    </main>`;
}

function buildXlsx() {
  const r = U.rep, es = repFiltered().sort((a, b) => a.ts - b.ts);
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
  const ftag = [r.obs, r.pun ? punLabel(r.pun === 'none' ? null : r.pun) : null].filter(Boolean).join('_');
  const tag = ((c ? `${c.subject}_${c.course}_Gp${c.gp}` : 'AllClasses') + (ftag ? '_' + ftag : '')).replace(/[^A-Za-z0-9]+/g, '_');
  const perName = r.period === 'term' ? (S.terms.find((t) => t.id === r.term) || curTerm()).name : r.period;
  const name = `${FILE_TAG}_${tag}_${perName.replace(/[^A-Za-z0-9]+/g, '_')}_${today()}.xlsx`;
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
// Returns 'shared', 'cancelled' or 'blocked'. Android Chrome only shares some file
// types (text, PDF, images…); others are refused with “Permission denied”.
async function shareFile(file) {
  try { if (navigator.canShare && !navigator.canShare({ files: [file] })) return 'blocked'; } catch (e) { return 'blocked'; }
  try { await navigator.share({ files: [file], title: file.name }); return 'shared'; }
  catch (e) { return e.name === 'AbortError' ? 'cancelled' : 'blocked'; }
}

/* ---------- backup ---------- */
// Backups are plain text (.txt) so Android allows sharing them to WhatsApp/Drive/Gmail.
function backupFile() {
  const data = JSON.stringify({ app: 'cadet-obs', v: 1, exported: Date.now(), state: S });
  return new File([data], `${FILE_TAG}_backup_${today()}.txt`, { type: 'text/plain' });
}
const daysSince = (ts) => ts ? Math.floor((Date.now() - ts) / 86400000) : null;
function termBanner() {
  const t = curTerm();
  if (today() <= termEnd(t)) return '';
  return `<div class="warn" style="display:flex;align-items:center;gap:10px"><span style="flex:1">${esc(t.name)} was due to end on ${esc(fmtD(termEnd(t)))}. Start ${esc(seasonOf(nextTermStart(t)).name)}?</span>
    <button class="btn sm" style="flex:none" data-act="openNewTerm">New term</button></div>`;
}
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
  return `<header class="hdr">${title('Settings')}</header><main class="body">
    <div class="between"><span class="label">My classes</span><button class="chip sm" style="border:0;color:#23402F" data-act="openClasses">+ Add class</button></div>
    <div class="card" style="overflow:hidden">
      ${liveClasses().length ? liveClasses().map((c) => { const n = classCadets(c).length;
        return `<button class="crow" style="border:0;border-bottom:1px solid #EFEDE5;border-radius:0" data-act="openClass" data-arg="${c.id}">
        <span class="grow"><span class="nm">${esc(className(c))}${c.id === S.settings.currentClass ? '<span class="pill p-ok">Recording</span>' : ''}</span>
        <span class="sub">${n} cadet${n === 1 ? '' : 's'} · tap to import / add / edit</span></span><span aria-hidden="true">›</span></button>`; }).join('')
      : '<div style="padding:14px" class="small">No classes yet. Tap “+ Add class”.</div>'}</div>
    <div class="grid2"><button class="btn sm" data-act="openCadetList">All cadets · ${act}</button>
    <button class="btn sm" data-act="openArchived" ${S.classes.some((c) => c.archived) ? '' : 'disabled'}>Old classes · ${S.classes.filter((c) => c.archived).length}</button></div>

    <span class="label">Term</span>
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;flex-direction:column;gap:2px"><b style="font-size:18px;white-space:nowrap">${esc(curTerm().name)}</b><span class="small">Ends around ${esc(fmtD(termEnd(curTerm())))}</span></div>
      <label class="field"><span>Started on (adjust if the term began on another date)</span><input type="date" id="termStart" value="${esc(S.settings.termStart)}"></label>
      <span class="small">“1st / 2nd time” counts start from this date. The name is set automatically: Summer (May–Oct) or Winter (Nov–Apr).${S.terms.length > 1 ? ` ${S.terms.length - 1} previous term${S.terms.length > 2 ? 's' : ''} kept for reports.` : ''}</span>
      <button class="btn sm" data-act="openNewTerm">Start new term…</button>
    </div>

    <div class="between"><span class="label">Comds directory</span><button class="chip sm" style="border:0;color:#23402F" data-act="editComd" data-arg="new">+ Add</button></div>
    <div class="card" style="overflow:hidden">
      ${S.comds.length ? S.comds.slice().sort((a, b) => a.role.localeCompare(b.role) || a.key.localeCompare(b.key)).map((m) => `<button class="crow" style="border:0;border-bottom:1px solid #EFEDE5;border-radius:0" data-act="editComd" data-arg="${S.comds.indexOf(m)}">
        <span style="width:84px;font-size:11px;font-weight:700;color:${m.role === 'Term Comd' ? '#1F3A5F' : '#23402F'}">${m.role === 'Term Comd' ? 'TERM' : 'PL'} · ${esc(m.key)}</span>
        <span class="grow"><span style="font-size:14px;font-weight:600">${esc([m.rank, m.name].filter(Boolean).join(' '))}</span><span class="small">${esc([m.unit, m.phone].filter(Boolean).join(' · ') || 'No phone saved')}</span></span></button>`).join('')
      : '<div style="padding:14px" class="small">None yet. Tap “+ Add”, or include a Comds sheet in a class import file.</div>'}</div>

    <span class="label">Backup &amp; restore</span>
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <span style="font-size:14px;font-weight:600;color:${d === null || d >= 7 ? '#A1271B' : '#23402F'}">${lb ? `Last backup: ${esc(fmtWhen(lb))}` : 'No backup yet'}</span>
      <button class="btn sm pri" data-act="backup" data-arg="save">Save backup file</button>
      <button class="btn sm" data-act="backup" data-arg="share" ${canShareFiles() ? '' : 'disabled'}>Share backup (WhatsApp, Drive…)</button>
      <button class="btn sm" data-act="pickRestore">Restore from backup…</button>
      <span class="small">The backup is one file (${FILE_TAG}_backup_date.txt) with everything: cadets, classes, records, Comds. Keep it in Google Drive or send it to yourself on WhatsApp. Restoring replaces all data on this phone.</span>
    </div>

    ${installCard()}
    <span class="label">Security</span>
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <span style="font-size:14px;font-weight:600">PIN lock: ${S.settings.pinHash ? 'On' : 'Off'}</span>
      ${S.settings.pinHash ? '<div class="grid2"><button class="btn sm" data-act="pinSetup">Change PIN</button><button class="btn sm" data-act="pinOff">Turn off</button></div>'
        : '<button class="btn sm pri" data-act="pinSetup">Set a 4-digit PIN</button>'}
      <span class="small">Asked when the app opens and after 1 minute in the background. If you forget the PIN, the only way in is to erase all data — keep a backup.</span>
    </div>

    <button class="btn danger" data-act="eraseAll">Erase all data on this phone</button>
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:12px">${LOGO(56)}
    <span class="small" style="text-align:center;color:#3F3F3A;font-weight:600">${CREDIT}</span>
    <span class="small" style="text-align:center">${esc(APP_NAME)} · v${APP_VERSION} · data stored only on this phone</span></div>
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
  return `<div style="position:fixed;inset:0;background:#23402F;color:#fff;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:safe center;gap:18px;padding:24px 24px 16px;overflow-y:auto">
    ${LOGO(104)}
    <span style="font-size:15px;font-weight:600;color:#D9E3DA;margin-top:-8px">${esc(APP_NAME)}</span>
    <b style="font-size:20px">${title}</b>
    <div style="display:flex;gap:16px">${dots}</div>
    <span style="min-height:20px;color:#F7C873;font-size:14px">${esc(L.msg || '')}</span>
    <div style="display:grid;grid-template-columns:repeat(3,76px);gap:14px">${keys.map((k) => k === '' ? '<span></span>'
      : `<button data-act="pinKey" data-arg="${k}" aria-label="${k === '⌫' ? 'Delete' : k}" style="height:76px;border-radius:38px;border:0;background:${k === '⌫' ? 'transparent' : '#183026'};color:#fff;font-size:26px;font-weight:600">${k}</button>`).join('')}</div>
    ${L.mode === 'unlock' ? '<button data-act="forgotPin" style="border:0;background:transparent;color:#D9E3DA;font-size:14px;height:44px">Forgot PIN?</button>'
      : '<button data-act="pinCancel" style="border:0;background:transparent;color:#D9E3DA;font-size:14px;height:44px">Cancel</button>'}
    <span style="text-align:center;font-size:12px;color:#B8C9BC;pointer-events:none;padding-bottom:env(safe-area-inset-bottom)">${CREDIT}</span>
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
  else if (s.type === 'newTerm') inner = newTermSheet();
  else if (s.type === 'archived') inner = archivedSheet();
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
  const rows = liveClasses().map((c) => {
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
    ${x ? `<label class="check"><input type="checkbox" id="cActive" ${x.active ? 'checked' : ''}><span>In class (untick to remove — e.g. relegated / withdrawn; history is kept)</span></label>` : ''}
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

function newTermSheet() {
  const t = curTerm(), lc = liveClasses();
  const pend = S.entries.filter((e) => e.status === 'pending').length;
  const d = daysSince(S.settings.lastBackup);
  return `<h2>Start new term</h2>
    <span class="small">Finishing: <b style="color:#1C1C1A">${esc(t.name)}</b> (from ${esc(fmtD(t.start))}) · ${lc.length} class${lc.length === 1 ? '' : 'es'} · ${S.entries.filter((e) => e.ts >= termTs()).length} records</span>
    <div class="${d === 0 ? 'hint ok' : 'warn'}" style="display:flex;align-items:center;gap:10px"><span style="flex:1">${d === 0 ? 'Backup saved today.' : 'Step 1: save a backup of the finished term first.'}</span>
      <button class="btn sm" style="flex:none" data-act="backup" data-arg="save">Back up</button></div>
    <label class="field"><span>New term starts on</span><input type="date" id="ntStart" value="${nextTermStart(t)}"></label>
    <span class="small">Name (automatic): <b id="ntNameShow" style="font-size:16px;color:#1C1C1A">${esc(seasonOf(nextTermStart(t)).name)}</b></span>
    <label class="check"><input type="checkbox" id="ntArchive" checked><span>Move the current ${lc.length} class${lc.length === 1 ? '' : 'es'} to “Old classes”. You then add this term's classes fresh. Old records stay in history and reports.</span></label>
    ${pend ? `<label class="check"><input type="checkbox" id="ntClose"><span>Mark the ${pend} pending action${pend > 1 ? 's' : ''} as done (leave unticked to keep them on the Pending tab).</span></label>` : ''}
    <span class="small">Cadets are not deleted. Counts (“1st / 2nd time”) restart from the new date; earlier observations show as “previous term” in each cadet's history.</span>
    <button class="btn pri" data-act="startNewTerm">Start new term</button><button class="btn" data-act="closeSheet">Cancel</button>`;
}

function archivedSheet() {
  const arch = S.classes.filter((c) => c.archived);
  return `<h2>Old classes</h2><span class="small">Classes from previous terms. Their records stay in history and in Reports (choose them under “Previous terms”).</span>
    ${arch.map((c) => { const n = S.entries.filter((e) => e.classId === c.id).length;
      return `<div class="card" style="padding:12px 14px;display:flex;align-items:center;gap:10px"><span class="grow"><span class="nm">${esc(className(c))}</span>
      <span class="sub">${esc((termOf(c) || {}).name || '')} · ${n} record${n === 1 ? '' : 's'}</span></span>
      <button class="btn sm" style="flex:none" data-act="unarchive" data-arg="${c.id}">Use again</button></div>`; }).join('')}
    <button class="btn" data-act="closeSheet">Close</button>`;
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
  if (U.dialog) { pushNav(); closeDialog(false); return; }
  if (U.sheet) { U.sheet = null; U.preview = null; }
  else if (U.view === 'profile') { U.view = U.profileFrom || 'record'; U.profile = null; }
  else if (U.view === 'class') { if (U.clsSel) { U.clsSel = null; pushNav(); render(); return; } U.view = U.classFrom || 'record'; }
  else if (U.cadet) { U.cadet = null; U.selObs = null; U.note = ''; U.showNote = false; }
  render();
}

const A = {
  dlgOk() {
    const d = U.dialog;
    if (d.input && norm($('#dlgInput').value).toUpperCase() !== d.input) { d.err = `Please type ${d.input} exactly.`; renderDialog(); return; }
    closeDialog(true);
  },
  dlgCancel() { closeDialog(false); },
  nav(k) { U.clsSel = null; U.view = k; U.cadet = null; U.profile = null; U.selObs = null; render(); window.scrollTo(0, 0); },
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
  histObs(o) { U.histObs = o && o !== U.histObs ? o : null; render(); },
  histScope(k) { U.histAll = k === 'all'; render(); },
  openProfile(gc) { U.histObs = null; U.histAll = false; U.profileFrom = U.view === 'profile' ? U.profileFrom : U.view; U.profile = +gc; U.view = 'profile'; U.cadet = null; pushNav(); render(); window.scrollTo(0, 0); },
  editEntry(id) { U.sheet = { type: 'edit', id }; pushNav(); render(); },
  async saveEdit(id) {
    const e = S.entries.find((y) => y.id === id);
    e.obs = $('#eObs').value; e.pun = $('#ePun').value || null; e.status = $('#eStatus').value; e.note = $('#eNote').value.trim();
    if (!e.pun) e.status = 'pending';
    await save(); U.sheet = null; silentBack(); showToast('Entry updated', e.obs, null); render();
  },
  async delEntry(id) {
    if (!(await uiConfirm('This entry will be deleted permanently.', { title: 'Delete entry?', ok: 'Delete', danger: true }))) return;
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
    U.view = 'class'; U.classId = id; U.cq = ''; U.clsSel = null; render(); window.scrollTo(0, 0);
  },
  async useClass(id) { S.settings.currentClass = id; await save(); showToast('Recording in', className(S.classes.find((c) => c.id === id)), null); render(); },
  async pickClass(id) { S.settings.currentClass = id; U.pl = 'All'; U.batchSel.clear(); await save(); U.sheet = null; silentBack(); render(); },
  async addClass() {
    const f = U.sheet.form;
    f.subject = $('#fSubject').value.trim(); f.course = normCourse($('#fCourse').value); f.gp = $('#fGp').value;
    if (!f.subject) { uiAlert('Enter the subject, e.g. ICT'); return; }
    if (!f.course) { uiAlert('Enter the course, e.g. 158 L/C'); return; }
    if (liveClasses().some((c) => c.subject.toLowerCase() === f.subject.toLowerCase() && c.course === f.course && c.gp === f.gp)) { uiAlert('This class already exists.'); return; }
    const c = { id: uid(), subject: f.subject, course: f.course, gp: f.gp, termId: curTerm().id };
    S.classes.push(c); S.settings.currentClass = c.id;
    await save();
    // the classes sheet's history entry is reused for the class screen
    U.sheet = null; U.classFrom = U.view === 'class' ? 'settings' : U.view; U.view = 'class'; U.classId = c.id; U.cq = '';
    showToast('Class added', className(c), null); render(); window.scrollTo(0, 0);
  },
  async delClass(id) {
    const c = S.classes.find((y) => y.id === id);
    if (!(await uiConfirm('Cadets and recorded entries are kept.', { title: `Remove class “${className(c)}”?`, ok: 'Remove', danger: true }))) return;
    S.classes = S.classes.filter((y) => y.id !== id);
    if (S.settings.currentClass === id) S.settings.currentClass = liveClasses()[0] ? liveClasses()[0].id : null;
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
    if (!gc) { uiAlert('Enter the GC No (numbers only).'); return; }
    if (!name || !pl || !course) { uiAlert('Name, Pl and Course are required.'); return; }
    if (!old && S.cadets[gc]) { uiAlert(`GC ${gc} already exists: ${S.cadets[gc].name} (${S.cadets[gc].course}). Edit that cadet instead.`); return; }
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
  clsSelect() { U.clsSel = new Set(); render(); },
  clsCancel() { U.clsSel = null; render(); },
  clsToggle(gc) { gc = +gc; U.clsSel.has(gc) ? U.clsSel.delete(gc) : U.clsSel.add(gc); render(); },
  clsAll() {
    const c = S.classes.find((y) => y.id === U.classId);
    const act = Object.values(S.cadets).filter((x) => x.active && x.course === c.course && x.gp === c.gp);
    U.clsSel = U.clsSel.size === act.length ? new Set() : new Set(act.map((x) => x.gc)); render();
  },
  toggleRemoved() { U.showRemoved = !U.showRemoved; render(); },
  async clsRemove() {
    const c = S.classes.find((y) => y.id === U.classId), n = U.clsSel.size;
    const shared = liveClasses().filter((y) => y.id !== c.id && y.course === c.course && y.gp === c.gp);
    const msg = `${n} cadet${n > 1 ? 's' : ''} will be removed from ${className(c)}.${shared.length ? `\nThey are also removed from ${shared.map(className).join(', ')} (same course and group).` : ''}\n\nThe class stays. Records already made are kept. Import the list again or add cadets to fill the class.`;
    if (!(await uiConfirm(msg, { title: 'Remove cadets?', ok: 'Remove', danger: true }))) return;
    let deleted = 0;
    U.clsSel.forEach((gc) => {
      if (S.entries.some((e) => e.gc === gc)) S.cadets[gc].active = false; // keep for history
      else { delete S.cadets[gc]; deleted++; } // never recorded: remove completely
    });
    await save(); U.clsSel = null;
    showToast(`${n} cadet${n > 1 ? 's' : ''} removed`, 'The class is kept', null); render();
  },
  openCadetList() { U.sheet = { type: 'cadetList', q: '' }; pushNav(); render(); },
  editComd(i) { U.sheet = { type: 'comd', idx: i }; pushNav(); render(); },
  async saveComd() {
    const role = $('#mRole').value, rawKey = norm($('#mKey').value);
    const m = { role, key: role === 'Term Comd' ? normCourse(rawKey) : rawKey.toUpperCase(), rank: norm($('#mRank').value), name: norm($('#mName').value), unit: norm($('#mUnit').value), phone: norm($('#mPhone').value) };
    if (!m.key || !m.name) { uiAlert('Pl/Course and Name are required.'); return; }
    const i = U.sheet.idx;
    const dup = S.comds.findIndex((y) => y.role === m.role && y.key === m.key);
    if (i === 'new') { if (dup >= 0) S.comds[dup] = m; else S.comds.push(m); } else S.comds[+i] = m;
    await save(); U.sheet = null; silentBack(); showToast('Comd saved', `${m.role} ${m.key}`, null);
  },
  async delComd() {
    if (!(await uiConfirm('This Comd will be removed from the directory.', { title: 'Delete Comd?', ok: 'Delete', danger: true }))) return;
    S.comds.splice(+U.sheet.idx, 1); await save(); U.sheet = null; silentBack();
  },
  async install() {
    if (!installEvt) return;
    installEvt.prompt();
    const r = await installEvt.userChoice.catch(() => null);
    installEvt = null; render();
    if (r && r.outcome === 'dismissed') showToast('Not installed', 'Settings → Install, any time', null);
  },
  repPeriod(k) { U.rep.period = k; render(); },
  repObs(o) { U.rep.obs = U.rep.obs === o ? null : o; U.rep.allTop = false; render(); },
  repPun(k) { U.rep.pun = U.rep.pun === k ? null : k; U.rep.allTop = false; render(); },
  repClear() { U.rep.obs = null; U.rep.pun = null; render(); },
  repAllTop() { U.rep.allTop = !U.rep.allTop; render(); },
  openNewTerm() { U.sheet = { type: 'newTerm' }; pushNav(); render(); },
  openArchived() { U.sheet = { type: 'archived' }; pushNav(); render(); },
  async unarchive(id) {
    const c = S.classes.find((y) => y.id === id); c.archived = false; c.termId = curTerm().id;
    await save(); showToast('Class back in use', className(c), null); render();
  },
  async startNewTerm() {
    const start = $('#ntStart').value;
    if (!start) { uiAlert('Choose the start date of the new term.'); return; }
    const name = seasonOf(start).name;
    if (start <= curTerm().start) { uiAlert(`The new term must start after ${fmtD(curTerm().start)}.`); return; }
    if (S.terms.some((x) => x.name === name)) { uiAlert(`${name} already exists. Choose a start date in the next term (e.g. ${fmtD(nextTermStart(curTerm()))}).`); return; }
    const archive = $('#ntArchive').checked, close = $('#ntClose') && $('#ntClose').checked;
    if (!(await uiConfirm(`${name} starts on ${fmtD(start)}.${archive ? '\nCurrent classes move to “Old classes”.' : ''}${close ? '\nPending actions are marked done.' : ''}`, { title: 'Start new term?', ok: 'Start' }))) return;
    S.terms.push({ id: uid(), name, start });
    S.settings.termStart = start;
    if (archive) { liveClasses().forEach((c) => { c.archived = true; }); S.settings.currentClass = null; }
    if (close) S.entries.forEach((e) => { if (e.status === 'pending') e.status = 'done'; });
    U.rep = null;
    await save(); U.sheet = null; silentBack();
    showToast(`${name} started`, archive ? 'Now add this term’s classes' : 'Counts restart from today', null); render();
  },
  async exportXlsx(how) {
    const f = buildXlsx();
    if (how === 'share') {
      const r = await shareFile(f);
      if (r !== 'blocked') return;
      downloadFile(f);
      uiAlert(`This phone does not allow sharing Excel files directly, so it was saved to Downloads instead:\n${f.name}\n\nTo send it, open the Files app → Downloads, long-press the file and tap Share.`, 'Saved to Downloads');
      return;
    }
    downloadFile(f); showToast('Excel saved', f.name + ' (Downloads)', null); render();
  },
  async backup(how) {
    const f = backupFile();
    let note = f.name + ' (Downloads)';
    if (how === 'share') {
      const r = await shareFile(f);
      if (r === 'cancelled') return;
      if (r === 'blocked') { downloadFile(f); uiAlert(`Sharing is not allowed on this phone, so the backup was saved to Downloads instead:\n${f.name}`, 'Saved to Downloads'); }
      else note = f.name;
    } else downloadFile(f);
    S.settings.lastBackup = Date.now(); await save(); showToast('Backup saved', note, null); render();
  },
  pickRestore() { $('#restoreInput').value = ''; $('#restoreInput').click(); },
  pinSetup() { U.lock = { mode: 'set1', pin: '', first: '', msg: '' }; render(); },
  async pinOff() { if (!(await uiConfirm('The app will open without a PIN.', { title: 'Turn off PIN lock?', ok: 'Turn off' }))) return; delete S.settings.pinHash; await save(); showToast('PIN lock off', '', null); render(); },
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
    if (!(await uiConfirm('Without the PIN, the only way in is to erase all data on this phone. You can restore a backup afterwards.', { title: 'Forgot PIN?', ok: 'Erase all data', danger: true, input: 'ERASE' }))) return;
    S = freshState(); await save(); U.lock = null; U.view = 'record'; render();
  },
  async eraseAll() {
    if (!(await uiConfirm('This deletes ALL cadets, classes, records and Comds on this phone. Make a backup first if you may need them.', { title: 'Erase all data?', ok: 'Erase', danger: true, input: 'ERASE' }))) return;
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
  else if (t.id === 'ntStart' && t.value) $('#ntNameShow').textContent = seasonOf(t.value).name;
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
  } else if (t.id === 'termStart' && t.value) {
    const prev = S.terms[S.terms.length - 2];
    if (prev && t.value <= prev.start) { uiAlert(`Must be after the previous term's start (${prev.start}).`); render(); return; }
    const nm = seasonOf(t.value).name;
    if (S.terms.some((x) => x !== curTerm() && x.name === nm)) { uiAlert(`${nm} already exists as an earlier term.`); render(); return; }
    S.settings.termStart = t.value; curTerm().start = t.value; curTerm().name = nm;
    await save(); showToast('Term start saved', `${nm} · from ${fmtD(t.value)}`, null); render();
  }
  else if (t.id === 'ntStart' && t.value) { $('#ntNameShow').textContent = seasonOf(t.value).name; }
  else if (t.id === 'histTerm') { U.histTerm = t.checked; render(); }
  else if (t.id === 'repTerm') { U.rep.term = t.value; render(); }
  else if (t.id === 'fileInput' && t.files[0]) handleFile(t.files[0]);
  else if (t.id === 'repCls') { U.rep.cls = t.value; render(); }
  else if (t.id === 'restoreInput' && t.files[0]) restoreFrom(t.files[0]);
});
window.addEventListener('popstate', goBack);

function migrate() { // fill fields added in later versions
  S.settings = Object.assign(freshState().settings, S.settings || {});
  if (!S.terms || !S.terms.length) S.terms = [{ id: uid(), start: S.settings.termStart }];
  S.terms.forEach((t) => { t.name = seasonOf(t.start).name; }); // names always follow the start date
  S.classes.forEach((c) => { if (!c.termId) c.termId = S.terms[S.terms.length - 1].id; });
}

async function restoreFrom(f) {
  let b;
  try { b = JSON.parse(await f.text()); } catch (e) { uiAlert('This is not a valid backup file.'); return; }
  if (!b || b.app !== 'cadet-obs' || !b.state || !b.state.cadets) { uiAlert(`This is not a ${APP_NAME} backup file.`); return; }
  const st = b.state;
  const msg = `Backup of ${new Date(b.exported).toLocaleString()}\n${Object.keys(st.cadets).length} cadets · ${st.classes.length} classes · ${st.entries.length} records\n\nThis replaces all data currently on this phone.`;
  if (!(await uiConfirm(msg, { title: 'Restore backup?', ok: 'Restore', danger: true }))) return;
  S = Object.assign(freshState(), st);
  migrate();
  await save(); U.view = 'record'; U.cadet = null; U.rep = null;
  showToast('Backup restored', `${st.entries.length} records`, null); render();
}

/* ---------- install (Chrome hides its own prompt for months once dismissed) ---------- */
let installEvt = null;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (S) render(); });
window.addEventListener('appinstalled', () => { installEvt = null; if (S) { showToast('App installed', 'Open it from your home screen', null); render(); } });
function installCard() {
  if (isInstalled()) return '';
  return `<span class="label">Install</span><div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
    <span style="font-size:14px;font-weight:600">Put ${esc(APP_NAME)} on your home screen</span>
    ${installEvt ? '<button class="btn sm pri" data-act="install">Install app</button>'
      : '<span class="small">In Chrome tap <b>⋮</b> (top right) → <b>Install app</b> or <b>Add to Home screen</b>. It then opens full-screen and works offline.</span>'}</div>`;
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
    migrate();
    if (S.settings.pinHash) U.lock = { mode: 'unlock', pin: '', msg: '' };
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (err) {
    $('#app').innerHTML = `<div class="boot">Storage is not available: ${esc(err.message)}</div>`;
    return;
  }
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // Check for a new version every time the app opens; reload once when it takes over.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded && !U.sheet && !U.dialog) { reloaded = true; location.reload(); }
    });
  }
})();
