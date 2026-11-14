import SwiftUI

struct MadeView: View {
    let model: AppModel

    var body: some View {
        NavigationStack {
            List {
                if model.finished.isEmpty {
                    Text("Tasks show up here once they merge.")
                        .font(.callout)
                        .foregroundStyle(Color.inkMuted)
                        .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(model.finished) { task in
                            NavigationLink(value: task) {
                                HStack(spacing: 10) {
                                    StatusTile(phase: task.phase, size: 22)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(task.title)
                                            .foregroundStyle(Color.ink)
                                            .lineLimit(1)
                                        if let project = model.projectName(task.projectId) {
                                            Text(project)
                                                .font(.footnote)
                                                .foregroundStyle(Color.inkMuted)
                                        }
                                    }
                                    Spacer(minLength: 8)
                                    Text(task.changed, format: .dateTime.month().day())
                                        .font(.footnote)
                                        .foregroundStyle(Color.inkMuted)
                                }
                            }
                        }
                    }
                    .listRowBackground(Color.card)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.canvas.ignoresSafeArea())
            .navigationTitle("Made")
            .navigationDestination(for: TaskRecord.self) { task in
                TaskThreadView(model: model, task: task)
            }
            .refreshable { await model.load() }
        }
    }
}

struct MachinesView: View {
    let model: AppModel

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.machines) { machine in
                        HStack(spacing: 12) {
                            Image(systemName: "laptopcomputer")
                                .foregroundStyle(Color.inkMuted)
                                .frame(width: 24)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(machine.name).foregroundStyle(Color.ink)
                                status(machine)
                                    .font(.footnote)
                                    .foregroundStyle(Color.inkMuted)
                            }
                            Spacer()
                            Circle()
                                .fill(machine.online ? Color.running : Color.hairline)
                                .frame(width: 6, height: 6)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .listRowBackground(Color.card)
            }
            .scrollContentBackground(.hidden)
            .background(Color.canvas.ignoresSafeArea())
            .navigationTitle("Computers")
            .refreshable { await model.load() }
        }
    }

    private func status(_ machine: Machine) -> Text {
        guard machine.online else { return Text("Offline") }
        let running = machine.runningSteps ?? 0
        return running > 0 ? Text("Online · \(running) running") : Text("Online")
    }
}
