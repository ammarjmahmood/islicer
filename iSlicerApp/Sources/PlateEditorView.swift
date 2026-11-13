import SceneKit
import SwiftUI

/// Lay models out on the bed: add, drag, turn, scale, lay flat, duplicate, arrange.
struct PlateEditorView: View {
    @Environment(AppModel.self) private var model
    let file: ModelFile
    @State private var plate = PlateModel()
    @State private var started = false

    var body: some View {
        VStack(spacing: 0) {
            PlateSceneView(plate: plate, revision: plate.revision, selected: plate.selectedID, layingFlat: plate.layingFlat)
                .overlay(alignment: .bottom) {
                    Group {
                        if plate.layingFlat {
                            Text("Tap the face that should sit on the bed")
                                .foregroundStyle(.black)
                                .padding(.horizontal, 12).padding(.vertical, 7)
                                .background(.tint, in: Capsule())
                        } else if let problem = plate.problem {
                            Label(problem, systemImage: "exclamationmark.triangle.fill")
                                .padding(.horizontal, 12).padding(.vertical, 7)
                                .background(.red.opacity(0.85), in: Capsule())
                        }
                    }
                    .font(.footnote.weight(.semibold))
                    .padding(.bottom, 10)
                }
            controls
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 8)
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
                Menu {
                    ForEach(model.files.filter(\.isSTL)) { candidate in
                        Button(candidate.name) { plate.add(candidate) }
                    }
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .onAppear {
            guard !started else { return }
            started = true
            if let first = model.printers.first, let known = PrinterModel(rawValue: first.model) { plate.printer = known }
            plate.add(file)
        }
    }

    private var controls: some View {
        VStack(spacing: 10) {
            if let item = plate.selected {
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
                Text(String(format: "%.0f × %.0f × %.0f mm", item.size.x, item.size.y, item.size.z))
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 8) {
                    pill(plate.layingFlat ? "Cancel" : "Lay flat", "square.3.layers.3d.down.right") { plate.layingFlat.toggle() }
                    pill("Duplicate", "plus.square.on.square") { plate.duplicateSelected() }
                    pill("Remove", "trash") { plate.deleteSelected() }
                }
            } else {
                Text(plate.items.isEmpty ? "Add a model with ＋" : "Tap a model to select it. Drag it to move. Drag the background to look around.")
                    .font(.footnote).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
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
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
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

/// The 3D bed. Printer space (Z up) lives inside `world`, which is tipped to SceneKit's Y-up.
struct PlateSceneView: UIViewRepresentable {
    let plate: PlateModel
    // Read here so SwiftUI calls updateUIView when the plate changes.
    let revision: Int
    let selected: UUID?
    let layingFlat: Bool

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
            var alive = Set<UUID>()
            for item in plate.items {
                alive.insert(item.id)
                guard let holder = nodes[item.id] ?? make(item) else { continue }
                holder.simdPosition = item.shift
                holder.simdOrientation = simd_quatf(item.rotation)
                holder.simdScale = SIMD3(repeating: item.scale)
                let color: UIColor
                if plate.isOffBed(item) {
                    color = UIColor(red: 0.95, green: 0.3, blue: 0.3, alpha: 1)
                } else if item.id == plate.selectedID {
                    color = UIColor(red: 0, green: 0.83, blue: 0.67, alpha: 1)
                } else {
                    color = UIColor(white: 0.72, alpha: 1)
                }
                holder.childNodes.first?.geometry?.firstMaterial?.diffuse.contents = color
            }
            for (id, node) in nodes where !alive.contains(id) {
                node.removeFromParentNode()
                nodes[id] = nil
            }
        }

        private func make(_ item: PlateItem) -> SCNNode? {
            guard let mesh = MeshCache.mesh(for: item.file.url),
                  let geometry = mesh.geometry.copy() as? SCNGeometry else { return nil }
            let material = SCNMaterial()
            material.lightingModel = .blinn
            material.isDoubleSided = true
            geometry.materials = [material]
            let meshNode = SCNNode(geometry: geometry)
            meshNode.simdPosition = -mesh.center // turn and scale about the model's own centre
            let holder = SCNNode()
            holder.name = item.id.uuidString
            holder.addChildNode(meshNode)
            world.addChildNode(holder)
            nodes[item.id] = holder
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
            for result in view.hitTest(point, options: [.searchMode: SCNHitTestSearchMode.closest.rawValue]) {
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
                plate.selectedID = nil
                plate.layingFlat = false
                sync()
                return
            }
            plate.selectedID = found.id
            if plate.layingFlat {
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
            guard !plate.layingFlat, let found = hit(at: point), let start = bedPoint(at: point),
                  let item = plate.items.first(where: { $0.id == found.id }) else { return false }
            plate.selectedID = found.id
            drag = (found.id, SIMD2(item.x, item.y) - start)
            return true
        }

        @objc private func panned(_ recognizer: UIPanGestureRecognizer) {
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
