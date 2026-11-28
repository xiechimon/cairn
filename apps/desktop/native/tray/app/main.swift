import AppKit

final class Helper: NSObject, NSApplicationDelegate {
  private let assets: String
  private var statusItem: NSStatusItem?
  private var tray: TrayMenu?
  private var idle: NSImage?
  private var awake: NSImage?

  init(assets: String) {
    self.assets = assets
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    idle = Icons.template(assets, "trayTemplate")
    awake = Icons.template(assets, "trayAwakeTemplate")
    let tray = TrayMenu(TrayMenuModel(label: "Cairn", items: []), brand: idle) { [weak self] message in
      self?.forward(message)
    }
    (NSApp as? TrayApplication)?.disclosureKey = { [weak tray] event in
      tray?.handleDisclosureKey(event) ?? false
    }
    let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    status.button?.image = idle
    status.button?.setAccessibilityLabel("Cairn")
    status.menu = tray.menu
    self.tray = tray
    statusItem = status
    Channel.read({ [weak self] message in self?.handle(message) }, ended: { NSApp.terminate(nil) })
    Channel.write(.ready)
  }

  private func forward(_ message: Outgoing) {
    if case .action(let id) = message, opensWindow(id) { bringParentForward() }
    Channel.write(message)
  }

  private func bringParentForward() {
    guard let parent = NSRunningApplication(processIdentifier: getppid()) else { return }
    if #available(macOS 14.0, *) {
      NSApp.activate()
      NSApp.yieldActivation(to: parent)
      if !parent.activate(from: .current, options: [.activateAllWindows]) {
        Channel.log("macOS refused to bring Cairn forward")
      }
    } else {
      parent.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
    }
  }

  private func opensWindow(_ id: String) -> Bool {
    guard let entry = tray?.model.items.first(where: { $0.id == id }) else { return false }
    return entry.open != nil || entry.id == "settings"
  }

  private func handle(_ message: Incoming) {
    switch message.type {
    case "menu":
      guard let menu = message.menu else { return }
      tray?.apply(menu)
      statusItem?.button?.setAccessibilityLabel(menu.label)
    case "icon":
      statusItem?.button?.image = message.awake == true ? awake : idle
      statusItem?.button?.toolTip = message.tooltip
    default:
      Channel.log("ignored message type \(message.type)")
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    if let statusItem { NSStatusBar.system.removeStatusItem(statusItem) }
  }
}

signal(SIGPIPE, SIG_IGN)
let arguments = CommandLine.arguments
guard arguments.count == 2 else {
  Channel.log("usage: CairnTray <assets directory>")
  exit(64)
}
let app = TrayApplication.shared
app.setActivationPolicy(.accessory)
let helper = Helper(assets: arguments[1])
app.delegate = helper
app.run()
