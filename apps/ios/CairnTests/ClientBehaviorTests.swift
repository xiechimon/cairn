import XCTest
@testable import Cairn

private final class Switch: @unchecked Sendable {
    var failing = true
}

@MainActor
private final class FollowProbe {
    var reloads = 0
    var deltas = ""
}

private func page(_ ids: [String], next: String?) -> String {
    let rows = ids.enumerated().map { index, id in
        #"{"id":"\#(id)","role":"assistant","content":"row \#(id)","createdAt":\#(index)}"#
    }
    let cursor = next.map { #""\#($0)""# } ?? "null"
    return #"{"messages":[\#(rows.joined(separator: ","))],"activeRun":null,"nextCursor":\#(cursor)}"#
}

private func sentContent(_ request: URLRequest) -> String? {
    guard let stream = request.httpBodyStream else { return nil }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        guard count > 0 else { break }
        data.append(buffer, count: count)
    }
    return (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["content"] as? String
}

@MainActor
final class ClientBehaviorTests: XCTestCase {
    private let server = URL(string: "http://stub.test")!

    private func client(_ session: URLSession) -> CairnClient {
        CairnClient(credentials: Credentials(serverURL: server, token: "stub-token"), session: session)
    }

    func testMessagesFollowTheCursorToTheOldestPage() async throws {
        let session = StubServer.session { request in
            request.query("before") == "m2"
                ? .init(status: 200, body: page(["m1"], next: nil))
                : .init(status: 200, body: page(["m2", "m3"], next: "m2"))
        }
        let result = try await client(session).messages(threadId: "chief_1")
        XCTAssertEqual(result.messages.map(\.id), ["m1", "m2", "m3"])
        XCTAssertEqual(StubServer.requests.filter { $0.url?.path == "/api/conversations/chief_1/messages" }.count, 2)
    }

    func testTaskMessageReturnsTheConversationItLandedIn() async throws {
        let session = StubServer.session { _ in
            .init(status: 201, body: #"{"todoId":"t1","conversationId":"build_2","delivered":"started"}"#)
        }
        let result = try await client(session).messageTask(taskId: "t1", content: "retry please")
        XCTAssertEqual(result.conversationId, "build_2")
    }

    func testAnswersCoverTextSingleAndMultiSelect() throws {
        let ask = AskQuestion(
            requestId: "r1",
            status: "pending",
            questions: [
                QuestionItem(header: "Name", question: "What should it be called?", options: [], multiSelect: nil),
                QuestionItem(header: "Ship", question: "Ship now?", options: [QuestionOption(label: "Yes", description: nil, recommended: true)], multiSelect: nil),
                QuestionItem(header: "Targets", question: "Which targets?", options: [
                    QuestionOption(label: "iOS", description: nil, recommended: nil),
                    QuestionOption(label: "Web", description: nil, recommended: nil),
                ], multiSelect: true),
            ],
            answers: nil
        )
        XCTAssertNil(ask.reply([0: ["  "], 1: ["Yes"], 2: ["iOS"]]))
        XCTAssertNil(ask.reply([1: ["Yes"], 2: ["iOS"]]))
        XCTAssertNil(ask.reply([0: ["Atlas"], 1: ["Yes"], 2: []]))
        let answers = try XCTUnwrap(ask.reply([0: [" Atlas "], 1: ["Yes"], 2: ["Web", "iOS"]]))
        XCTAssertEqual(answers, [
            QuestionAnswer(header: "Name", choices: nil, text: "Atlas"),
            QuestionAnswer(header: "Ship", choices: ["Yes"], text: nil),
            QuestionAnswer(header: "Targets", choices: ["iOS", "Web"], text: nil),
        ])
        let body = String(decoding: try JSONEncoder().encode(answers[0]), as: UTF8.self)
        XCTAssertFalse(body.contains("choices"))
    }

    func testThreadRowsHangOnTheReplyThatStartedThem() throws {
        let created = #"{\"id\":\"todo_9\",\"seqNum\":9,\"title\":\"Stream the export\"}"#
        let json = """
        [
          {"id":"u1","role":"user","createdAt":1,"content":"Make the export fast"},
          {"id":"c1","role":"assistant","createdAt":2,"content":{"kind":"toolcall","call":{"id":"x","name":"create_todo","arguments":{},"result":[{"type":"text","text":"\(created)"}]}}},
          {"id":"c2","role":"assistant","createdAt":3,"content":{"kind":"toolcall","call":{"id":"y","name":"create_todo","arguments":{},"result":"{\\"id\\":\\"todo_10\\"}","isError":true}}},
          {"id":"c3","role":"assistant","createdAt":4,"content":{"kind":"toolcall","call":{"id":"z","name":"read_todo","arguments":{},"result":"{\\"id\\":\\"todo_11\\"}"}}},
          {"id":"a1","role":"assistant","createdAt":5,"content":"Opened a thread."},
          {"id":"u2","role":"user","createdAt":6,"content":"Draft a reply"},
          {"id":"c4","role":"assistant","createdAt":7,"content":{"kind":"toolcall","call":{"id":"w","name":"create_todo","arguments":{},"result":{"id":"todo_12"}}}}
        ]
        """
        let messages = try JSONDecoder().decode([ThreadMessage].self, from: Data(json.utf8))
        XCTAssertEqual(messages[1].content, .startedTask("todo_9"))
        XCTAssertEqual(messages[2].content, .toolCall("create_todo"), "a failed create_todo starts no thread")
        XCTAssertEqual(messages[3].content, .toolCall("read_todo"))
        XCTAssertEqual(ConversationRow.rows(messages.reversed()), [
            .message(messages[0]), .task(todoId: "todo_9", onReply: true), .message(messages[4]),
            .message(messages[5]), .task(todoId: "todo_12", onReply: false),
        ])
    }

    func testStatusMarkFollowsTheCoordinatorsTurn() throws {
        let json = """
        {"messages":[{"id":"e1","role":"system","createdAt":1,"content":"{\\"kind\\":\\"chief_turn_error\\",\\"message\\":\\"Model quota ran out\\"}"}],
         "activeRun":{"phase":"chief","tool":{"toolName":"bash"}},"nextCursor":null}
        """
        let page = try JSONDecoder().decode(MessagePage.self, from: Data(json.utf8))
        XCTAssertEqual(page.messages[0].content, .turnError("Model quota ran out"))
        XCTAssertEqual(page.activeRun?.tool?.toolName, "bash")

        func mark(question: Bool = false, connected: Bool = true, running: Bool = true, tool: String? = nil, replying: Bool = false, failed: Bool = false) -> StatusMarkID {
            .of(questionPending: question, connected: connected, running: running, tool: tool, replying: replying, lastTurnFailed: failed)
        }
        XCTAssertEqual(mark(tool: "bash"), .run)
        XCTAssertEqual(mark(tool: "create_todo"), .task)
        XCTAssertEqual(mark(tool: "needs_you"), .look)
        XCTAssertEqual(mark(tool: "read_file"), .look)
        XCTAssertEqual(mark(tool: "remember"), .think)
        XCTAssertEqual(mark(replying: true), .write)
        XCTAssertEqual(mark(), .think)
        XCTAssertEqual(mark(running: false, failed: true), .error)
        XCTAssertEqual(mark(running: false), .idle)
        XCTAssertEqual(mark(connected: false, tool: "bash"), .offline)
        XCTAssertEqual(mark(question: true, connected: false, tool: "bash"), .ask)
    }

    func testMarkSurvivesAFrameStampedBeforeTheStateChanged() {
        let frame = MarkGeometry.frame(shown: .idle, next: .ask, sinceChange: -16, still: false)
        XCTAssertEqual(frame.shown, .idle)
        XCTAssertFalse(MarkGeometry.path(frame.shown, t: 0, pen: frame.pen, still: false).isEmpty)
    }

    func testUploadedAttachmentBecomesAMessageToken() async throws {
        let session = StubServer.session { request in
            request.url?.path == "/api/uploads/grant"
                ? .init(status: 200, body: #"{"uploadUrl":"/api/uploads","grant":"g1","key":"team_1/att_9.jpg","attachmentId":"att_9"}"#)
                : .init(status: 201, body: #"{"key":"team_1/att_9.jpg"}"#)
        }
        let token = try await client(session).uploadAttachment(Data([1, 2, 3]), fileName: "receipt.jpg", mimeType: "image/jpeg")
        XCTAssertEqual(token, "![receipt.jpg](attachment:team_1/att_9.jpg)")
        let upload = try XCTUnwrap(StubServer.requests.last)
        XCTAssertEqual(upload.url?.path, "/api/uploads/upload")
        XCTAssertTrue(upload.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
    }

    func testSentAttachmentsSplitFromTheText() {
        let sent = SentText("![receipt 2.jpg](attachment:team/abc.jpg)\n\nWhy is this total wrong?")
        XCTAssertEqual(sent.files, ["receipt 2.jpg"])
        XCTAssertEqual(sent.text, "Why is this total wrong?")
    }

    func testPickingTogglesOnlyForMultiSelect() {
        XCTAssertEqual(QuestionItem.pick("Web", in: ["iOS"], multiSelect: false), ["Web"])
        XCTAssertEqual(QuestionItem.pick("Web", in: ["iOS"], multiSelect: true), ["iOS", "Web"])
        XCTAssertEqual(QuestionItem.pick("iOS", in: ["iOS", "Web"], multiSelect: true), ["Web"])
    }

    func testFollowReloadsWhenTheConversationPublishesAMessage() async {
        let session = StubServer.session { _ in
            .init(status: 200, body: "data: {\"type\":\"text_delta\",\"text\":\"hi\"}\n\ndata: {\"type\":\"message\"}\n\n")
        }
        let api = client(session)
        let probe = FollowProbe()
        let follow = Task { @MainActor in
            await followConversation(api, threadId: "build_1", onDelta: { probe.deltas += $0 }) { probe.reloads += 1 }
        }
        var waited = 0
        while probe.reloads < 2 && waited < 100 {
            try? await Task.sleep(for: .milliseconds(20))
            waited += 1
        }
        follow.cancel()
        XCTAssertGreaterThanOrEqual(probe.reloads, 2, "the initial load plus one for the published message")
        XCTAssertEqual(probe.deltas.prefix(2), "hi")
        XCTAssertEqual(StubServer.requests.first?.url?.path, "/api/conversations/build_1/stream")
    }

    private func refreshFailsAfter(_ mutationPath: String, reply: String) -> URLSession {
        StubServer.session { request in
            request.httpMethod == "POST" && request.url?.path == mutationPath
                ? .init(status: 201, body: reply)
                : .init(status: 503, body: #"{"error":"refresh down"}"#)
        }
    }

    func testAcceptedAnswerIsNotReportedAsFailedWhenRefreshFails() async throws {
        let path = "/api/teams/team_1/chief/threads/chief_1/questions/r1/answer"
        let model = AppModel(client: client(refreshFailsAfter(path, reply: "{}")), team: Team(id: "team_1", name: "Team"))
        model.adoptCoordinator(CoordinatorThread(id: "chief_1", title: "", updatedAt: 0, lastTurnAt: nil))
        let ask = AskQuestion(requestId: "r1", status: "pending", questions: [], answers: nil)
        let message = ThreadMessage(id: "m1", role: "assistant", content: .question(ask), createdAt: 0)
        try await model.answer(PendingQuestion(message: message, ask: ask), answers: [])
        XCTAssertEqual(StubServer.requests.filter { $0.httpMethod == "POST" }.count, 1)
        XCTAssertEqual(model.error, "Server error 503: refresh down")
    }

    func testDeliveredTaskMessageIsNotReportedAsFailedWhenRefreshFails() async throws {
        let session = refreshFailsAfter("/api/todos/t1/messages", reply: #"{"todoId":"t1","conversationId":"build_2","delivered":"started"}"#)
        let model = AppModel(client: client(session), team: Team(id: "team_1", name: "Team"))
        let conversation = try await model.message(taskId: "t1", content: "retry please")
        XCTAssertEqual(conversation, "build_2")
        XCTAssertEqual(StubServer.requests.filter { $0.httpMethod == "POST" }.count, 1)
        XCTAssertEqual(model.error, "Server error 503: refresh down")
    }

    func testThreadQuestionIsAnsweredByATaskMessage() async throws {
        let session = StubServer.session { request in
            request.httpMethod == "POST"
                ? .init(status: 201, body: #"{"todoId":"t1","conversationId":"build_2","delivered":"steered"}"#)
                : .init(status: 200, body: "[]")
        }
        let model = AppModel(client: client(session), team: Team(id: "team_1", name: "Team"))
        let json = #"{"id":"q1","role":"assistant","createdAt":1,"content":{"kind":"ask_user_question","requestId":"req_1","status":"pending","questions":[{"header":"Export limit","question":"Drop the cap?","multiSelect":false,"options":[{"label":"Drop the cap"},{"label":"Keep 50,000 rows"}]}],"answers":null}}"#
        let message = try JSONDecoder().decode(ThreadMessage.self, from: Data(json.utf8))
        let question = PendingQuestion(message: message, ask: try XCTUnwrap(message.question))

        let tapped = try await model.answer(question, answers: [QuestionAnswer(header: "Export limit", choices: ["Drop the cap"], text: nil)], inTask: "t1")
        let typed = try await model.answer(question, answers: [QuestionAnswer(header: "Export limit", choices: ["Keep it until Friday"], text: nil)], inTask: "t1")

        XCTAssertEqual(tapped, "build_2")
        XCTAssertEqual(typed, "build_2")
        let sent = StubServer.requests.filter { $0.httpMethod == "POST" }
        XCTAssertEqual(sent.map { $0.url?.path }, ["/api/todos/t1/messages", "/api/todos/t1/messages"])
        XCTAssertEqual(sent.map(sentContent), ["Drop the cap", "Keep it until Friday"])
    }

    func testMultiQuestionReplyNamesEachHeader() {
        let ask = AskQuestion(
            requestId: "req_2",
            status: "pending",
            questions: [
                QuestionItem(header: "Limit", question: "Drop it?", options: [QuestionOption(label: "Drop", description: nil, recommended: true)], multiSelect: nil),
                QuestionItem(header: "Formats", question: "Which?", options: [
                    QuestionOption(label: "CSV", description: nil, recommended: nil),
                    QuestionOption(label: "JSON", description: nil, recommended: nil),
                ], multiSelect: true),
            ],
            answers: nil
        )
        XCTAssertEqual(
            ask.replyText([
                QuestionAnswer(header: "Limit", choices: ["Drop"], text: nil),
                QuestionAnswer(header: "Formats", choices: ["CSV", "JSON"], text: nil),
            ]),
            "Limit: Drop\nFormats: CSV, JSON"
        )
    }

    func testRestoreFailureIsRecoverable() async {
        let account = server.absoluteString
        KeychainToken.write("stub-token", account: account)
        UserDefaults.standard.set(account, forKey: "cairn.serverURL")
        defer {
            KeychainToken.delete(account: account)
            UserDefaults.standard.removeObject(forKey: "cairn.serverURL")
        }
        let state = Switch()
        let urlSession = StubServer.session { _ in
            state.failing
                ? .init(status: 503, body: #"{"error":"warming up"}"#)
                : .init(status: 200, body: #"[{"id":"team_1","name":"Team"}]"#)
        }
        let session = Session(urlSession: urlSession)
        await session.restore()
        XCTAssertTrue(session.isSignedIn)
        XCTAssertNil(session.model)
        XCTAssertEqual(session.restoreError, "Server error 503: warming up")

        state.failing = false
        await session.restore()
        XCTAssertNil(session.restoreError)
        XCTAssertEqual(session.model?.team.id, "team_1")
    }
}
