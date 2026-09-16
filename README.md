# West Mountain Phase 6 – pole measurement site

A phone-friendly site for measuring poles in the field. It shows every pole from
`WEST MOUNTAIN PHASE 6 POLE MEASUREMENTS.xlsx` on a map, lets the tech tap a pole and
enter the heights, and shows the whole sheet in an Info view. No login.

## Files

| File | What it is |
|------|------------|
| `index.html` | The whole app (map, form, info table, export) |
| `data.js` | The 307 poles from the spreadsheet. Generated once; the app never changes it |
| `ubb-logo.png` | Logo shown in the header |
| `server.js` | Optional. Tiny Node server that saves measurements centrally |
| `data/edits.json` | Created by `server.js`. Every saved pole lives here |

## Two ways to host it

### Option A – with the server (recommended)

Everything the tech saves on the phone is sent to the server, so you can watch progress
from your own computer and download the finished sheet at any time.

1. Install Node.js (any current version) on the machine that will host it.
2. In this folder run:

   ```
   node server.js
   ```

3. It prints the address to open, for example `http://192.168.1.20:8080`.
   Open that on the phone (same Wi-Fi/VPN) or put it behind your normal reverse proxy /
   HTTPS if you want to reach it over the internet.

   The phone's GPS features ("Show my location", "Nearest pole", "Use my GPS position")
   need HTTPS unless the address is `localhost`. Browsers block geolocation on plain
   `http://` addresses, so for real field use put it behind HTTPS (Cloudflare Tunnel,
   Caddy, nginx + Let's Encrypt, etc.). Everything else works over plain http.

4. Get the data back:
   - Open the site, go to **Info**, tap **Export sheet** (downloads an .xlsx), or
   - `http://<host>:8080/api/export.csv` for a CSV, or
   - copy `data/edits.json` (raw saved edits).

To change the port: `PORT=3000 node server.js` (PowerShell: `$env:PORT=3000; node server.js`).

### Option B – static hosting only

Copy `index.html`, `data.js` and `ubb-logo.png` to any static host (GitHub Pages,
Netlify, an S3 bucket, your existing web server). Everything still works, but
measurements are saved only in that phone's browser storage. The tech then uses
**Info → Export sheet** to download the .xlsx and send it to you. Clearing the browser
data on the phone would erase unsent measurements, so export regularly.

## Using it in the field

- **Map** shows every pole. White = still to do, orange = measured, red = flagged for replacement.
  Zoom in to see pole numbers. Satellite view helps spot the actual pole.
- The **pin button** jumps to the nearest pole that still needs measuring. The **crosshair** centres on you.
- Tap a pole to open its card. Type feet then inches for each attachment (the cursor
  jumps from feet to inches automatically). Tap **N/A** when there is no attachment.
- **Suggest replace**, **Material**, **Section**, pole number and address are editable too.
- **Use my GPS position** overwrites the pole's coordinates with the phone's location (asks first if accuracy is poor).
- **Save pole** stores it. The header shows *Synced* when the server has it, or
  *N waiting to sync* when the phone has no signal; it retries automatically.
- **Info** shows the full sheet. Search by pole number or street, filter To do / Measured,
  tap a row to edit it, **Export sheet** downloads the .xlsx in the original column layout.

## Regenerating data.js from a new spreadsheet

`data.js` was generated from the sheet named `ALL`. If you get a new version of the
workbook, regenerate it with the same column order (Pole #, Address, Power, CATV, Phone,
Other, Road crossing, Proposed, Suggest replace, Material, Coords, Section). Keep the
`id` values stable, because saved edits are keyed by `id`.

Notes on the seed data:
- Material values were normalised (`steel` → `Steel`; the single `null` became blank).
- One road-crossing entry written as `23" 5'` was read as `23' 5"`.
- `N/a` in the sheet is shown as `N/A`.
- Pole numbers 5064 and 5619 each appear twice in the sheet, and six rows are just `RMP`.
  They are kept as separate poles with their own coordinates.
