import Observation
import SwiftUI
import UIKit
import UserNotifications

enum PushRoute: Equatable, Sendable {
    case task(String)
    case chat
    case tasks
    case computers

    init(href: String) {
        guard let components = URLComponents(string: href) else {
            self = .tasks
            return
        }
        let parts = components.path.split(separator: "/").map(String.init)
        let query = Dictionary((components.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { first, _ in first })
        if parts.count == 3, parts[0] == "app", parts[1] == "todo", !parts[2].isEmpty {
            self = .task(parts[2])
        } else if query["chief"] != nil {
            self = .chat
        } else if query["pane"] == "machines" {
            self = .computers
        } else {
            self = .tasks
        }
    }
}

enum PushPermission: Equatable, Sendable {
    case off, on, denied
}

@MainActor
@Observable
final class PushRouter {
    static let shared = PushRouter()
    private static let enabledKey = "cairn.push.enabled"

    var route: PushRoute?
    private(set) var deviceToken: String?
    private(set) var permission = PushPermission.off

    static var environment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    func refreshPermission() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            guard UserDefaults.standard.bool(forKey: Self.enabledKey) else {
                permission = .off
                return
            }
            permission = .on
            UIApplication.shared.registerForRemoteNotifications()
        case .denied:
            permission = .denied
        default:
            permission = .off
        }
    }

    func enable() async {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        if granted {
            UserDefaults.standard.set(true, forKey: Self.enabledKey)
            permission = .on
            UIApplication.shared.registerForRemoteNotifications()
        } else {
            permission = .denied
        }
    }

    func disable() {
        UserDefaults.standard.set(false, forKey: Self.enabledKey)
        deviceToken = nil
        permission = .off
        UIApplication.shared.unregisterForRemoteNotifications()
    }

    func received(token: Data) {
        deviceToken = token.map { String(format: "%02x", $0) }.joined()
    }

    func opened(href: String?) {
        route = PushRoute(href: href ?? "/app")
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        MainActor.assumeIsolated { PushRouter.shared.received(token: deviceToken) }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        Task { @MainActor in completionHandler([.banner, .list, .sound]) }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        let href = response.notification.request.content.userInfo["href"] as? String
        Task { @MainActor in
            PushRouter.shared.opened(href: href)
            completionHandler()
        }
    }
}
