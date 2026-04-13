import Foundation
import Combine

struct NativeChatMessage: Identifiable {
    let id = UUID()
    let role: String
    let text: String
    let timestamp = Date()
}

@MainActor
final class GatewaySocketClient: ObservableObject {
    static let shared = GatewaySocketClient()

    @Published var isConnected = false
    @Published var messages: [NativeChatMessage] = []
    @Published var currentTaskId: String?

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

        case "task.error":
            currentTaskId = nil
            let error = json["error"] as? String ?? "Unknown error"
            messages.append(NativeChatMessage(role: "system", text: "Task error: \(error)"))

        case "error":
            let error = json["message"] as? String ?? "Unknown error"
            messages.append(NativeChatMessage(role: "system", text: error))

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
