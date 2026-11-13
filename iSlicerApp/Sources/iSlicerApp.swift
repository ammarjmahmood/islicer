import SwiftUI

@main
struct iSlicerApp: App {
    @State private var model = AppModel()
    @State private var tab = 0
    @State private var opened: ModelFile?
    @State private var notice: String?
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            TabView(selection: $tab) {
                FilesView(opened: $opened)
                    .tabItem { Label("Files", systemImage: "cube") }
                    .tag(0)
                PrintersView()
                    .tabItem { Label("Printers", systemImage: "printer") }
                    .tag(1)
                SettingsView()
                    .tabItem { Label("Settings", systemImage: "gearshape") }
                    .tag(2)
            }
            .environment(model)
            .preferredColorScheme(.dark)
            .task { await model.refresh() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await model.refresh() } }
            }
            .onOpenURL { url in
                if url.scheme == "islicer" {
                    // islicer://pair?c=... from the camera app or a link
                    tab = 2
                    Task {
                        do {
                            try await model.pair(url.absoluteString)
                            notice = "Paired with your home computer."
                        } catch {
                            notice = error.localizedDescription
                        }
                    }
                } else if let file = model.importFile(url) {
                    // "Open in iSlicer" from Files, Safari or a share sheet
                    tab = 0
                    opened = file
                }
            }
            .alert("iSlicer", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
                Button("OK") { notice = nil }
            } message: {
                Text(notice ?? "")
            }
        }
    }
}
