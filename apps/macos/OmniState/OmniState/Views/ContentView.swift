import SwiftUI

struct ContentView: View {
    @EnvironmentObject var gatewayManager: GatewayManager
    @EnvironmentObject var healthChecker: HealthChecker
    @EnvironmentObject var networkMonitor: NetworkMonitor
    @EnvironmentObject var deviceManager: DeviceManager

    @State private var selectedDeviceID: String?

    private var statusColor: Color {
        if !gatewayManager.isRunning {
            return .red
        }
        return healthChecker.isHealthy ? .green : .orange
    }

    private var statusText: String {
        if !gatewayManager.isRunning {
            return "Gateway Stopped"
        }
        return healthChecker.isHealthy ? "Gateway Healthy" : "Gateway Starting"
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selectedDeviceID) {
                Section("Paired Devices") {
                    if deviceManager.devices.isEmpty {
                        Text(deviceManager.isLoadingDevices ? "Loading devices..." : "No paired devices")
                            .foregroundColor(.secondary)
                    } else {
                        ForEach(deviceManager.devices) { device in
                            VStack(alignment: .leading, spacing: 4) {
                                Label(device.deviceName, systemImage: device.systemIcon)
                                Text("Last seen: \(device.lastSeenRelative)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            .tag(device.id)
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("OmniState")
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

                    gatewayCard
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
                }
                .padding(20)
            }
            .navigationTitle("Native Dashboard")
        }
        .task {
            await deviceManager.fetchDevices()
        }
    }

    private var gatewayCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Gateway")
                .font(.title3.weight(.semibold))

            HStack(spacing: 12) {
                Label(gatewayManager.isRunning ? "Running" : "Stopped", systemImage: gatewayManager.isRunning ? "play.circle.fill" : "stop.circle.fill")
                if let uptime = healthChecker.uptime {
                    Text("Uptime: \(formatSeconds(uptime))")
                }
                if let conn = healthChecker.connections {
                    Text("Connections: \(conn)")
                }
                if let pin = gatewayManager.lanPin {
                    Text("LAN PIN: \(pin)")
                        .font(.system(.body, design: .monospaced))
                }
            }
            .foregroundColor(.secondary)

            HStack(spacing: 10) {
                Button("Start") { gatewayManager.start() }
                    .disabled(gatewayManager.isRunning)
                Button("Stop") { gatewayManager.stop() }
                    .disabled(!gatewayManager.isRunning)
                Button("Retry") {
                    gatewayManager.stop()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        gatewayManager.start()
                    }
                }
                Button("Refresh Health") { healthChecker.check() }
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
            Text("Pairing")
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

            HStack(spacing: 10) {
                Button("Generate PIN") {
                    Task { await deviceManager.generatePIN() }
                }
                Button("Refresh Devices") {
                    Task { await deviceManager.fetchDevices() }
                }
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

    private func formatSeconds(_ value: Double) -> String {
        let total = Int(value)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        return String(format: "%02d:%02d:%02d", hours, minutes, seconds)
    }
}
