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
        hosting.frame = CGRect(origin: .zero, size: CGSize(width: 120, height: 120))
        p.contentView = hosting
        return p
    }

    private func bubbleRect() -> CGRect {
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let visibleFrame = screen.visibleFrame
        let size: CGFloat = 120
        let margin: CGFloat = 20
        return CGRect(
            x: visibleFrame.maxX - size - margin,
            y: visibleFrame.minY + margin,
            width: size,
            height: size
        )
    }
}

// MARK: - SwiftUI View

struct ListeningBubbleView: View {
    @State private var pulsing = false
    @ObservedObject private var client = GatewaySocketClient.shared

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [Color(red: 0.2, green: 0.5, blue: 1.0),
                                 Color(red: 0.6, green: 0.2, blue: 0.9)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .shadow(color: .black.opacity(0.4), radius: 8, x: 0, y: 4)

            // Green confirmation ring — visible for ~400ms after wake word fires
            if client.isWakeConfirmation {
                Circle()
                    .strokeBorder(Color.green, lineWidth: 4)
                    .transition(.opacity)
            }

            VStack(spacing: 4) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundColor(.white)
                Text("Đang lắng nghe...")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(.white.opacity(0.9))
                    .lineLimit(1)
            }
        }
        .frame(width: 100, height: 100)
        .scaleEffect(client.isWakeConfirmation ? 1.3 : (pulsing ? 1.08 : 0.96))
        .opacity(pulsing ? 1.0 : 0.85)
        .animation(
            .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
            value: pulsing
        )
        .animation(.easeInOut(duration: 0.15), value: client.isWakeConfirmation)
        .onAppear { pulsing = true }
    }
}
