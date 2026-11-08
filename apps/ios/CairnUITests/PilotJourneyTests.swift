import XCTest

@MainActor
final class PilotJourneyTests: XCTestCase {
    private var app: XCUIApplication!
    private var appearance: String { ProcessInfo.processInfo.environment["CAIRN_PILOT_APPEARANCE"] ?? "light" }

    override func setUp() async throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-cairn-reset"]
        app.launch()
    }

    func testInboxQuestionTaskAndCoordinator() throws {
        let env = ProcessInfo.processInfo.environment
        let server = try XCTUnwrap(env["CAIRN_PILOT_SERVER"], "set TEST_RUNNER_CAIRN_PILOT_SERVER")
        let token = try XCTUnwrap(env["CAIRN_PILOT_TOKEN"], "set TEST_RUNNER_CAIRN_PILOT_TOKEN")

        let serverField = app.textFields["server-field"]
        XCTAssertTrue(serverField.waitForExistence(timeout: 10))
        XCTAssertTrue(element("brand-mark").exists)
        capture("01-sign-in")

        serverField.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        serverField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
        serverField.typeText(server)
        XCTAssertEqual(serverField.value as? String, server)
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
        let notNow = app.buttons["Not Now"]
        if notNow.waitForExistence(timeout: 3) { notNow.tap() }

        let rows = app.descendants(matching: .any).matching(identifier: "inbox-row")
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(app.navigationBars["Needs you"].exists)
        XCTAssertEqual(rows.count, 4, "one Coordinator question plus plan-ready, failed and review tasks")
        XCTAssertTrue(rows.element(boundBy: 0).label.contains("Release"))
        sleep(1)
        capture("03-inbox")

        element("going-on").tap()
        let runningRow = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Translate settings attribution labels")).firstMatch
        XCTAssertTrue(runningRow.waitForExistence(timeout: 5))
        capture("04-inbox-going-on")
        element("going-on").tap()

        rows.element(boundBy: 0).tap()
        let option = element("option-1")
        XCTAssertTrue(option.waitForExistence(timeout: 10))
        capture("05-question")
        option.tap()
        capture("06-question-picked")
        app.buttons["answer-button"].tap()
        XCTAssertTrue(app.navigationBars["Needs you"].waitForExistence(timeout: 15))
        let afterAnswer = NSPredicate(format: "count == 3")
        expectation(for: afterAnswer, evaluatedWith: rows)
        waitForExpectations(timeout: 15)
        capture("07-inbox-after-answer")

        rows.element(boundBy: 0).tap()
        XCTAssertTrue(element("task-header").waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Split the merge gate into review and route checks"].waitForExistence(timeout: 5))
        sleep(1)
        capture("08-task-thread")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        app.tabBars.buttons["Coordinator"].tap()
        let composer = element("composer-field")
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        XCTAssertTrue(element("question-card").waitForExistence(timeout: 10))
        sleep(2)
        capture("09-coordinator")

        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let message = "Sent from the iOS pilot (\(appearance))"
        composer.typeText(message)
        app.buttons["send-button"].tap()
        XCTAssertTrue(app.staticTexts[message].waitForExistence(timeout: 10))
        let reply = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Stub model reply to \"\(message)\"")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 60))
        sleep(1)
        XCTAssertLessThanOrEqual(reply.frame.maxY, composer.frame.minY, "the newest reply must sit above the composer, not behind it")
        capture("10-coordinator-reply")

        reply.tap()
        let keyboardGone = NSPredicate(format: "count == 0")
        expectation(for: keyboardGone, evaluatedWith: app.keyboards)
        waitForExpectations(timeout: 5)
        app.tabBars.buttons["Needs you"].tap()
        let account = element("account-button")
        XCTAssertTrue(account.waitForExistence(timeout: 5))
        account.tap()
        XCTAssertTrue(app.buttons["Sign out"].waitForExistence(timeout: 5))
        sleep(1)
        capture("11-account")
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "\(name)-\(appearance)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
