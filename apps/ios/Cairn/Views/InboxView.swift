import SwiftUI

struct InboxView: View {
    let model: AppModel
    @Environment(Session.self) private var session
    @State private var showRunning = false
    @State private var showAccount = false

    var body: some View {
        NavigationStack {
            List {
                if let error = model.error {
                    Section {
                        HStack {
                            Label(error, systemImage: "exclamationmark.circle")
                                .font(.callout)
                                .foregroundStyle(Color.failure)
                            Spacer()
                            Button("Retry") { Task { await model.load() } }
                                .buttonStyle(.borderless)
                        }
                    }
                    .listRowBackground(Color.card)
                }
                if model.loaded && model.inbox.isEmpty && model.error == nil {
                    Section {
                        VStack(spacing: 12) {
                            CairnMark()
                                .fill(Color.ink)
                                .frame(width: 40, height: 40)
                            Text("Nothing needs you")
                                .font(.headline)
                                .foregroundStyle(Color.ink)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                        .accessibilityIdentifier("inbox-empty")
                    }
                    .listRowBackground(Color.clear)
                }
                if !model.inbox.isEmpty {
                    Section {
                        ForEach(model.inbox) { item in
                            NavigationLink(value: item) {
                                InboxRow(item: item, projectName: projectName(item))
                            }
                            .accessibilityIdentifier("inbox-row")
                        }
                    }
                    .listRowBackground(Color.card)
                }
                if !model.running.isEmpty {
                    Section {
                        DisclosureGroup(isExpanded: $showRunning) {
                            ForEach(model.running) { task in
                                NavigationLink(value: InboxItem.task(task)) {
                                    RunningRow(task: task)
                                }
                            }
                        } label: {
                            HStack(spacing: 10) {
                                Circle().fill(Color.running).frame(width: 6, height: 6)
                                Text("Going on")
                                    .foregroundStyle(Color.ink)
                                Spacer()
                                Text("\(model.running.count) running")
                                    .font(.footnote)
                                    .foregroundStyle(Color.inkMuted)
                            }
                        }
                        .accessibilityIdentifier("going-on")
                    }
                    .listRowBackground(Color.card)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.canvas.ignoresSafeArea())
            .overlay {
                if !model.loaded { ProgressView() }
            }
            .navigationTitle("Needs you")
            .navigationDestination(for: InboxItem.self) { item in
                switch item {
                case .question(let question): QuestionScreen(model: model, question: question)
                case .task(let task): TaskThreadView(model: model, task: task)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showAccount = true
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                    .accessibilityLabel("Account")
                    .accessibilityIdentifier("account-button")
                }
            }
            .refreshable { await model.load() }
            .sheet(isPresented: $showAccount) {
                AccountSheet(team: model.team.name, server: session.serverText) {
                    showAccount = false
                    session.signOut()
                }
            }
        }
    }

    private func projectName(_ item: InboxItem) -> String? {
        if case .task(let task) = item { return model.projectName(task.projectId) }
        return nil
    }
}

private struct InboxRow: View {
    let item: InboxItem
    let projectName: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            leading
                .frame(width: 20, height: 20)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Color.ink)
                    .lineLimit(2)
                switch item {
                case .question(let question):
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Asked you a question.")
                            .font(.footnote)
                            .foregroundStyle(Color.waiting)
                        Text("Coordinator · \(question.ask.questions.first?.options.count ?? 0) options")
                            .font(.caption)
                            .foregroundStyle(Color.inkMuted)
                    }
                case .task(let task):
                    StatusLine(task: task, projectName: projectName)
                }
            }
            Spacer(minLength: 8)
            Text(date, format: .relative(presentation: .named, unitsStyle: .abbreviated))
                .font(.caption)
                .foregroundStyle(Color.inkMuted)
                .padding(.top, 2)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var leading: some View {
        switch item {
        case .question:
            CairnMark(spiral: .small).fill(Color.ink).frame(width: 16, height: 16)
        case .task(let task):
            if task.status == .failed {
                Image(systemName: "exclamationmark.circle").foregroundStyle(Color.inkMuted)
            } else {
                Circle().fill(Color.waiting).frame(width: 8, height: 8)
            }
        }
    }

    private var title: String {
        switch item {
        case .question(let question):
            let first = question.ask.questions.first
            return [first?.header, first?.question].compactMap { $0 }.joined(separator: ": ")
        case .task(let task):
            return task.title
        }
    }

    private var date: Date {
        switch item {
        case .question(let question): question.message.created
        case .task(let task): task.changed
        }
    }
}

private struct RunningRow: View {
    let task: TaskRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(task.title)
                .font(.callout)
                .foregroundStyle(Color.ink)
                .lineLimit(1)
            Text(task.reason)
                .font(.footnote)
                .foregroundStyle(Color.inkMuted)
        }
    }
}

private struct AccountSheet: View {
    let team: String
    let server: String
    let onSignOut: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Team", value: team)
                    LabeledContent("Server", value: server)
                }
                .listRowBackground(Color.card)
                Section {
                    Button("Sign out", role: .destructive, action: onSignOut)
                }
                .listRowBackground(Color.card)
            }
            .scrollContentBackground(.hidden)
            .background(Color.canvas.ignoresSafeArea())
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }
}
