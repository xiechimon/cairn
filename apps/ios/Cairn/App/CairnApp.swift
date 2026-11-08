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
        if let model = session.model {
            MainTabs(model: model)
        } else if session.isSignedIn {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.canvas.ignoresSafeArea())
                .task { try? await session.restore() }
        } else {
            SignInView()
        }
    }
}

struct MainTabs: View {
    let model: AppModel
    @State private var tab = 0

    var body: some View {
        TabView(selection: $tab) {
            Tab("Needs you", systemImage: "tray", value: 0) {
                InboxView(model: model)
            }
            .badge(model.inbox.count)
            Tab("Coordinator", image: "CoordinatorGlyph", value: 1) {
                CoordinatorView(model: model)
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .task { await model.load() }
        .onChange(of: tab) { Task { await model.load() } }
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
