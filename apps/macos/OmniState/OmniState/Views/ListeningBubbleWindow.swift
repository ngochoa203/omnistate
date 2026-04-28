import AppKit
import SwiftUI
import Combine

// MARK: - Controller

@MainActor
final class ListeningBubbleController: ObservableObject {
    static let shared = ListeningBubbleController()

    private var panel: NSPanel?
    private var cancellables = Set<AnyCancellable>()
    private var idleTimer: Timer?
    private let idleTimeout: TimeInterval = 5.0

    private init() {}

    func forceToFront() {
        if panel == nil { panel = makePanelIfNeeded() }
        panel?.level = .floating
        panel?.orderFrontRegardless()
        scheduleIdleHide()
    }

    func show() {
        if panel == nil { panel = makePanelIfNeeded() }
        panel?.orderFrontRegardless()
        scheduleIdleHide()
    }

    /// Reset the idle timer — call when voice activity arrives so the bubble stays visible.
    func keepAlive() {
        guard panel?.isVisible == true else { return }
        scheduleIdleHide()
    }

    func hide() {
        idleTimer?.invalidate()
        idleTimer = nil
        panel?.orderOut(nil)
    }

    private func scheduleIdleHide() {
        idleTimer?.invalidate()
        idleTimer = Timer.scheduledTimer(withTimeInterval: idleTimeout, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.hide()
            }
        }
    }

    private func makePanelIfNeeded() -> NSPanel {
        let styleMask: NSWindow.StyleMask = [
            .nonactivatingPanel,
            .hudWindow,
            .borderless,
        ]
        let p = NSPanel(
            contentRect: bubbleRect(),
            styleMask: styleMask,
            backing: .buffered,
            defer: false
        )
        p.level = .statusBar
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = false
        p.isMovableByWindowBackground = false

        let hosting = NSHostingView(rootView: ListeningBubbleView())
        hosting.frame = CGRect(origin: .zero, size: CGSize(width: 280, height: 80))
        p.contentView = hosting
        return p
    }

    private func bubbleRect() -> CGRect {
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let visibleFrame = screen.visibleFrame
        let width: CGFloat = 280
        let height: CGFloat = 80
        let margin: CGFloat = 20
        return CGRect(
            x: visibleFrame.maxX - width - margin,
            y: visibleFrame.maxY - height - margin,
            width: width,
            height: height
        )
    }
}

// MARK: - SwiftUI View

struct ListeningBubbleView: View {
    @State private var pulsing = false
    @ObservedObject private var client = GatewaySocketClient.shared
    @ObservedObject private var voiceCapture = VoiceCaptureService.shared

    var body: some View {
        ZStack {
            // Pill background
            RoundedRectangle(cornerRadius: 20)
                .fill(
                    LinearGradient(
                        colors: [Color(red: 0.15, green: 0.15, blue: 0.2).opacity(0.95),
                                 Color(red: 0.1, green: 0.1, blue: 0.18).opacity(0.95)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .shadow(color: .black.opacity(0.3), radius: 10, x: 0, y: 4)

            // Green confirmation ring — visible for ~400ms after wake word fires
            if client.isWakeConfirmation {
                RoundedRectangle(cornerRadius: 20)
                    .strokeBorder(Color.green, lineWidth: 3)
                    .transition(.opacity)
            }

            HStack(spacing: 12) {
                // Left: Mic icon with recording indicator
                ZStack {
                    Circle()
                        .fill(Color.white.opacity(0.1))
                        .frame(width: 44, height: 44)

                    Image(systemName: "mic.fill")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(.white)

                    // Red pulsing recording dot
                    if voiceCapture.isRecording {
                        Circle()
                            .fill(Color.red)
                            .frame(width: 8, height: 8)
                            .offset(x: 12, y: -12)
                            .opacity(pulsing ? 1.0 : 0.4)
                    }
                }

                // Center: Status + transcript
                VStack(alignment: .leading, spacing: 3) {
                    Text("Đang lắng nghe...")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white.opacity(0.9))
                        .lineLimit(1)

                    if !voiceCapture.transcript.isEmpty {
                        Text(voiceCapture.transcript)
                            .font(.system(size: 10, weight: .regular))
                            .foregroundColor(.white.opacity(0.6))
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }

                Spacer()
            }
            .padding(.horizontal, 16)
        }
        .frame(width: 260, height: 64)
        .scaleEffect(client.isWakeConfirmation ? 1.05 : (pulsing ? 1.02 : 0.98))
        .opacity(pulsing ? 1.0 : 0.9)
        .animation(
            .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
            value: pulsing
        )
        .animation(.easeInOut(duration: 0.15), value: client.isWakeConfirmation)
        .onAppear { pulsing = true }
    }
}
