import SwiftUI

struct TaskThreadView: View {
    let model: AppModel
    let task: TaskRecord
    @State private var conversationId: String?
    @State private var messages: [ThreadMessage] = []
    @State private var liveText = ""
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        ConversationView(
            messages: messages,
            liveText: liveText,
            running: false,
            loaded: loaded,
            error: error,
            placeholder: "Message this thread",
            onSend: send,
            onAnswer: { _, _ in },
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
        }
        .navigationTitle(task.title)
        .navigationSubtitle(Text([task.reason, model.projectName(task.projectId)].compactMap { $0 }.joined(separator: " · ")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
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
