import SwiftUI

struct QuestionChips: View {
    let question: PendingQuestion
    let onAnswer: (PendingQuestion, [QuestionAnswer]) async throws -> Void
    @State private var picks: [Int: [String]] = [:]
    @State private var step = 0
    @State private var busy = false
    @State private var error: String?

    private var items: [QuestionItem] { question.ask.questions }
    private var item: QuestionItem? { items.indices.contains(step) ? items[step] : items.first }
    private var last: Bool { step >= items.count - 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let item {
                ReplyBubble(text: item.question)
                    .accessibilityIdentifier("question-text")
                if question.ask.isPending {
                    chips(for: item)
                } else {
                    answered
                }
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(Color.failure)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("question-card")
    }

    @ViewBuilder private func chips(for item: QuestionItem) -> some View {
        let multi = item.multiSelect == true
        ChipFlow {
            ForEach(Array(recommendedFirst(item.options).enumerated()), id: \.offset) { number, option in
                let selected = picks[step, default: []].contains(option.label)
                Button {
                    choose(option.label, in: item)
                } label: {
                    Text(option.label)
                        .font(.subheadline)
                        .foregroundStyle(Color.ink)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(selected || option.recommended == true ? Color.menuHover : Color.clear, in: .capsule)
                        .overlay(Capsule().strokeBorder(selected ? Color.inkMuted : Color.hairline))
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .accessibilityHint(Text(hint(option)))
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("option-\(number + 1)")
            }
            if item.options.isEmpty {
                TextField("Your answer", text: textBinding)
                    .font(.subheadline)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .overlay(Capsule().strokeBorder(Color.hairline))
                    .accessibilityIdentifier("answer-text-\(step + 1)")
            }
            if multi || item.options.isEmpty {
                Button {
                    advance()
                } label: {
                    Text(last ? "Submit" : "Next")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.onAccent)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(Color.ink, in: .capsule)
                }
                .buttonStyle(.plain)
                .disabled(busy || picks[step, default: []].allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty })
                .accessibilityIdentifier("answer-button")
            }
        }
    }

    private var answered: some View {
        let chosen = question.ask.answers?.compactMap { $0.choices?.joined(separator: ", ") ?? $0.text }.joined(separator: " · ") ?? ""
        return HStack(spacing: 6) {
            Image(systemName: "checkmark")
                .font(.caption.weight(.bold))
            Text("Answered")
            if !chosen.isEmpty {
                Text("·")
                Text(chosen).foregroundStyle(Color.ink)
            }
        }
        .font(.footnote)
        .foregroundStyle(Color.inkMuted)
        .padding(.leading, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("answered-choice")
    }

    private var textBinding: Binding<String> {
        Binding(get: { picks[step]?.first ?? "" }, set: { picks[step] = [$0] })
    }

    private func hint(_ option: QuestionOption) -> String {
        [option.recommended == true ? String(localized: "Recommended") : nil, option.description]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private func recommendedFirst(_ options: [QuestionOption]) -> [QuestionOption] {
        options.filter { $0.recommended == true } + options.filter { $0.recommended != true }
    }

    private func choose(_ label: String, in item: QuestionItem) {
        picks[step] = QuestionItem.pick(label, in: picks[step, default: []], multiSelect: item.multiSelect == true)
        if item.multiSelect != true { advance() }
    }

    private func advance() {
        if last {
            Task { await submit() }
        } else {
            step += 1
        }
    }

    private func submit() async {
        guard !busy, let answers = question.ask.reply(picks) else { return }
        busy = true
        do {
            try await onAnswer(question, answers)
            error = nil
        } catch {
            self.error = error.localizedDescription
            picks = [:]
            step = 0
        }
        busy = false
    }
}

private struct ChipFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(proposal.width ?? .infinity, subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(bounds.width, subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(ProposedViewSize(width: width, height: nil))
            if !rows[rows.count - 1].indices.isEmpty && rows[rows.count - 1].width + spacing + size.width > width {
                rows.append(Row())
            }
            let gap = rows[rows.count - 1].indices.isEmpty ? 0 : spacing
            rows[rows.count - 1].indices.append(index)
            rows[rows.count - 1].width += gap + size.width
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
        }
        return rows
    }
}
