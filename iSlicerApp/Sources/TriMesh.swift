import Foundation
import SceneKit
import simd

/// A model as a plain list of triangles (three corners each), in millimetres.
/// Triangle order matters: painted triangles are sent to the bridge by index.
final class TriMesh {
    let positions: [SIMD3<Float>]
    let center: SIMD3<Float>
    let low: SIMD3<Float>
    let high: SIMD3<Float>
    var triangleCount: Int { positions.count / 3 }

    init(positions: [SIMD3<Float>]) {
        self.positions = positions
        var low = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
        var high = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
        for point in positions {
            low = simd_min(low, point)
            high = simd_max(high, point)
        }
        if positions.isEmpty { low = .zero; high = .zero }
        self.low = low
        self.high = high
        center = (low + high) / 2
    }

    private(set) lazy var centroids: [SIMD3<Float>] = (0..<triangleCount).map {
        (positions[$0 * 3] + positions[$0 * 3 + 1] + positions[$0 * 3 + 2]) / 3
    }

    // MARK: STL

    private static var cache: [URL: TriMesh] = [:]

    static func load(_ url: URL) -> TriMesh? {
        if let hit = cache[url] { return hit }
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe), let mesh = parse(data) else { return nil }
        cache[url] = mesh
        return mesh
    }

    static func parse(_ data: Data) -> TriMesh? {
        guard data.count >= 84 else { return nil }
        let count = data.withUnsafeBytes { Int($0.loadUnaligned(fromByteOffset: 80, as: UInt32.self)) }
        if data.count == 84 + count * 50, count > 0 {
            var points: [SIMD3<Float>] = []
            points.reserveCapacity(count * 3)
            data.withUnsafeBytes { raw in
                for t in 0..<count {
                    let base = 84 + t * 50 + 12
                    for k in 0..<3 {
                        let at = base + k * 12
                        points.append(SIMD3(raw.loadUnaligned(fromByteOffset: at, as: Float.self),
                                            raw.loadUnaligned(fromByteOffset: at + 4, as: Float.self),
                                            raw.loadUnaligned(fromByteOffset: at + 8, as: Float.self)))
                    }
                }
            }
            return TriMesh(positions: points)
        }
        // ASCII STL
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .ascii) else { return nil }
        var points: [SIMD3<Float>] = []
        for line in text.split(whereSeparator: \.isNewline) {
            let parts = line.split(separator: " ", omittingEmptySubsequences: true)
            if parts.count == 4, parts[0] == "vertex",
               let x = Float(parts[1]), let y = Float(parts[2]), let z = Float(parts[3]) {
                points.append(SIMD3(x, y, z))
            }
        }
        guard !points.isEmpty, points.count % 3 == 0 else { return nil }
        return TriMesh(positions: points)
    }

    func stlData() -> Data {
        var data = Data(count: 84 + triangleCount * 50)
        data.withUnsafeMutableBytes { raw in
            raw.storeBytes(of: UInt32(triangleCount).littleEndian, toByteOffset: 80, as: UInt32.self)
            for t in 0..<triangleCount {
                let a = positions[t * 3], b = positions[t * 3 + 1], c = positions[t * 3 + 2]
                let n = simd_normalize(simd_cross(b - a, c - a))
                var at = 84 + t * 50
                for v in [n.x.isFinite ? n : .zero, a, b, c] {
                    raw.storeBytes(of: v.x, toByteOffset: at, as: Float.self)
                    raw.storeBytes(of: v.y, toByteOffset: at + 4, as: Float.self)
                    raw.storeBytes(of: v.z, toByteOffset: at + 8, as: Float.self)
                    at += 12
                }
            }
        }
        return data
    }

    // MARK: Drawing

    /// Flat-shaded geometry with one colour per triangle.
    func geometry(colors: [SIMD4<Float>]) -> SCNGeometry {
        var normals: [SIMD3<Float>] = []
        normals.reserveCapacity(positions.count)
        for t in 0..<triangleCount {
            let a = positions[t * 3], b = positions[t * 3 + 1], c = positions[t * 3 + 2]
            var n = simd_cross(b - a, c - a)
            let length = simd_length(n)
            n = length > 0 ? n / length : SIMD3(0, 0, 1)
            normals.append(contentsOf: [n, n, n])
        }
        let vertexSource = SCNGeometrySource(vertices: positions.map { SCNVector3($0.x, $0.y, $0.z) })
        let normalSource = SCNGeometrySource(normals: normals.map { SCNVector3($0.x, $0.y, $0.z) })
        let element = SCNGeometryElement(indices: (0..<UInt32(positions.count)).map { $0 }, primitiveType: .triangles)
        return SCNGeometry(sources: [vertexSource, normalSource, colorSource(colors)], elements: [element])
    }

    func colorSource(_ colors: [SIMD4<Float>]) -> SCNGeometrySource {
        var expanded: [SIMD4<Float>] = []
        expanded.reserveCapacity(positions.count)
        for t in 0..<triangleCount {
            let color = t < colors.count ? colors[t] : SIMD4(0.7, 0.7, 0.7, 1)
            expanded.append(contentsOf: [color, color, color])
        }
        let data = expanded.withUnsafeBufferPointer { Data(buffer: $0) }
        return SCNGeometrySource(data: data, semantic: .color, vectorCount: expanded.count,
                                 usesFloatComponents: true, componentsPerVector: 4,
                                 bytesPerComponent: 4, dataOffset: 0, dataStride: 16)
    }

    // MARK: Refining

    /// Splits long edges at their midpoints until none is longer than `maxEdge`, so paint
    /// can be applied in small patches. Neighbours split a shared edge the same way, so the
    /// surface stays closed. Returns the source triangle of every new triangle.
    func refined(maxEdge: Float, limit: Int = 400_000) -> (TriMesh, [Int]) {
        var tris: [(SIMD3<Float>, SIMD3<Float>, SIMD3<Float>, Int)] = (0..<triangleCount).map {
            (positions[$0 * 3], positions[$0 * 3 + 1], positions[$0 * 3 + 2], $0)
        }
        let limitSquared = maxEdge * maxEdge
        func long(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> Bool { simd_distance_squared(a, b) > limitSquared }
        // The same midpoint whichever way round the edge is visited.
        func mid(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> SIMD3<Float> {
            let (p, q) = (a.x, a.y, a.z) < (b.x, b.y, b.z) ? (a, b) : (b, a)
            return p + (q - p) * 0.5
        }
        for _ in 0..<24 {
            var next: [(SIMD3<Float>, SIMD3<Float>, SIMD3<Float>, Int)] = []
            next.reserveCapacity(tris.count * 2)
            var changed = false
            for (a, b, c, from) in tris {
                let sab = long(a, b), sbc = long(b, c), sca = long(c, a)
                switch (sab, sbc, sca) {
                case (false, false, false):
                    next.append((a, b, c, from))
                case (true, true, true):
                    let ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
                    next += [(a, ab, ca, from), (ab, b, bc, from), (ca, bc, c, from), (ab, bc, ca, from)]
                case (true, false, false):
                    let ab = mid(a, b); next += [(a, ab, c, from), (ab, b, c, from)]
                case (false, true, false):
                    let bc = mid(b, c); next += [(a, b, bc, from), (a, bc, c, from)]
                case (false, false, true):
                    let ca = mid(c, a); next += [(a, b, ca, from), (ca, b, c, from)]
                case (true, true, false):
                    let ab = mid(a, b), bc = mid(b, c); next += [(a, ab, c, from), (ab, b, bc, from), (ab, bc, c, from)]
                case (false, true, true):
                    let bc = mid(b, c), ca = mid(c, a); next += [(a, b, ca, from), (b, bc, ca, from), (ca, bc, c, from)]
                case (true, false, true):
                    let ab = mid(a, b), ca = mid(c, a); next += [(a, ab, ca, from), (ab, b, c, from), (ab, c, ca, from)]
                }
                if sab || sbc || sca { changed = true }
            }
            if next.count > limit { break }
            tris = next
            if !changed { break }
        }
        var points: [SIMD3<Float>] = []
        points.reserveCapacity(tris.count * 3)
        for t in tris { points += [t.0, t.1, t.2] }
        return (TriMesh(positions: points), tris.map(\.3))
    }

    // MARK: Transforms

    /// The mesh turned and scaled about its centre (the plate's own convention).
    func baked(rotation: simd_float3x3, scale: Float) -> TriMesh {
        TriMesh(positions: positions.map { rotation * (($0 - center) * scale) })
    }

    /// Splits the mesh with the horizontal plane z = height and closes both cut faces.
    /// Returns the pieces below and above, each with the source triangle of every new triangle.
    func cut(at height: Float) -> (below: (TriMesh, [Int]), above: (TriMesh, [Int]))? {
        var lowerPoints: [SIMD3<Float>] = [], lowerFrom: [Int] = []
        var upperPoints: [SIMD3<Float>] = [], upperFrom: [Int] = []
        var segments: [(SIMD3<Float>, SIMD3<Float>)] = [] // edges of the cut, as seen on the lower piece

        func crossing(_ p: SIMD3<Float>, _ q: SIMD3<Float>) -> SIMD3<Float> {
            let t = (height - p.z) / (q.z - p.z)
            return SIMD3(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, height)
        }

        for t in 0..<triangleCount {
            let tri = [positions[t * 3], positions[t * 3 + 1], positions[t * 3 + 2]]
            let above = tri.map { $0.z > height }
            let upCount = above.filter { $0 }.count
            if upCount == 0 { lowerPoints += tri; lowerFrom.append(t); continue }
            if upCount == 3 { upperPoints += tri; upperFrom.append(t); continue }
            // Rotate so the lone corner (the one on its own side) comes first, keeping the winding.
            let lone = upCount == 1 ? above.firstIndex(of: true)! : above.firstIndex(of: false)!
            let a = tri[lone], b = tri[(lone + 1) % 3], c = tri[(lone + 2) % 3]
            let ab = crossing(a, b), ac = crossing(a, c)
            let small = [a, ab, ac]
            let big = [ab, b, c, ab, c, ac]
            if upCount == 1 {
                upperPoints += small; upperFrom.append(t)
                lowerPoints += big; lowerFrom += [t, t]
                segments.append((ac, ab))
            } else {
                lowerPoints += small; lowerFrom.append(t)
                upperPoints += big; upperFrom += [t, t]
                segments.append((ab, ac))
            }
        }
        guard !lowerPoints.isEmpty, !upperPoints.isEmpty else { return nil }

        // Close both pieces: the lower one gets a lid facing up, the upper one a floor facing down.
        for loop in Self.loops(from: segments) {
            for flat in Self.triangulate(loops: loop) {
                let lift = { (p: SIMD3<Float>) in SIMD3(p.x, p.y, height) }
                let triangle = (lift(flat.0), lift(flat.1), lift(flat.2))
                lowerPoints += [triangle.0, triangle.1, triangle.2]; lowerFrom.append(-1)
                upperPoints += [triangle.0, triangle.2, triangle.1]; upperFrom.append(-1)
            }
        }
        return ((TriMesh(positions: lowerPoints), lowerFrom), (TriMesh(positions: upperPoints), upperFrom))
    }

    /// Joins cut edges into closed outlines, grouped as [outer, holes...].
    private static func loops(from segments: [(SIMD3<Float>, SIMD3<Float>)]) -> [[[SIMD2<Float>]]] {
        func key(_ p: SIMD3<Float>) -> SIMD2<Int32> { SIMD2(Int32((p.x * 1000).rounded()), Int32((p.y * 1000).rounded())) }
        var next: [SIMD2<Int32>: [Int]] = [:]
        for (i, s) in segments.enumerated() { next[key(s.0), default: []].append(i) }
        var used = [Bool](repeating: false, count: segments.count)
        var outlines: [[SIMD2<Float>]] = []
        for start in segments.indices where !used[start] {
            var outline: [SIMD2<Float>] = []
            var at = start
            while !used[at] {
                used[at] = true
                outline.append(SIMD2(segments[at].0.x, segments[at].0.y))
                guard let candidates = next[key(segments[at].1)], let follow = candidates.first(where: { !used[$0] }) else { break }
                at = follow
            }
            if outline.count >= 3 { outlines.append(outline) }
        }
        // Nest them: an outline inside an odd number of others is a hole.
        func inside(_ p: SIMD2<Float>, _ polygon: [SIMD2<Float>]) -> Bool {
            var result = false
            var j = polygon.count - 1
            for i in polygon.indices {
                let a = polygon[i], b = polygon[j]
                if (a.y > p.y) != (b.y > p.y), p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x { result.toggle() }
                j = i
            }
            return result
        }
        let depth = outlines.map { outline in outlines.filter { $0 != outline && inside(outline[0], $0) }.count }
        var groups: [[[SIMD2<Float>]]] = []
        for (i, outline) in outlines.enumerated() where depth[i] % 2 == 0 {
            var group = [area(outline) > 0 ? outline : outline.reversed()]
            for (j, hole) in outlines.enumerated() where depth[j] == depth[i] + 1 && inside(hole[0], outline) {
                group.append(area(hole) < 0 ? hole : hole.reversed())
            }
            groups.append(group)
        }
        return groups
    }

    private static func area(_ polygon: [SIMD2<Float>]) -> Float {
        var sum: Float = 0
        for i in polygon.indices {
            let a = polygon[i], b = polygon[(i + 1) % polygon.count]
            sum += a.x * b.y - b.x * a.y
        }
        return sum / 2
    }

    /// Ear-clips one outline with holes (outer counter-clockwise, holes clockwise). Z is the cut height.
    private static func triangulate(loops group: [[SIMD2<Float>]]) -> [(SIMD3<Float>, SIMD3<Float>, SIMD3<Float>)] {
        guard var polygon = group.first else { return [] }
        // Join each hole to the outline with a thin bridge, rightmost holes first.
        let holes = group.dropFirst().sorted { ($0.map(\.x).max() ?? 0) > ($1.map(\.x).max() ?? 0) }
        for hole in holes {
            guard let h = hole.indices.max(by: { hole[$0].x < hole[$1].x }) else { continue }
            let point = hole[h]
            // Nearest outline corner to the right that the bridge can reach without crossing an edge.
            var best: Int?
            var bestDistance = Float.greatestFiniteMagnitude
            for (i, candidate) in polygon.enumerated() where candidate.x >= point.x - 0.0001 {
                let d = simd_distance_squared(candidate, point)
                guard d < bestDistance else { continue }
                var blocked = false
                for j in polygon.indices {
                    let a = polygon[j], b = polygon[(j + 1) % polygon.count]
                    if j == i || (j + 1) % polygon.count == i { continue }
                    if segmentsCross(point, candidate, a, b) { blocked = true; break }
                }
                if !blocked { best = i; bestDistance = d }
            }
            guard let at = best else { continue }
            let rotated = Array(hole[h...] + hole[..<h])
            polygon.insert(contentsOf: rotated + [rotated[0], polygon[at]], at: at + 1)
        }
        return earClip(polygon)
    }

    private static func segmentsCross(_ p1: SIMD2<Float>, _ p2: SIMD2<Float>, _ q1: SIMD2<Float>, _ q2: SIMD2<Float>) -> Bool {
        func side(_ a: SIMD2<Float>, _ b: SIMD2<Float>, _ c: SIMD2<Float>) -> Float { (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) }
        let d1 = side(q1, q2, p1), d2 = side(q1, q2, p2), d3 = side(p1, p2, q1), d4 = side(p1, p2, q2)
        return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    }

    private static func earClip(_ polygon: [SIMD2<Float>]) -> [(SIMD3<Float>, SIMD3<Float>, SIMD3<Float>)] {
        var remaining = Array(polygon.indices)
        var result: [(SIMD3<Float>, SIMD3<Float>, SIMD3<Float>)] = []
        func cross(_ a: SIMD2<Float>, _ b: SIMD2<Float>, _ c: SIMD2<Float>) -> Float { (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) }
        func contains(_ p: SIMD2<Float>, _ a: SIMD2<Float>, _ b: SIMD2<Float>, _ c: SIMD2<Float>) -> Bool {
            cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0
        }
        var guardCount = 0
        while remaining.count > 3, guardCount < polygon.count * polygon.count + 100 {
            guardCount += 1
            var clipped = false
            for i in remaining.indices {
                let ia = remaining[(i + remaining.count - 1) % remaining.count], ib = remaining[i], ic = remaining[(i + 1) % remaining.count]
                let a = polygon[ia], b = polygon[ib], c = polygon[ic]
                guard cross(a, b, c) > 1e-9 else { continue }
                if remaining.contains(where: { $0 != ia && $0 != ib && $0 != ic && polygon[$0] != a && polygon[$0] != b && polygon[$0] != c && contains(polygon[$0], a, b, c) }) { continue }
                result.append((SIMD3(a.x, a.y, 0), SIMD3(b.x, b.y, 0), SIMD3(c.x, c.y, 0)))
                remaining.remove(at: i)
                clipped = true
                break
            }
            if !clipped {
                // Nearly straight or self-touching corners: drop one and carry on.
                remaining.remove(at: 0)
            }
        }
        if remaining.count == 3 {
            let a = polygon[remaining[0]], b = polygon[remaining[1]], c = polygon[remaining[2]]
            if cross(a, b, c) > 0 { result.append((SIMD3(a.x, a.y, 0), SIMD3(b.x, b.y, 0), SIMD3(c.x, c.y, 0))) }
        }
        return result
    }
}
