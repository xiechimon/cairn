import AppKit

final class TrayMenu: NSObject, NSMenuDelegate {
  static let readableTitle = 6

  let menu = NSMenu()
  private(set) var model: TrayMenuModel
  private(set) var pending: TrayMenuModel?
  private(set) var isOpen = false
  private(set) var items: [String: NSMenuItem] = [:]
  private(set) var buttons: [String: BigButton] = [:]
  private(set) var headers: [String: MachineHeader] = [:]
  private let brand: NSImage?
  private let send: (Outgoing) -> Void
  var highlightFromKeyboard: () -> Bool = { NSApp.currentEvent?.type == .keyDown }

  init(_ model: TrayMenuModel, brand: NSImage?, send: @escaping (Outgoing) -> Void) {
    self.model = model
    self.brand = brand
    self.send = send
    super.init()
    menu.autoenablesItems = false
    menu.minimumWidth = BigButton.menuWidth
    menu.delegate = self
    rebuild()
  }

  func apply(_ next: TrayMenuModel) {
    guard next != model else {
      pending = nil
      return
    }
    if !isOpen {
      model = next
      pending = nil
      rebuild()
    } else if next.shape == model.shape {
      model = next
      pending = nil
      updateInPlace()
    } else {
      pending = next
    }
  }

  private func rebuild() {
    menu.removeAllItems()
    items = [:]
    buttons = [:]
    headers = [:]
    menu.setAccessibilityLabel(model.label)
    for entry in model.items {
      let item = make(entry)
      items[entry.id] = item
      menu.addItem(item)
    }
    fitRows()
  }

  private func updateInPlace() {
    for entry in model.items {
      guard let item = items[entry.id] else { continue }
      switch entry.kind {
      case .row, .command: dress(item, entry)
      case .choice:
        item.title = entry.title ?? ""
        item.state = entry.on == true ? .on : .off
        item.isEnabled = entry.enabled ?? false
        item.setAccessibilityLabel(entry.title ?? "")
      case .switch: buttons[entry.id]?.content = content(entry)
      case .header:
        if let header = headers[entry.id] {
          header.update(entry)
          item.setAccessibilityLabel(header.spokenLabel)
        } else {
          item.title = entry.title ?? ""
        }
      case .separator: break
      }
      if entry.kind == .switch { item.isEnabled = entry.enabled ?? false }
    }
    fitRows()
  }

  private func make(_ entry: TrayItem) -> NSMenuItem {
    switch entry.kind {
    case .separator:
      return .separator()
    case .header:
      if entry.reading != nil {
        let header = MachineHeader(entry)
        let item = NSMenuItem(title: entry.title ?? "", action: nil, keyEquivalent: "")
        item.isEnabled = false
        item.view = header
        item.setAccessibilityLabel(header.spokenLabel)
        headers[entry.id] = header
        return item
      }
      let item: NSMenuItem
      if #available(macOS 14.0, *) {
        item = NSMenuItem.sectionHeader(title: entry.title ?? "")
      } else {
        item = NSMenuItem(title: entry.title ?? "", action: nil, keyEquivalent: "")
        item.isEnabled = false
      }
      return item
    case .switch:
      let item = NSMenuItem(title: entry.title ?? "", action: #selector(pick(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = entry.id
      item.isEnabled = entry.enabled ?? false
      let id = entry.id
      let button = BigButton(content: content(entry)) { [weak self] in self?.chooseSwitch(id) }
      item.view = button
      buttons[entry.id] = button
      return item
    case .choice:
      let item = NSMenuItem(title: entry.title ?? "", action: #selector(pick(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = entry.id
      item.isEnabled = entry.enabled ?? false
      item.state = entry.on == true ? .on : .off
      item.setAccessibilityLabel(entry.title ?? "")
      return item
    case .row, .command:
      let item = NSMenuItem(title: "", action: #selector(pick(_:)), keyEquivalent: entry.key ?? "")
      item.target = self
      item.representedObject = entry.id
      dress(item, entry)
      return item
    }
  }

  private func dress(_ item: NSMenuItem, _ entry: TrayItem) {
    let title = entry.title ?? ""
    item.isEnabled = entry.kind == .command || entry.open != nil
    item.image = image(for: entry)
    if item.image != nil { showImage(item) }
    item.attributedTitle = nil
    item.title = line(title, entry.status)
    if entry.isWarning, entry.status != nil { paintStatus(item, status: entry.status!) }
    item.toolTip = entry.tip
    item.setAccessibilityLabel([title, entry.status, entry.tip].compactMap { $0 }.joined(separator: ", "))
  }

  private func line(_ title: String, _ status: String?) -> String {
    [title, status].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
  }

  private func paintStatus(_ item: NSMenuItem, status: String) {
    let text = item.title
    let rich = NSMutableAttributedString(string: text, attributes: [.font: NSFont.menuFont(ofSize: 0)])
    let range = (text as NSString).range(of: status, options: .backwards)
    if range.location != NSNotFound {
      rich.addAttribute(.foregroundColor, value: Palette.warning, range: range)
    }
    item.attributedTitle = rich
  }

  private func showImage(_ item: NSMenuItem) {
    let setter = NSSelectorFromString("setPreferredImageVisibility:")
    if item.responds(to: setter) { item.setValue(1, forKey: "preferredImageVisibility") }
  }

  private func image(for entry: TrayItem) -> NSImage? {
    switch entry.image {
    case "brand": return brand
    case "usage": return Symbols.image(["chart.bar"])
    case "user": return Symbols.image(["person.crop.circle"])
    default: break
    }
    guard let glyph = Symbols.glyph(entry.glyph, warn: entry.isWarning) else { return nil }
    return Symbols.image(glyph.names, tint: glyph.tint)
  }

  private func content(_ entry: TrayItem) -> ButtonContent {
    ButtonContent(
      title: entry.title ?? "", detail: entry.detail,
      symbol: entry.id == "runner" ? "laptopcomputer" : "cup.and.saucer.fill",
      on: entry.on ?? false, enabled: entry.enabled ?? false, warning: entry.isWarning)
  }

  private func fitRows() {
    let rows = model.items.filter { $0.kind == .row && ($0.title ?? "").isEmpty == false }
    guard !rows.isEmpty else { return }
    let ruler = NSMenu()
    ruler.autoenablesItems = false
    for item in menu.items where item.view == nil && !item.isSeparatorItem {
      guard let column = item.copy() as? NSMenuItem else { continue }
      column.attributedTitle = nil
      column.title = " "
      column.state = .on
      ruler.addItem(column)
    }
    let candidate = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    ruler.addItem(candidate)
    func fits(_ text: String) -> Bool {
      candidate.title = text
      return ruler.size.width <= BigButton.menuWidth
    }
    func longestFit(_ text: String, keeping minimum: Int, in line: (String) -> String) -> String {
      if fits(line(text)) { return text }
      let characters = Array(text)
      var low = min(minimum, characters.count)
      var high = characters.count - 1
      guard low <= high else { return text }
      func cut(_ count: Int) -> String {
        String(characters[..<count]).trimmingCharacters(in: .whitespaces) + "…"
      }
      while low < high {
        let middle = (low + high + 1) / 2
        if fits(line(cut(middle))) { low = middle } else { high = middle - 1 }
      }
      return cut(low)
    }
    for entry in rows {
      guard let item = items[entry.id] else { continue }
      let title = entry.title ?? ""
      let full = line(title, entry.status)
      var shown = full
      var shownStatus: String?
      if let status = entry.status, !status.isEmpty {
        let head = longestFit(title, keeping: Self.readableTitle) { "\($0) · \(status)" }
        let tail = longestFit(status, keeping: 0) { "\(head) · \($0)" }
        shown = "\(head) · \(tail)"
        shownStatus = tail
      } else {
        shown = longestFit(title, keeping: 0) { $0 }
      }
      guard shown != full else { continue }
      item.attributedTitle = nil
      item.title = shown
      if entry.isWarning, let shownStatus { paintStatus(item, status: shownStatus) }
      item.toolTip = [full, entry.tip].compactMap { $0 }.joined(separator: "\n")
    }
  }

  private func chooseSwitch(_ id: String) {
    menu.cancelTracking()
    send(.action(id))
  }

  @objc private func pick(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String else { return }
    send(.action(id))
  }

  func menu(_ menu: NSMenu, willHighlight item: NSMenuItem?) {
    let id = item?.representedObject as? String
    let focused = id.flatMap { buttons[$0] }
    let fromKeyboard = highlightFromKeyboard()
    for button in buttons.values where button !== focused { button.keyboardFocused = false }
    if let focused, fromKeyboard {
      focused.keyboardFocused = true
      focused.window?.makeFirstResponder(focused)
    } else if let previous = buttons.values.first(where: { $0.window?.firstResponder === $0 }) {
      previous.window?.makeFirstResponder(nil)
    }
  }

  func menuWillOpen(_ menu: NSMenu) {
    isOpen = true
    send(.opened)
  }

  func menuDidClose(_ menu: NSMenu) {
    isOpen = false
    for button in buttons.values { button.resetInteraction() }
    send(.closed)
    if let next = pending {
      pending = nil
      model = next
      rebuild()
    }
  }
}
