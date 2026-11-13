import SceneKit
import SceneKit.ModelIO
import SwiftUI

/// Pick settings for one model, slice it on the home computer, then send it to a printer.
struct SliceView: View {
    @Environment(AppModel.self) private var model
    let source: SliceSource

    @State private var settings = SliceSettings()
    @State private var preset: Preset = .normal
    @State private var slicing = false
    @State private var job: SliceJob?
    @State private var failure: String?
    @State private var printing: SliceJob?

    var body: some View {
        Form {
            Section("Quality") {
                Picker("Preset", selection: $preset) {
                    ForEach(Preset.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .onChange(of: preset) { _, value in value.apply(to: &settings) }
                Text(preset.blurb).font(.footnote).foregroundStyle(.secondary)
            }

            Section("Printer and material") {
                if case .plate = source {
                    LabeledContent("Printer", value: settings.printerModel.label)
                } else {
                    Picker("Printer", selection: $settings.printerModel) {
                        ForEach(PrinterModel.allCases) { Text($0.label).tag($0) }
                    }
                }
                if case let .plate(plate) = source {
                    LabeledContent("Filament", value: plate.filaments.prefix(plate.slotsUsed).map(\.type.rawValue).joined(separator: " + "))
                } else {
                    Picker("Filament", selection: $settings.filament) {
                        ForEach(Filament.allCases) { Text($0.rawValue).tag($0) }
                    }
                }
                Picker("Build plate", selection: $settings.bedType) {
                    ForEach(BedType.allCases) { Text($0.label).tag($0) }
                }
            }

            Section("Details") {
                Picker("Layer height", selection: $settings.layerHeight) {
                    ForEach(SliceSettings.layerHeights, id: \.self) { Text(String(format: "%.2f mm", $0)).tag($0) }
                }
                Stepper("Infill: \(settings.infillDensity)%", value: $settings.infillDensity, in: 0...100, step: 5)
                Picker("Infill pattern", selection: $settings.infillPattern) {
                    ForEach(SliceSettings.patterns, id: \.self) { Text($0.capitalized).tag($0) }
                }
                Stepper("Walls: \(settings.wallCount)", value: $settings.wallCount, in: 1...8)
                Toggle("Supports", isOn: $settings.supportEnabled)
                if settings.supportEnabled {
                    Picker("Support style", selection: $settings.supportType) {
                        Text("Tree").tag("tree")
                        Text("Normal").tag("normal")
                    }
                }
                Toggle("Brim (helps small parts stick)", isOn: Binding(
                    get: { settings.adhesionType == "brim" },
                    set: { settings.adhesionType = $0 ? "brim" : "none" }))
            }

            Section {
                if let job {
                    LabeledContent("Print time", value: job.timeText ?? "—")
                    LabeledContent("Filament", value: job.gramsText ?? "—")
                    if let profile = job.profile {
                        Text(profile).font(.footnote).foregroundStyle(.secondary)
                    }
                    Button {
                        printing = job
                    } label: {
                        Label("Send to printer", systemImage: "paperplane.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(model.printers.isEmpty)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    if model.printers.isEmpty {
                        Text("Add your printer in the Printers tab first.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Button {
                    slice()
                } label: {
                    HStack {
                        Spacer()
                        if slicing {
                            ProgressView()
                            Text("Slicing on your home computer…")
                        } else {
                            Text(job == nil ? "Slice" : "Slice again").bold()
                        }
                        Spacer()
                    }
                }
                .disabled(slicing || !model.canReachBridge)
            } footer: {
                if let failure {
                    Text(failure).foregroundStyle(.red)
                } else if !model.canReachBridge {
                    Text("Pair with your home computer in Settings first.")
                } else {
                    Text(isPlate ? "Printed exactly as you laid it out. Sliced by Bambu Studio on your home computer." : "Placed automatically. Sliced by Bambu Studio on your home computer, with Bambu's own profiles.")
                }
            }
        }
        .navigationTitle(source.title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if case let .plate(plate) = source {
                settings.printerModel = plate.printer
            } else if let first = model.printers.first, let known = PrinterModel(rawValue: first.model) {
                settings.printerModel = known
            }
        }
        .onChange(of: settings) { _, _ in job = nil }
        .sheet(item: $printing) { PrintSheet(job: $0) }
    }

    private var isPlate: Bool {
        if case .plate = source { return true }
        return false
    }

    private func slice() {
        slicing = true
        failure = nil
        Task {
            do {
                job = try await model.slice(source, settings: settings)
            } catch {
                failure = error.localizedDescription
            }
            slicing = false
        }
    }
}

/// Choose the printer and where the filament comes from, then start the print.
struct PrintSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let job: SliceJob

    @State private var printerID = ""
    @AppStorage("useAMS") private var useAMS = true
    @AppStorage("amsSlot") private var amsSlot = 0
    /// AMS slot for each filament in the file (index = filament number - 1).
    @State private var slots: [Int] = []
    @State private var sending = false
    @State private var outcome: String?
    @State private var sent = false
    @State private var confirming = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Model", value: job.fileName)
                    LabeledContent("Print time", value: job.timeText ?? "—")
                    LabeledContent("Filament", value: job.gramsText ?? "—")
                }
                Section("Printer") {
                    Picker("Send to", selection: $printerID) {
                        ForEach(model.printers) { Text($0.name).tag($0.id) }
                    }
                }
                Section {
                    Toggle("Use the AMS", isOn: $useAMS)
                    if useAMS {
                        if (job.filamentCount ?? 1) > 1 {
                            ForEach(0..<(job.filamentCount ?? 1), id: \.self) { index in
                                Picker("Filament \(index + 1)", selection: Binding(
                                    get: { slots.indices.contains(index) ? slots[index] : index % 4 },
                                    set: { value in
                                        while slots.count <= index { slots.append(slots.count % 4) }
                                        slots[index] = value
                                    })) {
                                    ForEach(0..<4, id: \.self) { Text("AMS slot \($0 + 1)").tag($0) }
                                }
                            }
                        } else {
                            Picker("Slot", selection: $amsSlot) {
                                ForEach(0..<4, id: \.self) { Text("Slot \($0 + 1)").tag($0) }
                            }
                            .pickerStyle(.segmented)
                        }
                    }
                } header: {
                    Text("Filament source")
                } footer: {
                    Text(!useAMS ? "Prints from the spool on the back of the printer."
                         : (job.filamentCount ?? 1) > 1 ? "Match each filament to the AMS slot that holds it."
                         : "Pick the slot holding the filament you sliced for.")
                }
                Section {
                    Button {
                        confirming = true
                    } label: {
                        HStack {
                            Spacer()
                            if sending { ProgressView() } else { Text("Start print").bold() }
                            Spacer()
                        }
                    }
                    .disabled(sending || printerID.isEmpty)
                } footer: {
                    Text("Check the build plate is clear before you start. The print begins straight away.")
                }
            }
            .navigationTitle("Print")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .onAppear { if printerID.isEmpty { printerID = model.printers.first?.id ?? "" } }
            .confirmationDialog("Start this print now?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Start print") { start() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The printer will start heating and printing immediately.")
            }
            .alert(sent ? "Sent" : "Could not print", isPresented: Binding(get: { outcome != nil }, set: { if !$0 { outcome = nil } })) {
                Button("OK") {
                    outcome = nil
                    if sent { dismiss() }
                }
            } message: {
                Text(outcome ?? "")
            }
        }
        .presentationDetents([.large])
    }

    private func start() {
        guard let printer = model.printers.first(where: { $0.id == printerID }) else { return }
        sending = true
        Task {
            do {
                let count = job.filamentCount ?? 1
                let mapping = count > 1
                    ? (0..<count).map { slots.indices.contains($0) ? slots[$0] : $0 % 4 }
                    : [amsSlot]
                if count > 1 && !useAMS {
                    throw BridgeError("This plate uses \(count) filaments, so it needs the AMS.")
                }
                try await model.send(job, to: printer, useAMS: useAMS, amsSlots: mapping)
                sent = true
                outcome = "\(job.fileName) was sent to \(printer.name)."
            } catch {
                sent = false
                outcome = "\(error.localizedDescription)\n\nIf the printer refused it, turn on LAN Only Mode and Developer Mode on the printer."
            }
            sending = false
        }
    }
}
