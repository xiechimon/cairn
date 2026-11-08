import Foundation

struct Team: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
}

struct Project: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
}

struct CoordinatorThread: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let updatedAt: Double
    let lastTurnAt: Double?
}

enum ThreadStatus: Sendable {
    case needsYou, running, failed, done, idle
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
    let awaitingReply: Bool?
    let archivedAt: Double?

    var changed: Date { Date(timeIntervalSince1970: phaseAt / 1000) }

    var status: ThreadStatus {
        if awaitingReply == true { return .needsYou }
        switch phase {
        case "queued", "planning", "building": return .running
        case "confirm", "review": return .needsYou
        case "failed": return .failed
        case "done", "closed": return .done
        default: return .idle
        }
    }

    var actRank: Int {
        if awaitingReply == true || phase == "confirm" { return 0 }
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
        if awaitingReply == true { return "Asked you a question." }
        switch phase {
        case "confirm": return "Plan ready. Approve to start."
        case "review": return "Ready for your review."
        case "failed": return "Failed. Open it to retry."
        case "queued": return "Waiting for a machine."
        case "planning": return "Writing the plan."
        case "building": return "Working on it."
        case "todo": return "Not started."
        default: return "Done."
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
    case question(AskQuestion)

    private struct Tagged: Decodable {
        struct Call: Decodable { let name: String }
        let kind: String
        let call: Call?
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
            } else {
                self = .toolCall(tagged.call?.name ?? tagged.kind)
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
        if tag.kind == "toolcall" { return .toolCall(tag.call?.name ?? "tool") }
        return nil
    }

    var plainText: String {
        switch self {
        case .text(let string):
            string
        case .parts(let parts):
            parts.compactMap { $0.type == nil || $0.type == "text" ? $0.text : nil }.joined(separator: "\n\n")
        case .toolCall, .question:
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
    let phase: String?
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
