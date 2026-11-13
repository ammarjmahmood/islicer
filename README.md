# iSlicer

Slice STL and 3MF files from an iPhone and send them to a Bambu Lab printer from anywhere.
The heavy work runs on an always-on computer at home (Ubuntu or a Mac), using the real
Bambu Studio engine and Bambu's own printer and filament profiles.

Setup is three steps, done once:

1. **On the home computer** run one command. It installs everything and prints a QR code.
2. **On the iPhone** open iSlicer and scan the code (or type it).
3. **Add your printer** in the app (Printers → Add Printer). It shows where to find the IP
   address, Access Code and serial number on the printer's screen.

No accounts, no VPN, no router changes.

## How it works

```
iPhone app ──https──▶ Cloudflare quick tunnel ──▶ bridge at home ──LAN──▶ Bambu printer
     │                                              ▲
     └── pairing code ──▶ drop box (ntfy) ◀── encrypted current address
```

- **Pairing code.** The bridge makes one 12-character code. Both sides derive three things
  from it: where the bridge leaves its address, the key to decrypt that address, and the
  access token the phone sends with every request.
- **Remote access.** The bridge opens an outbound Cloudflare quick tunnel, so nothing has to be
  opened on the router. The tunnel's address changes when it restarts, so the bridge posts the
  current one, AES-256-GCM encrypted, to a public drop box (an [ntfy](https://ntfy.sh) topic).
  The phone reads it, decrypts it, and reconnects by itself.
- **Slicing.** Bambu Studio in command-line mode. The bridge flattens Bambu's profile
  inheritance first (`server/bambu-slicer.js`); the command line does not, and without that it
  silently produces generic start/end G-code. Output is a `.gcode.3mf`.
- **Printing.** The bridge uploads the `.gcode.3mf` over FTPS and starts it over MQTT, on the LAN.
- **Privacy.** Printer IP and access code never leave the bridge. Setup and pairing pages only
  answer on the home network, never through the tunnel.

### Things to know

- Free third-party services carry the remote link: Cloudflare quick tunnels (no uptime promise)
  and ntfy.sh. Cloudflare can see traffic in transit (it terminates TLS). To use your own fixed
  address instead, set `ISLICER_PUBLIC_URL`; to use your own ntfy server set `ISLICER_RENDEZVOUS`
  on the bridge and change `RENDEZVOUS` in `src/services/pairing.ts`.
- Anyone with the pairing code can print on your printer. Treat it like a password.
- Recent Bambu firmware only accepts third-party LAN control with **LAN Only Mode** and
  **Developer Mode** turned on at the printer.
- Printing has not been verified end to end on real hardware in this build; slicing and the
  remote link have.

## Quick start

On the computer that stays on at home, on the same network as the printer:

```bash
curl -fsSL https://raw.githubusercontent.com/ammarjmahmood/islicer/main/server/install.sh | bash
```

It installs Node.js, cloudflared and Bambu Studio, sets up a service that starts at boot, and
prints the pairing QR code. Then:

- Add the printer in the app, or at `http://<computer>:8005/setup` from the home network.
- Show the pairing code again: `http://<computer>:8005/pair`.
- Logs: `journalctl -u islicer-bridge -f`.

Bridge settings (environment variables): `PORT`, `ISLICER_REMOTE=off` (home network only),
`ISLICER_PUBLIC_URL`, `ISLICER_RENDEZVOUS`, `BAMBU_STUDIO_PATH` + `BAMBU_PROFILES_DIR`, `CLOUDFLARED_PATH`.
If Bambu Studio is missing the bridge falls back to CuraEngine with generic profiles.

## The iPhone app

A native SwiftUI app in `iSlicerApp/` (iOS 17+). No third-party packages.

```bash
cd iSlicerApp
brew install xcodegen   # once
xcodegen                # regenerates iSlicer.xcodeproj from project.yml
open iSlicer.xcodeproj
```

| File | What it holds |
| --- | --- |
| `Sources/Pairing.swift` | Pairing code maths (CryptoKit), Keychain storage. Mirrors `server/remote.js`. |
| `Sources/Bridge.swift` | Finds the bridge and talks to it: health, printers, discovery, slice, print. |
| `Sources/AppModel.swift` | App state: connection, printers, imported models, recent slices. |
| `Sources/FilesView.swift` | Models list, import, "ready to print" list. |
| `Sources/SliceView.swift` | Slice settings, 3D preview of STL files, the print sheet. |
| `Sources/PrintersView.swift` | Printers, and Add Printer with automatic discovery. |
| `Sources/SetupViews.swift` | Setup checklist, pairing card, QR scanner. |
| `Sources/SettingsView.swift` | Pairing, install command, manual address. |

Adding a printer: the bridge listens for Bambu printers announcing themselves on the home
network (`server/discover.js`) and offers them in the app with name, model, IP and serial
number filled in. The person only types the 8-character Access Code from the printer's screen.

TestFlight: `xcodebuild -project iSlicer.xcodeproj -scheme iSlicer -configuration Release -destination 'generic/platform=iOS' -archivePath build/iSlicer.xcarchive -allowProvisioningUpdates archive`,
then export with `ExportOptions.plist`. The icon comes from `scripts/make_icon.py`.

## Build The macOS Bridge App

The Swift package in `server-app/` starts the Node bridge from a macOS menu-bar app.

```bash
cd server-app
swift build
swift run
```

For a distributable `.app`, create an Xcode project from the package or archive through Xcode. Bundle the `server/` directory and Node runtime in `Contents/Resources` for a self-contained app.

## Ubuntu Service

The installer creates a `systemd` service when `systemctl` is available:

```bash
sudo systemctl status bambu-slicer
sudo systemctl restart bambu-slicer
journalctl -u bambu-slicer -f
```

## Docker

```bash
docker build -t islicer-bridge ./server
docker run -d --name islicer -p 8005:8005 --restart unless-stopped islicer-bridge
```

## Website

Open the static file directly:

```bash
open website/index.html
```

Or run the tiny local server:

```bash
npm run website:serve
```

The site is plain HTML/CSS/JS and can be hosted on GitHub Pages, Netlify, Vercel, or any static host.

## Bridge API

```text
GET    /health
GET    /pair            (home network only)
GET    /pair/terminal   (home network only)
GET    /printers
GET    /discover
GET    /setup           (home network only)
POST   /printers
DELETE /printers/:id
POST   /printers/:id/test
POST   /slice
GET    /status/:jobId
POST   /print
GET    /gcode/:jobId.gcode
```

## Remote Access Notes

Recommended path:

- Tailscale on bridge and iPhone.
- Bridge exposes `http://100.x.x.x:8005`.
- Printer remains private on the home LAN.
- Printer LAN details are entered at `http://localhost:8005/setup` on the bridge machine.

Laptop note:

- If the bridge MacBook is in a backpack, at work, or otherwise away from home, it cannot reach the home printer by magic. It needs a VPN path back home, such as a Tailscale subnet router on an always-on home device. The simpler setup is to run the bridge on a small always-on computer at home.

Also supported:

- Same-Wi-Fi LAN IP, such as `http://192.168.1.50:8005`.
- Custom URL through a reverse proxy or VPN DNS name.

Avoid forwarding the bridge directly to the public internet unless you add authentication and TLS.

## Current Limitations

- Real slicing depends on CuraEngine plus a valid Cura printer definition on the bridge.
- Bambu firmware behavior can vary by model and firmware version. The bridge uses the local FTPS + MQTT pattern, but hardware verification is still required on each printer family.
- Direct Bambu Cloud print submission is intentionally not used because it is not a stable public developer API surface.

## License

MIT
