import SwiftUI

enum StatusMarkID: String, CaseIterable, Sendable {
    case idle, think, write, look, run, task, ask, done, error, offline

    var label: LocalizedStringResource {
        switch self {
        case .idle: "Coordinator"
        case .think: "Thinking"
        case .write: "Replying"
        case .look: "Looking through the project"
        case .run: "Running a command"
        case .task: "Creating a task"
        case .ask: "Waiting for you"
        case .done: "Done"
        case .error: "Something went wrong"
        case .offline: "Waiting for the computer"
        }
    }

    var isActive: Bool { [.think, .write, .look, .run, .task].contains(self) }

    static func forTool(_ tool: String) -> StatusMarkID {
        if tool.range(of: "bash|shell|exec|command|terminal", options: [.regularExpression, .caseInsensitive]) != nil {
            return .run
        }
        if taskTools.contains(tool) || tool.range(of: "dispatch|todowrite|create_task|^task$", options: [.regularExpression, .caseInsensitive]) != nil {
            return .task
        }
        if lookTools.contains(tool) || tool.range(of: "read|grep|glob|search|list|fetch|view", options: [.regularExpression, .caseInsensitive]) != nil {
            return .look
        }
        return .think
    }

    private static let taskTools: Set = ["create_todo", "open_thread", "message_thread", "schedule_todo", "schedule_create"]
    private static let lookTools: Set = [
        "projects", "todos", "threads", "models", "machines", "skills", "docs", "issues", "pull_requests",
        "github_overlap", "workflow_runs", "conversation", "memories", "needs_you", "usage", "get_schedule",
        "wakes", "browser_snapshot",
    ]
}

extension StatusMarkID {
    static func of(questionPending: Bool, connected: Bool, running: Bool, tool: String?, replying: Bool, lastTurnFailed: Bool) -> StatusMarkID {
        if questionPending { return .ask }
        if !connected { return .offline }
        if !running { return lastTurnFailed ? .error : .idle }
        if let tool { return forTool(tool) }
        return replying ? .write : .think
    }
}

struct StatusMarkGlyph: View {
    let state: StatusMarkID
    var still = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var previous: StatusMarkID?
    @State private var changed = Date.distantPast

    var body: some View {
        let frozen = still || reduceMotion
        TimelineView(.animation(minimumInterval: 1 / 30, paused: frozen)) { context in
            Canvas { canvas, size in
                let now = context.date
                let frame = MarkGeometry.frame(
                    shown: previous ?? state, next: state,
                    sinceChange: now.timeIntervalSince(changed) * 1000, still: frozen
                )
                let t = frozen ? 0 : now.timeIntervalSinceReferenceDate * 1000
                let scale = min(size.width, size.height) / 88
                let path = MarkGeometry.path(frame.shown, t: t, pen: frame.pen, still: frozen)
                    .applying(CGAffineTransform(translationX: size.width / 2, y: size.height / 2).scaledBy(x: scale, y: scale))
                canvas.opacity = frame.shown == .offline ? 0.75 : 1
                canvas.stroke(
                    path,
                    with: .color(frame.shown == .error ? Color.failure : Color.ink),
                    style: StrokeStyle(lineWidth: 5 * scale, lineCap: .round, lineJoin: .round)
                )
            }
        }
        .onChange(of: state) { old, _ in
            previous = old
            changed = .now
        }
        .accessibilityHidden(true)
    }
}

enum MarkGeometry {
    typealias Segment = (Double) -> CGPoint
    typealias Pen = (Double, Double)

    static let eraseMs = 250.0
    static let drawMs = 350.0
    static let doneMs = 2200.0

    struct Shape {
        var lines: [[CGPoint]]
        var boil: Double?
        var window: (Double, Double)?
    }

    static func frame(shown: StatusMarkID, next: StatusMarkID, sinceChange: Double, still: Bool) -> (shown: StatusMarkID, pen: Pen) {
        if still { return (next, (0, 1)) }
        let sinceChange = max(0, sinceChange)
        if shown != next && sinceChange < eraseMs {
            return (shown, (min(0.985, easeOut(sinceChange / eraseMs)), 1))
        }
        if sinceChange >= eraseMs && sinceChange < eraseMs + drawMs {
            return (next, (0, max(0.015, easeOut((sinceChange - eraseMs) / drawMs))))
        }
        return (next, (0, 1))
    }

    static func path(_ id: StatusMarkID, t: Double, pen: Pen, still: Bool) -> Path {
        let shape = shape(id, t: still ? 0 : t)
        let k = still || shape.boil == nil ? 0 : (t / shape.boil!).rounded(.down) + 1
        let total = Double(shape.lines.count)
        var path = Path()
        for (index, line) in shape.lines.enumerated() {
            let li = Double(index)
            var a = pen.0
            var b = pen.1
            if total > 1 {
                a = clamp01(a * total - li)
                b = clamp01(b * total - li)
            }
            if let window = shape.window, !still {
                a = max(a, clamp01(window.0 * total - li))
                b = min(b, clamp01(window.1 * total - li))
            }
            if b - a <= 0.001 { continue }
            let points = cut(line, a, b).enumerated().map { i, point in
                let i = Double(i)
                let jx = k == 0 ? 0 : 0.9 * sin(i * 0.31 + k * 7.1)
                let jy = k == 0 ? 0 : 0.9 * cos(i * 0.27 + k * 3.3)
                return CGPoint(x: point.x + jx, y: point.y + jy)
            }
            path.addLines(points)
        }
        return path
    }

    static func shape(_ id: StatusMarkID, t: Double) -> Shape {
        switch id {
        case .idle:
            return Shape(lines: [spiral], boil: 520)
        case .think:
            let k = (t / 150).rounded(.down)
            let a = 0.8 + 0.3 * sin(k * 2.3)
            let tilt = k * 1.7
            return Shape(lines: [range(70) { u in
                let th = u * .pi * 4.6 + tilt
                let r = 16 + 7 * sin(th * 1.6 + k)
                return CGPoint(x: r * cos(th) * a, y: r * sin(th) * (1.95 - a))
            }])
        case .write:
            return Shape(lines: [cursive], boil: 170, window: writeWindow(t, period: 2100))
        case .look:
            return Shape(lines: read, boil: 170, window: writeWindow(t, period: 2400))
        case .run:
            return Shape(lines: [range(56) { u in
                CGPoint(x: -34 + 68 * u, y: (8 + 3 * sin(t / 310)) * sin(u * .pi * 7 - t / 150))
            }], boil: 140)
        case .task:
            return Shape(lines: checklist, boil: 170, window: writeWindow(t, period: 2600))
        case .ask:
            return Shape(lines: [bubble.map { CGPoint(x: $0.x, y: $0.y + 1.6 * sin(t / 420)) }], boil: 260)
        case .done:
            return Shape(lines: [check], boil: 600)
        case .error:
            return Shape(lines: cross, boil: 170)
        case .offline:
            let px = -60 + 150 * (t / 2200).truncatingRemainder(dividingBy: 1)
            return Shape(lines: [range(70) { v in
                let x = -36 + 72 * v
                let d = (x - px) / 6
                return CGPoint(x: x, y: 4 - 15 * exp(-d * d) * sin(d * 2.4))
            }])
        }
    }


    static let spiral = resample([
        arc(.init(x: -4, y: 0), .init(x: 4, y: 0), radius: 4),
        arc(.init(x: 4, y: 0), .init(x: -34, y: 0), radius: 19),
        arc(.init(x: -34, y: 0), .init(x: 34, y: 0), radius: 34),
        arc(.init(x: 34, y: 0), .init(x: 19.648, y: 34.648), radius: 49),
    ], count: 100).map { CGPoint(x: $0.x * 0.72, y: $0.y * 0.72 - 2) }

    static let check = resample([
        quad(-26, 1, -19, 4, -9, 20),
        quad(-9, 20, 4, -6, 30, -22),
    ], count: 40)

    static let bubble = resample([
        quad(-20, 20, -31, 14, -30, -2),
        quad(-30, -2, -29, -25, 0, -26),
        quad(0, -26, 30, -25, 30, -3),
        quad(30, -3, 30, 19, 2, 20),
        quad(2, 20, -6, 20, -12, 22),
        quad(-12, 22, -18, 29, -28, 30),
        quad(-28, 30, -21, 25, -20, 20),
    ], count: 90)

    static let cross = [
        resample([quad(-19, -21, -2, -3, 20, 19)], count: 20),
        resample([quad(21, -20, 3, -1, -20, 21)], count: 20),
    ]

    static let read = [stroke(-25, 23, y: -13, seed: 1), stroke(-26, 13, y: -1, seed: 4), stroke(-24, 25, y: 11, seed: 7)]

    static let cursive: [CGPoint] = {
        let heights: [Double] = [17, 9, 18, 8, 12]
        return wobble(range(150) { u in
            let th = u * .pi * 2 * 5
            let h = heights[min(4, Int((u * 5).rounded(.down)))]
            let up = 0.5 - 0.5 * cos(th)
            return CGPoint(x: -29 + 52 * u + 5.5 * sin(th) + 0.4 * h * up, y: 11 - h * up)
        }, seed: 2, amp: 0.9)
    }()

    static let checklist = [
        box(-27, -18, 11, seed: 1),
        stroke(-9, 24, y: -12, seed: 3),
        box(-27, 4, 11, seed: 5),
        stroke(-9, 15, y: 10, seed: 8),
    ]


    private static func clamp01(_ x: Double) -> Double { min(1, max(0, x)) }

    private static func easeOut(_ x: Double) -> Double { 1 - pow(1 - x, 3) }

    private static func writeWindow(_ t: Double, period: Double) -> (Double, Double) {
        let u = (t / period).truncatingRemainder(dividingBy: 1)
        if u < 0.6 { return (0, u / 0.6) }
        if u < 0.78 { return (0, 1) }
        return ((u - 0.78) / 0.22, 1)
    }

    private static func cut(_ line: [CGPoint], _ a: Double, _ b: Double) -> ArraySlice<CGPoint> {
        let last = line.count - 1
        let i0 = min(last, max(0, Int((a * Double(last)).rounded(.down))))
        let i1 = min(last, max(i0 + 1, Int((b * Double(last)).rounded(.up))))
        return line[i0...i1]
    }

    private static func quad(_ x0: Double, _ y0: Double, _ cx: Double, _ cy: Double, _ x1: Double, _ y1: Double) -> Segment {
        { t in
            let u = 1 - t
            return CGPoint(x: u * u * x0 + 2 * u * t * cx + t * t * x1, y: u * u * y0 + 2 * u * t * cy + t * t * y1)
        }
    }

    private static func arc(_ from: CGPoint, _ to: CGPoint, radius: Double) -> Segment {
        let halfX = (from.x - to.x) / 2
        let halfY = (from.y - to.y) / 2
        let half = halfX * halfX + halfY * halfY
        let r = max(radius, half.squareRoot())
        let coef = max(0, (r * r - half) / half).squareRoot()
        let cx = coef * halfY + (from.x + to.x) / 2
        let cy = -coef * halfX + (from.y + to.y) / 2
        let start = atan2(halfY + coef * halfX, halfX - coef * halfY)
        let end = atan2(-halfY + coef * halfX, -halfX - coef * halfY)
        var delta = end - start
        if delta < 0 { delta += .pi * 2 }
        return { t in CGPoint(x: cx + r * cos(start + delta * t), y: cy + r * sin(start + delta * t)) }
    }

    private static func resample(_ segments: [Segment], count: Int) -> [CGPoint] {
        var dense: [CGPoint] = []
        for segment in segments {
            for i in 0...64 { dense.append(segment(Double(i) / 64)) }
        }
        var cumulative = [0.0]
        for i in 1..<dense.count {
            cumulative.append(cumulative[i - 1] + hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y))
        }
        let total = cumulative[cumulative.count - 1]
        var points: [CGPoint] = []
        var index = 1
        for n in 0..<count {
            let target = total * Double(n) / Double(count - 1)
            while index < dense.count - 1 && cumulative[index] < target { index += 1 }
            let a = dense[index - 1]
            let b = dense[index]
            let span = cumulative[index] - cumulative[index - 1]
            let f = span == 0 ? 0 : min(1, max(0, (target - cumulative[index - 1]) / span))
            points.append(CGPoint(x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f))
        }
        return points
    }

    private static func range(_ n: Int, _ f: (Double) -> CGPoint) -> [CGPoint] {
        (0..<n).map { f(Double($0) / Double(n - 1)) }
    }

    private static func wobble(_ points: [CGPoint], seed: Double, amp: Double) -> [CGPoint] {
        points.enumerated().map { i, p in
            let i = Double(i)
            return CGPoint(x: p.x + amp * sin(i * 0.23 + seed), y: p.y + amp * cos(i * 0.19 + seed * 1.7))
        }
    }

    private static func stroke(_ x0: Double, _ x1: Double, y: Double, seed: Double) -> [CGPoint] {
        wobble(range(26) { u in
            let x = x0 + (x1 - x0) * u
            return CGPoint(x: x, y: y + 0.07 * x)
        }, seed: seed, amp: 1.3)
    }

    private static func box(_ x: Double, _ y: Double, _ w: Double, seed: Double) -> [CGPoint] {
        let corners = [
            CGPoint(x: x, y: y + 1), CGPoint(x: x + w + 1, y: y - 1), CGPoint(x: x + w, y: y + w + 1),
            CGPoint(x: x - 1, y: y + w), CGPoint(x: x + 1, y: y - 2),
        ]
        let segments: [Segment] = zip(corners, corners.dropFirst()).map { from, to in
            { t in CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t) }
        }
        return wobble(resample(segments, count: 30), seed: seed, amp: 0.8)
    }
}
