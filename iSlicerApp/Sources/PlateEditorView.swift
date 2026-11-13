import SceneKit
import SwiftUI

/// Lay models out on the bed: add, drag, turn, scale, lay flat, cut, paint, duplicate, arrange.
struct PlateEditorView: View {
    @Environment(AppModel.self) private var model
    let file: ModelFile
    @State private var plate = PlateModel()
    @State private var started = false
    @State private var loading: String?
    @State private var failure: String?
    @State private var showFilaments = false
    @State private var showSettings = false
    @State private var cutKeep: PlateModel.CutKeep = .both
    @State private var flipTop = true

    var body: some View {
        VStack(spacing: 0) {
            PlateSceneView(plate: plate, revision: plate.revision, selected: plate.selectedID, mode: plate.mode)
                .overlay(alignment: .bottom) { banner.font(.footnote.weight(.semibold)).padding(.bottom, 10) }
                .overlay {
                    if let loading {
                        ProgressView(loading).padding(18).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                    }
                }
            controls
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(white: 0.07))
        }
        .navigationTitle(plate.summary)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Picker("Printer", selection: $plate.printer) {
                        ForEach(PrinterModel.allCases) { Text($0.label).tag($0) }
                    }
                } label: {
                    Text(plate.printer.label).font(.footnote.weight(.semibold))
                }
                Button { showFilaments = true } label: { Image(systemName: "swatchpalette") }
                    .accessibilityLabel("Filaments")
                Menu {
                    ForEach(model.files) { candidate in
                        Button(candidate.name) { open(candidate) }
                    }
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showFilaments) { FilamentsSheet(plate: plate) }
        .sheet(isPresented: $showSettings) { ModelSettingsSheet(plate: plate) }
        .alert("Could not open", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK") { failure = nil }
        } message: { Text(failure ?? "") }
        .onAppear {
            guard !started else { return }
            started = true
            if let first = model.printers.first, let known = PrinterModel(rawValue: first.model) { plate.printer = known }
            open(file)
        }
    }

    /// STL files load here; a 3MF is unpacked by the home computer into its separate models.
    private func open(_ file: ModelFile) {
        if file.isSTL {
            if !plate.add(file) { failure = "\(file.name) is not a readable STL file." }
            return
        }
        loading = "Opening \(file.name)…"
        Task {
            do {
                let models = try await Bridge.shared.openModels(file.url)
                for (index, part) in models.enumerated() {
                    guard let mesh = TriMesh.parse(part.data) else { continue }
                    plate.add(name: part.name, mesh: mesh, arrangeAfter: index == models.count - 1)
                }
                if models.isEmpty { failure = "No printable models were found in \(file.name)." }
            } catch {
                failure = error.localizedDescription
            }
            loading = nil
        }
    }

    @ViewBuilder private var banner: some View {
        switch plate.mode {
        case .layFlat:
            hint("Tap the face that should sit on the bed")
        case .paint:
            hint("Drag on the model to paint. Use two fingers to turn the view.")
        case .cut:
            hint("Drag the slider to place the cut")
        case .move:
            if let problem = plate.problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill")
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(.red.opacity(0.85), in: Capsule())
            }
        }
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .foregroundStyle(.black)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(.tint, in: Capsule())
    }

    @ViewBuilder private var controls: some View {
        VStack(spacing: 10) {
            if let item = plate.selected {
                switch plate.mode {
                case .cut: cutPanel(item)
                case .paint: paintPanel
                default: editPanel(item)
                }
            } else {
                Text(plate.items.isEmpty ? "Add a model with ＋" : "Tap a model to select it. Drag it to move. Drag the background to look around.")
                    .font(.footnote).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if plate.mode == .move || plate.mode == .layFlat {
                HStack(spacing: 8) {
                    pill("Arrange", "square.grid.2x2") { plate.arrange() }
                        .disabled(plate.items.count < 2)
                    NavigationLink {
                        SliceView(source: .plate(plate))
                    } label: {
                        Label("Slice settings", systemImage: "chevron.right")
                            .labelStyle(.titleAndIcon)
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                            .background(plate.problem == nil ? Color.accentColor : Color.gray.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .foregroundStyle(.black)
                    }
                    .disabled(plate.problem != nil)
                }
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    @ViewBuilder private func editPanel(_ item: PlateItem) -> some View {
        HStack(spacing: 8) {
            turn("X", SIMD3(1, 0, 0))
            turn("Y", SIMD3(0, 1, 0))
            turn("Z", SIMD3(0, 0, 1))
            Divider().frame(height: 26)
            tool("arrow.counterclockwise", "Spin left") { plate.rotateSelected(axis: SIMD3(0, 0, 1), degrees: 15) }
            tool("arrow.clockwise", "Spin right") { plate.rotateSelected(axis: SIMD3(0, 0, 1), degrees: -15) }
            Spacer(minLength: 0)
            tool("arrow.uturn.backward", "Reset turn") { plate.resetRotation() }
        }
        HStack(spacing: 10) {
            Text("Size").font(.footnote).foregroundStyle(.secondary)
            Slider(value: Binding(get: { Double(item.scale) }, set: { plate.setScale(Float($0)) }), in: 0.1...3)
            Text("\(Int((item.scale * 100).rounded()))%").font(.footnote.monospacedDigit()).frame(width: 46, alignment: .trailing)
        }
        HStack {
            Text(String(format: "%.0f × %.0f × %.0f mm", item.size.x, item.size.y, item.size.z))
            Spacer()
            if plate.filaments.count > 1 || !item.settings.isEmpty {
                Text(itemTags(item))
            }
        }
        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        HStack(spacing: 8) {
            pill(plate.mode == .layFlat ? "Cancel" : "Lay flat", "square.3.layers.3d.down.right") {
                plate.mode = plate.mode == .layFlat ? .move : .layFlat
            }
            pill("Cut", "scissors") {
                plate.cutHeight = (item.size.z / 2).rounded()
                plate.mode = .cut
            }
            pill("Paint", "paintbrush.pointed") { plate.mode = .paint }
        }
        HStack(spacing: 8) {
            pill("Settings", "slider.horizontal.3") { showSettings = true }
            pill("Duplicate", "plus.square.on.square") { plate.duplicateSelected() }
            pill("Remove", "trash") { plate.deleteSelected() }
        }
    }

    private func itemTags(_ item: PlateItem) -> String {
        var tags: [String] = []
        if plate.filaments.count > 1 { tags.append("Filament \(item.extruder)") }
        if let infill = item.settings.infill { tags.append("\(infill)% infill") }
        if let walls = item.settings.walls { tags.append("\(walls) walls") }
        if let supports = item.settings.supports { tags.append(supports == "off" ? "no supports" : "\(supports) supports") }
        return tags.joined(separator: " · ")
    }

    @ViewBuilder private func cutPanel(_ item: PlateItem) -> some View {
        HStack(spacing: 10) {
            Text("Height").font(.footnote).foregroundStyle(.secondary)
            Slider(value: Binding(get: { Double(plate.cutHeight) }, set: { plate.cutHeight = Float($0) }),
                   in: 0.2...Double(max(item.size.z - 0.2, 0.4)))
            Text(String(format: "%.1f mm", plate.cutHeight)).font(.footnote.monospacedDigit()).frame(width: 64, alignment: .trailing)
        }
        Picker("Keep", selection: $cutKeep) {
            ForEach(PlateModel.CutKeep.allCases) { Text("Keep \($0.rawValue.lowercased())").tag($0) }
        }
        .pickerStyle(.segmented)
        Toggle("Turn the top piece cut-side down", isOn: $flipTop)
            .font(.footnote)
            .disabled(cutKeep == .bottom)
        HStack(spacing: 8) {
            pill("Cancel", "xmark") { plate.mode = .move }
            Button {
                plate.cutSelected(keep: cutKeep, flipTop: flipTop)
            } label: {
                Label("Cut", systemImage: "scissors")
                    .font(.footnote.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .foregroundStyle(.black)
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder private var paintPanel: some View {
        HStack(spacing: 6) {
            ForEach(PaintBrush.allCases) { brush in
                Button {
                    plate.brush = brush
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: brush.symbol).font(.footnote.weight(.semibold))
                        Text(brush.label).font(.caption2)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .background(plate.brush == brush ? Color.accentColor.opacity(0.35) : Color(.tertiarySystemFill),
                                in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        if plate.brush == .color {
            HStack(spacing: 8) {
                ForEach(Array(plate.filaments.enumerated()), id: \.element.id) { index, slot in
                    Button {
                        plate.brushSlot = index + 1
                    } label: {
                        Circle().fill(slot.color).frame(width: 28, height: 28)
                            .overlay(Circle().stroke(Color.white, lineWidth: plate.brushSlot == index + 1 ? 3 : 0))
                            .overlay(Text("\(index + 1)").font(.caption2.bold()).foregroundStyle(.black))
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                if plate.filaments.count < 2 {
                    Button("Add a filament") { showFilaments = true }.font(.footnote)
                }
            }
        }
        HStack(spacing: 10) {
            Text("Brush").font(.footnote).foregroundStyle(.secondary)
            Slider(value: Binding(get: { Double(plate.brushSize) }, set: { plate.brushSize = Float($0) }), in: 1...25)
            Text(String(format: "%.0f mm", plate.brushSize)).font(.footnote.monospacedDigit()).frame(width: 48, alignment: .trailing)
        }
        Text(paintHelp).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
        HStack(spacing: 8) {
            pill("Clear all", "trash") { plate.clearPaint() }
            pill("Done", "checkmark") { plate.mode = .move }
        }
    }

    private var paintHelp: String {
        switch plate.brush {
        case .support: return "Green: supports are added here, even with supports off."
        case .block: return "Red: no supports here."
        case .seam: return "Blue: where each layer starts and ends."
        case .color: return "Paints with the chosen filament. The printer swaps filament with the AMS."
        case .erase: return "Removes any paint."
        }
    }

    private func turn(_ label: String, _ axis: SIMD3<Float>) -> some View {
        Button {
            plate.rotateSelected(axis: axis, degrees: 90)
        } label: {
            HStack(spacing: 3) {
                Image(systemName: "rotate.3d")
                Text(label).fontWeight(.bold)
            }
            .font(.footnote)
            .padding(.horizontal, 9).padding(.vertical, 8)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Turn 90 degrees about \(label)")
    }

    private func tool(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.footnote.weight(.semibold))
                .padding(8)
                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func pill(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.footnote.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// The filaments this plate uses: slot 1 for everything unless a model or paint says otherwise.
struct FilamentsSheet: View {
    @Bindable var plate: PlateModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(Array(plate.filaments.indices), id: \.self) { index in
                        HStack(spacing: 12) {
                            Text("\(index + 1)").font(.headline.monospacedDigit()).frame(width: 18)
                            ColorPicker("", selection: $plate.filaments[index].color, supportsOpacity: false).labelsHidden()
                            Picker("Type", selection: $plate.filaments[index].type) {
                                ForEach(Filament.allCases) { Text($0.rawValue).tag($0) }
                            }
                        }
                        .swipeActions {
                            if plate.filaments.count > 1 {
                                Button("Remove", role: .destructive) { plate.removeFilament(at: index) }
                            }
                        }
                    }
                    if plate.filaments.count < 4 {
                        Button { plate.addFilament() } label: { Label("Add filament", systemImage: "plus") }
                    }
                } footer: {
                    Text("Give a model its own filament in its Settings, or paint parts of it with Paint → Colour. When you print, you pick which AMS slot holds each one.")
                }
            }
            .navigationTitle("Filaments")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Settings for the selected model only.
struct ModelSettingsSheet: View {
    @Bindable var plate: PlateModel
    @Environment(\.dismiss) private var dismiss
    @State private var settings = ObjectSettings()

    var body: some View {
        NavigationStack {
            Form {
                if plate.filaments.count > 1 {
                    Section("Filament") {
                        Picker("Filament", selection: Binding(get: { plate.selected?.extruder ?? 1 }, set: { plate.setExtruder($0) })) {
                            ForEach(Array(plate.filaments.enumerated()), id: \.element.id) { index, slot in
                                Label("\(index + 1) · \(slot.type.rawValue)", systemImage: "circle.fill")
                                    .foregroundStyle(slot.color)
                                    .tag(index + 1)
                            }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                }
                Section {
                    Toggle("Own infill", isOn: Binding(get: { settings.infill != nil }, set: { settings.infill = $0 ? 20 : nil }))
                    if let infill = settings.infill {
                        Stepper("Infill: \(infill)%", value: Binding(get: { infill }, set: { settings.infill = $0 }), in: 0...100, step: 5)
                    }
                    Toggle("Own wall count", isOn: Binding(get: { settings.walls != nil }, set: { settings.walls = $0 ? 3 : nil }))
                    if let walls = settings.walls {
                        Stepper("Walls: \(walls)", value: Binding(get: { walls }, set: { settings.walls = $0 }), in: 1...10)
                    }
                    Picker("Supports", selection: Binding(get: { settings.supports ?? "plate" }, set: { settings.supports = $0 == "plate" ? nil : $0 })) {
                        Text("Same as plate").tag("plate")
                        Text("Off").tag("off")
                        Text("Tree").tag("tree")
                        Text("Normal").tag("normal")
                    }
                } header: {
                    Text("This model only")
                } footer: {
                    Text("Anything left off uses the plate's slice settings.")
                }
                if plate.filaments.count < 2 {
                    Section {
                        Text("To print this model in another filament, add one with the palette button at the top.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(plate.selected?.name ?? "Model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { settings = plate.selected?.settings ?? ObjectSettings() }
            .onChange(of: settings) { _, value in plate.setSettings(value) }
        }
        .presentationDetents([.medium, .large])
    }
}

/// The 3D bed. Printer space (Z up) lives inside `world`, which is tipped to SceneKit's Y-up.
struct PlateSceneView: UIViewRepresentable {
    let plate: PlateModel
    // Read here so SwiftUI calls updateUIView when the plate changes.
    let revision: Int
    let selected: UUID?
    let mode: PlateModel.Mode

    func makeCoordinator() -> Coordinator { Coordinator(plate: plate) }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.scene = context.coordinator.scene
        view.backgroundColor = UIColor(white: 0.07, alpha: 1)
        view.antialiasingMode = .multisampling4X
        view.autoenablesDefaultLighting = true
        view.allowsCameraControl = true
        view.defaultCameraController.interactionMode = .orbitTurntable
        view.defaultCameraController.maximumVerticalAngle = 88
        view.defaultCameraController.minimumVerticalAngle = 4
        context.coordinator.attach(to: view)
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        context.coordinator.sync()
    }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        let plate: PlateModel
        let scene = SCNScene()
        private let world = SCNNode()
        private let cameraNode = SCNNode()
        private var bedNode: SCNNode?
        private var bedSize = SIMD3<Float>(repeating: 0)
        private var nodes: [UUID: SCNNode] = [:]
        private var looks: [UUID: Int] = [:]
        private var shapes: [UUID: ObjectIdentifier] = [:]
        private let cutPlane: SCNNode = {
            let plane = SCNPlane(width: 1, height: 1)
            let material = SCNMaterial()
            material.diffuse.contents = UIColor(red: 0, green: 0.83, blue: 0.67, alpha: 0.35)
            material.isDoubleSided = true
            material.lightingModel = .constant
            material.writesToDepthBuffer = false
            plane.materials = [material]
            let node = SCNNode(geometry: plane)
            node.renderingOrder = 10
            node.isHidden = true
            return node
        }()
        private var painting: UUID?
        private weak var view: SCNView?
        private var drag: (id: UUID, offset: SIMD2<Float>)?
        private var panRecognizer: UIPanGestureRecognizer?

        init(plate: PlateModel) {
            self.plate = plate
            super.init()
            world.eulerAngles.x = -.pi / 2
            scene.rootNode.addChildNode(world)
            cameraNode.camera = SCNCamera()
            cameraNode.camera?.fieldOfView = 46
            cameraNode.camera?.projectionDirection = .horizontal // the phone is tall; fit the bed's width
            scene.rootNode.addChildNode(cameraNode)
            let fill = SCNNode()
            fill.light = SCNLight()
            fill.light?.type = .ambient
            fill.light?.intensity = 350
            scene.rootNode.addChildNode(fill)
            world.addChildNode(cutPlane)
        }

        func attach(to view: SCNView) {
            self.view = view
            view.pointOfView = cameraNode
            let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
            view.addGestureRecognizer(tap)
            let pan = UIPanGestureRecognizer(target: self, action: #selector(panned(_:)))
            pan.maximumNumberOfTouches = 1
            pan.delegate = self
            view.addGestureRecognizer(pan)
            panRecognizer = pan
            sync()
        }

        // MARK: Drawing

        func sync() {
            if plate.bed != bedSize { rebuildBed() }
            let clashing = plate.overlapping
            var alive = Set<UUID>()
            for item in plate.items {
                alive.insert(item.id)
                if let old = nodes[item.id], shapes[item.id] != ObjectIdentifier(item.mesh) {
                    old.removeFromParentNode() // split for painting: rebuild with the new triangles
                    nodes[item.id] = nil
                }
                guard let holder = nodes[item.id] ?? make(item) else { continue }
                holder.simdPosition = item.shift
                holder.simdOrientation = simd_quatf(item.rotation)
                holder.simdScale = SIMD3(repeating: item.scale)
                guard let meshNode = holder.childNodes.first, let geometry = meshNode.geometry else { continue }
                if looks[item.id] != item.look {
                    // Paint or filament changed: swap in new colours, keep the shape.
                    let fresh = SCNGeometry(sources: geometry.sources.filter { $0.semantic != .color } + [item.mesh.colorSource(plate.colors(for: item))],
                                            elements: geometry.elements)
                    fresh.materials = geometry.materials
                    meshNode.geometry = fresh
                    looks[item.id] = item.look
                }
                let material = meshNode.geometry?.firstMaterial
                if plate.isOffBed(item) || clashing.contains(item.id) {
                    material?.emission.contents = UIColor(red: 0.9, green: 0.1, blue: 0.1, alpha: 1)
                    material?.emission.intensity = 0.55
                } else if item.id == plate.selectedID && plate.mode != .paint {
                    material?.emission.contents = UIColor(red: 0, green: 0.83, blue: 0.67, alpha: 1)
                    material?.emission.intensity = 0.28
                } else {
                    material?.emission.intensity = 0
                }
            }
            for (id, node) in nodes where !alive.contains(id) {
                node.removeFromParentNode()
                nodes[id] = nil
                looks[id] = nil
            }
            // The cut plane sits across the selected model at the chosen height.
            if plate.mode == .cut, let item = plate.selected {
                let size = item.size
                if let plane = cutPlane.geometry as? SCNPlane {
                    plane.width = CGFloat(size.x + 16)
                    plane.height = CGFloat(size.y + 16)
                }
                cutPlane.simdPosition = SIMD3(item.x, item.y, plate.cutHeight)
                cutPlane.isHidden = false
            } else {
                cutPlane.isHidden = true
            }
        }

        private func make(_ item: PlateItem) -> SCNNode? {
            let geometry = item.mesh.geometry(colors: plate.colors(for: item))
            let material = SCNMaterial()
            material.lightingModel = .blinn
            material.diffuse.contents = UIColor.white // the per-triangle colours do the tinting
            material.isDoubleSided = true
            geometry.materials = [material]
            let meshNode = SCNNode(geometry: geometry)
            meshNode.simdPosition = -item.mesh.center // turn and scale about the model's own centre
            let holder = SCNNode()
            holder.name = item.id.uuidString
            holder.addChildNode(meshNode)
            world.addChildNode(holder)
            nodes[item.id] = holder
            looks[item.id] = item.look
            shapes[item.id] = ObjectIdentifier(item.mesh)
            return holder
        }

        private func rebuildBed() {
            bedSize = plate.bed
            bedNode?.removeFromParentNode()
            let plane = SCNPlane(width: CGFloat(bedSize.x), height: CGFloat(bedSize.y))
            let material = SCNMaterial()
            material.diffuse.contents = Self.grid(millimetres: CGFloat(bedSize.x))
            material.lightingModel = .constant
            material.isDoubleSided = true
            plane.materials = [material]
            let node = SCNNode(geometry: plane)
            node.simdPosition = SIMD3(bedSize.x / 2, bedSize.y / 2, -0.05)
            node.name = "bed"
            world.addChildNode(node)
            bedNode = node

            // Look from the front of the printer, a little above.
            let centre = SCNVector3(bedSize.x / 2, 0, -bedSize.y / 2)
            cameraNode.position = SCNVector3(bedSize.x / 2, bedSize.x * 1.25, bedSize.y * 0.75)
            cameraNode.look(at: centre)
            cameraNode.camera?.zNear = 1
            cameraNode.camera?.zFar = Double(bedSize.x) * 20
            view?.defaultCameraController.target = centre
        }

        /// A dark bed with a line every 10 mm and a stronger one every 50 mm.
        private static func grid(millimetres: CGFloat) -> UIImage {
            let scale: CGFloat = 4
            let side = millimetres * scale
            return UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { context in
                UIColor(white: 0.14, alpha: 1).setFill()
                context.fill(CGRect(x: 0, y: 0, width: side, height: side))
                var at: CGFloat = 0
                while at <= millimetres {
                    let strong = Int(at) % 50 == 0
                    UIColor(white: 1, alpha: strong ? 0.22 : 0.07).setFill()
                    let width: CGFloat = strong ? 3 : 2
                    context.fill(CGRect(x: at * scale - width / 2, y: 0, width: width, height: side))
                    context.fill(CGRect(x: 0, y: at * scale - width / 2, width: side, height: width))
                    at += 10
                }
                UIColor(red: 0, green: 0.83, blue: 0.67, alpha: 0.6).setStroke()
                let border = UIBezierPath(rect: CGRect(x: 3, y: 3, width: side - 6, height: side - 6))
                border.lineWidth = 6
                border.stroke()
            }
        }

        // MARK: Touch

        private func hit(at point: CGPoint) -> (id: UUID, result: SCNHitTestResult)? {
            guard let view else { return nil }
            let results = view.hitTest(point, options: [.searchMode: SCNHitTestSearchMode.all.rawValue, .ignoreHiddenNodes: true])
            for result in results {
                if let name = result.node.parent?.name, let id = UUID(uuidString: name) { return (id, result) }
            }
            return nil
        }

        /// Where a touch lands on the bed, in printer millimetres.
        private func bedPoint(at point: CGPoint) -> SIMD2<Float>? {
            guard let view else { return nil }
            let near = world.convertPosition(view.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 0)), from: nil)
            let far = world.convertPosition(view.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 1)), from: nil)
            let drop = near.z - far.z
            guard abs(drop) > 0.0001 else { return nil }
            let t = near.z / drop
            guard t > 0 else { return nil }
            return SIMD2(near.x + (far.x - near.x) * t, near.y + (far.y - near.y) * t)
        }

        @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
            let point = recognizer.location(in: view)
            guard let found = hit(at: point) else {
                if plate.mode != .paint && plate.mode != .cut {
                    plate.selectedID = nil
                    plate.mode = .move
                }
                sync()
                return
            }
            if plate.mode == .paint {
                plate.selectedID = found.id
                lastPaint = nil
                paintStroke(found)
                return
            }
            if plate.mode == .cut { return }
            plate.selectedID = found.id
            if plate.mode == .layFlat {
                let normal = world.convertVector(found.result.worldNormal, from: nil)
                plate.layFlat(found.id, faceDirection: SIMD3(normal.x, normal.y, normal.z))
            }
            sync()
        }

        /// Where the finger first touched. By the time a drag is recognised it has already moved.
        private var touchDown = CGPoint.zero

        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            if recognizer === panRecognizer { touchDown = touch.location(in: view) }
            return true
        }

        // Dragging a model moves it. The camera's own gestures wait, and only run when
        // the drag turns out to have started on empty space.
        func gestureRecognizer(_ recognizer: UIGestureRecognizer,
                               shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            recognizer === panRecognizer && !(other is UITapGestureRecognizer)
        }

        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard recognizer === panRecognizer else { return true }
            let point = touchDown
            if plate.mode == .paint {
                guard let found = hit(at: point) else { return false }
                plate.selectedID = found.id
                painting = found.id
                return true
            }
            guard plate.mode == .move, let found = hit(at: point), let start = bedPoint(at: point),
                  let item = plate.items.first(where: { $0.id == found.id }) else { return false }
            plate.selectedID = found.id
            drag = (found.id, SIMD2(item.x, item.y) - start)
            return true
        }

        private var lastPaint: (id: UUID, point: SIMD3<Float>)?

        private func paintStroke(_ found: (id: UUID, result: SCNHitTestResult)) {
            let local = found.result.localCoordinates
            let point = SIMD3<Float>(local.x, local.y, local.z)
            // Fill the gap since the last touch point, so fast strokes stay solid.
            if let last = lastPaint, last.id == found.id, let item = plate.items.first(where: { $0.id == found.id }) {
                let step = max(plate.brushSize / max(item.scale, 0.01) * 0.5, 0.2)
                let gap = simd_distance(last.point, point)
                if gap > step, gap < step * 40 {
                    let count = Int(gap / step)
                    for i in 1..<max(count, 1) {
                        plate.paint(found.id, at: last.point + (point - last.point) * (Float(i) / Float(count)), triangle: -1)
                    }
                }
            }
            plate.paint(found.id, at: point, triangle: found.result.faceIndex)
            lastPaint = (found.id, point)
            sync()
        }

        @objc private func panned(_ recognizer: UIPanGestureRecognizer) {
            if let painting {
                if recognizer.state == .began || recognizer.state == .changed,
                   let found = hit(at: recognizer.location(in: view)), found.id == painting {
                    paintStroke(found)
                }
                if recognizer.state == .ended || recognizer.state == .cancelled || recognizer.state == .failed {
                    self.painting = nil
                    lastPaint = nil
                }
                return
            }
            guard let drag else { return }
            if recognizer.state == .changed, let point = bedPoint(at: recognizer.location(in: view)) {
                plate.move(drag.id, to: point + drag.offset)
                sync()
            }
            if recognizer.state == .ended || recognizer.state == .cancelled || recognizer.state == .failed {
                self.drag = nil
            }
        }
    }
}
