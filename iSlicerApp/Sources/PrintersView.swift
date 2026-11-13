import SwiftUI

struct PrintersView: View {
    @Environment(AppModel.self) private var model
    @State private var adding = false
    @State private var notice: String?
    @State private var testing: String?

    var body: some View {
        NavigationStack {
            List {
                if model.printers.isEmpty {
                    SetupGuide(onPair: nil, onAddPrinter: { adding = true })
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(model.printers) { printer in
                            Button { test(printer) } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "printer.fill")
                                        .font(.title3)
                                        .foregroundStyle(.tint)
                                        .frame(width: 36)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(printer.name).font(.body.weight(.semibold)).foregroundStyle(.primary)
                                        Text("Bambu Lab \(printer.modelLabel)").font(.footnote).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if testing == printer.id { ProgressView() } else {
                                        Text("Test").font(.footnote).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .swipeActions {
                                Button("Remove", role: .destructive) { remove(printer) }
                            }
                        }
                    } footer: {
                        Text("Printer details are kept on your home computer. Tap a printer to check that the computer can reach it.")
                    }
                }
            }
            .navigationTitle("Printers")
            .toolbar {
                if model.canReachBridge {
                    Button { adding = true } label: { Image(systemName: "plus") }
                }
            }
            .refreshable { await model.refresh() }
            .sheet(isPresented: $adding) {
                AddPrinterView()
            }
            .alert("Printer", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
                Button("OK") { notice = nil }
            } message: {
                Text(notice ?? "")
            }
        }
    }

    private func test(_ printer: Printer) {
        testing = printer.id
        Task {
            do {
                try await Bridge.shared.testPrinter(printer.id)
                notice = "Your home computer reached \(printer.name)."
            } catch {
                notice = "\(error.localizedDescription)\n\nCheck the printer is on. On newer firmware, turn on LAN Only Mode and Developer Mode on the printer."
            }
            testing = nil
        }
    }

    private func remove(_ printer: Printer) {
        Task {
            try? await Bridge.shared.removePrinter(printer.id)
            await model.refresh()
        }
    }
}

/// Add a Bambu printer. The bridge finds it on the home network; the person types the Access Code.
struct AddPrinterView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var found: [Bridge.FoundPrinter] = []
    @State private var searching = true
    @State private var printerModel: PrinterModel = .P1S
    @State private var name = ""
    @State private var ip = ""
    @State private var serial = ""
    @State private var accessCode = ""
    @State private var manual = false
    @State private var saving = false
    @State private var result: String?
    @State private var saved = false

    private var ready: Bool {
        ip.split(separator: ".").count == 4 && serial.count >= 10 && accessCode.count >= 6
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if searching {
                        HStack { ProgressView(); Text("Looking for Bambu printers on your home network…").foregroundStyle(.secondary) }
                    } else if found.isEmpty {
                        Text("No printer found automatically. Make sure it is on and on the same network as your home computer, or enter the details by hand below.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(found) { printer in
                        Button { choose(printer) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(printer.name).font(.body.weight(.semibold)).foregroundStyle(.primary)
                                    Text("\(printer.model?.label ?? "Bambu printer") · \(printer.ip)")
                                        .font(.footnote).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if printer.added {
                                    Text("Added").font(.footnote).foregroundStyle(.secondary)
                                } else if printer.serialNumber == serial {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint)
                                }
                            }
                        }
                        .disabled(printer.added)
                    }
                } header: {
                    Text("Found on your network")
                }

                if !serial.isEmpty || manual {
                    Section {
                        TextField("8 characters", text: $accessCode)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.body.monospaced())
                    } header: {
                        Text("Access Code")
                    } footer: {
                        Text("\(printerModel.networkHelp) It is 8 letters and numbers.")
                    }
                }

                Section {
                    DisclosureGroup("Enter details by hand", isExpanded: $manual) {
                        Picker("Model", selection: $printerModel) {
                            ForEach(PrinterModel.allCases) { Text($0.label).tag($0) }
                        }
                        LabeledContent("IP address") {
                            TextField("192.168.1.100", text: $ip)
                                .keyboardType(.numbersAndPunctuation)
                                .multilineTextAlignment(.trailing)
                        }
                        LabeledContent("Serial number") {
                            TextField("15 characters", text: $serial)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                                .multilineTextAlignment(.trailing)
                        }
                        LabeledContent("Name") {
                            TextField("Workshop \(printerModel.label)", text: $name)
                                .multilineTextAlignment(.trailing)
                        }
                        Text("IP address: \(printerModel.networkHelp)\n\nSerial number: \(printerModel.serialHelp) It is also in the Bambu Handy app under your printer's settings.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }

                Section {
                    Button {
                        save()
                    } label: {
                        HStack {
                            Spacer()
                            if saving { ProgressView() } else { Text("Save and test").bold() }
                            Spacer()
                        }
                    }
                    .disabled(!ready || saving)
                } footer: {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("These details are saved on your home computer, not on this phone.", systemImage: "lock.fill")
                        Label("Newer Bambu firmware only accepts prints from apps like this with LAN Only Mode and Developer Mode on (printer Settings → LAN Only Mode). While LAN Only Mode is on, Bambu Handy and cloud features do not work; Bambu Studio still works on your home Wi-Fi.", systemImage: "exclamationmark.triangle.fill")
                    }
                    .font(.footnote)
                }
            }
            .navigationTitle("Add Bambu printer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .task { await search() }
            .alert(saved ? "Printer added" : "Could not finish", isPresented: Binding(get: { result != nil }, set: { if !$0 { result = nil } })) {
                Button("OK") {
                    result = nil
                    if saved { dismiss() }
                }
            } message: {
                Text(result ?? "")
            }
        }
    }

    private func search() async {
        searching = true
        found = (try? await Bridge.shared.discoverPrinters()) ?? []
        searching = false
        if let only = found.first(where: { !$0.added }), found.filter({ !$0.added }).count == 1 {
            choose(only)
        } else if found.isEmpty {
            manual = true
        }
    }

    private func choose(_ printer: Bridge.FoundPrinter) {
        ip = printer.ip
        serial = printer.serialNumber
        name = printer.name
        if let model = printer.model { printerModel = model }
    }

    private func save() {
        saving = true
        Task {
            do {
                let id = try await Bridge.shared.addPrinter(
                    name: name.isEmpty ? "My \(printerModel.label)" : name, model: printerModel,
                    ip: ip.trimmingCharacters(in: .whitespaces), serial: serial.trimmingCharacters(in: .whitespaces).uppercased(),
                    accessCode: accessCode.trimmingCharacters(in: .whitespaces))
                saved = true
                await model.refresh()
                do {
                    try await Bridge.shared.testPrinter(id)
                    result = "Your home computer reached the printer. You are ready to print."
                } catch {
                    result = "Saved, but the printer did not answer: \(error.localizedDescription)\n\nCheck the Access Code. On newer firmware, also turn on LAN Only Mode and Developer Mode on the printer."
                }
            } catch {
                saved = false
                result = error.localizedDescription
            }
            saving = false
        }
    }
}
