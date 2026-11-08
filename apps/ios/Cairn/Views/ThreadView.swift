import SwiftUI

struct ThreadView: View {
    let thread: CoordinatorThread
    @Environment(Session.self) private var session
    @State private var messages: [ThreadMessage] = []
    @State private var liveText = ""
    @State private var running = false
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?
    @State private var loaded = false
    @FocusState private var composerFocused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    ForEach(orderedMessages) { message in
                        MessageView(message: message)
                            .id(message.id)
                    }
                    if !liveText.isEmpty {
                        AssistantText(text: liveText)
                            .id("live")
                    } else if running {
                        ThinkingIndicator()
                            .id("live")
                    }
                    if let error {
                        Label(error, systemImage: "exclamationmark.circle")
                            .font(.footnote)
                            .foregroundStyle(Color.failure)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 28)
            }
            .defaultScrollAnchor(.bottom)
            .defaultScrollAnchor(.bottom, for: .sizeChanges)
            .scrollDismissesKeyboard(.interactively)
            .scrollEdgeEffectStyle(.soft, for: .all)
            .background(Color.canvas.ignoresSafeArea())
            .overlay {
                if !loaded { ProgressView() }
            }
            .safeAreaBar(edge: .bottom) {
                composer
            }
            .onChange(of: messages.count) { scrollToBottom(proxy) }
            .onChange(of: liveText) { scrollToBottom(proxy, animated: false) }
            .onChange(of: running) { scrollToBottom(proxy) }
        }
        .navigationTitle(thread.title)
        .navigationBarTitleDisplayMode(.inline)
        .minimizesNavigationBarOnScroll()
        .task { await reload() }
        .task(id: thread.id) { await listen() }
    }

    private var orderedMessages: [ThreadMessage] {
        messages.sorted { $0.createdAt < $1.createdAt }
    }

    private var composer: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Message the Coordinator", text: $draft, axis: .vertical)
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

    private var canSend: Bool {
        !sending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool = true) {
        if animated {
            withAnimation(.smooth) { proxy.scrollTo("bottom", anchor: .bottom) }
        } else {
            proxy.scrollTo("bottom", anchor: .bottom)
        }
    }

    private func reload() async {
        guard let client = session.client else { return }
        do {
            let page = try await client.messages(threadId: thread.id)
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
        guard let client = session.client else { return }
        while !Task.isCancelled {
            do {
                for try await event in client.stream(threadId: thread.id) {
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

    private func send() async {
        guard let client = session.client, canSend else { return }
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        sending = true
        draft = ""
        do {
            _ = try await client.send(threadId: thread.id, content: content)
            running = true
            liveText = ""
            await reload()
            running = true
        } catch {
            draft = content
            self.error = error.localizedDescription
        }
        sending = false
    }
}

private struct MessageView: View {
    let message: ThreadMessage

    var body: some View {
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
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(message.content.toolNames, id: \.self) { name in
                    Label(name, systemImage: "wrench.and.screwdriver")
                        .font(.footnote)
                        .foregroundStyle(Color.inkMuted)
                }
                let text = message.content.plainText
                if !text.isEmpty {
                    AssistantText(text: text)
                }
            }
            .accessibilityIdentifier("assistant-message")
        }
    }
}

private struct AssistantText: View {
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
            Text("Coordinator is working")
                .font(.footnote)
                .foregroundStyle(Color.inkMuted)
        }
        .accessibilityIdentifier("thinking")
    }
}

private extension View {
    @ViewBuilder func minimizesNavigationBarOnScroll() -> some View {
        if #available(iOS 27, *) {
            toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)
        } else {
            self
        }
    }
}
