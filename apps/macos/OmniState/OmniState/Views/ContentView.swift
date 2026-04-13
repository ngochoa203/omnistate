import SwiftUI

// MARK: - Data models

struct NativeConversation: Identifiable, Equatable {
    let id: String
    var title: String
    var provider: String
    var model: String
    var memorySummary: String
    var memoryLog: [String]
}

// MARK: - Page enum

private enum NativePage: String, CaseIterable, Identifiable {
    case dashboard, chat, voice, health, machine, config, screenTree, triggers, settings

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .dashboard: return "square.grid.2x2"
        case .chat: return "message"
        case .voice: return "mic"
        case .health: return "waveform.path.ecg"
        case .machine: return "desktopcomputer"
        case .config: return "slider.horizontal.3"
        case .screenTree: return "point.3.connected.trianglepath.dotted"
        case .triggers: return "bolt"
        case .settings: return "gearshape"
        }
    }
}

// MARK: - Colors

private enum CyberColor {
    static let cyan = Color(red: 0.13, green: 0.83, blue: 0.93)
    static let cyanDim = Color(red: 0.13, green: 0.83, blue: 0.93).opacity(0.55)
    static let blue = Color(red: 0.39, green: 0.40, blue: 0.95)
    static let purple = Color(red: 0.58, green: 0.32, blue: 0.92)
    static let pink = Color(red: 0.96, green: 0.26, blue: 0.48)
    static let orange = Color(red: 0.96, green: 0.62, blue: 0.07)
    static let red = Color(red: 0.95, green: 0.27, blue: 0.33)
    static let green = Color(red: 0.13, green: 0.77, blue: 0.37)
    static let textPrimary = Color.white.opacity(0.93)
    static let textSecondary = Color.white.opacity(0.68)
    static let textMuted = Color.white.opacity(0.42)
    static let glassBg = Color.white.opacity(0.04)
    static let glassBorder = Color.white.opacity(0.08)
    static let glowBorder = Color.cyan.opacity(0.18)
    static let cardBg = Color(red: 0.06, green: 0.06, blue: 0.12).opacity(0.7)
}

// MARK: — Reusable: CyberGauge

private struct CyberGauge: View {
    let value: Double // 0...100
    let tint: Color
    var size: CGFloat = 52
    var lineWidth: CGFloat = 4.5

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.06), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: min(value / 100, 1))
                .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: tint.opacity(0.55), radius: 6)
            Text("\(Int(value))%")
                .font(.system(size: size * 0.22, weight: .heavy, design: .rounded))
                .foregroundColor(tint)
        }
        .frame(width: size, height: size)
    }
}

// MARK: — Reusable: CyberBadge

private struct CyberBadge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.system(size: 9, weight: .heavy, design: .rounded))
            .foregroundColor(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color.opacity(0.15))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(color.opacity(0.35), lineWidth: 0.5))
    }
}

// MARK: — Reusable: GlowCard

private struct GlowCard<Content: View>: View {
    let glowColor: Color
    @ViewBuilder var content: Content

    init(glow: Color = CyberColor.glowBorder, @ViewBuilder content: () -> Content) {
        self.glowColor = glow
        self.content = content()
    }

    var body: some View {
        content
            .padding(14)
            .background(CyberColor.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: [glowColor.opacity(0.5), glowColor.opacity(0.15), glowColor.opacity(0.05)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ), lineWidth: 1
                    )
            )
            .shadow(color: glowColor.opacity(0.12), radius: 14)
    }
}

// MARK: — Reusable: HeroSection

private struct HeroSection: View {
    let icon: String
    let iconColor: Color
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [iconColor.opacity(0.35), iconColor.opacity(0.12)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(iconColor.opacity(0.4), lineWidth: 1)
                    )
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(iconColor)
            }
            .frame(width: 42, height: 42)
            .shadow(color: iconColor.opacity(0.4), radius: 10)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(
                        LinearGradient(colors: [.white, iconColor.opacity(0.8)], startPoint: .leading, endPoint: .trailing)
                    )
                Text(subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(CyberColor.textMuted)
            }
            Spacer()
        }
        .padding(16)
        .background(
            LinearGradient(
                colors: [iconColor.opacity(0.08), Color.clear],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(iconColor.opacity(0.15), lineWidth: 1)
        )
    }
}

// MARK: — Reusable: SectionLabel

private struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .heavy, design: .monospaced))
            .foregroundColor(CyberColor.textMuted)
            .tracking(1.5)
            .padding(.top, 4)
    }
}

// MARK: - ContentView

struct ContentView: View {
    @EnvironmentObject var gatewayManager: GatewayManager
    @EnvironmentObject var healthChecker: HealthChecker
    @EnvironmentObject var networkMonitor: NetworkMonitor
    @EnvironmentObject var deviceManager: DeviceManager
    @EnvironmentObject var socketClient: GatewaySocketClient
    @EnvironmentObject var voiceCaptureService: VoiceCaptureService

    @State private var page: NativePage = .dashboard
    @State private var sessions: [NativeConversation] = [
        NativeConversation(id: "default", title: "Default Session", provider: "", model: "", memorySummary: "", memoryLog: [])
    ]
    @State private var selectedConversationID: String? = "default"
    @State private var selectedDeviceID: String?
    @State private var promptText = ""
    @State private var sharedMemorySummary = ""
    @State private var selectedLanguage = "Tiếng Việt"
    @State private var selectedModel = ""
    @State private var pulseActive = false
    @State private var scanlineOffset: CGFloat = -280
    @State private var voiceMode = 0
    @State private var voiceBarsPhase: Double = 0

    private var selectedSessionIndex: Int? {
        guard let selectedConversationID else { return nil }
        return sessions.firstIndex(where: { $0.id == selectedConversationID })
    }

    private var connectionColor: Color {
        if socketClient.isConnected { return CyberColor.green }
        return gatewayLive ? CyberColor.orange : CyberColor.red
    }

    private var connectionLabel: String {
        if socketClient.isConnected { return "Live" }
        return gatewayLive ? "Connecting" : "Offline"
    }

    private var gatewayLive: Bool {
        gatewayManager.isRunning || healthChecker.isHealthy || socketClient.isConnected
    }

    private var modelOptions: [String] {
        let fromRuntime = socketClient.runtimeModelOptions.filter { !$0.isEmpty }
        if !fromRuntime.isEmpty { return fromRuntime }
        if !socketClient.runtimeModel.isEmpty { return [socketClient.runtimeModel] }
        return []
    }

    private var providerOptions: [RuntimeProviderOption] {
        socketClient.runtimeProviderOptions
    }

    private var runtimeConfigReady: Bool {
        !providerOptions.isEmpty || !modelOptions.isEmpty || !socketClient.runtimeProvider.isEmpty || !socketClient.runtimeModel.isEmpty
    }

    private func providerLabel(for id: String) -> String {
        providerOptions.first(where: { $0.id == id })?.label ?? id
    }

    private var pendingTaskCount: Int {
        (socketClient.currentTaskId == nil ? 0 : 1) +
        socketClient.historyEntries.filter { !["complete", "completed", "success"].contains($0.status.lowercased()) }.count
    }

    private var activeAlertCount: Int {
        var count = 0
        if !networkMonitor.isTailscaleOnline { count += 1 }
        if !gatewayLive || !healthChecker.isHealthy { count += 1 }
        if let h = socketClient.healthReport {
            count += h.alerts.count
        }
        return count
    }

    private var isEnglish: Bool { selectedLanguage == "English" }
    private func tx(_ vi: String, _ en: String) -> String { isEnglish ? en : vi }

    private func pageLabel(_ p: NativePage) -> String {
        switch p {
        case .dashboard: return tx("Tổng quan", "Dashboard")
        case .chat: return tx("AI Chat", "AI Chat")
        case .voice: return tx("Giọng nói", "Voice")
        case .health: return tx("Sức khỏe hệ thống", "System Health")
        case .machine: return tx("Thông tin máy", "Machine Info")
        case .config: return tx("Cấu hình", "Configuration")
        case .screenTree: return tx("Session & Memory", "Session & Memory")
        case .triggers: return tx("Trigger tự động", "Auto Triggers")
        case .settings: return tx("Cài đặt", "Settings")
        }
    }

    // MARK: - Body

    var body: some View {
        ZStack {
            backgroundLayer

            HStack(spacing: 0) {
                sidebar
                Rectangle().fill(Color.white.opacity(0.04)).frame(width: 1)
                VStack(spacing: 0) {
                    topbar
                    Rectangle().fill(Color.white.opacity(0.04)).frame(height: 1)
                    content
                }
            }
        }
        .task {
            await deviceManager.fetchDevices()
            socketClient.connect()
            voiceCaptureService.requestPermissionsIfNeeded()
            healthChecker.startPolling()
            networkMonitor.startMonitoring()
            deviceManager.startPINRefresh()
            if selectedModel.isEmpty {
                selectedModel = socketClient.runtimeModel.isEmpty ? modelOptions.first ?? "" : socketClient.runtimeModel
            }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                await MainActor.run {
                    healthChecker.check()
                    networkMonitor.fetch()
                    socketClient.queryHistory(limit: 30)
                    socketClient.queryRuntimeConfig()
                    socketClient.queryClaudeMem()
                    socketClient.queryHealth()
                    socketClient.querySystemDashboard()
                }
                await deviceManager.fetchDevices()
            }
        }
        .onDisappear {
            healthChecker.stopPolling()
            networkMonitor.stopMonitoring()
            deviceManager.stopPINRefresh()
        }
        .onChange(of: socketClient.sessionMemoryByConversation) { mergeMemoryFromBackend($0) }
        .onChange(of: socketClient.sharedMemorySummary) { sharedMemorySummary = $0 }
        .onChange(of: socketClient.messages.count) { _ in captureLatestSocketMessage() }
        .onAppear {
            pulseActive = false
            scanlineOffset = -280
            withAnimation(.easeInOut(duration: 1.25).repeatForever(autoreverses: true)) { pulseActive = true }
            withAnimation(.linear(duration: 4.2).repeatForever(autoreverses: false)) { scanlineOffset = 1200 }
        }
    }

    // MARK: - Background

    private var backgroundLayer: some View {
        ZStack {
            Color(red: 0.02, green: 0.02, blue: 0.06).ignoresSafeArea()

            // Gradient overlay
            LinearGradient(
                colors: [Color.blue.opacity(0.06), Color.clear, Color.purple.opacity(0.04)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ).ignoresSafeArea()

            // Orbs
            Circle().fill(CyberColor.blue.opacity(0.18)).frame(width: 500, height: 500).blur(radius: 120).offset(x: -280, y: -250)
            Circle().fill(CyberColor.cyan.opacity(0.12)).frame(width: 400, height: 400).blur(radius: 100).offset(x: 280, y: 200)
            Circle().fill(CyberColor.purple.opacity(0.14)).frame(width: 350, height: 350).blur(radius: 90).offset(x: 120, y: -200)

            // Scanline
            GeometryReader { geo in
                Rectangle()
                    .fill(LinearGradient(colors: [Color.clear, CyberColor.cyan.opacity(0.08), Color.clear], startPoint: .top, endPoint: .bottom))
                    .frame(height: 80).blur(radius: 6).offset(y: scanlineOffset).opacity(0.6).allowsHitTesting(false)

                // Grid lines
                VStack(spacing: 3) {
                    ForEach(0..<80, id: \.self) { _ in
                        Rectangle().fill(Color.white.opacity(0.012)).frame(height: 1)
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height, alignment: .top).allowsHitTesting(false)
            }.ignoresSafeArea()
        }
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        VStack(spacing: 0) {
            // Logo
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(LinearGradient(colors: [CyberColor.cyan.opacity(0.3), CyberColor.blue.opacity(0.2)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(CyberColor.cyan)
                }
                .frame(width: 32, height: 32)
                .shadow(color: CyberColor.cyan.opacity(0.3), radius: 8)

                VStack(alignment: .leading, spacing: 2) {
                    Text("OmniState")
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(LinearGradient(colors: [.white, CyberColor.cyan.opacity(0.8)], startPoint: .leading, endPoint: .trailing))
                    Text("SHADOW OS")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundColor(CyberColor.textMuted)
                        .tracking(1.5)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14).padding(.vertical, 12)

            Rectangle().fill(Color.white.opacity(0.04)).frame(height: 1).padding(.horizontal, 10)

            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 2) {
                    ForEach(NativePage.allCases) { item in
                        Button { page = item } label: { navItemRow(item) }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 8).padding(.top, 8)
            }

            Spacer()

            // Status footer
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Circle().fill(connectionColor).frame(width: 7, height: 7)
                        .scaleEffect(pulseActive ? 1.2 : 0.8)
                        .shadow(color: connectionColor.opacity(0.6), radius: 6)
                    Text(connectionLabel)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(CyberColor.textPrimary)
                    Spacer()
                    if socketClient.isConnected {
                        CyberBadge(text: "● Live", color: CyberColor.green)
                    }
                }
                if !socketClient.runtimeProvider.isEmpty || !socketClient.runtimeModel.isEmpty {
                    Text("\(providerLabel(for: socketClient.runtimeProvider)) / \(socketClient.runtimeModel)")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(CyberColor.textSecondary)
                        .lineLimit(1)
                }
                if let pf = socketClient.llmPreflight {
                    HStack(spacing: 4) {
                        Circle().fill(pf.ok ? CyberColor.green : CyberColor.red).frame(width: 5, height: 5)
                        Text(pf.ok ? "API Ready" : "API Error")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(pf.ok ? CyberColor.green : CyberColor.red)
                    }
                }
            }
            .padding(12)
            .background(CyberColor.glassBg)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(CyberColor.glassBorder, lineWidth: 1))
            .padding(10)
        }
        .background(Color.black.opacity(0.5))
        .frame(width: 220)
    }

    private func navItemRow(_ item: NativePage) -> some View {
        let isActive = page == item
        return HStack(spacing: 0) {
            // Accent bar
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(isActive ? CyberColor.cyan : Color.clear)
                .frame(width: 3, height: 20)
                .shadow(color: isActive ? CyberColor.cyan.opacity(0.5) : .clear, radius: 6)
                .padding(.trailing, 8)

            Image(systemName: item.icon)
                .font(.system(size: 12, weight: .semibold))
                .frame(width: 18)
                .foregroundColor(isActive ? CyberColor.cyan : CyberColor.textSecondary)

            Text(pageLabel(item))
                .font(.system(size: 12, weight: isActive ? .bold : .medium, design: .rounded))
                .foregroundColor(isActive ? .white : CyberColor.textSecondary)
                .padding(.leading, 8)

            Spacer()

            if item == .chat && pendingTaskCount > 0 {
                CyberBadge(text: "\(pendingTaskCount)", color: CyberColor.red)
            }
            if item == .health && activeAlertCount > 0 {
                CyberBadge(text: "\(activeAlertCount)", color: CyberColor.orange)
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 7)
        .background(isActive ? CyberColor.cyan.opacity(0.08) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(isActive ? CyberColor.cyan.opacity(0.15) : Color.clear, lineWidth: 1))
    }

    // MARK: - Topbar

    private var topbar: some View {
        HStack {
            Text(pageLabel(page))
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(LinearGradient(colors: [.white, CyberColor.cyan.opacity(0.7)], startPoint: .leading, endPoint: .trailing))
            Spacer()

            HStack(spacing: 8) {
                Menu {
                    Button("Tiếng Việt") { selectedLanguage = "Tiếng Việt" }
                    Button("English") { selectedLanguage = "English" }
                } label: { topbarChip("🌐 \(selectedLanguage)") }

                HStack(spacing: 5) {
                    Circle().fill(connectionColor).frame(width: 6, height: 6)
                        .scaleEffect(pulseActive ? 1.18 : 0.82)
                        .shadow(color: connectionColor.opacity(0.5), radius: 5)
                    Text(connectionLabel)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(CyberColor.textPrimary)
                }
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(CyberColor.glassBg)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(connectionColor.opacity(0.3), lineWidth: 1))

                Menu {
                    if modelOptions.isEmpty {
                        Button(tx("Chưa có model", "No model")) {}.disabled(true)
                    } else {
                        ForEach(modelOptions, id: \.self) { model in
                            Button(model) {
                                selectedModel = model
                                socketClient.setRuntimeConfig(key: "model", value: model)
                            }
                        }
                    }
                } label: { topbarChip("🤖 \(selectedModel.isEmpty ? "Model" : selectedModel)") }

                Button { runPrimaryTaskFromTopbar() } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "bolt.fill").font(.system(size: 10))
                        Text("Task")
                            .font(.system(size: 11, weight: .bold))
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(LinearGradient(colors: [CyberColor.cyan.opacity(0.9), CyberColor.blue.opacity(0.8)], startPoint: .leading, endPoint: .trailing))
                    .clipShape(Capsule())
                    .shadow(color: CyberColor.cyan.opacity(0.35), radius: 8)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Color.black.opacity(0.3))
    }

    private func topbarChip(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(CyberColor.textPrimary)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(CyberColor.glassBg)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(CyberColor.glassBorder, lineWidth: 1))
    }

    // MARK: - Content Router

    @ViewBuilder
    private var content: some View {
        switch page {
        case .dashboard: dashboardView
        case .chat: chatView
        case .voice: voiceView
        case .health: healthView
        case .machine: machineInfoView
        case .config: configView
        case .screenTree: screenTreeView
        case .triggers: triggersView
        case .settings: settingsView
        }
    }

    // MARK: ========== Dashboard ==========

    private var dashboardView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Hero
                HeroSection(
                    icon: "square.grid.2x2.fill",
                    iconColor: CyberColor.cyan,
                    title: tx("OmniState Control Center", "OmniState Control Center"),
                    subtitle: tx("Shadow OS — điều phối tác vụ cho \(socketClient.systemInfo?.hostname ?? "Mac")", "Shadow OS — intelligent automation for \(socketClient.systemInfo?.hostname ?? "Mac")")
                )
                .overlay(alignment: .topTrailing) {
                    HStack(spacing: 6) {
                        CyberBadge(text: "● \(connectionLabel)", color: connectionColor)
                        if let pf = socketClient.llmPreflight, pf.ok {
                            CyberBadge(text: "API ✓", color: CyberColor.green)
                        }
                    }
                    .padding(16)
                }

                // Quick nav tiles
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    navTile(tx("AI Chat", "AI Chat"), subtitle: tx("Ngôn ngữ tự nhiên", "Natural language"), icon: "message.fill", glow: CyberColor.blue) { page = .chat }
                    navTile(tx("Giọng nói", "Voice"), subtitle: tx("Nói với OmniState", "Speak to OmniState"), icon: "waveform.circle.fill", glow: CyberColor.cyan) { page = .voice }
                    navTile(tx("Sức khỏe", "Health"), subtitle: tx("Chẩn đoán", "Diagnostics"), icon: "heart.text.square.fill", glow: CyberColor.pink) { page = .health }
                    navTile(tx("Cấu hình", "Config"), subtitle: "Provider & model", icon: "slider.horizontal.3", glow: CyberColor.purple) { page = .config }
                }

                // Metric gauges
                let sysInfo = socketClient.systemInfo
                let diskPct = Int(sysInfo?.diskUsePercent?.replacingOccurrences(of: "%", with: "") ?? "0") ?? 0
                let memPct: Int = {
                    guard let total = sysInfo?.memoryTotalMB, let free = sysInfo?.memoryFreeMB, total > 0 else { return 0 }
                    return Int(Double(total - free) / Double(total) * 100)
                }()
                let healthStatus = socketClient.healthReport?.overall ?? (healthChecker.isHealthy ? "healthy" : "unknown")
                let cpuVal = socketClient.healthReport?.sensors.first(where: { $0.name == "cpu" })?.value ?? 0

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    gaugeMetricCard(title: "CPU", value: cpuVal, tint: CyberColor.blue)
                    gaugeMetricCard(title: tx("BỘ NHỚ", "MEMORY"), value: Double(memPct), tint: memPct > 85 ? CyberColor.red : memPct > 70 ? CyberColor.orange : CyberColor.cyan)
                    gaugeMetricCard(title: "DISK", value: Double(diskPct), tint: diskPct > 90 ? CyberColor.red : diskPct > 70 ? CyberColor.orange : CyberColor.green)
                    healthStatusTile(status: healthStatus)
                }

                // Battery + Network + Alerts
                HStack(alignment: .top, spacing: 12) {
                    if let si = socketClient.systemInfo {
                        let battPct = si.batteryPercent ?? 0
                        GlowCard(glow: battPct > 50 ? CyberColor.green.opacity(0.3) : CyberColor.orange.opacity(0.3)) {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Image(systemName: battPct > 50 ? "battery.100" : "battery.25")
                                        .foregroundColor(battPct > 50 ? CyberColor.green : CyberColor.orange)
                                    Text(tx("PIN", "BATTERY")).font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundColor(CyberColor.textMuted)
                                }
                                HStack(alignment: .lastTextBaseline, spacing: 3) {
                                    Text("\(battPct)").font(.system(size: 28, weight: .heavy, design: .rounded)).foregroundColor(CyberColor.textPrimary)
                                    Text("%").font(.system(size: 13, weight: .bold)).foregroundColor(battPct > 50 ? CyberColor.green : CyberColor.orange)
                                }
                                if si.batteryCharging {
                                    CyberBadge(text: "⚡ Charging", color: CyberColor.orange)
                                }
                            }
                        }
                    }

                    GlowCard(glow: CyberColor.cyan.opacity(0.2)) {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel(text: tx("Mạng", "Network"))
                            if let si = socketClient.systemInfo {
                                if si.wifiConnected {
                                    HStack(spacing: 6) {
                                        Image(systemName: "wifi").foregroundColor(CyberColor.green)
                                        Text(si.wifiSSID ?? "Connected").font(.system(size: 13, weight: .semibold)).foregroundColor(CyberColor.cyan)
                                    }
                                    if let ip = si.wifiIP {
                                        Text(ip).font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundColor(CyberColor.textSecondary)
                                    }
                                } else {
                                    Label("Disconnected", systemImage: "wifi.slash").foregroundColor(CyberColor.red)
                                }
                            }
                            HStack(spacing: 5) {
                                Circle().fill(networkMonitor.isTailscaleOnline ? CyberColor.cyan : CyberColor.red).frame(width: 5, height: 5)
                                Text(networkMonitor.isTailscaleOnline ? "Tailscale" : "No Tailscale")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(networkMonitor.isTailscaleOnline ? CyberColor.cyan : CyberColor.red)
                            }
                        }
                    }

                    GlowCard(glow: activeAlertCount > 0 ? CyberColor.orange.opacity(0.3) : CyberColor.green.opacity(0.2)) {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel(text: tx("Cảnh báo", "Alerts"))
                            if let health = socketClient.healthReport, !health.alerts.isEmpty {
                                ForEach(health.alerts.prefix(3)) { alert in
                                    alertItem(icon: alert.severity == "critical" ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill",
                                              title: alert.sensor, detail: alert.message,
                                              tone: alert.severity == "critical" ? CyberColor.red : CyberColor.orange)
                                }
                            } else {
                                HStack(spacing: 8) {
                                    Image(systemName: "checkmark.circle.fill").foregroundColor(CyberColor.green)
                                    Text(tx("Không có cảnh báo", "No active alerts")).font(.system(size: 12)).foregroundColor(CyberColor.textSecondary)
                                }
                            }
                        }
                    }
                }

                // Recent tasks + quick actions
                HStack(alignment: .top, spacing: 12) {
                    GlowCard {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: tx("Tác vụ gần đây", "Recent Tasks"))
                            if socketClient.historyEntries.isEmpty {
                                Text(tx("Chưa có tác vụ", "No tasks yet")).foregroundColor(CyberColor.textMuted).font(.system(size: 12))
                            } else {
                                ForEach(socketClient.historyEntries.prefix(5)) { entry in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(entry.goal).lineLimit(1).font(.system(size: 12, weight: .semibold)).foregroundColor(CyberColor.textPrimary)
                                        HStack(spacing: 6) {
                                            CyberBadge(text: entry.status, color: entry.status.lowercased().contains("complete") ? CyberColor.green : CyberColor.orange)
                                            Text("\(entry.durationMs)ms").font(.system(size: 10, design: .monospaced)).foregroundColor(CyberColor.textMuted)
                                        }
                                    }
                                    .padding(.vertical, 2)
                                }
                            }
                        }
                    }

                    GlowCard {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: tx("Tác vụ nhanh", "Quick Actions"))
                            quickActionButton(tx("Phân tích log lỗi", "Analyze error logs"), goal: "Analyze latest error logs and summarize root causes")
                            quickActionButton(tx("Kiểm tra token/preflight", "Check token/preflight"), goal: "Check runtime token and preflight status")
                            quickActionButton(tx("Trạng thái gateway", "Gateway status"), goal: "Check full gateway state and propose fixes")
                            quickActionButton(tx("Voice chat", "Voice chat"), goal: "Start voice conversation mode with push-to-talk")
                        }
                    }
                }

                // Gateway control
                GlowCard(glow: gatewayLive ? CyberColor.green.opacity(0.2) : CyberColor.red.opacity(0.2)) {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: "Gateway Control")
                        HStack(spacing: 8) {
                            Circle().fill(gatewayLive ? (healthChecker.isHealthy ? CyberColor.green : CyberColor.orange) : CyberColor.red).frame(width: 8, height: 8)
                                .shadow(color: (gatewayLive ? CyberColor.green : CyberColor.red).opacity(0.5), radius: 6)
                            Text(gatewayLive ? "Running" : "Stopped").font(.system(size: 13, weight: .semibold)).foregroundColor(CyberColor.textPrimary)
                            if let conn = healthChecker.connections {
                                Text("• \(conn) conn").font(.system(size: 11, design: .monospaced)).foregroundColor(CyberColor.textMuted)
                            }
                            if let uptime = healthChecker.uptime {
                                Text("• \(formatSeconds(uptime))").font(.system(size: 11, design: .monospaced)).foregroundColor(CyberColor.textMuted)
                            }
                        }
                        HStack(spacing: 8) {
                            Button("Start") { gatewayManager.start() }.disabled(gatewayManager.isRunning)
                            Button("Stop") {
                                if gatewayManager.isRunning { gatewayManager.stop() } else { socketClient.requestGatewayShutdown() }
                            }.disabled(!gatewayLive && !gatewayManager.isRunning)
                            Button("Retry") {
                                gatewayManager.stop()
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { gatewayManager.start() }
                            }
                            Button("Refresh") {
                                healthChecker.check()
                                socketClient.queryHealth()
                                socketClient.querySystemDashboard()
                            }
                        }
                        .buttonStyle(.bordered).tint(CyberColor.cyan.opacity(0.7))
                    }
                }
            }
            .padding(18)
        }
    }

    // MARK: ========== Chat ==========

    private var chatView: some View {
        HStack(spacing: 0) {
            // Session sidebar
            VStack(spacing: 0) {
                HStack {
                    Text(tx("Sessions", "Sessions")).font(.system(size: 13, weight: .bold, design: .rounded)).foregroundColor(CyberColor.textPrimary)
                    Spacer()
                    Button { createSession() } label: {
                        Image(systemName: "plus.circle.fill").font(.system(size: 16)).foregroundColor(CyberColor.cyan)
                    }
                    .buttonStyle(.plain)
                }
                .padding(10)

                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(sessions) { session in
                            let isActive = session.id == selectedConversationID
                            Button { selectedConversationID = session.id } label: {
                                HStack(spacing: 0) {
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(isActive ? CyberColor.cyan : Color.clear)
                                        .frame(width: 3, height: 24)
                                        .shadow(color: isActive ? CyberColor.cyan.opacity(0.5) : .clear, radius: 4)
                                        .padding(.trailing, 8)

                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(session.title).lineLimit(1).font(.system(size: 12, weight: .semibold)).foregroundColor(isActive ? .white : CyberColor.textSecondary)
                                        Text(summaryLine(for: session)).font(.system(size: 10, design: .monospaced)).foregroundColor(CyberColor.textMuted)
                                    }
                                    Spacer()
                                    if session.memoryLog.count > 0 {
                                        CyberBadge(text: "\(session.memoryLog.count)", color: CyberColor.cyan)
                                    }
                                }
                                .padding(.vertical, 6).padding(.horizontal, 6)
                                .background(isActive ? CyberColor.cyan.opacity(0.06) : Color.clear)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button(tx("Đổi tên", "Rename")) { }
                                Button(role: .destructive) { deleteSessionLocal(id: session.id) } label: { Text(tx("Xoá", "Delete")) }
                            }
                        }
                    }
                    .padding(.horizontal, 6)
                }
            }
            .frame(width: 220)
            .background(Color.black.opacity(0.4))

            Rectangle().fill(Color.white.opacity(0.04)).frame(width: 1)

            // Chat area
            VStack(spacing: 0) {
                if let idx = selectedSessionIndex {
                    // Provider/model bar
                    HStack(spacing: 8) {
                        Picker("Provider", selection: Binding(get: {
                            sessions[idx].provider.isEmpty ? (providerOptions.first?.id ?? "") : sessions[idx].provider
                        }, set: { sessions[idx].provider = $0 })) {
                            if providerOptions.isEmpty { Text(tx("Chưa có", "None")).tag("") }
                            ForEach(providerOptions, id: \.id) { p in Text(p.label).tag(p.id) }
                        }
                        .pickerStyle(.menu).frame(maxWidth: 200)

                        Picker("Model", selection: Binding(get: {
                            sessions[idx].model.isEmpty ? (modelOptions.first ?? "") : sessions[idx].model
                        }, set: { sessions[idx].model = $0 })) {
                            if modelOptions.isEmpty { Text(tx("Chưa có", "None")).tag("") }
                            ForEach(modelOptions, id: \.self) { m in Text(m).tag(m) }
                        }
                        .pickerStyle(.menu).frame(maxWidth: 280)

                        Button("Apply") { applyRuntimeForSelectedSession() }
                            .buttonStyle(.borderedProminent).tint(CyberColor.cyan.opacity(0.8))
                            .disabled(!runtimeConfigReady)
                        Spacer()
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Color.black.opacity(0.25))
                }

                // Messages
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            if selectedSessionTranscript.isEmpty {
                                emptyStateChatView
                            }
                            ForEach(Array(selectedSessionTranscript.enumerated()), id: \.offset) { idx, line in
                                chatBubble(line: line)
                                    .id(idx)
                            }
                        }
                        .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 6)
                    }
                    .onChange(of: selectedSessionTranscript.count) { _ in
                        withAnimation { proxy.scrollTo(selectedSessionTranscript.count - 1, anchor: .bottom) }
                    }
                }

                // Input bar
                HStack(spacing: 10) {
                    Button {
                        toggleVoiceRecording()
                    } label: {
                        ZStack {
                            Circle()
                                .fill(voiceCaptureService.isRecording ?
                                      LinearGradient(colors: [CyberColor.red, CyberColor.pink], startPoint: .topLeading, endPoint: .bottomTrailing) :
                                      LinearGradient(colors: [CyberColor.cyan.opacity(0.2), CyberColor.blue.opacity(0.2)], startPoint: .topLeading, endPoint: .bottomTrailing))
                                .frame(width: 34, height: 34)
                                .overlay(Circle().stroke(voiceCaptureService.isRecording ? CyberColor.red.opacity(0.4) : CyberColor.cyan.opacity(0.3), lineWidth: 1))
                                .shadow(color: voiceCaptureService.isRecording ? CyberColor.red.opacity(0.4) : CyberColor.cyan.opacity(0.2), radius: 8)
                            Image(systemName: voiceCaptureService.isRecording ? "stop.fill" : "mic.fill")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(voiceCaptureService.isRecording ? .white : CyberColor.cyan)
                        }
                    }
                    .buttonStyle(.plain)

                    TextField(tx("Nhập lệnh...", "Enter command..."), text: $promptText, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13))
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(CyberColor.glassBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(CyberColor.glassBorder, lineWidth: 1))
                        .lineLimit(1...4)
                        .onSubmit { sendPromptFromSelectedSession() }

                    Button {
                        sendPromptFromSelectedSession()
                    } label: {
                        ZStack {
                            Circle()
                                .fill(promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?
                                      AnyShapeStyle(Color.white.opacity(0.05)) :
                                      AnyShapeStyle(LinearGradient(colors: [CyberColor.cyan, CyberColor.blue], startPoint: .topLeading, endPoint: .bottomTrailing)))
                                .frame(width: 34, height: 34)
                                .shadow(color: promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .clear : CyberColor.cyan.opacity(0.35), radius: 8)
                            Image(systemName: "arrow.up")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? CyberColor.textMuted : .white)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(12)
                .background(Color.black.opacity(0.35))
            }
        }
    }

    private var emptyStateChatView: some View {
        VStack(spacing: 14) {
            Text("🧠").font(.system(size: 42))
            Text("OmniState")
                .font(.system(size: 20, weight: .heavy, design: .rounded))
                .foregroundStyle(LinearGradient(colors: [CyberColor.cyan, .white], startPoint: .leading, endPoint: .trailing))
            Text(tx("Điều khiển Mac bằng ngôn ngữ tự nhiên", "Control your Mac with natural language"))
                .font(.system(size: 12, weight: .medium)).foregroundColor(CyberColor.textMuted).multilineTextAlignment(.center)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                ForEach(["💾 Disk", "🖥️ CPU", "🧠 Memory", "📡 Network", "🏠 Hostname", "⏱️ Uptime"], id: \.self) { cmd in
                    Button {
                        promptText = "check \(cmd.split(separator: " ").last ?? "")"
                        sendPromptFromSelectedSession()
                    } label: {
                        Text(cmd)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(CyberColor.textSecondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(CyberColor.glassBg)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(CyberColor.glassBorder, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: 380)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    private func chatBubble(line: String) -> some View {
        let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let role = parts.first.map(String.init) ?? "SYSTEM"
        let text = parts.count > 1 ? String(parts[1]).trimmingCharacters(in: .whitespaces) : line
        let isUser = role.lowercased() == "user"
        let isSystem = role.lowercased() == "system"
        let bubbleColor: Color = isUser ? CyberColor.blue : isSystem ? CyberColor.orange : CyberColor.cyan

        return HStack {
            if isUser { Spacer(minLength: 60) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 3) {
                Text(role.uppercased())
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(bubbleColor.opacity(0.7))

                Text(text)
                    .textSelection(.enabled)
                    .font(.system(size: 13, weight: .regular, design: role.lowercased() == "assistant" ? .monospaced : .default))
                    .foregroundColor(CyberColor.textPrimary)
                    .padding(10)
                    .background(isUser ? CyberColor.blue.opacity(0.12) : CyberColor.cardBg)
                    .clipShape(RoundedRectangle(cornerRadius: isUser ? 14 : 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: isUser ? 14 : 12, style: .continuous)
                            .stroke(bubbleColor.opacity(0.2), lineWidth: 1)
                    )
                    .shadow(color: bubbleColor.opacity(0.08), radius: 8)
            }

            if !isUser { Spacer(minLength: 60) }
        }
    }

    // MARK: ========== Voice ==========

    private var voiceView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroSection(icon: "waveform.circle.fill", iconColor: CyberColor.cyan, title: tx("Điều khiển giọng nói", "Voice Control"), subtitle: tx("Nói chuyện, đăng ký và cấu hình voice", "Speak, enroll, and configure voice"))

                GlowCard(glow: CyberColor.cyan.opacity(0.2)) {
                    VStack(alignment: .leading, spacing: 12) {
                        Picker("", selection: $voiceMode) {
                            Text(tx("Nhập giọng", "Voice Input")).tag(0)
                            Text(tx("Huấn luyện", "Train Identity")).tag(1)
                            Text(tx("Cài đặt", "Settings")).tag(2)
                        }
                        .pickerStyle(.segmented)

                        if voiceMode == 0 {
                            voiceInputTab
                        } else if voiceMode == 1 {
                            voiceTrainTab
                        } else {
                            voiceSettingsTab
                        }
                    }
                }
            }
            .padding(18)
        }
    }

    private var voiceInputTab: some View {
        VStack(spacing: 18) {
            // Recording status
            VStack(spacing: 10) {
                Text(voiceCaptureService.isRecording ? tx("🔴 Đang ghi âm...", "🔴 Recording...") : tx("Sẵn sàng lắng nghe", "Ready to listen"))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(voiceCaptureService.isRecording ? CyberColor.red : CyberColor.textSecondary)

                // Waveform bars
                HStack(spacing: 3) {
                    ForEach(0..<9, id: \.self) { i in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(voiceCaptureService.isRecording ?
                                  LinearGradient(colors: [CyberColor.blue, CyberColor.cyan], startPoint: .bottom, endPoint: .top) :
                                  LinearGradient(colors: [Color.white.opacity(0.08), Color.white.opacity(0.08)], startPoint: .bottom, endPoint: .top))
                            .frame(width: 4, height: voiceCaptureService.isRecording ? CGFloat.random(in: 8...32) : 8)
                            .animation(.easeInOut(duration: 0.3).repeatForever(autoreverses: true).delay(Double(i) * 0.05), value: voiceCaptureService.isRecording)
                    }
                }
                .frame(height: 40)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background(CyberColor.glassBg)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(voiceCaptureService.isRecording ? CyberColor.red.opacity(0.3) : CyberColor.glassBorder, lineWidth: 1))

            // Record button
            Button {
                toggleVoiceRecording()
            } label: {
                ZStack {
                    // Outer glow ring
                    Circle()
                        .stroke(voiceCaptureService.isRecording ? CyberColor.red.opacity(0.3) : CyberColor.cyan.opacity(0.2), lineWidth: 2)
                        .frame(width: 76, height: 76)
                        .scaleEffect(pulseActive ? 1.08 : 0.92)
                        .shadow(color: voiceCaptureService.isRecording ? CyberColor.red.opacity(0.4) : CyberColor.cyan.opacity(0.3), radius: 16)

                    Circle()
                        .fill(voiceCaptureService.isRecording ?
                              LinearGradient(colors: [CyberColor.red, CyberColor.pink], startPoint: .topLeading, endPoint: .bottomTrailing) :
                              LinearGradient(colors: [CyberColor.blue, CyberColor.cyan], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: 62, height: 62)
                        .shadow(color: voiceCaptureService.isRecording ? CyberColor.red.opacity(0.5) : CyberColor.cyan.opacity(0.4), radius: 14)

                    Image(systemName: voiceCaptureService.isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(.white)
                }
            }
            .buttonStyle(.plain)

            // Toggles
            Toggle(tx("Low latency", "Low latency"), isOn: Binding(get: { socketClient.voiceLowLatency }, set: { v in
                socketClient.setRuntimeConfig(key: "voice.lowLatency", value: v)
                socketClient.queryRuntimeConfig()
            })).toggleStyle(.switch)

            Toggle(tx("Auto execute", "Auto execute"), isOn: Binding(get: { socketClient.voiceAutoExecute }, set: { v in
                socketClient.setRuntimeConfig(key: "voice.autoExecuteTranscript", value: v)
                socketClient.queryRuntimeConfig()
            })).toggleStyle(.switch)

            // Transcript
            if !voiceCaptureService.transcript.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: "TRANSCRIPT")
                    Text(voiceCaptureService.transcript)
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .foregroundColor(CyberColor.textPrimary)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(CyberColor.glassBg)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                    HStack(spacing: 8) {
                        Button(tx("Gửi vào Chat", "Send to Chat")) {
                            promptText = voiceCaptureService.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                            sendPromptFromSelectedSession()
                            page = .chat
                        }
                        .buttonStyle(.borderedProminent).tint(CyberColor.cyan.opacity(0.8))
                        Button(tx("Xoá", "Clear")) { voiceCaptureService.transcript = "" }
                            .buttonStyle(.bordered)
                    }
                }
            }

            if let error = voiceCaptureService.errorMessage, !error.isEmpty {
                Text(error).font(.system(size: 11, weight: .medium)).foregroundColor(CyberColor.red)
            }
        }
    }

    private var voiceTrainTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(tx("Huấn luyện định danh giọng (SpeechBrain ECAPA-TDNN)", "Voice Identity Training (SpeechBrain ECAPA-TDNN)"))
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(CyberColor.textSecondary)

            quickActionButton(tx("Huấn luyện giọng nói", "Train voice identity"), goal: "Open voice enrollment flow and train speaker profile for this user")
            quickActionButton(tx("Xác minh người nói", "Verify speaker"), goal: "Verify current speaker against enrolled voice profile")
            quickActionButton(tx("Voice chat với bot", "Start voice chat"), goal: "Start voice conversation mode with push-to-talk and respond naturally")
            quickActionButton(tx("Kiểm tra micro", "Check microphone"), goal: "Check microphone devices, permissions, and recommended input settings")
        }
    }

    private var voiceSettingsTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle("Siri bridge", isOn: Binding(get: { socketClient.voiceSiriEnabled }, set: { v in
                socketClient.setRuntimeConfig(key: "voice.siri.enabled", value: v)
                socketClient.queryRuntimeConfig()
            })).toggleStyle(.switch)

            Picker("Siri mode", selection: Binding(get: { socketClient.voiceSiriMode }, set: { v in
                socketClient.setRuntimeConfig(key: "voice.siri.mode", value: v)
                socketClient.queryRuntimeConfig()
            })) {
                Text("command").tag("command")
                Text("handoff").tag("handoff")
            }.pickerStyle(.segmented)

            TextField("Siri endpoint", text: Binding(get: { socketClient.voiceSiriEndpoint }, set: { v in
                socketClient.setRuntimeConfig(key: "voice.siri.endpoint", value: v)
            })).textFieldStyle(.roundedBorder)

            TextField("Siri token", text: Binding(get: { socketClient.voiceSiriToken }, set: { v in
                socketClient.setRuntimeConfig(key: "voice.siri.token", value: v)
            })).textFieldStyle(.roundedBorder)

            Toggle("Wake word", isOn: Binding(get: { socketClient.voiceWakeEnabled }, set: { v in
                socketClient.setRuntimeConfig(key: "voice.wake.enabled", value: v)
                socketClient.queryRuntimeConfig()
            })).toggleStyle(.switch)

            TextField("Wake phrase", text: Binding(get: { socketClient.voiceWakePhrase }, set: { v in
                socketClient.setRuntimeConfig(key: "voice.wake.phrase", value: v)
            })).textFieldStyle(.roundedBorder)

            Button(tx("Lưu cài đặt", "Save settings")) { socketClient.queryRuntimeConfig() }
                .buttonStyle(.borderedProminent).tint(CyberColor.cyan.opacity(0.8))
        }
    }

    // MARK: ========== Health ==========

    private var healthView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let health = socketClient.healthReport {
                    let overallColor = health.overall == "healthy" ? CyberColor.green : health.overall == "degraded" ? CyberColor.orange : CyberColor.red
                    HeroSection(icon: "heart.text.square.fill", iconColor: overallColor, title: tx("Sức khỏe hệ thống", "System Health"), subtitle: tx("Cập nhật: \(health.timestamp.prefix(19))", "Updated: \(health.timestamp.prefix(19))"))
                        .overlay(alignment: .topTrailing) {
                            HStack(spacing: 6) {
                                CyberBadge(text: health.overall.uppercased(), color: overallColor)
                                Button("Refresh") { socketClient.queryHealth() }
                                    .buttonStyle(.bordered).controlSize(.small).tint(overallColor.opacity(0.7))
                            }
                            .padding(16)
                        }

                    // Sensor cards with gauges
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        ForEach(health.sensors) { sensor in
                            sensorCard(sensor)
                        }
                    }

                    // Alerts
                    if !health.alerts.isEmpty {
                        GlowCard(glow: CyberColor.orange.opacity(0.3)) {
                            VStack(alignment: .leading, spacing: 8) {
                                SectionLabel(text: tx("Cảnh báo (\(health.alerts.count))", "Alerts (\(health.alerts.count))"))
                                ForEach(health.alerts) { alert in
                                    alertItem(
                                        icon: alert.severity == "critical" ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill",
                                        title: alert.sensor,
                                        detail: alert.message,
                                        tone: alert.severity == "critical" ? CyberColor.red : CyberColor.orange
                                    )
                                }
                            }
                        }
                    } else {
                        GlowCard(glow: CyberColor.green.opacity(0.2)) {
                            HStack(spacing: 12) {
                                Image(systemName: "checkmark.seal.fill").font(.system(size: 24)).foregroundColor(CyberColor.green).shadow(color: CyberColor.green.opacity(0.4), radius: 8)
                                VStack(alignment: .leading) {
                                    Text(tx("Mọi hệ thống ổn định", "All systems nominal")).font(.system(size: 14, weight: .bold)).foregroundColor(CyberColor.green)
                                    Text(tx("Không có cảnh báo", "No alerts detected")).font(.system(size: 12)).foregroundColor(CyberColor.textMuted)
                                }
                            }
                        }
                    }
                } else {
                    VStack(spacing: 12) {
                        ProgressView().tint(CyberColor.cyan)
                        Text(tx("Đang tải dữ liệu...", "Loading health data...")).foregroundColor(CyberColor.textMuted)
                        Button("Refresh") { socketClient.queryHealth() }.buttonStyle(.bordered)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 60)
                }

                // Task history
                GlowCard {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: tx("Lịch sử tác vụ", "Task History"))
                        if socketClient.historyEntries.isEmpty {
                            Text(tx("Không có lịch sử", "No history")).foregroundColor(CyberColor.textMuted)
                        } else {
                            ForEach(socketClient.historyEntries.prefix(15)) { entry in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(entry.goal).lineLimit(2).font(.system(size: 12, weight: .medium)).foregroundColor(CyberColor.textPrimary)
                                    HStack(spacing: 6) {
                                        CyberBadge(text: entry.status, color: entry.status.lowercased().contains("complete") ? CyberColor.green : CyberColor.orange)
                                        Text("• \(entry.intentType)").font(.system(size: 10, design: .monospaced)).foregroundColor(CyberColor.textMuted)
                                        Text("• \(entry.durationMs)ms").font(.system(size: 10, design: .monospaced)).foregroundColor(CyberColor.textMuted)
                                    }
                                }
                                .padding(.vertical, 3)
                            }
                        }
                    }
                }
            }
            .padding(18)
        }
    }

    private func sensorCard(_ sensor: NativeSensorData) -> some View {
        let sensorColor = sensor.isOk ? CyberColor.green : sensor.isWarning ? CyberColor.orange : CyberColor.red
        let icons: [String: String] = ["cpu": "cpu", "memory": "memorychip", "disk": "internaldrive", "network": "network", "processes": "gearshape.2"]
        return GlowCard(glow: sensorColor.opacity(0.25)) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: icons[sensor.name] ?? "gauge")
                        .foregroundColor(sensorColor)
                    Text(sensor.name.uppercased())
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(CyberColor.textMuted)
                    Spacer()
                    CyberBadge(text: sensor.status.uppercased(), color: sensorColor)
                }
                HStack(spacing: 10) {
                    CyberGauge(value: min(sensor.value, 100), tint: sensorColor, size: 46)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .lastTextBaseline, spacing: 3) {
                            Text("\(Int(sensor.value))")
                                .font(.system(size: 24, weight: .heavy, design: .rounded))
                                .foregroundColor(CyberColor.textPrimary)
                            Text(sensor.unit)
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(sensorColor)
                        }
                        if let msg = sensor.message, !msg.isEmpty {
                            Text(msg).font(.system(size: 10)).foregroundColor(CyberColor.textMuted).lineLimit(2)
                        }
                    }
                }
            }
        }
    }

    // MARK: ========== Machine Info ==========

    private var machineInfoView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroSection(icon: "desktopcomputer", iconColor: CyberColor.cyan, title: tx("Thông tin hệ thống", "System Information"), subtitle: socketClient.systemInfo?.hostname ?? tx("Đang tải...", "Loading..."))

                if let si = socketClient.systemInfo {
                    let battPct = si.batteryPercent ?? 0
                    let diskPct = Int(si.diskUsePercent?.replacingOccurrences(of: "%", with: "") ?? "0") ?? 0
                    let memPct: Int = {
                        guard let total = si.memoryTotalMB, let free = si.memoryFreeMB, total > 0 else { return 0 }
                        return Int(Double(total - free) / Double(total) * 100)
                    }()

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        gaugeInfoCard(label: "Hostname", value: si.hostname, icon: "house.fill", color: CyberColor.cyan)
                        gaugeInfoCard(label: "Battery", value: "\(battPct)%", icon: battPct > 50 ? "battery.100" : "battery.25", color: battPct > 20 ? CyberColor.green : CyberColor.red, pct: Double(battPct))
                        gaugeInfoCard(label: "Wi-Fi", value: si.wifiSSID ?? (si.wifiConnected ? "Connected" : "Disconnected"), icon: "wifi", color: si.wifiConnected ? CyberColor.green : CyberColor.red)
                        gaugeInfoCard(label: "Disk", value: si.diskUsePercent ?? "N/A", icon: "internaldrive.fill", color: diskPct > 90 ? CyberColor.red : diskPct > 70 ? CyberColor.orange : CyberColor.green, pct: Double(diskPct))
                        gaugeInfoCard(label: "CPU Load", value: si.cpuLoadAvg ?? "N/A", icon: "cpu", color: CyberColor.blue)
                        gaugeInfoCard(label: "Memory", value: {
                            guard let total = si.memoryTotalMB, let free = si.memoryFreeMB else { return "N/A" }
                            return "\(total - free) / \(total) MB"
                        }(), icon: "memorychip", color: memPct > 85 ? CyberColor.red : CyberColor.purple, pct: Double(memPct))
                    }

                    if let ip = si.wifiIP {
                        GlowCard(glow: CyberColor.cyan.opacity(0.2)) {
                            VStack(alignment: .leading, spacing: 6) {
                                SectionLabel(text: "Network Details")
                                Text("IP: \(ip)").font(.system(size: 12, design: .monospaced)).foregroundColor(CyberColor.textSecondary)
                                if si.batteryCharging {
                                    CyberBadge(text: "⚡ Charging", color: CyberColor.orange)
                                }
                                if let d = si.diskTotal, let u = si.diskUsed {
                                    Text("Disk: \(u) / \(d)").font(.system(size: 12, design: .monospaced)).foregroundColor(CyberColor.textSecondary)
                                }
                            }
                        }
                    }
                } else {
                    GlowCard {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel(text: tx("Thông tin máy", "Machine Info"))
                            Text("Host: \(ProcessInfo.processInfo.hostName)").foregroundColor(CyberColor.textSecondary)
                            Text("CPU: \(ProcessInfo.processInfo.processorCount) cores").foregroundColor(CyberColor.textSecondary)
                            Text("Memory: \(ByteCountFormatter.string(fromByteCount: Int64(ProcessInfo.processInfo.physicalMemory), countStyle: .memory))").foregroundColor(CyberColor.textSecondary)
                            Text("Uptime: \(formatSeconds(ProcessInfo.processInfo.systemUptime))").foregroundColor(CyberColor.textSecondary)
                        }
                    }
                    Button("Load System Info") { socketClient.querySystemDashboard() }
                        .buttonStyle(.borderedProminent).tint(CyberColor.cyan.opacity(0.8))
                }

                connectView
            }
            .padding(18)
        }
    }

    // MARK: ========== Config ==========

    private var configView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroSection(icon: "slider.horizontal.3", iconColor: CyberColor.purple, title: tx("Cấu hình", "Configuration"), subtitle: tx("Provider, model và runtime settings", "Provider, model and runtime settings"))

                // Active provider
                GlowCard(glow: CyberColor.cyan.opacity(0.25)) {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: tx("Provider hiện tại", "Active Provider"))
                        HStack {
                            Text("Provider:").foregroundColor(CyberColor.textMuted)
                            Text(socketClient.runtimeProvider.isEmpty ? "default" : providerLabel(for: socketClient.runtimeProvider))
                                .font(.system(size: 14, weight: .bold, design: .monospaced)).foregroundColor(CyberColor.cyan)
                        }
                        HStack {
                            Text("Model:").foregroundColor(CyberColor.textMuted)
                            Text(socketClient.runtimeModel.isEmpty ? "default" : socketClient.runtimeModel)
                                .font(.system(size: 14, weight: .bold, design: .monospaced)).foregroundColor(CyberColor.textPrimary)
                        }
                        if let pf = socketClient.llmPreflight {
                            HStack(spacing: 6) {
                                Circle().fill(pf.ok ? CyberColor.green : CyberColor.red).frame(width: 6, height: 6).shadow(color: (pf.ok ? CyberColor.green : CyberColor.red).opacity(0.5), radius: 4)
                                Text(pf.message).font(.system(size: 11, weight: .medium)).foregroundColor(CyberColor.textSecondary)
                            }
                        }
                        HStack(spacing: 8) {
                            Button(tx("Check API", "Check API")) { socketClient.queryLlmPreflight() }
                            Button(tx("Refresh Config", "Refresh Config")) { socketClient.queryRuntimeConfig() }
                        }
                        .buttonStyle(.bordered).tint(CyberColor.cyan.opacity(0.7))
                    }
                }

                // Provider list
                GlowCard {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: tx("Tất cả Providers", "All Providers"))
                        if providerOptions.isEmpty {
                            Text(tx("Chưa có provider", "No providers")).foregroundColor(CyberColor.textMuted)
                        } else {
                            ForEach(providerOptions, id: \.id) { provider in
                                let isActive = provider.id == socketClient.runtimeProvider
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(provider.label)
                                            .font(.system(size: 14, weight: .bold, design: .rounded))
                                            .foregroundColor(isActive ? CyberColor.cyan : CyberColor.textPrimary)
                                        if isActive { CyberBadge(text: "ACTIVE", color: CyberColor.cyan) }
                                        Spacer()
                                        if !isActive {
                                            Button(tx("Chuyển sang", "Switch")) {
                                                socketClient.setRuntimeConfig(key: "provider", value: provider.id)
                                                socketClient.queryRuntimeConfig()
                                            }
                                            .buttonStyle(.bordered).controlSize(.small).tint(CyberColor.cyan.opacity(0.7))
                                        }
                                    }
                                    HStack(spacing: 16) {
                                        if let k = provider.kind { Text("Kind: \(k)").font(.system(size: 11, design: .monospaced)).foregroundColor(CyberColor.textMuted) }
                                        if let url = provider.baseURL { Text(url).font(.system(size: 11, design: .monospaced)).foregroundColor(CyberColor.textMuted).lineLimit(1) }
                                    }
                                    if !provider.models.isEmpty {
                                        Text("Models: \(provider.models.joined(separator: ", "))").font(.system(size: 11, design: .monospaced)).foregroundColor(CyberColor.textSecondary)
                                    }
                                    CyberBadge(text: provider.enabled ? "✅ Enabled" : "❌ Disabled", color: provider.enabled ? CyberColor.green : CyberColor.red)
                                }
                                .padding(10)
                                .background(isActive ? CyberColor.cyan.opacity(0.05) : CyberColor.glassBg)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(isActive ? CyberColor.cyan.opacity(0.25) : CyberColor.glassBorder, lineWidth: 1))
                            }
                        }
                    }
                }

                // Model switch
                GlowCard {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: tx("Đổi Model", "Switch Model"))
                        if modelOptions.isEmpty {
                            Text(tx("Chưa có model", "No models available")).foregroundColor(CyberColor.textMuted)
                        } else {
                            ForEach(modelOptions, id: \.self) { model in
                                let isActive = model == socketClient.runtimeModel
                                Button {
                                    selectedModel = model
                                    socketClient.setRuntimeConfig(key: "model", value: model)
                                    socketClient.queryRuntimeConfig()
                                } label: {
                                    HStack {
                                        Text(model).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundColor(CyberColor.textPrimary)
                                        Spacer()
                                        if isActive { Image(systemName: "checkmark.circle.fill").foregroundColor(CyberColor.cyan) }
                                    }
                                    .padding(10)
                                    .background(isActive ? CyberColor.cyan.opacity(0.06) : CyberColor.glassBg)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(isActive ? CyberColor.cyan.opacity(0.25) : CyberColor.glassBorder, lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .padding(18)
        }
    }

    // MARK: ========== Screen Tree (Session & Memory) ==========

    private var screenTreeView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroSection(icon: "brain.head.profile", iconColor: CyberColor.purple, title: "Session & Memory", subtitle: tx("Quản lý phiên và bộ nhớ chia sẻ", "Manage sessions and shared memory"))

                GlowCard {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: "Runtime Sessions")
                        if socketClient.runtimeSessions.isEmpty {
                            Text(tx("Chưa có session", "No sessions")).foregroundColor(CyberColor.textMuted)
                        } else {
                            ForEach(socketClient.runtimeSessions) { session in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(session.name).font(.system(size: 13, weight: .semibold)).foregroundColor(CyberColor.textPrimary)
                                        Text("id: \(session.id.prefix(12))... • msgs: \(session.messageCount)")
                                            .font(.system(size: 11, design: .monospaced)).foregroundColor(CyberColor.textMuted)
                                    }
                                    Spacer()
                                    if session.id == socketClient.runtimeCurrentSessionId {
                                        CyberBadge(text: "current", color: CyberColor.cyan)
                                    }
                                }
                                .padding(.vertical, 3)
                            }
                        }
                        Button(tx("Refresh sessions", "Refresh sessions")) {
                            socketClient.queryRuntimeConfig()
                            socketClient.queryClaudeMem()
                        }
                        .buttonStyle(.bordered).tint(CyberColor.cyan.opacity(0.7))
                    }
                }

                GlowCard {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: "Shared Memory")
                        TextField(tx("Shared summary", "Shared summary"), text: $sharedMemorySummary, axis: .vertical)
                            .lineLimit(3...8).textFieldStyle(.roundedBorder)
                        HStack(spacing: 10) {
                            Button(tx("Pull", "Pull")) { socketClient.queryClaudeMem() }
                            Button(tx("Sync", "Sync")) { syncAllMemoryToBackend() }
                        }
                        .buttonStyle(.bordered)
                    }
                }

                GlowCard {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: "Quick Actions")
                        quickActionButton(tx("Chụp cây accessibility", "Capture accessibility tree"), goal: "Capture the current screen accessibility tree and display the hierarchy of UI elements")
                        quickActionButton(tx("Phân tích cửa sổ hiện tại", "Analyze current window"), goal: "Analyze the frontmost window — identify all UI elements, buttons, and text fields")
                        quickActionButton(tx("Tìm element bằng text", "Find element by text"), goal: "Find a specific UI element on screen by its text label and report its position")
                    }
                }
            }
            .padding(18)
        }
    }

    // MARK: ========== Triggers ==========

    private var triggersView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroSection(icon: "bolt.fill", iconColor: CyberColor.orange, title: tx("Trigger tự động", "Auto Triggers"), subtitle: tx("Wake word, Siri bridge và tác vụ nhanh", "Wake word, Siri bridge and quick actions"))

                GlowCard(glow: CyberColor.cyan.opacity(0.2)) {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: "Wake Word")
                        Toggle(tx("Bật wake word", "Enable wake word"), isOn: Binding(get: {
                            socketClient.voiceWakeEnabled
                        }, set: { value in
                            socketClient.setRuntimeConfig(key: "voice.wake.enabled", value: value)
                            socketClient.queryRuntimeConfig()
                        })).toggleStyle(.switch)

                        TextField(tx("Phrase", "Phrase"), text: Binding(get: {
                            socketClient.voiceWakePhrase
                        }, set: { socketClient.setRuntimeConfig(key: "voice.wake.phrase", value: $0) }))
                        .textFieldStyle(.roundedBorder)

                        Stepper("Cooldown: \(socketClient.voiceWakeCooldownMs) ms", value: Binding(get: {
                            socketClient.voiceWakeCooldownMs
                        }, set: {
                            socketClient.setRuntimeConfig(key: "voice.wake.cooldownMs", value: $0)
                            socketClient.queryRuntimeConfig()
                        }), in: 200...8000, step: 100)

                        // Cooldown visual bar
                        HStack(spacing: 4) {
                            Text("0").font(.system(size: 9, design: .monospaced)).foregroundColor(CyberColor.textMuted)
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 3).fill(Color.white.opacity(0.06)).frame(height: 6)
                                    RoundedRectangle(cornerRadius: 3)
                                        .fill(LinearGradient(colors: [CyberColor.cyan, CyberColor.blue], startPoint: .leading, endPoint: .trailing))
                                        .frame(width: geo.size.width * CGFloat(socketClient.voiceWakeCooldownMs) / 8000.0, height: 6)
                                        .shadow(color: CyberColor.cyan.opacity(0.4), radius: 4)
                                }
                            }
                            .frame(height: 6)
                            Text("8000").font(.system(size: 9, design: .monospaced)).foregroundColor(CyberColor.textMuted)
                        }

                        Stepper("Command window: \(socketClient.voiceWakeCommandWindowSec) s", value: Binding(get: {
                            socketClient.voiceWakeCommandWindowSec
                        }, set: {
                            socketClient.setRuntimeConfig(key: "voice.wake.commandWindowSec", value: $0)
                            socketClient.queryRuntimeConfig()
                        }), in: 3...60, step: 1)

                        Button(tx("Lưu", "Save")) {
                            socketClient.setRuntimeConfig(key: "voice.wake.phrase", value: socketClient.voiceWakePhrase)
                            socketClient.queryRuntimeConfig()
                        }
                        .buttonStyle(.borderedProminent).tint(CyberColor.cyan.opacity(0.8))
                    }
                }

                GlowCard(glow: CyberColor.purple.opacity(0.2)) {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: "Siri Bridge")
                        Toggle("Siri enabled", isOn: Binding(get: { socketClient.voiceSiriEnabled }, set: { v in
                            socketClient.setRuntimeConfig(key: "voice.siri.enabled", value: v)
                            socketClient.queryRuntimeConfig()
                        })).toggleStyle(.switch)

                        Picker("Mode", selection: Binding(get: { socketClient.voiceSiriMode }, set: { v in
                            socketClient.setRuntimeConfig(key: "voice.siri.mode", value: v)
                            socketClient.queryRuntimeConfig()
                        })) {
                            Text("command").tag("command")
                            Text("handoff").tag("handoff")
                        }.pickerStyle(.segmented)

                        TextField("Endpoint", text: Binding(get: { socketClient.voiceSiriEndpoint }, set: { v in
                            socketClient.setRuntimeConfig(key: "voice.siri.endpoint", value: v)
                        })).textFieldStyle(.roundedBorder)

                        TextField("Token", text: Binding(get: { socketClient.voiceSiriToken }, set: { v in
                            socketClient.setRuntimeConfig(key: "voice.siri.token", value: v)
                        })).textFieldStyle(.roundedBorder)
                    }
                }

                GlowCard {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: tx("Tác vụ nhanh", "Quick Actions"))
                        quickActionButton(tx("Trạng thái gateway", "Check gateway status"), goal: "Check full gateway state and propose fixes")
                        quickActionButton(tx("Log lỗi mới nhất", "Analyze error logs"), goal: "Analyze latest error logs and summarize root causes")
                        quickActionButton(tx("Token/preflight", "Check token/preflight"), goal: "Check runtime token and preflight status")
                    }
                }
            }
            .padding(18)
        }
    }

    // MARK: ========== Settings ==========

    private var settingsView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroSection(icon: "gearshape.fill", iconColor: CyberColor.blue, title: tx("Cài đặt", "Settings"), subtitle: tx("Gateway, AI và voice preferences", "Gateway, AI, and voice preferences"))

                GlowCard {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: tx("Kết nối", "Connection"))
                        HStack {
                            Text("Gateway:").foregroundColor(CyberColor.textMuted).font(.system(size: 12))
                            Circle().fill(gatewayLive ? CyberColor.green : CyberColor.red).frame(width: 7, height: 7).shadow(color: (gatewayLive ? CyberColor.green : CyberColor.red).opacity(0.5), radius: 4)
                            Text(gatewayLive ? "Running" : "Stopped").font(.system(size: 12, weight: .semibold)).foregroundColor(gatewayLive ? CyberColor.green : CyberColor.red)
                        }
                        HStack {
                            Text("WebSocket:").foregroundColor(CyberColor.textMuted).font(.system(size: 12))
                            Circle().fill(socketClient.isConnected ? CyberColor.green : CyberColor.red).frame(width: 7, height: 7).shadow(color: (socketClient.isConnected ? CyberColor.green : CyberColor.red).opacity(0.5), radius: 4)
                            Text(socketClient.isConnected ? "Connected" : "Disconnected").font(.system(size: 12, weight: .semibold)).foregroundColor(socketClient.isConnected ? CyberColor.green : CyberColor.red)
                        }
                        HStack {
                            Text("Endpoint:").foregroundColor(CyberColor.textMuted).font(.system(size: 12))
                            Text("ws://127.0.0.1:19800").font(.system(size: 12, weight: .medium, design: .monospaced)).foregroundColor(CyberColor.textSecondary)
                        }
                        if let pf = socketClient.llmPreflight {
                            HStack {
                                Text("LLM API:").foregroundColor(CyberColor.textMuted).font(.system(size: 12))
                                Circle().fill(pf.ok ? CyberColor.green : CyberColor.red).frame(width: 7, height: 7).shadow(color: (pf.ok ? CyberColor.green : CyberColor.red).opacity(0.5), radius: 4)
                                Text(pf.ok ? "\(pf.model ?? "Ready") ✓" : "Error").font(.system(size: 12, weight: .semibold)).foregroundColor(pf.ok ? CyberColor.green : CyberColor.red)
                            }
                        }
                    }
                }

                GlowCard {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: "Runtime")
                        HStack {
                            Text("Provider:").foregroundColor(CyberColor.textMuted).font(.system(size: 12))
                            Text(socketClient.runtimeProvider.isEmpty ? "default" : providerLabel(for: socketClient.runtimeProvider))
                                .font(.system(size: 12, weight: .semibold, design: .monospaced)).foregroundColor(CyberColor.textSecondary)
                        }
                        HStack {
                            Text("Model:").foregroundColor(CyberColor.textMuted).font(.system(size: 12))
                            Text(socketClient.runtimeModel.isEmpty ? "default" : socketClient.runtimeModel)
                                .font(.system(size: 12, weight: .semibold, design: .monospaced)).foregroundColor(CyberColor.textSecondary)
                        }
                        Button(tx("Refresh Runtime", "Refresh Runtime")) { socketClient.queryRuntimeConfig() }
                            .buttonStyle(.bordered).tint(CyberColor.cyan.opacity(0.7))
                    }
                }

                GlowCard {
                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel(text: tx("Về ứng dụng", "About"))
                        HStack { Text("App:").foregroundColor(CyberColor.textMuted).font(.system(size: 12)); Text("OmniState Native").font(.system(size: 12, weight: .semibold)).foregroundColor(CyberColor.textPrimary) }
                        HStack { Text("Version:").foregroundColor(CyberColor.textMuted).font(.system(size: 12)); Text("0.1.0").font(.system(size: 12, weight: .medium, design: .monospaced)).foregroundColor(CyberColor.textSecondary) }
                        HStack { Text("Runtime:").foregroundColor(CyberColor.textMuted).font(.system(size: 12)); Text("Swift / SPM").font(.system(size: 12, weight: .medium, design: .monospaced)).foregroundColor(CyberColor.textSecondary) }
                        HStack { Text("Backend:").foregroundColor(CyberColor.textMuted).font(.system(size: 12)); Text("Node.js + Rust N-API").font(.system(size: 12, weight: .medium, design: .monospaced)).foregroundColor(CyberColor.textSecondary) }
                        HStack { Text("License:").foregroundColor(CyberColor.textMuted).font(.system(size: 12)); Text("MIT").font(.system(size: 12, weight: .medium)).foregroundColor(CyberColor.textSecondary) }
                    }
                }
            }
            .padding(18)
        }
    }

    // MARK: ========== Device Pairing ==========

    private var connectView: some View {
        VStack(alignment: .leading, spacing: 14) {
            GlowCard {
                VStack(alignment: .leading, spacing: 10) {
                    SectionLabel(text: "Phone Pairing")
                    HStack(spacing: 10) {
                        if let pin = deviceManager.currentPIN {
                            Text(pin).font(.system(size: 24, weight: .bold, design: .monospaced))
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(CyberColor.cyan.opacity(0.12)).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(CyberColor.cyan.opacity(0.3), lineWidth: 1))
                        } else if deviceManager.isLoadingPIN {
                            ProgressView().tint(CyberColor.cyan)
                        } else {
                            Text("PIN unavailable").foregroundColor(CyberColor.textMuted)
                        }
                        if let expiry = deviceManager.pinExpiresAt {
                            Text("Expires: \(expiry.formatted(date: .omitted, time: .shortened))").foregroundColor(CyberColor.textMuted).font(.system(size: 11))
                        }
                    }
                    HStack(spacing: 10) {
                        Button("Generate PIN") { Task { await deviceManager.generatePIN() } }
                        Button("Refresh") { Task { await deviceManager.fetchDevices() } }
                    }
                    .buttonStyle(.bordered).tint(CyberColor.cyan.opacity(0.7))
                }
            }

            GlowCard {
                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: "Paired Devices")
                    if deviceManager.devices.isEmpty {
                        Text("No paired devices").foregroundColor(CyberColor.textMuted)
                    } else {
                        ForEach(deviceManager.devices) { device in
                            HStack {
                                Label(device.deviceName, systemImage: device.systemIcon).foregroundColor(CyberColor.textPrimary)
                                Spacer()
                                Text(device.lastSeenRelative).font(.caption).foregroundColor(CyberColor.textMuted)
                            }.padding(.vertical, 3)
                        }

                        Picker("Revoke", selection: $selectedDeviceID) {
                            Text("Select").tag(Optional<String>.none)
                            ForEach(deviceManager.devices) { d in Text(d.deviceName).tag(Optional(d.id)) }
                        }.pickerStyle(.menu)

                        Button("Revoke") {
                            guard let id = selectedDeviceID else { return }
                            Task { await deviceManager.revokeDevice(id: id); await deviceManager.fetchDevices() }
                        }.disabled(selectedDeviceID == nil).buttonStyle(.bordered)
                    }
                }
            }
        }
    }

    // MARK: ========== Shared Helpers ==========

    private func gaugeMetricCard(title: String, value: Double, tint: Color) -> some View {
        GlowCard(glow: tint.opacity(0.2)) {
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundColor(CyberColor.textMuted)
                HStack(spacing: 10) {
                    CyberGauge(value: value, tint: tint, size: 44)
                    Text("\(Int(value))%")
                        .font(.system(size: 24, weight: .heavy, design: .rounded))
                        .foregroundColor(CyberColor.textPrimary)
                }
                // Progress bar
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.06)).frame(height: 4)
                        Capsule()
                            .fill(LinearGradient(colors: [tint.opacity(0.6), tint], startPoint: .leading, endPoint: .trailing))
                            .frame(width: max(0, geo.size.width * CGFloat(value) / 100.0), height: 4)
                            .shadow(color: tint.opacity(0.4), radius: 3)
                    }
                }.frame(height: 4)
            }
        }
    }

    private func gaugeInfoCard(label: String, value: String, icon: String, color: Color, pct: Double? = nil) -> some View {
        GlowCard(glow: color.opacity(0.2)) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: icon).font(.system(size: 13)).foregroundColor(color)
                    Text(label.uppercased()).font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundColor(CyberColor.textMuted)
                    Spacer()
                    if let p = pct {
                        CyberGauge(value: p, tint: color, size: 36, lineWidth: 3)
                    }
                }
                Text(value)
                    .font(.system(size: 18, weight: .heavy, design: .rounded))
                    .foregroundColor(CyberColor.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
    }

    private func healthStatusTile(status: String) -> some View {
        let color = status == "healthy" ? CyberColor.green : status == "degraded" ? CyberColor.orange : CyberColor.red
        return GlowCard(glow: color.opacity(0.25)) {
            VStack(alignment: .leading, spacing: 8) {
                Text(tx("SỨC KHỎE", "HEALTH"))
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundColor(CyberColor.textMuted)
                HStack(spacing: 8) {
                    Circle().fill(color).frame(width: 10, height: 10)
                        .shadow(color: color.opacity(0.6), radius: 6)
                    Text(status.capitalized)
                        .font(.system(size: 18, weight: .heavy, design: .rounded))
                        .foregroundColor(color)
                }
            }
        }
    }

    private func navTile(
        _ title: String, subtitle: String, icon: String, glow: Color, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(glow.opacity(0.15))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(glow.opacity(0.3), lineWidth: 1))
                    Image(systemName: icon).font(.system(size: 14, weight: .bold)).foregroundColor(glow)
                }
                .frame(width: 28, height: 28)
                .shadow(color: glow.opacity(0.3), radius: 6)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 13, weight: .bold)).foregroundColor(CyberColor.textPrimary)
                    Text(subtitle).font(.system(size: 11, weight: .medium)).foregroundColor(CyberColor.textMuted)
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .background(CyberColor.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(glow.opacity(0.2), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func alertItem(icon: String, title: String, detail: String, tone: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundColor(tone).shadow(color: tone.opacity(0.4), radius: 4)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 12, weight: .bold)).foregroundColor(CyberColor.textPrimary)
                Text(detail).font(.system(size: 11, weight: .medium)).foregroundColor(CyberColor.textMuted).lineLimit(2)
            }
            Spacer()
        }
        .padding(10)
        .background(tone.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(tone.opacity(0.2), lineWidth: 1))
    }

    private func quickActionButton(_ label: String, goal: String) -> some View {
        Button {
            socketClient.sendTask(goal: goal, conversationId: selectedConversationID)
            page = .chat
        } label: {
            HStack {
                Text(label).font(.system(size: 12, weight: .semibold)).foregroundColor(CyberColor.textPrimary)
                Spacer()
                HStack(spacing: 4) {
                    Image(systemName: "play.fill").font(.system(size: 8))
                    Text(tx("Chạy", "Run")).font(.system(size: 11, weight: .bold))
                }
                .foregroundColor(CyberColor.cyan)
            }
            .padding(.vertical, 8).padding(.horizontal, 10)
            .background(CyberColor.glassBg)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(CyberColor.glassBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: ========== Actions ==========

    private func toggleVoiceRecording() {
        if !voiceCaptureService.isAuthorized {
            voiceCaptureService.requestPermissionsIfNeeded()
            return
        }
        if !voiceCaptureService.isRecording {
            let locale = isEnglish ? "en-US" : "vi-VN"
            voiceCaptureService.startRecording(localeIdentifier: locale)
        } else {
            voiceCaptureService.stopRecording()
            let transcript = voiceCaptureService.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
            if socketClient.voiceAutoExecute, !transcript.isEmpty {
                promptText = transcript
                sendPromptFromSelectedSession()
                page = .chat
            }
        }
    }

    private func runPrimaryTaskFromTopbar() {
        let fallback = "Analyze current system state and suggest 3 priority actions"
        let goal = promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? fallback : promptText
        socketClient.sendTask(goal: goal, conversationId: selectedConversationID)
        page = .chat
    }

    private func createSession() {
        let id = "session-\(UUID().uuidString.lowercased())"
        sessions.append(NativeConversation(id: id, title: "Session \(sessions.count + 1)", provider: socketClient.runtimeProvider, model: socketClient.runtimeModel, memorySummary: "", memoryLog: []))
        selectedConversationID = id
    }

    private func deleteSessionLocal(id: String) {
        sessions.removeAll { $0.id == id }
        if selectedConversationID == id {
            selectedConversationID = sessions.first?.id
        }
    }

    private func applyRuntimeForSelectedSession() {
        guard let idx = selectedSessionIndex else { return }
        let provider = sessions[idx].provider.trimmingCharacters(in: .whitespacesAndNewlines)
        let model = sessions[idx].model.trimmingCharacters(in: .whitespacesAndNewlines)
        if !provider.isEmpty { socketClient.setRuntimeConfig(key: "provider", value: provider) }
        if !model.isEmpty { socketClient.setRuntimeConfig(key: "model", value: model) }
    }

    private func sendPromptFromSelectedSession() {
        let text = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        applyRuntimeForSelectedSession()

        var goal = text
        if let idx = selectedSessionIndex {
            let session = sessions[idx]
            goal = buildGoalWithMemory(goal: text, session: session)
            sessions[idx].memoryLog.insert("USER: \(text)", at: 0)
            sessions[idx].memoryLog = Array(sessions[idx].memoryLog.prefix(40))
            sessions[idx].memorySummary = summarizeMemory(for: sessions[idx])
        }

        let conversationId = selectedSessionIndex.map { sessions[$0].id }
        socketClient.sendTask(goal: goal, conversationId: conversationId)
        promptText = ""
        syncAllMemoryToBackend()
    }

    private var selectedSessionTranscript: [String] {
        guard let idx = selectedSessionIndex else { return [] }
        return Array(sessions[idx].memoryLog.reversed())
    }

    private func captureLatestSocketMessage() {
        guard let last = socketClient.messages.last else { return }
        if last.role.lowercased() == "user" { return }

        let targetConversationID = socketClient.activeConversationIdForLatestMessage ?? selectedConversationID
        guard let targetConversationID,
              let idx = sessions.firstIndex(where: { $0.id == targetConversationID }) else { return }

        let entry = "\(last.role.uppercased()): \(last.text)"
        if sessions[idx].memoryLog.first != entry {
            sessions[idx].memoryLog.insert(entry, at: 0)
            sessions[idx].memoryLog = Array(sessions[idx].memoryLog.prefix(40))
            sessions[idx].memorySummary = summarizeMemory(for: sessions[idx])
        }
    }

    private func buildGoalWithMemory(goal: String, session: NativeConversation) -> String {
        let summary = session.memorySummary.isEmpty ? "(empty)" : session.memorySummary
        let shared = sharedMemorySummary.isEmpty ? "(empty)" : sharedMemorySummary
        return """
        [Native Session Context]
        sessionId: \(session.id)
        sessionName: \(session.title)
        sharedMemorySummary: \(shared)
        sessionMemorySummary: \(summary)

        [User Goal]
        \(goal)
        """
    }

    private func summarizeMemory(for session: NativeConversation) -> String {
        let recent = session.memoryLog.prefix(6).joined(separator: " | ")
        return recent.isEmpty ? "No memory yet" : recent
    }

    private func mergeMemoryFromBackend(_ map: [String: NativeSessionMemoryState]) {
        guard !map.isEmpty else { return }
        for (conversationId, state) in map {
            if let idx = sessions.firstIndex(where: { $0.id == conversationId }) {
                sessions[idx].memorySummary = state.memorySummary
                sessions[idx].memoryLog = state.memoryLog
                if let provider = state.provider, !provider.isEmpty { sessions[idx].provider = provider }
                if let model = state.model, !model.isEmpty { sessions[idx].model = model }
            } else {
                sessions.append(NativeConversation(id: conversationId, title: "Session \(conversationId.prefix(6))", provider: state.provider ?? "", model: state.model ?? "", memorySummary: state.memorySummary, memoryLog: state.memoryLog))
            }
        }
        if selectedConversationID == nil { selectedConversationID = sessions.first?.id }
    }

    private func syncAllMemoryToBackend() {
        let mapped = sessions.reduce(into: [String: NativeSessionMemoryState]()) { acc, session in
            acc[session.id] = NativeSessionMemoryState(memorySummary: session.memorySummary, memoryLog: session.memoryLog, provider: session.provider, model: session.model, updatedAt: Date().timeIntervalSince1970 * 1000)
        }
        socketClient.syncClaudeMem(sharedSummary: sharedMemorySummary, sharedLog: sessions.flatMap { $0.memoryLog.prefix(2) }, sessionStateByConversation: mapped)
    }

    private func summaryLine(for session: NativeConversation) -> String {
        let providerModel: String
        if session.provider.isEmpty && session.model.isEmpty {
            providerModel = "default runtime"
        } else {
            providerModel = "\(session.provider.isEmpty ? "default" : session.provider)/\(session.model.isEmpty ? "default" : session.model)"
        }
        return "\(providerModel) • \(session.memoryLog.count) entries"
    }

    private func formatSeconds(_ value: Double) -> String {
        let total = Int(value)
        return String(format: "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }
}
