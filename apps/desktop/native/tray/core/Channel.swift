import AppKit

enum Channel {
  static func write(_ message: Outgoing) {
    guard let data = try? JSONSerialization.data(withJSONObject: message.json, options: [.sortedKeys]) else {
      return
    }
    FileHandle.standardOutput.write(data + Data([0x0A]))
  }

  static func log(_ text: String) {
    FileHandle.standardError.write(Data("cairn-tray: \(text)\n".utf8))
  }

  static func decode(_ line: String) -> Incoming? {
    guard let data = line.data(using: .utf8) else { return nil }
    do {
      return try JSONDecoder().decode(Incoming.self, from: data)
    } catch {
      log("dropped a malformed line: \(error)")
      return nil
    }
  }

  static func read(_ handle: @escaping (Incoming) -> Void, ended: @escaping () -> Void) {
    DispatchQueue(label: "cairn.tray.stdin").async {
      while let line = readLine(strippingNewline: true) {
        guard let message = decode(line) else { continue }
        DispatchQueue.main.async { handle(message) }
      }
      DispatchQueue.main.async { ended() }
    }
  }
}

enum Icons {
  static func template(_ directory: String, _ name: String) -> NSImage? {
    let base = URL(fileURLWithPath: directory)
    guard let small = NSImageRep(contentsOf: base.appendingPathComponent("\(name).png")) else { return nil }
    let image = NSImage(size: small.size)
    image.addRepresentation(small)
    if let large = NSImageRep(contentsOf: base.appendingPathComponent("\(name)@2x.png")) {
      large.size = small.size
      image.addRepresentation(large)
    }
    image.isTemplate = true
    return image
  }
}
