import AppKit

final class TrayApplication: NSApplication {
  var disclosureKey: ((NSEvent) -> Bool)?

  override func nextEvent(
    matching mask: NSEvent.EventTypeMask, until expiration: Date?,
    inMode mode: RunLoop.Mode, dequeue: Bool
  ) -> NSEvent? {
    // AppKit menu tracking dequeues its own events without calling sendEvent(_:).
    while let event = super.nextEvent(matching: mask, until: expiration, inMode: mode, dequeue: dequeue) {
      if mode == .eventTracking, dequeue, event.type == .keyDown, disclosureKey?(event) == true {
        continue
      }
      return event
    }
    return nil
  }
}
