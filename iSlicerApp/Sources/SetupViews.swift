import SwiftUI
import VisionKit

/// The three setup steps, ticked off as they are done.
struct SetupGuide: View {
    @Environment(AppModel.self) private var model
    var onPair: (() -> Void)?
    var onAddPrinter: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Get set up")
                .font(.title3.bold())
            step(1, done: model.canReachBridge, title: "Install iSlicer Bridge on your home computer",
                 detail: "A Mac or Ubuntu computer that stays on, on the same network as your printer. Run the one-line installer (see Settings). It ends by showing a QR code.")
            step(2, done: model.canReachBridge, title: "Pair this phone",
                 detail: "Scan the QR code the installer showed. To see it again, open http://(your computer):8005/pair on a device on your home Wi-Fi.",
                 action: model.canReachBridge ? nil : ("Scan the code", onPair))
            step(3, done: !model.printers.isEmpty, title: "Add your Bambu printer",
                 detail: "iSlicer finds the printer on your network. You only type its 8-character Access Code, shown on the printer's screen.",
                 action: model.canReachBridge && model.printers.isEmpty ? ("Add printer", onAddPrinter) : nil)
            Divider()
            Label("Treat the pairing code like a password. Anyone who has it can print on your printer.", systemImage: "key.fill")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func step(_ number: Int, done: Bool, title: String, detail: String,
                      action: (String, (() -> Void)?)? = nil) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(done ? Color.accentColor : Color(.tertiarySystemFill))
                if done {
                    Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.black)
                } else {
                    Text("\(number)").font(.footnote.bold())
                }
            }
            .frame(width: 26, height: 26)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(done ? .secondary : .primary)
                if !done {
                    Text(detail).font(.footnote).foregroundStyle(.secondary)
                    if let action, let run = action.1 {
                        Button(action.0, action: run)
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                            .padding(.top, 4)
                    }
                }
            }
        }
    }
}

/// One-time pairing with the home computer: scan its QR code, or type the code.
struct PairingCard: View {
    @Environment(AppModel.self) private var model
    @State private var typed = ""
    @State private var busy = false
    @State private var message: String?
    @State private var scanning = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                statusDot
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.semibold))
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer()
                if model.isPaired {
                    Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                        .buttonStyle(.borderless)
                }
            }
            if let message {
                Text(message).font(.footnote).foregroundStyle(.red)
            }
            if !model.isPaired {
                Button {
                    if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                        scanning = true
                    } else {
                        message = "The camera scanner is not available here. Type the code instead."
                    }
                } label: {
                    Label(busy ? "Pairing…" : "Scan pairing code", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(busy)

                HStack {
                    TextField("XXXX-XXXX-XXXX", text: $typed)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                        .onChange(of: typed) { _, value in
                            let formatted = Pairing.format(value)
                            if formatted != value { typed = formatted }
                        }
                        .onSubmit { submit(typed) }
                    Button("Pair") { submit(typed) }
                        .buttonStyle(.bordered)
                        .disabled(Pairing.code(from: typed) == nil || busy)
                }
            } else {
                Button("Unpair this phone", role: .destructive) { model.unpair() }
                    .font(.footnote)
            }
        }
        .sheet(isPresented: $scanning) {
            QRScanner { value in
                scanning = false
                submit(value)
            }
            .ignoresSafeArea()
            .overlay(alignment: .bottom) {
                Text("Point at the code on your home computer")
                    .font(.headline)
                    .padding(12)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 40)
            }
        }
    }

    private func submit(_ input: String) {
        guard !busy, Pairing.code(from: input) != nil else { return }
        busy = true
        message = nil
        Task {
            do {
                try await model.pair(input)
                typed = ""
            } catch {
                message = error.localizedDescription
            }
            busy = false
        }
    }

    private var title: String {
        switch model.connection {
        case .online: return "Connected to your home computer"
        case .offline: return "Home computer not reachable"
        case .checking: return "Checking…"
        case .unpaired: return "Pair with your home computer"
        }
    }

    private var subtitle: String {
        switch model.connection {
        case let .online(text): return text
        case let .offline(reason): return reason
        case .checking: return "Looking for your home computer"
        case .unpaired: return "Scan the QR code shown by the bridge installer."
        }
    }

    @ViewBuilder private var statusDot: some View {
        switch model.connection {
        case .checking: ProgressView()
        case .online: Circle().fill(.green).frame(width: 12, height: 12)
        case .offline: Circle().fill(.red).frame(width: 12, height: 12)
        case .unpaired: Circle().fill(.gray).frame(width: 12, height: 12)
        }
    }
}

/// Live QR scanner (VisionKit). Calls back once with the first pairing code it sees.
struct QRScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])],
                                                qualityLevel: .balanced, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        private var done = false
        init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            for item in addedItems {
                if case let .barcode(barcode) = item, let text = barcode.payloadStringValue,
                   Pairing.code(from: text) != nil, !done {
                    done = true
                    dataScanner.stopScanning()
                    onCode(text)
                }
            }
        }
    }
}
