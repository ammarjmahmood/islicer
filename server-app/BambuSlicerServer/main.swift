import SwiftUI
import AppKit

@main
struct BambuSlicerServerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var server = ServerManager()

    var body: some Scene {
        MenuBarExtra {
            ServerMenuView(server: server)
        } label: {
            HStack(spacing: 4) {
                Image(systemName: server.isRunning ? "cube.fill" : "cube")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(server.isRunning ? .green : .secondary)
                Text(server.isRunning ? "Running" : "Stopped")
                    .font(.system(.body, design: .rounded))
            }
        }
        .menuBarExtraStyle(.window)
    }
}

// MARK: - App Delegate (cleanup on quit)

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillTerminate(_ notification: Notification) {
        Task { @MainActor in
            ServerManager.shared?.stop()
        }
    }
}

// MARK: - Menu View

struct ServerMenuView: View {
    @ObservedObject var server: ServerManager

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("BambuSlicer Server")
                    .font(.headline)
                Spacer()
                Circle()
                    .fill(server.isRunning ? Color.green : Color.red)
                    .frame(width: 8, height: 8)
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)

            Divider().opacity(0.3).padding(.vertical, 8)

            // Status
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Status:")
                        .foregroundColor(.secondary)
                    Text(server.isRunning ? "Running" : "Stopped")
                        .foregroundColor(server.isRunning ? .green : .red)
                        .fontWeight(.medium)
                }

                if server.isRunning {
                    HStack {
                        Text("Port:")
                            .foregroundColor(.secondary)
                        Text("4000")
                            .fontDesign(.monospaced)
                    }

                    HStack {
                        Text("URL:")
                            .foregroundColor(.secondary)
                        Text("http://localhost:4000")
                            .fontDesign(.monospaced)
                            .textSelection(.enabled)
                    }

                    HStack {
                        Text("Engine:")
                            .foregroundColor(.secondary)
                        Text(server.engineStatus)
                            .foregroundColor(server.engineStatus.contains("NOT") ? .orange : .green)
                    }
                }

                if let error = server.error {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                        .lineLimit(3)
                }
            }
            .padding(.horizontal, 16)

            Divider().opacity(0.3).padding(.vertical, 8)

            // Log output
            if !server.recentLogs.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Logs")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    ScrollView {
                        Text(server.recentLogs)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(height: 80)
                }
                .padding(.horizontal, 16)

                Divider().opacity(0.3).padding(.vertical, 8)
            }

            // Controls
            HStack {
                if server.isRunning {
                    Button("Stop Server") {
                        server.stop()
                    }
                    .buttonStyle(.bordered)
                } else {
                    Button("Start Server") {
                        server.start()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                }

                Spacer()

                Button("Quit") {
                    server.stop()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        NSApplication.shared.terminate(nil)
                    }
                }
                .buttonStyle(.bordered)
                .foregroundColor(.red)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .frame(width: 320, height: server.recentLogs.isEmpty ? 240 : 360)
        .background(.ultraThinMaterial)
        .task {
            server.start()
        }
    }
}

// MARK: - Server Manager

@MainActor
class ServerManager: ObservableObject {
    static weak var shared: ServerManager?

    @Published var isRunning = false
    @Published var error: String?
    @Published var recentLogs = ""
    @Published var engineStatus = "Checking..."

    private var process: Process?
    private var outputPipe: Pipe?

    init() {
        ServerManager.shared = self
    }

    func start() {
        guard !isRunning else { return }
        error = nil
        recentLogs = ""

        // Find node — prefer bundled, fallback to system
        guard let nodePath = findNode() else {
            error = "Node.js not found"
            return
        }
        appendLog("Node: \(nodePath)")

        // Find server directory
        guard let serverDir = findServerDir() else {
            error = "Server files not found"
            return
        }
        appendLog("Server: \(serverDir)")

        // Check node_modules
        let nodeModules = (serverDir as NSString).appendingPathComponent("node_modules")
        if !FileManager.default.fileExists(atPath: nodeModules) {
            appendLog("Installing dependencies...")
            installDependencies(serverDir: serverDir, nodePath: nodePath)
            return
        }

        launchServer(serverDir: serverDir, nodePath: nodePath)
    }

    func stop() {
        if let proc = process, proc.isRunning {
            proc.terminate()
        }
        process = nil
        isRunning = false
        appendLog("Server stopped")
    }

    private func launchServer(serverDir: String, nodePath: String) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: nodePath)
        proc.arguments = ["index.js"]
        proc.currentDirectoryURL = URL(fileURLWithPath: serverDir)

        // Pass through environment but ensure PATH includes homebrew
        var env = ProcessInfo.processInfo.environment
        let extraPaths = ["/opt/homebrew/bin", "/usr/local/bin"]
        env["PATH"] = (extraPaths + [env["PATH"] ?? ""]).joined(separator: ":")
        proc.environment = env

        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = pipe
        outputPipe = pipe

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let str = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.appendLog(str)
                if str.contains("running on port") {
                    self?.isRunning = true
                }
                if str.contains("CuraEngine:") {
                    if str.contains("NOT FOUND") {
                        self?.engineStatus = "Basic slicer (install CuraEngine for full support)"
                    } else {
                        self?.engineStatus = "CuraEngine"
                    }
                }
            }
        }

        proc.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                self?.isRunning = false
                if proc.terminationStatus != 0 && proc.terminationStatus != 15 {
                    self?.appendLog("Server exited with code \(proc.terminationStatus)")
                }
            }
        }

        do {
            try proc.run()
            process = proc
            appendLog("Starting server on port 4000...")
        } catch {
            self.error = "Failed to start: \(error.localizedDescription)"
        }
    }

    private func installDependencies(serverDir: String, nodePath: String) {
        // Use bundled node to run npm
        let npmPath = (nodePath as NSString).deletingLastPathComponent + "/../lib/node_modules/npm/bin/npm-cli.js"
        let useNpm = FileManager.default.fileExists(atPath: npmPath)

        Task {
            let proc = Process()
            if useNpm {
                proc.executableURL = URL(fileURLWithPath: nodePath)
                proc.arguments = [npmPath, "install", "--production"]
            } else {
                // Fallback to system npm
                proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
                proc.arguments = ["-lc", "cd '\(serverDir)' && npm install --production"]
            }
            proc.currentDirectoryURL = URL(fileURLWithPath: serverDir)

            let pipe = Pipe()
            proc.standardOutput = pipe
            proc.standardError = pipe

            do {
                try proc.run()
                proc.waitUntilExit()
                if proc.terminationStatus == 0 {
                    appendLog("Dependencies installed")
                    launchServer(serverDir: serverDir, nodePath: nodePath)
                } else {
                    let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                    error = "npm install failed: \(output.prefix(200))"
                }
            } catch {
                self.error = "npm error: \(error.localizedDescription)"
            }
        }
    }

    private func findNode() -> String? {
        // 1. Bundled node (inside .app bundle)
        let bundledNode = Bundle.main.bundlePath + "/Contents/Resources/node/node"
        if FileManager.default.fileExists(atPath: bundledNode) {
            return bundledNode
        }

        // 2. System node
        let systemPaths = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
        ]
        for p in systemPaths {
            if FileManager.default.fileExists(atPath: p) { return p }
        }

        // 3. NVM
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let nvmDir = "\(home)/.nvm/versions/node/"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvmDir),
           let latest = versions.sorted().last {
            let p = "\(nvmDir)\(latest)/bin/node"
            if FileManager.default.fileExists(atPath: p) { return p }
        }

        // 4. which
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-lc", "which node"]
        let pipe = Pipe()
        proc.standardOutput = pipe
        try? proc.run()
        proc.waitUntilExit()
        if let path = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty {
            return path
        }

        return nil
    }

    private func findServerDir() -> String? {
        // 1. Bundled server (inside .app)
        let bundledServer = Bundle.main.bundlePath + "/Contents/Resources/server"
        if FileManager.default.fileExists(atPath: bundledServer + "/index.js") {
            return bundledServer
        }

        // 2. Relative paths (dev builds)
        let execDir = Bundle.main.bundlePath
        let candidates = [
            (execDir as NSString).appendingPathComponent("../../../server"),
            (execDir as NSString).appendingPathComponent("../../server"),
            FileManager.default.homeDirectoryForCurrentUser.path + "/Documents/GitHub/bambu-slicer/server",
        ]

        for dir in candidates {
            let resolved = (dir as NSString).standardizingPath
            if FileManager.default.fileExists(atPath: resolved + "/index.js") {
                return resolved
            }
        }

        return nil
    }

    private func appendLog(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if !recentLogs.isEmpty { recentLogs += "\n" }
        recentLogs += trimmed
        let lines = recentLogs.split(separator: "\n", omittingEmptySubsequences: false)
        if lines.count > 20 {
            recentLogs = lines.suffix(20).joined(separator: "\n")
        }
    }
}
