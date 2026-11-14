import SwiftUI

struct SignInView: View {
    @Environment(Session.self) private var session
    @State private var server = ""
    @State private var token = ""
    @State private var error: String?
    @State private var busy = false
    @FocusState private var field: Field?

    private enum Field { case server, token }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 8) {
                        CairnMark()
                            .fill(Color.ink)
                            .frame(width: 40, height: 40)
                            .padding(.bottom, 4)
                            .accessibilityElement()
                            .accessibilityLabel("cairn")
                            .accessibilityIdentifier("brand-mark")
                        Text("Sign in to cairn")
                            .font(.largeTitle.weight(.semibold))
                            .foregroundStyle(Color.ink)
                        Text("Connect to your cairn server with its access token. The token stays in this device's Keychain.")
                            .font(.callout)
                            .foregroundStyle(Color.inkMuted)
                    }

                    VStack(spacing: 0) {
                        LabeledField(title: "Server") {
                            TextField("http://localhost:8787", text: $server)
                                .textContentType(.URL)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($field, equals: .server)
                                .submitLabel(.next)
                                .onSubmit { field = .token }
                                .accessibilityIdentifier("server-field")
                        }
                        Divider().overlay(Color.hairline)
                        LabeledField(title: "Token") {
                            SecureField("cairn token", text: $token)
                                .textContentType(.oneTimeCode)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($field, equals: .token)
                                .submitLabel(.go)
                                .onSubmit { Task { await submit() } }
                                .accessibilityIdentifier("token-field")
                        }
                    }
                    .background(Color.card, in: .rect(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.hairline))

                    if let error {
                        Label(error, systemImage: "exclamationmark.circle")
                            .font(.footnote)
                            .foregroundStyle(Color.failure)
                            .accessibilityIdentifier("sign-in-error")
                    }

                    Button {
                        Task { await submit() }
                    } label: {
                        Group {
                            if busy {
                                ProgressView()
                            } else {
                                Text("Sign in")
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .foregroundStyle(Color.onAccent)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(busy || server.isEmpty || token.isEmpty)
                    .accessibilityIdentifier("sign-in-button")

                    Text("Run `cairn token` on the server machine to print the token.")
                        .font(.footnote)
                        .foregroundStyle(Color.inkMuted)
                }
                .padding(24)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.canvas.ignoresSafeArea())
        }
        .onAppear { if server.isEmpty { server = session.serverText } }
    }

    private func submit() async {
        guard !busy else { return }
        busy = true
        error = nil
        let entered = token
        token = ""
        field = nil
        do {
            try await session.signIn(server: server, token: entered)
        } catch {
            token = entered
            self.error = error.localizedDescription
        }
        busy = false
    }
}

private struct LabeledField<Content: View>: View {
    let title: LocalizedStringKey
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.callout.weight(.medium))
                .foregroundStyle(Color.ink)
                .frame(width: 64, alignment: .leading)
            content
                .font(.body)
                .foregroundStyle(Color.ink)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}
