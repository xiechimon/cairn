import AppKit
import CoreGraphics
import Foundation

func reply(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else {
    return
  }
  FileHandle.standardOutput.write(data + Data([0x0A]))
}

func box(_ entry: [String: Any]) -> [String: Any] {
  let bounds = entry[kCGWindowBounds as String] as? [String: Any] ?? [:]
  return [
    "number": entry[kCGWindowNumber as String] ?? 0,
    "layer": entry[kCGWindowLayer as String] ?? 0,
    "onscreen": (entry[kCGWindowIsOnscreen as String] as? Bool) == true ? 1 : 0,
    "alpha": entry[kCGWindowAlpha as String] ?? 0,
    "x": bounds["X"] ?? 0,
    "y": bounds["Y"] ?? 0,
    "width": bounds["Width"] ?? 0,
    "height": bounds["Height"] ?? 0,
  ]
}

func windows(of pid: pid_t) -> [[String: Any]] {
  let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
  return list.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == pid }.map(box)
}

func axRect(_ element: AXUIElement) -> CGRect? {
  var positionRef: CFTypeRef?
  var sizeRef: CFTypeRef?
  guard
    AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionRef) == .success,
    AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
    let positionValue = positionRef, let sizeValue = sizeRef
  else { return nil }
  var point = CGPoint.zero
  var size = CGSize.zero
  guard
    AXValueGetValue(positionValue as! AXValue, .cgPoint, &point),
    AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
  else { return nil }
  return CGRect(origin: point, size: size)
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
  var childrenRef: CFTypeRef?
  guard
    AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
    let children = childrenRef as? [AXUIElement]
  else { return [] }
  return children
}

func axRole(_ element: AXUIElement) -> String {
  var roleRef: CFTypeRef?
  guard
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef) == .success,
    let role = roleRef as? String
  else { return "" }
  return role
}

func statusItems(pid: pid_t) -> [AXUIElement] {
  let application = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(application, 3)
  var barRef: CFTypeRef?
  guard
    AXUIElementCopyAttributeValue(application, "AXExtrasMenuBar" as CFString, &barRef) == .success,
    let barValue = barRef
  else { return [] }
  return axChildren(barValue as! AXUIElement).filter { axRole($0) == kAXMenuBarItemRole }
}

func axString(_ element: AXUIElement, _ attribute: String) -> String? {
  var valueRef: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &valueRef) == .success else {
    return nil
  }
  return valueRef as? String
}

func axBool(_ element: AXUIElement, _ attribute: String) -> Bool {
  var valueRef: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &valueRef) == .success else {
    return false
  }
  return (valueRef as? Bool) ?? false
}

func openMenuItems(pid: pid_t) -> [AXUIElement] {
  guard let item = statusItems(pid: pid).first else { return [] }
  let menus = axChildren(item).filter { axRole($0) == kAXMenuRole }
  return menus.flatMap { axChildren($0) }.filter { axRole($0) == kAXMenuItemRole }
}

func describeMenuItem(_ element: AXUIElement) -> [String: Any] {
  var entry: [String: Any] = [
    "title": axString(element, kAXTitleAttribute) ?? "",
    "label": axString(element, kAXDescriptionAttribute) ?? "",
    "enabled": axBool(element, kAXEnabledAttribute),
    "selected": axBool(element, kAXSelectedAttribute),
  ]
  let inner = axChildren(element).first
  if let inner {
    entry["viewRole"] = axRole(inner)
    entry["viewLabel"] = axString(inner, kAXDescriptionAttribute) ?? ""
  }
  if let rect = axRect(element) {
    entry["x"] = rect.minX
    entry["y"] = rect.minY
    entry["width"] = rect.width
    entry["height"] = rect.height
  }
  return entry
}

func matchesMenuItem(_ element: AXUIElement, _ title: String) -> Bool {
  let names = [
    axString(element, kAXTitleAttribute), axString(element, kAXDescriptionAttribute),
    axChildren(element).first.flatMap { axString($0, kAXDescriptionAttribute) },
  ]
  return names.contains { $0 == title }
}

func postKey(pid: pid_t, code: CGKeyCode) -> Bool {
  let source = CGEventSource(stateID: .hidSystemState)
  guard app(pid) != nil,
    let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
    let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
  else { return false }
  down.postToPid(pid)
  usleep(60_000)
  up.postToPid(pid)
  return true
}

func post(_ point: CGPoint, _ button: CGMouseButton, down: Bool, count: Int64) {
  let source = CGEventSource(stateID: .hidSystemState)
  let type: CGEventType
  if button == .right {
    type = down ? .rightMouseDown : .rightMouseUp
  } else {
    type = down ? .leftMouseDown : .leftMouseUp
  }
  guard
    let event = CGEvent(
      mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button)
  else { return }
  event.setIntegerValueField(.mouseEventClickState, value: count)
  event.post(tap: .cghidEventTap)
}

func hover(_ point: CGPoint) {
  let source = CGEventSource(stateID: .hidSystemState)
  CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?
    .post(tap: .cghidEventTap)
}

func click(_ point: CGPoint, button: CGMouseButton, count: Int64 = 1, pause: useconds_t = 80_000) {
  post(point, button, down: true, count: count)
  usleep(pause)
  post(point, button, down: false, count: count)
  usleep(pause)
}

struct ScreenWindow {
  let pid: pid_t
  let number: Int
  let layer: Int
  let bounds: CGRect

  var diagnostic: [String: Any] {
    ["pid": pid, "number": number, "layer": layer, "x": bounds.minX, "y": bounds.minY,
      "width": bounds.width, "height": bounds.height]
  }
}

func screenWindows() -> [ScreenWindow] {
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
  return list.compactMap { entry in
    guard
      let pid = entry[kCGWindowOwnerPID as String] as? Int32,
      let number = entry[kCGWindowNumber as String] as? Int,
      let layer = entry[kCGWindowLayer as String] as? Int,
      let box = entry[kCGWindowBounds as String] as? NSDictionary,
      let bounds = CGRect(dictionaryRepresentation: box as CFDictionary)
    else { return nil }
    return ScreenWindow(pid: pid, number: number, layer: layer, bounds: bounds)
  }
}

func statusItemHit(
  _ top: ScreenWindow, at point: CGPoint, rect: CGRect, item: AXUIElement, pid: pid_t
) -> Bool {
  guard top.layer >= CGWindowLevelForKey(.mainMenuWindow) else { return false }
  if top.pid == pid && top.bounds == rect { return true }
  guard app(top.pid)?.bundleIdentifier == "com.apple.controlcenter" || isWindowServer(top.pid) else {
    return false
  }
  var hit: AXUIElement?
  var owner: pid_t = 0
  let system = AXUIElementCreateSystemWide()
  AXUIElementSetMessagingTimeout(system, 1)
  guard
    AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &hit) == .success,
    let hit, AXUIElementGetPid(hit, &owner) == .success, owner == pid, CFEqual(hit, item)
  else { return false }
  let current = screenWindows().first { $0.bounds.contains(point) }
  return current?.pid == top.pid && current?.number == top.number
}

func clickStatusItem(pid: pid_t, button: CGMouseButton, doubleClick: Bool) -> [String: Any] {
  guard let item = statusItems(pid: pid).first, let rect = axRect(item), !rect.isEmpty else {
    return ["ok": false, "error": "no status item for pid \(pid)"]
  }
  let point = CGPoint(x: rect.midX, y: rect.midY)
  var top: ScreenWindow?
  let deadline = ProcessInfo.processInfo.systemUptime + 4.5
  repeat {
    top = screenWindows().first { $0.bounds.contains(point) }
    if let before = top, statusItemHit(before, at: point, rect: rect, item: item, pid: pid) {
      hover(point)
      usleep(40_000)
      top = screenWindows().first { $0.bounds.contains(point) }
      if let first = top, statusItemHit(first, at: point, rect: rect, item: item, pid: pid) {
        if doubleClick {
          let interval = NSEvent.doubleClickInterval
          let pause = useconds_t(min(0.04, interval / 8) * 1_000_000)
          let start = ProcessInfo.processInfo.systemUptime
          click(point, button: button, pause: pause)
          let second = screenWindows().first { $0.bounds.contains(point) }
          guard let second, statusItemHit(second, at: point, rect: rect, item: item, pid: pid) else {
            return [
              "ok": false,
              "error": "status item lost the top hit before the second click",
              "top": second?.diagnostic ?? [:],
              "x": point.x,
              "y": point.y,
            ]
          }
          click(point, button: button, count: 2, pause: pause)
          guard ProcessInfo.processInfo.systemUptime - start < interval else {
            return ["ok": false, "error": "clicks exceeded the macOS double-click interval"]
          }
          return ["ok": true, "statusPid": pid, "top": second.diagnostic, "x": point.x, "y": point.y]
        }
        click(point, button: button)
        return ["ok": true, "statusPid": pid, "top": first.diagnostic, "x": point.x, "y": point.y]
      }
    }
    usleep(150_000)
  } while ProcessInfo.processInfo.systemUptime < deadline
  return ["ok": true, "top": top?.diagnostic ?? [:], "x": point.x, "y": point.y]
}

func clickCloseButton(pid: pid_t, windowNumber: Int) -> [String: Any] {
  guard let target = screenWindows().first(where: { $0.pid == pid && $0.number == windowNumber })
  else {
    return ["ok": false, "error": "target window \(windowNumber) is not on screen"]
  }
  let application = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(application, 3)
  var windowsRef: CFTypeRef?
  guard
    AXUIElementCopyAttributeValue(application, kAXWindowsAttribute as CFString, &windowsRef)
      == .success,
    let windows = windowsRef as? [AXUIElement],
    let rect = windows.lazy.compactMap({ candidate -> CGRect? in
      guard let frame = axRect(candidate),
        abs(frame.minX - target.bounds.minX) <= 2,
        abs(frame.minY - target.bounds.minY) <= 2,
        abs(frame.width - target.bounds.width) <= 2,
        abs(frame.height - target.bounds.height) <= 2
      else { return nil }
      var closeRef: CFTypeRef?
      guard
        AXUIElementCopyAttributeValue(candidate, kAXCloseButtonAttribute as CFString, &closeRef)
          == .success,
        let closeValue = closeRef,
        let button = axRect(closeValue as! AXUIElement), !button.isEmpty
      else { return nil }
      return button
    }).first
  else {
    return ["ok": false, "error": "no close button on target window", "target": target.diagnostic]
  }
  let point = CGPoint(x: rect.midX, y: rect.midY)
  hover(point)
  usleep(40_000)
  let top = screenWindows().first { $0.bounds.contains(point) }
  guard let top, top.pid == pid, top.number == windowNumber, top.bounds == target.bounds else {
    return [
      "ok": false,
      "error": "the close button is not in the top window",
      "top": top?.diagnostic ?? [:],
    ]
  }
  click(point, button: .left)
  return ["ok": true, "top": top.diagnostic, "x": point.x, "y": point.y]
}

final class FixtureWindow: NSObject, NSWindowDelegate {
  enum Mode: String { case windowed, entering, fullScreen, exiting, exitFailed }

  let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 480, height: 320),
    styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
  private(set) var mode = Mode.windowed
  private var restoring = false

  override init() {
    super.init()
    window.title = "Cairn tray smoke fixture"
    window.collectionBehavior = [.fullScreenPrimary]
    window.delegate = self
    window.center()
  }

  func showOutsideTarget() -> Bool {
    guard let area = window.screen?.visibleFrame ?? NSScreen.main?.visibleFrame else { return false }
    window.setFrame(
      NSRect(x: area.minX + 24, y: area.minY + 24, width: 200, height: 140), display: false)
    window.level = .popUpMenu
    window.orderFrontRegardless()
    return true
  }

  func enterFullScreen() {
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    mode = .entering
    window.toggleFullScreen(nil)
  }

  func restore() {
    restoring = true
    if mode == .windowed {
      window.orderOut(nil)
    } else if mode == .fullScreen {
      mode = .exiting
      window.toggleFullScreen(nil)
    }
  }

  func windowDidEnterFullScreen(_ notification: Notification) {
    guard mode == .entering else { return }
    mode = .fullScreen
    if restoring { restore() }
  }

  func windowDidFailToEnterFullScreen(_ window: NSWindow) {
    guard mode == .entering else { return }
    mode = .windowed
    if restoring { restore() }
  }

  func windowDidExitFullScreen(_ notification: Notification) {
    mode = .windowed
    window.orderOut(nil)
  }

  func windowDidFailToExitFullScreen(_ window: NSWindow) {
    mode = .exitFailed
  }

  func clickOutside(popoverNumber: Int, popoverPid: pid_t) -> [String: Any] {
    let number = window.windowNumber
    let windows = screenWindows()
    guard let fixture = windows.first(where: { $0.pid == getpid() && $0.number == number })
    else { return ["ok": false, "error": "fixture window is not on screen", "number": number] }
    let isPopover = { (entry: ScreenWindow) in entry.pid == popoverPid && entry.number == popoverNumber }
    guard let popover = windows.first(where: isPopover) else {
      return ["ok": false, "error": "popover was not on screen before the outside click"]
    }
    var hits: [[String: Any]] = []
    for x in [0.25, 0.5, 0.75] {
      for y in [0.25, 0.5, 0.75] {
        let point = CGPoint(
          x: fixture.bounds.minX + x * fixture.bounds.width,
          y: fixture.bounds.minY + y * fixture.bounds.height)
        let before = screenWindows()
        guard let beforePopover = before.first(where: isPopover) else {
          return ["ok": false, "error": "popover left the screen before moving outside"]
        }
        guard !beforePopover.bounds.contains(point) else { continue }
        let beforeTop = before.first { $0.bounds.contains(point) }
        guard let beforeTop, beforeTop.pid == getpid(), beforeTop.number == number else {
          hits.append(["x": point.x, "y": point.y, "phase": "before move",
            "top": beforeTop?.diagnostic ?? [:]])
          continue
        }
        hover(point)
        usleep(40_000)
        let current = screenWindows()
        guard let livePopover = current.first(where: isPopover) else {
          return ["ok": false, "error": "popover left the screen before the outside click"]
        }
        let top = current.first { $0.bounds.contains(point) }
        var hit: [String: Any] = ["x": point.x, "y": point.y, "top": top?.diagnostic ?? [:]]
        if let top, top.pid == getpid(), top.number == number, !livePopover.bounds.contains(point) {
          click(point, button: .left)
          hit["ok"] = true
          return hit
        }
        hits.append(hit)
      }
    }
    return ["ok": false, "error": "no unobstructed fixture point outside the popover",
      "fixture": fixture.diagnostic, "popover": popover.diagnostic, "hits": hits]
  }
}

func app(_ pid: pid_t) -> NSRunningApplication? {
  NSRunningApplication(processIdentifier: pid)
}

func isWindowServer(_ pid: pid_t) -> Bool {
  var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN))
  guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return false }
  return String(cString: buffer).hasSuffix("/WindowServer")
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
application.finishLaunching()
var fixture: FixtureWindow?

func run(_ step: [String: Any]) -> [String: Any] {
  guard let command = step["cmd"] as? String else { return ["ok": false, "error": "no cmd"] }
  let pid = pid_t(step["pid"] as? Int ?? 0)
  switch command {
  case "ping":
    let accessibility = AXIsProcessTrusted()
    let eventPosting = CGPreflightPostEventAccess()
    return ["ok": accessibility && eventPosting, "pid": getpid(), "accessibility": accessibility,
      "eventPosting": eventPosting]
  case "statusItem":
    let items: [[String: Any]] = statusItems(pid: pid).compactMap { item in
      guard let rect = axRect(item) else { return nil }
      return ["role": axRole(item), "x": rect.minX, "y": rect.minY,
        "width": rect.width, "height": rect.height]
    }
    return ["ok": !items.isEmpty, "items": items]
  case "clickStatus":
    return clickStatusItem(
      pid: pid, button: step["button"] as? String == "right" ? .right : .left,
      doubleClick: step["doubleClick"] as? Bool == true)
  case "clickPoint":
    guard let windowNumber = step["windowNumber"] as? Int, windowNumber > 0 else {
      return ["ok": false, "error": "no target window number"]
    }
    guard let x = step["x"] as? Double, let y = step["y"] as? Double else {
      return ["ok": false, "error": "no click point"]
    }
    let point = CGPoint(x: x, y: y)
    hover(point)
    usleep(40_000)
    let top = screenWindows().first { $0.bounds.contains(point) }
    guard let top, top.pid == pid, top.number == windowNumber else {
      return ["ok": false, "error": "the click point is not in the target window", "top": top?.diagnostic ?? [:]]
    }
    click(point, button: .left)
    return ["ok": true, "top": top.diagnostic]
  case "clickCloseButton":
    guard let windowNumber = step["windowNumber"] as? Int, windowNumber > 0 else {
      return ["ok": false, "error": "no target window number"]
    }
    return clickCloseButton(pid: pid, windowNumber: windowNumber)
  case "showFixture":
    guard fixture == nil || fixture?.mode == .windowed else {
      return ["ok": false, "error": "the previous fixture is still in full screen"]
    }
    let owned = FixtureWindow()
    fixture = owned
    if step["fullScreen"] as? Bool == true {
      owned.enterFullScreen()
    } else if !owned.showOutsideTarget() {
      return ["ok": false, "error": "no display for the outside fixture"]
    }
    return ["ok": true, "number": owned.window.windowNumber]
  case "clickOutside":
    guard let fixture, pid > 0, let popoverNumber = step["popoverNumber"] as? Int else {
      return ["ok": false, "error": "no fixture window or popover identity"]
    }
    return fixture.clickOutside(popoverNumber: popoverNumber, popoverPid: pid)
  case "restoreFixture":
    fixture?.restore()
    return ["ok": true]
  case "fixtureMode":
    let mode = fixture?.mode ?? .windowed
    let onScreen = mode == .fullScreen && screenWindows().contains {
      $0.pid == getpid() && $0.number == fixture?.window.windowNumber
    }
    return ["ok": true, "mode": mode.rawValue, "onScreen": onScreen]
  case "sleep":
    usleep(useconds_t((step["ms"] as? Int ?? 0) * 1000))
    return ["ok": true]
  case "hide":
    guard let target = app(pid) else { return ["ok": false, "error": "no app \(pid)"] }
    let hidden = target.hide()
    usleep(400_000)
    return ["ok": hidden, "hidden": target.isHidden, "accepted": hidden]
  case "unhide":
    guard let target = app(pid) else { return ["ok": false, "error": "no app \(pid)"] }
    let shown = target.unhide()
    usleep(400_000)
    return ["ok": shown, "hidden": target.isHidden]
  case "activateBundle":
    guard let bundle = step["bundle"] as? String else { return ["ok": false, "error": "no bundle"] }
    let found = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first
    guard let target = found else { return ["ok": false, "error": "no running app \(bundle)"] }
    let activated = target.activate()
    usleep(600_000)
    return ["ok": activated, "active": target.isActive, "name": target.localizedName ?? ""]
  case "windows":
    return ["ok": true, "windows": windows(of: pid)]
  case "escape":
    guard postKey(pid: pid, code: 53) else {
      return ["ok": false, "error": "could not send Escape to pid \(pid)"]
    }
    return ["ok": true]
  case "key":
    guard let code = step["code"] as? Int, postKey(pid: pid, code: CGKeyCode(code)) else {
      return ["ok": false, "error": "could not send key to pid \(pid)"]
    }
    return ["ok": true]
  case "menuItems":
    return ["ok": true, "items": openMenuItems(pid: pid).map(describeMenuItem)]
  case "clickMenuItem":
    guard let title = step["title"] as? String else { return ["ok": false, "error": "no title"] }
    var found: CGRect?
    let deadline = ProcessInfo.processInfo.systemUptime + 2
    repeat {
      if let element = openMenuItems(pid: pid).first(where: { matchesMenuItem($0, title) }),
        let rect = axRect(element), !rect.isEmpty
      {
        found = rect
      } else {
        usleep(100_000)
      }
    } while found == nil && ProcessInfo.processInfo.systemUptime < deadline
    guard let rect = found else {
      return ["ok": false, "error": "no open menu item \(title) for pid \(pid)"]
    }
    let point = CGPoint(x: rect.midX, y: rect.midY)
    hover(point)
    usleep(useconds_t((step["hoverMs"] as? Int ?? 120) * 1000))
    let top = screenWindows().first { $0.bounds.contains(point) }
    guard let top, top.pid == pid else {
      return ["ok": false, "error": "the menu item is not on top", "top": top?.diagnostic ?? [:]]
    }
    if step["hoverOnly"] as? Bool != true { click(point, button: .left) }
    return ["ok": true, "top": top.diagnostic, "x": point.x, "y": point.y]
  default:
    return ["ok": false, "error": "unknown cmd \(command)"]
  }
}

FileHandle.standardError.write(Data("tray driver ready pid=\(getpid())\n".utf8))

let queue = DispatchQueue(label: "cairn.tray.driver.stdin")
queue.async {
  while let line = readLine(strippingNewline: true) {
    guard
      let data = line.data(using: .utf8),
      let step = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { continue }
    var result: [String: Any] = ["ok": false, "error": "no result"]
    DispatchQueue.main.sync {
      result = run(step)
    }
    reply(result)
  }
  exit(0)
}

application.run()
