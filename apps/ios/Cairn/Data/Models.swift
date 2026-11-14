import Foundation

struct Team: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
}

struct Project: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
}

struct Machine: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let online: Bool
    let runningSteps: Int?
}

struct CoordinatorThread: Decodable, Identifiable, Hashable, Sendable {
    struct Orchestration: Decodable, Hashable, Sendable {
        let todoId: String
        let state: String
    }

    let id: String
    let title: String
    let updatedAt: Double
    let lastTurnAt: Double?
    var orchestration: Orchestration? = nil
}

enum ThreadStatus: Sendable {
    case needsYou, running, failed, done, idle
}

enum TaskDecision: Sendable {
    case start, approve, retry

    var label: LocalizedStringResource {
        switch self {
        case .start: "Start"
        case .approve: "Approve plan"
        case .retry: "Retry"
        }
    }

    var reason: LocalizedStringResource {
        switch self {
        case .start: "Not started."
        case .approve: "The plan is ready. To change it, reply below."
        case .retry: "It failed. Retry, or reply below with what to change."
        }
    }
}

struct TaskRecord: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let seqNum: Int
    let title: String
    let spec: String
    let phase: String
    let phaseAt: Double
    let projectId: String
    let latestBuildId: String?
    let archivedAt: Double?

    var changed: Date { Date(timeIntervalSince1970: phaseAt / 1000) }

    var status: ThreadStatus {
        switch phase {
        case "queued", "planning", "building": return .running
        case "confirm", "needs_input", "review": return .needsYou
        case "failed": return .failed
        case "done", "closed": return .done
        default: return .idle
        }
    }

    var decision: TaskDecision? {
        guard archivedAt == nil else { return nil }
        switch phase {
        case "todo": return .start
        case "confirm": return latestBuildId == nil ? nil : .approve
        case "failed": return .retry
        default: return nil
        }
    }

    var canComplete: Bool { phase == "review" && archivedAt == nil && latestBuildId != nil }

    var actRank: Int {
        if phase == "needs_input" || phase == "confirm" { return 0 }
        if phase == "failed" { return 1 }
        return 2
    }

    var statusWord: String {
        switch status {
        case .needsYou: "Needs you"
        case .running: "Running"
        case .failed: "Failed"
        case .done: "Done"
        case .idle: "Idle"
        }
    }

    var reason: String {
        switch phase {
        case "needs_input": return String(localized: "Asked you a question.")
        case "confirm": return String(localized: "Plan ready. Approve to start.")
        case "review": return String(localized: "Ready for your review.")
        case "failed": return String(localized: "Failed. Open it to retry.")
        case "queued": return String(localized: "Waiting for a machine.")
        case "planning": return String(localized: "Writing the plan.")
        case "building": return String(localized: "Working on it.")
        case "todo": return String(localized: "Not started.")
        default: return String(localized: "Done.")
        }
    }
}

struct QuestionOption: Decodable, Hashable, Sendable {
    let label: String
    let description: String?
    let recommended: Bool?
}

struct QuestionItem: Decodable, Hashable, Sendable {
    let header: String
    let question: String
    let options: [QuestionOption]
    let multiSelect: Bool?

    static func pick(_ label: String, in picked: [String], multiSelect: Bool) -> [String] {
        guard multiSelect else { return [label] }
        return picked.contains(label) ? picked.filter { $0 != label } : picked + [label]
    }
}

struct QuestionAnswer: Codable, Hashable, Sendable {
    let header: String
    let choices: [String]?
    let text: String?
}

struct AskQuestion: Decodable, Hashable, Sendable {
    let requestId: String
    let status: String
    let questions: [QuestionItem]
    let answers: [QuestionAnswer]?

    var isPending: Bool { status == "pending" }

    func replyText(_ answers: [QuestionAnswer]) -> String {
        let values = answers.map { $0.text ?? ($0.choices ?? []).joined(separator: ", ") }
        if values.count == 1 { return values[0] }
        return zip(answers, values).map { "\($0.header): \($1)" }.joined(separator: "\n")
    }

    func reply(_ replies: [Int: [String]]) -> [QuestionAnswer]? {
        var answers: [QuestionAnswer] = []
        for (index, item) in questions.enumerated() {
            let picked = replies[index] ?? []
            if item.options.isEmpty {
                let text = (picked.first ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return nil }
                answers.append(QuestionAnswer(header: item.header, choices: nil, text: text))
            } else {
                let choices = item.options.map(\.label).filter(picked.contains)
                guard !choices.isEmpty else { return nil }
                answers.append(QuestionAnswer(header: item.header, choices: choices, text: nil))
            }
        }
        return answers
    }
}

struct MessagePart: Decodable, Hashable, Sendable {
    let type: String?
    let text: String?
    let name: String?
}

enum MessageContent: Decodable, Hashable, Sendable {
    case text(String)
    case parts([MessagePart])
    case toolCall(String)
    case startedTask(String)
    case question(AskQuestion)
    case turnError(String)

    private struct Tagged: Decodable {
        struct Call: Decodable {
            let name: String
            let result: ToolResult?
            let isError: Bool?
        }
        let kind: String
        let call: Call?
        let message: String?
    }

    private struct ToolResult: Decodable {
        let createdId: String?

        private struct Part: Decodable { let text: String? }
        private struct Created: Decodable { let id: String }

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let created = try? container.decode(Created.self) {
                createdId = created.id
                return
            }
            let text = (try? container.decode(String.self))
                ?? (try? container.decode([Part].self))?.compactMap(\.text).joined(separator: "\n")
            createdId = text.flatMap { try? JSONDecoder().decode(Created.self, from: Data($0.utf8)) }?.id
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) {
            self = Self.tagged(Data(string.utf8)) ?? .text(string)
        } else if let parts = try? container.decode([MessagePart].self) {
            self = .parts(parts)
        } else if let tagged = try? container.decode(Tagged.self) {
            if tagged.kind == "ask_user_question", let question = try? container.decode(AskQuestion.self) {
                self = .question(question)
            } else if tagged.kind == "chief_turn_error" {
                self = .turnError(tagged.message ?? "")
            } else {
                self = Self.call(tagged)
            }
        } else {
            self = .text("")
        }
    }

    private static func tagged(_ data: Data) -> MessageContent? {
        guard let tag = try? JSONDecoder().decode(Tagged.self, from: data) else { return nil }
        if tag.kind == "ask_user_question", let question = try? JSONDecoder().decode(AskQuestion.self, from: data) {
            return .question(question)
        }
        if tag.kind == "toolcall" { return call(tag) }
        if tag.kind == "chief_turn_error" { return .turnError(tag.message ?? "") }
        return nil
    }

    private static func call(_ tagged: Tagged) -> MessageContent {
        guard let call = tagged.call else { return .toolCall(tagged.kind) }
        if call.name == "create_todo", call.isError != true, let id = call.result?.createdId {
            return .startedTask(id)
        }
        return .toolCall(call.name)
    }

    var plainText: String {
        switch self {
        case .text(let string):
            string
        case .parts(let parts):
            parts.compactMap { $0.type == nil || $0.type == "text" ? $0.text : nil }.joined(separator: "\n\n")
        case .toolCall, .startedTask, .question, .turnError:
            ""
        }
    }
}

struct ThreadMessage: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let role: String
    let content: MessageContent
    let createdAt: Double

    var isUser: Bool { role == "user" }
    var created: Date { Date(timeIntervalSince1970: createdAt / 1000) }

    var question: AskQuestion? {
        if case .question(let question) = content { return question }
        return nil
    }
}

struct ActiveRun: Decodable, Hashable, Sendable {
    struct Tool: Decodable, Hashable, Sendable {
        let toolName: String
    }

    let phase: String?
    let tool: Tool?
}

struct MessagePage: Decodable, Sendable {
    let messages: [ThreadMessage]
    let activeRun: ActiveRun?
    let nextCursor: String?
}

struct TaskMessageResult: Decodable, Sendable {
    let conversationId: String
}

struct SendResult: Decodable, Sendable {
    let thread: CoordinatorThread
}

struct Accepted: Decodable, Sendable {}

struct StreamEvent: Decodable, Sendable {
    let type: String
    let text: String?
}

struct APIErrorBody: Decodable {
    let error: String?
    let message: String?
}
