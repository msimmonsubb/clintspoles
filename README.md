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

## Hosting on your own server with a free Cloudflare URL (recommended)

This gives you a public https address, no port forwarding, and every measurement and
the tech's live location saved on your machine.

1. Install Node.js (https://nodejs.org) and cloudflared:
   - Windows: `winget install Cloudflare.cloudflared`
   - Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. Get the files onto the server:

   ```
   git clone https://github.com/msimmonsubb/clintspoles.git
   cd clintspoles
   ```

3. Start everything:
   - Windows: `powershell -ExecutionPolicy Bypass -File .\start-tunnel.ps1`
   - Linux/macOS: `chmod +x start-tunnel.sh && ./start-tunnel.sh`

   It prints `Pole site is live at: https://xxxx-xxxx.trycloudflare.com` and saves the same
   address to `tunnel-url.txt`. Send that link to the tech.

4. Leave the window open. Closing it (or Ctrl+C) stops the site.

The free trycloudflare.com address is different every time the script starts, so restart
it as rarely as you can and re-send the link when you do. Cloudflare gives no uptime
promise on free quick tunnels. If you ever want a permanent address, add a domain to
Cloudflare and create a named tunnel instead; the site itself needs no changes.

To update the site after a change on GitHub: stop the script, run `git pull`, start it again.

### Live location

When the site is served by `server.js`, an extra antenna button appears on the map.
The tech taps it once, enters his name, and his position is sent to the server every
few seconds while the page is open. Everyone else looking at the map sees a blue dot
with his name and how long ago it was updated (grey after 5 minutes without an update).
Tapping the dot shows his trail for today. The same button switches sharing off, and
the choice is remembered on the phone.

Phones stop sending GPS from a browser tab once the screen locks or another app is in
front, so the dot updates while the page is up and pauses in between. While sharing is
on, the page asks the phone to keep the screen awake to help with that.

Location data is stored in `data/locations.json` (latest position per person) and
`data/track-YYYY-MM-DD.jsonl` (one line per report).

## Other ways to host it

### Option A – server on your local network only

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
