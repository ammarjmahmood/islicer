# iSlicer

Mobile 3D slicer for Bambu Lab printers. Slice STL/3MF files from your phone and send prints to your printer from anywhere — home, work, or the TTC.

## How It Works

```
Your Phone (anywhere)
    │
    │  Tailscale VPN (free, encrypted)
    ▼
Your Server (Jetson/Pi/Mac/Linux — always on)
    │
    │  CuraEngine slices the model
    │  Returns G-code
    ▼
Your Phone
    │
    │  Bambu Cloud API
    ▼
Your Printer (at home, starts printing)
```

**No cloud hosting fees. No subscriptions. Runs on hardware you already own.**

## Quick Start

### 1. Set up the slicer server (one command)

SSH into your always-on machine (Jetson, Raspberry Pi, Mac Mini, any Linux box) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/ammarjmahmood/islicer/main/server/install.sh | bash
```

This installs everything: Node.js, CuraEngine, and sets up a background service that starts on boot.

**Or clone manually:**

```bash
git clone https://github.com/ammarjmahmood/islicer.git
cd islicer/server
npm install
node index.js
```

### 2. Set up Tailscale (free remote access)

Tailscale creates a secure VPN between your phone and server. Works over WiFi, cellular, anywhere.

**On your server:**
```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Connect to your account
sudo tailscale up

# Get your server's Tailscale IP (you'll need this)
tailscale ip -4
```

**On your iPhone:**
1. Download [Tailscale from the App Store](https://apps.apple.com/app/tailscale/id1470499037)
2. Sign in with the **same account** you used on the server

That's it. Your phone can now reach your server from anywhere in the world.

### 3. Install the iOS app

```bash
git clone https://github.com/ammarjmahmood/islicer.git
cd islicer
npm install
npx expo start
```

Scan the QR code with Expo Go, or build with `npx expo run:ios`.

### 4. Connect the app to your server

1. Open iSlicer on your phone
2. Go to **Settings**
3. Select **Tailscale** mode
4. Enter the Tailscale IP from step 2 (e.g. `100.89.54.6`)
5. Tap **Test** — should show "Server connected"

### 5. Add your Bambu printer

1. Go to the **Printers** tab
2. Tap **Add Printer**
3. Enter your printer's details (name, serial number, access code)
4. Log in with your Bambu Lab account for cloud printing

## Server Installation by Platform

### Jetson Orin / Nano

```bash
curl -fsSL https://raw.githubusercontent.com/ammarjmahmood/islicer/main/server/install.sh | bash
```

The install script auto-detects ARM64 and installs the correct Node.js build. CuraEngine installs via `apt`. The server runs as a systemd service — starts on boot, restarts on crash.

### Raspberry Pi (3/4/5)

```bash
curl -fsSL https://raw.githubusercontent.com/ammarjmahmood/islicer/main/server/install.sh | bash
```

Same one-liner. Works on Raspberry Pi OS (32-bit and 64-bit).

### Mac Mini / MacBook (always on)

**Option A: One-liner (requires Node.js)**
```bash
curl -fsSL https://raw.githubusercontent.com/ammarjmahmood/islicer/main/server/install.sh | bash
```

**Option B: macOS menu bar app (self-contained)**

Download `BambuSlicerServer.app` from the releases page — includes bundled Node.js. Double-click to run, shows in menu bar. No install needed.

### Linux (Ubuntu/Debian)

```bash
curl -fsSL https://raw.githubusercontent.com/ammarjmahmood/islicer/main/server/install.sh | bash
```

### Docker

```bash
docker run -d --name islicer -p 4000:4000 --restart unless-stopped \
  $(docker build -q server/)
```

Or with Docker Compose:

```yaml
services:
  islicer:
    build: ./server
    ports:
      - "4000:4000"
    restart: unless-stopped
```

## Server Management

After install, the server runs as a systemd service:

```bash
# Check status
sudo systemctl status bambu-slicer

# View logs
journalctl -u bambu-slicer -f

# Restart
sudo systemctl restart bambu-slicer

# Stop
sudo systemctl stop bambu-slicer

# Disable auto-start
sudo systemctl disable bambu-slicer
```

## Connection Modes

| Mode | When to use | Setup |
|------|------------|-------|
| **Tailscale** | You're away from home (cellular, other WiFi) | Install Tailscale on server + phone, enter server's Tailscale IP |
| **Local** | You're on the same WiFi as the server | Automatic — uses `localhost:4000` |
| **Custom URL** | Cloud-hosted server or custom setup | Enter the full URL in Settings |

## Printing: Local vs Cloud

| Method | When it works | Setup |
|--------|--------------|-------|
| **Bambu Cloud** | Anywhere (home, work, TTC) | Log in with your Bambu Lab account in the app |
| **Local Network** | Same WiFi as printer only | Enter printer's local IP and access code |

The app tries Bambu Cloud first (works anywhere), then falls back to local.

## Supported Hardware

### Printers
- Bambu Lab P1S
- Bambu Lab P1P
- Bambu Lab X1C / X1
- Bambu Lab A1 / A1 Mini

### File Formats
- STL
- 3MF

### Server Platforms
- NVIDIA Jetson (Orin, Nano)
- Raspberry Pi (3, 4, 5)
- macOS (Apple Silicon + Intel)
- Ubuntu / Debian Linux
- Any system with Node.js 18+

## API

The slicer server exposes a simple REST API:

```
GET  /health              — Server status
POST /slice               — Upload model + settings, start slicing
GET  /status/:jobId       — Check slice job progress
GET  /gcode/:jobId.gcode  — Download generated G-code
```

## Architecture

```
┌─────────────────────────────────────┐
│  iOS App (React Native / Expo)      │
│                                     │
│  ┌─────────┐  ┌──────────────────┐  │
│  │  Files   │  │  Slice Settings  │  │
│  │  Screen  │  │  Screen          │  │
│  └────┬─────┘  └───────┬──────────┘  │
│       │                │             │
│       ▼                ▼             │
│  ┌──────────────────────────────┐   │
│  │  Slicer Service              │   │
│  │  (resolves server URL,       │   │
│  │   uploads model, polls job)  │   │
│  └──────────────┬───────────────┘   │
│                 │                    │
│  ┌──────────────┴───────────────┐   │
│  │  Bambu Service               │   │
│  │  (cloud login, send print,   │   │
│  │   printer status)            │   │
│  └──────────────────────────────┘   │
└─────────────────┬───────────────────┘
                  │
    ┌─────────────┼──────────────┐
    │ Tailscale   │ Bambu Cloud  │
    ▼             ▼              │
┌────────────┐  ┌──────────┐    │
│ Your Server │  │ Bambu    │    │
│ (Jetson/Pi/ │  │ Cloud    │    │
│  Mac/Linux) │  │ API      │    │
│             │  └────┬─────┘    │
│ CuraEngine  │       │          │
│ slices the  │       ▼          │
│ model       │  ┌──────────┐   │
└─────────────┘  │ Your     │   │
                 │ Printer  │   │
                 └──────────┘   │
```

## License

MIT
