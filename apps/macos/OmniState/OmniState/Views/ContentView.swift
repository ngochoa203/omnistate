import Foundation
import SwiftUI
import AppKit
import WebKit
import AVFoundation
import ApplicationServices
import UniformTypeIdentifiers
import Speech

// MARK: - Data models

struct NativeConversation: Identifiable, Equatable {
    let id: String
    var title: String
    var provider: String
    var model: String
    var memorySummary: String
    var memoryLog: [String]
}

private struct NativeComposerAttachment: Identifiable {
    let id: String
    let name: String
    let mimeType: String
    let size: Int
    let kind: String
    let textPreview: String?
    let dataBase64: String?
    let localPath: String
    let thumbnail: NSImage?
}

private struct InnovationExecutionItem: Identifiable {
    let id: String
    let title: String
    let category: String
    let goal: String
    var completed: Bool
}

private enum ComposerAttachmentFilter: String, CaseIterable {
    case all
    case image
    case text
    case file

    var title: String {
        switch self {
        case .all: return "All"
        case .image: return "Image"
        case .text: return "Text"
        case .file: return "File"
        }
    }
}

// MARK: - Page enum

private enum NativePage: String, CaseIterable, Identifiable {
    case dashboard, chat, voice, health, machine, config, screenTree, triggers, settings

    var id: String { rawValue }

    static var allCases: [NativePage] {
        [.dashboard, .chat, .voice, .health, .machine, .config, .screenTree, .triggers, .settings]
    }

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

private enum HealthFilterMode: String, CaseIterable {
    case all
    case warning
    case critical
}

private enum DashboardDensity: String, CaseIterable {
    case compact
    case comfortable
    case spacious
}

private enum ReplyStyle: String, CaseIterable {
    case brief
    case balanced
    case deep
    case action
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
            .font(.system(size: 10, weight: .heavy, design: .rounded))
            .foregroundColor(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
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
            .padding(15)
            .background(CyberColor.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: [glowColor.opacity(0.5), glowColor.opacity(0.15), glowColor.opacity(0.05)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ), lineWidth: 1
                    )
            )
            .shadow(color: glowColor.opacity(0.12), radius: 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: — Reusable: HeroSection

private struct HeroSection: View {
    let icon: String
    let iconColor: Color
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 15) {
            ZStack {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [iconColor.opacity(0.35), iconColor.opacity(0.12)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 15, style: .continuous)
                            .stroke(iconColor.opacity(0.4), lineWidth: 1)
                    )
                Image(systemName: icon)
                    .font(.system(size: 19, weight: .bold))
                    .foregroundColor(iconColor)
            }
            .frame(width: 44, height: 44)
            .shadow(color: iconColor.opacity(0.4), radius: 10)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 19, weight: .bold, design: .rounded))
                    .foregroundStyle(
                        LinearGradient(colors: [.white, iconColor.opacity(0.8)], startPoint: .leading, endPoint: .trailing)
                    )
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(CyberColor.textMuted)
                    .lineLimit(2)
            }
            Spacer()
        }
        .padding(17)
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
        HStack(spacing: 7) {
            Capsule()
                .fill(CyberColor.cyan.opacity(0.7))
                .frame(width: 14, height: 3)
                .shadow(color: CyberColor.cyan.opacity(0.35), radius: 3)

            Text(text.uppercased())
                .font(.system(size: 10, weight: .heavy, design: .monospaced))
                .foregroundColor(CyberColor.textSecondary)
                .tracking(1.2)
        }
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
    @State private var composerAttachments: [NativeComposerAttachment] = []
    @State private var composerAttachmentStatus = ""
    @State private var composerAttachmentFilter: ComposerAttachmentFilter = .all
    @State private var composerIsDragTarget = false
    @State private var assistantExpandedEntries: Set<String> = []
    @State private var sharedMemorySummary = ""
    @State private var selectedLanguage = "Tiếng Việt"
    @State private var selectedModel = ""
    @State private var pulseActive = false
    @State private var scanlineOffset: CGFloat = -280
    @State private var voiceMode = 0
    @State private var voiceBarsPhase: Double = 0
    @State private var settingsAutoSyncMemory = true
    @State private var settingsShowSystemMessages = true
    @State private var settingsCompactAssistantReplies = false
    @State private var settingsEnableDesktopHints = true
    @State private var configSelectedProviderId = ""
    @State private var configSelectedModel = ""
    @State private var newProviderId = ""
    @State private var newProviderKind = "openai-compatible"
    @State private var newProviderBaseURL = ""
    @State private var newProviderApiKey = ""
    @State private var newProviderModelsCSV = ""
    @State private var newProviderActivate = true
    @State private var newProviderAddFallback = false
    @State private var configFormMessage = ""
    @State private var chatQuickFind = ""
    @State private var providerQuickFilter = ""
    @State private var healthFilterMode: HealthFilterMode = .all
    @State private var dashboardDensity: DashboardDensity = .comfortable
    @State private var showAdvancedPanels = true
    @State private var inlineStatusMessage = ""
    @State private var showChatSettingsSheet = false
    @State private var voiceConversationEntries: [String] = []
    @State private var voiceSilenceTask: Task<Void, Never>?
    @State private var voiceFinalizeTask: Task<Void, Never>?
    @State private var lastVoiceTranscriptSubmitted: String = ""
    @State private var lastAssistantSpeechKey: String = ""
    @State private var voiceInputRouteMode = "chat"
    @State private var voiceTtsEnabled = true
    @State private var voiceWakeListenerEnabled = true
    @State private var wakeCommandArmedUntil: Date?
    @State private var wakeBubbleVisible = false
    @State private var wakeBubbleText = ""
    @State private var voiceWakeRestartTask: Task<Void, Never>?
    @State private var wakeArmTimeoutTask: Task<Void, Never>?
    @State private var providerEditBaseURL = ""
    @State private var providerEditModelsCSV = ""
    @State private var providerEditApiKey = ""
    @State private var providerEditKind = "openai-compatible"
    @State private var providerEditMessage = ""
    @State private var smartReplyFormatting = true
    @State private var markdownReplyRendering = true
    @State private var quickFollowupAutoSend = false
    @State private var autoReplyStyleByIntent = true
    @State private var replyStyle: ReplyStyle = .balanced
    @State private var chatRouteMode = "auto"
    @State private var viewportWidth: CGFloat = 1280
    @State private var transitionForward = true
    @State private var pageContentReady = true
    @State private var innovationExecutionQueue: [InnovationExecutionItem] = []
    @State private var innovationAutopilotRunning = false
    @State private var innovationAutoExpanded = false
    @State private var innovationLastExecutedTitle = ""

    private static let sharedSpeechSynthesizer = AVSpeechSynthesizer()

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

    private var panelSpacing: CGFloat {
        switch dashboardDensity {
        case .compact: return 10
        case .comfortable: return 16
        case .spacious: return 22
        }
    }

    private var pagePadding: CGFloat {
        if viewportWidth < 980 { return 12 }
        switch dashboardDensity {
        case .compact: return 14
        case .comfortable: return 18
        case .spacious: return 24
        }
    }

    private var cardContentSpacing: CGFloat {
        max(8, panelSpacing - 6)
    }

    private var sectionGap: CGFloat {
        max(10, panelSpacing - 4)
    }

    private var compactGridSpacing: CGFloat {
        max(8, panelSpacing - 7)
    }

    private var regularGridSpacing: CGFloat {
        max(10, panelSpacing - 5)
    }

    private var isNarrowLayout: Bool {
        viewportWidth < 1180
    }

    private var dashboardQuickNavColumns: [GridItem] {
        let count = viewportWidth < 1100 ? 2 : viewportWidth < 1450 ? 3 : 4
        return Array(repeating: GridItem(.flexible(), spacing: regularGridSpacing), count: count)
    }

    private var dashboardMetricsColumns: [GridItem] {
        let count = viewportWidth < 1100 ? 2 : 4
        return Array(repeating: GridItem(.flexible(), spacing: regularGridSpacing), count: count)
    }

    private var healthSensorColumns: [GridItem] {
        let count = viewportWidth < 1050 ? 1 : viewportWidth < 1450 ? 2 : 3
        return Array(repeating: GridItem(.flexible(), spacing: regularGridSpacing), count: count)
    }

    private var machineInfoColumns: [GridItem] {
        let count = viewportWidth < 1050 ? 1 : viewportWidth < 1400 ? 2 : 3
        return Array(repeating: GridItem(.flexible(), spacing: regularGridSpacing), count: count)
    }

    private var quickCommandColumns: [GridItem] {
        let count = viewportWidth < 980 ? 2 : 3
        return Array(repeating: GridItem(.flexible(), spacing: compactGridSpacing), count: count)
    }

    private var pageTransition: AnyTransition {
        let move: Edge = transitionForward ? .trailing : .leading
        return .asymmetric(
            insertion: .move(edge: move).combined(with: .opacity),
            removal: .opacity
        )
    }

    private var filteredProviderOptions: [RuntimeProviderOption] {
        let query = providerQuickFilter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.isEmpty { return providerOptions }
        return providerOptions.filter { option in
            option.id.lowercased().contains(query) ||
            option.label.lowercased().contains(query) ||
            (option.baseURL?.lowercased().contains(query) ?? false)
        }
    }

    private var filteredHealthSensors: [NativeSensorData] {
        guard let report = socketClient.healthReport else { return [] }
        switch healthFilterMode {
        case .all:
            return report.sensors
        case .warning:
            return report.sensors.filter { $0.status == "warning" }
        case .critical:
            return report.sensors.filter { $0.status == "critical" }
        }
    }

    private var quickFindEntries: [String] {
        let query = chatQuickFind.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty, let idx = selectedSessionIndex else { return [] }
        return sessions[idx].memoryLog.filter { $0.lowercased().contains(query) }
    }

    private var selectedConfigProvider: RuntimeProviderOption? {
        providerOptions.first(where: { $0.id == configSelectedProviderId })
    }

    private var configModelOptions: [String] {
        if let selectedConfigProvider, !selectedConfigProvider.models.isEmpty {
            return selectedConfigProvider.models
        }
        return modelOptions
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

    private var isReplyStreaming: Bool {
        socketClient.currentTaskId != nil
    }

    private var isAccessibilityTrusted: Bool {
        AXIsProcessTrusted()
    }

    private var isScreenRecordingTrusted: Bool {
        if #available(macOS 10.15, *) {
            return CGPreflightScreenCaptureAccess()
        }
        return true
    }

    private var hasMicrophonePermission: Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    private var hasSpeechPermission: Bool {
        SFSpeechRecognizer.authorizationStatus() == .authorized
    }

    private var effectiveWakePhrase: String {
        let phrase = socketClient.voiceWakePhrase.trimmingCharacters(in: .whitespacesAndNewlines)
        return phrase.isEmpty ? "mimi" : phrase
    }

    private var wakePhraseCandidates: [String] {
        let separators = CharacterSet(charactersIn: ",;|\n")
        let configured = socketClient.voiceWakePhrase
            .components(separatedBy: separators)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        let fallback = ["mimi", "mi mi", "mimi oi", "mimi ơi", "hey mimi", "ok mimi"]
        let merged = configured.isEmpty ? fallback : configured + fallback

        var unique: [String] = []
        var seen = Set<String>()
        for phrase in merged {
            let normalized = normalizeTranscriptLine(phrase)
            guard !normalized.isEmpty, !seen.contains(normalized) else { continue }
            seen.insert(normalized)
            unique.append(phrase)
        }
        return unique
    }

    private var isEnglish: Bool { selectedLanguage == "English" }
    private func tx(_ vi: String, _ en: String) -> String { isEnglish ? en : vi }

    private func replyStyleLabel(_ style: ReplyStyle) -> String {
        switch style {
        case .brief: return tx("Ngắn", "Brief")
        case .balanced: return tx("Cân bằng", "Balanced")
        case .deep: return tx("Sâu", "Deep")
        case .action: return tx("Hành động", "Action")
        }
    }

    private func replyStyleInstruction(_ style: ReplyStyle? = nil) -> String {
        switch style ?? replyStyle {
        case .brief:
            return tx("Trả lời ngắn, tối đa 6 gạch đầu dòng, đi thẳng vào ý chính.", "Keep it concise, max 6 bullets, focus on essentials.")
        case .balanced:
            return tx("Trả lời rõ ràng, cân bằng giữa tóm tắt và chi tiết thực thi.", "Provide a clear response balancing summary and actionable detail.")
        case .deep:
            return tx("Trả lời chuyên sâu, có cấu trúc theo mục và giải thích kỹ trade-off.", "Provide a detailed structured answer with trade-offs and reasoning.")
        case .action:
            return tx("Trả lời theo checklist hành động ưu tiên, mỗi bước nêu kết quả mong đợi.", "Respond as a prioritized action checklist with expected outcomes.")
        }
    }

    private func inferReplyStyle(for prompt: String) -> ReplyStyle {
        let lower = prompt.lowercased()

        let deepSignals = ["kiến trúc", "architecture", "so sánh", "trade-off", "phân tích", "analyze", "chi tiết", "detailed", "benchmark"]
        let briefSignals = ["tóm tắt", "summary", "brief", "ngắn", "one-liner", "quick"]
        let actionSignals = ["fix", "sửa", "triển khai", "implement", "làm gì", "next step", "todo", "kế hoạch", "plan", "checklist"]

        if deepSignals.contains(where: { lower.contains($0) }) { return .deep }
        if actionSignals.contains(where: { lower.contains($0) }) { return .action }
        if briefSignals.contains(where: { lower.contains($0) }) { return .brief }
        return .balanced
    }

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

    private func pageColor(_ p: NativePage) -> Color {
        switch p {
        case .dashboard: return CyberColor.cyan
        case .chat: return CyberColor.blue
        case .voice: return CyberColor.cyan
        case .health: return CyberColor.pink
        case .machine: return CyberColor.cyan
        case .config: return CyberColor.purple
        case .screenTree: return CyberColor.purple
        case .triggers: return CyberColor.orange
        case .settings: return CyberColor.green
        }
    }

    private var pageAccent: Color {
        pageColor(page)
    }

    private var pageAccentSecondary: Color {
        switch page {
        case .dashboard, .voice, .machine: return CyberColor.blue
        case .chat: return CyberColor.cyan
        case .health: return CyberColor.red
        case .config, .screenTree: return CyberColor.cyan
        case .triggers: return CyberColor.pink
        case .settings: return CyberColor.blue
        }
    }

    private var healthAmbientColor: Color {
        guard let overall = socketClient.healthReport?.overall else { return CyberColor.cyan }
        if overall == "healthy" { return CyberColor.green }
        if overall == "degraded" { return CyberColor.orange }
        return CyberColor.red
    }

    private var sidebarWidth: CGFloat {
        viewportWidth < 1080 ? 204 : 220
    }

    private var chatSidebarWidth: CGFloat {
        viewportWidth < 1150 ? 204 : 220
    }

    private var assistantBubbleMaxWidth: CGFloat {
        viewportWidth < 1180 ? 560 : 720
    }

    private var innovationCompletedCount: Int {
        innovationExecutionQueue.filter { $0.completed }.count
    }

    private var innovationTotalCount: Int {
        innovationExecutionQueue.count
    }

    private var innovationProgressRatio: Double {
        guard innovationTotalCount > 0 else { return 0 }
        return Double(innovationCompletedCount) / Double(innovationTotalCount)
    }

    private var canSendComposerMessage: Bool {
        !promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !composerAttachments.isEmpty
    }

    private var filteredComposerAttachments: [NativeComposerAttachment] {
        switch composerAttachmentFilter {
        case .all:
            return composerAttachments
        case .image:
            return composerAttachments.filter { $0.kind == "image" }
        case .text:
            return composerAttachments.filter { $0.kind == "text" }
        case .file:
            return composerAttachments.filter { $0.kind == "file" }
        }
    }

    private var composerAttachmentTotalBytes: Int {
        composerAttachments.reduce(0) { $0 + $1.size }
    }

    private var chatQuickPromptSuggestions: [String] {
        [
            tx("Tóm tắt màn hình hiện tại thành checklist hành động", "Summarize current screen into an actionable checklist"),
            tx("Đọc nội dung file đính kèm và rút 5 ý chính", "Read attached files and extract 5 key points"),
            tx("Tạo plan 3 bước để xử lý task này", "Create a 3-step plan to handle this task"),
            tx("So sánh 2 phương án và khuyến nghị", "Compare 2 options and recommend one")
        ]
    }

    // MARK: - Body

    var body: some View {
        GeometryReader { geo in
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
                    .background(
                        LinearGradient(
                            colors: [pageAccent.opacity(0.08), pageAccentSecondary.opacity(0.03), Color.clear],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                }
            }
            .onAppear {
                viewportWidth = geo.size.width
            }
            .onChange(of: geo.size.width) { newWidth in
                viewportWidth = newWidth
            }
        }
        .task {
            await deviceManager.fetchDevices()
            socketClient.connect()
            await PermissionBootstrapper.shared.requestAllInitialPermissions(force: true)
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
            voiceSilenceTask?.cancel()
        }
        .onChange(of: socketClient.sessionMemoryByConversation) { mergeMemoryFromBackend($0) }
        .onChange(of: socketClient.sharedMemorySummary) { sharedMemorySummary = $0 }
        .onChange(of: socketClient.messages.count) { _ in captureLatestSocketMessage() }
        .onChange(of: voiceCaptureService.transcript) { _ in handleVoiceTranscriptChange() }
        .onChange(of: voiceWakeListenerEnabled) { enabled in
            if enabled {
                startWakeListenerIfNeeded()
            } else {
                stopWakeListener(resetState: true)
            }
        }
        .onChange(of: configSelectedProviderId) { _ in
            hydrateProviderEditorFromSelectedProvider()
        }
        .onAppear {
            pulseActive = false
            scanlineOffset = -280
            withAnimation(.easeInOut(duration: 1.25).repeatForever(autoreverses: true)) { pulseActive = true }
            withAnimation(.linear(duration: 4.2).repeatForever(autoreverses: false)) { scanlineOffset = 1200 }
            if socketClient.voiceWakeEnabled && voiceWakeListenerEnabled {
                startWakeListenerIfNeeded()
            }
        }
        .overlay(alignment: .topTrailing) {
            if wakeBubbleVisible {
                HStack(spacing: 8) {
                    Image(systemName: "ear.fill")
                        .foregroundColor(CyberColor.cyan)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tx("Đang lắng nghe lệnh...", "Listening for command..."))
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(CyberColor.textPrimary)
                        Text(wakeBubbleText)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(CyberColor.textMuted)
                            .lineLimit(2)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(CyberColor.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(CyberColor.cyan.opacity(0.35), lineWidth: 1))
                .shadow(color: CyberColor.cyan.opacity(0.3), radius: 10)
                .padding(.top, 12)
                .padding(.trailing, 14)
            }
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
            Circle().fill(pageAccent.opacity(0.1)).frame(width: 420, height: 420).blur(radius: 110).offset(x: 320, y: -180)

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
                        Button { setPage(item) } label: { navItemRow(item) }
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
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
        .frame(width: sidebarWidth)
    }

    private func navItemRow(_ item: NativePage) -> some View {
        let isActive = page == item
        let tone = pageColor(item)
        return HStack(spacing: 0) {
            // Accent bar
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(isActive ? tone : Color.clear)
                .frame(width: 3, height: 20)
                .shadow(color: isActive ? tone.opacity(0.5) : .clear, radius: 6)
                .padding(.trailing, 8)

            Image(systemName: item.icon)
                .font(.system(size: 12, weight: .semibold))
                .frame(width: 18)
                .foregroundColor(isActive ? tone : CyberColor.textSecondary)

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
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8).padding(.vertical, 7)
        .background(isActive ? tone.opacity(0.1) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(isActive ? tone.opacity(0.22) : Color.clear, lineWidth: 1))
    }

    // MARK: - Topbar

    private var topbar: some View {
        HStack {
            Text(pageLabel(page))
                .font(.system(size: isNarrowLayout ? 15 : 17, weight: .bold, design: .rounded))
                .foregroundStyle(LinearGradient(colors: [.white, pageAccent.opacity(0.8)], startPoint: .leading, endPoint: .trailing))
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
                    .background(LinearGradient(colors: [pageAccent.opacity(0.95), CyberColor.blue.opacity(0.75)], startPoint: .leading, endPoint: .trailing))
                    .clipShape(Capsule())
                    .shadow(color: pageAccent.opacity(0.35), radius: 8)
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
        ZStack {
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
        .id(page)
        .transition(pageTransition)
        .opacity(pageContentReady ? 1 : 0.94)
        .offset(y: pageContentReady ? 0 : 10)
        .scaleEffect(pageContentReady ? 1 : 0.99)
        .shadow(color: pageAccent.opacity(0.12), radius: pageContentReady ? 0 : 16)
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(pageAccent.opacity(0.12), lineWidth: 1)
                .padding(6)
                .allowsHitTesting(false)
        )
        .animation(.spring(response: 0.34, dampingFraction: 0.86), value: pageContentReady)
        .animation(.easeInOut(duration: 0.24), value: page)
    }

    private func stagedSection<Content: View>(_ index: Int, @ViewBuilder content: () -> Content) -> some View {
        content()
            .opacity(pageContentReady ? 1 : 0)
            .offset(y: pageContentReady ? 0 : CGFloat(10 + index * 2))
            .animation(
                .spring(response: 0.36, dampingFraction: 0.86)
                    .delay(Double(index) * 0.035),
                value: pageContentReady
            )
    }

    // MARK: ========== Dashboard ==========

    private var dashboardView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: panelSpacing) {
                // Hero
                stagedSection(0) {
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
                        .padding(pagePadding - 2)
                    }
                }

                // Quick nav tiles
                stagedSection(1) {
                    LazyVGrid(columns: dashboardQuickNavColumns, spacing: regularGridSpacing) {
                        navTile(tx("AI Chat", "AI Chat"), subtitle: tx("Ngôn ngữ tự nhiên", "Natural language"), icon: "message.fill", glow: CyberColor.blue) { setPage(.chat) }
                        navTile(tx("Giọng nói", "Voice"), subtitle: tx("Nói với OmniState", "Speak to OmniState"), icon: "waveform.circle.fill", glow: CyberColor.cyan) { setPage(.voice) }
                        navTile(tx("Sức khỏe", "Health"), subtitle: tx("Chẩn đoán", "Diagnostics"), icon: "heart.text.square.fill", glow: CyberColor.pink) { setPage(.health) }
                        navTile(tx("Cấu hình", "Config"), subtitle: "Provider & model", icon: "slider.horizontal.3", glow: CyberColor.purple) { setPage(.config) }
                    }
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

                stagedSection(2) {
                    LazyVGrid(columns: dashboardMetricsColumns, spacing: regularGridSpacing) {
                        gaugeMetricCard(title: "CPU", value: cpuVal, tint: CyberColor.blue)
                        gaugeMetricCard(title: tx("BỘ NHỚ", "MEMORY"), value: Double(memPct), tint: memPct > 85 ? CyberColor.red : memPct > 70 ? CyberColor.orange : CyberColor.cyan)
                        gaugeMetricCard(title: "DISK", value: Double(diskPct), tint: diskPct > 90 ? CyberColor.red : diskPct > 70 ? CyberColor.orange : CyberColor.green)
                        healthStatusTile(status: healthStatus)
                    }
                }

                // Battery + Network + Alerts
                if showAdvancedPanels {
                HStack(alignment: .top, spacing: sectionGap) {
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

                        if let err = gatewayManager.lastError, !err.isEmpty {
                            Text(err)
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundColor(CyberColor.orange)
                                .lineLimit(3)
                        }
                    }
                }
            }
            .padding(pagePadding)
            .frame(maxWidth: .infinity, alignment: .leading)
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
                    Button {
                        clearAllSessions()
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(CyberColor.orange)
                    }
                    .buttonStyle(.plain)
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
            .frame(width: chatSidebarWidth)
            .background(
                LinearGradient(
                    colors: [pageAccent.opacity(0.14), Color.black.opacity(0.35)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )

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
                    .background(
                        LinearGradient(
                            colors: [pageAccent.opacity(0.12), Color.black.opacity(0.22)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .overlay(Rectangle().fill(pageAccent.opacity(0.16)).frame(height: 1), alignment: .bottom)
                }

                HStack(spacing: 8) {
                    Button {
                        showChatSettingsSheet = true
                    } label: {
                        Label(tx("Hội thoại", "Conversation"), systemImage: "gearshape.fill")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)

                    Picker("", selection: $chatRouteMode) {
                        Text(tx("Auto", "Auto")).tag("auto")
                        Text(tx("Chat", "Chat")).tag("chat")
                        Text(tx("Task", "Task")).tag("task")
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 220)

                    Button(tx("Copy summary", "Copy summary")) {
                        guard let idx = selectedSessionIndex else { return }
                        copyToClipboard(sessions[idx].memorySummary)
                        inlineStatusMessage = tx("Đã copy summary phiên", "Session summary copied")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)

                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .sheet(isPresented: $showChatSettingsSheet) {
                    chatSettingsSheet
                }

                // Messages
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            if selectedSessionTranscript.isEmpty {
                                emptyStateChatView
                            }
                            ForEach(Array(selectedSessionTranscript.enumerated()), id: \.offset) { idx, line in
                                chatBubble(index: idx, line: line)
                                    .id(idx)
                            }
                            if isReplyStreaming {
                                typingIndicatorBubble
                            }
                        }
                        .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 6)
                    }
                    .background(
                        LinearGradient(
                            colors: [pageAccent.opacity(0.03), Color.clear],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .onChange(of: selectedSessionTranscript.count) { _ in
                        withAnimation { proxy.scrollTo(selectedSessionTranscript.count - 1, anchor: .bottom) }
                    }
                    .onChange(of: isReplyStreaming) { _ in
                        withAnimation { proxy.scrollTo(selectedSessionTranscript.count - 1, anchor: .bottom) }
                    }
                }

                // Input bar
                VStack(alignment: .leading, spacing: 8) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 7) {
                            ForEach(chatQuickPromptSuggestions, id: \.self) { suggestion in
                                Button {
                                    promptText = suggestion
                                } label: {
                                    Text(suggestion)
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundColor(CyberColor.textSecondary)
                                        .lineLimit(1)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(CyberColor.glassBg)
                                        .clipShape(Capsule())
                                        .overlay(Capsule().stroke(CyberColor.glassBorder, lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    if !composerAttachments.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 8) {
                                    ForEach(ComposerAttachmentFilter.allCases, id: \.self) { filter in
                                        Button {
                                            composerAttachmentFilter = filter
                                        } label: {
                                            Text(filter.title)
                                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                                                .foregroundColor(composerAttachmentFilter == filter ? CyberColor.cyan : CyberColor.textMuted)
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 4)
                                                .background(composerAttachmentFilter == filter ? CyberColor.cyan.opacity(0.15) : CyberColor.glassBg)
                                                .clipShape(Capsule())
                                                .overlay(Capsule().stroke(composerAttachmentFilter == filter ? CyberColor.cyan.opacity(0.35) : CyberColor.glassBorder, lineWidth: 1))
                                        }
                                        .buttonStyle(.plain)
                                    }

                                    Spacer(minLength: 6)

                                    Text("\(composerAttachments.count) • \(humanReadableByteCount(composerAttachmentTotalBytes))")
                                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                                        .foregroundColor(CyberColor.textMuted)

                                    Button {
                                        composerAttachments = []
                                        composerAttachmentStatus = ""
                                    } label: {
                                        Label(tx("Clear all", "Clear all"), systemImage: "trash")
                                            .font(.system(size: 9, weight: .bold))
                                            .foregroundColor(CyberColor.orange)
                                    }
                                    .buttonStyle(.plain)
                                }

                                HStack(spacing: 8) {
                                ForEach(filteredComposerAttachments) { attachment in
                                    HStack(spacing: 8) {
                                        if let thumb = attachment.thumbnail {
                                            Image(nsImage: thumb)
                                                .resizable()
                                                .scaledToFill()
                                                .frame(width: 28, height: 28)
                                                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                                        } else {
                                            Image(systemName: attachment.kind == "text" ? "doc.text" : "doc")
                                                .font(.system(size: 12, weight: .bold))
                                                .foregroundColor(CyberColor.cyan)
                                                .frame(width: 28, height: 28)
                                                .background(CyberColor.cyan.opacity(0.1))
                                                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                                        }

                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(attachment.name)
                                                .font(.system(size: 11, weight: .semibold))
                                                .foregroundColor(CyberColor.textPrimary)
                                                .lineLimit(1)
                                            Text("\(humanReadableByteCount(attachment.size)) • \(attachment.mimeType)")
                                                .font(.system(size: 9, weight: .medium))
                                                .foregroundColor(CyberColor.textMuted)
                                                .lineLimit(1)
                                        }

                                        Button {
                                            removeComposerAttachment(id: attachment.id)
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .font(.system(size: 11, weight: .bold))
                                                .foregroundColor(CyberColor.textMuted)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 6)
                                    .background(CyberColor.glassBg)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(CyberColor.glassBorder, lineWidth: 1))
                                }
                                if filteredComposerAttachments.isEmpty {
                                    Text(tx("Không có file trong bộ lọc này", "No attachments in this filter"))
                                        .font(.system(size: 10, weight: .medium))
                                        .foregroundColor(CyberColor.textMuted)
                                        .padding(.vertical, 6)
                                }
                                }
                            }
                        }
                    }

                    if !composerAttachmentStatus.isEmpty {
                        Text(composerAttachmentStatus)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(CyberColor.orange)
                            .lineLimit(2)
                    }

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

                        Button {
                            openComposerAttachmentPicker()
                        } label: {
                            ZStack {
                                Circle()
                                    .fill(LinearGradient(colors: [CyberColor.cyan.opacity(0.24), CyberColor.blue.opacity(0.18)], startPoint: .topLeading, endPoint: .bottomTrailing))
                                    .frame(width: 34, height: 34)
                                    .overlay(Circle().stroke(CyberColor.cyan.opacity(0.35), lineWidth: 1))
                                Image(systemName: "paperclip")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(CyberColor.cyan)
                                if !composerAttachments.isEmpty {
                                    Text("\(composerAttachments.count)")
                                        .font(.system(size: 8, weight: .heavy, design: .rounded))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 4)
                                        .padding(.vertical, 2)
                                        .background(CyberColor.blue)
                                        .clipShape(Capsule())
                                        .offset(x: 12, y: -12)
                                }
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
                                    .fill(canSendComposerMessage ?
                                          AnyShapeStyle(LinearGradient(colors: [CyberColor.cyan, CyberColor.blue], startPoint: .topLeading, endPoint: .bottomTrailing)) :
                                          AnyShapeStyle(Color.white.opacity(0.05)))
                                    .frame(width: 34, height: 34)
                                    .shadow(color: canSendComposerMessage ? CyberColor.cyan.opacity(0.35) : .clear, radius: 8)
                                Image(systemName: "arrow.up")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(canSendComposerMessage ? .white : CyberColor.textMuted)
                            }
                        }
                        .buttonStyle(.plain)
                        .keyboardShortcut(.return, modifiers: [.command])
                        .disabled(!canSendComposerMessage)
                    }
                }
                .padding(12)
                .background(Color.black.opacity(0.35))
                .overlay(Rectangle().fill(pageAccent.opacity(0.16)).frame(height: 1), alignment: .top)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(composerIsDragTarget ? CyberColor.cyan.opacity(0.55) : .clear, lineWidth: 1.5)
                        .padding(4)
                )
                .onDrop(of: [UTType.fileURL.identifier], isTargeted: $composerIsDragTarget) { providers in
                    handleComposerFileDrop(providers)
                }
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

            LazyVGrid(columns: quickCommandColumns, spacing: compactGridSpacing) {
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

    private var typingIndicatorBubble: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(CyberColor.cyan)
                    Text(tx("ASSISTANT", "ASSISTANT"))
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundColor(CyberColor.cyan.opacity(0.8))
                }
                HStack(spacing: 5) {
                    Circle().fill(CyberColor.cyan.opacity(0.85)).frame(width: 5, height: 5).scaleEffect(pulseActive ? 1.15 : 0.75)
                    Circle().fill(CyberColor.cyan.opacity(0.55)).frame(width: 5, height: 5).scaleEffect(pulseActive ? 0.85 : 1.1)
                    Circle().fill(CyberColor.cyan.opacity(0.35)).frame(width: 5, height: 5).scaleEffect(pulseActive ? 1.05 : 0.9)
                    Text(tx("Đang trả lời...", "Thinking..."))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(CyberColor.textSecondary)
                        .padding(.leading, 3)
                }
                .padding(10)
                .background(CyberColor.cyan.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(CyberColor.cyan.opacity(0.2), lineWidth: 1))
            }
            .frame(maxWidth: assistantBubbleMaxWidth, alignment: .leading)

            Spacer(minLength: 60)
        }
    }

    private func chatBubble(index: Int, line: String) -> some View {
        let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let role = parts.first.map(String.init) ?? "SYSTEM"
        let rawText = parts.count > 1 ? String(parts[1]).trimmingCharacters(in: .whitespaces) : line
        let (replyMode, text) = extractReplyModeMarker(from: rawText)
        let normalizedRole = role.lowercased()
        let isUser = normalizedRole.hasPrefix("user")
        let isSystem = normalizedRole.hasPrefix("system")
        let isAssistant = normalizedRole.hasPrefix("assistant")
        let effectiveMode: String? = {
            if isAssistant {
                return replyMode
            }
            if isUser {
                if normalizedRole.contains("task") { return "task" }
                if normalizedRole.contains("chat") { return "chat" }
                let mode = inferredRouteMode(for: text)
                return mode == "auto" ? nil : mode
            }
            return nil
        }()
        let bubbleColor: Color = isUser ? CyberColor.blue : isSystem ? CyberColor.orange : CyberColor.cyan
        let messageKey = "\(index)-\(line.hashValue)"
        let quickFind = chatQuickFind.trimmingCharacters(in: .whitespacesAndNewlines)
        let lineMatchesQuickFind = !quickFind.isEmpty && text.localizedCaseInsensitiveContains(quickFind)
        let isLongAssistantText = isAssistant && text.count > 380
        let isExpandedAssistantText = assistantExpandedEntries.contains(messageKey)
        let shouldTruncateAssistantText = isLongAssistantText && !isExpandedAssistantText
        let renderedText = isAssistant
            ? (smartReplyFormatting ? assistantMarkdownReply(text) : text)
            : text
        let displayedText = shouldTruncateAssistantText
            ? String(renderedText.prefix(380)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
            : renderedText
        let assistantAttributed = (isAssistant && markdownReplyRendering && !shouldTruncateAssistantText)
            ? attributedReply(from: renderedText)
            : nil
        let renderedImageURLs = extractRenderableImageURLs(from: text)

        return HStack(alignment: .bottom, spacing: 0) {
            if isUser { Spacer() }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if isAssistant {
                        Image(systemName: effectiveMode == "task" ? "cpu.fill" : "ellipsis.message.fill")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundColor(CyberColor.cyan)
                    } else if isSystem {
                        Image(systemName: "gearshape.2.fill")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundColor(CyberColor.orange)
                    } else {
                        Image(systemName: effectiveMode == "task" ? "terminal.fill" : "person.fill")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundColor(CyberColor.blue)
                    }

                    Text(role.uppercased())
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundColor(bubbleColor.opacity(0.78))

                    if let effectiveMode {
                        Text(effectiveMode.uppercased())
                            .font(.system(size: 8, weight: .heavy, design: .monospaced))
                            .foregroundColor(effectiveMode == "task" ? CyberColor.orange : CyberColor.green)
                    }
                }

                Group {
                    if let assistantAttributed {
                        Text(assistantAttributed)
                            .textSelection(.enabled)
                            .font(.system(size: 13, weight: .regular, design: .default))
                            .lineSpacing(2.2)
                    } else {
                        Text(displayedText)
                            .textSelection(.enabled)
                            .font(.system(size: 13, weight: isAssistant ? .medium : .regular, design: isAssistant ? .monospaced : .default))
                            .lineSpacing(isAssistant ? 2.4 : 2.0)
                    }
                }
                .lineLimit(settingsCompactAssistantReplies && isAssistant ? 8 : nil)
                .foregroundColor(CyberColor.textPrimary)
                .multilineTextAlignment(isUser ? .trailing : .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(11)
                .background(isUser ? CyberColor.blue.opacity(0.14) : (isAssistant ? CyberColor.cyan.opacity(0.08) : CyberColor.cardBg))
                .clipShape(RoundedRectangle(cornerRadius: isUser ? 14 : 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: isUser ? 14 : 12, style: .continuous)
                        .stroke(lineMatchesQuickFind ? CyberColor.orange.opacity(0.7) : bubbleColor.opacity(isAssistant ? 0.3 : 0.2), lineWidth: lineMatchesQuickFind ? 1.3 : 1)
                )
                .shadow(color: bubbleColor.opacity(0.1), radius: 8)
                .frame(maxWidth: isUser ? 420 : assistantBubbleMaxWidth, alignment: isUser ? .trailing : .leading)

                if isLongAssistantText {
                    Button {
                        if isExpandedAssistantText {
                            assistantExpandedEntries.remove(messageKey)
                        } else {
                            assistantExpandedEntries.insert(messageKey)
                        }
                    } label: {
                        Text(isExpandedAssistantText ? tx("Thu gọn", "Show less") : tx("Xem thêm", "Show more"))
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(CyberColor.cyan)
                    }
                    .buttonStyle(.plain)
                }

                if lineMatchesQuickFind {
                    HStack(spacing: 4) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 8, weight: .bold))
                        Text(tx("Khớp tìm nhanh", "Quick-find match"))
                            .font(.system(size: 9, weight: .bold))
                    }
                    .foregroundColor(CyberColor.orange)
                }

                if !renderedImageURLs.isEmpty {
                    VStack(alignment: isUser ? .trailing : .leading, spacing: 8) {
                        ForEach(renderedImageURLs, id: \.absoluteString) { url in
                            chatImagePreview(url: url)
                        }
                    }
                    .frame(maxWidth: isUser ? 420 : assistantBubbleMaxWidth, alignment: isUser ? .trailing : .leading)
                }

                if isAssistant {
                    HStack(spacing: 6) {
                        miniReplyActionButton(icon: "doc.on.doc", label: tx("Copy", "Copy")) {
                            copyToClipboard(text)
                            inlineStatusMessage = tx("Đã copy câu trả lời", "Reply copied")
                        }
                        miniReplyActionButton(icon: "arrow.triangle.branch", label: tx("Follow-up", "Follow-up")) {
                            let seed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                            let preview = String(seed.prefix(240))
                            promptText = tx("Tiếp tục từ nội dung sau, trả lời ngắn gọn theo checklist hành động:\n", "Continue from this content and respond as an actionable checklist:\n") + preview
                            if quickFollowupAutoSend {
                                sendPromptFromSelectedSession()
                            }
                        }
                    }
                    .padding(.top, 2)
                }
            }

            if !isUser { Spacer() }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    private func extractReplyModeMarker(from text: String) -> (String?, String) {
        let pattern = #"^\[\[mode:(chat|task)\]\]\s*"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return (nil, text)
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: range),
              let modeRange = Range(match.range(at: 1), in: text),
              let fullRange = Range(match.range(at: 0), in: text) else {
            return (nil, text)
        }
        let mode = String(text[modeRange]).lowercased()
        let cleaned = String(text[fullRange.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        return (mode, cleaned.isEmpty ? text : cleaned)
    }

    private var chatSettingsSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(tx("Cài đặt hội thoại", "Conversation settings"))
                .font(.system(size: 16, weight: .bold, design: .rounded))

            Toggle(tx("Smart reply", "Smart reply"), isOn: $smartReplyFormatting)
                .toggleStyle(.switch)
            Toggle(tx("Render markdown", "Render markdown"), isOn: $markdownReplyRendering)
                .toggleStyle(.switch)
            Toggle(tx("Auto-send follow-up", "Auto-send follow-up"), isOn: $quickFollowupAutoSend)
                .toggleStyle(.switch)
            Toggle(tx("Auto reply mode", "Auto reply mode"), isOn: $autoReplyStyleByIntent)
                .toggleStyle(.switch)

            HStack(spacing: 8) {
                Text(tx("Kiểu trả lời", "Reply mode"))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(CyberColor.textSecondary)
                Picker("", selection: $replyStyle) {
                    ForEach(ReplyStyle.allCases, id: \.self) { style in
                        Text(replyStyleLabel(style)).tag(style)
                    }
                }
                .labelsHidden()
                .pickerStyle(.segmented)
            }

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(CyberColor.textMuted)
                TextField(tx("Tìm nhanh trong memory log...", "Quick find in memory log..."), text: $chatQuickFind)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(CyberColor.glassBg)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(CyberColor.glassBorder, lineWidth: 1))

            if !chatQuickFind.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                if quickFindEntries.isEmpty {
                    Text(tx("Không có kết quả", "No match"))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(CyberColor.textMuted)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(quickFindEntries.prefix(6), id: \.self) { entry in
                            Text(entry)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(CyberColor.textSecondary)
                                .lineLimit(1)
                        }
                    }
                }
            }

            HStack {
                Spacer()
                Button(tx("Đóng", "Close")) {
                    showChatSettingsSheet = false
                }
                .buttonStyle(.borderedProminent)
                .tint(CyberColor.cyan.opacity(0.85))
            }
            .padding(.top, 4)
        }
        .padding(16)
        .frame(minWidth: 560)
    }

    private func isStructuredReplyText(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("{") || trimmed.hasPrefix("[") { return true }
        if text.contains("\n") && (text.contains(":") || text.contains("{") || text.contains("}")) { return true }
        return false
    }

    private func prettifyConversationalReply(_ text: String) -> String {
        var normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        normalized = normalized.trimmingCharacters(in: .whitespacesAndNewlines)

        // Collapse noisy blank lines while preserving paragraph boundaries.
        while normalized.contains("\n\n\n") {
            normalized = normalized.replacingOccurrences(of: "\n\n\n", with: "\n\n")
        }

        return normalized
    }

    private func assistantMarkdownReply(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dict = object as? [String: Any] else {
            return prettifyConversationalReply(text)
        }
        if let reply = extractUserFacingReply(from: dict), !reply.isEmpty {
            return prettifyConversationalReply(reply)
        }

        // Planner-only payload should never be shown as user-facing content.
        if isInternalAssistantPayload(text) {
            return tx("Đang xử lý yêu cầu...", "Processing your request...")
        }

        return prettifyConversationalReply(text)
    }

    private func extractUserFacingReply(from dict: [String: Any]) -> String? {
        let directKeys = ["reply", "response", "summary", "answer", "final", "finalAnswer", "output", "message", "text", "content"]
        for key in directKeys {
            if let value = dict[key] as? String {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty && !trimmed.contains("[Native Session Context]") {
                    return trimmed
                }
            }
        }

        if let nested = dict["result"] as? [String: Any] {
            return extractUserFacingReply(from: nested)
        }

        return nil
    }

    private func attributedReply(from text: String) -> AttributedString? {
        try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .full,
                failurePolicy: .returnPartiallyParsedIfPossible
            )
        )
    }

    private func prettifyStructuredReply(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = trimmed.data(using: .utf8) else { return text }

        do {
            let object = try JSONSerialization.jsonObject(with: data)
            let prettyData = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
            return String(data: prettyData, encoding: .utf8) ?? text
        } catch {
            return text
        }
    }

    // MARK: ========== Voice ==========

    private var voiceView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroSection(icon: "waveform.circle.fill", iconColor: CyberColor.cyan, title: tx("Điều khiển giọng nói", "Voice Control"), subtitle: tx("Nói chuyện, đăng ký và cấu hình voice", "Speak, enroll, and configure voice"))

                GlowCard(glow: CyberColor.cyan.opacity(0.2)) {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: tx("Voice Runtime", "Voice Runtime"))
                        HStack(spacing: 8) {
                            CyberBadge(text: socketClient.voiceWakeEnabled ? "Wake ON" : "Wake OFF", color: socketClient.voiceWakeEnabled ? CyberColor.green : CyberColor.orange)
                            CyberBadge(text: socketClient.voiceSiriEnabled ? "Siri ON" : "Siri OFF", color: socketClient.voiceSiriEnabled ? CyberColor.green : CyberColor.orange)
                            CyberBadge(text: socketClient.voiceAutoExecute ? "Auto Exec" : "Manual", color: socketClient.voiceAutoExecute ? CyberColor.cyan : CyberColor.textMuted)
                            Spacer()
                        }
                        HStack(spacing: 8) {
                            quickActionButton(tx("Kiểm tra wake listener", "Check wake listener"), goal: "Check wake listener status and current wake phrase configuration")
                            quickActionButton(tx("Kiểm tra Siri bridge", "Check Siri bridge"), goal: "Verify Siri bridge endpoint and token configuration")
                        }
                    }
                }

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
            .padding(pagePadding)
            .frame(maxWidth: .infinity, alignment: .leading)
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

            Picker(tx("Voice mode", "Voice mode"), selection: $voiceInputRouteMode) {
                Text(tx("Chat", "Chat")).tag("chat")
                Text(tx("Task", "Task")).tag("task")
            }
            .pickerStyle(.segmented)

            // Toggles
            Toggle(tx("Low latency", "Low latency"), isOn: Binding(get: { socketClient.voiceLowLatency }, set: { v in
                socketClient.setRuntimeConfig(key: "voice.lowLatency", value: v)
                socketClient.queryRuntimeConfig()
            })).toggleStyle(.switch)

            Toggle(tx("Auto execute", "Auto execute"), isOn: Binding(get: { socketClient.voiceAutoExecute }, set: { v in
                socketClient.setRuntimeConfig(key: "voice.autoExecuteTranscript", value: v)
                socketClient.queryRuntimeConfig()
            })).toggleStyle(.switch)

            Toggle(tx("Read assistant text (TTS)", "Read assistant text (TTS)"), isOn: $voiceTtsEnabled)
                .toggleStyle(.switch)

            Toggle(tx("Wake listener local", "Local wake listener"), isOn: $voiceWakeListenerEnabled)
                .toggleStyle(.switch)

            if voiceWakeListenerEnabled {
                Text(tx("Wake phrase hiện tại", "Current wake phrase") + ": \(effectiveWakePhrase)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(CyberColor.textSecondary)
            }

            // Transcript
            let shouldShowTranscript = !voiceCaptureService.transcript.isEmpty
                && (!voiceWakeListenerEnabled || wakeCommandArmedUntil != nil || !voiceCaptureService.isRecording)

            if shouldShowTranscript {
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
                        Button(tx("Gửi trực tiếp", "Send directly")) {
                            promptText = voiceCaptureService.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                            sendPromptFromSelectedSession()
                        }
                        .buttonStyle(.borderedProminent).tint(CyberColor.cyan.opacity(0.8))
                        Button(tx("Đọc transcript", "Speak transcript")) {
                            speakAssistantReply(voiceCaptureService.transcript)
                        }
                        .buttonStyle(.bordered)
                        Button(tx("Xoá", "Clear")) { voiceCaptureService.transcript = "" }
                            .buttonStyle(.bordered)
                    }
                }
            }

            if !voiceConversationEntries.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: tx("Hội thoại trực tiếp", "Direct Conversation"))
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 6) {
                            ForEach(Array(voiceConversationEntries.enumerated()), id: \.offset) { idx, line in
                                chatBubble(index: idx, line: line)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .frame(maxHeight: 220)

                    HStack {
                        Spacer()
                        Button(tx("Xoá hội thoại voice", "Clear voice conversation")) {
                            voiceConversationEntries.removeAll()
                        }
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

            Text(tx("RTVC clone voice workflow", "RTVC clone voice workflow"))
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundColor(CyberColor.textMuted)

            quickActionButton(tx("Huấn luyện giọng nói", "Train voice identity"), goal: "Open voice enrollment flow and train speaker profile for this user")
            quickActionButton(tx("Xác minh người nói", "Verify speaker"), goal: "Verify current speaker against enrolled voice profile")
            quickActionButton(tx("Voice chat với bot", "Start voice chat"), goal: "Start voice conversation mode with push-to-talk and respond naturally")
            quickActionButton(tx("Kiểm tra micro", "Check microphone"), goal: "Check microphone devices, permissions, and recommended input settings")
            quickActionButton(
                tx("Setup RTVC toolbox", "Setup RTVC toolbox"),
                goal: "Run setup for Real-Time-Voice-Cloning on macOS: ensure ffmpeg installed, install uv, clone https://github.com/CorentinJ/Real-Time-Voice-Cloning.git, then run `uv run --extra cpu demo_toolbox.py`"
            )
            quickActionButton(
                tx("Run RTVC CLI (CPU)", "Run RTVC CLI (CPU)"),
                goal: "Enter Real-Time-Voice-Cloning repo and run `uv run --extra cpu demo_cli.py` to perform command-line voice cloning demo"
            )

            Divider().padding(.vertical, 4)

            Text(tx("Huấn luyện wake word \"hey mimi\" (openWakeWord)", "Train wake word \"hey mimi\" (openWakeWord)"))
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(CyberColor.textSecondary)

            Text(tx(
                "Bước 1: Mở Colab huấn luyện. Bước 2: Ghi 50–100 mẫu giọng. Bước 3: Tải file .onnx về và import bên dưới.",
                "Step 1: Open Colab. Step 2: Record 50–100 voice samples. Step 3: Download .onnx and import below."
            ))
            .font(.system(size: 11))
            .foregroundColor(CyberColor.textMuted)
            .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                Button(tx("Mở Colab huấn luyện", "Open training Colab")) {
                    if let url = URL(string: "https://colab.research.google.com/github/dscripka/openWakeWord/blob/main/notebooks/automatic_model_training.ipynb") {
                        NSWorkspace.shared.open(url)
                    }
                }
                .buttonStyle(.borderedProminent)

                Button(tx("Hướng dẫn", "Training guide")) {
                    if let url = URL(string: "https://github.com/dscripka/openWakeWord#training-new-models") {
                        NSWorkspace.shared.open(url)
                    }
                }
            }

            Button(tx("Import file .onnx đã train", "Import trained .onnx")) {
                let panel = NSOpenPanel()
                panel.allowedContentTypes = [.init(filenameExtension: "onnx")!].compactMap { $0 }
                panel.allowsMultipleSelection = false
                panel.canChooseDirectories = false
                if panel.runModal() == .OK, let url = panel.url {
                    Task { await uploadWakeModel(fileURL: url) }
                }
            }
            .buttonStyle(.bordered)

            quickActionButton(
                tx("Kiểm tra trạng thái wake model", "Check wake model status"),
                goal: "GET /api/wake/status from gateway, report whether custom hey-mimi model is installed and active"
            )
        }
    }

    private func uploadWakeModel(fileURL: URL) async {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        var req = URLRequest(url: URL(string: "http://localhost:19800/api/wake/upload-model")!)
        req.httpMethod = "POST"
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.setValue(fileURL.lastPathComponent, forHTTPHeaderField: "X-Model-Filename")
        req.httpBody = data
        _ = try? await URLSession.shared.data(for: req)
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
                Text("Hybrid").tag("hybrid")
                Text("Native").tag("native")
                Text("Shortcuts").tag("shortcuts")
            }
            .pickerStyle(.segmented)

            Toggle(tx("Wake word", "Wake word"), isOn: Binding(get: { socketClient.voiceWakeEnabled }, set: { v in
                socketClient.setRuntimeConfig(key: "voice.wake.enabled", value: v)
                socketClient.queryRuntimeConfig()
            })).toggleStyle(.switch)

            TextField("Wake phrase", text: Binding(get: { socketClient.voiceWakePhrase }, set: { v in
                socketClient.setRuntimeConfig(key: "voice.wake.phrase", value: v)
            })).textFieldStyle(.roundedBorder)

            Button(tx("Dùng wake phrase 'mimi'", "Use wake phrase 'mimi'")) {
                socketClient.setRuntimeConfig(key: "voice.wake.phrase", value: "mimi")
                socketClient.setRuntimeConfig(key: "voice.wake.enabled", value: true)
                socketClient.queryRuntimeConfig()
            }
            .buttonStyle(.bordered)

            Button(tx("Lưu cài đặt", "Save settings")) { socketClient.queryRuntimeConfig() }
                .buttonStyle(.borderedProminent).tint(CyberColor.cyan.opacity(0.8))
        }
    }

    // MARK: ========== Health ==========

    private var healthView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: panelSpacing) {
                if let health = socketClient.healthReport {
                    let overallColor = health.overall == "healthy" ? CyberColor.green : health.overall == "degraded" ? CyberColor.orange : CyberColor.red
                    stagedSection(0) {
                        HeroSection(icon: "heart.text.square.fill", iconColor: overallColor, title: tx("Sức khỏe hệ thống", "System Health"), subtitle: tx("Cập nhật: \(health.timestamp.prefix(19))", "Updated: \(health.timestamp.prefix(19))"))
                            .overlay(alignment: .topTrailing) {
                                HStack(spacing: 6) {
                                    CyberBadge(text: health.overall.uppercased(), color: overallColor)
                                    Button("Refresh") { socketClient.queryHealth() }
                                        .buttonStyle(.bordered).controlSize(.small).tint(overallColor.opacity(0.7))
                                }
                                .padding(pagePadding - 2)
                            }
                    }

                    stagedSection(1) {
                        GlowCard(glow: overallColor.opacity(0.2)) {
                            VStack(alignment: .leading, spacing: cardContentSpacing) {
                                SectionLabel(text: tx("Bộ lọc sensors", "Sensor Filters"))
                                Picker(tx("Chế độ lọc", "Filter mode"), selection: $healthFilterMode) {
                                    Text(tx("Tất cả", "All")).tag(HealthFilterMode.all)
                                    Text(tx("Cảnh báo", "Warning")).tag(HealthFilterMode.warning)
                                    Text(tx("Nghiêm trọng", "Critical")).tag(HealthFilterMode.critical)
                                }
                                .pickerStyle(.segmented)

                                HStack(spacing: 8) {
                                    CyberBadge(text: "Sensors: \(health.sensors.count)", color: CyberColor.cyan)
                                    CyberBadge(text: "Alerts: \(health.alerts.count)", color: health.alerts.isEmpty ? CyberColor.green : CyberColor.orange)
                                    Spacer()
                                }
                            }
                        }
                    }

                    // Sensor cards with gauges
                    stagedSection(2) {
                        LazyVGrid(columns: healthSensorColumns, spacing: regularGridSpacing) {
                            ForEach(filteredHealthSensors) { sensor in
                                sensorCard(sensor)
                            }
                        }
                    }

                    // Alerts
                    if !health.alerts.isEmpty {
                        stagedSection(3) {
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
                        }
                    } else {
                        stagedSection(3) {
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
                stagedSection(3) {
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
            }
            .padding(pagePadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(
                    colors: [healthAmbientColor.opacity(0.08), Color.clear],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
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

                GlowCard(glow: CyberColor.blue.opacity(0.2)) {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: tx("Machine Actions", "Machine Actions"))
                        HStack(spacing: 8) {
                            Button(tx("Refresh snapshot", "Refresh snapshot")) {
                                socketClient.querySystemDashboard()
                                socketClient.queryHealth()
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(CyberColor.cyan.opacity(0.8))

                            Button(tx("Copy machine summary", "Copy machine summary")) {
                                if let si = socketClient.systemInfo {
                                    let cpuLoad = si.cpuLoadAvg ?? "n/a"
                                    let wifiName = si.wifiSSID ?? "none"
                                    let text = "host=\(si.hostname) cpu=\(cpuLoad) mem=\(si.memoryTotalMB ?? 0)MB wifi=\(wifiName)"
                                    copyToClipboard(text)
                                    inlineStatusMessage = tx("Đã copy machine summary", "Machine summary copied")
                                }
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }

                if let si = socketClient.systemInfo {
                    let battPct = si.batteryPercent ?? 0
                    let diskPct = Int(si.diskUsePercent?.replacingOccurrences(of: "%", with: "") ?? "0") ?? 0
                    let memPct: Int = {
                        guard let total = si.memoryTotalMB, let free = si.memoryFreeMB, total > 0 else { return 0 }
                        return Int(Double(total - free) / Double(total) * 100)
                    }()

                    LazyVGrid(columns: machineInfoColumns, spacing: regularGridSpacing) {
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
            .padding(pagePadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: ========== Config ==========

    private var configView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                stagedSection(0) {
                    HeroSection(icon: "slider.horizontal.3", iconColor: CyberColor.purple, title: tx("Cấu hình", "Configuration"), subtitle: tx("Provider, model và runtime settings", "Provider, model and runtime settings"))
                }

                stagedSection(1) {
                    GlowCard(glow: CyberColor.purple.opacity(0.2)) {
                        VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: tx("Chọn Provider & Model", "Choose Provider & Model"))

                        if providerOptions.isEmpty {
                            Text(tx("Chưa có provider, hãy thêm provider mới bên dưới.", "No provider yet, add one below."))
                                .font(.system(size: 12))
                                .foregroundColor(CyberColor.textMuted)
                        } else {
                            Picker(tx("Provider", "Provider"), selection: $configSelectedProviderId) {
                                ForEach(providerOptions, id: \.id) { option in
                                    Text(option.label).tag(option.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .onChange(of: configSelectedProviderId) { value in
                                var matchedProvider: RuntimeProviderOption?
                                for option in providerOptions {
                                    if option.id == value {
                                        matchedProvider = option
                                        break
                                    }
                                }
                                guard let provider = matchedProvider else { return }
                                if provider.models.contains(configSelectedModel) {
                                    return
                                }
                                configSelectedModel = provider.models.first ?? ""
                            }

                            if !configModelOptions.isEmpty {
                                Picker(tx("Model", "Model"), selection: $configSelectedModel) {
                                    ForEach(configModelOptions, id: \.self) { model in
                                        Text(model).tag(model)
                                    }
                                }
                                .pickerStyle(.menu)
                            } else {
                                Text(tx("Provider này chưa có danh sách model.", "This provider has no model list yet."))
                                    .font(.system(size: 11))
                                    .foregroundColor(CyberColor.textMuted)
                            }

                            HStack(spacing: 8) {
                                Button(tx("Áp dụng vào runtime", "Apply to runtime")) {
                                    guard !configSelectedProviderId.isEmpty else { return }
                                    socketClient.setRuntimeConfig(key: "provider", value: configSelectedProviderId)
                                    if !configSelectedModel.isEmpty {
                                        socketClient.setRuntimeConfig(key: "model", value: configSelectedModel)
                                    }
                                    socketClient.queryRuntimeConfig()
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(CyberColor.purple.opacity(0.8))

                                Button(tx("Đồng bộ từ runtime", "Sync from runtime")) {
                                    configSelectedProviderId = socketClient.runtimeProvider
                                    if !socketClient.runtimeModel.isEmpty {
                                        configSelectedModel = socketClient.runtimeModel
                                    }
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                        }
                    }
                }

                // Active provider
                stagedSection(2) {
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
                }

                stagedSection(3) {
                    GlowCard(glow: CyberColor.blue.opacity(0.2)) {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionLabel(text: tx("Chỉnh sửa provider hiện tại", "Edit selected provider"))

                            if selectedConfigProvider == nil {
                                Text(tx("Hãy chọn provider ở phần trên để chỉnh sửa.", "Choose a provider above to edit."))
                                    .font(.system(size: 11))
                                    .foregroundColor(CyberColor.textMuted)
                            } else {
                                TextField(tx("Base URL", "Base URL"), text: $providerEditBaseURL)
                                    .textFieldStyle(.roundedBorder)

                                Picker(tx("Kind", "Kind"), selection: $providerEditKind) {
                                    Text("openai-compatible").tag("openai-compatible")
                                    Text("anthropic").tag("anthropic")
                                }
                                .pickerStyle(.segmented)

                                SecureField(tx("API Key (để trống = giữ nguyên)", "API Key (empty = keep existing)"), text: $providerEditApiKey)
                                    .textFieldStyle(.roundedBorder)

                                TextField(tx("Models (phân tách dấu phẩy)", "Models (comma separated)"), text: $providerEditModelsCSV)
                                    .textFieldStyle(.roundedBorder)

                                HStack(spacing: 8) {
                                    Button(tx("Lưu chỉnh sửa", "Save changes")) {
                                        guard let selected = selectedConfigProvider else { return }
                                        let models = providerEditModelsCSV
                                            .split(separator: ",")
                                            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                                            .filter { !$0.isEmpty }
                                        let primaryModel = configSelectedModel.isEmpty ? (models.first ?? selected.models.first ?? "") : configSelectedModel

                                        guard !providerEditBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !primaryModel.isEmpty else {
                                            providerEditMessage = tx("Cần Base URL và ít nhất 1 model.", "Base URL and at least one model are required.")
                                            return
                                        }

                                        socketClient.upsertRuntimeProvider(
                                            id: selected.id,
                                            kind: providerEditKind,
                                            baseURL: providerEditBaseURL.trimmingCharacters(in: .whitespacesAndNewlines),
                                            apiKey: providerEditApiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? (selected.apiKey ?? "") : providerEditApiKey.trimmingCharacters(in: .whitespacesAndNewlines),
                                            model: primaryModel,
                                            models: models.isEmpty ? [primaryModel] : models,
                                            activate: selected.id == socketClient.runtimeProvider,
                                            addToFallback: false
                                        )
                                        socketClient.queryRuntimeConfig()
                                        providerEditMessage = tx("Đã gửi cập nhật provider.", "Provider update sent.")
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .tint(CyberColor.blue.opacity(0.8))

                                    Button(tx("Thêm model vào danh sách", "Append model")) {
                                        let candidate = configSelectedModel.trimmingCharacters(in: .whitespacesAndNewlines)
                                        guard !candidate.isEmpty else { return }
                                        var models = providerEditModelsCSV
                                            .split(separator: ",")
                                            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                                            .filter { !$0.isEmpty }
                                        if !models.contains(candidate) {
                                            models.append(candidate)
                                            providerEditModelsCSV = models.joined(separator: ", ")
                                        }
                                    }
                                    .buttonStyle(.bordered)

                                    Button(tx("Nạp lại", "Reload")) {
                                        hydrateProviderEditorFromSelectedProvider()
                                    }
                                    .buttonStyle(.bordered)
                                }

                                if !providerEditMessage.isEmpty {
                                    Text(providerEditMessage)
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundColor(CyberColor.textSecondary)
                                }
                            }
                        }
                    }
                }

                // Provider list
                stagedSection(4) {
                    GlowCard {
                        VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: tx("Tất cả Providers", "All Providers"))
                        HStack(spacing: 8) {
                            Image(systemName: "magnifyingglass")
                                .foregroundColor(CyberColor.textMuted)
                            TextField(tx("Tìm provider theo id, label, URL...", "Filter provider by id, label, URL..."), text: $providerQuickFilter)
                                .textFieldStyle(.plain)
                                .font(.system(size: 12))
                            if !providerQuickFilter.isEmpty {
                                Button(tx("Clear", "Clear")) {
                                    providerQuickFilter = ""
                                }
                                .buttonStyle(.plain)
                                .foregroundColor(CyberColor.cyan)
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(CyberColor.glassBg)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(CyberColor.glassBorder, lineWidth: 1))

                        let visibleCount = filteredProviderOptions.count
                        CyberBadge(text: tx("Hiển thị \(visibleCount)/\(providerOptions.count)", "Showing \(visibleCount)/\(providerOptions.count)"), color: CyberColor.cyan)

                        if providerOptions.isEmpty {
                            Text(tx("Chưa có provider", "No providers")).foregroundColor(CyberColor.textMuted)
                        } else if filteredProviderOptions.isEmpty {
                            Text(tx("Không tìm thấy provider phù hợp", "No matching provider")).foregroundColor(CyberColor.textMuted)
                        } else {
                            ForEach(filteredProviderOptions, id: \.id) { provider in
                                providerOptionCard(provider)
                            }
                        }
                        }
                    }
                }

                // Model switch
                stagedSection(5) {
                    GlowCard {
                        VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: tx("Models của provider đang chọn", "Models for selected provider"))
                        if configModelOptions.isEmpty {
                            Text(tx("Chưa có model cho provider này", "No model available for this provider")).foregroundColor(CyberColor.textMuted)
                        } else {
                            ForEach(configModelOptions, id: \.self) { model in
                                let isActive = model == socketClient.runtimeModel
                                Button {
                                    selectedModel = model
                                    configSelectedModel = model
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

                stagedSection(6) {
                    GlowCard(glow: CyberColor.blue.opacity(0.2)) {
                        VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: tx("Thêm Provider", "Add Provider"))

                        TextField(tx("Provider ID (vd: openrouter)", "Provider ID (e.g. openrouter)"), text: $newProviderId)
                            .textFieldStyle(.roundedBorder)

                        Picker(tx("Loại Provider", "Provider Kind"), selection: $newProviderKind) {
                            Text("openai-compatible").tag("openai-compatible")
                            Text("anthropic").tag("anthropic")
                        }
                        .pickerStyle(.segmented)

                        TextField(tx("Base URL", "Base URL"), text: $newProviderBaseURL)
                            .textFieldStyle(.roundedBorder)

                        SecureField(tx("API Key", "API Key"), text: $newProviderApiKey)
                            .textFieldStyle(.roundedBorder)

                        TextField(tx("Danh sách model (phân tách dấu phẩy)", "Model list (comma separated)"), text: $newProviderModelsCSV)
                            .textFieldStyle(.roundedBorder)

                        Toggle(tx("Kích hoạt ngay sau khi thêm", "Activate after add"), isOn: $newProviderActivate)
                            .toggleStyle(.switch)

                        Toggle(tx("Thêm vào fallback chain", "Add to fallback chain"), isOn: $newProviderAddFallback)
                            .toggleStyle(.switch)

                        HStack(spacing: 8) {
                            Button(tx("Lưu provider", "Save provider")) {
                                let id = newProviderId.trimmingCharacters(in: .whitespacesAndNewlines)
                                let baseURL = newProviderBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
                                let rawModelTokens: [Substring] = newProviderModelsCSV.split(separator: ",")
                                var models: [String] = []
                                models.reserveCapacity(rawModelTokens.count)
                                for token in rawModelTokens {
                                    let trimmed = String(token).trimmingCharacters(in: .whitespacesAndNewlines)
                                    if !trimmed.isEmpty {
                                        models.append(trimmed)
                                    }
                                }
                                let primaryModel = models.first ?? ""

                                guard !id.isEmpty, !baseURL.isEmpty, !primaryModel.isEmpty else {
                                    configFormMessage = tx("Cần nhập Provider ID, Base URL và ít nhất 1 model.", "Provider ID, Base URL and at least one model are required.")
                                    return
                                }

                                socketClient.upsertRuntimeProvider(
                                    id: id,
                                    kind: newProviderKind,
                                    baseURL: baseURL,
                                    apiKey: newProviderApiKey,
                                    model: primaryModel,
                                    models: models,
                                    activate: newProviderActivate,
                                    addToFallback: newProviderAddFallback
                                )
                                socketClient.queryRuntimeConfig()

                                configSelectedProviderId = id
                                configSelectedModel = primaryModel
                                configFormMessage = tx("Đã gửi yêu cầu thêm provider. Bấm Refresh nếu chưa thấy ngay.", "Provider upsert sent. Press Refresh if not visible yet.")
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(CyberColor.blue.opacity(0.8))

                            Button(tx("Clear", "Clear")) {
                                newProviderId = ""
                                newProviderBaseURL = ""
                                newProviderApiKey = ""
                                newProviderModelsCSV = ""
                                configFormMessage = ""
                            }
                            .buttonStyle(.bordered)
                        }

                        if !configFormMessage.isEmpty {
                            Text(configFormMessage)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(CyberColor.textSecondary)
                                .padding(.top, 2)
                        }
                        }
                    }
                }

                stagedSection(7) {
                    GlowCard(glow: CyberColor.orange.opacity(0.18)) {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionLabel(text: tx("Runtime Settings", "Runtime Settings"))

                            Toggle(isOn: $settingsAutoSyncMemory) {
                                Text(tx("Tự đồng bộ session memory sau mỗi prompt", "Auto sync session memory after each prompt"))
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(CyberColor.textSecondary)
                            }
                            .toggleStyle(.switch)

                            Toggle(isOn: $settingsShowSystemMessages) {
                                Text(tx("Hiển thị system messages trong khung chat", "Show system messages in chat timeline"))
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(CyberColor.textSecondary)
                            }
                            .toggleStyle(.switch)

                            Toggle(isOn: $settingsCompactAssistantReplies) {
                                Text(tx("Compact assistant replies", "Compact assistant replies"))
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(CyberColor.textSecondary)
                            }
                            .toggleStyle(.switch)

                            Toggle(isOn: $autoReplyStyleByIntent) {
                                Text(tx("Tự chọn reply mode theo intent", "Auto reply mode by intent"))
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(CyberColor.textSecondary)
                            }
                            .toggleStyle(.switch)

                            Toggle(isOn: $markdownReplyRendering) {
                                Text(tx("Render markdown cho assistant", "Render assistant markdown"))
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(CyberColor.textSecondary)
                            }
                            .toggleStyle(.switch)
                        }
                    }
                }
            }
            .padding(pagePadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear {
                if configSelectedProviderId.isEmpty {
                    configSelectedProviderId = socketClient.runtimeProvider.isEmpty ? (providerOptions.first?.id ?? "") : socketClient.runtimeProvider
                }
                if configSelectedModel.isEmpty {
                    configSelectedModel = socketClient.runtimeModel.isEmpty ? (configModelOptions.first ?? "") : socketClient.runtimeModel
                }
                hydrateProviderEditorFromSelectedProvider()
            }
            .onChange(of: socketClient.runtimeProvider) { value in
                if configSelectedProviderId.isEmpty { configSelectedProviderId = value }
            }
            .onChange(of: providerOptions.map(\.id).joined(separator: ",")) { _ in
                if configSelectedProviderId.isEmpty {
                    configSelectedProviderId = socketClient.runtimeProvider.isEmpty ? (providerOptions.first?.id ?? "") : socketClient.runtimeProvider
                }
                if configSelectedModel.isEmpty {
                    configSelectedModel = configModelOptions.first ?? socketClient.runtimeModel
                }
            }
        }
    }

    // MARK: ========== Screen Tree (Session & Memory) ==========

    private var screenTreeView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroSection(icon: "brain.head.profile", iconColor: CyberColor.purple, title: "Session & Memory", subtitle: tx("Quản lý phiên và bộ nhớ chia sẻ", "Manage sessions and shared memory"))

                GlowCard(glow: CyberColor.purple.opacity(0.2)) {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: tx("Session Overview", "Session Overview"))
                        HStack(spacing: 8) {
                            CyberBadge(text: tx("Local sessions: \(sessions.count)", "Local sessions: \(sessions.count)"), color: CyberColor.cyan)
                            CyberBadge(text: tx("Runtime sessions: \(socketClient.runtimeSessions.count)", "Runtime sessions: \(socketClient.runtimeSessions.count)"), color: CyberColor.purple)
                            CyberBadge(text: tx("Shared logs: \(sharedMemorySummary.isEmpty ? 0 : 1)", "Shared logs: \(sharedMemorySummary.isEmpty ? 0 : 1)"), color: CyberColor.blue)
                            Spacer()
                            Button(tx("Clear all sessions", "Clear all sessions")) {
                                clearAllSessions()
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }
                        Text(tx("Tip: dùng Sync để đẩy toàn bộ state lên backend trước khi đổi model/provider.", "Tip: use Sync to push full state to backend before switching model/provider."))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(CyberColor.textMuted)
                    }
                }

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

            }
            .padding(pagePadding)
        }
    }

    // MARK: ========== Triggers ==========

    private var triggersView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroSection(icon: "bolt.fill", iconColor: CyberColor.orange, title: tx("Trigger tự động", "Auto Triggers"), subtitle: tx("Wake word, Siri bridge và tác vụ nhanh", "Wake word, Siri bridge and quick actions"))

                GlowCard(glow: CyberColor.orange.opacity(0.22)) {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: tx("Kịch bản gợi ý", "Suggested Scenarios"))
                        quickActionButton(tx("Wake phrase latency check", "Wake phrase latency check"), goal: "Benchmark wake phrase detection latency and suggest best cooldown/window settings")
                        quickActionButton(tx("Siri endpoint smoke test", "Siri endpoint smoke test"), goal: "Validate Siri bridge endpoint, token auth, and command routing end-to-end")
                        quickActionButton(tx("Tự sửa trigger config", "Auto repair trigger config"), goal: "Detect trigger config issues and apply safe defaults while keeping user settings")
                    }
                }

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

                        HStack(spacing: 8) {
                            Button(tx("Bắt đầu lắng nghe", "Start listening")) {
                                socketClient.setRuntimeConfig(key: "voice.wake.enabled", value: true)
                                socketClient.queryRuntimeConfig()
                                socketClient.sendTask(goal: "Enable wake-word listener and verify it is active", conversationId: selectedConversationID)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(CyberColor.green.opacity(0.78))

                            Button(tx("Dừng listener", "Stop listener")) {
                                socketClient.setRuntimeConfig(key: "voice.wake.enabled", value: false)
                                socketClient.queryRuntimeConfig()
                                socketClient.sendTask(goal: "Disable wake-word listener and confirm stop state", conversationId: selectedConversationID)
                            }
                            .buttonStyle(.bordered)

                            Button(tx("Wake self-test", "Wake self-test")) {
                                socketClient.sendTask(goal: "Run wake-word self-test using phrase \(socketClient.voiceWakePhrase)", conversationId: selectedConversationID)
                            }
                            .buttonStyle(.bordered)
                        }
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

            }
            .padding(pagePadding)
        }
    }

    // MARK: ========== Settings ==========

    private var settingsView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroSection(icon: "gearshape.fill", iconColor: CyberColor.blue, title: tx("Cài đặt", "Settings"), subtitle: tx("Gateway, AI và voice preferences", "Gateway, AI, and voice preferences"))

                GlowCard(glow: CyberColor.purple.opacity(0.22)) {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: tx("Autopilot Innovation Executor", "Autopilot Innovation Executor"))

                        HStack(spacing: 8) {
                            CyberBadge(text: tx("Done \(innovationCompletedCount)/\(innovationTotalCount)", "Done \(innovationCompletedCount)/\(innovationTotalCount)"), color: innovationCompletedCount == innovationTotalCount && innovationTotalCount > 0 ? CyberColor.green : CyberColor.orange)
                            CyberBadge(text: innovationAutopilotRunning ? tx("RUNNING", "RUNNING") : tx("IDLE", "IDLE"), color: innovationAutopilotRunning ? CyberColor.cyan : CyberColor.textMuted)
                            if innovationAutoExpanded {
                                CyberBadge(text: tx("+20 ideas expanded", "+20 ideas expanded"), color: CyberColor.purple)
                            }
                            Spacer()
                        }

                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(Color.white.opacity(0.06))
                                .frame(height: 8)
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(LinearGradient(colors: [CyberColor.cyan, CyberColor.purple], startPoint: .leading, endPoint: .trailing))
                                .frame(width: max(10, 440 * innovationProgressRatio), height: 8)
                                .shadow(color: CyberColor.cyan.opacity(0.35), radius: 5)
                        }
                        .frame(maxWidth: 440, alignment: .leading)

                        if !innovationLastExecutedTitle.isEmpty {
                            Text(tx("Last executed", "Last executed") + ": \(innovationLastExecutedTitle)")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(CyberColor.textSecondary)
                        }

                        HStack(spacing: 8) {
                            Button(tx("Run full pipeline (30 + auto 20)", "Run full pipeline (30 + auto 20)")) {
                                startInnovationAutopilot()
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(CyberColor.purple.opacity(0.85))
                            .disabled(innovationAutopilotRunning)

                            Button(tx("Reset queue", "Reset queue")) {
                                resetInnovationAutopilot()
                            }
                            .buttonStyle(.bordered)
                            .disabled(innovationAutopilotRunning)
                        }

                        if !innovationExecutionQueue.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                ForEach(innovationExecutionQueue.prefix(12)) { item in
                                    HStack(spacing: 6) {
                                        Image(systemName: item.completed ? "checkmark.circle.fill" : "circle")
                                            .foregroundColor(item.completed ? CyberColor.green : CyberColor.textMuted)
                                            .font(.system(size: 10, weight: .bold))
                                        Text(item.title)
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundColor(CyberColor.textSecondary)
                                            .lineLimit(1)
                                        Spacer()
                                        Text(item.category.uppercased())
                                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                                            .foregroundColor(CyberColor.textMuted)
                                    }
                                }
                            }
                        }
                    }
                }

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

                        if !providerOptions.isEmpty {
                            Divider().overlay(Color.white.opacity(0.08)).padding(.vertical, 2)

                            Text(tx("Chuyển nhanh Provider", "Quick Provider Switch"))
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(CyberColor.textSecondary)

                            Picker("Provider", selection: Binding(get: {
                                socketClient.runtimeProvider
                            }, set: { value in
                                socketClient.setRuntimeConfig(key: "provider", value: value)
                                socketClient.queryRuntimeConfig()
                            })) {
                                ForEach(providerOptions, id: \.id) { option in
                                    Text(option.label).tag(option.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .frame(maxWidth: 320)
                        }

                        if !modelOptions.isEmpty {
                            Text(tx("Chuyển nhanh Model", "Quick Model Switch"))
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(CyberColor.textSecondary)

                            Picker("Model", selection: Binding(get: {
                                socketClient.runtimeModel
                            }, set: { value in
                                socketClient.setRuntimeConfig(key: "model", value: value)
                                socketClient.queryRuntimeConfig()
                            })) {
                                ForEach(modelOptions, id: \.self) { model in
                                    Text(model).tag(model)
                                }
                            }
                            .pickerStyle(.menu)
                            .frame(maxWidth: 360)
                        }
                    }
                }

                GlowCard(glow: CyberColor.orange.opacity(0.18)) {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: tx("Chatbot Dashboard Preferences", "Chatbot Dashboard Preferences"))

                        Toggle(isOn: $settingsAutoSyncMemory) {
                            Text(tx("Tự đồng bộ session memory sau mỗi prompt", "Auto sync session memory after each prompt"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(CyberColor.textSecondary)
                        }
                        .toggleStyle(.switch)

                        Toggle(isOn: $settingsShowSystemMessages) {
                            Text(tx("Hiển thị system messages trong khung chat", "Show system messages in chat timeline"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(CyberColor.textSecondary)
                        }
                        .toggleStyle(.switch)

                        Toggle(isOn: $settingsCompactAssistantReplies) {
                            Text(tx("Compact assistant replies (gọn hơn)", "Compact assistant replies"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(CyberColor.textSecondary)
                        }
                        .toggleStyle(.switch)

                        Toggle(isOn: $settingsEnableDesktopHints) {
                            Text(tx("Bật desktop hints cho chatbot workflow", "Enable desktop hints for chatbot workflow"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(CyberColor.textSecondary)
                        }
                        .toggleStyle(.switch)

                        HStack(spacing: 8) {
                            Button(tx("Sync memory now", "Sync memory now")) {
                                syncAllMemoryToBackend()
                            }
                            .buttonStyle(.bordered)
                            .tint(CyberColor.cyan.opacity(0.7))

                            Button(tx("Run health + system snapshot", "Run health + system snapshot")) {
                                socketClient.queryHealth()
                                socketClient.querySystemDashboard()
                                socketClient.queryRuntimeConfig()
                            }
                            .buttonStyle(.bordered)
                            .tint(CyberColor.orange.opacity(0.7))
                        }
                    }
                }

                GlowCard(glow: CyberColor.purple.opacity(0.16)) {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: tx("Voice & Trigger", "Voice & Trigger"))

                        Toggle(isOn: Binding(get: { socketClient.voiceWakeEnabled }, set: { value in
                            socketClient.setRuntimeConfig(key: "voice.wake.enabled", value: value)
                            socketClient.queryRuntimeConfig()
                        })) {
                            Text(tx("Bật wake word", "Enable wake word"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(CyberColor.textSecondary)
                        }
                        .toggleStyle(.switch)

                        Toggle(isOn: Binding(get: { socketClient.voiceSiriEnabled }, set: { value in
                            socketClient.setRuntimeConfig(key: "voice.siri.enabled", value: value)
                            socketClient.queryRuntimeConfig()
                        })) {
                            Text(tx("Bật Siri bridge", "Enable Siri bridge"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(CyberColor.textSecondary)
                        }
                        .toggleStyle(.switch)

                        HStack(spacing: 8) {
                            Button(tx("Wake diagnostics", "Wake diagnostics")) {
                                socketClient.sendTask(goal: "Run wake-word diagnostics and show actionable fixes", conversationId: selectedConversationID)
                            }
                            .buttonStyle(.bordered)

                            Button(tx("Siri diagnostics", "Siri diagnostics")) {
                                socketClient.sendTask(goal: "Run Siri bridge diagnostics and validate endpoint/token", conversationId: selectedConversationID)
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }

                GlowCard(glow: CyberColor.blue.opacity(0.16)) {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel(text: tx("Permissions", "Permissions"))
                        Text(tx("Yêu cầu toàn bộ quyền ngay trong app. Một số quyền sẽ cần Quit & Reopen để macOS áp dụng.", "Request all permissions from inside the app. Some permissions require Quit & Reopen to apply."))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(CyberColor.textMuted)

                        HStack(spacing: 8) {
                            Button(tx("Request all now", "Request all now")) {
                                Task { @MainActor in
                                    await PermissionBootstrapper.shared.requestAllInitialPermissions(force: true)
                                    voiceCaptureService.requestPermissionsIfNeeded()
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(CyberColor.cyan.opacity(0.8))

                            Button(tx("Open Privacy", "Open Privacy")) {
                                PermissionBootstrapper.shared.openPrivacySettings()
                            }
                            .buttonStyle(.bordered)

                            Button(tx("Quit & Reopen", "Quit & Reopen")) {
                                let path = Bundle.main.bundlePath
                                let conf = NSWorkspace.OpenConfiguration()
                                NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: path), configuration: conf) { _, _ in
                                    NSApp.terminate(nil)
                                }
                            }
                            .buttonStyle(.bordered)
                        }

                        HStack(spacing: 8) {
                            Button(tx("Microphone", "Microphone")) {
                                openSystemSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
                            }
                            .buttonStyle(.bordered)

                            Button(tx("Screen Recording", "Screen Recording")) {
                                openSystemSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
                            }
                            .buttonStyle(.bordered)

                            Button(tx("Accessibility", "Accessibility")) {
                                openSystemSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
                            }
                            .buttonStyle(.bordered)

                            Button(tx("Speech", "Speech")) {
                                openSystemSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition")
                            }
                            .buttonStyle(.bordered)
                        }

                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 8) {
                                Circle().fill(isAccessibilityTrusted ? CyberColor.green : CyberColor.orange).frame(width: 7, height: 7)
                                Text(isAccessibilityTrusted
                                     ? tx("Accessibility đã sẵn sàng", "Accessibility is granted")
                                     : tx("Accessibility chưa cấp hoặc chưa áp dụng cho process hiện tại", "Accessibility not granted for current process"))
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(CyberColor.textSecondary)
                            }

                            HStack(spacing: 8) {
                                Circle().fill(isScreenRecordingTrusted ? CyberColor.green : CyberColor.orange).frame(width: 7, height: 7)
                                Text(isScreenRecordingTrusted
                                     ? tx("Screen Recording đã sẵn sàng", "Screen recording is granted")
                                     : tx("Screen Recording chưa sẵn sàng, có thể cần Quit & Reopen", "Screen recording is not active yet; Quit & Reopen may be required"))
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(CyberColor.textSecondary)
                            }

                            HStack(spacing: 8) {
                                Circle().fill(hasMicrophonePermission ? CyberColor.green : CyberColor.orange).frame(width: 7, height: 7)
                                Text(hasMicrophonePermission
                                     ? tx("Microphone đã sẵn sàng", "Microphone is granted")
                                     : tx("Microphone chưa sẵn sàng", "Microphone is not granted"))
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(CyberColor.textSecondary)
                            }

                            HStack(spacing: 8) {
                                Circle().fill(hasSpeechPermission ? CyberColor.green : CyberColor.orange).frame(width: 7, height: 7)
                                Text(hasSpeechPermission
                                     ? tx("Speech Recognition đã sẵn sàng", "Speech recognition is granted")
                                     : tx("Speech Recognition chưa sẵn sàng", "Speech recognition is not granted"))
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(CyberColor.textSecondary)
                            }
                        }
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
            .padding(pagePadding)
        }
    }

    private func providerOptionCard(_ provider: RuntimeProviderOption) -> some View {
        let isActive = provider.id == socketClient.runtimeProvider
        let modelsLabel = provider.models.joined(separator: ", ")
        let statusText = provider.enabled ? "✅ Enabled" : "❌ Disabled"
        let statusColor = provider.enabled ? CyberColor.green : CyberColor.red

        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(provider.label)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundColor(isActive ? CyberColor.cyan : CyberColor.textPrimary)
                if isActive {
                    CyberBadge(text: "ACTIVE", color: CyberColor.cyan)
                }
                Spacer()
                if !isActive {
                    Button(tx("Chuyển sang", "Switch")) {
                        socketClient.setRuntimeConfig(key: "provider", value: provider.id)
                        socketClient.queryRuntimeConfig()
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .tint(CyberColor.cyan.opacity(0.7))
                }
            }

            HStack(spacing: 16) {
                if let k = provider.kind {
                    let kindLabel = "Kind: \(k)"
                    Text(kindLabel)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(CyberColor.textMuted)
                }
                if let url = provider.baseURL {
                    Text(verbatim: url)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(CyberColor.textMuted)
                        .lineLimit(1)
                }
            }

            if !provider.models.isEmpty {
                Text("Models: \(modelsLabel)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(CyberColor.textSecondary)
            }

            CyberBadge(text: statusText, color: statusColor)
        }
        .padding(10)
        .background(isActive ? CyberColor.cyan.opacity(0.05) : CyberColor.glassBg)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(isActive ? CyberColor.cyan.opacity(0.25) : CyberColor.glassBorder, lineWidth: 1)
        )
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
        .frame(maxWidth: .infinity, alignment: .leading)
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
            .padding(.vertical, 11)
            .padding(.horizontal, 12)
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
                Text(detail).font(.system(size: 11, weight: .medium)).foregroundColor(CyberColor.textSecondary).lineLimit(2)
            }
            Spacer()
        }
        .padding(11)
        .background(
            LinearGradient(
                colors: [tone.opacity(0.16), tone.opacity(0.07)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(tone.opacity(0.3), lineWidth: 1))
    }

    private func quickActionButton(_ label: String, goal: String) -> some View {
        Button {
            socketClient.sendTask(goal: goal, conversationId: selectedConversationID)
            setPage(.chat)
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
        voiceWakeListenerEnabled = false
        wakeCommandArmedUntil = nil
        wakeBubbleVisible = false
        wakeBubbleText = ""
        voiceWakeRestartTask?.cancel()
        voiceFinalizeTask?.cancel()
        if !voiceCaptureService.isAuthorized {
            voiceCaptureService.requestPermissionsIfNeeded()
            return
        }
        if !voiceCaptureService.isRecording {
            voiceSilenceTask?.cancel()
            let locale = isEnglish ? "en-US" : "vi-VN"
            voiceCaptureService.startRecording(localeIdentifier: locale)
        } else {
            finalizeVoiceRecordingAndSubmit()
        }
    }

    private func finalizeVoiceRecordingAndSubmit() {
        voiceSilenceTask?.cancel()
        voiceFinalizeTask?.cancel()
        voiceCaptureService.stopRecording()

        voiceFinalizeTask = Task { @MainActor in
            // Wait for Speech framework to flush final transcript after endAudio().
            try? await Task.sleep(nanoseconds: 1_300_000_000)
            let latest = voiceCaptureService.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !latest.isEmpty else { return }
            submitVoiceTranscriptIfNeeded(latest)
        }
    }

    private func startWakeListenerIfNeeded() {
        guard voiceWakeListenerEnabled else { return }
        guard !Self.sharedSpeechSynthesizer.isSpeaking else { return }
        guard voiceCaptureService.isAuthorized else {
            voiceCaptureService.requestPermissionsIfNeeded()
            return
        }
        if !voiceCaptureService.isRecording {
            let locale = isEnglish ? "en-US" : "vi-VN"
            voiceCaptureService.startRecording(localeIdentifier: locale)
        }
    }

    private func stopWakeListener(resetState: Bool) {
        voiceWakeRestartTask?.cancel()
        voiceWakeRestartTask = nil
        wakeArmTimeoutTask?.cancel()
        wakeArmTimeoutTask = nil
        if resetState {
            wakeCommandArmedUntil = nil
            wakeBubbleVisible = false
            wakeBubbleText = ""
        }
        if voiceCaptureService.isRecording {
            voiceCaptureService.stopRecording()
        }
    }

    private func handleVoiceTranscriptChange() {
        guard voiceCaptureService.isRecording else {
            voiceSilenceTask?.cancel()
            return
        }

        let snapshot = voiceCaptureService.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !snapshot.isEmpty else {
            voiceSilenceTask?.cancel()
            return
        }

        if voiceWakeListenerEnabled {
            let normalized = normalizeTranscriptLine(snapshot)
            let wakePrefix = matchedWakePrefix(in: normalized)

            if wakePrefix != nil && wakeCommandArmedUntil == nil {
                wakeCommandArmedUntil = Date().addingTimeInterval(5)
                wakeBubbleText = tx("Wake phrase: \(effectiveWakePhrase)", "Wake phrase: \(effectiveWakePhrase)")
                wakeBubbleVisible = true
                NSApp.activate(ignoringOtherApps: true)
                setPage(.voice)
                speakAssistantReply("OmniState đây")

                wakeArmTimeoutTask?.cancel()
                wakeArmTimeoutTask = Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    if let deadline = wakeCommandArmedUntil, Date() >= deadline {
                        wakeCommandArmedUntil = nil
                        wakeBubbleVisible = false
                        wakeBubbleText = ""
                        voiceCaptureService.transcript = ""
                    }
                }

                voiceCaptureService.transcript = ""
                return
            }

            // Passive mode: only wake-word can arm command window. Ignore everything else.
            if wakeCommandArmedUntil == nil {
                voiceSilenceTask?.cancel()
                return
            }

            if let deadline = wakeCommandArmedUntil, Date() > deadline {
                wakeCommandArmedUntil = nil
                wakeBubbleVisible = false
                wakeBubbleText = ""
                voiceCaptureService.transcript = ""
                return
            }
        }

        voiceSilenceTask?.cancel()
        voiceSilenceTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            await MainActor.run {
                guard voiceCaptureService.isRecording else { return }
                let latest = voiceCaptureService.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                guard latest == snapshot, !latest.isEmpty else { return }

                 if voiceWakeListenerEnabled,
                    let deadline = wakeCommandArmedUntil,
                    Date() <= deadline {
                    let normalizedLatest = normalizeTranscriptLine(latest)
                    if matchedWakePrefix(in: normalizedLatest) == normalizedLatest {
                        return
                    }
                }

                finalizeVoiceRecordingAndSubmit()
            }
        }
    }

    private func submitVoiceTranscriptIfNeeded(_ raw: String) {
        let transcript = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !transcript.isEmpty else { return }
        let normalized = normalizeTranscriptLine(transcript)

        if voiceWakeListenerEnabled && wakeCommandArmedUntil == nil {
            return
        }

        var outboundTranscript = transcript
        if voiceWakeListenerEnabled, let wakePrefix = matchedWakePrefix(in: normalized) {
            if normalized == wakePrefix {
                return
            }

            let tokens = transcript
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .split(whereSeparator: { $0.isWhitespace })
                .map(String.init)
            let wakeTokenCount = wakePrefix.split(separator: " ").count
            if tokens.count >= wakeTokenCount {
                outboundTranscript = tokens.dropFirst(wakeTokenCount).joined(separator: " ")
                outboundTranscript = outboundTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
            }

            if outboundTranscript.isEmpty {
                return
            }
        }
        guard normalizeTranscriptLine(outboundTranscript) != normalizeTranscriptLine(lastVoiceTranscriptSubmitted) else { return }

        lastVoiceTranscriptSubmitted = outboundTranscript
        promptText = outboundTranscript
        let modeLabel = voiceInputRouteMode == "task" ? "TASK" : "CHAT"
        let userLine = "USER \(modeLabel): \(outboundTranscript)"
        if normalizeTranscriptLine(voiceConversationEntries.last ?? "") != normalizeTranscriptLine(userLine) {
            voiceConversationEntries.append(userLine)
            if voiceConversationEntries.count > 24 {
                voiceConversationEntries = Array(voiceConversationEntries.suffix(24))
            }
        }

        wakeCommandArmedUntil = nil
        wakeBubbleVisible = false
        wakeBubbleText = ""
        wakeArmTimeoutTask?.cancel()
        wakeArmTimeoutTask = nil
        sendPromptFromSelectedSession()

        if voiceWakeListenerEnabled {
            voiceWakeRestartTask?.cancel()
            voiceWakeRestartTask = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 600_000_000)
                startWakeListenerIfNeeded()
            }
        }
    }

    private func speakAssistantReply(_ rawReply: String) {
        let (_, cleanedRawReply) = extractReplyModeMarker(from: rawReply)
        let markdown = assistantMarkdownReply(cleanedRawReply)
        let spoken = spokenTextFromMarkdown(markdown)
        guard !spoken.isEmpty else { return }
        guard normalizeTranscriptLine(spoken) != normalizeTranscriptLine(lastAssistantSpeechKey) else { return }

        lastAssistantSpeechKey = spoken
        Self.sharedSpeechSynthesizer.stopSpeaking(at: .immediate)

        let chunks = speechChunks(from: spoken)
        let voice = AVSpeechSynthesisVoice(language: isEnglish ? "en-US" : "vi-VN")
        let baseRate: Float = isEnglish ? 0.49 : 0.45

        let shouldResumeWake = voiceWakeListenerEnabled
        if shouldResumeWake && voiceCaptureService.isRecording {
            voiceCaptureService.stopRecording(cancelRecognition: true)
        }

        for (index, chunk) in chunks.enumerated() {
            let utterance = AVSpeechUtterance(string: chunk)
            utterance.rate = baseRate
            utterance.pitchMultiplier = 1.0
            utterance.volume = 1.0
            utterance.voice = voice
            utterance.preUtteranceDelay = index == 0 ? 0 : 0.03
            utterance.postUtteranceDelay = chunk.hasSuffix("?") || chunk.hasSuffix("!") ? 0.16 : 0.11
            Self.sharedSpeechSynthesizer.speak(utterance)
        }

        if shouldResumeWake {
            voiceWakeRestartTask?.cancel()
            voiceWakeRestartTask = Task { @MainActor in
                while Self.sharedSpeechSynthesizer.isSpeaking {
                    try? await Task.sleep(nanoseconds: 150_000_000)
                }
                startWakeListenerIfNeeded()
            }
        }
    }

    private func spokenTextFromMarkdown(_ text: String) -> String {
        var cleaned = text.replacingOccurrences(of: "\r\n", with: "\n")

        let lines = cleaned
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }

        var spokenLines: [String] = []
        spokenLines.reserveCapacity(lines.count)

        for line in lines {
            guard !line.isEmpty else { continue }
            if line.hasPrefix("###") || line.hasPrefix("##") || line.hasPrefix("#") {
                continue
            }

            let lowered = line.lowercased()
            if lowered.hasPrefix("dưới đây là") || lowered.hasPrefix("duoi day la") {
                continue
            }

            var normalizedLine = line
            normalizedLine = normalizedLine.replacingOccurrences(of: #"^[-*]\s+"#, with: "", options: .regularExpression)
            normalizedLine = normalizedLine.replacingOccurrences(of: #"^\d+[\.)]\s+"#, with: "", options: .regularExpression)
            spokenLines.append(normalizedLine)
        }

        if !spokenLines.isEmpty {
            cleaned = spokenLines.joined(separator: ". ")
        }

        // Remove internal routing marker before speaking.
        if let regex = try? NSRegularExpression(pattern: #"\[\[mode:(chat|task)\]\]"#, options: [.caseInsensitive]) {
            let range = NSRange(cleaned.startIndex..<cleaned.endIndex, in: cleaned)
            cleaned = regex.stringByReplacingMatches(in: cleaned, options: [], range: range, withTemplate: " ")
        }

        // Remove leading role labels that are useful for UI but noisy in TTS.
        if let rolePrefix = try? NSRegularExpression(pattern: #"^(assistant|system|user)\s+(chat|task)?\s*:\s*"#, options: [.caseInsensitive]) {
            let range = NSRange(cleaned.startIndex..<cleaned.endIndex, in: cleaned)
            cleaned = rolePrefix.stringByReplacingMatches(in: cleaned, options: [], range: range, withTemplate: "")
        }

        let replacements: [(String, String)] = [
            ("```", " "),
            ("`", " "),
            ("###", " "),
            ("##", " "),
            ("#", " "),
            ("**", " "),
            ("*", " "),
            ("_", " "),
            ("[", " "),
            ("]", " "),
            ("(", " "),
            (")", " "),
            ("|", " "),
            (">", " "),
            ("- ", " "),
            ("•", " "),
            ("\\n", ". ")
        ]

        for (target, replacement) in replacements {
            cleaned = cleaned.replacingOccurrences(of: target, with: replacement)
        }

        cleaned = cleaned.replacingOccurrences(of: "\n", with: ". ")
        cleaned = cleaned.replacingOccurrences(of: "\t", with: " ")

        while cleaned.contains("  ") {
            cleaned = cleaned.replacingOccurrences(of: "  ", with: " ")
        }

        return cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func matchedWakePrefix(in normalizedTranscript: String) -> String? {
        let transcript = normalizedTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !transcript.isEmpty else { return nil }

        for phrase in wakePhraseCandidates {
            let wakeNorm = normalizeTranscriptLine(phrase)
            guard !wakeNorm.isEmpty else { continue }
            if transcript == wakeNorm || transcript.hasPrefix(wakeNorm + " ") {
                return wakeNorm
            }
        }

        return nil
    }

    private func speechChunks(from spoken: String) -> [String] {
        let maxChunkLength = 220
        let separators = CharacterSet(charactersIn: ".!?;:")
        var chunks: [String] = []
        var current = ""

        for scalar in spoken.unicodeScalars {
            current.unicodeScalars.append(scalar)
            let shouldSplitByPunctuation = separators.contains(scalar)
            let shouldSplitByLength = current.count >= maxChunkLength

            if shouldSplitByPunctuation || shouldSplitByLength {
                let normalized = current.trimmingCharacters(in: .whitespacesAndNewlines)
                if !normalized.isEmpty {
                    chunks.append(normalized)
                }
                current = ""
            }
        }

        let tail = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !tail.isEmpty {
            chunks.append(tail)
        }

        if chunks.isEmpty {
            return [spoken]
        }
        return chunks
    }

    private func openSystemSettings(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        NSWorkspace.shared.open(url)
    }

    private func runPrimaryTaskFromTopbar() {
        let fallback = "Analyze current system state and suggest 3 priority actions"
        let goal = promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? fallback : promptText
        socketClient.sendTask(goal: goal, conversationId: selectedConversationID)
        setPage(.chat)
    }

    private func setPage(_ target: NativePage) {
        guard target != page else { return }
        let all = NativePage.allCases
        let from = all.firstIndex(of: page) ?? 0
        let to = all.firstIndex(of: target) ?? 0
        transitionForward = to >= from
        pageContentReady = false
        let stepDistance = abs(to - from)
        let transitionDuration = min(0.34, 0.2 + (Double(stepDistance) * 0.03))
        withAnimation(.easeInOut(duration: transitionDuration)) {
            page = target
        }
        DispatchQueue.main.async {
            withAnimation(.spring(response: 0.34, dampingFraction: transitionForward ? 0.86 : 0.9)) {
                pageContentReady = true
            }
        }
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

    private func clearAllSessions() {
        for runtime in socketClient.runtimeSessions {
            socketClient.deleteSession(id: runtime.id)
        }

        sessions = [
            NativeConversation(
                id: "default",
                title: "Default Session",
                provider: socketClient.runtimeProvider,
                model: socketClient.runtimeModel,
                memorySummary: "",
                memoryLog: []
            )
        ]
        selectedConversationID = "default"
        promptText = ""
        composerAttachments = []
        composerAttachmentStatus = ""
        voiceConversationEntries = []
        inlineStatusMessage = tx("Đã xoá toàn bộ sessions", "All sessions cleared")
        socketClient.queryRuntimeConfig()
        socketClient.queryHistory(limit: 30)
    }

    private func hydrateProviderEditorFromSelectedProvider() {
        guard let provider = selectedConfigProvider else { return }
        providerEditBaseURL = provider.baseURL ?? ""
        providerEditKind = provider.kind ?? "openai-compatible"
        providerEditApiKey = ""
        providerEditModelsCSV = provider.models.joined(separator: ", ")
        providerEditMessage = ""
    }

    private func applyRuntimeForSelectedSession() {
        guard let idx = selectedSessionIndex else { return }
        let provider = sessions[idx].provider.trimmingCharacters(in: .whitespacesAndNewlines)
        let model = sessions[idx].model.trimmingCharacters(in: .whitespacesAndNewlines)
        if !provider.isEmpty { socketClient.setRuntimeConfig(key: "provider", value: provider) }
        if !model.isEmpty { socketClient.setRuntimeConfig(key: "model", value: model) }
    }

    private func openComposerAttachmentPicker() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.resolvesAliases = true

        panel.begin { response in
            guard response == .OK else { return }
            Task { @MainActor in
                self.appendComposerAttachments(from: panel.urls)
            }
        }
    }

    private func handleComposerFileDrop(_ providers: [NSItemProvider]) -> Bool {
        guard !providers.isEmpty else { return false }
        let dispatchGroup = DispatchGroup()
        var droppedURLs: [URL] = []

        for provider in providers {
            guard provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) else { continue }
            dispatchGroup.enter()
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                defer { dispatchGroup.leave() }

                if let data = item as? Data,
                   let url = URL(dataRepresentation: data, relativeTo: nil) {
                    droppedURLs.append(url)
                    return
                }

                if let url = item as? URL {
                    droppedURLs.append(url)
                    return
                }

                if let text = item as? String,
                   let url = URL(string: text) {
                    droppedURLs.append(url)
                }
            }
        }

        dispatchGroup.notify(queue: .main) {
            let unique = Array(Set(droppedURLs.map { $0.standardizedFileURL })).sorted { $0.path < $1.path }
            self.appendComposerAttachments(from: unique)
        }

        return true
    }

    private func appendComposerAttachments(from urls: [URL]) {
        let maxAttachmentCount = 8
        var next = composerAttachments

        for url in urls {
            if next.count >= maxAttachmentCount {
                composerAttachmentStatus = tx("Tối đa 8 file mỗi lần gửi.", "Maximum 8 attachments per request.")
                break
            }
            guard let attachment = makeComposerAttachment(from: url) else { continue }
            if next.contains(where: { $0.localPath == attachment.localPath }) { continue }
            next.append(attachment)
        }

        composerAttachments = next
        if !composerAttachments.isEmpty {
            composerAttachmentStatus = tx(
                "Đính kèm sẵn sàng: \(composerAttachments.count) • \(humanReadableByteCount(composerAttachmentTotalBytes))",
                "Attachments ready: \(composerAttachments.count) • \(humanReadableByteCount(composerAttachmentTotalBytes))"
            )
        }
    }

    private func removeComposerAttachment(id: String) {
        composerAttachments.removeAll { $0.id == id }
        if composerAttachments.isEmpty {
            composerAttachmentStatus = ""
            composerAttachmentFilter = .all
        } else {
            composerAttachmentStatus = tx(
                "Đính kèm sẵn sàng: \(composerAttachments.count) • \(humanReadableByteCount(composerAttachmentTotalBytes))",
                "Attachments ready: \(composerAttachments.count) • \(humanReadableByteCount(composerAttachmentTotalBytes))"
            )
        }
    }

    private func makeComposerAttachment(from url: URL) -> NativeComposerAttachment? {
        let maxAttachmentBytes = 4_000_000

        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let rawSize = attrs[.size] as? NSNumber else {
            composerAttachmentStatus = tx("Không đọc được file đã chọn.", "Cannot read selected file.")
            return nil
        }

        let size = rawSize.intValue
        if size <= 0 {
            composerAttachmentStatus = tx("File rỗng, bỏ qua.", "Empty file skipped.")
            return nil
        }

        if size > maxAttachmentBytes {
            composerAttachmentStatus = tx("File quá lớn (>4MB), vui lòng chọn file nhỏ hơn.", "Attachment too large (>4MB), choose a smaller file.")
            return nil
        }

        let mimeType = mimeTypeForURL(url)
        let isImage = mimeType.hasPrefix("image/")
        let isText = mimeType.hasPrefix("text/") || ["application/json", "application/xml", "application/yaml"].contains(mimeType)
        let kind = isImage ? "image" : (isText ? "text" : "file")

        let textPreview: String?
        if isText,
           let data = try? Data(contentsOf: url, options: [.mappedIfSafe]),
           let text = String(data: data, encoding: .utf8) {
            let snippet = String(text.prefix(1200))
            textPreview = "Local file path: \(url.path)\n\n\(snippet)"
        } else if isImage {
            textPreview = "Local image path: \(url.path)"
        } else {
            textPreview = "Local file path: \(url.path)"
        }

        let thumbnail: NSImage?
        if isImage, let image = NSImage(contentsOf: url) {
            thumbnail = makeThumbnail(from: image, size: NSSize(width: 64, height: 64))
        } else {
            thumbnail = nil
        }

        return NativeComposerAttachment(
            id: UUID().uuidString.lowercased(),
            name: url.lastPathComponent,
            mimeType: mimeType,
            size: size,
            kind: kind,
            textPreview: textPreview,
            dataBase64: nil,
            localPath: url.path,
            thumbnail: thumbnail
        )
    }

    private func mimeTypeForURL(_ url: URL) -> String {
        let ext = url.pathExtension.lowercased()
        if ["png"].contains(ext) { return "image/png" }
        if ["jpg", "jpeg"].contains(ext) { return "image/jpeg" }
        if ["gif"].contains(ext) { return "image/gif" }
        if ["webp"].contains(ext) { return "image/webp" }
        if ["bmp"].contains(ext) { return "image/bmp" }
        if ["heic"].contains(ext) { return "image/heic" }
        if ["tiff", "tif"].contains(ext) { return "image/tiff" }
        if ["txt", "md", "csv", "log", "yaml", "yml"].contains(ext) { return "text/plain" }
        if ["json"].contains(ext) { return "application/json" }
        if ["xml"].contains(ext) { return "application/xml" }
        if ["pdf"].contains(ext) { return "application/pdf" }
        return "application/octet-stream"
    }

    private func makeThumbnail(from image: NSImage, size: NSSize) -> NSImage {
        let thumbnail = NSImage(size: size)
        thumbnail.lockFocus()
        NSColor.clear.set()
        NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
        image.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .copy, fraction: 1.0)
        thumbnail.unlockFocus()
        return thumbnail
    }

    private func humanReadableByteCount(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        let kb = Double(bytes) / 1024.0
        if kb < 1024 { return String(format: "%.1f KB", kb) }
        let mb = kb / 1024.0
        return String(format: "%.2f MB", mb)
    }

    private func toTaskAttachments(_ attachments: [NativeComposerAttachment]) -> [NativeTaskAttachment] {
        attachments.map { attachment in
            NativeTaskAttachment(
                id: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                size: attachment.size,
                kind: attachment.kind,
                textPreview: attachment.textPreview,
                dataBase64: attachment.dataBase64
            )
        }
    }

    @ViewBuilder
    private func chatImagePreview(url: URL) -> some View {
        if let image = NSImage(contentsOf: url) {
            VStack(alignment: .leading, spacing: 5) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 360, maxHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(CyberColor.glassBorder, lineWidth: 1))

                Text(url.path)
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundColor(CyberColor.textMuted)
                    .lineLimit(1)
            }
        }
    }

    private func extractRenderableImageURLs(from text: String) -> [URL] {
        let pattern = #"(file:///[^\s"'\)\]]+|~?/[^\s"'\)\]]+\.(?:png|jpe?g|gif|webp|bmp|heic|tiff))"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return []
        }

        let nsRange = NSRange(text.startIndex..<text.endIndex, in: text)
        let matches = regex.matches(in: text, options: [], range: nsRange)
        var seen = Set<String>()
        var urls: [URL] = []

        for match in matches {
            guard let range = Range(match.range(at: 1), in: text) else { continue }
            let token = String(text[range]).trimmingCharacters(in: CharacterSet(charactersIn: "()[]<>\"'"))
            guard let url = normalizeImageURLToken(token) else { continue }
            let canonical = url.standardizedFileURL.path
            guard !seen.contains(canonical), FileManager.default.fileExists(atPath: canonical) else { continue }
            seen.insert(canonical)
            urls.append(URL(fileURLWithPath: canonical))
        }

        return urls
    }

    private func normalizeImageURLToken(_ token: String) -> URL? {
        if token.hasPrefix("file://"), let decoded = token.removingPercentEncoding,
           let parsedURL = URL(string: decoded) {
            return URL(fileURLWithPath: parsedURL.path)
        }

        if token.hasPrefix("~/") {
            let expanded = (token as NSString).expandingTildeInPath
            return URL(fileURLWithPath: expanded)
        }

        if token.hasPrefix("/") {
            return URL(fileURLWithPath: token)
        }

        return nil
    }

    private func sendPromptFromSelectedSession() {
        let typedText = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
        let outboundAttachments = toTaskAttachments(composerAttachments)
        guard !typedText.isEmpty || !outboundAttachments.isEmpty else { return }
        let text = typedText.isEmpty
            ? tx("Phân tích file đính kèm và trả lời theo checklist hành động.", "Analyze the attached files and respond with an actionable checklist.")
            : typedText

        guard socketClient.isConnected else {
            composerAttachmentStatus = tx("Gateway đang offline, chưa gửi được yêu cầu.", "Gateway is offline; request was not sent.")
            inlineStatusMessage = tx("Kết nối gateway trước khi gửi", "Connect gateway before sending")
            return
        }

        if page == .voice {
            let modeLabel = voiceInputRouteMode == "task" ? "TASK" : "CHAT"
            let userLine = "USER \(modeLabel): \(text)"
            if normalizeTranscriptLine(voiceConversationEntries.last ?? "") != normalizeTranscriptLine(userLine) {
                voiceConversationEntries.append(userLine)
                if voiceConversationEntries.count > 24 {
                    voiceConversationEntries = Array(voiceConversationEntries.suffix(24))
                }
            }
        }

        applyRuntimeForSelectedSession()

        let routeMode: String
        if page == .voice {
            routeMode = voiceInputRouteMode
        } else {
            routeMode = inferredRouteMode(for: text, hasAttachments: !outboundAttachments.isEmpty)
        }
        let transcriptPrompt = userPromptWithAttachmentSummary(text: text, attachments: outboundAttachments)

        let effectiveReplyStyle = autoReplyStyleByIntent ? inferReplyStyle(for: text) : replyStyle
        if autoReplyStyleByIntent {
            replyStyle = effectiveReplyStyle
        }

        var goal = text
        if let idx = selectedSessionIndex {
            let session = sessions[idx]
            goal = shouldWrapPromptWithSessionContext(text, routeMode: routeMode)
                ? buildGoalWithMemory(goal: text, session: session, style: effectiveReplyStyle)
                : text
            sessions[idx].memoryLog.insert("USER: \(transcriptPrompt)", at: 0)
            sessions[idx].memoryLog = Array(sessions[idx].memoryLog.prefix(40))
            sessions[idx].memorySummary = summarizeMemory(for: sessions[idx])
        }

        let conversationId = selectedSessionIndex.map { sessions[$0].id }
        socketClient.sendTask(
            goal: goal,
            conversationId: conversationId,
            routeMode: routeMode,
            attachments: outboundAttachments
        )
        promptText = ""
        composerAttachments = []
        composerAttachmentStatus = ""
        inlineStatusMessage = tx("Reply mode: \(replyStyleLabel(effectiveReplyStyle))", "Reply mode: \(replyStyleLabel(effectiveReplyStyle))")
        if settingsAutoSyncMemory {
            syncAllMemoryToBackend()
        }
    }

    private func userPromptWithAttachmentSummary(text: String, attachments: [NativeTaskAttachment]) -> String {
        guard !attachments.isEmpty else { return text }
        let lines = attachments.prefix(8).map { "- \($0.name) [\($0.kind), \(humanReadableByteCount($0.size))]" }
        return "\(text)\n\n[Attachments]\n\(lines.joined(separator: "\n"))"
    }

    private func shouldWrapPromptWithSessionContext(_ prompt: String, routeMode: String? = nil) -> Bool {
        (routeMode ?? inferredRouteMode(for: prompt)) == "task"
    }

    private func inferredRouteMode(for prompt: String, hasAttachments: Bool = false) -> String {
        if chatRouteMode == "chat" || chatRouteMode == "task" {
            return chatRouteMode
        }

        if hasAttachments {
            return "task"
        }

        let normalized = prompt
            .lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.isEmpty { return "auto" }

        let taskVerbPattern = "(mở|mo\\b|đóng|dong\\b|tắt|tat\\b|bật|bat\\b|kiểm tra|kiem tra|check\\b|status\\b|lấy|lay\\b|xem\\b|show\\b|gửi|gui\\b|chạy|chay\\b|run\\b|open\\b|close\\b|shutdown\\b|restart\\b|kill\\b|install\\b|uninstall\\b|fetch\\b|download\\b|upload\\b|execute\\b|benchmark\\b|profile\\b|scan\\b|sync\\b|chụp|chup\\b|màn\\s*hình|man\\s*hinh|screenshot|capture|cpu\\b|ram\\b|battery\\b|pin\\b|wifi\\b|bluetooth\\b|volume\\b|brightness\\b|quyền|quyen\\b|permission\\b|trạng\\s+thái|trang\\s+thai|process\\b|tiến\\s+trình|tien\\s+trinh|window\\b|tab\\b)"
        let chatCuePattern = "(xin\\s+chào|xin\\s+chao|chào|chao\\b|hello\\b|hi\\b|tại\\s+sao|tai\\s+sao|là\\s+gì|la\\s+gi|giải\\s+thích|giai\\s+thich|kể\\s+cho|ke\\s+cho|bạn\\s+nghĩ\\s+gì|ban\\s+nghi\\s+gi)"
        let hasTaskCue = normalized.range(of: taskVerbPattern, options: .regularExpression) != nil
        let hasChatCue = normalized.range(of: chatCuePattern, options: .regularExpression) != nil

        if hasTaskCue { return "task" }
        if hasChatCue { return "chat" }
        return "auto"
    }

    private var selectedSessionTranscript: [String] {
        guard let idx = selectedSessionIndex else { return [] }
        let reversed = Array(sessions[idx].memoryLog.reversed())
        let baseFiltered = settingsShowSystemMessages ? reversed : reversed.filter { !$0.lowercased().hasPrefix("system:") }
        let withoutExecutionSteps = baseFiltered.filter { !isExecutionStepLine($0) }
        let cleaned = withoutExecutionSteps.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return dedupeAdjacentTranscript(cleaned)
    }

    private func isExecutionStepLine(_ line: String) -> Bool {
        let normalized = line
            .lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.contains("step 1") || normalized.contains("step 2") || normalized.contains("step 3") {
            return true
        }
        if normalized.contains("surface] executing") || normalized.contains("surface] completed") {
            return true
        }
        return false
    }

    private func captureLatestSocketMessage() {
        guard let last = socketClient.messages.last else { return }
        if last.role.lowercased() == "user" { return }
        let incomingText = last.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if incomingText.isEmpty { return }

        // Hide internal planner/task-accepted payloads from the user-facing chat timeline.
        if last.role.lowercased() == "assistant" && isInternalAssistantPayload(incomingText) {
            return
        }

        // Avoid showing transient raw JSON fragments while the first assistant reply is still streaming.
        if last.role.lowercased() == "assistant" && shouldDeferStreamingAssistantMessage(incomingText) {
            return
        }

        let targetConversationID = socketClient.activeConversationIdForLatestMessage ?? selectedConversationID
        guard let targetConversationID,
              let idx = sessions.firstIndex(where: { $0.id == targetConversationID }) else { return }

        let entry = "\(last.role.uppercased()): \(incomingText)"
        if let first = sessions[idx].memoryLog.first,
           first.lowercased().hasPrefix("\(last.role.lowercased()):") {
            let existing = first.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            let existingText = existing.count > 1 ? String(existing[1]).trimmingCharacters(in: .whitespaces) : ""
            if !existingText.isEmpty && incomingText.hasPrefix(existingText) {
                sessions[idx].memoryLog[0] = entry
                sessions[idx].memorySummary = summarizeMemory(for: sessions[idx])
                return
            }
        }

        if normalizeTranscriptLine(sessions[idx].memoryLog.first ?? "") != normalizeTranscriptLine(entry) {
            sessions[idx].memoryLog.insert(entry, at: 0)
            sessions[idx].memoryLog = Array(sessions[idx].memoryLog.prefix(40))
            sessions[idx].memorySummary = summarizeMemory(for: sessions[idx])
        }

        let shouldMirrorInVoicePanel = page == .voice || voiceWakeListenerEnabled
        if shouldMirrorInVoicePanel {
            var voiceEntry = entry
            if last.role.lowercased() == "system" && incomingText.lowercased().contains("request accepted") {
                voiceEntry = "SYSTEM: \(incomingText.replacingOccurrences(of: "Task", with: "Request"))"
            }

            if normalizeTranscriptLine(voiceConversationEntries.last ?? "") != normalizeTranscriptLine(voiceEntry) {
                voiceConversationEntries.append(voiceEntry)
                if voiceConversationEntries.count > 24 {
                    voiceConversationEntries = Array(voiceConversationEntries.suffix(24))
                }
            }
        }

        if voiceTtsEnabled && page == .voice && last.role.lowercased() == "assistant" {
            speakAssistantReply(incomingText)
        }
    }

    private func dedupeAdjacentTranscript(_ lines: [String]) -> [String] {
        var result: [String] = []
        result.reserveCapacity(lines.count)
        for line in lines {
            if normalizeTranscriptLine(result.last ?? "") != normalizeTranscriptLine(line) {
                result.append(line)
            }
        }
        return result
    }

    private func normalizeTranscriptLine(_ line: String) -> String {
        let folded = line.folding(options: [.diacriticInsensitive, .caseInsensitive, .widthInsensitive], locale: Locale(identifier: "vi_VN"))
        let lowered = folded.lowercased()
        let scalars = lowered.unicodeScalars.map { scalar -> Character in
            if CharacterSet.alphanumerics.contains(scalar) || CharacterSet.whitespacesAndNewlines.contains(scalar) {
                return Character(scalar)
            }
            return " "
        }

        return String(scalars)
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    private func shouldDeferStreamingAssistantMessage(_ text: String) -> Bool {
        guard isReplyStreaming else { return false }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{") || trimmed.hasPrefix("[") else { return false }
        guard let data = trimmed.data(using: .utf8) else { return true }
        return (try? JSONSerialization.jsonObject(with: data)) == nil
    }

    private func isInternalAssistantPayload(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.contains("Task accepted:") && trimmed.contains("[Native Session Context]") {
            return true
        }

        guard let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dict = object as? [String: Any] else {
            return false
        }

        if extractUserFacingReply(from: dict) != nil {
            return false
        }

        let intent = (dict["intentType"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let goalRaw = (dict["goal"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let hasStepData = dict["stepData"] != nil
        let hasInternalContext = goalRaw.contains("[Native Session Context]") || goalRaw.contains("sessionMemorySummary") || goalRaw.contains("[Reply Preference]")

        if !intent.isEmpty && hasStepData && hasInternalContext {
            return true
        }

        // Planner classification-only payloads (intent/confidence/goal) are internal.
        if !intent.isEmpty {
            return true
        }

        return false
    }

    private func buildGoalWithMemory(goal: String, session: NativeConversation, style: ReplyStyle) -> String {
        let summary = session.memorySummary.isEmpty ? "(empty)" : session.memorySummary
        let shared = sharedMemorySummary.isEmpty ? "(empty)" : sharedMemorySummary
        return """
        [Native Session Context]
        sessionId: \(session.id)
        sessionName: \(session.title)
        sharedMemorySummary: \(shared)
        sessionMemorySummary: \(summary)

        [Reply Preference]
        language: \(selectedLanguage)
        style: \(style.rawValue)
        instruction: \(replyStyleInstruction(style))

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

    private func copyToClipboard(_ text: String) {
        let board = NSPasteboard.general
        board.clearContents()
        board.setString(text, forType: .string)
    }

    private func miniReplyActionButton(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 9, weight: .bold))
                Text(label)
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundColor(CyberColor.textSecondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(CyberColor.glassBg)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(CyberColor.glassBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    @MainActor
    private func startInnovationAutopilot() {
        guard !innovationAutopilotRunning else { return }
        if innovationExecutionQueue.isEmpty {
            innovationExecutionQueue = seedCoreInnovationIdeas()
        }
        innovationAutopilotRunning = true
        inlineStatusMessage = tx("Autopilot đang chạy 30 ideas...", "Autopilot is running 30 ideas...")

        Task { @MainActor in
            await runInnovationAutopilotPipeline()
        }
    }

    @MainActor
    private func resetInnovationAutopilot() {
        innovationExecutionQueue = seedCoreInnovationIdeas()
        innovationAutopilotRunning = false
        innovationAutoExpanded = false
        innovationLastExecutedTitle = ""
        inlineStatusMessage = tx("Đã reset queue về 30 ideas gốc.", "Queue reset to original 30 ideas.")
    }

    @MainActor
    private func runInnovationAutopilotPipeline() async {
        for idx in innovationExecutionQueue.indices where !innovationExecutionQueue[idx].completed {
            executeInnovation(at: idx)
            try? await Task.sleep(nanoseconds: 180_000_000)
        }

        if !innovationAutoExpanded {
            innovationAutoExpanded = true
            innovationExecutionQueue.append(contentsOf: seedExtendedInnovationIdeas())
            inlineStatusMessage = tx("Đã tự phát triển thêm 20 ideas, tiếp tục thực thi...", "Auto-generated 20 extra ideas, continuing execution...")

            for idx in innovationExecutionQueue.indices where !innovationExecutionQueue[idx].completed {
                executeInnovation(at: idx)
                try? await Task.sleep(nanoseconds: 180_000_000)
            }
        }

        innovationAutopilotRunning = false
        inlineStatusMessage = tx("Autopilot hoàn tất 50/50 ideas.", "Autopilot completed 50/50 ideas.")
    }

    @MainActor
    private func executeInnovation(at index: Int) {
        guard innovationExecutionQueue.indices.contains(index) else { return }
        let item = innovationExecutionQueue[index]
        socketClient.sendTask(goal: item.goal, conversationId: selectedConversationID)
        innovationExecutionQueue[index].completed = true
        innovationLastExecutedTitle = item.title
    }

    private func seedCoreInnovationIdeas() -> [InnovationExecutionItem] {
        [
            InnovationExecutionItem(id: "core-01", title: "Realtime full-duplex voice", category: "voice", goal: "Enable full-duplex real-time voice chat with barge-in behavior and latency-safe turn handling", completed: false),
            InnovationExecutionItem(id: "core-02", title: "Adaptive wake sensitivity", category: "voice", goal: "Tune wake-word sensitivity based on ambient noise profile and reduce false positives", completed: false),
            InnovationExecutionItem(id: "core-03", title: "Voice command chaining", category: "voice", goal: "Parse one spoken command into multiple executable steps and run sequentially", completed: false),
            InnovationExecutionItem(id: "core-04", title: "Global push-to-talk", category: "voice", goal: "Activate push-to-talk global hotkey capture and verify command relay", completed: false),
            InnovationExecutionItem(id: "core-05", title: "Voice persona switch", category: "voice", goal: "Apply dynamic TTS persona switching by workspace context", completed: false),
            InnovationExecutionItem(id: "core-06", title: "Live transcript editor", category: "voice", goal: "Enable live transcript correction panel before command submit", completed: false),
            InnovationExecutionItem(id: "core-07", title: "Auto call summaries", category: "memory", goal: "Generate summary cards after each voice and chat session", completed: false),
            InnovationExecutionItem(id: "core-08", title: "Ask-screen runtime", category: "screen", goal: "Allow user to ask direct questions from current screen context with fast OCR hints", completed: false),
            InnovationExecutionItem(id: "core-09", title: "Smart command palette", category: "chat", goal: "Launch AI command palette with context-aware command suggestions", completed: false),
            InnovationExecutionItem(id: "core-10", title: "Prompt snippet macros", category: "chat", goal: "Expand prompt snippets with runtime macros including app and timestamp", completed: false),
            InnovationExecutionItem(id: "core-11", title: "Session branching", category: "memory", goal: "Create branchable conversation paths for scenario exploration", completed: false),
            InnovationExecutionItem(id: "core-12", title: "Memory timeline replay", category: "memory", goal: "Replay memory snapshots at selected timestamps", completed: false),
            InnovationExecutionItem(id: "core-13", title: "Semantic memory search", category: "memory", goal: "Enable semantic search over session memory and shared context", completed: false),
            InnovationExecutionItem(id: "core-14", title: "Auto session tagging", category: "memory", goal: "Auto-tag sessions by app, intent, and project topic", completed: false),
            InnovationExecutionItem(id: "core-15", title: "Session health scoring", category: "memory", goal: "Score each session by clarity, completion, and blockers", completed: false),
            InnovationExecutionItem(id: "core-16", title: "Native task board", category: "productivity", goal: "Sync quick task board with conversation outcomes and statuses", completed: false),
            InnovationExecutionItem(id: "core-17", title: "Agent swarm mode", category: "agents", goal: "Dispatch parallel agents for one objective and merge outputs", completed: false),
            InnovationExecutionItem(id: "core-18", title: "Explainability panel", category: "agents", goal: "Show provider, route, and reasoning metadata per response", completed: false),
            InnovationExecutionItem(id: "core-19", title: "Confidence meter", category: "agents", goal: "Compute confidence score and recommend verification actions", completed: false),
            InnovationExecutionItem(id: "core-20", title: "One-click automation", category: "triggers", goal: "Turn successful conversations into reusable automation triggers", completed: false),
            InnovationExecutionItem(id: "core-21", title: "Realtime observability", category: "health", goal: "Stream realtime CPU/RAM/IO/network telemetry in unified pane", completed: false),
            InnovationExecutionItem(id: "core-22", title: "Anomaly detection", category: "health", goal: "Detect anomalies from telemetry and push warning alerts", completed: false),
            InnovationExecutionItem(id: "core-23", title: "Self-healing recipes", category: "health", goal: "Apply safe self-healing recipes for common runtime failures", completed: false),
            InnovationExecutionItem(id: "core-24", title: "Permission hardening audit", category: "security", goal: "Audit and suggest hardened macOS permission posture", completed: false),
            InnovationExecutionItem(id: "core-25", title: "Battery optimizer", category: "machine", goal: "Recommend battery-saving profiles based on usage patterns", completed: false),
            InnovationExecutionItem(id: "core-26", title: "Latency heatmap", category: "health", goal: "Create end-to-end latency heatmap for tool and model calls", completed: false),
            InnovationExecutionItem(id: "core-27", title: "Incident mode", category: "health", goal: "Collect logs, snapshots, and timeline into incident package", completed: false),
            InnovationExecutionItem(id: "core-28", title: "Sandbox execution", category: "security", goal: "Force risky commands into sandbox execution mode", completed: false),
            InnovationExecutionItem(id: "core-29", title: "Config rollback checkpoints", category: "config", goal: "Create reversible checkpoints for runtime configuration", completed: false),
            InnovationExecutionItem(id: "core-30", title: "Remote companion bridge", category: "remote", goal: "Prepare secure remote companion handshake for mobile approval flows", completed: false)
        ]
    }

    private func seedExtendedInnovationIdeas() -> [InnovationExecutionItem] {
        [
            InnovationExecutionItem(id: "extra-01", title: "Realtime multilingual translation", category: "voice", goal: "Translate voice chat in realtime between VI and EN without losing intent", completed: false),
            InnovationExecutionItem(id: "extra-02", title: "Whisper fallback routing", category: "voice", goal: "Auto-route STT to fallback engine when confidence drops", completed: false),
            InnovationExecutionItem(id: "extra-03", title: "Meeting copilot mode", category: "voice", goal: "Enable meeting copilot mode with agenda tracking and action extraction", completed: false),
            InnovationExecutionItem(id: "extra-04", title: "Live app intent map", category: "machine", goal: "Map active app states to suggested intents in realtime", completed: false),
            InnovationExecutionItem(id: "extra-05", title: "Cross-app macro builder", category: "triggers", goal: "Build cross-app macro graph from natural language description", completed: false),
            InnovationExecutionItem(id: "extra-06", title: "Smart retry policy", category: "agents", goal: "Introduce adaptive retry policy for transient tool failures", completed: false),
            InnovationExecutionItem(id: "extra-07", title: "Token budget governor", category: "agents", goal: "Govern response depth by dynamic token budget policy", completed: false),
            InnovationExecutionItem(id: "extra-08", title: "Runtime AB model testing", category: "config", goal: "Run A/B model response testing and store win-rate metrics", completed: false),
            InnovationExecutionItem(id: "extra-09", title: "Diff-aware memory sync", category: "memory", goal: "Sync only memory diffs to reduce payload and latency", completed: false),
            InnovationExecutionItem(id: "extra-10", title: "Memory conflict resolver", category: "memory", goal: "Resolve conflicting memory entries with confidence-ranked merge", completed: false),
            InnovationExecutionItem(id: "extra-11", title: "Visual workflow editor", category: "productivity", goal: "Provide visual DAG editor for automation workflows", completed: false),
            InnovationExecutionItem(id: "extra-12", title: "Auto changelog from sessions", category: "productivity", goal: "Generate daily changelog from completed tasks and chats", completed: false),
            InnovationExecutionItem(id: "extra-13", title: "Alert suppression windows", category: "health", goal: "Suppress non-critical alerts during focus hours", completed: false),
            InnovationExecutionItem(id: "extra-14", title: "Network quality forecaster", category: "health", goal: "Forecast short-term network quality for model routing", completed: false),
            InnovationExecutionItem(id: "extra-15", title: "App crash prediction", category: "health", goal: "Predict app crash risk from process telemetry trends", completed: false),
            InnovationExecutionItem(id: "extra-16", title: "Auto secret redaction", category: "security", goal: "Redact secrets from logs and chat output automatically", completed: false),
            InnovationExecutionItem(id: "extra-17", title: "Policy-based approvals", category: "security", goal: "Require approval policy before privileged automation runs", completed: false),
            InnovationExecutionItem(id: "extra-18", title: "Device trust scoring", category: "remote", goal: "Score remote device trust and adjust access scope", completed: false),
            InnovationExecutionItem(id: "extra-19", title: "Offline execution queue", category: "remote", goal: "Queue tasks offline and replay when gateway reconnects", completed: false),
            InnovationExecutionItem(id: "extra-20", title: "Weekly optimization report", category: "productivity", goal: "Generate weekly optimization report with KPI deltas and next actions", completed: false)
        ]
    }
}
