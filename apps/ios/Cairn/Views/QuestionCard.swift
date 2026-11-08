import SwiftUI

struct QuestionCard: View {
    let question: PendingQuestion
    let onAnswer: (PendingQuestion, [QuestionAnswer]) async throws -> Void
    @State private var picks: [Int: [String]] = [:]
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                CairnMark(spiral: .small)
                    .fill(Color.ink)
                    .frame(width: 16, height: 16)
                    .accessibilityHidden(true)
                Text(question.ask.isPending ? "Asked you a question." : "Answered")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(question.ask.isPending ? Color.waiting : Color.inkMuted)
            }
            ForEach(Array(question.ask.questions.enumerated()), id: \.offset) { index, item in
                VStack(alignment: .leading, spacing: 10) {
                    Text(item.header)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.inkMuted)
                        .textCase(.uppercase)
                    Text(item.question)
                        .font(.body)
                        .foregroundStyle(Color.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if question.ask.isPending && item.multiSelect == true && !item.options.isEmpty {
                        Text("Pick any that apply.")
                            .font(.footnote)
                            .foregroundStyle(Color.inkMuted)
                    }
                    if question.ask.isPending && item.options.isEmpty {
                        TextField("Your answer", text: binding(for: index), axis: .vertical)
                            .lineLimit(1...6)
                            .padding(12)
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.hairline))
                            .accessibilityIdentifier("answer-text-\(index + 1)")
                    } else if question.ask.isPending {
                        ForEach(Array(item.options.enumerated()), id: \.offset) { number, option in
                            OptionRow(
                                number: number + 1,
                                option: option,
                                selected: picks[index, default: []].contains(option.label)
                            ) {
                                picks[index] = QuestionItem.pick(option.label, in: picks[index, default: []], multiSelect: item.multiSelect == true)
                            }
                        }
                    } else if let chosen = question.ask.answers?.first(where: { $0.header == item.header }) {
                        Label(chosen.choices?.joined(separator: ", ") ?? chosen.text ?? "", systemImage: "checkmark")
                            .font(.callout)
                            .foregroundStyle(Color.ink)
                    }
                }
            }
            if question.ask.isPending {
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Color.failure)
                }
                Button {
                    Task { await submit() }
                } label: {
                    Text(busy ? "Sending…" : "Answer")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                        .foregroundStyle(Color.onAccent)
                }
                .buttonStyle(.glassProminent)
                .disabled(busy || question.ask.reply(picks) == nil)
                .accessibilityIdentifier("answer-button")
            }
        }
        .padding(16)
        .background(Color.card, in: .rect(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.hairline))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("question-card")
    }

    private func binding(for index: Int) -> Binding<String> {
        Binding(get: { picks[index]?.first ?? "" }, set: { picks[index] = [$0] })
    }

    private func submit() async {
        guard let answers = question.ask.reply(picks) else { return }
        busy = true
        do {
            try await onAnswer(question, answers)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }
}

private struct OptionRow: View {
    let number: Int
    let option: QuestionOption
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Text("\(number)")
                    .font(.callout.monospacedDigit().weight(.semibold))
                    .foregroundStyle(selected ? Color.onAccent : Color.ink)
                    .frame(width: 26, height: 26)
                    .background(selected ? Color.accentColor : Color.userBubble, in: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(option.label)
                            .font(.body.weight(.medium))
                            .foregroundStyle(Color.ink)
                        if option.recommended == true {
                            Text("Recommended")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(Color.inkMuted)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .overlay(Capsule().strokeBorder(Color.hairline))
                        }
                    }
                    if let description = option.description {
                        Text(description)
                            .font(.footnote)
                            .foregroundStyle(Color.inkMuted)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(selected ? Color.userBubble : Color.clear, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? Color.ink.opacity(0.5) : Color.hairline))
            .contentShape(.rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("option-\(number)")
    }
}
