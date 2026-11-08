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

    func testSignInListOpenAndSend() throws {
        let env = ProcessInfo.processInfo.environment
        let server = try XCTUnwrap(env["CAIRN_PILOT_SERVER"], "set TEST_RUNNER_CAIRN_PILOT_SERVER")
        let token = try XCTUnwrap(env["CAIRN_PILOT_TOKEN"], "set TEST_RUNNER_CAIRN_PILOT_TOKEN")

        let serverField = app.textFields["server-field"]
        XCTAssertTrue(serverField.waitForExistence(timeout: 10))
        capture("1-sign-in")

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
        capture("2-sign-in-rejected")

        tokenField.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        tokenField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20))
        tokenField.typeText(token)
        app.buttons["sign-in-button"].tap()

        let notNow = app.buttons["Not Now"]
        if notNow.waitForExistence(timeout: 3) { notNow.tap() }

        let row = app.buttons["thread-row"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        capture("3-thread-list")

        row.tap()
        let composer = app.descendants(matching: .any).matching(identifier: "composer-field").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        sleep(1)
        capture("4-thread")

        let before = app.otherElements.matching(identifier: "assistant-message").count
        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let message = "Sent from the iOS pilot (\(appearance))"
        composer.typeText(message)
        capture("5-composing")
        app.buttons["send-button"].tap()
        XCTAssertTrue(app.staticTexts[message].waitForExistence(timeout: 10))

        let reply = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Stub model reply to \"\(message)\"")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 60))
        XCTAssertGreaterThan(app.otherElements.matching(identifier: "assistant-message").count, before - 1)
        sleep(1)
        XCTAssertLessThanOrEqual(reply.frame.maxY, composer.frame.minY, "the newest reply must sit above the composer, not behind it")
        capture("6-reply")
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "\(name)-\(appearance)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
