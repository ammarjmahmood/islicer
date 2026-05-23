iSlicer Bridge macOS test build

1. Install Node.js if needed: https://nodejs.org
2. Unzip this file.
3. Open Terminal in this folder.
4. Run:

   chmod +x ./iSlicerBridge
   ./iSlicerBridge

The first launch installs bridge dependencies in the included server folder.
The bridge listens on http://localhost:8005.

Add your Bambu printer on the bridge setup page:

   http://localhost:8005/setup

For anywhere access:

1. Install Tailscale on this Mac and your iPhone.
2. Run tailscale ip -4 on the Mac.
3. Paste http://100.x.x.x:8005 into iSlicer Settings on iPhone.

Printer LAN IPs and LAN access codes are stored on this bridge, not in the
iPhone app. If this Mac leaves home, it can only print to a home printer when
it has a VPN or subnet route back to the home LAN.

This command-line package is for early testing. The public Mac build should be
shipped as a signed and notarized .app before broad distribution.
