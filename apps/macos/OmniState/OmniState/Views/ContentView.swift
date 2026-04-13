import SwiftUI

struct NativeConversation: Identifiable, Equatable {
    let id: String
    var title: String
    var provider: String
    var model: String
    var memorySummary: String
    var memoryLog: [String]
}

struct ContentView: View {
    @EnvironmentObject var gatewayManager: GatewayManager
    @EnvironmentObject var healthChecker: HealthChecker
    @EnvironmentObject var networkMonitor: NetworkMonitor
    @EnvironmentObject var deviceManager: DeviceManager
    @EnvironmentObject var socketClient: GatewaySocketClient

    @State private var sessions: [NativeConversation] = [
        NativeConversation(
            id: "default",
            title: "Default Session",
            provider: "",
            model: "",
            memorySummary: "",
            memoryLog: []
        )
    ]
    @State private var selectedConversationID: String? = "default"
    @State private var selectedDeviceID: String?
    @State private var promptText = ""
    @State private var sharedMemorySummary = ""

    private var statusColor: Color {
        if !gatewayManager.isRunning { return .red }
        return healthChecker.isHealthy ? .green : .orange
    }

    private var statusText: String {
        if !gatewayManager.isRunning { return "Gateway Stopped" }
        return healthChecker.isHealthy ? "Gateway Healthy" : "Gateway Starting"
    }

    private var selectedSessionIndex: Int? {
        guard let selectedConversationID else { return nil }
        return sessions.firstIndex(where: { $0.id == selectedConversationID })
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selectedConversationID) {
                Section("Sessions") {
                    ForEach(sessions) { session in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(session.title)
                            Text(summaryLine(for: session))
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .tag(Optional(session.id))
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("OmniState")
            .toolbar {
                ToolbarItem(placement: .automatic) {
                    Button {
                        createSession()
                    } label: {
                        Image(systemName: "plus")
                    }
                    .help("New session")
                }
            }
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 10) {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 10, height: 10)
                        Text(statusText)
                            .font(.headline)
                    }

                    sessionCard
                    assistantCard
                    historyCard
                    networkCard
                    devicesCard

                    if let error = gatewayManager.lastError ?? deviceManager.lastError {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .padding(10)
                            .background(Color.red.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }

                    if !socketClient.lastClaudeMemSyncMessage.isEmpty {
                        Text(socketClient.lastClaudeMemSyncMessage)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(20)
            }
            .navigationTitle("Native Dashboard")
        }
        .task {
            await deviceManager.fetchDevices()
            socketClient.connect()
            socketClient.queryRuntimeConfig()
            socketClient.queryHistory(limit: 30)
            socketClient.queryClaudeMem()
        }
        .onChange(of: socketClient.sessionMemoryByConversation) { value in
            mergeMemoryFromBackend(value)
        }
        .onChange(of: socketClient.sharedMemorySummary) { value in
            sharedMemorySummary = value
        }
    }

    private var sessionCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Session Runtime")
                .font(.title3.weight(.semibold))

            if let idx = selectedSessionIndex {
                TextField("Session name", text: Binding(
                    get: { sessions[idx].title },
                    set: { sessions[idx].title = $0 }
                ))
                .textFieldStyle(.roundedBorder)

                HStack(spacing: 10) {
                    TextField("Provider", text: Binding(
                        get: { sessions[idx].provider },
                        set: { sessions[idx].provider = $0 }
                    ))
                    .textFieldStyle(.roundedBorder)

                    TextField("Model", text: Binding(
                        get: { sessions[idx].model },
                        set: { sessions[idx].model = $0 }
                    ))
                    .textFieldStyle(.roundedBorder)
                }

                TextField("Shared memory summary", text: $sharedMemorySummary, axis: .vertical)
                    .lineLimit(2...5)
                    .textFieldStyle(.roundedBorder)

                HStack(spacing: 10) {
                    Button("Apply Runtime") {
                        applyRuntimeForSelectedSession()
                    }

                    Button("Pull Memory") {
                        socketClient.queryClaudeMem()
                    }

                    Button("Sync Memory") {
                        syncAllMemoryToBackend()
                    }

                    Spacer()

                    if !socketClient.runtimeProvider.isEmpty || !socketClient.runtimeModel.isEmpty {
                        Text("Current: \(socketClient.runtimeProvider) / \(socketClient.runtimeModel)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            } else {
                Text("Select or create a session")
                    .foregroundColor(.secondary)
            }
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var assistantCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Assistant")
                    .font(.title3.weight(.semibold))

                Spacer()

                Label(socketClient.isConnected ? "Connected" : "Disconnected", systemImage: socketClient.isConnected ? "wifi" : "wifi.slash")
                    .font(.caption)
                    .foregroundColor(socketClient.isConnected ? .green : .secondary)
            }

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if socketClient.messages.isEmpty {
                        Text("Nhập yêu cầu để bắt đầu tương tác với gateway giống web chat.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .padding(.vertical, 4)
                    } else {
                        ForEach(socketClient.messages) { msg in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(msg.role.uppercased())
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                                Text(msg.text)
                                    .font(.system(.body, design: msg.role == "assistant" ? .monospaced : .default))
                                    .textSelection(.enabled)
                            }
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(nsColor: .textBackgroundColor))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                    }
                }
            }
            .frame(minHeight: 200, maxHeight: 280)

            HStack(spacing: 8) {
                TextField("Ví dụ: mở Safari và tìm giá cổ phiếu FPT", text: $promptText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)

                Button("Send") {
                    sendPromptFromSelectedSession()
                }
                .disabled(promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var historyCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Session History")
                    .font(.title3.weight(.semibold))
                Spacer()
                Button("Refresh") { socketClient.queryHistory(limit: 30) }
            }

            if socketClient.historyEntries.isEmpty {
                Text("No history yet")
                    .foregroundColor(.secondary)
            } else {
                ForEach(socketClient.historyEntries.prefix(12)) { entry in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(entry.goal)
                                .lineLimit(1)
                            Spacer()
                            Text(entry.status)
                                .font(.caption)
                                .foregroundColor(entry.status == "complete" ? .green : .orange)
                        }
                        Text("\(entry.intentType) • \(entry.durationMs)ms")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 2)
                    .onTapGesture {
                        promptText = entry.goal
                    }
                }
            }
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var networkCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Network")
                .font(.title3.weight(.semibold))

            if networkMonitor.lanIPs.isEmpty {
                Text("No LAN interfaces available")
                    .foregroundColor(.secondary)
            } else {
                ForEach(Array(networkMonitor.lanIPs.enumerated()), id: \.offset) { _, item in
                    Text("\(item.interface): \(item.ip):\(networkMonitor.httpPort)")
                        .font(.system(.body, design: .monospaced))
                        .foregroundColor(.secondary)
                }
            }

            HStack(spacing: 8) {
                Label(networkMonitor.isTailscaleOnline ? "Tailscale Online" : "Tailscale Offline", systemImage: networkMonitor.isTailscaleOnline ? "checkmark.shield.fill" : "xmark.shield")
                if let tsIP = networkMonitor.tailscaleIP {
                    Text(tsIP)
                        .font(.system(.body, design: .monospaced))
                }
            }
            .foregroundColor(.secondary)
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var devicesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Phone Pairing")
                .font(.title3.weight(.semibold))

            HStack(spacing: 10) {
                if let pin = deviceManager.currentPIN {
                    Text(pin)
                        .font(.system(size: 22, weight: .bold, design: .monospaced))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.accentColor.opacity(0.14))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                } else if deviceManager.isLoadingPIN {
                    ProgressView()
                } else {
                    Text("PIN unavailable")
                        .foregroundColor(.secondary)
                }

                if let expiry = deviceManager.pinExpiresAt {
                    Text("Expires: \(expiry.formatted(date: .omitted, time: .shortened))")
                        .foregroundColor(.secondary)
                }

                Spacer()
            }

            if !deviceManager.devices.isEmpty {
                Picker("Device", selection: $selectedDeviceID) {
                    Text("Select device").tag(Optional<String>.none)
                    ForEach(deviceManager.devices) { device in
                        Text(device.deviceName).tag(Optional(device.id))
                    }
                }
                .pickerStyle(.menu)
            }

            HStack(spacing: 10) {
                Button("Generate PIN") { Task { await deviceManager.generatePIN() } }
                Button("Refresh Devices") { Task { await deviceManager.fetchDevices() } }
                Button("Revoke Selected") {
                    guard let id = selectedDeviceID else { return }
                    Task {
                        await deviceManager.revokeDevice(id: id)
                        await deviceManager.fetchDevices()
                    }
                }
                .disabled(selectedDeviceID == nil)
            }
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func createSession() {
        let id = "session-\(Int(Date().timeIntervalSince1970))"
        sessions.append(
            NativeConversation(
                id: id,
                title: "Session \(sessions.count + 1)",
                provider: socketClient.runtimeProvider,
                model: socketClient.runtimeModel,
                memorySummary: "",
                memoryLog: []
            )
        )
        selectedConversationID = id
    }

    private func applyRuntimeForSelectedSession() {
        guard let idx = selectedSessionIndex else { return }
        let provider = sessions[idx].provider.trimmingCharacters(in: .whitespacesAndNewlines)
        let model = sessions[idx].model.trimmingCharacters(in: .whitespacesAndNewlines)
        if !provider.isEmpty { socketClient.setRuntimeConfig(key: "provider", value: provider) }
        if !model.isEmpty { socketClient.setRuntimeConfig(key: "model", value: model) }
    }

    private func sendPromptFromSelectedSession() {
        let text = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        applyRuntimeForSelectedSession()

        var goal = text
        if let idx = selectedSessionIndex {
            let session = sessions[idx]
            goal = buildGoalWithMemory(goal: text, session: session)
            sessions[idx].memoryLog.insert("USER: \(text)", at: 0)
            sessions[idx].memoryLog = Array(sessions[idx].memoryLog.prefix(40))
            sessions[idx].memorySummary = summarizeMemory(for: sessions[idx])
        }

        socketClient.sendTask(goal: goal)
        promptText = ""
        syncAllMemoryToBackend()
    }

    private func buildGoalWithMemory(goal: String, session: NativeConversation) -> String {
        let summary = session.memorySummary.isEmpty ? "(empty)" : session.memorySummary
        let shared = sharedMemorySummary.isEmpty ? "(empty)" : sharedMemorySummary
        return """
        [Native Session Context]
        sessionId: \(session.id)
        sessionName: \(session.title)
        sharedMemorySummary: \(shared)
        sessionMemorySummary: \(summary)

        [User Goal]
        \(goal)
        """
    }

    private func summarizeMemory(for session: NativeConversation) -> String {
        let recent = session.memoryLog.prefix(6).joined(separator: " | ")
        return recent.isEmpty ? "No memory yet" : recent
    }

    private func mergeMemoryFromBackend(_ map: [String: NativeSessionMemoryState]) {
        guard !map.isEmpty else { return }

        for (conversationId, state) in map {
            if let idx = sessions.firstIndex(where: { $0.id == conversationId }) {
                sessions[idx].memorySummary = state.memorySummary
                sessions[idx].memoryLog = state.memoryLog
                if let provider = state.provider, !provider.isEmpty { sessions[idx].provider = provider }
                if let model = state.model, !model.isEmpty { sessions[idx].model = model }
            } else {
                sessions.append(
                    NativeConversation(
                        id: conversationId,
                        title: "Session \(conversationId.prefix(6))",
                        provider: state.provider ?? "",
                        model: state.model ?? "",
                        memorySummary: state.memorySummary,
                        memoryLog: state.memoryLog
                    )
                )
            }
        }

        if selectedConversationID == nil {
            selectedConversationID = sessions.first?.id
        }
    }

    private func syncAllMemoryToBackend() {
        let mapped = Dictionary(uniqueKeysWithValues: sessions.map { session in
            (
                session.id,
                NativeSessionMemoryState(
                    memorySummary: session.memorySummary,
                    memoryLog: session.memoryLog,
                    provider: session.provider,
                    model: session.model,
                    updatedAt: Date().timeIntervalSince1970 * 1000
                )
            )
        })

        socketClient.syncClaudeMem(
            sharedSummary: sharedMemorySummary,
            sharedLog: sessions.flatMap { $0.memoryLog.prefix(2) },
            sessionStateByConversation: mapped
        )
    }

    private func summaryLine(for session: NativeConversation) -> String {
        let providerModel: String
        if session.provider.isEmpty && session.model.isEmpty {
            providerModel = "default runtime"
        } else {
            providerModel = "\(session.provider.isEmpty ? "default" : session.provider)/\(session.model.isEmpty ? "default" : session.model)"
        }
        return "\(providerModel) • \(session.memoryLog.count) entries"
    }
}
