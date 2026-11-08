import SwiftUI

struct TaskThreadView: View {
    let model: AppModel
    let task: TaskRecord
    @State private var conversationId: String?
    @State private var messages: [ThreadMessage] = []
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        ConversationView(
            messages: messages,
            liveText: "",
            running: false,
            loaded: loaded,
            error: error,
            placeholder: "Message this thread",
            onSend: send,
            onAnswer: { _, _ in }
        ) {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(task.title)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(Color.ink)
                    StatusLine(task: task, projectName: model.projectName(task.projectId))
                }
                Text(task.spec)
                    .font(.callout)
                    .foregroundStyle(Color.ink)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.card, in: .rect(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.hairline))
                if loaded && messages.isEmpty {
                    Text("No messages yet")
                        .font(.footnote)
                        .foregroundStyle(Color.inkMuted)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("task-header")
        }
        .navigationTitle("#\(task.seqNum)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .task {
            conversationId = task.latestBuildId
            await reload()
        }
    }

    private func reload() async {
        guard let build = conversationId else {
            loaded = true
            return
        }
        do {
            messages = try await model.client.messages(threadId: build).messages
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func send(_ content: String) async throws {
        conversationId = try await model.client.messageTask(taskId: task.id, content: content).conversationId
        try await model.refresh()
        await reload()
    }
}

struct QuestionScreen: View {
    let model: AppModel
    let question: PendingQuestion
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            QuestionCard(question: question) { question, answers in
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

struct StatusLine: View {
    let task: TaskRecord
    let projectName: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                if task.status == .failed {
                    Text("Failed")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.inkMuted)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .overlay(Capsule().strokeBorder(Color.hairline))
                }
                Text(task.status == .failed ? "Open it to retry." : task.reason)
                    .font(.footnote)
                    .foregroundStyle(task.status == .needsYou ? Color.waiting : Color.inkMuted)
            }
            Text(["#\(task.seqNum)", projectName].compactMap { $0 }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(Color.inkMuted)
        }
    }
}
