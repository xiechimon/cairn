import XCTest

@MainActor
final class PilotJourneyTests: XCTestCase {
    private var app: XCUIApplication!
    private var env: [String: String] { ProcessInfo.processInfo.environment }
    private var appearance: String { env["CAIRN_PILOT_APPEARANCE"] ?? "light" }

    override func setUp() async throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-cairn-reset", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
    }

    func testChatHomeThreadQuestionAndTabs() throws {
        let server = try XCTUnwrap(env["CAIRN_PILOT_SERVER"], "set TEST_RUNNER_CAIRN_PILOT_SERVER")
        let token = try XCTUnwrap(env["CAIRN_PILOT_TOKEN"], "set TEST_RUNNER_CAIRN_PILOT_TOKEN")

        let serverField = app.textFields["server-field"]
        XCTAssertTrue(serverField.waitForExistence(timeout: 10))
        XCTAssertTrue(element("brand-mark").exists)
        capture("01-sign-in")

        serverField.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        serverField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
        serverField.typeText(server)
        let tokenField = app.secureTextFields["token-field"]
        tokenField.tap()
        tokenField.typeText("wrong-token")
        app.buttons["sign-in-button"].tap()
        let rejection = app.staticTexts["sign-in-error"]
        XCTAssertTrue(rejection.waitForExistence(timeout: 10))
        XCTAssertEqual(rejection.label, "The server rejected this token.")
        capture("02-sign-in-rejected")

        tokenField.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        tokenField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20))
        tokenField.typeText(token)
        app.buttons["sign-in-button"].tap()

        XCTAssertTrue(element("question-card").waitForExistence(timeout: 15), "the app opens on the Coordinator conversation")
        XCTAssertFalse(app.sheets.firstMatch.waitForExistence(timeout: 3), "the token must not be offered to Passwords")
        XCTAssertEqual(all("thread-card").count, 2, "one thread row on each reply that started a thread")
        XCTAssertEqual(all("user-message").count, 2)
        XCTAssertTrue(element("option-3").exists, "the question shows its three options as chips")
        XCTAssertEqual(element("tasks-button").value as? String, "3")
        sleep(2)
        XCTAssertLessThanOrEqual(element("option-3").frame.maxY, element("composer-field").frame.minY)
        capture("03-home")

        all("thread-card").element(boundBy: 0).tap()
        XCTAssertTrue(element("assistant-message").waitForExistence(timeout: 10))
        sleep(1)
        capture("04-thread")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        XCTAssertTrue(element("option-1").waitForExistence(timeout: 5))
        element("option-1").tap()
        XCTAssertTrue(element("answered-choice").waitForExistence(timeout: 10))
        sleep(1)
        capture("05-question-answered")

        element("tasks-button").tap()
        let rows = all("inbox-row")
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(rows.count, 2, "the review and the needs-input thread; the answered question is gone")
        XCTAssertEqual(all("task-row").count, 3, "one running, one to start, one done")
        sleep(1)
        capture("06-tasks")

        app.tabBars.buttons.element(boundBy: 2).tap()
        sleep(1)
        capture("07-made")

        app.tabBars.buttons.element(boundBy: 0).tap()
        let account = element("account-button")
        XCTAssertTrue(account.waitForExistence(timeout: 5))
        account.tap()
        XCTAssertTrue(element("sign-out-button").waitForExistence(timeout: 5))
        sleep(1)
        capture("08-account")
    }

    private func all(_ identifier: String) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(identifier: identifier)
    }

    private func element(_ identifier: String) -> XCUIElement {
        all(identifier).firstMatch
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "\(name)-\(appearance)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
