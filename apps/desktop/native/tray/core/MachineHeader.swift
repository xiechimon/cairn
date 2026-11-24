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
}

final class MachineHeader: NSView {
  static let height: CGFloat = 40
  static let inset: CGFloat = 14

  private(set) var item: TrayItem
  let name = NSTextField(labelWithString: "")
  let readingLabel = NSTextField(labelWithString: "")

  init(_ item: TrayItem) {
    self.item = item
    super.init(frame: NSRect(x: 0, y: 0, width: BigButton.menuWidth, height: Self.height))
    autoresizingMask = .width
    name.font = .systemFont(ofSize: 12, weight: .semibold)
    for label in [name, readingLabel] {
      label.lineBreakMode = .byTruncatingTail
      label.maximumNumberOfLines = 1
      label.setAccessibilityElement(false)
      addSubview(label)
    }
    update(item)
  }

  required init?(coder: NSCoder) { nil }

  override var isFlipped: Bool { true }

  func update(_ next: TrayItem) {
    item = next
    name.stringValue = next.title ?? ""
    name.textColor = next.reading?.faint == true ? .tertiaryLabelColor : .labelColor
    toolTip = [next.title, next.reading?.tip].compactMap { $0 }.joined(separator: "\n")
    needsLayout = true
  }

  var spokenLabel: String {
    [item.title, item.reading?.spoken].compactMap { $0 }.joined(separator: ", ")
  }

  static func reading(_ reading: Reading, dropping drop: Int) -> NSAttributedString {
    let size: CGFloat = 11
    let digits = NSFont.monospacedDigitSystemFont(ofSize: size, weight: .regular)
    let bold = NSFont.monospacedDigitSystemFont(ofSize: size, weight: .bold)
    let base: NSColor = reading.faint ? .tertiaryLabelColor : .secondaryLabelColor
    var parts = reading.parts
    var removed = 0
    while removed < drop, parts.count > 1, let index = parts.lastIndex(where: { !$0.strained }) {
      parts.remove(at: index)
      removed += 1
    }
    let out = NSMutableAttributedString()
    for (index, part) in parts.enumerated() {
      if index > 0 { out.append(NSAttributedString(string: " · ", attributes: [.font: digits, .foregroundColor: base])) }
      out.append(
        NSAttributedString(
          string: part.text,
          attributes: [
            .font: part.strained ? bold : digits, .foregroundColor: part.strained ? Palette.warning : base,
          ]))
    }
    return out
  }

  var textWidth: CGFloat { max(0, bounds.width - Self.inset * 2) }

  override func layout() {
    super.layout()
    if let reading = item.reading {
      var drop = 0
      readingLabel.attributedStringValue = Self.reading(reading, dropping: 0)
      while readingLabel.attributedStringValue.size().width > textWidth, drop < reading.parts.count {
        drop += 1
        readingLabel.attributedStringValue = Self.reading(reading, dropping: drop)
      }
      readingLabel.isHidden = false
    } else {
      readingLabel.isHidden = true
    }
    for label in [name, readingLabel] {
      label.sizeToFit()
      label.setFrameSize(NSSize(width: min(label.frame.width, textWidth), height: label.frame.height))
    }
    name.setFrameOrigin(NSPoint(x: Self.inset, y: 4))
    readingLabel.setFrameOrigin(NSPoint(x: Self.inset, y: name.frame.maxY + 1))
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  override func isAccessibilityElement() -> Bool { true }
  override func accessibilityRole() -> NSAccessibility.Role? { .staticText }
  override func accessibilityLabel() -> String? { spokenLabel }
  override func accessibilityChildren() -> [Any]? { [] }
}
