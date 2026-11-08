import Foundation

struct Team: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
}

struct CoordinatorThread: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let updatedAt: Double
    let lastTurnAt: Double?

    var updated: Date { Date(timeIntervalSince1970: (lastTurnAt ?? updatedAt) / 1000) }
}

struct TaskSummary: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let seqNum: Int
    let title: String
    let phase: String
    let phaseAt: Double

    var phaseLabel: String {
        switch phase {
        case "todo": "Not started"
        case "queued": "Queued"
        case "planning": "Planning"
        case "confirm": "Needs you"
        case "building": "Running"
        case "review": "In review"
        case "done": "Done"
        case "failed": "Failed"
        case "closed": "Closed"
        default: phase.capitalized
        }
    }

    var isRunning: Bool { ["queued", "planning", "building", "review"].contains(phase) }
    var needsYou: Bool { phase == "confirm" }
    var isOpen: Bool { !["done", "closed"].contains(phase) }
}

struct MessagePart: Decodable, Hashable, Sendable {
    let type: String?
    let text: String?
    let name: String?
}

enum MessageContent: Decodable, Hashable, Sendable {
    case text(String)
    case parts([MessagePart])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) {
            self = .text(string)
        } else if let parts = try? container.decode([MessagePart].self) {
            self = .parts(parts)
        } else {
            self = .text("")
        }
    }

    var plainText: String {
        switch self {
        case .text(let string):
            string
        case .parts(let parts):
            parts.compactMap { $0.type == nil || $0.type == "text" ? $0.text : nil }.joined(separator: "\n\n")
        }
    }

    var toolNames: [String] {
        guard case .parts(let parts) = self else { return [] }
        return parts.compactMap { $0.type == "toolCall" || $0.type == "tool_use" ? $0.name : nil }
    }
}

struct ThreadMessage: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let role: String
    let content: MessageContent
    let createdAt: Double

    var isUser: Bool { role == "user" }
    var created: Date { Date(timeIntervalSince1970: createdAt / 1000) }
}

struct ActiveRun: Decodable, Hashable, Sendable {
    let phase: String?
}

struct MessagePage: Decodable, Sendable {
    let messages: [ThreadMessage]
    let activeRun: ActiveRun?
}

struct SendResult: Decodable, Sendable {
    let thread: CoordinatorThread
}

struct StreamEvent: Decodable, Sendable {
    let type: String
    let text: String?
}

struct APIErrorBody: Decodable {
    let error: String?
    let message: String?
}
