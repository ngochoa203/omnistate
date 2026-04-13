import Foundation

struct PairedDevice: Identifiable, Codable {
    let id: String
    let deviceName: String
    let deviceType: String
    let lastSeenAt: String?
    let lastSeenIp: String?
    let isRevoked: Bool
    let createdAt: String

    /// SF Symbol name for the device type
    var systemIcon: String {
        switch deviceType.lowercased() {
        case "iphone", "phone":  return "iphone"
        case "ipad":             return "ipad"
        case "mac", "desktop":   return "desktopcomputer"
        case "tv":               return "tv"
        case "watch":            return "applewatch"
        default:                 return "laptopcomputer"
        }
    }

    /// Human-readable relative last-seen string
    var lastSeenRelative: String {
        guard let raw = lastSeenAt else { return "Never" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: raw) ?? {
            formatter.formatOptions = .withInternetDateTime
            return formatter.date(from: raw)
        }()
        guard let date = date else { return "Unknown" }

        let seconds = -date.timeIntervalSinceNow
        switch seconds {
        case ..<60:        return "Just now"
        case ..<3600:      return "\(Int(seconds / 60))m ago"
        case ..<86400:     return "\(Int(seconds / 3600))h ago"
        default:           return "\(Int(seconds / 86400))d ago"
        }
    }
}

struct DevicesResponse: Codable {
    let devices: [PairedDevice]
}

struct PINResponse: Codable {
    let pin: String
    let expiresAt: String
}

class DeviceManager: ObservableObject {
    static let shared = DeviceManager()

    @Published var devices: [PairedDevice] = []
    @Published var currentPIN: String?
    @Published var pinExpiresAt: Date?
    @Published var isLoadingPIN = false
    @Published var isLoadingDevices = false
    @Published var lastError: String?

    private let baseURL = "http://127.0.0.1:19801"
    private var pinRefreshTimer: Timer?
    private let pinRefreshInterval: TimeInterval = 300  // 5 minutes

    private init() {}

    // MARK: - PIN management

    func startPINRefresh() {
        Task { await generatePIN() }
        pinRefreshTimer = Timer.scheduledTimer(withTimeInterval: pinRefreshInterval, repeats: true) { [weak self] _ in
            Task { await self?.generatePIN() }
        }
    }

    func stopPINRefresh() {
        pinRefreshTimer?.invalidate()
        pinRefreshTimer = nil
    }

    func generatePIN() async {
        await MainActor.run { isLoadingPIN = true }
        defer { Task { await MainActor.run { self.isLoadingPIN = false } } }

        guard let url = URL(string: "\(baseURL)/api/lan/generate-pin") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 5.0

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return }
            let result = try JSONDecoder().decode(PINResponse.self, from: data)

            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let expiry = formatter.date(from: result.expiresAt) ?? Date().addingTimeInterval(300)

            await MainActor.run {
                self.currentPIN = result.pin
                self.pinExpiresAt = expiry
            }
        } catch {
            await MainActor.run { self.lastError = error.localizedDescription }
        }
    }

    // MARK: - Device list

    func fetchDevices() async {
        await MainActor.run { isLoadingDevices = true }
        defer { Task { await MainActor.run { self.isLoadingDevices = false } } }

        guard let url = URL(string: "\(baseURL)/api/devices") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 5.0

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return }
            let result = try JSONDecoder().decode(DevicesResponse.self, from: data)
            await MainActor.run { self.devices = result.devices.filter { !$0.isRevoked } }
        } catch {
            await MainActor.run { self.lastError = error.localizedDescription }
        }
    }

    func revokeDevice(id: String) async {
        guard let url = URL(string: "\(baseURL)/api/devices/\(id)") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.timeoutInterval = 5.0

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  http.statusCode == 200 || http.statusCode == 204
            else { return }

            await MainActor.run {
                self.devices.removeAll { $0.id == id }
            }
        } catch {
            await MainActor.run { self.lastError = error.localizedDescription }
        }
    }
}
