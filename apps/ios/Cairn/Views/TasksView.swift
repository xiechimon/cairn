import SwiftUI

struct TasksView: View {
    let model: AppModel
    @Binding var path: [InboxItem]

    var body: some View {
        NavigationStack(path: $path) {
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
                if model.loaded && model.inbox.isEmpty && model.tasks.isEmpty && model.error == nil {
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
                group("Needs you", phase: "review", items: model.inbox, detailed: true)
                group("In progress", phase: "building", items: model.running.map(InboxItem.task))
                group("To start", phase: "todo", items: model.upNext.map(InboxItem.task))
                group("Done", phase: "done", items: model.finished.map(InboxItem.task))
            }
            .scrollContentBackground(.hidden)
            .background(Color.canvas.ignoresSafeArea())
            .overlay {
                if !model.loaded { ProgressView() }
            }
            .navigationTitle("Tasks")
            .navigationDestination(for: InboxItem.self) { item in
                switch item {
                case .question(let question): QuestionScreen(model: model, question: question)
                case .task(let task): TaskThreadView(model: model, task: task)
                }
            }
            .refreshable { await model.load() }
        }
    }

    @ViewBuilder private func group(_ title: LocalizedStringKey, phase: String, items: [InboxItem], detailed: Bool = false) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { item in
                    NavigationLink(value: item) {
                        TaskRow(item: item, projectName: projectName(item), detailed: detailed)
                    }
                    .accessibilityIdentifier(detailed ? "inbox-row" : "task-row")
                }
            } header: {
                HStack(spacing: 8) {
                    StatusTile(phase: phase, size: 18)
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.ink)
                    Text("\(items.count)")
                        .font(.subheadline)
                        .foregroundStyle(Color.inkMuted)
                }
                .textCase(nil)
            }
            .listRowBackground(Color.card)
        }
    }

    private func projectName(_ item: InboxItem) -> String? {
        if case .task(let task) = item { return model.projectName(task.projectId) }
        return nil
    }
}

private struct TaskRow: View {
    let item: InboxItem
    let projectName: String?
    let detailed: Bool

    var body: some View {
        HStack(alignment: detailed ? .top : .center, spacing: 10) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body)
                    .foregroundStyle(Color.ink)
                    .lineLimit(detailed ? 2 : 1)
                if detailed {
                    Text(meta)
                        .font(.footnote)
                        .foregroundStyle(Color.inkMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Text(compactAge(since: date))
                .font(.footnote.monospacedDigit())
                .foregroundStyle(Color.inkMuted)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var leading: some View {
        switch item {
        case .question:
            CairnMark(spiral: .small)
                .fill(Color.ink)
                .frame(width: 12, height: 12)
                .frame(width: 22, height: 22)
                .background(Color.replyBubble, in: .rect(cornerRadius: 5))
        case .task(let task):
            StatusTile(phase: task.phase, size: 22)
        }
    }

    private var title: String {
        switch item {
        case .question(let question): question.ask.questions.first?.question ?? ""
        case .task(let task): task.title
        }
    }

    private var meta: String {
        switch item {
        case .question: String(localized: "Asked you a question.")
        case .task(let task): [task.reason, projectName].compactMap { $0 }.joined(separator: " · ")
        }
    }

    private var date: Date {
        switch item {
        case .question(let question): question.message.created
        case .task(let task): task.changed
        }
    }
}
