import SwiftUI

struct CoordinatorView: View {
    let model: AppModel
    let onTasks: () -> Void
    @Environment(Session.self) private var session
    @State private var messages: [ThreadMessage] = []
    @State private var liveText = ""
    @State private var running = false
    @State private var tool: String?
    @State private var connected = true
    @State private var sawActive = false
    @State private var showDone = false
    @State private var loaded = false
    @State private var error: String?
    @State private var showAccount = false

    var body: some View {
        NavigationStack {
            ConversationView(
                messages: messages,
                liveText: liveText,
                running: running,
                loaded: loaded,
                error: error,
                placeholder: "Message the Coordinator",
                onSend: send,
                onAnswer: answer,
                upload: model.client.uploadAttachment,
                task: { id in model.tasks.first { $0.id == id } }
            ) {
                if loaded && messages.isEmpty {
                    VStack(spacing: 12) {
                        CairnMark()
                            .fill(Color.ink)
                            .frame(width: 44, height: 44)
                        Text("Ask the Coordinator anything about your projects.")
                            .font(.callout)
                            .foregroundStyle(Color.inkMuted)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 80)
                }
            }
            .navigationTitle("Coordinator")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: TaskRecord.self) { task in
                TaskThreadView(model: model, task: task)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showAccount = true
                    } label: {
                        Image(systemName: "line.3.horizontal")
                    }
                    .accessibilityLabel(Text("Menu"))
                    .accessibilityIdentifier("account-button")
                }
                ToolbarItem(placement: .principal) {
                    StatusMarkGlyph(state: mark)
                        .frame(width: 40, height: 40)
                        .frame(width: 56, height: 56)
                        .glassEffect(.regular, in: .circle)
                        .accessibilityElement()
                        .accessibilityLabel(Text(mark.label))
                        .accessibilityValue(Text(verbatim: mark.rawValue))
                        .accessibilityIdentifier("status-mark")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: onTasks) {
                        Image(systemName: "checklist")
                            .overlay(alignment: .topTrailing) {
                                CountBadge(count: model.inbox.count)
                                    .offset(x: 12, y: -10)
                            }
                    }
                    .accessibilityLabel(Text("Tasks"))
                    .accessibilityValue(Text("\(model.inbox.count)"))
                    .accessibilityIdentifier("tasks-button")
                }
            }
            .sheet(isPresented: $showAccount) {
                AccountSheet(model: model, server: session.serverText) {
                    showAccount = false
                    session.signOut()
                }
            }
        }
        .task { await reload() }
        .task(id: model.coordinator?.id) { await listen() }
        .onChange(of: baseMark) { _, next in
            if next.isActive {
                sawActive = true
                showDone = false
            } else if next == .idle && sawActive && lastTurn == .reply {
                sawActive = false
                showDone = true
            } else {
                showDone = false
            }
        }
        .task(id: showDone) {
            guard showDone else { return }
            try? await Task.sleep(for: .milliseconds(MarkGeometry.doneMs))
            showDone = false
        }
    }

    private enum LastTurn { case reply, error, other }

    private var lastTurn: LastTurn {
        let last = messages.last { message in
            switch message.content {
            case .turnError: true
            case .toolCall, .startedTask, .question: false
            default: message.isUser || !message.content.plainText.isEmpty
            }
        }
        guard let last else { return .other }
        if case .turnError = last.content { return .error }
        return last.isUser ? .other : .reply
    }

    private var baseMark: StatusMarkID {
        .of(
            questionPending: messages.contains { $0.question?.isPending == true },
            connected: connected,
            running: running,
            tool: tool,
            replying: !liveText.isEmpty,
            lastTurnFailed: lastTurn == .error
        )
    }

    private var mark: StatusMarkID { showDone && baseMark == .idle ? .done : baseMark }

    private func reload() async {
        guard let thread = model.coordinator else {
            loaded = model.loaded
            return
        }
        do {
            let page = try await model.client.messages(threadId: thread.id)
            messages = page.messages
            running = page.activeRun?.phase != nil
            tool = page.activeRun?.tool?.toolName
            if !running { liveText = "" }
            connected = true
            error = nil
        } catch {
            connected = false
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func listen() async {
        guard let thread = model.coordinator else { return }
        await followConversation(model.client, threadId: thread.id, onDelta: { delta in
            running = true
            liveText += delta
        }, reload: reload)
    }

    private func send(_ content: String) async throws {
        if let thread = model.coordinator {
            _ = try await model.client.send(threadId: thread.id, content: content)
        } else {
            let result = try await model.client.startThread(teamId: model.team.id, content: content)
            model.adoptCoordinator(result.thread)
        }
        liveText = ""
        running = true
        await reload()
    }

    private func answer(_ question: PendingQuestion, answers: [QuestionAnswer]) async throws {
        try await model.answer(question, answers: answers)
        await reload()
    }
}

private struct AccountSheet: View {
    let model: AppModel
    let server: String
    let onSignOut: () -> Void
    @Environment(PushRouter.self) private var push
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Team", value: model.team.name)
                    LabeledContent("Server", value: server)
                }
                .listRowBackground(Color.card)
                Section {
                    Toggle("Push on this device", isOn: Binding(
                        get: { push.permission == .on },
                        set: { on in Task { await toggle(on) } }
                    ))
                    .disabled(push.permission == .denied)
                    .accessibilityIdentifier("push-toggle")
                    if push.permission == .denied {
                        Button("Allow notifications in Settings") {
                            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                        }
                    }
                } header: {
                    Text("Push notifications")
                } footer: {
                    Text("Push immediately when a decision is needed; everything else lands in the twice-daily digest, even on the lock screen.")
                }
                .listRowBackground(Color.card)
                Section {
                    Button("Sign out", role: .destructive) {
                        Task {
                            await toggle(false)
                            onSignOut()
                        }
                    }
                    .accessibilityIdentifier("sign-out-button")
                }
                .listRowBackground(Color.card)
            }
            .scrollContentBackground(.hidden)
            .background(Color.canvas.ignoresSafeArea())
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    private func toggle(_ on: Bool) async {
        if on {
            await push.enable()
        } else if push.permission == .on {
            if let token = push.deviceToken {
                try? await model.client.unregisterPushDevice(teamId: model.team.id, token: token)
            }
            push.disable()
        }
    }
}
