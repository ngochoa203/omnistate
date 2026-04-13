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

@MainActor
final class GatewaySocketClient: ObservableObject {
    static let shared = GatewaySocketClient()

    @Published var isConnected = false
    @Published var messages: [NativeChatMessage] = []
    @Published var currentTaskId: String?
    @Published var historyEntries: [NativeHistoryEntry] = []
    @Published var runtimeProvider = ""
    @Published var runtimeModel = ""
    @Published var sharedMemorySummary = ""
    @Published var sharedMemoryLog: [String] = []
    @Published var sessionMemoryByConversation: [String: NativeSessionMemoryState] = [:]
    @Published var lastClaudeMemSyncMessage = ""

    private var socket: URLSessionWebSocketTask?
    private let url = URL(string: "ws://127.0.0.1:19800")!
    private var hasConnected = false

    private init() {}

    func connect() {
        if hasConnected { return }
        hasConnected = true

        let session = URLSession(configuration: .default)
        socket = session.webSocketTask(with: url)
        socket?.resume()

        sendRaw([
            "type": "connect",
            "auth": [:],
            "role": "ui"
        ])

        queryHistory(limit: 30)
        queryRuntimeConfig()
        queryClaudeMem()

        receiveLoop()
    }

    func disconnect() {
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        hasConnected = false
        isConnected = false
    }

    func sendTask(goal: String) {
        let trimmed = goal.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

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

    private func receiveLoop() {
        socket?.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .failure(let error):
                Task { @MainActor in
                    self.isConnected = false
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

        case "task.accepted":
            currentTaskId = json["taskId"] as? String
            let goal = json["goal"] as? String ?? ""
            messages.append(NativeChatMessage(role: "assistant", text: "Task accepted: \(goal)"))

        case "task.step":
            let step = json["step"] as? Int ?? -1
            let status = json["status"] as? String ?? "executing"
            messages.append(NativeChatMessage(role: "assistant", text: "Step \(step): \(status)"))

        case "task.complete":
            currentTaskId = nil
            if let result = json["result"] {
                let pretty = prettyJSON(result) ?? "Task completed"
                messages.append(NativeChatMessage(role: "assistant", text: pretty))
            } else {
                messages.append(NativeChatMessage(role: "assistant", text: "Task completed"))
            }
            queryHistory(limit: 30)

        case "task.error":
            currentTaskId = nil
            let error = json["error"] as? String ?? "Unknown error"
            messages.append(NativeChatMessage(role: "system", text: "Task error: \(error)"))

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

        case "runtime.config.report":
            if let config = json["config"] as? [String: Any] {
                if let provider = config["provider"] as? String {
                    runtimeProvider = provider
                }
                if let model = config["model"] as? String {
                    runtimeModel = model
                }
            }

        case "claude.mem.state":
            if let payload = json["payload"] as? [String: Any] {
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

    private func prettyJSON(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted]),
              let str = String(data: data, encoding: .utf8) else {
            return nil
        }
        return str
    }
}
