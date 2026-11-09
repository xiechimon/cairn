import SwiftUI

struct CairnSpiral: Sendable {
    let innerRadius: Double
    let pitch: Double
    let halfTurns: Int
    let tailDegrees: Double
    let band: Double

    static let large = CairnSpiral(innerRadius: 7, pitch: 30, halfTurns: 5, tailDegrees: 40, band: 11.5)
    static let small = CairnSpiral(innerRadius: 4, pitch: 30, halfTurns: 3, tailDegrees: 45, band: 12.5)

    var centerline: [CGPoint] {
        let half = pitch / 2
        let samplesPerHalfTurn = 48
        var points: [CGPoint] = []
        func sweep(_ k: Int, through fraction: Double) {
            let centerX = k.isMultiple(of: 2) ? 0 : -half
            let radius = innerRadius + Double(k) * half
            let start = k.isMultiple(of: 2) ? Double.pi : 0
            let steps = max(2, Int((Double(samplesPerHalfTurn) * fraction).rounded(.up)))
            for i in 0...steps {
                let angle = start + Double.pi * fraction * Double(i) / Double(steps)
                points.append(CGPoint(x: centerX + radius * cos(angle), y: radius * sin(angle)))
            }
        }
        for k in 0..<halfTurns { sweep(k, through: 1) }
        if tailDegrees > 0 { sweep(halfTurns, through: tailDegrees / 180) }
        return points
    }
}

struct CairnMark: Shape {
    var spiral: CairnSpiral = .large

    func path(in rect: CGRect) -> Path {
        let points = spiral.centerline
        let xs = points.map(\.x)
        let ys = points.map(\.y)
        let pad = spiral.band / 2
        let minX = xs.min()! - pad, maxX = xs.max()! + pad
        let minY = ys.min()! - pad, maxY = ys.max()! + pad
        let scale = min(rect.width / (maxX - minX), rect.height / (maxY - minY))
        let offsetX = rect.midX - (minX + maxX) / 2 * scale
        let offsetY = rect.midY - (minY + maxY) / 2 * scale
        var line = Path()
        line.addLines(points.map { CGPoint(x: $0.x * scale + offsetX, y: $0.y * scale + offsetY) })
        return line.strokedPath(StrokeStyle(lineWidth: spiral.band * scale, lineCap: .round, lineJoin: .round))
    }
}
