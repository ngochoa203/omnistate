import Foundation
import Combine

class HealthChecker: ObservableObject {
    static let shared = HealthChecker()

    @Published var isHealthy = false
    @Published var uptime: Double?
    @Published var connections: Int?
    @Published var lastCheck: Date?

    private var timer: Timer?
    private let healthURL = URL(string: "http://127.0.0.1:19801/health")!
    private let interval: TimeInterval = 5.0

    private init() {}

    func startPolling() {
        // Initial check
        check()

        // Periodic polling
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            self?.check()
        }
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    func check() {
        var request = URLRequest(url: healthURL)
        request.timeoutInterval = 3.0

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.lastCheck = Date()

                guard let data = data,
                      let httpResponse = response as? HTTPURLResponse,
                      httpResponse.statusCode == 200,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      json["status"] as? String == "ok" else {
                    self.isHealthy = false
                    self.uptime = nil
                    self.connections = nil
                    return
                }

                self.isHealthy = true
                self.uptime = json["uptime"] as? Double
                self.connections = json["connections"] as? Int
            }
        }.resume()
    }
}
