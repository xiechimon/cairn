import Foundation
import Observation

struct PendingQuestion: Identifiable, Hashable, Sendable {
    let message: ThreadMessage
    let ask: AskQuestion

    var id: String { ask.requestId }
}

enum InboxItem: Identifiable, Hashable, Sendable {
    case question(PendingQuestion)
    case task(TaskRecord)

    var id: String {
        switch self {
        case .question(let question): "q-\(question.id)"
        case .task(let task): "t-\(task.id)"
        }
    }
}

@MainActor
@Observable
final class AppModel {
    let client: CairnClient
    let team: Team
    private(set) var coordinator: CoordinatorThread?
    private(set) var tasks: [TaskRecord] = []
    private(set) var projects: [String: String] = [:]
    private(set) var coordinatorMessages: [ThreadMessage] = []
    private(set) var loaded = false
    var error: String?

    init(client: CairnClient, team: Team) {
        self.client = client
        self.team = team
    }

    var pendingQuestions: [PendingQuestion] {
        coordinatorMessages
            .compactMap { message in message.question.flatMap { $0.isPending ? PendingQuestion(message: message, ask: $0) : nil } }
            .sorted { $0.message.createdAt > $1.message.createdAt }
    }

    var needsYouTasks: [TaskRecord] {
        tasks
            .filter { ($0.status == .needsYou || $0.status == .failed) && $0.archivedAt == nil }
            .sorted { ($0.actRank, -$0.phaseAt) < ($1.actRank, -$1.phaseAt) }
    }

    var inbox: [InboxItem] {
        pendingQuestions.map(InboxItem.question) + needsYouTasks.map(InboxItem.task)
    }

    var running: [TaskRecord] {
        tasks.filter { $0.status == .running && $0.archivedAt == nil }.sorted { $0.phaseAt > $1.phaseAt }
    }

    func projectName(_ id: String) -> String? { projects[id] }

    func refresh() async throws {
        async let threadList = client.coordinatorThreads(teamId: team.id)
        async let taskList = client.tasks(teamId: team.id)
        async let projectList = client.projects(teamId: team.id)
        let threads = try await threadList
        tasks = try await taskList
        projects = Dictionary(uniqueKeysWithValues: ((try? await projectList) ?? []).map { ($0.id, $0.name) })
        coordinator = threads.first
        if let coordinator {
            coordinatorMessages = try await client.messages(threadId: coordinator.id).messages
        } else {
            coordinatorMessages = []
        }
        error = nil
        loaded = true
    }

    func load() async {
        do {
            try await refresh()
        } catch {
            self.error = error.localizedDescription
            loaded = true
        }
    }

    func answer(_ question: PendingQuestion, choices: [String]) async throws {
        guard let coordinator else { return }
        let answers = zip(question.ask.questions, choices).map { item, choice in
            QuestionAnswer(header: item.header, choices: [choice], text: nil)
        }
        try await client.answer(teamId: team.id, threadId: coordinator.id, requestId: question.ask.requestId, answers: answers)
        try await refresh()
    }

    func adoptCoordinator(_ thread: CoordinatorThread) {
        coordinator = thread
    }
}
