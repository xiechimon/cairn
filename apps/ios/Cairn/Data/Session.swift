import Foundation
import Observation
import Security

enum KeychainToken {
    private static let service = "dev.cairn.ios.token"

    static func read(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ token: String, account: String) {
        delete(account: account)
        let attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data(token.utf8),
        ]
        SecItemAdd(attributes as CFDictionary, nil)
    }

    static func delete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

@MainActor
@Observable
final class Session {
    private static let serverKey = "cairn.serverURL"

    private(set) var client: CairnClient?
    private(set) var team: Team?
    var serverText: String

    init() {
        if ProcessInfo.processInfo.arguments.contains("-cairn-reset") {
            Self.forget(server: UserDefaults.standard.string(forKey: Self.serverKey))
        }
        serverText = UserDefaults.standard.string(forKey: Self.serverKey) ?? "http://localhost:8787"
        if let url = URL(string: serverText), let token = KeychainToken.read(account: serverText) {
            client = CairnClient(credentials: Credentials(serverURL: url, token: token))
        }
    }

    var isSignedIn: Bool { client != nil }

    private static func forget(server: String?) {
        if let server { KeychainToken.delete(account: server) }
        UserDefaults.standard.removeObject(forKey: serverKey)
    }

    func signIn(server: String, token: String) async throws {
        let trimmed = server.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme == "http" || url.scheme == "https", url.host() != nil else {
            throw CairnError.badServerURL
        }
        let candidate = CairnClient(credentials: Credentials(serverURL: url, token: token.trimmingCharacters(in: .whitespacesAndNewlines)))
        let teams = try await candidate.teams()
        KeychainToken.write(candidate.credentials.token, account: trimmed)
        UserDefaults.standard.set(trimmed, forKey: Self.serverKey)
        serverText = trimmed
        team = teams.first
        client = candidate
    }

    func loadTeam() async throws -> Team? {
        if let team { return team }
        guard let client else { return nil }
        team = try await client.teams().first
        return team
    }

    func signOut() {
        KeychainToken.delete(account: serverText)
        client = nil
        team = nil
    }
}
