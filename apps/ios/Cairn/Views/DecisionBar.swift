import SwiftUI

struct DecisionBar: View {
    let decision: TaskDecision?
    let orchestrating: Bool
    let busy: Bool
    let notice: String?
    let failure: String?
    let onDecide: (TaskDecision) -> Void

    var body: some View {
        if decision != nil || notice != nil || failure != nil {
            VStack(alignment: .leading, spacing: 8) {
                if let failure {
                    Label(failure, systemImage: "exclamationmark.circle")
                        .font(.footnote)
                        .foregroundStyle(Color.failure)
                        .accessibilityIdentifier("decision-error")
                } else if let notice {
                    Label(notice, systemImage: "checkmark")
                        .font(.footnote)
                        .foregroundStyle(Color.inkMuted)
                        .accessibilityIdentifier("decision-notice")
                }
                if let decision {
                    chip(decision)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 8)
        }
    }

    private func chip(_ decision: TaskDecision) -> some View {
        Button {
            onDecide(decision)
        } label: {
            HStack(spacing: 6) {
                if busy || orchestrating {
                    ProgressView().controlSize(.mini)
                }
                Text(orchestrating ? LocalizedStringResource("Orchestrating") : decision.label)
            }
            .font(.subheadline)
            .foregroundStyle(Color.ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(Color.menuHover, in: .capsule)
            .overlay(Capsule().strokeBorder(Color.hairline))
        }
        .buttonStyle(.plain)
        .disabled(busy || orchestrating)
        .accessibilityHint(Text(decision.reason))
        .accessibilityIdentifier("decision-button")
    }
}
