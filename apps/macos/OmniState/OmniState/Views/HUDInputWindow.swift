import AppKit
import SwiftUI
import Combine

// MARK: - Controller

@MainActor
final class HUDInputController: ObservableObject {
    static let shared = HUDInputController()

    @Published var isVisible = false
    @Published var inputText = ""
    @Published var statusMessage = ""
    @Published var isProcessing = false

    private var panel: NSPanel?

    private init() {}

    /// Toggle the HUD (called from hotkey ⌘⇧O)
    func toggle() {
        if isVisible { hide() } else { show() }
    }

    func show() {
        if panel == nil { panel = makePanel() }
        inputText = ""
        statusMessage = ""
        isProcessing = false
        panel?.center()  // Center on main screen
        panel?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        isVisible = true
    }

    func hide() {
        panel?.orderOut(nil)
        isVisible = false
        inputText = ""
    }

    /// Submit the input to the gateway
    func submit() {
        guard !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        isProcessing = true
        statusMessage = "Đang xử lý..."
        let text = inputText
        GatewaySocketClient.shared.sendTask(goal: text, routeMode: "auto")
        // Auto-hide after 1.5s
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.hide()
        }
    }

    private func makePanel() -> NSPanel {
        let styleMask: NSWindow.StyleMask = [
            .nonactivatingPanel,
            .hudWindow,
            .borderless,
        ]
        let frame = panelRect()
        let p = NSPanel(
            contentRect: frame,
            styleMask: styleMask,
            backing: .buffered,
            defer: false
        )
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = true
        p.isMovableByWindowBackground = true
        p.hidesOnDeactivate = false  // Stay visible even when focus leaves

        let hosting = NSHostingView(rootView: HUDInputView())
        hosting.frame = CGRect(origin: .zero, size: frame.size)
        p.contentView = hosting

        return p
    }

    private func panelRect() -> CGRect {
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let screenFrame = screen.frame
        let width: CGFloat = 600
        let height: CGFloat = 64
        return CGRect(
            x: (screenFrame.width - width) / 2 + screenFrame.origin.x,
            y: screenFrame.midY + 100,  // Slightly above center (like Spotlight)
            width: width,
            height: height
        )
    }
}

// MARK: - SwiftUI View

struct HUDInputView: View {
    @ObservedObject private var controller = HUDInputController.shared
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 12) {
            // Left icon
            Image(systemName: controller.isProcessing ? "brain.head.profile" : "magnifyingglass")
                .font(.system(size: 20, weight: .medium))
                .foregroundColor(.white.opacity(0.7))
                .frame(width: 32)

            // Text field
            TextField("Hỏi OmniState bất cứ điều gì...", text: $controller.inputText)
                .textFieldStyle(.plain)
                .font(.system(size: 18, weight: .regular))
                .foregroundColor(.white)
                .focused($isFocused)
                .onSubmit { controller.submit() }
                .disabled(controller.isProcessing)

            // Status or shortcut hint
            if controller.isProcessing {
                ProgressView()
                    .controlSize(.small)
                    .tint(.white)
            } else if !controller.inputText.isEmpty {
                Text("⏎")
                    .font(.system(size: 14))
                    .foregroundColor(.white.opacity(0.4))
            }
        }
        .padding(.horizontal, 20)
        .frame(width: 600, height: 56)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.12, green: 0.12, blue: 0.18).opacity(0.97),
                            Color(red: 0.08, green: 0.08, blue: 0.14).opacity(0.97),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .shadow(color: .black.opacity(0.4), radius: 20, x: 0, y: 8)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5)
        )
        .onAppear { isFocused = true }
        .onExitCommand { controller.hide() }  // Escape key
    }
}
