import Foundation

/// Talks to the bridge computer at home, wherever the phone is.
@MainActor
final class Bridge {
    static let shared = Bridge()

    private let defaults = UserDefaults.standard
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    var code: String? { Keychain.get("pairCode") }
    var isPaired: Bool { code != nil }

    /// Optional address typed by hand (Tailscale, own domain). Used only when not paired.
    var manualAddress: String {
        get { defaults.string(forKey: "manualBridgeURL") ?? "" }
        set { defaults.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "manualBridgeURL") }
    }

    private var cachedURL: URL? {
        get { defaults.url(forKey: "bridgeURL") }
        set { defaults.set(newValue, forKey: "bridgeURL") }
    }

    // MARK: Finding the bridge

    /// Reads the bridge's current address from the drop box and decrypts it.
    func discover(code: String) async throws -> URL {
        let keys = Pairing.derive(code)
        guard let url = URL(string: "\(Pairing.rendezvous)/\(keys.topic)/json?poll=1&since=latest") else {
            throw BridgeError("Bad pairing address.")
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 12
        let text: String
        do {
            let (data, _) = try await session.data(for: request)
            text = String(decoding: data, as: UTF8.self)
        } catch {
            throw BridgeError("No internet connection, or the pairing service is unreachable.")
        }
        let messages = text.split(separator: "\n").compactMap { line -> String? in
            guard let json = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  json["event"] as? String == "message" else { return nil }
            return json["message"] as? String
        }
        guard let latest = messages.last else {
            throw BridgeError("Your home computer looks offline. Check that it is on and iSlicer Bridge is running.")
        }
        do {
            return try Pairing.address(fromSealed: latest, key: keys.key)
        } catch {
            throw BridgeError("That pairing code does not match your bridge. Scan the code again.")
        }
    }

    private func isHealthy(_ base: URL, token: String?, timeout: TimeInterval = 6) async -> Bool {
        var request = URLRequest(url: base.appending(path: "health"))
        request.timeoutInterval = timeout
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        guard let (_, response) = try? await session.data(for: request) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    /// Where the bridge is right now. Looks it up again if the last address stopped answering.
    func resolve() async throws -> URL {
        if let code {
            let token = Pairing.derive(code).token
            if let cached = cachedURL, await isHealthy(cached, token: token) { return cached }
            let fresh = try await discover(code: code)
            cachedURL = fresh
            if await isHealthy(fresh, token: token, timeout: 12) { return fresh }
            throw BridgeError("Your home computer is not answering. Check that it is on and online.")
        }
        let manual = manualAddress
        if !manual.isEmpty {
            let text = manual.hasPrefix("http") ? manual : "http://\(manual)"
            if let url = URL(string: text.hasSuffix("/") ? String(text.dropLast()) : text) { return url }
        }
        throw BridgeError("Not paired yet. Scan the pairing code shown on your home computer.")
    }

    // MARK: Pairing

    func pair(_ input: String) async throws {
        guard let code = Pairing.code(from: input) else {
            throw BridgeError("That does not look like a pairing code. It has 12 letters and numbers.")
        }
        let url = try await discover(code: code)
        guard await isHealthy(url, token: Pairing.derive(code).token, timeout: 15) else {
            throw BridgeError("Found your home computer, but it did not accept the code. Scan it again.")
        }
        Keychain.set("pairCode", code)
        cachedURL = url
    }

    func unpair() {
        Keychain.set("pairCode", nil)
        cachedURL = nil
    }

    // MARK: Requests

    private func send(_ path: String, method: String = "GET", body: Data? = nil,
                      contentType: String? = nil, timeout: TimeInterval = 30) async throws -> Data {
        let base = try await resolve()
        guard let url = URL(string: base.absoluteString + path) else { throw BridgeError("Bad request.") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeout
        if let code { request.setValue("Bearer \(Pairing.derive(code).token)", forHTTPHeaderField: "Authorization") }
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        let data: Data
        let response: URLResponse
        do {
            if let body {
                (data, response) = try await session.upload(for: request, from: body)
            } else {
                (data, response) = try await session.data(for: request)
            }
        } catch {
            throw BridgeError("Lost the connection to your home computer. Try again.")
        }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw BridgeError(message ?? "Your home computer returned an error.")
        }
        return data
    }

    private func json(_ data: Data) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    struct Health {
        var slicerReady: Bool
        var slicerName: String
        var note: String?
    }

    func health() async throws -> Health {
        let engine = json(try await send("/health"))["engine"] as? [String: Any] ?? [:]
        return Health(slicerReady: engine["available"] as? Bool ?? false,
                      slicerName: engine["name"] as? String ?? "Slicer",
                      note: engine["note"] as? String)
    }

    func printers() async throws -> [Printer] {
        let data = try await send("/printers")
        struct Reply: Decodable { let printers: [Printer] }
        return try JSONDecoder().decode(Reply.self, from: data).printers
    }

    struct FoundPrinter: Identifiable, Hashable {
        let ip: String
        let serialNumber: String
        let name: String
        let model: PrinterModel?
        let lanOnly: Bool
        let added: Bool
        var id: String { serialNumber }
    }

    /// Bambu printers the bridge can hear on the home network.
    func discoverPrinters() async throws -> [FoundPrinter] {
        let list = json(try await send("/discover", timeout: 20))["printers"] as? [[String: Any]] ?? []
        return list.compactMap { item in
            guard let ip = item["ip"] as? String, let serial = item["serialNumber"] as? String else { return nil }
            return FoundPrinter(ip: ip, serialNumber: serial, name: item["name"] as? String ?? "Bambu printer",
                                model: (item["model"] as? String).flatMap(PrinterModel.init(rawValue:)),
                                lanOnly: item["lanOnly"] as? Bool ?? false, added: item["added"] as? Bool ?? false)
        }
    }

    func addPrinter(name: String, model: PrinterModel, ip: String, serial: String, accessCode: String) async throws -> String {
        let body = try JSONSerialization.data(withJSONObject: [
            "name": name, "model": model.rawValue, "ip": ip, "serialNumber": serial, "accessCode": accessCode,
        ])
        let reply = json(try await send("/printers", method: "POST", body: body, contentType: "application/json"))
        return (reply["printer"] as? [String: Any])?["id"] as? String ?? ""
    }

    func removePrinter(_ id: String) async throws {
        _ = try await send("/printers/\(id)", method: "DELETE")
    }

    func testPrinter(_ id: String) async throws {
        _ = try await send("/printers/\(id)/test", method: "POST", timeout: 25)
    }

    /// Uploads the model (or a whole laid-out plate) and starts slicing. Returns the bridge's job id.
    func startSlice(files: [URL], layout: [[String: Any]]?, name: String, settings: SliceSettings) async throws -> String {
        let boundary = "islicer-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        field("settings", String(decoding: try JSONEncoder().encode(settings), as: UTF8.self))
        field("filename", name.replacingOccurrences(of: "\"", with: ""))
        if let layout {
            field("plate", String(decoding: try JSONSerialization.data(withJSONObject: layout), as: UTF8.self))
        }
        for file in files {
            let fileName = file.lastPathComponent.replacingOccurrences(of: "\"", with: "")
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"model\"; filename=\"\(fileName)\"\r\nContent-Type: application/octet-stream\r\n\r\n".utf8))
            body.append(try Data(contentsOf: file))
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))
        let reply = json(try await send("/slice", method: "POST", body: body,
                                        contentType: "multipart/form-data; boundary=\(boundary)", timeout: 300))
        guard let id = reply["jobId"] as? String else { throw BridgeError("The bridge did not start the slice.") }
        return id
    }

    func sliceStatus(_ id: String) async throws -> [String: Any] {
        json(try await send("/status/\(id)"))
    }

    func print(jobID: String, printerID: String, useAMS: Bool, amsSlot: Int) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "jobId": jobID, "printerId": printerID, "useAms": useAMS, "amsSlot": amsSlot,
        ])
        _ = try await send("/print", method: "POST", body: body, contentType: "application/json", timeout: 120)
    }
}
