import CryptoKit
import Foundation
import Security

/// Everything the phone derives from the pairing code. Must match `server/remote.js`.
enum Pairing {
    static let rendezvous = "https://ntfy.sh"

    struct Keys {
        let topic: String
        let key: SymmetricKey
        let token: String
    }

    static func normalize(_ text: String) -> String {
        String(text.uppercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) && $0.isASCII })
    }

    /// Accepts "ABCD-EFGH-JKLM", any spacing, or a scanned `islicer://pair?c=...` link.
    static func code(from input: String) -> String? {
        var candidate = input
        if let range = input.range(of: #"[?&]c=([A-Za-z0-9-]+)"#, options: .regularExpression) {
            candidate = String(input[range].dropFirst(3))
        }
        let clean = normalize(candidate)
        return clean.count == 12 ? clean : nil
    }

    static func format(_ code: String) -> String {
        let clean = Array(normalize(code).prefix(12))
        return stride(from: 0, to: clean.count, by: 4)
            .map { String(clean[$0..<min($0 + 4, clean.count)]) }
            .joined(separator: "-")
    }

    static func derive(_ code: String) -> Keys {
        let clean = normalize(code)
        func hash(_ label: String) -> Data {
            Data(SHA256.hash(data: Data("islicer:\(label):\(clean)".utf8)))
        }
        func hex(_ data: Data) -> String {
            data.map { String(format: "%02x", $0) }.joined()
        }
        return Keys(
            topic: "islicer-" + String(hex(hash("topic")).prefix(32)),
            key: SymmetricKey(data: hash("key")),
            token: hex(hash("token"))
        )
    }

    /// The bridge posts `base64(iv | ciphertext | tag)` of `{"url": ...}`.
    static func address(fromSealed blob: String, key: SymmetricKey) throws -> URL {
        guard let raw = Data(base64Encoded: blob.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw BridgeError("The bridge address could not be read.")
        }
        let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: raw), using: key)
        guard let json = try JSONSerialization.jsonObject(with: plain) as? [String: Any],
              let text = json["url"] as? String, let url = URL(string: text) else {
            throw BridgeError("The bridge address could not be read.")
        }
        return url
    }
}

/// The pairing code is as good as a password, so it lives in the Keychain.
enum Keychain {
    private static let service = "com.ammarjmahmood.islicer"

    static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ key: String, _ value: String?) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(base as CFDictionary)
        guard let value else { return }
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
}

struct BridgeError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
