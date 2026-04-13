import UserNotifications

class NotificationBridge {
    static let shared = NotificationBridge()

    private init() {}

    func send(title: String, body: String, identifier: String? = nil) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let id = identifier ?? UUID().uuidString
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)

        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                print("[OmniState] Notification error: \(error)")
            }
        }
    }

    func sendTaskComplete(taskId: String, result: String) {
        send(
            title: "Task Complete",
            body: result.prefix(200).description,
            identifier: "task-\(taskId)"
        )
    }

    func sendGatewayStatus(isRunning: Bool) {
        send(
            title: "OmniState Gateway",
            body: isRunning ? "Gateway is now running" : "Gateway has stopped",
            identifier: "gateway-status"
        )
    }
}
