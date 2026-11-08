import SwiftUI

@main
struct CairnApp: App {
    @State private var session = Session()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .tint(Color("AccentColor"))
        }
    }
}

struct RootView: View {
    @Environment(Session.self) private var session

    var body: some View {
        if session.isSignedIn {
            ThreadListView()
        } else {
            SignInView()
        }
    }
}

extension Color {
    static let canvas = Color("Canvas")
    static let card = Color("Card")
    static let ink = Color("Ink")
    static let inkMuted = Color("InkMuted")
    static let hairline = Color("Hairline")
    static let userBubble = Color("UserBubble")
    static let running = Color("Running")
    static let failure = Color("Failure")
    static let onAccent = Color("OnAccent")
    static let waiting = Color("Waiting")
}
