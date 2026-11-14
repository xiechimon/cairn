import SwiftUI

@main
struct CairnApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session = Session()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(PushRouter.shared)
                .tint(Color.ink)
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
    @Environment(PushRouter.self) private var push
    @State private var tab = AppTab.chat
    @State private var tasksPath: [InboxItem] = []

    var body: some View {
        TabView(selection: $tab) {
            Tab("Chat", systemImage: "bubble.left", value: AppTab.chat) {
                CoordinatorView(model: model) { tab = .tasks }
            }
            Tab("Tasks", systemImage: "checklist", value: AppTab.tasks) {
                TasksView(model: model, path: $tasksPath)
            }
            .badge(model.inbox.count)
            Tab("Made", systemImage: "shippingbox", value: AppTab.made) {
                MadeView(model: model)
            }
            Tab("Computers", systemImage: "laptopcomputer", value: AppTab.computers, role: AppTab.computersRole) {
                MachinesView(model: model)
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .task { await model.load() }
        .task { await push.refreshPermission() }
        .task(id: push.deviceToken) {
            guard let token = push.deviceToken, push.permission == .on else { return }
            try? await model.client.registerPushDevice(teamId: model.team.id, token: token, environment: PushRouter.environment)
        }
        .onChange(of: tab) { Task { await model.load() } }
        .onChange(of: push.route, initial: true) { _, route in
            guard let route else { return }
            push.route = nil
            Task { await open(route) }
        }
    }

    private func open(_ route: PushRoute) async {
        switch route {
        case .chat: tab = .chat
        case .tasks: tab = .tasks
        case .computers: tab = .computers
        case .task(let id):
            tab = .tasks
            if model.task(id) == nil { await model.load() }
            tasksPath = model.task(id).map { [.task($0)] } ?? []
        }
    }
}

enum AppTab: Hashable {
    case chat, tasks, made, computers

    static var computersRole: TabRole? {
        if #available(iOS 27, *) { .prominent } else { nil }
    }
}
