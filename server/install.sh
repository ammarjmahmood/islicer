#!/bin/bash
set -e

# BambuSlicer Bridge — One-command install
# Usage: curl -fsSL https://raw.githubusercontent.com/ammarjmahmood/islicer/main/server/install.sh | bash

INSTALL_DIR="$HOME/bambu-slicer-server"
SERVICE_NAME="bambu-slicer"
PORT=8005

echo "================================================"
echo "  BambuSlicer Bridge Installer"
echo "================================================"
echo ""

# Check for Node.js
if ! command -v node &>/dev/null; then
    echo "[!] Node.js not found. Installing..."
    if command -v apt-get &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v brew &>/dev/null; then
        brew install node
    else
        echo "ERROR: Can't install Node.js automatically."
        echo "Install it from https://nodejs.org and re-run this script."
        exit 1
    fi
fi
echo "[✓] Node.js $(node --version)"

# Install CuraEngine. The bridge refuses to fake a slice; if CuraEngine or
# its printer definitions are missing, /health will explain what to install.
if ! command -v CuraEngine &>/dev/null; then
    echo "[!] CuraEngine not found. Installing..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get update
        sudo apt-get install -y curaengine 2>/dev/null || echo "[!] CuraEngine not in apt — install Cura or set CURA_ENGINE_PATH manually"
    elif command -v brew &>/dev/null; then
        brew install curaengine 2>/dev/null || echo "[!] CuraEngine not in brew — install Cura or set CURA_ENGINE_PATH manually"
    fi
fi
if command -v CuraEngine &>/dev/null; then
    echo "[✓] CuraEngine installed"
else
    echo "[!] CuraEngine not available — install it before slicing"
fi

# Check for Tailscale
TAILSCALE_IP=""
if command -v tailscale &>/dev/null; then
    TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || true)
    if [ -n "$TAILSCALE_IP" ]; then
        echo "[✓] Tailscale IP: $TAILSCALE_IP"
    else
        echo "[!] Tailscale installed but not connected. Run: sudo tailscale up"
    fi
else
    echo "[!] Tailscale not installed."
    echo "    Install it for remote access: https://tailscale.com/download"
    echo "    Without Tailscale, the server only works on your local network."
fi

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
    echo "[*] Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull 2>/dev/null || true
else
    echo "[*] Downloading BambuSlicer Bridge..."
    # If running from curl pipe, clone the repo
    if [ -d "$(dirname "$0")/package.json" ] 2>/dev/null; then
        # Running from local copy
        INSTALL_DIR="$(dirname "$0")"
    else
        git clone https://github.com/ammarjmahmood/islicer.git "$INSTALL_DIR" 2>/dev/null || {
            # Fallback: just create the directory and download server files
            mkdir -p "$INSTALL_DIR"
            cd "$INSTALL_DIR"
            cat > package.json << 'PKGJSON'
{
  "name": "bambu-slicer-server",
  "version": "2.0.0",
  "description": "Always-on BambuSlicer bridge",
  "main": "index.js",
  "scripts": { "start": "node index.js" },
  "dependencies": {
    "basic-ftp": "^6.0.1",
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "mqtt": "^5.15.1",
    "multer": "^1.4.5-lts.1",
    "uuid": "^9.0.0"
  }
}
PKGJSON
            echo "ERROR: Could not clone repo. Place server files in $INSTALL_DIR manually."
            exit 1
        }
        INSTALL_DIR="$INSTALL_DIR/server"
    fi
fi

cd "$INSTALL_DIR"

# Install dependencies
echo "[*] Installing dependencies..."
npm install --production --silent

# Create systemd service (Linux)
if command -v systemctl &>/dev/null; then
    echo "[*] Setting up systemd service..."
    sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null << EOF
[Unit]
Description=BambuSlicer Bridge
After=network.target tailscaled.service
Wants=tailscaled.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) index.js
Restart=always
RestartSec=5
Environment=PORT=$PORT
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable ${SERVICE_NAME}
    sudo systemctl restart ${SERVICE_NAME}

    echo "[✓] Service installed and started"
    echo ""
    sleep 2
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        echo "================================================"
        echo "  BambuSlicer Bridge is RUNNING"
        echo "================================================"
        echo ""
        echo "  Local:     http://localhost:$PORT"
        LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
        [ -n "$LOCAL_IP" ] && echo "  Network:   http://$LOCAL_IP:$PORT"
        [ -n "$TAILSCALE_IP" ] && echo "  Tailscale: http://$TAILSCALE_IP:$PORT"
        echo ""
        echo "  Add printers on this bridge:"
        echo "    http://localhost:$PORT/setup"
        [ -n "$TAILSCALE_IP" ] && echo "    http://$TAILSCALE_IP:$PORT/setup"
        echo ""
        echo "  In the BambuSlicer iOS app, go to Settings"
        echo "  and enter the Tailscale URL above."
        echo ""
        echo "  Commands:"
        echo "    sudo systemctl status $SERVICE_NAME"
        echo "    sudo systemctl stop $SERVICE_NAME"
        echo "    sudo systemctl restart $SERVICE_NAME"
        echo "    journalctl -u $SERVICE_NAME -f"
        echo ""
    else
        echo "[!] Service failed to start. Check: journalctl -u $SERVICE_NAME"
    fi
else
    # No systemd (macOS or older Linux) — just run it
    echo ""
    echo "================================================"
    echo "  BambuSlicer Bridge installed"
    echo "================================================"
    echo ""
    echo "  Start with: cd $INSTALL_DIR && node index.js"
    echo "  Add printers at: http://localhost:$PORT/setup"
    echo ""
    [ -n "$TAILSCALE_IP" ] && echo "  Tailscale URL: http://$TAILSCALE_IP:$PORT"
    echo ""
fi
