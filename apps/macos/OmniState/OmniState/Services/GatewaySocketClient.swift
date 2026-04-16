import Foundation
import Combine

struct NativeChatMessage: Identifiable {
    let id = UUID()
    let role: String
    let text: String
    let timestamp = Date()
}

struct NativeTaskAttachment: Equatable {
    let id: String
    let name: String
    let mimeType: String
    let size: Int
    let kind: String
    let textPreview: String?
    let dataBase64: String?

    func toPayload() -> [String: Any] {
        var payload: [String: Any] = [
            "id": id,
            "name": name,
            "mimeType": mimeType,
            "size": size,
            "kind": kind
        ]
        if let textPreview, !textPreview.isEmpty {
            payload["textPreview"] = textPreview
        }
        if let dataBase64, !dataBase64.isEmpty {
            payload["dataBase64"] = dataBase64
        }
        return payload
    }
}

struct NativeHistoryEntry: Identifiable {
    let taskId: String
    let goal: String
    let status: String
    let output: String?
    let intentType: String
    let timestamp: String
    let durationMs: Int

    var id: String { taskId }
}

struct NativeSessionMemoryState: Equatable {
    var memorySummary: String
    var memoryLog: [String]
    var provider: String?
    var model: String?
    var updatedAt: Double?
}

struct RuntimeProviderOption: Identifiable, Equatable {
    let id: String
    let label: String
    let baseURL: String?
    let kind: String?
    let apiKey: String?
    let models: [String]
    let enabled: Bool

    var identity: String { id }
}

struct RuntimeSessionMeta: Identifiable, Equatable {
    let id: String
    let name: String
    let messageCount: Int
    let updatedAt: String
}

// MARK: - Health Data

struct NativeSensorData: Identifiable, Equatable {
    let name: String
    let status: String
    let value: Double
    let unit: String
    let message: String?

    var id: String { name }
    var isOk: Bool { status == "ok" }
    var isWarning: Bool { status == "warning" }
    var isCritical: Bool { status == "critical" }
}

struct NativeHealthAlert: Identifiable, Equatable {
    let id = UUID()
    let sensor: String
    let severity: String
    let message: String
}

struct NativeHealthReport: Equatable {
    let overall: String
    let timestamp: String
    let sensors: [NativeSensorData]
    let alerts: [NativeHealthAlert]
}

// MARK: - System Info

struct NativeSystemInfo: Equatable {
    var hostname: String = "unknown"
    var batteryPercent: Int?
    var batteryCharging: Bool = false
    var wifiSSID: String?
    var wifiConnected: Bool = false
    var wifiIP: String?
    var diskTotal: String?
    var diskUsed: String?
    var diskAvailable: String?
    var diskUsePercent: String?
    var cpuLoadAvg: String?
    var memoryTotalMB: Int?
    var memoryFreeMB: Int?
}

// MARK: - LLM Preflight

struct NativeLlmPreflight: Equatable {
    let ok: Bool
    let status: String
    let message: String
    let providerId: String?
    let model: String?
    let baseURL: String?
    let checkedAt: String?
}

// MARK: - GatewaySocketClient

@MainActor
final class GatewaySocketClient: ObservableObject {
    static let shared = GatewaySocketClient()

    @Published var isConnected = false
    @Published var messages: [NativeChatMessage] = []
    @Published var currentTaskId: String?
    @Published var historyEntries: [NativeHistoryEntry] = []
    @Published var runtimeProvider = ""
    @Published var runtimeModel = ""
    @Published var runtimeProviderOptions: [RuntimeProviderOption] = []
    @Published var runtimeModelOptions: [String] = []
    @Published var voiceLowLatency = true
    @Published var voiceAutoExecute = true
    @Published var voiceWakeEnabled = false
    @Published var voiceWakePhrase = ""
    @Published var voiceWakeCooldownMs = 1200
    @Published var voiceWakeCommandWindowSec = 16
    @Published var voiceSiriEnabled = false
    @Published var voiceSiriMode = "hybrid"
    @Published var voiceSiriShortcutName = ""
    @Published var voiceSiriEndpoint = ""
    @Published var voiceSiriToken = ""
    @Published var runtimeSessions: [RuntimeSessionMeta] = []
    @Published var runtimeCurrentSessionId = "default"
    @Published var sharedMemorySummary = ""
    @Published var sharedMemoryLog: [String] = []
    @Published var sessionMemoryByConversation: [String: NativeSessionMemoryState] = [:]
    @Published var lastClaudeMemSyncMessage = ""
    @Published var activeConversationIdForLatestMessage: String?

    // Real health data
    @Published var healthReport: NativeHealthReport?
    // Real system data
    @Published var systemInfo: NativeSystemInfo?
    // LLM preflight
    @Published var llmPreflight: NativeLlmPreflight?

    private var socket: URLSessionWebSocketTask?
    private let url = URL(string: "ws://127.0.0.1:19800")!
    private var hasConnected = false
    private var reconnectTask: Task<Void, Never>?
    private var connectHandshakeTask: Task<Void, Never>?
    private var pendingConversationId: String?
    private var taskConversationMap: [String: String] = [:]

    private var runtimeConfigPath: String {
        NSHomeDirectory() + "/.omnistate/llm.runtime.json"
    }

    private init() {
        runtimeProviderOptions = defaultRuntimeProviderOptions()
        runtimeProvider = runtimeProviderOptions.first?.id ?? ""
        runtimeModel = runtimeProviderOptions.first?.models.first ?? ""
        runtimeModelOptions = runtimeProviderOptions.first?.models ?? []
        bootstrapRuntimeStateFromDisk()
    }

    func connect() {
        if hasConnected && isConnected { return }

        reconnectTask?.cancel()
        reconnectTask = nil
        connectHandshakeTask?.cancel()
        connectHandshakeTask = nil

        if socket != nil && !isConnected {
            socket?.cancel(with: .goingAway, reason: nil)
            socket = nil
        }

        hasConnected = true

        let session = URLSession(configuration: .default)
        socket = session.webSocketTask(with: url)
        socket?.resume()
        guard let activeSocket = socket else { return }

        receiveLoop(for: activeSocket)
        beginConnectHandshake(for: activeSocket)
    }

    func disconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        connectHandshakeTask?.cancel()
        connectHandshakeTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        hasConnected = false
        isConnected = false
    }

    func sendTask(
        goal: String,
        conversationId: String? = nil,
        routeMode: String = "auto",
        attachments: [NativeTaskAttachment] = []
    ) {
        let trimmed = goal.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        pendingConversationId = conversationId
        activeConversationIdForLatestMessage = conversationId
        let userText: String
        if attachments.isEmpty {
            userText = trimmed
        } else {
            let list = attachments.prefix(8).map { "- \($0.name) [\($0.kind)]" }.joined(separator: "\n")
            userText = "\(trimmed)\n\n[Attachments]\n\(list)"
        }
        messages.append(NativeChatMessage(role: "user", text: userText))
        var payload: [String: Any] = [
            "type": "task",
            "goal": trimmed,
            "mode": routeMode
        ]

        if !attachments.isEmpty {
            payload["attachments"] = attachments.prefix(8).map { $0.toPayload() }
        }

        sendRaw(payload)
    }

    func queryHistory(limit: Int = 30) {
        sendRaw([
            "type": "history.query",
            "limit": max(1, limit)
        ])
    }

    func queryRuntimeConfig() {
        sendRaw([
            "type": "runtime.config.get"
        ])
    }

    func setRuntimeConfig(key: String, value: Any) {
        sendRaw([
            "type": "runtime.config.set",
            "key": key,
            "value": value
        ])
    }

    func upsertRuntimeProvider(
        id: String,
        kind: String,
        baseURL: String,
        apiKey: String,
        model: String,
        models: [String],
        activate: Bool,
        addToFallback: Bool
    ) {
        let normalizedKind = kind == "anthropic" ? "anthropic" : "openai-compatible"
        let trimmedModels = models.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        sendRaw([
            "type": "runtime.config.upsertProvider",
            "provider": [
                "id": id,
                "kind": normalizedKind,
                "baseURL": baseURL,
                "apiKey": apiKey,
                "model": model,
                "models": trimmedModels,
                "enabled": true
            ],
            "activate": activate,
            "addToFallback": addToFallback
        ])
    }

    func queryClaudeMem() {
        sendRaw([
            "type": "claude.mem.query"
        ])
    }

    func requestGatewayShutdown() {
        sendRaw([
            "type": "admin.shutdown"
        ])
    }

    // MARK: - Health & System queries

    func queryHealth() {
        sendRaw(["type": "health.query"])
    }

    func querySystemDashboard() {
        let msgId = "sys-\(Int(Date().timeIntervalSince1970 * 1000))"
        sendRaw(["type": "system.dashboard", "id": msgId])
    }

    func queryLlmPreflight() {
        sendRaw(["type": "llm.preflight.query"])
    }

    // MARK: - Session management

    func deleteSession(id: String) {
        setRuntimeConfig(key: "session.delete", value: id)
    }

    func createSession(name: String) {
        setRuntimeConfig(key: "session.create", value: name)
    }

    func switchSession(id: String) {
        setRuntimeConfig(key: "session.switch", value: id)
    }

    // MARK: - Memory sync

    func syncClaudeMem(
        sharedSummary: String,
        sharedLog: [String],
        sessionStateByConversation: [String: NativeSessionMemoryState]
    ) {
        var sessions: [String: Any] = [:]
        for (id, state) in sessionStateByConversation {
            sessions[id] = [
                "memorySummary": state.memorySummary,
                "memoryLog": Array(state.memoryLog.prefix(50)),
                "provider": state.provider ?? "",
                "model": state.model ?? "",
                "updatedAt": state.updatedAt ?? Date().timeIntervalSince1970 * 1000
            ]
        }

        sendRaw([
            "type": "claude.mem.sync",
            "payload": [
                "sharedMemorySummary": sharedSummary,
                "sharedMemoryLog": Array(sharedLog.prefix(100)),
                "sessionStateByConversation": sessions
            ]
        ])
    }

    // MARK: - Raw send

    private func sendRaw(_ payload: [String: Any]) {
        guard let socket else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }

        socket.send(.string(text)) { [weak self] error in
            if let error {
                Task { @MainActor in
                    self?.messages.append(NativeChatMessage(role: "system", text: "Send error: \(error.localizedDescription)"))
                }
            }
        }
    }

    // MARK: - Receive loop

    private func receiveLoop(for socketTask: URLSessionWebSocketTask) {
        socketTask.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .failure(let error):
                Task { @MainActor in
                    guard self.socket === socketTask else { return }
                    self.isConnected = false
                    self.socket = nil
                    self.connectHandshakeTask?.cancel()
                    self.connectHandshakeTask = nil
                    self.messages.append(NativeChatMessage(role: "system", text: "Socket disconnected: \(error.localizedDescription)"))
                    self.scheduleReconnect()
                }
            case .success(let message):
                Task { @MainActor in
                    guard self.socket === socketTask else { return }
                    switch message {
                    case .string(let text):
                        self.handleIncoming(text)
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8) {
                            self.handleIncoming(text)
                        }
                    @unknown default:
                        break
                    }
                    self.receiveLoop(for: socketTask)
                }
            }
        }
    }

    // MARK: - Message handling

    private func handleIncoming(_ raw: String) {
        guard let data = raw.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return
        }

        switch type {
        case "connected":
            isConnected = true
            connectHandshakeTask?.cancel()
            connectHandshakeTask = nil
            messages.append(NativeChatMessage(role: "system", text: "Connected to gateway"))
            queryHistory(limit: 30)
            queryRuntimeConfig()
            queryClaudeMem()
            queryHealth()
            querySystemDashboard()
            queryLlmPreflight()

        case "task.accepted":
            currentTaskId = json["taskId"] as? String
            if let taskId = currentTaskId, let conversationId = pendingConversationId {
                taskConversationMap[taskId] = conversationId
                activeConversationIdForLatestMessage = conversationId
            }
            pendingConversationId = nil
            let goal = json["goal"] as? String ?? ""
            let mode = (json["mode"] as? String ?? json["routeMode"] as? String ?? "auto").lowercased()
            let acceptedLabel: String
            if mode == "chat" {
                acceptedLabel = "💬 Chat request accepted"
            } else if mode == "task" {
                acceptedLabel = "⚡ Task request accepted"
            } else {
                acceptedLabel = "✅ Request accepted"
            }
            let suffix = goal.isEmpty ? "" : ": \(goal)"
            messages.append(NativeChatMessage(role: "system", text: acceptedLabel + suffix))

        case "task.step":
            if let taskId = json["taskId"] as? String,
               let conversationId = taskConversationMap[taskId] {
                activeConversationIdForLatestMessage = conversationId
            } else if let currentTaskId,
                      let conversationId = taskConversationMap[currentTaskId] {
                activeConversationIdForLatestMessage = conversationId
            }
            let step = json["step"] as? Int ?? -1
            let status = json["status"] as? String ?? "executing"
            let layer = json["layer"] as? String ?? ""
            let icon = status == "completed" ? "✓" : status == "failed" ? "✗" : "▸"
            messages.append(NativeChatMessage(role: "assistant", text: "\(icon) Step \(step) [\(layer)] \(status)"))

        case "task.complete":
            if let taskId = json["taskId"] as? String,
               let conversationId = taskConversationMap[taskId] {
                activeConversationIdForLatestMessage = conversationId
                taskConversationMap.removeValue(forKey: taskId)
            } else if let currentTaskId,
                      let conversationId = taskConversationMap[currentTaskId] {
                activeConversationIdForLatestMessage = conversationId
                taskConversationMap.removeValue(forKey: currentTaskId)
            }
            currentTaskId = nil
            if let result = json["result"] {
                let reply = userFacingReplyText(from: result)
                let mode = replyModeMarker(from: result)
                let decorated = mode == nil ? reply : "[[mode:\(mode!)]] \(reply)"
                messages.append(NativeChatMessage(role: "assistant", text: decorated))
            } else {
                messages.append(NativeChatMessage(role: "assistant", text: "Task completed."))
            }
            queryHistory(limit: 30)

        case "task.error":
            if let taskId = json["taskId"] as? String,
               let conversationId = taskConversationMap[taskId] {
                activeConversationIdForLatestMessage = conversationId
                taskConversationMap.removeValue(forKey: taskId)
            } else if let currentTaskId,
                      let conversationId = taskConversationMap[currentTaskId] {
                activeConversationIdForLatestMessage = conversationId
                taskConversationMap.removeValue(forKey: currentTaskId)
            }
            currentTaskId = nil
            let error = json["error"] as? String ?? "Unknown error"
            messages.append(NativeChatMessage(role: "system", text: "❌ Task error: \(error)"))

        case "error":
            let error = json["message"] as? String ?? "Unknown error"
            messages.append(NativeChatMessage(role: "system", text: error))

        case "history.result":
            guard let entries = json["entries"] as? [[String: Any]] else { break }
            historyEntries = entries.map { entry in
                NativeHistoryEntry(
                    taskId: entry["taskId"] as? String ?? UUID().uuidString,
                    goal: entry["goal"] as? String ?? "",
                    status: entry["status"] as? String ?? "unknown",
                    output: entry["output"] as? String,
                    intentType: entry["intentType"] as? String ?? "",
                    timestamp: entry["timestamp"] as? String ?? "",
                    durationMs: entry["durationMs"] as? Int ?? 0
                )
            }

        case "health.report":
            parseHealthReport(json)

        case "system.info":
            parseSystemInfo(json)

        case "llm.preflight.report":
            parseLlmPreflight(json)

        case "runtime.config.report":
            parseRuntimeConfigReport(json)

        case "gateway.shutdown":
            isConnected = false
            messages.append(NativeChatMessage(role: "system", text: "Gateway is shutting down"))

        case "claude.mem.state":
            parseClaudeMemState(json)

        case "claude.mem.ack":
            let ok = json["ok"] as? Bool ?? false
            let message = json["message"] as? String ?? ""
            lastClaudeMemSyncMessage = ok ? "Synced: \(message)" : "Sync failed: \(message)"

        default:
            break
        }

        // Keep transcript bounded
        if messages.count > 300 {
            messages.removeFirst(messages.count - 300)
        }
    }

    // MARK: - Parse helpers

    private func parseHealthReport(_ json: [String: Any]) {
        let overall = json["overall"] as? String ?? "unknown"
        let timestamp = json["timestamp"] as? String ?? ""

        var sensors: [NativeSensorData] = []
        if let sensorsDict = json["sensors"] as? [String: [String: Any]] {
            for (name, data) in sensorsDict {
                sensors.append(NativeSensorData(
                    name: name,
                    status: data["status"] as? String ?? "ok",
                    value: (data["value"] as? Double) ?? Double(data["value"] as? Int ?? 0),
                    unit: data["unit"] as? String ?? "",
                    message: data["message"] as? String
                ))
            }
        }
        sensors.sort { $0.name < $1.name }

        var alerts: [NativeHealthAlert] = []
        if let alertsArray = json["alerts"] as? [[String: Any]] {
            for alertData in alertsArray {
                alerts.append(NativeHealthAlert(
                    sensor: alertData["sensor"] as? String ?? "",
                    severity: alertData["severity"] as? String ?? "warning",
                    message: alertData["message"] as? String ?? ""
                ))
            }
        }

        healthReport = NativeHealthReport(overall: overall, timestamp: timestamp, sensors: sensors, alerts: alerts)
    }

    private func parseSystemInfo(_ json: [String: Any]) {
        guard let data = json["data"] as? [String: Any] else { return }
        var info = NativeSystemInfo()
        info.hostname = data["hostname"] as? String ?? "unknown"

        if let battery = data["battery"] as? [String: Any] {
            if let pctStr = battery["percent"] as? String {
                info.batteryPercent = Int(pctStr.replacingOccurrences(of: "%", with: ""))
            } else if let pctNum = battery["percent"] as? Int {
                info.batteryPercent = pctNum
            } else if let pctNum = battery["percentage"] as? Int {
                info.batteryPercent = pctNum
            }
            info.batteryCharging = battery["charging"] as? Bool ?? false
        }

        if let wifi = data["wifi"] as? [String: Any] {
            info.wifiSSID = wifi["ssid"] as? String
            info.wifiConnected = wifi["connected"] as? Bool ?? false
            info.wifiIP = wifi["ip"] as? String
        }

        if let disk = data["disk"] as? [String: Any] {
            info.diskTotal = disk["total"] as? String
            info.diskUsed = disk["used"] as? String
            info.diskAvailable = disk["available"] as? String
            info.diskUsePercent = disk["usePercent"] as? String
        }

        if let cpu = data["cpu"] as? [String: Any] {
            info.cpuLoadAvg = cpu["loadAvg"] as? String
        }

        if let memory = data["memory"] as? [String: Any] {
            info.memoryTotalMB = memory["totalMB"] as? Int
            info.memoryFreeMB = memory["freeMB"] as? Int
        }

        systemInfo = info
    }

    private func parseLlmPreflight(_ json: [String: Any]) {
        llmPreflight = NativeLlmPreflight(
            ok: json["ok"] as? Bool ?? false,
            status: json["status"] as? String ?? "",
            message: json["message"] as? String ?? "",
            providerId: json["providerId"] as? String,
            model: json["model"] as? String,
            baseURL: json["baseURL"] as? String,
            checkedAt: json["checkedAt"] as? String
        )
    }

    private func parseRuntimeConfigReport(_ json: [String: Any]) {
        guard let config = json["config"] as? [String: Any] else { return }

        if let activeProvider = config["activeProviderId"] as? String {
            runtimeProvider = activeProvider
        }
        if let activeModel = config["activeModel"] as? String {
            runtimeModel = activeModel
        }

        if let providers = config["providers"] as? [[String: Any]] {
            let parsedOptions = providers.compactMap { provider -> RuntimeProviderOption? in
                guard let id = provider["id"] as? String, !id.isEmpty else { return nil }
                let baseURL = provider["baseURL"] as? String
                let kind = provider["kind"] as? String
                let apiKey = provider["apiKey"] as? String
                let model = (provider["model"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                let modelsList: [String]
                if let arr = provider["models"] as? [String] {
                    modelsList = arr.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
                } else if let csv = provider["models"] as? String {
                    modelsList = csv.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
                } else {
                    modelsList = []
                }
                let enabled = provider["enabled"] as? Bool ?? true

                let label: String
                if let baseURL, baseURL.contains("trollllm") {
                    label = "trollLLM"
                } else if id.lowercased().contains("router9") || id.lowercased().contains("9router") || (baseURL?.contains(":20128") == true) {
                    label = "9router"
                } else {
                    label = id
                }

                return RuntimeProviderOption(
                    id: id,
                    label: label,
                    baseURL: baseURL,
                    kind: kind,
                    apiKey: apiKey,
                    models: modelsList.isEmpty ? (model.map { [$0] } ?? []) : modelsList,
                    enabled: enabled
                )
            }

            runtimeProviderOptions = parsedOptions.isEmpty ? defaultRuntimeProviderOptions() : parsedOptions

            if let active = parsedOptions.first(where: { $0.id == runtimeProvider }) {
                runtimeModelOptions = active.models
            } else {
                runtimeModelOptions = Array(Set(runtimeProviderOptions.flatMap { $0.models })).sorted()
            }

            if runtimeModelOptions.isEmpty {
                runtimeModelOptions = [runtimeModel].filter { !$0.isEmpty }
            }

            if runtimeProvider.isEmpty, let first = runtimeProviderOptions.first {
                runtimeProvider = first.id
            }

            if runtimeModel.isEmpty {
                let selectedProvider = runtimeProviderOptions.first(where: { $0.id == runtimeProvider })
                runtimeModel = selectedProvider?.models.first ?? runtimeProviderOptions.first?.models.first ?? runtimeModel
            }

            if runtimeModelOptions.isEmpty, !runtimeModel.isEmpty {
                runtimeModelOptions = [runtimeModel]
            }
        }

        if let voice = config["voice"] as? [String: Any] {
            voiceLowLatency = (voice["lowLatency"] as? Bool) ?? voiceLowLatency
            voiceAutoExecute = (voice["autoExecuteTranscript"] as? Bool) ?? voiceAutoExecute

            if let wake = voice["wake"] as? [String: Any] {
                voiceWakeEnabled = (wake["enabled"] as? Bool) ?? voiceWakeEnabled
                voiceWakePhrase = (wake["phrase"] as? String) ?? voiceWakePhrase
                voiceWakeCooldownMs = (wake["cooldownMs"] as? Int) ?? voiceWakeCooldownMs
                voiceWakeCommandWindowSec = (wake["commandWindowSec"] as? Int) ?? voiceWakeCommandWindowSec
            }

            if let siri = voice["siri"] as? [String: Any] {
                voiceSiriEnabled = (siri["enabled"] as? Bool) ?? voiceSiriEnabled
                voiceSiriMode = (siri["mode"] as? String) ?? voiceSiriMode
                voiceSiriShortcutName = (siri["shortcutName"] as? String) ?? voiceSiriShortcutName
                voiceSiriEndpoint = (siri["endpoint"] as? String) ?? voiceSiriEndpoint
                voiceSiriToken = (siri["token"] as? String) ?? voiceSiriToken
            }
        }

        if let session = config["session"] as? [String: Any] {
            runtimeCurrentSessionId = (session["currentSessionId"] as? String) ?? runtimeCurrentSessionId

            if let sessionsRaw = session["sessions"] as? [[String: Any]] {
                runtimeSessions = sessionsRaw.compactMap { s in
                    guard let id = s["id"] as? String else { return nil }
                    return RuntimeSessionMeta(
                        id: id,
                        name: (s["name"] as? String) ?? id,
                        messageCount: (s["messageCount"] as? Int) ?? 0,
                        updatedAt: (s["updatedAt"] as? String) ?? ""
                    )
                }
            }
        }
    }

    private func scheduleReconnect() {
        guard hasConnected else { return }
        guard reconnectTask == nil else { return }

        reconnectTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: 1_500_000_000)
            } catch {
                return
            }

            guard !Task.isCancelled else { return }

            await MainActor.run {
                guard let self else { return }
                self.reconnectTask = nil
                if self.hasConnected && !self.isConnected {
                    self.connect()
                }
            }
        }
    }

    private func beginConnectHandshake(for socketTask: URLSessionWebSocketTask) {
        connectHandshakeTask?.cancel()

        connectHandshakeTask = Task { [weak self] in
            guard let self else { return }

            for _ in 0..<10 {
                if Task.isCancelled { return }

                await MainActor.run {
                    guard self.socket === socketTask else { return }
                    guard !self.isConnected else { return }
                    self.sendRaw([
                        "type": "connect",
                        "auth": [:],
                        "role": "ui"
                    ])
                }

                do {
                    try await Task.sleep(nanoseconds: 800_000_000)
                } catch {
                    return
                }

                if await MainActor.run(resultType: Bool.self, body: { self.isConnected || self.socket !== socketTask }) {
                    return
                }
            }

            await MainActor.run {
                guard self.socket === socketTask else { return }
                if !self.isConnected {
                    self.messages.append(NativeChatMessage(role: "system", text: "Handshake timeout, reconnecting..."))
                    self.socket?.cancel(with: .goingAway, reason: nil)
                    self.socket = nil
                    self.scheduleReconnect()
                }
            }
        }
    }

    private func bootstrapRuntimeStateFromDisk() {
        guard let data = FileManager.default.contents(atPath: runtimeConfigPath),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        parseRuntimeConfigReport(["config": raw])
    }

    private func defaultRuntimeProviderOptions() -> [RuntimeProviderOption] {
        [
            RuntimeProviderOption(
                id: "anthropic",
                label: "trollLLM",
                baseURL: "https://chat.trollllm.xyz",
                kind: "anthropic",
                apiKey: nil,
                models: ["claude-haiku-4.5", "claude-sonnet-4.6", "claude-opus-4.6"],
                enabled: true
            ),
            RuntimeProviderOption(
                id: "router9",
                label: "9router",
                baseURL: "http://localhost:20128/v1",
                kind: "openai-compatible",
                apiKey: nil,
                models: ["cx/gpt-5.4", "kr/deepseek-3.2", "gh/claude-sonnet-4.6", "gh/gemini-3-flash-preview"],
                enabled: true
            )
        ]
    }

    private func parseClaudeMemState(_ json: [String: Any]) {
        guard let payload = json["payload"] as? [String: Any] else { return }
        sharedMemorySummary = payload["sharedMemorySummary"] as? String ?? ""
        sharedMemoryLog = payload["sharedMemoryLog"] as? [String] ?? []

        var nextState: [String: NativeSessionMemoryState] = [:]
        if let map = payload["sessionStateByConversation"] as? [String: [String: Any]] {
            for (conversationId, rawState) in map {
                nextState[conversationId] = NativeSessionMemoryState(
                    memorySummary: rawState["memorySummary"] as? String ?? "",
                    memoryLog: rawState["memoryLog"] as? [String] ?? [],
                    provider: rawState["provider"] as? String,
                    model: rawState["model"] as? String,
                    updatedAt: rawState["updatedAt"] as? Double
                )
            }
        }
        sessionMemoryByConversation = nextState
    }

    private func prettyJSON(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted]),
              let str = String(data: data, encoding: .utf8) else {
            return nil
        }
        return str
    }

    private func userFacingReplyText(from value: Any) -> String {
        if let text = value as? String {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? "Task completed." : trimmed
        }

        guard let dict = value as? [String: Any] else {
            return prettyJSON(value) ?? "Task completed."
        }

        let candidateKeys = ["reply", "response", "summary", "answer", "final", "finalAnswer", "output", "message", "text"]
        for key in candidateKeys {
            if let candidate = dict[key] as? String {
                let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    return trimmed
                }
            }
        }

        if let result = dict["result"] as? String {
            let trimmed = result.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                return trimmed
            }
        }

        // Planner/internal payloads are not user-facing; return a clean completion line.
        if isInternalPlannerPayload(dict) {
            return "Task completed."
        }

        return prettyJSON(value) ?? "Task completed."
    }

    private func isInternalPlannerPayload(_ dict: [String: Any]) -> Bool {
        let intent = (dict["intentType"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let goal = (dict["goal"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let hasStepData = dict["stepData"] != nil
        let hasInternalContext = goal.contains("[Native Session Context]")
            || goal.contains("sessionMemorySummary")
            || goal.contains("[Reply Preference]")
        return !intent.isEmpty && hasStepData && hasInternalContext
    }

    private func replyModeMarker(from value: Any) -> String? {
        guard let dict = value as? [String: Any] else { return nil }
        if let mode = dict["mode"] as? String {
            let normalized = mode.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if normalized == "chat" || normalized == "task" {
                return normalized
            }
        }
        if let command = dict["command"] as? Bool, command {
            return "task"
        }
        if let intent = dict["intentType"] as? String, !intent.isEmpty {
            return intent == "system-query" ? "chat" : "task"
        }
        return nil
    }
}
