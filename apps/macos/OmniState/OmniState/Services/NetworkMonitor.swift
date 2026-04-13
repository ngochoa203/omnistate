import Foundation
import Combine

class NetworkMonitor: ObservableObject {
    static let shared = NetworkMonitor()

    @Published var lanIPs: [(ip: String, interface: String)] = []
    @Published var tailscaleIP: String?
    @Published var tailscaleHostname: String?
    @Published var tailscaleMagicDNS: String?
    @Published var isTailscaleOnline: Bool = false
    @Published var gatewayPort: Int = 19800
    @Published var httpPort: Int = 19801

    private var timer: Timer?
    private let baseURL = "http://127.0.0.1:19801"
    private let interval: TimeInterval = 30.0

    private init() {}

    func startMonitoring() {
        fetch()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            self?.fetch()
        }
    }

    func stopMonitoring() {
        timer?.invalidate()
        timer = nil
    }

    func fetch() {
        guard let url = URL(string: "\(baseURL)/api/network/info") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 5.0

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self,
                  let data = data,
                  let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return }

            DispatchQueue.main.async {
                // LAN IPs
                if let lanArray = json["lan"] as? [[String: Any]] {
                    self.lanIPs = lanArray.compactMap { entry in
                        guard let ip = entry["ip"] as? String,
                              let iface = entry["interface"] as? String
                        else { return nil }
                        return (ip: ip, interface: iface)
                    }
                }

                // Tailscale
                if let ts = json["tailscale"] as? [String: Any] {
                    let running = ts["running"] as? Bool ?? false
                    let online  = ts["online"]  as? Bool ?? false
                    self.isTailscaleOnline  = running && online
                    self.tailscaleIP        = ts["ip"]       as? String
                    self.tailscaleHostname  = ts["hostname"] as? String
                    self.tailscaleMagicDNS  = ts["magicDns"] as? String
                }

                // Ports
                if let gp = json["gatewayPort"] as? Int { self.gatewayPort = gp }
                if let hp = json["httpPort"]    as? Int { self.httpPort    = hp }
            }
        }.resume()
    }
}
