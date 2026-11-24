import AppKit

enum Palette {
  static let warning = NSColor(name: nil) { appearance in
    appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
      ? NSColor(srgbRed: 0.98, green: 0.73, blue: 0.34, alpha: 1)
      : NSColor(srgbRed: 0.50, green: 0.27, blue: 0, alpha: 1)
  }
}

struct ButtonContent: Equatable {
  var title: String
  var detail: String?
  var symbol: String
  var on: Bool
  var enabled: Bool
  var warning: Bool
}

final class BigButton: NSView {
  static let menuWidth: CGFloat = 320
  static let rowHeight: CGFloat = 44

  var content: ButtonContent {
    didSet { if content != oldValue { refresh() } }
  }
  var hovered = false {
    didSet { if hovered != oldValue { needsDisplay = true } }
  }
  var pressed = false {
    didSet { if pressed != oldValue { needsDisplay = true } }
  }
  var keyboardFocused = false {
    didSet { if keyboardFocused != oldValue { needsDisplay = true } }
  }

  let titleLabel = NSTextField(labelWithString: "")
  let detailLabel = NSTextField(labelWithString: "")
  private let choose: () -> Void

  init(content: ButtonContent, choose: @escaping () -> Void) {
    self.content = content
    self.choose = choose
    super.init(frame: NSRect(x: 0, y: 0, width: Self.menuWidth, height: Self.rowHeight))
    autoresizingMask = .width
    focusRingType = .none
    for label in [titleLabel, detailLabel] {
      label.lineBreakMode = .byTruncatingTail
      label.maximumNumberOfLines = 1
      label.setAccessibilityElement(false)
      label.cell?.setAccessibilityElement(false)
      addSubview(label)
    }
    detailLabel.font = .systemFont(ofSize: 11)
    addTrackingArea(
      NSTrackingArea(
        rect: .zero,
        options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect, .enabledDuringMouseDrag],
        owner: self))
    refresh()
  }

  required init?(coder: NSCoder) { nil }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { keyboardFocused && content.enabled }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  var pill: NSRect { bounds.insetBy(dx: 6, dy: 2) }
  var badge: NSRect { NSRect(x: pill.minX + 6, y: pill.midY - 14, width: 28, height: 28) }
  var checkmark: NSRect { NSRect(x: pill.maxX - 24, y: pill.midY - 7, width: 14, height: 14) }
  var textArea: NSRect {
    let start = badge.maxX + 8
    return NSRect(x: start, y: pill.minY, width: max(0, checkmark.minX - 4 - start), height: pill.height)
  }
  var showsFocusRing: Bool { keyboardFocused && !hovered && content.enabled }

  private func refresh() {
    titleLabel.stringValue = content.title
    titleLabel.font = .systemFont(ofSize: 13, weight: content.on ? .semibold : .medium)
    titleLabel.textColor = content.enabled ? .labelColor : .tertiaryLabelColor
    detailLabel.stringValue = content.detail ?? ""
    detailLabel.isHidden = content.detail == nil
    detailLabel.textColor = content.warning ? Palette.warning : .secondaryLabelColor
    toolTip = [content.title, content.detail].compactMap { $0 }.joined(separator: "\n")
    if !content.enabled {
      hovered = false
      pressed = false
      keyboardFocused = false
    }
    needsLayout = true
    needsDisplay = true
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    needsLayout = true
    needsDisplay = true
  }

  override func layout() {
    super.layout()
    for label in [titleLabel, detailLabel] {
      label.sizeToFit()
      label.setFrameSize(NSSize(width: min(label.frame.width, textArea.width), height: label.frame.height))
    }
    let gap: CGFloat = content.detail == nil ? 0 : 1
    let detailHeight = content.detail == nil ? 0 : detailLabel.frame.height
    var y = (pill.midY - (titleLabel.frame.height + gap + detailHeight) / 2).rounded()
    titleLabel.setFrameOrigin(NSPoint(x: textArea.minX, y: y))
    y += titleLabel.frame.height + gap
    detailLabel.setFrameOrigin(NSPoint(x: textArea.minX, y: y))
  }

  override func draw(_ dirtyRect: NSRect) {
    let alpha: CGFloat
    if !content.enabled {
      alpha = 0.035
    } else if pressed {
      alpha = 0.22
    } else if hovered || keyboardFocused {
      alpha = 0.14
    } else {
      alpha = content.on ? 0.10 : 0.06
    }
    let shape = NSBezierPath(roundedRect: pill, xRadius: 13, yRadius: 13)
    NSColor.labelColor.withAlphaComponent(alpha).setFill()
    shape.fill()
    if showsFocusRing {
      let ring = NSBezierPath(roundedRect: pill.insetBy(dx: 1, dy: 1), xRadius: 12, yRadius: 12)
      ring.lineWidth = 2
      NSColor.keyboardFocusIndicatorColor.setStroke()
      ring.stroke()
    }

    let accent = NSColor.controlAccentColor
    let badgeFill = content.on
      ? (pressed ? accent.blended(withFraction: 0.2, of: .black) ?? accent : accent)
      : NSColor.labelColor.withAlphaComponent(content.enabled ? 0.10 : 0.05)
    badgeFill.setFill()
    NSBezierPath(ovalIn: badge).fill()

    let ink: NSColor = content.on ? .white : (content.enabled ? .labelColor : .tertiaryLabelColor)
    draw(symbol: content.symbol, size: 13, color: ink, centeredIn: badge)
    if content.on {
      draw(symbol: "checkmark", size: 12, color: .labelColor, centeredIn: checkmark)
    }
  }

  private func draw(symbol: String, size: CGFloat, color: NSColor, centeredIn rect: NSRect) {
    let style = NSImage.SymbolConfiguration(pointSize: size, weight: .semibold)
      .applying(NSImage.SymbolConfiguration(paletteColors: [color]))
    guard let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
      .withSymbolConfiguration(style)
    else { return }
    let target = NSRect(
      x: rect.midX - image.size.width / 2, y: rect.midY - image.size.height / 2,
      width: image.size.width, height: image.size.height)
    image.draw(in: target, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    frame.contains(point) ? self : nil
  }

  override func mouseEntered(with event: NSEvent) {
    guard content.enabled else { return }
    hovered = true
    keyboardFocused = false
  }

  override func mouseExited(with event: NSEvent) {
    hovered = false
    pressed = false
  }

  override func mouseDown(with event: NSEvent) {
    guard content.enabled else { return }
    pressed = true
    displayIfNeeded()
  }

  override func mouseDragged(with event: NSEvent) {
    pressed = content.enabled && pill.contains(convert(event.locationInWindow, from: nil))
  }

  override func mouseUp(with event: NSEvent) {
    pressed = false
    guard content.enabled, pill.contains(convert(event.locationInWindow, from: nil)) else { return }
    choose()
  }

  override func keyDown(with event: NSEvent) {
    let returnKey: UInt16 = 36, space: UInt16 = 49, keypadEnter: UInt16 = 76
    guard content.enabled, [returnKey, space, keypadEnter].contains(event.keyCode) else {
      super.keyDown(with: event)
      return
    }
    if !event.isARepeat { choose() }
  }

  func resetInteraction() {
    hovered = false
    pressed = false
    keyboardFocused = false
  }

  override func isAccessibilityElement() -> Bool { true }
  override func accessibilityRole() -> NSAccessibility.Role? { .checkBox }
  override func accessibilitySubrole() -> NSAccessibility.Subrole? { .switch }
  override func accessibilityLabel() -> String? { content.title }
  override func accessibilityHelp() -> String? { content.detail }
  override func accessibilityValue() -> Any? { NSNumber(value: content.on ? 1 : 0) }
  override func isAccessibilityEnabled() -> Bool { content.enabled }
  override func accessibilityChildren() -> [Any]? { [] }

  override func accessibilityPerformPress() -> Bool {
    guard content.enabled else { return false }
    choose()
    return true
  }
}
