import XCTest

@MainActor
final class ReadmeShotsTests: XCTestCase {
    private var app: XCUIApplication!
    private var env: [String: String] { ProcessInfo.processInfo.environment }
    private var language: String { env["CAIRN_SHOT_LANGUAGE"] ?? "en" }
    private var appearance: String { env["CAIRN_PILOT_APPEARANCE"] ?? "light" }

    override func setUp() async throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = [
            "-cairn-reset", "-AppleLanguages", "(\(language))", "-AppleLocale", language == "en" ? "en_US" : "zh_CN",
        ]
        app.launch()
    }

    func testReadmeStory() throws {
        let server = try XCTUnwrap(env["CAIRN_PILOT_SERVER"], "set TEST_RUNNER_CAIRN_PILOT_SERVER")
        let token = try XCTUnwrap(env["CAIRN_PILOT_TOKEN"], "set TEST_RUNNER_CAIRN_PILOT_TOKEN")

        let serverField = app.textFields["server-field"]
        XCTAssertTrue(serverField.waitForExistence(timeout: 10))
        serverField.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        serverField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
        serverField.typeText(server)
        app.secureTextFields["token-field"].tap()
        app.secureTextFields["token-field"].typeText(token)
        app.buttons["sign-in-button"].tap()

        let cards = app.descendants(matching: .any).matching(identifier: "thread-card")
        XCTAssertTrue(element("question-card").waitForExistence(timeout: 15))
        XCTAssertEqual(cards.count, 2)
        sleep(2)
        capture("01-home")

        cards.element(boundBy: 0).tap()
        XCTAssertTrue(element("assistant-message").waitForExistence(timeout: 10))
        sleep(2)
        capture("02-thread")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        XCTAssertTrue(element("tasks-button").waitForExistence(timeout: 5))
        element("tasks-button").tap()
        XCTAssertTrue(element("inbox-row").waitForExistence(timeout: 10))
        sleep(2)
        capture("03-tasks")
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "\(name)-\(language)-\(appearance)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
