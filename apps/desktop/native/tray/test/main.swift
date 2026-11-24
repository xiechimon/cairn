import AppKit

var assertions = 0
var failures: [String] = []

func expect(_ condition: Bool, _ message: @autoclosure () -> String) {
  assertions += 1
  if !condition { failures.append(message()) }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

guard CommandLine.arguments.count == 2,
  let line = try? String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8),
  let message = Channel.decode(line.trimmingCharacters(in: .whitespacesAndNewlines)),
  let fixture = message.menu
else {
  print("usage: tray-helper-test <fixture menu line>")
  exit(64)
}

var sent: [String] = []
let tray = TrayMenu(fixture, brand: nil) { message in
  if case .action(let id) = message { sent.append(id) } else { sent.append("\(message.json["type"]!)") }
}
let menu = tray.menu

expect(menu.items.count == fixture.items.count, "menu has \(menu.items.count) items, model \(fixture.items.count)")
expect(menu.minimumWidth == BigButton.menuWidth, "menu width \(menu.minimumWidth)")
expect(!menu.autoenablesItems, "menu auto-enables items")

let coordinator = tray.items["coordinator"]!
expect(coordinator.title == "Coordinator · 正在回复", "coordinator title \(coordinator.title)")
expect(coordinator.isEnabled, "coordinator row is disabled")
expect(coordinator.accessibilityLabel() == "Coordinator, 正在回复", "coordinator label \(coordinator.accessibilityLabel() ?? "nil")")

let stalled = tray.items["machine:m1/a"]!
expect(stalled.attributedTitle != nil, "stalled row has no warning colour")
expect(stalled.toolTip == "还在运行，但 16 分钟没有新输出或工具结果", "stalled tip \(stalled.toolTip ?? "nil")")
expect(stalled.image != nil, "stalled row has no glyph")
expect(
  stalled.accessibilityLabel() == "审阅发行说明, 16 分钟无进展, 还在运行，但 16 分钟没有新输出或工具结果",
  "stalled label \(stalled.accessibilityLabel() ?? "nil")")

let long = tray.items["machine:m1/b"]!
expect(long.title.contains("…") && long.title.hasSuffix(" · 8 分"), "long row not truncated before its status: \(long.title)")
expect(long.toolTip?.hasPrefix("把菜单栏弹层换成原生菜单并补齐键盘操作和读屏标签 · 8 分") == true, "long row tip \(long.toolTip ?? "nil")")

let header = tray.headers["machine:m2"]!
expect(header.spokenLabel == "build-box, 94%, 内存压力 94%；CPU 88%；剩余磁盘 9 GB", "header label \(header.spokenLabel)")
expect(tray.items["machine:m2"]!.isEnabled == false, "machine header is enabled")
expect(header.meter.stringValue == "94%", "meter \(header.meter.stringValue)")
expect(header.icon.image != nil, "machine header has no OS icon")

let user = tray.items["user"]!
expect(!user.isEnabled, "the user row is enabled")
expect(tray.items["settings"]!.keyEquivalent == ",", "settings key \(tray.items["settings"]!.keyEquivalent)")
expect(tray.items["quit"]!.keyEquivalent == "q", "quit key")

let runner = tray.buttons["runner"]!
let awake = tray.buttons["keep-awake"]!
expect(runner.accessibilityRole() == .checkBox && runner.accessibilitySubrole() == .switch, "runner role")
expect((runner.accessibilityValue() as? NSNumber)?.intValue == 1, "runner value")
expect((awake.accessibilityValue() as? NSNumber)?.intValue == 0, "keep-awake value")
expect(runner.accessibilityLabel() == "本机执行机" && runner.accessibilityHelp() == "运行中", "runner label")

expect(!runner.acceptsFirstResponder && !runner.showsFocusRing, "a big button takes focus before any keyboard highlight")
tray.highlightFromKeyboard = { false }
tray.menu(menu, willHighlight: tray.items["runner"])
expect(!runner.keyboardFocused && !runner.showsFocusRing, "a mouse highlight drew the focus ring")
tray.highlightFromKeyboard = { true }
tray.menu(menu, willHighlight: tray.items["runner"])
expect(runner.keyboardFocused && runner.showsFocusRing && runner.acceptsFirstResponder, "arrow key did not focus the big button")
tray.menu(menu, willHighlight: tray.items["keep-awake"])
expect(!runner.keyboardFocused && awake.keyboardFocused, "focus did not move to the next big button")
tray.menu(menu, willHighlight: tray.items["settings"])
expect(!awake.keyboardFocused, "focus stayed on a big button after leaving it")

let returnKey = NSEvent.keyEvent(
  with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
  characters: "\r", charactersIgnoringModifiers: "\r", isARepeat: false, keyCode: 36)!
awake.keyDown(with: returnKey)
expect(sent.last == "keep-awake", "Return on a big button sent \(sent.last ?? "nothing")")
expect(awake.accessibilityPerformPress(), "VoiceOver press failed")
expect(sent.last == "keep-awake", "VoiceOver press sent \(sent.last ?? "nothing")")

menu.performActionForItem(at: menu.index(of: coordinator))
expect(sent.last == "coordinator", "picking Coordinator sent \(sent.last ?? "nothing")")

tray.menuWillOpen(menu)
expect(tray.isOpen && sent.last == "opened", "open was not reported")
var updated = fixture.items
updated[0].status = nil
updated[updated.firstIndex { $0.id == "keep-awake" }!].on = true
tray.apply(TrayMenuModel(label: fixture.label, items: updated))
expect(tray.items["coordinator"] === coordinator, "an update with the same rows rebuilt the menu while open")
expect(coordinator.title == "Coordinator", "the open menu did not update in place: \(coordinator.title)")
expect(awake.content.on, "the open big button did not update in place")

let shorter = Array(updated.dropFirst(2))
tray.apply(TrayMenuModel(label: fixture.label, items: shorter))
expect(tray.pending != nil && menu.items.count == updated.count, "rows were added or removed while the menu was open")
tray.menuDidClose(menu)
expect(!tray.isOpen && sent.last == "closed", "close was not reported")
expect(tray.pending == nil && menu.items.count == shorter.count, "the deferred menu was not applied on close")

let skeleton = TrayMenuModel(label: "Cairn", items: [])
tray.apply(skeleton)
expect(menu.items.isEmpty, "an empty model left items behind")

print("\(failures.isEmpty ? "PASS" : "FAIL"): \(assertions) assertions, \(failures.count) failures")
for failure in failures { print("  \(failure)") }
exit(failures.isEmpty ? 0 : 1)
