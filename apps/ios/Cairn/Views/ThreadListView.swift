import SwiftUI

struct ThreadListView: View {
    @Environment(Session.self) private var session
    @State private var team: Team?
    @State private var threads: [CoordinatorThread] = []
    @State private var tasks: [TaskSummary] = []
    @State private var error: String?
    @State private var loaded = false
    @State private var path: [CoordinatorThread] = []
    @State private var composing = false

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.circle")
                            .foregroundStyle(Color.failure)
                    }
                }
                Section("Coordinator") {
                    if threads.isEmpty && loaded {
                        Button {
                            composing = true
                        } label: {
                            Label("Start a conversation", systemImage: "plus.bubble")
                        }
                    }
                    ForEach(threads) { thread in
                        NavigationLink(value: thread) {
                            ThreadRow(thread: thread)
                        }
                        .accessibilityIdentifier("thread-row")
                    }
                }
                .listRowBackground(Color.card)

                if !openTasks.isEmpty {
                    Section("Tasks") {
                        ForEach(openTasks) { task in
                            TaskRow(task: task)
                        }
                    }
                    .listRowBackground(Color.card)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.canvas)
            .overlay {
                if !loaded && error == nil {
                    ProgressView()
                }
            }
            .navigationTitle(team?.name ?? "cairn")
            .navigationDestination(for: CoordinatorThread.self) { thread in
                ThreadView(thread: thread)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Text(session.serverText)
                        Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                            session.signOut()
                        }
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                    .accessibilityLabel("Account")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        if let first = threads.first {
                            path = [first]
                        } else {
                            composing = true
                        }
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel("Message the Coordinator")
                }
            }
            .refreshable { await load() }
            .task { await load() }
            .sheet(isPresented: $composing) {
                NewThreadSheet { content in
                    guard let client = session.client, let team else { return }
                    let result = try await client.startThread(teamId: team.id, content: content)
                    await load()
                    path = [result.thread]
                }
            }
        }
    }

    private var openTasks: [TaskSummary] {
        tasks.filter(\.isOpen).sorted { $0.phaseAt > $1.phaseAt }.prefix(20).map { $0 }
    }

    private func load() async {
        guard let client = session.client else { return }
        do {
            guard let team = try await session.loadTeam() else {
                error = "This token has no team."
                loaded = true
                return
            }
            self.team = team
            async let threadList = client.coordinatorThreads(teamId: team.id)
            async let taskList = client.tasks(teamId: team.id)
            threads = try await threadList
            tasks = (try? await taskList) ?? []
            error = nil
        } catch CairnError.unauthorized {
            session.signOut()
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}

private struct ThreadRow: View {
    let thread: CoordinatorThread

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "bubble.left.and.text.bubble.right")
                .font(.body)
                .foregroundStyle(Color.inkMuted)
                .frame(width: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(thread.title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Color.ink)
                Text(thread.updated, format: .relative(presentation: .named))
                    .font(.footnote)
                    .foregroundStyle(Color.inkMuted)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct TaskRow: View {
    let task: TaskSummary

    var body: some View {
        HStack(spacing: 12) {
            statusGlyph
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(.body)
                    .foregroundStyle(Color.ink)
                    .lineLimit(2)
                Text("#\(task.seqNum) · \(task.phaseLabel)")
                    .font(.footnote)
                    .foregroundStyle(task.needsYou ? Color.waiting : Color.inkMuted)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var statusGlyph: some View {
        if task.needsYou {
            Image(systemName: "hand.raised.fill").foregroundStyle(Color.waiting)
        } else if task.isRunning {
            Circle().fill(Color.running).frame(width: 6, height: 6)
        } else if task.phase == "failed" {
            Image(systemName: "xmark.circle").foregroundStyle(Color.inkMuted)
        } else {
            Image(systemName: "circle.dashed").foregroundStyle(Color.inkMuted)
        }
    }
}

private struct NewThreadSheet: View {
    let onSend: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextField("What should the Coordinator do?", text: $text, axis: .vertical)
                    .lineLimit(4...10)
                    .padding(14)
                    .background(Color.card, in: .rect(cornerRadius: 16))
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Color.failure)
                }
                Spacer()
            }
            .padding(20)
            .background(Color.canvas)
            .navigationTitle("New conversation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send", systemImage: "arrow.up") {
                        Task {
                            busy = true
                            do {
                                try await onSend(text)
                                dismiss()
                            } catch {
                                self.error = error.localizedDescription
                            }
                            busy = false
                        }
                    }
                    .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
