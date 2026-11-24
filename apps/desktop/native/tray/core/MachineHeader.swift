import AppKit

enum Symbols {
  static func image(_ names: [String], size: CGFloat = 13, weight: NSFont.Weight = .regular, tint: NSColor? = nil)
    -> NSImage?
  {
    for name in names {
      guard var image = NSImage(systemSymbolName: name, accessibilityDescription: nil) else { continue }
      var style = NSImage.SymbolConfiguration(pointSize: size, weight: weight)
      if let tint { style = style.applying(NSImage.SymbolConfiguration(paletteColors: [tint])) }
      image = image.withSymbolConfiguration(style) ?? image
      return image
    }
    return nil
  }

  static func os(_ platform: String?) -> [String] {
    switch platform {
    case "darwin": return ["apple.logo", "desktopcomputer"]
    case "windows": return ["pc", "desktopcomputer"]
    case "linux": return ["server.rack", "terminal", "desktopcomputer"]
    default: return ["desktopcomputer"]
    }
  }

  static func glyph(_ kind: String?, warn: Bool) -> (names: [String], tint: NSColor?)? {
    switch kind {
    case "attention":
      return warn ? (["exclamationmark.circle"], .systemOrange) : (["smallcircle.filled.circle"], .systemOrange)
    case "working", "progress", "quarter", "half", "three-quarter":
      return (["circle.lefthalf.filled"], .systemBlue)
    case "queued": return (["clock"], nil)
    case "todo": return (["circle.dashed", "circle"], nil)
    case "ring": return (["circle"], nil)
    case "done": return (["checkmark.circle"], nil)
    case "failed": return (["xmark.circle"], .systemRed)
    case "closed": return (["slash.circle", "circle"], nil)
    default: return nil
    }
  }

  static func meterTint(_ level: String) -> NSColor {
    switch level {
    case "full": return Palette.warning
    case "high": return .labelColor
    default: return .secondaryLabelColor
    }
  }
}

final class MachineHeader: NSView {
  static let height: CGFloat = 24
  static let inset: CGFloat = 14

  private(set) var item: TrayItem
  let icon = NSImageView()
  let name = NSTextField(labelWithString: "")
  let meter = NSTextField(labelWithString: "")
  let gauge = NSImageView()

  init(_ item: TrayItem) {
    self.item = item
    super.init(frame: NSRect(x: 0, y: 0, width: BigButton.menuWidth, height: Self.height))
    autoresizingMask = .width
    for view in [icon, name, meter, gauge] as [NSView] {
      view.setAccessibilityElement(false)
      addSubview(view)
    }
    name.lineBreakMode = .byTruncatingTail
    name.font = .systemFont(ofSize: NSFont.smallSystemFontSize, weight: .semibold)
    meter.font = .monospacedDigitSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .semibold)
    update(item)
  }

  required init?(coder: NSCoder) { nil }

  override var isFlipped: Bool { true }

  func update(_ next: TrayItem) {
    item = next
    name.stringValue = next.title ?? ""
    name.textColor = .secondaryLabelColor
    icon.image = Symbols.image(Symbols.os(next.os), size: 11, weight: .semibold, tint: .secondaryLabelColor)
    if let value = next.meter {
      meter.isHidden = false
      gauge.isHidden = false
      meter.stringValue = "\(value.percent)%"
      let tint = Symbols.meterTint(value.level)
      meter.textColor = tint
      gauge.image = Symbols.image(["gauge.with.dots.needle.67percent", "gauge"], size: 11, weight: .semibold, tint: tint)
      toolTip = value.tip
    } else {
      meter.isHidden = true
      gauge.isHidden = true
      toolTip = nil
    }
    needsLayout = true
  }

  var spokenLabel: String {
    [item.title, item.meter.map { "\($0.percent)%" }, item.meter?.tip].compactMap { $0 }.joined(separator: ", ")
  }

  override func layout() {
    super.layout()
    let mid = bounds.midY
    icon.frame = NSRect(x: Self.inset, y: mid - 7, width: 14, height: 14)
    meter.sizeToFit()
    let right = bounds.width - Self.inset
    meter.setFrameOrigin(NSPoint(x: right - meter.frame.width, y: (mid - meter.frame.height / 2).rounded()))
    gauge.frame = NSRect(x: meter.frame.minX - 16, y: mid - 7, width: 14, height: 14)
    name.sizeToFit()
    let start = icon.frame.maxX + 4
    let end = meter.isHidden ? right : gauge.frame.minX - 6
    name.frame = NSRect(
      x: start, y: (mid - name.frame.height / 2).rounded(), width: max(0, min(name.frame.width, end - start)),
      height: name.frame.height)
  }

  override func isAccessibilityElement() -> Bool { true }
  override func accessibilityRole() -> NSAccessibility.Role? { .staticText }
  override func accessibilityLabel() -> String? { spokenLabel }
  override func accessibilityChildren() -> [Any]? { [] }
}
