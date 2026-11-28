import AppKit

var assertions = 0
var failures: [String] = []

func expect(_ condition: Bool, _ message: @autoclosure () -> String) {
  assertions += 1
  if !condition { failures.append(message()) }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--decode-only" {
  let path = CommandLine.arguments[2]
  guard
    let line = try? String(contentsOfFile: path, encoding: .utf8),
    let message = Channel.decode(line.trimmingCharacters(in: .whitespacesAndNewlines)),
    let model = message.menu
  else {
    fputs("failed to decode tray menu from \(path)\n", stderr)
    exit(1)
  }
  let tray = TrayMenu(model, brand: nil) { _ in }
  let expected = model.items.count + model.items.reduce(0) { $0 + ($1.children?.count ?? 0) }
  guard tray.menu.items.count == expected else {
    fputs("item count mismatch: \(tray.menu.items.count) vs \(expected)\n", stderr)
    exit(1)
  }
  print("PASS: decoded \(model.items.count) items")
  exit(0)
}

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

guard let disclosureView = tray.buttons["keep-awake"], disclosureView.accessibilityRole() == .button else {
  fputs("FAIL: keep-awake disclosure view missing\n", stderr)
  exit(1)
}

expect(menu.items.count == fixture.items.count + 3, "menu includes prebuilt disclosure children")
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

func strainedRuns(_ text: NSAttributedString) -> [String] {
  var runs: [String] = []
  text.enumerateAttribute(.foregroundColor, in: NSRange(location: 0, length: text.length)) { value, range, _ in
    if (value as? NSColor) == Palette.warning { runs.append(text.attributedSubstring(from: range).string) }
  }
  return runs
}

func laidOut(_ header: MachineHeader, width: CGFloat = BigButton.menuWidth) -> MachineHeader {
  header.frame = NSRect(x: 0, y: 0, width: width, height: MachineHeader.height)
  header.layout()
  return header
}

let header = laidOut(tray.headers["machine:m2"]!)
expect(
  header.spokenLabel == "build-box, 内存吃紧, 磁盘吃紧, 内存 94%, CPU 88%, 负载 15.4 / 16 核, 剩余磁盘 3 GB",
  "header label \(header.spokenLabel)")
expect(tray.items["machine:m2"]!.isEnabled == false, "machine header is enabled")
expect(tray.items["machine:m2"]!.view === header, "machine header is not a two-line view")
expect(strainedRuns(header.readingLabel.attributedStringValue) == ["内存 94%", "剩余磁盘 3 GB"], "strained parts \(strainedRuns(header.readingLabel.attributedStringValue))")
func clipped(_ label: NSTextField) -> Bool {
  guard let host = label.superview else { return true }
  let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds)!
  host.cacheDisplay(in: host.bounds, to: rep)
  let scale = CGFloat(rep.pixelsWide) / host.bounds.width
  let band = Int(label.frame.minY * scale)..<min(rep.pixelsHigh, Int(label.frame.maxY * scale))
  var right = 0
  for x in stride(from: rep.pixelsWide - 1, through: 0, by: -1) where right == 0 {
    for y in band where (rep.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.2 {
      right = x
      break
    }
  }
  let drawn = CGFloat(right) / scale - label.frame.minX
  return drawn + 3 < label.attributedStringValue.size().width
}
expect(!clipped(header.readingLabel), "the strained reading is cut off: \(header.readingLabel.stringValue)")
expect(header.readingLabel.stringValue.hasSuffix("剩余磁盘 3 GB"), "the strained disk part is missing: \(header.readingLabel.stringValue)")
expect(header.readingLabel.frame.minY >= header.name.frame.maxY, "reading is not under the name")
expect(header.readingLabel.frame.maxY <= MachineHeader.height, "reading falls outside the header")
expect(header.toolTip == "build-box\n内存压力 94%；CPU 88%；负载 15.4 / 16 核；剩余磁盘 3 GB", "header tip \(header.toolTip ?? "nil")")

let idle = laidOut(tray.headers["machine:m1"]!)
expect(idle.readingLabel.stringValue == "内存 42% · CPU 31% · 负载 3.1 / 12 核", "idle reading \(idle.readingLabel.stringValue)")
expect(strainedRuns(idle.readingLabel.attributedStringValue).isEmpty, "a calm computer has a strained part")
expect(idle.name.textColor == .labelColor, "a live computer name is faint")

let offline = laidOut(tray.headers["machine:m3"]!)
expect(offline.readingLabel.stringValue == "离线 · 最后在线 2 天前", "offline reading \(offline.readingLabel.stringValue)")
expect(offline.name.textColor == .tertiaryLabelColor, "an offline computer name is not faint")
expect(!offline.readingLabel.stringValue.contains("%"), "an offline computer shows stale numbers")

let unreported = laidOut(tray.headers["machine:m4"]!)
expect(unreported.readingLabel.stringValue == "尚未上报内存和负载", "unreported reading \(unreported.readingLabel.stringValue)")
expect(unreported.name.frame.maxX <= unreported.bounds.width - MachineHeader.inset + 0.5, "a long computer name overflows")
expect(unreported.name.lineBreakMode == .byTruncatingTail, "a long computer name does not truncate")

var english = TrayItem(kind: .header, id: "machine:en")
english.title = "build-linux"
english.reading = Reading(
  parts: [
    ReadingPart(text: "Memory 48%", strained: false), ReadingPart(text: "CPU 97%", strained: true),
    ReadingPart(text: "Load 15.4 / 16 cores", strained: false), ReadingPart(text: "3 GB disk free", strained: true),
  ], faint: false, spoken: "", tip: "")
let narrow = laidOut(MachineHeader(english), width: 270)
expect(!clipped(narrow.readingLabel), "the narrow reading is cut off: \(narrow.readingLabel.stringValue)")
expect(narrow.readingLabel.stringValue == "Memory 48% · CPU 97% · 3 GB disk free", "narrow English reading \(narrow.readingLabel.stringValue)")
expect(strainedRuns(narrow.readingLabel.attributedStringValue) == ["CPU 97%", "3 GB disk free"], "narrow strained parts")
let wide = laidOut(MachineHeader(english), width: 600)
expect(wide.readingLabel.stringValue.contains("Load 15.4 / 16 cores"), "a wide header drops the load")

let user = tray.items["user"]!
expect(!user.isEnabled, "the user row is enabled")
expect(tray.items["settings"]!.keyEquivalent == ",", "settings key \(tray.items["settings"]!.keyEquivalent)")
expect(tray.items["quit"]!.keyEquivalent == "q", "quit key")

let runner = tray.buttons["runner"]!
expect(runner.accessibilityRole() == .checkBox && runner.accessibilitySubrole() == .switch, "runner role")
expect((runner.accessibilityValue() as? NSNumber)?.intValue == 1, "runner value")
expect(runner.accessibilityLabel() == "本机执行机" && runner.accessibilityHelp() == "运行中", "runner label")

guard let awake = tray.buttons["keep-awake"], let children = tray.disclosureChildren["keep-awake"], children.count == 3,
  let screenOn = children[0].view as? AwakeChoice, let system = children[1].view as? AwakeChoice,
  let lidClosed = children[2].view as? AwakeChoice else {
  fputs("FAIL: disclosure view or children missing\n", stderr)
  exit(1)
}
expect(awake.accessibilityRole() == .button && awake.accessibilitySubrole() == nil, "disclosure role")
expect(awake.accessibilityHelp()?.contains("有任务运行时保持唤醒") == true, "disclosure help")
expect(awake.detailLabel.stringValue == "屏幕可熄灭", "collapsed tile shows the current mode")
expect(children.allSatisfy { $0.isHidden } && !awake.isAccessibilityExpanded(), "children initially hidden")
expect((system.accessibilityValue() as? NSNumber)?.intValue == 1, "current choice mark")
expect(system.accessibilityLabel() == "屏幕可熄灭", "system label")

expect(!runner.acceptsFirstResponder && !runner.showsFocusRing, "a big button takes focus before any keyboard highlight")
tray.highlightFromKeyboard = { false }
tray.menu(menu, willHighlight: tray.items["runner"])
expect(!runner.keyboardFocused && !runner.showsFocusRing, "a mouse highlight drew the focus ring")
tray.highlightFromKeyboard = { true }
tray.menu(menu, willHighlight: tray.items["runner"])
expect(runner.keyboardFocused && runner.showsFocusRing && runner.acceptsFirstResponder, "arrow key did not focus the big button")
tray.menu(menu, willHighlight: tray.items["settings"])
expect(!runner.keyboardFocused, "focus stayed on a big button after leaving it")

expect(awake.accessibilityPerformPress() && children.allSatisfy { !$0.isHidden } && awake.isAccessibilityExpanded(), "press expands children")
expect(lidClosed.accessibilityPerformPress(), "enabled choice accepts press")
expect(sent.last == "keep-awake-lid-closed" && children.allSatisfy { $0.isHidden }, "choice dispatches and collapses")

menu.performActionForItem(at: menu.index(of: coordinator))
expect(sent.last == "coordinator", "picking Coordinator sent \(sent.last ?? "nothing")")

tray.menuWillOpen(menu)
expect(tray.isOpen && sent.last == "opened", "open was not reported")
let beforeItemPress = sent.count
menu.performActionForItem(at: menu.index(of: tray.items["keep-awake"]!))
expect(awake.isAccessibilityExpanded() && sent.count == beforeItemPress, "menu item activation must expand without dispatch")
func key(_ code: UInt16) -> NSEvent {
  NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, characters: "", charactersIgnoringModifiers: "", isARepeat: false, keyCode: code)!
}
expect(tray.handleDisclosureKey(key(125)) && tray.handleDisclosureKey(key(125)) && system.keyboardFocused, "keyboard selects system")
var updated = fixture.items
updated[0].status = nil
let awakeIndex = updated.firstIndex { $0.id == "keep-awake" }!
updated[awakeIndex].detail = "屏幕常亮"
updated[awakeIndex].children![0].on = true
updated[awakeIndex].children![1].on = false
updated[awakeIndex].children![2].enabled = false
updated[awakeIndex].children![2].tip = "需要接通电源"
tray.apply(TrayMenuModel(label: fixture.label, items: updated))
expect(tray.items["coordinator"] === coordinator, "an update with the same rows rebuilt the menu while open")
expect(coordinator.title == "Coordinator", "the open menu did not update in place: \(coordinator.title)")
expect(awake.detailLabel.stringValue == "屏幕常亮", "host update changes the tile subtitle in place")
expect((screenOn.accessibilityValue() as? NSNumber)?.intValue == 1 && (system.accessibilityValue() as? NSNumber)?.intValue == 0, "the open mode rows did not update in place")
expect(!lidClosed.isAccessibilityEnabled() && lidClosed.accessibilityHelp() == "需要接通电源", "disabled choice explains why")
expect(system.keyboardFocused, "in-place refresh retains the selected child")
expect(tray.handleDisclosureKey(key(36)) && sent.last == "keep-awake-system" && !awake.isAccessibilityExpanded(), "Return after refresh selects the same child")
expect(awake.accessibilityPerformPress(), "reopen disclosure")
expect(tray.handleDisclosureKey(key(126)) && system.keyboardFocused, "Up skips disabled lid choice")
var battery = updated
battery[awakeIndex].children![1].enabled = false
tray.apply(TrayMenuModel(label: fixture.label, items: battery))
let beforeDisabledReturn = sent.count
expect(!system.keyboardFocused && tray.handleDisclosureKey(key(36)) && sent.count == beforeDisabledReturn, "disabled selection is cleared before Return")
tray.apply(TrayMenuModel(label: fixture.label, items: updated))
let previous = sent.last
expect(!lidClosed.accessibilityPerformPress() && sent.last == previous, "disabled choice does not dispatch")

let shorter = Array(updated.dropFirst(2))
tray.apply(TrayMenuModel(label: fixture.label, items: shorter))
expect(tray.pending != nil && menu.items.count == updated.count + 3, "rows were added or removed while the menu was open")
tray.menuDidClose(menu)
expect(!tray.isOpen && sent.last == "closed", "close was not reported")
expect(tray.pending == nil && menu.items.count == shorter.count + 3, "the deferred menu was not applied on close")

let skeleton = TrayMenuModel(label: "Cairn", items: [])
tray.apply(skeleton)
expect(menu.items.isEmpty, "an empty model left items behind")

print("\(failures.isEmpty ? "PASS" : "FAIL"): \(assertions) assertions, \(failures.count) failures")
for failure in failures { print("  \(failure)") }
exit(failures.isEmpty ? 0 : 1)
