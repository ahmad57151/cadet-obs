# Cadet Obs

Offline phone app (PWA) for an instructor to record cadet observations and punishments, class-wise.

- All data is stored **only on the phone** (IndexedDB). Nothing is sent to any server.
- This repository holds app code only. **Never commit cadet lists or backups here** (`.gitignore` blocks .xlsx/.csv).
- Install: open the GitHub Pages link in Chrome on Android → ⋮ → *Add to Home screen*.

## Import format (Excel or CSV)
Create a class first (Subject + Course + Gp), open it and tap **Import list**.
Sheet `Cadets`: `GC No | Name | Pl` required; `Appt`, `Course`, `Gp` optional.
If Course/Gp are present, only rows for that class are taken. Drag-filled Course columns are refused.
Optional sheet `Comds`: `Role | Pl / Course | Rank | Name | Unit | Phone`.
Cadets are matched by GC No; re-importing updates, never deletes records.

## Stages
- [x] Stage 1 — import with preview, classes, record (cadet first / batch), undo, history & edit, pending list
- [x] Stage 2 (part) — add/edit single cadet & Comd in app, create class without import
- [x] Stage 3 — reports, Excel export, backup & restore, PIN lock, erase
- [ ] Later — sitrep generator
