import SwiftUI
import UniformTypeIdentifiers

struct FilesView: View {
    @Environment(AppModel.self) private var model
    @Binding var opened: ModelFile?
    @State private var importing = false
    @State private var path: [ModelFile] = []
    @State private var printing: SliceJob?
    @State private var addingPrinter = false

    private static let types: [UTType] = [
        UTType(filenameExtension: "stl"), UTType(filenameExtension: "3mf"), .data,
    ].compactMap { $0 }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if !model.isSetUp {
                    SetupGuide(onPair: nil, onAddPrinter: { addingPrinter = true })
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                Section {
                    if model.files.isEmpty {
                        VStack(spacing: 10) {
                            Image(systemName: "cube.transparent").font(.system(size: 44)).foregroundStyle(.tint)
                            Text("No models yet").font(.headline)
                            Text("Import an STL or 3MF from Files, or use Share → iSlicer from Safari and other apps.")
                                .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            Button("Import a model") { importing = true }
                                .buttonStyle(.borderedProminent)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                    }
                    ForEach(model.files) { file in
                        NavigationLink(value: file) {
                            HStack(spacing: 12) {
                                Image(systemName: file.isSTL ? "cube.fill" : "shippingbox.fill")
                                    .font(.title3).foregroundStyle(.tint).frame(width: 36)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(file.name).lineLimit(1)
                                    Text(ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file))
                                        .font(.footnote).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .swipeActions {
                            Button("Delete", role: .destructive) { model.delete(file) }
                        }
                        .contextMenu {
                            if !file.isSTL {
                                NavigationLink("Slice as is, with its own layout") { SliceView(source: .file(file)) }
                            }
                        }
                    }
                } header: {
                    if !model.files.isEmpty { Text("Models") }
                }

                if !model.jobs.isEmpty {
                    Section {
                        ForEach(model.jobs) { job in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(job.fileName).lineLimit(1)
                                    Text([job.printer, job.timeText, job.gramsText].compactMap { $0 }.joined(separator: " · "))
                                        .font(.footnote).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("Print") { printing = job }
                                    .buttonStyle(.bordered)
                                    .disabled(model.printers.isEmpty)
                            }
                            .swipeActions {
                                Button("Remove", role: .destructive) { model.forget(job) }
                            }
                        }
                    } header: {
                        Text("Ready to print")
                    } footer: {
                        Text("Sliced files wait on your home computer.")
                    }
                }
            }
            .navigationTitle("iSlicer")
            .navigationDestination(for: ModelFile.self) { file in
                PlateEditorView(file: file)
            }
            .toolbar {
                Button { importing = true } label: { Image(systemName: "plus") }
            }
            .refreshable {
                model.loadFiles()
                await model.refresh()
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: Self.types, allowsMultipleSelection: true) { result in
                if case let .success(urls) = result {
                    for url in urls { model.importFile(url) }
                }
            }
            .sheet(item: $printing) { PrintSheet(job: $0) }
            .sheet(isPresented: $addingPrinter) { AddPrinterView() }
            .onChange(of: opened) { _, file in
                if let file {
                    path = [file]
                    opened = nil
                }
            }
        }
    }
}
