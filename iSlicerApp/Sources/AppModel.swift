import Foundation
import Observation
import SwiftUI

/// App-wide state: connection, printers, imported models and recent slices.
@MainActor
@Observable
final class AppModel {
    enum Connection: Equatable {
        case unpaired, checking, online(String), offline(String)
    }

    var connection: Connection = .checking
    var printers: [Printer] = []
    var files: [ModelFile] = []
    var jobs: [SliceJob] = []
    var isPaired = Bridge.shared.isPaired

    private let bridge = Bridge.shared
    private let modelsFolder: URL = {
        let folder = URL.documentsDirectory.appending(path: "Models", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }()

    init() {
        loadFiles()
        if let data = UserDefaults.standard.data(forKey: "jobs"),
           let saved = try? JSONDecoder().decode([SliceJob].self, from: data) {
            jobs = saved
        }
    }

    var canReachBridge: Bool { isPaired || !bridge.manualAddress.isEmpty }
    var isSetUp: Bool { canReachBridge && !printers.isEmpty }

    // MARK: Connection

    func refresh() async {
        isPaired = bridge.isPaired
        guard canReachBridge else {
            connection = .unpaired
            printers = []
            return
        }
        if connection == .unpaired { connection = .checking }
        do {
            let health = try await bridge.health()
            connection = .online(health.slicerReady ? "\(health.slicerName) ready" : (health.note ?? "Slicer not ready"))
            printers = (try? await bridge.printers()) ?? printers
        } catch {
            connection = .offline(error.localizedDescription)
        }
    }

    func pair(_ input: String) async throws {
        try await bridge.pair(input)
        await refresh()
    }

    func unpair() {
        bridge.unpair()
        isPaired = false
        connection = .unpaired
        printers = []
    }

    // MARK: Files

    func loadFiles() {
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: modelsFolder, includingPropertiesForKeys: [.fileSizeKey, .creationDateKey])) ?? []
        files = urls
            .filter { ["stl", "3mf"].contains($0.pathExtension.lowercased()) }
            .map(ModelFile.init(url:))
            .sorted { $0.added > $1.added }
    }

    /// Copies a picked or shared file into the app. Returns it, or nil if it is not a model.
    @discardableResult
    func importFile(_ source: URL) -> ModelFile? {
        guard ["stl", "3mf"].contains(source.pathExtension.lowercased()) else { return nil }
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let target = modelsFolder.appending(path: source.lastPathComponent)
        try? FileManager.default.removeItem(at: target)
        do {
            try FileManager.default.copyItem(at: source, to: target)
        } catch {
            return nil
        }
        loadFiles()
        return files.first { $0.url.lastPathComponent == target.lastPathComponent }
    }

    func delete(_ file: ModelFile) {
        try? FileManager.default.removeItem(at: file.url)
        loadFiles()
    }

    // MARK: Slicing and printing

    /// Slices on the bridge and waits for the result. Throws with the bridge's own reason on failure.
    func slice(_ file: ModelFile, settings: SliceSettings) async throws -> SliceJob {
        let id = try await bridge.startSlice(file: file.url, settings: settings)
        var job = SliceJob(id: id, fileName: file.name, status: "slicing", printer: settings.printerModel.label)
        let started = Date()
        while Date().timeIntervalSince(started) < 30 * 60 {
            try await Task.sleep(for: .seconds(1.5))
            let status = try await bridge.sliceStatus(id)
            job.status = status["status"] as? String ?? "slicing"
            if job.status == "error" {
                throw BridgeError(status["error"] as? String ?? "Slicing failed.")
            }
            if job.status == "done" {
                job.seconds = (status["estimatedTime"] as? NSNumber)?.intValue
                job.grams = (status["estimatedFilament"] as? NSNumber)?.doubleValue
                if let profiles = status["profiles"] as? [String: Any] {
                    job.profile = [profiles["process"] as? String, profiles["filament"] as? String]
                        .compactMap { $0 }.joined(separator: " · ")
                }
                remember(job)
                return job
            }
        }
        throw BridgeError("Slicing took too long. Try again.")
    }

    func send(_ job: SliceJob, to printer: Printer, useAMS: Bool, amsSlot: Int) async throws {
        try await bridge.print(jobID: job.id, printerID: printer.id, useAMS: useAMS, amsSlot: amsSlot)
    }

    private func remember(_ job: SliceJob) {
        jobs.removeAll { $0.id == job.id }
        jobs.insert(job, at: 0)
        jobs = Array(jobs.prefix(20))
        if let data = try? JSONEncoder().encode(jobs) { UserDefaults.standard.set(data, forKey: "jobs") }
    }

    func forget(_ job: SliceJob) {
        jobs.removeAll { $0.id == job.id }
        if let data = try? JSONEncoder().encode(jobs) { UserDefaults.standard.set(data, forKey: "jobs") }
    }
}
