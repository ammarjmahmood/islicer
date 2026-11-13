// Finds Bambu printers on the home network. They announce themselves over SSDP
// (name, model, serial number, IP address). The Access Code is never announced:
// that still has to be read off the printer's screen.
const dgram = require('dgram');
const os = require('os');

const GROUP = '239.255.255.250';
const MODEL_CODES = {
  'BL-P001': 'X1C', 'BL-P002': 'X1', C13: 'X1C',
  C11: 'P1P', C12: 'P1S',
  N1: 'A1Mini', N2S: 'A1',
};

/** Every IPv4 address this computer has: Wi-Fi, Ethernet, and also VPN or Docker ones. */
function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) if (item.family === 'IPv4' && !item.internal) out.push(item.address);
  }
  return out;
}

function parse(text, fromAddress) {
  const fields = {};
  for (const line of String(text).split('\r\n')) {
    const at = line.indexOf(':');
    if (at > 0) fields[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  const serial = fields.usn || '';
  const code = fields['devmodel.bambu.com'];
  if (!code || !serial) return null;
  return {
    ip: fields.location || fromAddress,
    serialNumber: serial,
    name: fields['devname.bambu.com'] || 'Bambu printer',
    model: MODEL_CODES[code] || null,
    modelCode: code,
    lanOnly: fields['devconnect.bambu.com'] === 'lan',
  };
}

/** Listens for a few seconds and resolves to the printers heard. */
function discover(ms = 5000) {
  return new Promise((resolve) => {
    const found = new Map();
    const sockets = [];
    const onMessage = (message, remote) => {
      const printer = parse(message.toString('utf8'), remote.address);
      if (printer) found.set(printer.serialNumber, printer);
    };
    for (const port of [2021, 1990]) {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('error', () => {});
      socket.on('message', onMessage);
      socket.bind(port, () => {
        // Join on every interface: the default one is often not the home network.
        for (const address of localAddresses()) {
          try { socket.addMembership(GROUP, address); } catch {}
        }
      });
      sockets.push(socket);
    }
    // Printers also answer a direct question, which is quicker than waiting for the next announcement.
    const question = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1990\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: urn:bambulab-com:device:3dprinter:1\r\n\r\n');
    for (const address of localAddresses()) {
      const asker = dgram.createSocket('udp4');
      asker.on('error', () => {});
      asker.on('message', onMessage);
      asker.bind(0, address, () => {
        try { asker.setMulticastInterface(address); } catch {}
        for (const port of [1990, 2021]) asker.send(question, port, GROUP, () => {});
      });
      sockets.push(asker);
    }

    setTimeout(() => {
      for (const socket of sockets) { try { socket.close(); } catch {} }
      resolve([...found.values()]);
    }, ms);
  });
}

module.exports = { discover };
