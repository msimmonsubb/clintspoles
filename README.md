# Pole measurement app

A phone-friendly site for measuring utility poles in the field, for any number of
projects. Each project has phases (sub-phases), and each phase has its own pole list
uploaded from a spreadsheet. The tech opens a phase, sees its poles on a map, taps a
pole, enters the attachment heights, and the office sees progress and his location live.

## Files

| File | What it is |
|------|------------|
| `index.html` | The field app: project picker, map, pole card, Info table, export |
| `manage.html` | Admin page: upload spreadsheets, create / rename / move / delete projects and phases |
| `server.js` | Node server, no dependencies. Stores everything under `data/` |
| `ubb-logo.png` | Logo shown in the header |
| `data.js` | The original West Mountain Phase 6 poles. Only used once, to seed a fresh server |
| `start-tunnel.*` | Optional helpers for a free Cloudflare quick tunnel (not needed behind Caddy) |

Nothing in `data/` is committed. Back that folder up.

## Running it behind Caddy

1. Install Node.js (any current version).
2. `git clone https://github.com/msimmonsubb/clintspoles.git` and `cd clintspoles`.
3. Run `node server.js` (port 8080 by default, `PORT=3000 node server.js` to change).
   Keep it running with whatever you use for your other services (NSSM or Task Scheduler
   on Windows, systemd on Linux, or a `pm2 start server.js`).
4. Reverse proxy it in Caddy. The field app should stay open for the tech's phone, and the
   manage page plus the admin API should sit behind basic auth:

   ```
   poles.simmonssurplus.com {
       @admin path /manage.html /api/admin/*
       basic_auth @admin {
           mike $2a$14$...bcrypt-hash-from-caddy-hash-password...
       }
       reverse_proxy localhost:8080
   }
   ```

   Generate the hash with `caddy hash-password`. Everything the phone uses (`/`, `/api/projects`,
   `/api/phases/...`, `/api/location...`) stays open, so the tech never sees a login.

5. Open `https://poles.simmonssurplus.com/manage.html` to add projects.

On first start with an empty `data/` folder the server imports `data.js` as project
**West Mountain**, phase **Phase 6**. If an old `data/edits.json` from the single-phase
version exists it is imported too and renamed `edits.json.migrated`.

To update after a change on GitHub: stop the server, `git pull`, start it again.

## Manage page

- **Add project** creates an empty project. **Add phase from spreadsheet** (per project, or the
  button at the bottom which can also create the project) opens the import dialog.
- **Import dialog**: pick the file (.xlsx, .xls or .csv), and if the workbook has several sheets
  pick the sheet. The header row is found automatically and columns are matched to the app's
  fields by name; fix any that are wrong. Coordinates can be one "lat, lng" column or separate
  latitude and longitude columns. The preview shows the first rows and how many rows will be
  skipped for missing coordinates. Only the pole number column is required.
- Per phase: **Open** (field app), **Export CSV**, **Rename**, **Move** to another project,
  **Replace poles** (upload a new list; measurements saved in the app are kept for poles whose
  pole number is unique in both the old and the new list), **Delete**.
- Delete buttons ask once more before doing anything.

## Field app

- The first screen lists projects and phases with progress. The phone remembers the last
  phase opened and goes straight back to it. Tapping the phase name in the header returns
  to the list.
- **Map** shows every pole: white to do, orange measured, red flagged for replacement. Zoom in
  for pole numbers. Satellite view helps spot the actual pole. The pin button jumps to the
  nearest unmeasured pole, the crosshair centres on the phone.
- Tap a pole to open its card: feet and inches for Power, CATV, Phone, Other, Road crossing
  and Proposed attachment (each with N/A), Suggest replace, Material, Section, pole number,
  address, and a button to replace the coordinates with the phone's GPS position.
- **Save pole** stores it on the phone and sends it to the server. The header shows *Synced*,
  or *N waiting to sync* when there is no signal; it retries automatically. The phase's pole
  list is cached on the phone so the map still works without signal.
- **Info** shows the full sheet with search and To do / Measured filters. **Export sheet**
  downloads an .xlsx in the original column layout.

## Live location

When the tech allows location on his phone, his position is sent to the server every few
seconds while the page is open, and everyone else sees a blue dot labelled with `TECH_NAME`
(near the top of the script in `index.html`, currently "Clint"). Tapping the dot shows his
trail for today. Positions older than 2 hours are not shown. Every device that allows
location on the site reports under the same label, so deny the location prompt on office
computers. To wipe remembered positions:

```
curl -X DELETE http://localhost:8080/api/locations
```

Phones stop sending GPS from a browser tab once the screen locks or another app is in
front; the page asks the phone to keep the screen awake to help with that.

## Data layout

```
data/
  projects.json            projects and phases
  phases/<id>.json         one file per phase: seed rows from the sheet + saved edits
  locations.json           last position per label
  track-YYYY-MM-DD.jsonl   one line per position report
```

## Notes on the original spreadsheet

Material values were normalised (`steel` → `Steel`, `null` → blank), `N/a` became `N/A`, one
crossing height written as `23" 5'` was read as `23' 5"`, pole numbers 5064 and 5619 appear
twice, and six rows are just `RMP`. Duplicates are kept as separate poles.
