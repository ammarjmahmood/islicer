import Foundation
import Observation
import SwiftUI
import simd

/// A filament the plate can use. Slot 1 is the default for every model.
struct FilamentSlot: Identifiable, Equatable {
    let id = UUID()
    var type: Filament
    var color: Color

    var hex: String {
        let ui = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
    }

    var rgba: SIMD4<Float> {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        return SIMD4(Float(r), Float(g), Float(b), 1)
    }

    static let palette: [Color] = [
        Color(red: 0.86, green: 0.86, blue: 0.84), Color(red: 0.9, green: 0.28, blue: 0.3),
        Color(red: 0.23, green: 0.51, blue: 0.96), Color(red: 0.96, green: 0.72, blue: 0.24),
    ]
}

/// Settings one model can change for itself. Nil means "same as the plate".
struct ObjectSettings: Equatable {
    var infill: Int?
    var walls: Int?
    /// nil, "off", "tree" or "normal"
    var supports: String?

    var isEmpty: Bool { infill == nil && walls == nil && supports == nil }
}

/// What can be painted on a model. Each is one value per triangle.
enum PaintBrush: String, CaseIterable, Identifiable {
    case support, block, seam, color, erase
    var id: String { rawValue }
    var label: String {
        switch self {
        case .support: return "Support"
        case .block: return "Block"
        case .seam: return "Seam"
        case .color: return "Colour"
        case .erase: return "Erase"
        }
    }
    var symbol: String {
        switch self {
        case .support: return "square.stack.3d.up"
        case .block: return "nosign"
        case .seam: return "scribble"
        case .color: return "paintbrush.pointed"
        case .erase: return "eraser"
        }
    }
}

struct Paint: Equatable {
    /// 1 = add support here, 2 = never support here
    var supports: [UInt8]
    /// 1 = put the seam here
    var seam: [UInt8]
    /// filament slot (1-based); 0 = the model's own filament
    var color: [UInt8]

    init(count: Int) {
        supports = Array(repeating: 0, count: count)
        seam = supports
        color = supports
    }

    var isEmpty: Bool { !supports.contains { $0 != 0 } && !seam.contains { $0 != 0 } && !color.contains { $0 != 0 } }

    /// Carries paint over to a new mesh made from this one (`from[i]` = source triangle, or -1).
    func remapped(_ from: [Int]) -> Paint {
        var out = Paint(count: from.count)
        for (i, source) in from.enumerated() where source >= 0 && source < supports.count {
            out.supports[i] = supports[source]
            out.seam[i] = seam[source]
            out.color[i] = color[source]
        }
        return out
    }
}

/// One model on the plate. Coordinates are the printer's: millimetres, Z up,
/// origin at the front-left corner of the bed. Matches `server/plate.js`.
struct PlateItem: Identifiable {
    let id = UUID()
    var name: String
    var mesh: TriMesh
    var rotation = matrix_identity_float3x3
    var scale: Float = 1
    /// Where the centre of the model's footprint sits on the bed.
    var x: Float
    var y: Float
    /// Bounding box after rotation and scale, before it is moved into place.
    var low = SIMD3<Float>(repeating: 0)
    var high = SIMD3<Float>(repeating: 0)
    /// Outline of the footprint (convex), relative to (x, y).
    var hull: [SIMD2<Float>] = []
    var extruder = 1
    var settings = ObjectSettings()
    var paint: Paint
    /// Bumped when paint or filament changes, so only this model is redrawn.
    var look = 0
    /// Split into small triangles for painting yet?
    var refined = false

    init(name: String, mesh: TriMesh, x: Float, y: Float) {
        self.name = name
        self.mesh = mesh
        self.x = x
        self.y = y
        paint = Paint(count: mesh.triangleCount)
    }

    var size: SIMD3<Float> { high - low }
    /// Moves the turned model so it rests on the bed with its footprint centred at (x, y).
    var shift: SIMD3<Float> { SIMD3(x - (low.x + high.x) / 2, y - (low.y + high.y) / 2, -low.z) }
    var outline: [SIMD2<Float>] { hull.map { $0 + SIMD2(x, y) } }
}

/// The build plate being laid out.
@MainActor
@Observable
final class PlateModel {
    enum Mode: Equatable { case move, layFlat, cut, paint }

    var items: [PlateItem] = []
    var selectedID: UUID? { didSet { if selectedID == nil, mode != .move { mode = .move } } }
    var printer: PrinterModel = .P1S { didSet { revision += 1 } }
    var filaments = [FilamentSlot(type: .PLA, color: FilamentSlot.palette[0])] { didSet { recolorAll() } }
    var mode: Mode = .move { didSet { revision += 1 } }
    var cutHeight: Float = 0 { didSet { revision += 1 } }
    var brush: PaintBrush = .support
    var brushSlot = 2
    var brushSize: Float = 4
    /// Bumped on every change so the 3D view knows to redraw.
    private(set) var revision = 0

    var bed: SIMD3<Float> {
        switch printer {
        case .A1Mini: return SIMD3(180, 180, 180)
        case .A1: return SIMD3(256, 256, 256)
        default: return SIMD3(256, 256, 250)
        }
    }

    var selected: PlateItem? { items.first { $0.id == selectedID } }
    private func index(_ id: UUID?) -> Int? { items.firstIndex { $0.id == id } }
    private func touch() { revision += 1 }

    private func measure(_ item: inout PlateItem) {
        let mesh = item.mesh
        var low = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
        var high = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
        var flat: [SIMD2<Float>] = []
        flat.reserveCapacity(mesh.positions.count)
        let turn = item.rotation, scale = item.scale, center = mesh.center
        for vertex in mesh.positions {
            let point = turn * ((vertex - center) * scale)
            low = simd_min(low, point)
            high = simd_max(high, point)
            flat.append(SIMD2(point.x, point.y))
        }
        item.low = low
        item.high = high
        let mid = SIMD2((low.x + high.x) / 2, (low.y + high.y) / 2)
        item.hull = Self.convexHull(flat).map { $0 - mid }
    }

    private func recolorAll() {
        for i in items.indices { items[i].look += 1 }
        touch()
    }

    // MARK: Adding

    @discardableResult
    func add(_ file: ModelFile) -> Bool {
        guard file.isSTL, let mesh = TriMesh.load(file.url) else { return false }
        add(name: file.url.deletingPathExtension().lastPathComponent, mesh: mesh)
        return true
    }

    func add(name: String, mesh: TriMesh, arrangeAfter: Bool = true) {
        var item = PlateItem(name: name, mesh: mesh, x: bed.x / 2, y: bed.y / 2)
        measure(&item)
        items.append(item)
        selectedID = item.id
        if items.count > 1, arrangeAfter { arrange() } else { touch() }
    }

    func duplicateSelected() {
        guard let at = index(selectedID) else { return }
        var copy = PlateItem(name: items[at].name, mesh: items[at].mesh, x: items[at].x, y: items[at].y)
        copy.rotation = items[at].rotation
        copy.scale = items[at].scale
        copy.extruder = items[at].extruder
        copy.settings = items[at].settings
        copy.paint = items[at].paint
        copy.refined = items[at].refined
        measure(&copy)
        items.append(copy)
        selectedID = copy.id
        arrange()
    }

    func deleteSelected() {
        items.removeAll { $0.id == selectedID }
        selectedID = items.last?.id
        touch()
    }

    // MARK: Turning, sizing, moving

    func rotateSelected(axis: SIMD3<Float>, degrees: Float) {
        guard let at = index(selectedID) else { return }
        let turn = simd_float3x3(simd_quatf(angle: degrees * .pi / 180, axis: axis))
        items[at].rotation = turn * items[at].rotation
        measure(&items[at])
        keepOnBed(at)
        touch()
    }

    /// Turns the model so the tapped face (its outward direction, in printer space) rests on the bed.
    func layFlat(_ id: UUID, faceDirection: SIMD3<Float>) {
        guard let at = index(id) else { return }
        let from = simd_normalize(faceDirection)
        let down = SIMD3<Float>(0, 0, -1)
        let turn: simd_float3x3
        if simd_dot(from, down) < -0.9999 {
            turn = simd_float3x3(simd_quatf(angle: .pi, axis: SIMD3(1, 0, 0)))
        } else {
            turn = simd_float3x3(simd_quatf(from: from, to: down))
        }
        items[at].rotation = turn * items[at].rotation
        measure(&items[at])
        keepOnBed(at)
        mode = .move
        touch()
    }

    func resetRotation() {
        guard let at = index(selectedID) else { return }
        items[at].rotation = matrix_identity_float3x3
        measure(&items[at])
        keepOnBed(at)
        touch()
    }

    func setScale(_ scale: Float) {
        guard let at = index(selectedID) else { return }
        items[at].scale = min(max(scale, 0.05), 10)
        measure(&items[at])
        keepOnBed(at)
        touch()
    }

    func move(_ id: UUID, to point: SIMD2<Float>) {
        guard let at = index(id) else { return }
        items[at].x = point.x
        items[at].y = point.y
        keepOnBed(at)
        touch()
    }

    private func keepOnBed(_ at: Int) {
        let half = items[at].size / 2
        if half.x * 2 <= bed.x { items[at].x = min(max(items[at].x, half.x), bed.x - half.x) }
        if half.y * 2 <= bed.y { items[at].y = min(max(items[at].y, half.y), bed.y - half.y) }
    }

    /// Packs everything into rows with a small gap, centred on the bed.
    func arrange() {
        let gap: Float = 8
        let order = items.indices.sorted { items[$0].size.y > items[$1].size.y }
        var cursor = SIMD2<Float>(0, 0)
        var rowDepth: Float = 0
        var width: Float = 0
        var placed: [(Int, SIMD2<Float>)] = []
        for at in order {
            let size = items[at].size
            if cursor.x > 0, cursor.x + size.x > bed.x - 2 * gap {
                cursor = SIMD2(0, cursor.y + rowDepth + gap)
                rowDepth = 0
            }
            placed.append((at, SIMD2(cursor.x + size.x / 2, cursor.y + size.y / 2)))
            cursor.x += size.x + gap
            width = max(width, cursor.x - gap)
            rowDepth = max(rowDepth, size.y)
        }
        let depth = cursor.y + rowDepth
        let offset = SIMD2((bed.x - width) / 2, (bed.y - depth) / 2)
        for (at, point) in placed {
            items[at].x = point.x + offset.x
            items[at].y = point.y + offset.y
        }
        touch()
    }

    // MARK: Per-model settings

    func setExtruder(_ slot: Int) {
        guard let at = index(selectedID) else { return }
        items[at].extruder = min(max(slot, 1), filaments.count)
        items[at].look += 1
        touch()
    }

    func setSettings(_ settings: ObjectSettings) {
        guard let at = index(selectedID) else { return }
        items[at].settings = settings
        touch()
    }

    func addFilament() {
        guard filaments.count < 4 else { return }
        filaments.append(FilamentSlot(type: filaments.last?.type ?? .PLA, color: FilamentSlot.palette[filaments.count % 4]))
    }

    func removeFilament(at slot: Int) {
        guard filaments.count > 1, filaments.indices.contains(slot) else { return }
        let number = slot + 1
        filaments.remove(at: slot)
        for i in items.indices {
            if items[i].extruder == number { items[i].extruder = 1 } else if items[i].extruder > number { items[i].extruder -= 1 }
            items[i].paint.color = items[i].paint.color.map { $0 == number ? 0 : ($0 > number ? $0 - 1 : $0) }
        }
        brushSlot = min(brushSlot, filaments.count)
        recolorAll()
    }

    // MARK: Cutting

    /// Cuts the selected model at `cutHeight` (millimetres above the bed).
    /// The top piece is turned over so its flat cut face sits on the bed.
    func cutSelected(keep: CutKeep, flipTop: Bool) {
        guard let at = index(selectedID) else { return }
        let item = items[at]
        let baked = item.mesh.baked(rotation: item.rotation, scale: item.scale)
        // In baked space the bed is at item.low.z.
        guard let pieces = baked.cut(at: item.low.z + cutHeight) else { return }
        var made: [PlateItem] = []
        func piece(_ mesh: TriMesh, _ from: [Int], suffix: String, flip: Bool) {
            var part = PlateItem(name: "\(item.name) (\(suffix))", mesh: mesh, x: item.x, y: item.y)
            part.extruder = item.extruder
            part.settings = item.settings
            part.paint = item.paint.remapped(from)
            if flip { part.rotation = simd_float3x3(simd_quatf(angle: .pi, axis: SIMD3(1, 0, 0))) }
            measure(&part)
            made.append(part)
        }
        if keep != .top { piece(pieces.below.0, pieces.below.1, suffix: "bottom", flip: false) }
        if keep != .bottom { piece(pieces.above.0, pieces.above.1, suffix: "top", flip: flipTop) }
        items.remove(at: at)
        items.append(contentsOf: made)
        selectedID = made.last?.id
        mode = .move
        if items.count > 1 { arrange() } else { touch() }
    }

    enum CutKeep: String, CaseIterable, Identifiable {
        case both = "Both", bottom = "Bottom", top = "Top"
        var id: String { rawValue }
    }

    // MARK: Painting

    /// Paints every triangle within the brush of `point` (in the model's own file coordinates).
    func paint(_ id: UUID, at point: SIMD3<Float>, triangle: Int) {
        guard let at = index(id) else { return }
        var triangle = triangle
        if !items[at].refined {
            refineForPaint(at)
            triangle = -1 // the old index no longer applies
        }
        let radius = brushSize / max(items[at].scale, 0.01)
        let limit = radius * radius
        let centroids = items[at].mesh.centroids
        var paint = items[at].paint
        func apply(_ t: Int) {
            switch brush {
            case .support: paint.supports[t] = 1
            case .block: paint.supports[t] = 2
            case .seam: paint.seam[t] = 1
            case .color: paint.color[t] = UInt8(min(brushSlot, filaments.count))
            case .erase:
                paint.supports[t] = 0; paint.seam[t] = 0; paint.color[t] = 0
            }
        }
        if triangle >= 0, triangle < centroids.count { apply(triangle) }
        for t in centroids.indices where simd_distance_squared(centroids[t], point) <= limit { apply(t) }
        guard paint != items[at].paint else { return }
        items[at].paint = paint
        items[at].look += 1
        touch()
    }

    /// Large flat faces are only a couple of triangles; split them so paint lands where the finger is.
    private func refineForPaint(_ at: Int) {
        let edge = max(1.5, 2 / max(items[at].scale, 0.01))
        let (mesh, from) = items[at].mesh.refined(maxEdge: edge)
        items[at].paint = items[at].paint.remapped(from)
        items[at].mesh = mesh
        items[at].refined = true
        items[at].look += 1
    }

    func clearPaint() {
        guard let at = index(selectedID) else { return }
        items[at].paint = Paint(count: items[at].mesh.triangleCount)
        items[at].look += 1
        touch()
    }

    /// One colour per triangle, for drawing.
    func colors(for item: PlateItem) -> [SIMD4<Float>] {
        let base = filaments[min(item.extruder, filaments.count) - 1].rgba
        let support = SIMD4<Float>(0.1, 0.85, 0.55, 1)
        let block = SIMD4<Float>(0.95, 0.25, 0.3, 1)
        let seam = SIMD4<Float>(0.35, 0.45, 1, 1)
        var out = [SIMD4<Float>](repeating: base, count: item.mesh.triangleCount)
        for t in out.indices {
            let slot = Int(item.paint.color[t])
            if slot > 0, slot <= filaments.count { out[t] = filaments[slot - 1].rgba }
            if item.paint.seam[t] == 1 { out[t] = seam }
            if item.paint.supports[t] == 1 { out[t] = support } else if item.paint.supports[t] == 2 { out[t] = block }
        }
        return out
    }

    // MARK: Checks

    func isOffBed(_ item: PlateItem) -> Bool {
        let half = item.size / 2
        return item.x - half.x < -0.5 || item.y - half.y < -0.5
            || item.x + half.x > bed.x + 0.5 || item.y + half.y > bed.y + 0.5 || item.size.z > bed.z
    }

    /// Models whose footprints overlap another model's.
    var overlapping: Set<UUID> {
        var hits = Set<UUID>()
        for i in items.indices {
            for j in items.indices where j > i {
                if Self.overlap(items[i].outline, items[j].outline) {
                    hits.insert(items[i].id)
                    hits.insert(items[j].id)
                }
            }
        }
        return hits
    }

    /// Nil when everything fits; otherwise what is wrong, in plain words.
    var problem: String? {
        if items.isEmpty { return "Add a model to the plate." }
        if items.contains(where: { $0.size.z > bed.z }) { return "A model is taller than this printer can print." }
        if items.contains(where: isOffBed) { return "A model hangs over the edge of the bed." }
        if !overlapping.isEmpty { return "Two models overlap. Move them apart or tap Arrange." }
        return nil
    }

    var summary: String {
        items.count == 1 ? items[0].name : "\(items.count) models"
    }

    /// Filament slots the plate actually uses (at least slot 1).
    var slotsUsed: Int {
        var top = 1
        for item in items {
            top = max(top, item.extruder)
            if let painted = item.paint.color.max() { top = max(top, Int(painted)) }
        }
        return min(top, filaments.count)
    }

    // MARK: Geometry helpers

    static func convexHull(_ points: [SIMD2<Float>]) -> [SIMD2<Float>] {
        // Round to 0.1 mm first: large meshes have many near-identical points.
        var seen = Set<SIMD2<Int32>>()
        var unique: [SIMD2<Float>] = []
        for p in points {
            let key = SIMD2(Int32((p.x * 10).rounded()), Int32((p.y * 10).rounded()))
            if seen.insert(key).inserted { unique.append(p) }
        }
        let sorted = unique.sorted { $0.x == $1.x ? $0.y < $1.y : $0.x < $1.x }
        guard sorted.count > 2 else { return sorted }
        func cross(_ o: SIMD2<Float>, _ a: SIMD2<Float>, _ b: SIMD2<Float>) -> Float {
            (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
        }
        var lower: [SIMD2<Float>] = []
        for p in sorted {
            while lower.count >= 2, cross(lower[lower.count - 2], lower[lower.count - 1], p) <= 0 { lower.removeLast() }
            lower.append(p)
        }
        var upper: [SIMD2<Float>] = []
        for p in sorted.reversed() {
            while upper.count >= 2, cross(upper[upper.count - 2], upper[upper.count - 1], p) <= 0 { upper.removeLast() }
            upper.append(p)
        }
        return Array(lower.dropLast() + upper.dropLast())
    }

    /// Separating-axis test for two convex outlines; touching or a hair apart is fine.
    static func overlap(_ a: [SIMD2<Float>], _ b: [SIMD2<Float>]) -> Bool {
        guard a.count > 2, b.count > 2 else { return false }
        for polygon in [a, b] {
            for i in polygon.indices {
                let edge = polygon[(i + 1) % polygon.count] - polygon[i]
                let axis = simd_normalize(SIMD2(-edge.y, edge.x))
                guard axis.x.isFinite else { continue }
                let pa = a.map { simd_dot($0, axis) }, pb = b.map { simd_dot($0, axis) }
                if pa.max()! <= pb.min()! + 0.3 || pb.max()! <= pa.min()! + 0.3 { return false }
            }
        }
        return true
    }

    // MARK: For the bridge

    /// Writes each distinct mesh to a temporary STL and describes the layout that refers to them.
    func payload() throws -> (files: [URL], layout: [[String: Any]]) {
        let folder = FileManager.default.temporaryDirectory.appending(path: "plate-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var files: [URL] = []
        var written: [ObjectIdentifier: Int] = [:]
        var layout: [[String: Any]] = []
        for item in items {
            let key = ObjectIdentifier(item.mesh)
            let at: Int
            if let known = written[key] {
                at = known
            } else {
                let url = folder.appending(path: "model\(files.count + 1).stl")
                try item.mesh.stlData().write(to: url)
                files.append(url)
                at = files.count - 1
                written[key] = at
            }
            let m = item.rotation
            var entry: [String: Any] = [
                "file": at,
                "name": item.name,
                // row-major 3x3
                "matrix": [m.columns.0.x, m.columns.1.x, m.columns.2.x,
                           m.columns.0.y, m.columns.1.y, m.columns.2.y,
                           m.columns.0.z, m.columns.1.z, m.columns.2.z].map { Double($0) },
                "scale": Double(item.scale),
                "x": Double(item.x),
                "y": Double(item.y),
                "extruder": min(item.extruder, filaments.count),
            ]
            var settings: [String: Any] = [:]
            if let infill = item.settings.infill { settings["infill"] = infill }
            if let walls = item.settings.walls { settings["walls"] = walls }
            if let supports = item.settings.supports { settings["supports"] = supports }
            if !settings.isEmpty { entry["settings"] = settings }
            if !item.paint.isEmpty {
                func groups(_ states: [UInt8]) -> [String: [Int]]? {
                    var out: [String: [Int]] = [:]
                    for (t, state) in states.enumerated() where state != 0 { out[String(state), default: []].append(t) }
                    return out.isEmpty ? nil : out
                }
                var paint: [String: Any] = [:]
                if let g = groups(item.paint.supports) { paint["supports"] = g }
                if let g = groups(item.paint.seam) { paint["seam"] = g }
                if let g = groups(item.paint.color) { paint["color"] = g }
                entry["paint"] = paint
            }
            layout.append(entry)
        }
        return (files, layout)
    }
}
