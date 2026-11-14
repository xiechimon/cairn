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
    private(set) var model: AppModel?
    private(set) var restoreError: String?
    var serverText: String
    private let urlSession: URLSession

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
        if ProcessInfo.processInfo.arguments.contains("-cairn-reset") {
            Self.forget(server: UserDefaults.standard.string(forKey: Self.serverKey))
        }
        serverText = UserDefaults.standard.string(forKey: Self.serverKey) ?? "http://localhost:8787"
        if let url = URL(string: serverText), let token = KeychainToken.read(account: serverText) {
            client = CairnClient(credentials: Credentials(serverURL: url, token: token), session: urlSession)
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
        let candidate = CairnClient(
            credentials: Credentials(serverURL: url, token: token.trimmingCharacters(in: .whitespacesAndNewlines)),
            session: urlSession
        )
        guard let team = try await candidate.teams().first else {
            throw CairnError.server(status: 404, message: String(localized: "This token has no team."))
        }
        KeychainToken.write(candidate.credentials.token, account: trimmed)
        UserDefaults.standard.set(trimmed, forKey: Self.serverKey)
        serverText = trimmed
        client = candidate
        model = AppModel(client: candidate, team: team)
    }

    func restore() async {
        guard model == nil, let client else { return }
        do {
            guard let team = try await client.teams().first else {
                throw CairnError.server(status: 404, message: String(localized: "This token has no team."))
            }
            restoreError = nil
            model = AppModel(client: client, team: team)
        } catch CairnError.unauthorized {
            signOut()
        } catch {
            restoreError = error.localizedDescription
        }
    }

    func signOut() {
        KeychainToken.delete(account: serverText)
        client = nil
        model = nil
        restoreError = nil
    }
}
