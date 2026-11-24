import Foundation

struct OpenTarget: Decodable, Equatable {
  let kind: String
  let path: String?
  let command: String?
}

struct ReadingPart: Decodable, Equatable {
  let text: String
  let strained: Bool
}

struct Reading: Decodable, Equatable {
  let parts: [ReadingPart]
  let faint: Bool
  let spoken: String
  let tip: String
}

enum ItemKind: String, Decodable {
  case row, header, `switch`, command, separator
}

struct TrayItem: Decodable, Equatable {
  let kind: ItemKind
  let id: String
  var title: String?
  var status: String?
  var tip: String?
  var glyph: String?
  var image: String?
  var warn: Bool?
  var open: OpenTarget?
  var reading: Reading?
  var detail: String?
  var on: Bool?
  var enabled: Bool?
  var key: String?

  init(kind: ItemKind, id: String) {
    self.kind = kind
    self.id = id
  }

  var isWarning: Bool { warn == true }
}

struct TrayMenuModel: Decodable, Equatable {
  let label: String
  let items: [TrayItem]

  var shape: [String] { items.map { "\($0.kind.rawValue):\($0.id)" } }
}

struct IconModel: Decodable, Equatable {
  let awake: Bool
  let tooltip: String
}

struct Incoming: Decodable {
  let type: String
  let menu: TrayMenuModel?
  let awake: Bool?
  let tooltip: String?
}

enum Outgoing {
  case ready
  case opened
  case closed
  case action(String)

  var json: [String: Any] {
    switch self {
    case .ready: return ["type": "ready"]
    case .opened: return ["type": "opened"]
    case .closed: return ["type": "closed"]
    case .action(let id): return ["type": "action", "id": id]
    }
  }
}
