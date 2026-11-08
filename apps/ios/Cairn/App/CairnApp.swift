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
            RestoreView()
        } else {
            SignInView()
        }
    }
}

private struct RestoreView: View {
    @Environment(Session.self) private var session
    @State private var attempt = 0

    var body: some View {
        VStack(spacing: 16) {
            if let error = session.restoreError {
                CairnMark()
                    .fill(Color.ink)
                    .frame(width: 40, height: 40)
                    .accessibilityHidden(true)
                Text(error)
                    .font(.callout)
                    .foregroundStyle(Color.ink)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("restore-error")
                Text(session.serverText)
                    .font(.footnote)
                    .foregroundStyle(Color.inkMuted)
                Button {
                    attempt += 1
                } label: {
                    Text("Try again")
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .foregroundStyle(Color.onAccent)
                }
                .buttonStyle(.glassProminent)
                .accessibilityIdentifier("restore-retry")
                Button("Sign out", role: .destructive) { session.signOut() }
                    .accessibilityIdentifier("restore-sign-out")
            } else {
                ProgressView()
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.canvas.ignoresSafeArea())
        .task(id: attempt) { await session.restore() }
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
