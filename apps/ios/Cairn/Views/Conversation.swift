import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

enum ConversationRow: Identifiable, Hashable {
    case message(ThreadMessage)
    case task(todoId: String, onReply: Bool)

    var id: String {
        switch self {
        case .message(let message): message.id
        case .task(let todoId, _): "task/\(todoId)"
        }
    }

    static func rows(_ messages: [ThreadMessage]) -> [ConversationRow] {
        var rows: [ConversationRow] = []
        var started: [String] = []
        var shown: Set<String> = []
        func flush(onReply: Bool) {
            rows += started.map { .task(todoId: $0, onReply: onReply) }
            started = []
        }
        for message in messages.sorted(by: { $0.createdAt < $1.createdAt }) {
            switch message.content {
            case .startedTask(let todoId):
                if shown.insert(todoId).inserted { started.append(todoId) }
            case .toolCall:
                continue
            case .turnError:
                flush(onReply: false)
                rows.append(.message(message))
            default:
                if message.isUser || message.question != nil {
                    flush(onReply: false)
                } else if message.content.plainText.isEmpty {
                    continue
                } else {
                    flush(onReply: true)
                }
                rows.append(.message(message))
            }
        }
        flush(onReply: false)
        return rows
    }
}

struct ConversationView<Header: View, Actions: View>: View {
    let messages: [ThreadMessage]
    let liveText: String
    let running: Bool
    let loaded: Bool
    let error: String?
    let placeholder: LocalizedStringKey
    let onSend: (String) async throws -> Void
    let onAnswer: (PendingQuestion, [QuestionAnswer]) async throws -> Void
    let upload: (Data, String, String) async throws -> String
    var task: (String) -> TaskRecord? = { _ in nil }
    @ViewBuilder var header: Header
    @ViewBuilder var actions: Actions

    @State private var draft = ""
    @State private var attachments: [ComposerAttachment] = []
    @State private var importing = false
    @State private var photo: PhotosPickerItem?
    @State private var sending = false
    @State private var sendError: String?
    @FocusState private var composerFocused: Bool

    private var openQuestion: PendingQuestion? {
        messages
            .compactMap { message in message.question.flatMap { $0.isPending ? PendingQuestion(message: message, ask: $0) : nil } }
            .max { $0.message.createdAt < $1.message.createdAt }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    header
                    ForEach(ConversationRow.rows(messages)) { row in
                        switch row {
                        case .message(let message):
                            MessageView(message: message, onAnswer: onAnswer)
                                .padding(.top, message.isUser ? 8 : 0)
                                .id(message.id)
                        case .task(let todoId, let onReply):
                            if let record = task(todoId) {
                                NavigationLink(value: record) {
                                    TaskRefRow(task: record, elbow: onReply)
                                }
                                .buttonStyle(.plain)
                                .padding(.bottom, onReply ? -6 : 0)
                                .accessibilityIdentifier("thread-card")
                            }
                        }
                    }
                    if !liveText.isEmpty {
                        ReplyBubble(text: liveText)
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
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 16)
            }
            .simultaneousGesture(TapGesture().onEnded { composerFocused = false })
            .defaultScrollAnchor(messages.isEmpty ? .top : .bottom, for: .alignment)
            .defaultScrollAnchor(messages.isEmpty ? .top : .bottom, for: .initialOffset)
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
        let hasText = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let uploading = attachments.contains { $0.token == nil && !$0.failed }
        return !sending && !uploading && (hasText || attachments.contains { $0.token != nil })
    }

    private var answersInComposer: PendingQuestion? {
        guard let openQuestion, openQuestion.ask.questions.count == 1 else { return nil }
        return openQuestion
    }

    private var composer: some View {
        VStack(spacing: 0) {
            actions
            HStack(alignment: .bottom, spacing: 8) {
                plusMenu
                VStack(alignment: .leading, spacing: 8) {
                    if !attachments.isEmpty {
                        ScrollView(.horizontal) {
                            HStack(spacing: 6) {
                                ForEach(attachments) { attachment in
                                    AttachmentChip(name: attachment.name, uploading: attachment.token == nil && !attachment.failed, failed: attachment.failed) {
                                        attachments.removeAll { $0.id == attachment.id }
                                    }
                                }
                            }
                        }
                        .scrollIndicators(.hidden)
                        .padding(.top, 10)
                    }
                    TextField(answersInComposer == nil || !attachments.isEmpty ? placeholder : "Type your own answer…", text: $draft, axis: .vertical)
                        .lineLimit(1...6)
                        .focused($composerFocused)
                        .padding(.vertical, 6)
                        .contentShape(.rect)
                        .onTapGesture { composerFocused = true }
                        .accessibilityIdentifier("composer-field")
                }
                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: sending ? "ellipsis" : "arrow.up")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(canSend ? Color.ink : Color.inkTertiary)
                        .frame(width: 32, height: 32)
                        .background(Color.composerButton, in: .circle)
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .accessibilityLabel(Text("Send"))
                .accessibilityIdentifier("send-button")
            }
            .padding(8)
            .background(ComposerSurface())
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item]) { result in
            guard case .success(let url) = result else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            Task { await attach(data, name: url.lastPathComponent, mime: mime) }
        }
        .onChange(of: photo) {
            guard let item = photo else { return }
            photo = nil
            Task {
                guard let data = try? await item.loadTransferable(type: Data.self),
                      let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.85) else { return }
                await attach(jpeg, name: "IMG-\(Int(Date.now.timeIntervalSince1970)).jpg", mime: "image/jpeg")
            }
        }
    }

    private var plusMenu: some View {
        Menu {
            Button {
                importing = true
            } label: {
                Label("Add attachment", systemImage: "paperclip")
            }
            PhotosPicker(selection: $photo, matching: .images) {
                Label("Photo library", systemImage: "photo.on.rectangle")
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(Color.ink)
                .frame(width: 32, height: 32)
                .contentShape(.circle)
        }
        .accessibilityLabel(Text("More"))
    }

    private func attach(_ data: Data, name: String, mime: String) async {
        let attachment = ComposerAttachment(name: name)
        attachments.append(attachment)
        do {
            let token = try await upload(data, name, mime)
            if let index = attachments.firstIndex(where: { $0.id == attachment.id }) { attachments[index].token = token }
            sendError = nil
        } catch {
            if let index = attachments.firstIndex(where: { $0.id == attachment.id }) { attachments[index].failed = true }
            sendError = error.localizedDescription
        }
    }

    private func send() async {
        guard canSend else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let sent = attachments
        let content = (sent.compactMap(\.token) + [text]).filter { !$0.isEmpty }.joined(separator: "\n\n")
        sending = true
        draft = ""
        attachments = []
        do {
            if sent.isEmpty, let question = answersInComposer, let item = question.ask.questions.first {
                let answer = item.options.isEmpty
                    ? QuestionAnswer(header: item.header, choices: nil, text: content)
                    : QuestionAnswer(header: item.header, choices: [content], text: nil)
                try await onAnswer(question, [answer])
            } else {
                try await onSend(content)
            }
            sendError = nil
        } catch {
            draft = text
            attachments = sent
            sendError = error.localizedDescription
        }
        sending = false
    }
}

private struct MessageView: View {
    let message: ThreadMessage
    let onAnswer: (PendingQuestion, [QuestionAnswer]) async throws -> Void

    var body: some View {
        switch message.content {
        case .question(let ask):
            QuestionChips(question: PendingQuestion(message: message, ask: ask), onAnswer: onAnswer)
        case .turnError(let reason):
            Label(reason.isEmpty ? String(localized: "Something went wrong") : reason, systemImage: "exclamationmark.circle")
                .font(.footnote)
                .foregroundStyle(Color.failure)
                .accessibilityIdentifier("turn-error")
        default:
            if message.isUser {
                let sent = SentText(message.content.plainText)
                VStack(alignment: .trailing, spacing: 6) {
                    if !sent.files.isEmpty {
                        HStack(spacing: 6) {
                            ForEach(Array(sent.files.enumerated()), id: \.offset) { _, name in
                                AttachmentChip(name: name)
                            }
                        }
                    }
                    if !sent.text.isEmpty {
                        Text(sent.text)
                            .font(.body)
                            .foregroundStyle(Color.ink)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                            .background(Color.userBubble, in: UserBubbleShape())
                            .textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.leading, 56)
                .accessibilityIdentifier("user-message")
            } else {
                ReplyBubble(text: message.content.plainText)
                    .accessibilityIdentifier("assistant-message")
            }
        }
    }
}

struct UserBubbleShape: Shape {
    func path(in rect: CGRect) -> Path {
        let body = UnevenRoundedRectangle(
            topLeadingRadius: 20, bottomLeadingRadius: 20, bottomTrailingRadius: 6, topTrailingRadius: 20,
            style: .continuous
        ).path(in: rect)
        var tail = Path()
        tail.move(to: CGPoint(x: rect.maxX - 16, y: rect.maxY))
        tail.addQuadCurve(to: CGPoint(x: rect.maxX + 6, y: rect.maxY), control: CGPoint(x: rect.maxX - 2, y: rect.maxY))
        tail.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.maxY - 16), control: CGPoint(x: rect.maxX, y: rect.maxY - 3))
        tail.closeSubpath()
        return body.union(tail)
    }
}

struct ReplyBubble: View {
    let text: String

    var body: some View {
        HStack {
            Text(markdown)
                .font(.body)
                .foregroundStyle(Color.ink)
                .lineSpacing(2)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.replyBubble, in: .rect(cornerRadius: 20, style: .continuous))
                .textSelection(.enabled)
            Spacer(minLength: 24)
        }
    }

    private var markdown: AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}

struct TaskRefRow: View {
    let task: TaskRecord
    let elbow: Bool

    var body: some View {
        HStack(spacing: 7) {
            StatusTile(phase: task.phase, size: 22)
            Text(task.title)
                .font(.subheadline)
                .foregroundStyle(Color.ink)
                .lineLimit(1)
        }
        .padding(.leading, elbow ? 32 : 0)
        .overlay(alignment: .leading) {
            if elbow {
                Elbow()
                    .stroke(Color.taskRefLine, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                    .frame(width: 12, height: 16)
                    .offset(x: 16, y: 10)
            }
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityValue(Text(task.reason))
    }

    private struct Elbow: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            path.move(to: CGPoint(x: rect.minX + 1, y: rect.maxY - 1))
            path.addLine(to: CGPoint(x: rect.minX + 1, y: rect.minY + 7))
            path.addQuadCurve(to: CGPoint(x: rect.minX + 7, y: rect.minY + 1), control: CGPoint(x: rect.minX + 1, y: rect.minY + 1))
            path.addLine(to: CGPoint(x: rect.maxX - 1, y: rect.minY + 1))
            return path
        }
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
        .padding(.leading, 4)
        .accessibilityIdentifier("thinking")
    }
}

@MainActor
func followConversation(
    _ client: CairnClient,
    threadId: String,
    onDelta: (String) -> Void,
    reload: () async -> Void
) async {
    await reload()
    while !Task.isCancelled {
        do {
            for try await event in client.stream(threadId: threadId) {
                switch event.type {
                case "text_delta": onDelta(event.text ?? "")
                case "message", "step": await reload()
                default: break
                }
            }
        } catch is CancellationError {
            return
        } catch {
            try? await Task.sleep(for: .seconds(2))
        }
        guard !Task.isCancelled else { return }
        await reload()
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

struct ComposerAttachment: Identifiable {
    let id = UUID()
    let name: String
    var token: String?
    var failed = false
}

struct SentText {
    let files: [String]
    let text: String

    init(_ content: String) {
        let token = #/!\[([^\]]*)\]\(attachment:[^)]+\)/#
        files = content.matches(of: token).map { String($0.1) }
        text = content.replacing(token, with: "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct AttachmentChip: View {
    let name: String
    var uploading = false
    var failed = false
    var onRemove: (() -> Void)?

    var body: some View {
        HStack(spacing: 6) {
            if uploading {
                ProgressView().controlSize(.mini)
            } else {
                Image(systemName: failed ? "exclamationmark.circle" : icon)
                    .foregroundStyle(failed ? Color.failure : Color.inkMuted)
            }
            Text(name)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 160, alignment: .leading)
            if let onRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.inkMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Remove"))
            }
        }
        .font(.footnote)
        .foregroundStyle(Color.ink)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.menuHover, in: .capsule)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("attachment-chip")
    }

    private var icon: String {
        UTType(filenameExtension: (name as NSString).pathExtension)?.conforms(to: .image) == true ? "photo" : "paperclip"
    }
}

struct ComposerSurface: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        let dark = scheme == .dark
        shape
            .fill(Color.composerFill)
            .shadow(color: .black.opacity(dark ? 0.3 : 0.04), radius: 1, y: 1)
            .shadow(color: .black.opacity(dark ? 0.24 : 0.05), radius: dark ? 6 : 5, y: dark ? 4 : 3)
            .overlay(shape.strokeBorder(Color.composerRing, lineWidth: 1))
    }
}
