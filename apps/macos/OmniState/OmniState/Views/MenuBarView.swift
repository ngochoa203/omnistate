import SwiftUI

struct MenuBarView: View {
    @EnvironmentObject var gatewayManager: GatewayManager
    @EnvironmentObject var healthChecker: HealthChecker
    @EnvironmentObject var networkMonitor: NetworkMonitor
    @EnvironmentObject var deviceManager: DeviceManager

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // ── Gateway status ──────────────────────────────────────────
            statusHeader

            Divider().padding(.vertical, 4)

            // ── Network section ─────────────────────────────────────────
            networkSection

            Divider().padding(.vertical, 4)

            // ── Remote Access section ───────────────────────────────────
            remoteAccessSection

            Divider().padding(.vertical, 4)

            // ── Paired Devices section ──────────────────────────────────
            pairedDevicesSection

            Divider().padding(.vertical, 4)

            // ── Actions ─────────────────────────────────────────────────
            actionsSection
        }
        .padding(10)
        .frame(minWidth: 300)
    }

    // MARK: - Status header

    private var statusHeader: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Circle()
                    .fill(healthChecker.isHealthy ? Color.green : Color.red)
                    .frame(width: 8, height: 8)
                Text(healthChecker.isHealthy ? "Gateway Running" : "Gateway Offline")
                    .font(.headline)
            }
            if let uptime = healthChecker.uptime {
                Text("Uptime: \(formatUptime(uptime))")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            if let connections = healthChecker.connections {
                Text("Connections: \(connections)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Network

    private var networkSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("NETWORK")
                .font(.caption2)
                .fontWeight(.semibold)
                .foregroundColor(.secondary)

            // LAN IPs
            if networkMonitor.lanIPs.isEmpty {
                menuRow(label: "LAN IP", value: "—", valueColor: .secondary)
            } else {
                ForEach(networkMonitor.lanIPs, id: \.ip) { entry in
                    menuRow(label: "LAN (\(entry.interface))", value: entry.ip)
                }
            }

            // Tailscale
            if networkMonitor.isTailscaleOnline, let tsIP = networkMonitor.tailscaleIP {
                HStack {
                    Text("Tailscale")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Spacer()
                    Text(tsIP)
                        .font(.system(.caption, design: .monospaced))
                    Text("✅")
                        .font(.caption)
                }
            } else {
                HStack {
                    Text("Tailscale")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Spacer()
                    Text("Not connected")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text("⚠️")
                        .font(.caption)
                }
            }

            // MagicDNS (copyable)
            if let magic = networkMonitor.tailscaleMagicDNS {
                HStack {
                    Text("MagicDNS")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Spacer()
                    Button(action: { copyToPasteboard(magic) }) {
                        HStack(spacing: 3) {
                            Text(magic)
                                .font(.system(.caption, design: .monospaced))
                            Image(systemName: "doc.on.doc")
                                .font(.system(size: 9))
                                .foregroundColor(.accentColor)
                        }
                    }
                    .buttonStyle(.plain)
                    .help("Copy to clipboard")
                }
            }
        }
    }

    // MARK: - Remote Access

    private var remoteAccessSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("REMOTE ACCESS")
                .font(.caption2)
                .fontWeight(.semibold)
                .foregroundColor(.secondary)

            // Current PIN
            if let pin = deviceManager.currentPIN {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("LAN PIN")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        HStack(spacing: 4) {
                            Text(formattedPIN(pin))
                                .font(.system(.body, design: .monospaced))
                                .fontWeight(.bold)
                            Button(action: { copyToPasteboard(pin) }) {
                                Image(systemName: "doc.on.doc")
                                    .font(.system(size: 10))
                                    .foregroundColor(.accentColor)
                            }
                            .buttonStyle(.plain)
                        }
                        if let expiry = deviceManager.pinExpiresAt {
                            Text("Expires \(pinExpiryLabel(expiry))")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                    Spacer()
                }
            } else {
                Text("No active PIN")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            // Generate / Refresh PIN button
            Button(action: {
                Task { await deviceManager.generatePIN() }
            }) {
                HStack(spacing: 4) {
                    if deviceManager.isLoadingPIN {
                        ProgressView().scaleEffect(0.6).frame(width: 12, height: 12)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 10))
                    }
                    Text(deviceManager.currentPIN == nil ? "Generate PIN" : "New PIN")
                        .font(.caption)
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(deviceManager.isLoadingPIN)
        }
    }

    // MARK: - Paired Devices

    private var pairedDevicesSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("PAIRED DEVICES")
                    .font(.caption2)
                    .fontWeight(.semibold)
                    .foregroundColor(.secondary)
                Spacer()
                Button(action: {
                    Task { await deviceManager.fetchDevices() }
                }) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 9))
                        .foregroundColor(.accentColor)
                }
                .buttonStyle(.plain)
                .help("Refresh devices")
            }

            if deviceManager.isLoadingDevices {
                HStack {
                    ProgressView().scaleEffect(0.7)
                    Text("Loading…").font(.caption).foregroundColor(.secondary)
                }
            } else if deviceManager.devices.isEmpty {
                Text("No paired devices")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                ForEach(deviceManager.devices) { device in
                    DeviceRow(device: device) {
                        Task { await deviceManager.revokeDevice(id: device.id) }
                    }
                }
            }
        }
    }

    // MARK: - Actions

    private var actionsSection: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button(gatewayManager.isRunning ? "Restart Gateway" : "Start Gateway") {
                if gatewayManager.isRunning {
                    gatewayManager.stop()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        gatewayManager.start()
                    }
                } else {
                    gatewayManager.start()
                }
            }

            Button("Open Dashboard") {
                NSApp.activate(ignoringOtherApps: true)
                if let window = NSApp.windows.first(where: { $0.isVisible || $0.isMiniaturized }) {
                    window.makeKeyAndOrderFront(nil)
                }
            }
            .keyboardShortcut("o", modifiers: [.command, .shift])

            Divider().padding(.vertical, 2)

            Button("Quit OmniState") {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q")
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func menuRow(label: String, value: String, valueColor: Color = .primary) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(valueColor)
        }
    }

    private func formatUptime(_ seconds: Double) -> String {
        let hours = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        return "\(minutes)m"
    }

    private func formattedPIN(_ pin: String) -> String {
        // Insert a space in the middle for readability: "123 456"
        guard pin.count == 6 else { return pin }
        let mid = pin.index(pin.startIndex, offsetBy: 3)
        return "\(pin[..<mid]) \(pin[mid...])"
    }

    private func pinExpiryLabel(_ date: Date) -> String {
        let remaining = date.timeIntervalSinceNow
        if remaining <= 0 { return "soon" }
        let minutes = Int(remaining / 60)
        return "in \(minutes)m"
    }

    private func copyToPasteboard(_ string: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(string, forType: .string)
    }
}

// MARK: - DeviceRow

struct DeviceRow: View {
    let device: PairedDevice
    let onRevoke: () -> Void

    @State private var showRevokeConfirm = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: device.systemIcon)
                .font(.system(size: 13))
                .foregroundColor(.accentColor)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 1) {
                Text(device.deviceName)
                    .font(.caption)
                    .lineLimit(1)
                Text(device.lastSeenRelative)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Spacer()

            Button(action: { showRevokeConfirm = true }) {
                Image(systemName: "xmark.circle")
                    .font(.system(size: 12))
                    .foregroundColor(.red.opacity(0.7))
            }
            .buttonStyle(.plain)
            .help("Revoke \(device.deviceName)")
            .confirmationDialog(
                "Revoke \(device.deviceName)?",
                isPresented: $showRevokeConfirm,
                titleVisibility: .visible
            ) {
                Button("Revoke", role: .destructive) { onRevoke() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This device will no longer be able to access OmniState.")
            }
        }
        .padding(.vertical, 2)
    }
}
