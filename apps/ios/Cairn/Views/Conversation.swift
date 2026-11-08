import SwiftUI

struct ConversationView<Header: View>: View {
    let messages: [ThreadMessage]
    let liveText: String
    let running: Bool
    let loaded: Bool
    let error: String?
    let placeholder: String
    let onSend: (String) async throws -> Void
    let onAnswer: (PendingQuestion, [String]) async throws -> Void
    @ViewBuilder var header: Header

    @State private var draft = ""
    @State private var sending = false
    @State private var sendError: String?
    @FocusState private var composerFocused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    header
                    ForEach(messages.sorted { $0.createdAt < $1.createdAt }) { message in
                        MessageView(message: message, onAnswer: onAnswer)
                            .id(message.id)
                    }
                    if !liveText.isEmpty {
                        AssistantText(text: liveText)
                    } else if running {
                        ThinkingIndicator()
                    }
                    if let shown = sendError ?? error {
                        Label(shown, systemImage: "exclamationmark.circle")
                            .font(.footnote)
                            .foregroundStyle(Color.failure)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 28)
            }
            .simultaneousGesture(TapGesture().onEnded { composerFocused = false })
            .defaultScrollAnchor(messages.isEmpty ? .top : .bottom)
            .defaultScrollAnchor(messages.isEmpty ? .top : .bottom, for: .sizeChanges)
            .scrollDismissesKeyboard(.interactively)
            .scrollEdgeEffectStyle(.soft, for: .all)
            .background(Color.canvas.ignoresSafeArea())
            .overlay {
                if !loaded { ProgressView() }
            }
            .safeAreaBar(edge: .bottom) { composer }
            .onChange(of: messages.count) { withAnimation(.smooth) { proxy.scrollTo("bottom", anchor: .bottom) } }
            .onChange(of: liveText) { proxy.scrollTo("bottom", anchor: .bottom) }
        }
        .minimizesNavigationBarOnScroll()
    }

    private var canSend: Bool {
        !sending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var composer: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField(placeholder, text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($composerFocused)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
                    .contentShape(.rect(cornerRadius: 22))
                    .onTapGesture { composerFocused = true }
                    .accessibilityIdentifier("composer-field")
                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: sending ? "ellipsis" : "arrow.up")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(canSend ? Color.onAccent : Color.inkMuted)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .disabled(!canSend)
                .accessibilityLabel("Send")
                .accessibilityIdentifier("send-button")
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private func send() async {
        guard canSend else { return }
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        sending = true
        draft = ""
        do {
            try await onSend(content)
            sendError = nil
        } catch {
            draft = content
            sendError = error.localizedDescription
        }
        sending = false
    }
}

private struct MessageView: View {
    let message: ThreadMessage
    let onAnswer: (PendingQuestion, [String]) async throws -> Void

    var body: some View {
        switch message.content {
        case .question(let ask):
            QuestionCard(question: PendingQuestion(message: message, ask: ask), onAnswer: onAnswer)
        case .toolCall(let name):
            Label("Used \(name)", systemImage: "wrench.and.screwdriver")
                .font(.footnote)
                .foregroundStyle(Color.inkMuted)
        default:
            if message.isUser {
                HStack {
                    Spacer(minLength: 48)
                    Text(message.content.plainText)
                        .font(.body)
                        .foregroundStyle(Color.ink)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Color.userBubble, in: .rect(cornerRadius: 18))
                        .textSelection(.enabled)
                }
                .accessibilityIdentifier("user-message")
            } else if !message.content.plainText.isEmpty {
                AssistantText(text: message.content.plainText)
                    .accessibilityIdentifier("assistant-message")
            }
        }
    }
}

struct AssistantText: View {
    let text: String

    var body: some View {
        Text(markdown)
            .font(.body)
            .foregroundStyle(Color.ink)
            .lineSpacing(3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
    }

    private var markdown: AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}

private struct ThinkingIndicator: View {
    var body: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text("Working on it.")
                .font(.footnote)
                .foregroundStyle(Color.inkMuted)
        }
        .accessibilityIdentifier("thinking")
    }
}

extension View {
    @ViewBuilder func minimizesNavigationBarOnScroll() -> some View {
        if #available(iOS 27, *) {
            toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)
        } else {
            self
        }
    }
}
