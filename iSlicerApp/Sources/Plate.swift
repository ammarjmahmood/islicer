import Foundation
import Observation
import SceneKit
import SceneKit.ModelIO
import simd

/// A loaded STL: the geometry to draw, plus its points for measuring.
struct Mesh {
    let geometry: SCNGeometry
    let vertices: [SIMD3<Float>]
    /// Centre of the file's own bounding box. Rotation and scale happen about this point.
    let center: SIMD3<Float>
}

@MainActor
enum MeshCache {
    private static var cache: [URL: Mesh] = [:]

    static func mesh(for url: URL) -> Mesh? {
        if let hit = cache[url] { return hit }
        let asset = MDLAsset(url: url)
        guard asset.count > 0 else { return nil }
        // An STL holds one mesh. (A flattened clone would hide its vertex data.)
        let holder = SCNScene(mdlAsset: asset).rootNode.childNodes(passingTest: { node, _ in node.geometry != nil }).first
        guard let geometry = holder?.geometry, let source = geometry.sources(for: .vertex).first,
              source.usesFloatComponents, source.bytesPerComponent == 4, source.componentsPerVector >= 3 else { return nil }
        var points: [SIMD3<Float>] = []
        points.reserveCapacity(source.vectorCount)
        var low = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
        var high = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
        source.data.withUnsafeBytes { raw in
            for index in 0..<source.vectorCount {
                let at = source.dataOffset + index * source.dataStride
                let point = SIMD3<Float>(raw.loadUnaligned(fromByteOffset: at, as: Float.self),
                                         raw.loadUnaligned(fromByteOffset: at + 4, as: Float.self),
                                         raw.loadUnaligned(fromByteOffset: at + 8, as: Float.self))
                points.append(point)
                low = simd_min(low, point)
                high = simd_max(high, point)
            }
        }
        guard !points.isEmpty else { return nil }
        let mesh = Mesh(geometry: geometry, vertices: points, center: (low + high) / 2)
        cache[url] = mesh
        return mesh
    }
}

/// One model on the plate. Coordinates are the printer's: millimetres, Z up,
/// origin at the front-left corner of the bed. Matches `server/plate.js`.
struct PlateItem: Identifiable {
    let id = UUID()
    let file: ModelFile
    var rotation = matrix_identity_float3x3
    var scale: Float = 1
    /// Where the centre of the model's footprint sits on the bed.
    var x: Float
    var y: Float
    /// Bounding box after rotation and scale, before it is moved into place.
    var low = SIMD3<Float>(repeating: 0)
    var high = SIMD3<Float>(repeating: 0)

    var size: SIMD3<Float> { high - low }
    /// Moves the turned model so it rests on the bed with its footprint centred at (x, y).
    var shift: SIMD3<Float> { SIMD3(x - (low.x + high.x) / 2, y - (low.y + high.y) / 2, -low.z) }
}

/// The build plate being laid out.
@MainActor
@Observable
final class PlateModel {
    var items: [PlateItem] = []
    var selectedID: UUID?
    var printer: PrinterModel = .P1S { didSet { revision += 1 } }
    var layingFlat = false
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

    private func measure(_ item: inout PlateItem) {
        guard let mesh = MeshCache.mesh(for: item.file.url) else { return }
        var low = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
        var high = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
        let turn = item.rotation, scale = item.scale, center = mesh.center
        for vertex in mesh.vertices {
            let point = turn * ((vertex - center) * scale)
            low = simd_min(low, point)
            high = simd_max(high, point)
        }
        item.low = low
        item.high = high
    }

    private func touch() { revision += 1 }

    // MARK: Editing

    @discardableResult
    func add(_ file: ModelFile) -> Bool {
        guard file.isSTL, MeshCache.mesh(for: file.url) != nil else { return false }
        var item = PlateItem(file: file, x: bed.x / 2, y: bed.y / 2)
        measure(&item)
        items.append(item)
        selectedID = item.id
        if items.count > 1 { arrange() } else { touch() }
        return true
    }

    func duplicateSelected() {
        guard let at = index(selectedID) else { return }
        var copy = PlateItem(file: items[at].file, x: items[at].x, y: items[at].y)
        copy.rotation = items[at].rotation
        copy.scale = items[at].scale
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

    /// Turns the selected model about one of the printer's axes.
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
        layingFlat = false
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

    // MARK: Checks

    func isOffBed(_ item: PlateItem) -> Bool {
        let half = item.size / 2
        return item.x - half.x < -0.5 || item.y - half.y < -0.5
            || item.x + half.x > bed.x + 0.5 || item.y + half.y > bed.y + 0.5 || item.size.z > bed.z
    }

    /// Nil when everything fits; otherwise what is wrong, in plain words.
    var problem: String? {
        if items.isEmpty { return "Add a model to the plate." }
        if items.contains(where: { $0.size.z > bed.z }) { return "A model is taller than this printer can print." }
        if items.contains(where: isOffBed) { return "A model hangs over the edge of the bed." }
        return nil
    }

    var summary: String {
        items.count == 1 ? items[0].file.name : "\(items.count) models"
    }

    // MARK: For the bridge

    /// Distinct files to upload, and the layout that refers to them by position.
    var payload: (files: [URL], layout: [[String: Any]]) {
        var files: [URL] = []
        var layout: [[String: Any]] = []
        for item in items {
            let at = files.firstIndex(of: item.file.url) ?? { files.append(item.file.url); return files.count - 1 }()
            let m = item.rotation
            layout.append([
                "file": at,
                // row-major 3x3
                "matrix": [m.columns.0.x, m.columns.1.x, m.columns.2.x,
                           m.columns.0.y, m.columns.1.y, m.columns.2.y,
                           m.columns.0.z, m.columns.1.z, m.columns.2.z].map { Double($0) },
                "scale": Double(item.scale),
                "x": Double(item.x),
                "y": Double(item.y),
            ])
        }
        return (files, layout)
    }
}
