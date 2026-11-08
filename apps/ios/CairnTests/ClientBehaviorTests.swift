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
        XCTAssertEqual(StubServer.requests.count, 2)
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
