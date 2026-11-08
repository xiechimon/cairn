import SwiftUI

struct CoordinatorView: View {
    let model: AppModel
    @State private var messages: [ThreadMessage] = []
    @State private var liveText = ""
    @State private var running = false
    @State private var loaded = false
    @State private var error: String?

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
                onAnswer: answer
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
        }
        .task { await reload() }
        .task(id: model.coordinator?.id) { await listen() }
    }

    private func reload() async {
        guard let thread = model.coordinator else {
            loaded = model.loaded
            return
        }
        do {
            let page = try await model.client.messages(threadId: thread.id)
            messages = page.messages
            running = page.activeRun?.phase != nil
            if !running { liveText = "" }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func listen() async {
        guard let thread = model.coordinator else { return }
        await reload()
        while !Task.isCancelled {
            do {
                for try await event in model.client.stream(threadId: thread.id) {
                    switch event.type {
                    case "text_delta":
                        running = true
                        liveText += event.text ?? ""
                    case "message", "step":
                        await reload()
                    default:
                        break
                    }
                }
            } catch is CancellationError {
                return
            } catch {
                try? await Task.sleep(for: .seconds(2))
            }
            await reload()
        }
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
        running = true
    }

    private func answer(_ question: PendingQuestion, choices: [String]) async throws {
        try await model.answer(question, choices: choices)
        await reload()
    }
}
