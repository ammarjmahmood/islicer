import Foundation

struct Printer: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var model: String
    var serialNumber: String?

    var modelLabel: String { PrinterModel(rawValue: model)?.label ?? model }
}

enum PrinterModel: String, CaseIterable, Identifiable, Codable {
    case P1S, P1P, X1C, X1, A1, A1Mini
    var id: String { rawValue }
    var label: String { self == .A1Mini ? "A1 mini" : rawValue }

    /// Where the IP address and Access Code are shown on the printer's own screen.
    var networkHelp: String {
        switch self {
        case .X1C, .X1: return "On the printer touchscreen: Settings (gear) → Network. It shows the IP address and the Access Code."
        case .A1, .A1Mini: return "On the printer touchscreen: Settings → LAN Only Mode (or WLAN). It shows the IP address and the Access Code."
        case .P1S, .P1P: return "On the printer screen: Settings (gear) → WLAN. It shows the IP address and the Access Code."
        }
    }

    var serialHelp: String {
        switch self {
        case .X1C, .X1: return "Settings → General → Device info. 15 characters, starting with 00M."
        case .A1: return "Settings → Device. 15 characters, starting with 039."
        case .A1Mini: return "Settings → Device. 15 characters, starting with 030."
        case .P1S: return "Settings → Device. 15 characters, starting with 01P."
        case .P1P: return "Settings → Device. 15 characters, starting with 01S."
        }
    }
}

enum Filament: String, CaseIterable, Identifiable, Codable {
    case PLA, plaMatte = "PLA Matte", PETG, ABS, ASA, TPU
    var id: String { rawValue }
}

enum BedType: String, CaseIterable, Identifiable, Codable {
    case textured, smooth, cool, engineering
    var id: String { rawValue }
    var label: String {
        switch self {
        case .textured: return "Textured PEI"
        case .smooth: return "Smooth / High Temp"
        case .cool: return "Cool Plate"
        case .engineering: return "Engineering"
        }
    }
}

/// What the phone asks the bridge to slice with. Field names match the bridge's API.
struct SliceSettings: Codable, Equatable {
    var printerModel: PrinterModel = .P1S
    var filament: Filament = .PLA
    var bedType: BedType = .textured
    var layerHeight: Double = 0.2
    var infillDensity: Int = 15
    var infillPattern: String = "grid"
    var wallCount: Int = 2
    var supportEnabled = false
    var supportType = "tree"
    var adhesionType = "none"
    /// For a plate: the filament in each slot, and its colour ("#RRGGBB").
    var filaments: [String]?
    var colors: [String]?

    static let layerHeights: [Double] = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28]
    static let patterns = ["grid", "gyroid", "honeycomb", "lines", "triangles"]
}

enum Preset: String, CaseIterable, Identifiable {
    case draft = "Draft", normal = "Normal", fine = "Fine", strong = "Strong"
    var id: String { rawValue }

    var blurb: String {
        switch self {
        case .draft: return "Fastest. Good for test fits."
        case .normal: return "Balanced, for everyday prints."
        case .fine: return "Smoother surfaces, slower."
        case .strong: return "More walls and infill for functional parts."
        }
    }

    func apply(to settings: inout SliceSettings) {
        switch self {
        case .draft: settings.layerHeight = 0.28; settings.infillDensity = 10; settings.wallCount = 2
        case .normal: settings.layerHeight = 0.2; settings.infillDensity = 15; settings.wallCount = 2
        case .fine: settings.layerHeight = 0.12; settings.infillDensity = 15; settings.wallCount = 3
        case .strong: settings.layerHeight = 0.2; settings.infillDensity = 40; settings.wallCount = 4
        }
    }
}

struct ModelFile: Identifiable, Hashable {
    let url: URL
    var id: String { url.lastPathComponent }
    var name: String { url.lastPathComponent }
    var isSTL: Bool { url.pathExtension.lowercased() == "stl" }
    var size: Int64 { (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0 }
    var added: Date { (try? url.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast }
}

/// A finished (or failed) slice that lives on the bridge, ready to print.
struct SliceJob: Codable, Identifiable, Hashable {
    let id: String
    var fileName: String
    var status: String
    var seconds: Int?
    var grams: Double?
    var profile: String?
    var printer: String?
    var error: String?
    var filamentCount: Int?
    var created = Date()

    var isDone: Bool { status == "done" }

    var timeText: String? {
        guard let seconds else { return nil }
        let hours = seconds / 3600, minutes = (seconds % 3600) / 60
        return hours > 0 ? "\(hours)h \(minutes)m" : "\(max(minutes, 1))m"
    }

    var gramsText: String? {
        grams.map { String(format: "%.0f g", $0.rounded(.up)) }
    }
}
