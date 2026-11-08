import Foundation

enum CairnError: LocalizedError, Equatable {
    case badServerURL
    case unauthorized
    case server(status: Int, message: String)
    case offline(String)

    var errorDescription: String? {
        switch self {
        case .badServerURL: "Enter a server address such as http://localhost:8787."
        case .unauthorized: "The server rejected this token."
        case .server(let status, let message): "Server error \(status): \(message)"
        case .offline(let reason): "Could not reach the server. \(reason)"
        }
    }
}

struct Credentials: Hashable, Sendable {
    let serverURL: URL
    let token: String
}

struct CairnClient: Sendable {
    let credentials: Credentials
    private let session: URLSession

    init(credentials: Credentials, session: URLSession = .shared) {
        self.credentials = credentials
        self.session = session
    }

    func teams() async throws -> [Team] {
        try await get("/api/teams")
    }

    func coordinatorThreads(teamId: String) async throws -> [CoordinatorThread] {
        try await get("/api/teams/\(teamId)/chief/threads")
    }

    func tasks(teamId: String) async throws -> [TaskRecord] {
        try await get("/api/todos", query: [URLQueryItem(name: "teamId", value: teamId)])
    }

    func projects(teamId: String) async throws -> [Project] {
        try await get("/api/projects", query: [URLQueryItem(name: "teamId", value: teamId)])
    }

    func messageTask(taskId: String, content: String) async throws -> TaskMessageResult {
        try await post("/api/todos/\(taskId)/messages", body: SendBody(content: content))
    }

    func answer(teamId: String, threadId: String, requestId: String, answers: [QuestionAnswer]) async throws {
        let _: Accepted = try await post(
            "/api/teams/\(teamId)/chief/threads/\(threadId)/questions/\(requestId)/answer",
            body: AnswerBody(answers: answers)
        )
    }

    func messages(threadId: String) async throws -> MessagePage {
        let path = "/api/conversations/\(threadId)/messages"
        let latest: MessagePage = try await get(path, query: [URLQueryItem(name: "limit", value: "200")])
        var messages = latest.messages
        var cursor = latest.nextCursor
        while let before = cursor {
            let older: MessagePage = try await get(path, query: [
                URLQueryItem(name: "limit", value: "200"),
                URLQueryItem(name: "before", value: before),
            ])
            messages = older.messages + messages
            cursor = older.nextCursor
        }
        return MessagePage(messages: messages, activeRun: latest.activeRun, nextCursor: nil)
    }

    func send(threadId: String, content: String) async throws -> SendResult {
        try await post("/api/conversations/\(threadId)/messages", body: SendBody(content: content))
    }

    func startThread(teamId: String, content: String) async throws -> SendResult {
        try await post("/api/teams/\(teamId)/chief/threads", body: SendBody(content: content))
    }

    func stream(threadId: String) -> AsyncThrowingStream<StreamEvent, Error> {
        let request = authorized(url("/api/conversations/\(threadId)/stream"), accept: "text/event-stream")
        let session = self.session
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: request)
                    try Self.check(response, data: Data())
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data:") else { continue }
                        let payload = Data(line.dropFirst(5).trimmingCharacters(in: .whitespaces).utf8)
                        if let event = try? JSONDecoder().decode(StreamEvent.self, from: payload) {
                            continuation.yield(event)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private struct AnswerBody: Encodable {
        let answers: [QuestionAnswer]
    }

    private struct SendBody: Encodable {
        let content: String
        let clientMessageId = UUID().uuidString
    }

    private func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var components = URLComponents(url: credentials.serverURL, resolvingAgainstBaseURL: false)!
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        return components.url!
    }

    private func authorized(_ url: URL, accept: String = "application/json") -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        request.setValue(accept, forHTTPHeaderField: "Accept")
        request.timeoutInterval = accept == "text/event-stream" ? 3600 : 20
        return request
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await perform(authorized(url(path, query: query)))
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = authorized(url(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await perform(request)
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw CairnError.offline(error.localizedDescription)
        }
        try Self.check(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private static func check(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        if http.statusCode == 401 || http.statusCode == 403 { throw CairnError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let body = try? JSONDecoder().decode(APIErrorBody.self, from: data)
            throw CairnError.server(status: http.statusCode, message: body?.error ?? body?.message ?? "")
        }
    }
}
