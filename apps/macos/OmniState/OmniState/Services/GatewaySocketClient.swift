import Foundation
import Combine

struct NativeChatMessage: Identifiable {
    let id = UUID()
    let role: String
    let text: String
    let timestamp = Date()
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
    @Published var voiceSiriMode = "command"
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
    private var pendingConversationId: String?
    private var taskConversationMap: [String: String] = [:]

    private init() {}

    func connect() {
        if hasConnected && isConnected { return }

        if socket != nil && !isConnected {
            socket?.cancel(with: .goingAway, reason: nil)
            socket = nil
        }

        hasConnected = true

        let session = URLSession(configuration: .default)
        socket = session.webSocketTask(with: url)
        socket?.resume()

        sendRaw([
            "type": "connect",
            "auth": [:],
            "role": "ui"
        ])

        receiveLoop()
    }

    func disconnect() {
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        hasConnected = false
        isConnected = false
    }

    func sendTask(goal: String, conversationId: String? = nil) {
        let trimmed = goal.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        pendingConversationId = conversationId
        activeConversationIdForLatestMessage = conversationId
        messages.append(NativeChatMessage(role: "user", text: trimmed))
        sendRaw([
            "type": "task",
            "goal": trimmed
        ])
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

    private func receiveLoop() {
        socket?.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .failure(let error):
                Task { @MainActor in
                    self.isConnected = false
                    self.hasConnected = false
                    self.socket = nil
                    self.messages.append(NativeChatMessage(role: "system", text: "Socket disconnected: \(error.localizedDescription)"))
                }
            case .success(let message):
                Task { @MainActor in
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
                    self.receiveLoop()
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
            messages.append(NativeChatMessage(role: "assistant", text: "⚡ Task accepted: \(goal)"))

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
                let pretty = prettyJSON(result) ?? "Task completed"
                messages.append(NativeChatMessage(role: "assistant", text: pretty))
            } else {
                messages.append(NativeChatMessage(role: "assistant", text: "Task completed"))
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
                    models: model.map { [$0] } ?? [],
                    enabled: enabled
                )
            }

            runtimeProviderOptions = parsedOptions

            if let active = parsedOptions.first(where: { $0.id == runtimeProvider }) {
                runtimeModelOptions = active.models
            } else {
                runtimeModelOptions = Array(Set(parsedOptions.flatMap { $0.models })).sorted()
            }

            if runtimeModelOptions.isEmpty {
                runtimeModelOptions = [runtimeModel].filter { !$0.isEmpty }
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
}
