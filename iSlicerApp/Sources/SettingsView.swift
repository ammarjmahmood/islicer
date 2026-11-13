import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var manual = Bridge.shared.manualAddress
    @State private var copied = false
    @State private var addingPrinter = false

    private let installCommand = "curl -fsSL https://raw.githubusercontent.com/ammarjmahmood/islicer/main/server/install.sh | bash"

    var body: some View {
        NavigationStack {
            Form {
                if !model.isSetUp {
                    SetupGuide(onPair: nil, onAddPrinter: { addingPrinter = true })
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                Section("Your home computer") {
                    PairingCard()
                }

                Section {
                    Text(installCommand)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                    Button(copied ? "Copied" : "Copy command") {
                        UIPasteboard.general.string = installCommand
                        copied = true
                    }
                } header: {
                    Text("Install the bridge")
                } footer: {
                    Text("Run this in Terminal on the Mac or Ubuntu computer that stays on at home, on the same network as your printer. It installs everything and ends by showing the QR code to scan above.")
                }

                Section {
                    DisclosureGroup("Manual bridge address") {
                        TextField("http://100.x.x.x:8005", text: $manual)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                        Button("Save") {
                            Bridge.shared.manualAddress = manual
                            Task { await model.refresh() }
                        }
                    }
                } footer: {
                    Text("Only for setups without a pairing code, such as Tailscale or your own domain.")
                }

                Section("About") {
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")
                    LabeledContent("Printers", value: "P1S, P1P, X1C, X1, A1, A1 mini")
                    LabeledContent("Files", value: "STL, 3MF")
                    Text("iSlicer is an independent app. It is not made or endorsed by Bambu Lab.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $addingPrinter) { AddPrinterView() }
        }
    }
}
