# Cadet Obs

Offline phone app (PWA) for an instructor to record cadet observations and punishments, class-wise.

- All data is stored **only on the phone** (IndexedDB). Nothing is sent to any server.
- This repository holds app code only. **Never commit cadet lists or backups here** (`.gitignore` blocks .xlsx/.csv).
- Install: open the GitHub Pages link in Chrome on Android → ⋮ → *Add to Home screen*.

## Import format (Excel or CSV)
Sheet `Cadets`: `GC No | Name | Pl | Appt | Course | Gp` (Appt optional; Gp = A or B).
Optional sheet `Comds`: `Role | Pl / Course | Rank | Name | Unit | Phone`.
Import one course or several at a time; cadets are matched by GC No.

## Stages
- [x] Stage 1 — import with preview, classes, record (cadet first / batch), undo, history & edit, pending list
- [ ] Stage 2 — add/edit single cadet & Comd in app
- [ ] Stage 3 — reports, Excel export, backup & restore, PIN lock
- [ ] Later — sitrep generator
