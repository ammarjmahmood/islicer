#!/bin/bash
# iSlicer Bridge: one-command install for the always-on computer at home
# (Ubuntu / Debian, or a Mac). It sets up everything the phone needs:
#   - Node.js              runs the bridge
#   - Bambu Studio         does the slicing, with Bambu's own profiles
#   - cloudflared          makes the bridge reachable from anywhere, no router setup
#   - a background service so it starts with the computer
# Then it prints a QR code. Scan it in the iSlicer app and you are done.
#
# Usage:  curl -fsSL https://raw.githubusercontent.com/ammarjmahmood/islicer/main/server/install.sh | bash
# Or, from a copy of this repo:  bash server/install.sh
set -e

PORT="${PORT:-8005}"
SERVICE_NAME="islicer-bridge"
SHARE_DIR="$HOME/.local/share/islicer"
REPO_URL="https://github.com/ammarjmahmood/islicer.git"

say()  { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$1"; }

OS="$(uname -s)"
ARCH="$(uname -m)"
SUDO=""
[ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null && SUDO="sudo"

# ---- where the bridge code lives -------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/index.js" ] && [ -f "$SCRIPT_DIR/bambu-slicer.js" ]; then
    BRIDGE_DIR="$SCRIPT_DIR"                      # running from a copy of the repo
else
    say "Downloading iSlicer Bridge"
    command -v git >/dev/null || { [ "$OS" = Linux ] && $SUDO apt-get update -qq && $SUDO apt-get install -y -qq git; }
    if [ -d "$HOME/islicer/.git" ]; then
        git -C "$HOME/islicer" pull --ff-only || true
    else
        git clone --depth 1 "$REPO_URL" "$HOME/islicer"
    fi
    BRIDGE_DIR="$HOME/islicer/server"
fi

# ---- Node.js ---------------------------------------------------------------
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
    say "Installing Node.js"
    if [ "$OS" = Linux ]; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
        $SUDO apt-get install -y -qq nodejs
    elif command -v brew >/dev/null; then
        brew install node
    else
        echo "Install Node.js 20 or newer from https://nodejs.org, then run this again."; exit 1
    fi
fi
echo "Node.js $(node --version)"

# ---- cloudflared (remote access) ---------------------------------------------
if ! command -v cloudflared >/dev/null; then
    say "Installing cloudflared (lets your phone reach this computer from anywhere)"
    if [ "$OS" = Linux ]; then
        case "$ARCH" in x86_64) CF=amd64 ;; aarch64|arm64) CF=arm64 ;; *) CF="" ;; esac
        if [ -n "$CF" ]; then
            curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CF.deb"
            $SUDO dpkg -i /tmp/cloudflared.deb && rm -f /tmp/cloudflared.deb
        fi
    elif command -v brew >/dev/null; then
        brew install cloudflared
    fi
fi
command -v cloudflared >/dev/null && echo "cloudflared ready" || warn "cloudflared is missing: the phone will only work on your home Wi-Fi."

# ---- Bambu Studio (the slicer) -----------------------------------------------
if [ "$OS" = Linux ]; then
    if [ ! -x "$SHARE_DIR/bambustudio/AppRun" ]; then
        say "Installing Bambu Studio (about 250 MB)"
        if [ "$ARCH" != x86_64 ]; then
            warn "Bambu Studio only ships for 64-bit Intel/AMD Linux. On this computer ($ARCH) slicing will not work."
        else
            # A screenless computer still needs a virtual display and a few libraries for the slicer to start.
            $SUDO apt-get update -qq
            $SUDO apt-get install -y -qq xvfb curl squashfs-tools libgl1 libegl1 libgtk-3-0 libwebkit2gtk-4.1-0 libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 >/dev/null 2>&1 \
              || $SUDO apt-get install -y -qq xvfb curl squashfs-tools libgl1 libegl1 libgtk-3-0 >/dev/null 2>&1 || true
            UBU="ubu24"
            . /etc/os-release 2>/dev/null || true
            case "${VERSION_ID:-}" in 20.*|22.*|11|12) UBU="ubu22" ;; esac
            ASSET_URL="$(curl -fsSL https://api.github.com/repos/bambulab/BambuStudio/releases/latest \
              | grep -o '"browser_download_url": *"[^"]*'"$UBU"'[^"]*\.AppImage"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')"
            if [ -z "$ASSET_URL" ]; then
                warn "Could not find a Bambu Studio download for this system. Install Bambu Studio yourself and set BAMBU_STUDIO_PATH."
            else
                mkdir -p "$SHARE_DIR"
                curl -fL --progress-bar -o "$SHARE_DIR/BambuStudio.AppImage" "$ASSET_URL"
                chmod +x "$SHARE_DIR/BambuStudio.AppImage"
                # Unpack it, so it runs without FUSE and the bridge can read its printer profiles.
                # (The AppImage's own --appimage-extract fails on some systems; unsquashfs is reliable.)
                (
                    cd "$SHARE_DIR" && rm -rf squashfs-root bambustudio
                    OFFSET="$(./BambuStudio.AppImage --appimage-offset 2>/dev/null | tail -1)"
                    if unsquashfs -q -n -o "$OFFSET" -d bambustudio BambuStudio.AppImage >/dev/null 2>&1; then :
                    elif ./BambuStudio.AppImage --appimage-extract >/dev/null 2>&1; then mv squashfs-root bambustudio
                    fi
                    [ -x bambustudio/AppRun ] && rm -f BambuStudio.AppImage
                )
            fi
        fi
    fi
    [ -x "$SHARE_DIR/bambustudio/AppRun" ] && echo "Bambu Studio ready"
else
    [ -d "/Applications/BambuStudio.app" ] && echo "Bambu Studio ready" \
      || warn "Install Bambu Studio from https://bambulab.com/download/studio so the bridge can slice."
fi

# ---- the bridge itself ---------------------------------------------------------
say "Installing the bridge"
cd "$BRIDGE_DIR"
npm install --omit=dev --no-audit --no-fund --silent

if [ "$OS" = Linux ] && command -v systemctl >/dev/null; then
    $SUDO tee "/etc/systemd/system/$SERVICE_NAME.service" >/dev/null <<EOF
[Unit]
Description=iSlicer Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$BRIDGE_DIR
ExecStart=$(command -v node) index.js
Restart=always
RestartSec=5
Environment=PORT=$PORT
Environment=NODE_ENV=production
Environment=HOME=$HOME

[Install]
WantedBy=multi-user.target
EOF
    $SUDO systemctl daemon-reload
    $SUDO systemctl enable -q "$SERVICE_NAME"
    $SUDO systemctl restart "$SERVICE_NAME"
    STARTED="service"
else
    # macOS, or Linux without systemd: run it in the background for now.
    (PORT="$PORT" nohup node index.js >"$BRIDGE_DIR/bridge.log" 2>&1 &)
    STARTED="background"
fi

# ---- show the pairing code -----------------------------------------------------
for _ in $(seq 1 20); do
    curl -fsS "http://localhost:$PORT/pair/terminal" >/tmp/islicer-pair.txt 2>/dev/null && break
    sleep 1
done

say "iSlicer Bridge is running"
if [ -s /tmp/islicer-pair.txt ]; then
    echo "Open the iSlicer app on your iPhone and scan this code:"
    echo
    cat /tmp/islicer-pair.txt
    rm -f /tmp/islicer-pair.txt
else
    warn "The bridge did not answer yet. Check: journalctl -u $SERVICE_NAME -n 30"
fi
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Next, add your printer (from this computer or any device on your home Wi-Fi):"
echo "    http://${LAN_IP:-localhost}:$PORT/setup"
echo "Show the pairing code again any time:"
echo "    http://${LAN_IP:-localhost}:$PORT/pair"
if [ "$STARTED" = service ]; then
    echo
    echo "It starts by itself when this computer boots. Logs: journalctl -u $SERVICE_NAME -f"
fi
