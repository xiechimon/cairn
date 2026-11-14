import SwiftUI
import UIKit

extension Color {
    static let canvas = Color(light: 0xFFFFFF, dark: 0x191919)
    static let card = Color(light: 0xF7F7F7, dark: 0x202020)
    static let ink = Color(light: 0x0A0A0A, dark: 0xF7F7F7)
    static let inkMuted = Color(light: 0x6E6E6E, dark: 0x8A8A8A)
    static let hairline = Color(light: 0xE6E6E6, dark: 0x303030)
    static let userBubble = Color(light: 0xF3EAD6, dark: 0x33290F)
    static let replyBubble = Color(light: 0xF2F2F2, dark: 0x292929)
    static let menuHover = Color(light: 0xF2F2F2, dark: 0x2E2E2E)
    static let taskRefLine = Color(light: 0xA9A9A9, dark: 0x6B6B6B)
    static let countBadge = Color(light: 0x376DD6, dark: 0x376DD6)
    static let running = Color(light: 0x5F8F4F, dark: 0x82B46F)
    static let failure = Color(light: 0xA33A2A, dark: 0xF09A88)
    static let waiting = Color(light: 0x6E4900, dark: 0xF2CF86)
    static let onAccent = Color(light: 0xFFFFFF, dark: 0x0A0A0A)

    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}

enum StatusTone {
    case working, wait, quiet, fail

    init(phase: String) {
        switch phase {
        case "planning", "building": self = .working
        case "confirm", "needs_input", "review": self = .wait
        case "failed": self = .fail
        default: self = .quiet
        }
    }

    var tile: Color {
        switch self {
        case .working: Color(light: 0xD2E4FF, dark: 0x223A5E)
        case .wait: Color(light: 0xD2EBCC, dark: 0x24402A)
        case .quiet: Color(light: 0xECECEC, dark: 0x2E2E2E)
        case .fail: Color(light: 0xF5DDD6, dark: 0x4A2A24)
        }
    }

    var ink: Color {
        switch self {
        case .working: Color(light: 0x2F55A8, dark: 0x9CBCF2)
        case .wait: Color(light: 0x2F6B2A, dark: 0x8FD18A)
        case .quiet: Color(light: 0x3A3A3A, dark: 0xC4C4C4)
        case .fail: .failure
        }
    }

    var symbol: String {
        switch self {
        case .working: "circle.dotted"
        case .wait: "eye"
        case .quiet: "circle"
        case .fail: "exclamationmark"
        }
    }
}

struct StatusTile: View {
    let phase: String
    var size: CGFloat = 22

    var body: some View {
        let tone = StatusTone(phase: phase)
        Image(systemName: phase == "done" ? "checkmark" : tone.symbol)
            .font(.system(size: size * 0.5, weight: .semibold))
            .foregroundStyle(tone.ink)
            .frame(width: size, height: size)
            .background(tone.tile, in: .rect(cornerRadius: size * 0.24))
            .accessibilityHidden(true)
    }
}

struct CountBadge: View {
    let count: Int

    var body: some View {
        if count > 0 {
            Text("\(count)")
                .font(.caption2.weight(.semibold).monospacedDigit())
                .foregroundStyle(.white)
                .padding(.horizontal, 5)
                .frame(minWidth: 18, minHeight: 18)
                .background(Color.countBadge, in: .capsule)
                .accessibilityHidden(true)
        }
    }
}

func compactAge(since date: Date, now: Date = .now) -> String {
    let minutes = max(0, Int(now.timeIntervalSince(date) / 60))
    if minutes < 60 { return "\(max(1, minutes))m" }
    if minutes < 60 * 24 { return "\(minutes / 60)h" }
    return "\(minutes / (60 * 24))d"
}
