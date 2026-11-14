import SwiftUI

struct TaskThreadView: View {
    let model: AppModel
    let task: TaskRecord
    @State private var conversationId: String?
    @State private var messages: [ThreadMessage] = []
    @State private var liveText = ""
    @State private var loaded = false
    @State private var error: String?
    @State private var deciding = false
    @State private var notice: String?
    @State private var failure: String?
    @State private var confirmingComplete = false

    private var current: TaskRecord { model.task(task.id) ?? task }

    var body: some View {
        ConversationView(
            messages: messages,
            liveText: liveText,
            running: false,
            loaded: loaded,
            error: error,
            placeholder: "Message this thread",
            onSend: send,
            onAnswer: { question, answers in
                conversationId = try await model.answer(question, answers: answers, inTask: task.id)
                await reload()
            },
            upload: model.client.uploadAttachment
        ) {
            VStack(alignment: .leading, spacing: 12) {
                if loaded && messages.isEmpty {
                    if !task.spec.isEmpty && task.spec != task.title {
                        ReplyBubble(text: task.spec)
                    }
                    Text("No messages yet")
                        .font(.footnote)
                        .foregroundStyle(Color.inkMuted)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("task-header")
        } actions: {
            DecisionBar(
                decision: current.decision,
                orchestrating: model.orchestrating.contains(task.id),
                busy: deciding,
                notice: notice,
                failure: failure,
                onDecide: { decision in Task { await decide(decision) } }
            )
        }
        .navigationTitle(current.title)
        .navigationSubtitle(Text([current.reason, model.projectName(current.projectId)].compactMap { $0 }.joined(separator: " · ")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            if current.canComplete {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Complete task…", systemImage: "checkmark.circle") { confirmingComplete = true }
                            .accessibilityIdentifier("complete-task")
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                    .disabled(deciding)
                    .accessibilityLabel(Text("More actions…"))
                    .accessibilityIdentifier("more-actions")
                }
            }
        }
        .confirmationDialog("Complete task", isPresented: $confirmingComplete, titleVisibility: .visible) {
            Button("Merge the changes into the default branch") { Task { await complete(merge: true) } }
            Button("Complete without merging") { Task { await complete(merge: false) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Completing without merging keeps the changes on the conversation branch.")
        }
        .task(id: conversationId) {
            guard let conversationId else {
                loaded = true
                return
            }
            await followConversation(model.client, threadId: conversationId, onDelta: { liveText += $0 }, reload: reload)
        }
    }

    init(model: AppModel, task: TaskRecord) {
        self.model = model
        self.task = task
        _conversationId = State(initialValue: task.latestBuildId)
    }

    private func reload() async {
        guard let build = conversationId else {
            loaded = true
            return
        }
        do {
            messages = try await model.client.messages(threadId: build).messages
            liveText = ""
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func decide(_ decision: TaskDecision) async {
        deciding = true
        failure = nil
        do {
            try await model.decide(decision, on: current)
            notice = decision == .approve ? nil : String(localized: "Handed to the Coordinator")
        } catch {
            failure = error.message(fallback: decision == .approve
                ? String(localized: "Could not approve. Try again.")
                : String(localized: "Could not start orchestration"))
        }
        deciding = false
    }

    private func complete(merge: Bool) async {
        deciding = true
        failure = nil
        do {
            try await model.complete(current, merge: merge)
            notice = merge
                ? String(localized: "Merge started. The task moves to Done once the merge completes.")
                : String(localized: "Task completed. The changes stay on the conversation branch.")
        } catch {
            failure = error.message(fallback: merge
                ? String(localized: "The merge request was not sent. Try again.")
                : String(localized: "The completion request was not sent. Try again."))
        }
        deciding = false
    }

    private func send(_ content: String) async throws {
        conversationId = try await model.message(taskId: task.id, content: content)
        await reload()
    }
}

struct QuestionScreen: View {
    let model: AppModel
    let question: PendingQuestion
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            QuestionChips(question: question) { question, answers in
                try await model.answer(question, answers: answers)
                dismiss()
            }
            .padding(20)
        }
        .background(Color.canvas.ignoresSafeArea())
        .navigationTitle("Question")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
    }
}
