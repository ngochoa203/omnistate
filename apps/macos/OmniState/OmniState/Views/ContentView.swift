import SwiftUI

struct NativeConversation: Identifiable, Equatable {
    let id: String
    var title: String
    var provider: String
    var model: String
    var memorySummary: String
    var memoryLog: [String]
}

private enum NativePage: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard"
    case chat = "Chat"
    case connect = "Connect"
    case system = "System"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .dashboard: return "square.grid.2x2"
        case .chat: return "message"
        case .connect: return "iphone.and.arrow.forward"
        case .system: return "cpu"
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var gatewayManager: GatewayManager
    @EnvironmentObject var healthChecker: HealthChecker
    @EnvironmentObject var networkMonitor: NetworkMonitor
    @EnvironmentObject var deviceManager: DeviceManager
    @EnvironmentObject var socketClient: GatewaySocketClient

    @State private var page: NativePage = .chat
    @State private var sessions: [NativeConversation] = [
        NativeConversation(id: "default", title: "Default Session", provider: "", model: "", memorySummary: "", memoryLog: [])
    ]
    @State private var selectedConversationID: String? = "default"
    @State private var selectedDeviceID: String?
    @State private var promptText = ""
    @State private var sharedMemorySummary = ""

    private var selectedSessionIndex: Int? {
        guard let selectedConversationID else { return nil }
        return sessions.firstIndex(where: { $0.id == selectedConversationID })
    }

    private var connectionColor: Color {
        if socketClient.isConnected { return .green }
        return gatewayManager.isRunning ? .orange : .red
    }

    private var connectionLabel: String {
        if socketClient.isConnected { return "Live" }
        return gatewayManager.isRunning ? "Connecting" : "Offline"
    }

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Divider()
            VStack(spacing: 0) {
                topbar
                Divider()
                content
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .task {
            await deviceManager.fetchDevices()
            socketClient.connect()
        }
        .onChange(of: socketClient.sessionMemoryByConversation) { mergeMemoryFromBackend($0) }
        .onChange(of: socketClient.sharedMemorySummary) { sharedMemorySummary = $0 }
        .onChange(of: socketClient.messages.count) { _ in captureLatestSocketMessage() }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text("OmniState").font(.title3.bold())
                Text("Native Agent OS").font(.caption).foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)

            VStack(spacing: 6) {
                ForEach(NativePage.allCases) { item in
                    Button {
                        page = item
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: item.icon).frame(width: 16)
                            Text(item.rawValue)
                            Spacer()
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(page == item ? Color.accentColor.opacity(0.15) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10)

            Spacer()

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Circle().fill(connectionColor).frame(width: 8, height: 8)
                    Text(connectionLabel).font(.caption.weight(.semibold))
                }
                if !socketClient.runtimeProvider.isEmpty || !socketClient.runtimeModel.isEmpty {
                    Text("\(socketClient.runtimeProvider) / \(socketClient.runtimeModel)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Color(nsColor: .controlBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(10)
        }
        .frame(width: 230)
    }

    private var topbar: some View {
        HStack {
            Text(page.rawValue).font(.headline)
            Spacer()
            if let idx = selectedSessionIndex, page == .chat {
                Text(sessions[idx].title).font(.caption).foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.35))
    }

    @ViewBuilder
    private var content: some View {
        switch page {
        case .dashboard:
            dashboardView
        case .chat:
            chatView
        case .connect:
            connectView
        case .system:
            systemView
        }
    }

    private var dashboardView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                card(title: "Gateway") {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Circle().fill(gatewayManager.isRunning ? (healthChecker.isHealthy ? .green : .orange) : .red).frame(width: 8, height: 8)
                            Text(gatewayManager.isRunning ? "Running" : "Stopped")
                            if let conn = healthChecker.connections {
                                Text("• \(conn) connections").foregroundColor(.secondary)
                            }
                            if let uptime = healthChecker.uptime {
                                Text("• Uptime \(formatSeconds(uptime))").foregroundColor(.secondary)
                            }
                        }
                        HStack(spacing: 10) {
                            Button("Start") { gatewayManager.start() }.disabled(gatewayManager.isRunning)
                            Button("Stop") { gatewayManager.stop() }.disabled(!gatewayManager.isRunning)
                            Button("Retry") {
                                gatewayManager.stop()
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { gatewayManager.start() }
                            }
                        }
                    }
                }

                card(title: "Network") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(networkMonitor.lanIPs.enumerated()), id: \.offset) { _, item in
                            Text("\(item.interface): \(item.ip):\(networkMonitor.httpPort)")
                                .font(.system(.body, design: .monospaced))
                                .foregroundColor(.secondary)
                        }
                        HStack {
                            Label(networkMonitor.isTailscaleOnline ? "Tailscale Online" : "Tailscale Offline", systemImage: networkMonitor.isTailscaleOnline ? "checkmark.shield.fill" : "xmark.shield")
                            if let tsIP = networkMonitor.tailscaleIP {
                                Text(tsIP).font(.system(.body, design: .monospaced))
                            }
                        }
                        .foregroundColor(.secondary)
                    }
                }
            }
            .padding(16)
        }
    }

    private var chatView: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                HStack {
                    Text("Sessions").font(.subheadline.bold())
                    Spacer()
                    Button { createSession() } label: { Image(systemName: "plus") }
                        .buttonStyle(.plain)
                }
                .padding(10)

                List(selection: $selectedConversationID) {
                    ForEach(sessions) { session in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.title).lineLimit(1)
                            Text(summaryLine(for: session)).font(.caption2).foregroundColor(.secondary)
                        }
                        .tag(Optional(session.id))
                    }
                }
                .listStyle(.plain)
            }
            .frame(width: 240)
            .background(Color(nsColor: .controlBackgroundColor).opacity(0.4))

            Divider()

            VStack(spacing: 10) {
                if let idx = selectedSessionIndex {
                    HStack(spacing: 8) {
                        TextField("Provider", text: Binding(get: { sessions[idx].provider }, set: { sessions[idx].provider = $0 }))
                            .textFieldStyle(.roundedBorder)

                        TextField("Model", text: Binding(get: { sessions[idx].model }, set: { sessions[idx].model = $0 }))
                            .textFieldStyle(.roundedBorder)

                        Button("Apply") { applyRuntimeForSelectedSession() }
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 10)
                }

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if selectedSessionTranscript.isEmpty {
                            Text("Nhập yêu cầu để bắt đầu.")
                                .foregroundColor(.secondary)
                                .padding(.vertical, 6)
                        }
                        ForEach(Array(selectedSessionTranscript.enumerated()), id: \.offset) { _, line in
                            let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
                            let role = parts.first.map(String.init) ?? "SYSTEM"
                            let text = parts.count > 1 ? String(parts[1]).trimmingCharacters(in: .whitespaces) : line
                            VStack(alignment: .leading, spacing: 4) {
                                Text(role.uppercased())
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                                Text(text)
                                    .textSelection(.enabled)
                                    .font(.system(.body, design: role.lowercased() == "assistant" ? .monospaced : .default))
                            }
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(nsColor: .textBackgroundColor))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 4)
                }

                HStack(spacing: 8) {
                    TextField("Nhập lệnh giống web chat...", text: $promptText, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...4)
                    Button("Send") { sendPromptFromSelectedSession() }
                        .disabled(promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(12)
            }
        }
    }

    private var connectView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                card(title: "Phone Pairing") {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 10) {
                            if let pin = deviceManager.currentPIN {
                                Text(pin)
                                    .font(.system(size: 24, weight: .bold, design: .monospaced))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(Color.accentColor.opacity(0.14))
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            } else if deviceManager.isLoadingPIN {
                                ProgressView()
                            } else {
                                Text("PIN unavailable").foregroundColor(.secondary)
                            }

                            if let expiry = deviceManager.pinExpiresAt {
                                Text("Expires: \(expiry.formatted(date: .omitted, time: .shortened))")
                                    .foregroundColor(.secondary)
                            }
                        }

                        HStack(spacing: 10) {
                            Button("Generate PIN") { Task { await deviceManager.generatePIN() } }
                            Button("Refresh Devices") { Task { await deviceManager.fetchDevices() } }
                        }
                    }
                }

                card(title: "Paired Devices") {
                    if deviceManager.devices.isEmpty {
                        Text("No paired devices").foregroundColor(.secondary)
                    } else {
                        ForEach(deviceManager.devices) { device in
                            HStack {
                                Label(device.deviceName, systemImage: device.systemIcon)
                                Spacer()
                                Text(device.lastSeenRelative).font(.caption).foregroundColor(.secondary)
                            }
                            .padding(.vertical, 3)
                        }

                        Picker("Revoke device", selection: $selectedDeviceID) {
                            Text("Select device").tag(Optional<String>.none)
                            ForEach(deviceManager.devices) { device in
                                Text(device.deviceName).tag(Optional(device.id))
                            }
                        }
                        .pickerStyle(.menu)

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
            }
            .padding(16)
        }
    }

    private var systemView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                card(title: "Shared Memory") {
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Shared summary", text: $sharedMemorySummary, axis: .vertical)
                            .lineLimit(3...8)
                            .textFieldStyle(.roundedBorder)

                        HStack(spacing: 10) {
                            Button("Pull from Backend") { socketClient.queryClaudeMem() }
                            Button("Sync to Backend") { syncAllMemoryToBackend() }
                        }
                    }
                }

                card(title: "Task History") {
                    if socketClient.historyEntries.isEmpty {
                        Text("No history").foregroundColor(.secondary)
                    } else {
                        ForEach(socketClient.historyEntries.prefix(20)) { entry in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(entry.goal).lineLimit(2)
                                Text("\(entry.status) • \(entry.intentType) • \(entry.durationMs)ms")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            }
            .padding(16)
        }
    }

    private func card<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.title3.weight(.semibold))
            content()
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func createSession() {
        let id = "session-\(UUID().uuidString.lowercased())"
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

        let conversationId = selectedSessionIndex.map { sessions[$0].id }
        socketClient.sendTask(goal: goal, conversationId: conversationId)
        promptText = ""
        syncAllMemoryToBackend()
    }

    private var selectedSessionTranscript: [String] {
        guard let idx = selectedSessionIndex else { return [] }
        return Array(sessions[idx].memoryLog.reversed())
    }

    private func captureLatestSocketMessage() {
        guard let last = socketClient.messages.last else { return }
        // User messages are already logged by sendPromptFromSelectedSession().
        if last.role.lowercased() == "user" { return }

        let targetConversationID = socketClient.activeConversationIdForLatestMessage ?? selectedConversationID
        guard let targetConversationID,
              let idx = sessions.firstIndex(where: { $0.id == targetConversationID }) else { return }

        let entry = "\(last.role.uppercased()): \(last.text)"
        if sessions[idx].memoryLog.first != entry {
            sessions[idx].memoryLog.insert(entry, at: 0)
            sessions[idx].memoryLog = Array(sessions[idx].memoryLog.prefix(40))
            sessions[idx].memorySummary = summarizeMemory(for: sessions[idx])
        }
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
        let mapped = sessions.reduce(into: [String: NativeSessionMemoryState]()) { acc, session in
            acc[session.id] = NativeSessionMemoryState(
                memorySummary: session.memorySummary,
                memoryLog: session.memoryLog,
                provider: session.provider,
                model: session.model,
                updatedAt: Date().timeIntervalSince1970 * 1000
            )
        }

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

    private func formatSeconds(_ value: Double) -> String {
        let total = Int(value)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        return String(format: "%02d:%02d:%02d", hours, minutes, seconds)
    }
}
