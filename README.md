# iSlicer Bridge

Slice STL and 3MF files from an iPhone, run the heavy slicing work on an always-on Mac or Ubuntu machine, and send the result to a Bambu Lab printer from anywhere.

Live setup site: https://islicer-amarsbars-projects.vercel.app

## Architecture

```
iPhone app
  imports STL / 3MF
  connects to bridge over Tailscale, LAN, or a custom URL
        |
        v
Mac / Ubuntu bridge
  stores printer LAN credentials
  serves the printer setup page
  slices with CuraEngine
  uploads G-code to printer with FTPS
  starts print with MQTT
        |
        v
Bambu printer
  P1S, P1P, X1C, X1, A1, A1 mini
```

The iPhone does not need the printer LAN IP and does not need to be on the same Wi-Fi as the printer. It only needs to reach the bridge. The bridge must be at home with the printer, or it must have a VPN/subnet route back to the printer LAN.

## What Changed In This Build

- The desktop service is now a real bridge API with `/health`, `/printers`, `/slice`, `/status/:jobId`, and `/print`.
- Printer access codes are stored on the bridge in `server/data/config.json`.
- The bridge now serves `/setup` for printer LAN setup, so the iPhone only stores the bridge URL.
- The mobile app syncs bridge printers and sends print requests back to the bridge.
- Unsupported direct Bambu Cloud upload assumptions were removed from the app.
- The server no longer creates placeholder G-code. If CuraEngine or its definitions are missing, slicing fails clearly.
- A static website lives in `website/` with installation steps and a product demo reel.

## Quick Start For Normal People

### 1. Download or install the bridge app

Use the website download, or paste this one command on the Ubuntu/Mac computer that stays on near the printer:

```bash
curl -fsSL https://raw.githubusercontent.com/ammarjmahmood/islicer/main/server/install.sh | bash
```

The bridge listens on port `8005`. The installer prints the setup URL for the computer and the exact bridge URL to paste into the iPhone app.

### 2. Sign into Tailscale

```bash
sudo tailscale up
tailscale ip -4
```

In the iPhone app, open Settings, choose Tailscale, paste the `100.x.x.x` IP, and tap Test. The final URL will look like:

```text
http://100.x.x.x:8005
```

Tailscale does not require a special iOS cellular app port. The bridge app uses TCP `8005`; Tailscale itself may use UDP `41641` for direct peer-to-peer tunnels when available.

### 3. Add your printer once on the bridge

Open the bridge setup page on the computer that can reach the printer:

```text
http://localhost:8005/setup
```

Or use the Tailscale/ LAN URL printed by the installer:

```text
http://100.x.x.x:8005/setup
```

Enter:

- Name
- Local printer IP
- Serial number
- Model
- LAN access code

The printer credentials stay on the bridge computer. The iPhone app does not ask for the printer IP or LAN access code.

### 4. Print from anywhere

Open Files, import or download an STL/3MF, slice it, and tap Send to Printer. The phone sends the model to the bridge; the bridge slices and talks to the printer.

## Build The iOS App

For simulator/device development:

```bash
npm install
npx expo run:ios
```

For archive deployment:

```bash
open ios/BambuSlicer.xcworkspace
```

In Xcode, select a signing team, choose a real device or generic iOS device, then Product -> Archive. Distribute through TestFlight, Ad Hoc, or your Apple Developer workflow.

App Store upload requires Apple Developer signing and App Store Connect credentials. This repo can build the app, but it cannot publish to the App Store without those credentials.

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
GET    /printers
GET    /setup
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
