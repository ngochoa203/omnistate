import AppKit
import SwiftUI
import Combine

// MARK: - Controller

@MainActor
final class BoundingBoxController: ObservableObject {
    static let shared = BoundingBoxController()

    @Published var activeBoxes: [HighlightBox] = []

    private var overlayWindow: NSWindow?
    private var hideTimers: [UUID: Timer] = [:]

    private init() {}

    /// Flash a bounding box at the given screen coordinates.
    /// - Parameters:
    ///   - rect: Screen coordinates (origin top-left, matching CGEvent coordinate space)
    ///   - color: Box border color (.green for success, .red for error, .blue for info)
    ///   - label: Optional text label to show above the box
    ///   - durationMs: How long to show the box (default 500ms)
    func flash(rect: CGRect, color: NSColor = .systemGreen, label: String? = nil, durationMs: Int = 500) {
        ensureOverlayWindow()

        let box = HighlightBox(
            id: UUID(),
            rect: flipY(rect),  // Convert from top-left to bottom-left (Cocoa coords)
            color: Color(nsColor: color),
            label: label
        )

        activeBoxes.append(box)

        // Schedule removal
        let timer = Timer.scheduledTimer(withTimeInterval: Double(durationMs) / 1000.0, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.activeBoxes.removeAll { $0.id == box.id }
                self?.hideTimers.removeValue(forKey: box.id)
                // Hide window if no more boxes
                if self?.activeBoxes.isEmpty == true {
                    self?.overlayWindow?.orderOut(nil)
                }
            }
        }
        hideTimers[box.id] = timer
    }

    /// Flash a highlight at element center (small circle pulse)
    func flashPoint(x: CGFloat, y: CGFloat, color: NSColor = .systemGreen, label: String? = nil) {
        let size: CGFloat = 40
        flash(
            rect: CGRect(x: x - size / 2, y: y - size / 2, width: size, height: size),
            color: color,
            label: label,
            durationMs: 600
        )
    }

    /// Clear all active boxes immediately
    func clearAll() {
        activeBoxes.removeAll()
        hideTimers.values.forEach { $0.invalidate() }
        hideTimers.removeAll()
        overlayWindow?.orderOut(nil)
    }

    // MARK: - Private

    private func ensureOverlayWindow() {
        if overlayWindow == nil {
            overlayWindow = makeOverlayWindow()
        }
        overlayWindow?.orderFrontRegardless()
    }

    private func makeOverlayWindow() -> NSWindow {
        // Cover the entire main screen
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let frame = screen.frame

        let window = NSWindow(
            contentRect: frame,
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        window.level = .screenSaver  // Above everything
        window.isOpaque = false
        window.backgroundColor = .clear
        window.ignoresMouseEvents = true  // Click-through
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        window.hasShadow = false

        let hosting = NSHostingView(rootView: BoundingBoxOverlayView())
        hosting.frame = CGRect(origin: .zero, size: frame.size)
        window.contentView = hosting

        return window
    }

    /// Convert from screen coordinates (origin top-left) to Cocoa coordinates (origin bottom-left)
    private func flipY(_ rect: CGRect) -> CGRect {
        guard let screen = NSScreen.main else { return rect }
        let screenHeight = screen.frame.height
        return CGRect(
            x: rect.origin.x,
            y: screenHeight - rect.origin.y - rect.height,
            width: rect.width,
            height: rect.height
        )
    }
}

// MARK: - Data Model

struct HighlightBox: Identifiable {
    let id: UUID
    let rect: CGRect
    let color: Color
    let label: String?
}

// MARK: - SwiftUI Overlay View

struct BoundingBoxOverlayView: View {
    @ObservedObject private var controller = BoundingBoxController.shared

    var body: some View {
        ZStack {
            // Transparent background (click-through)
            Color.clear

            ForEach(controller.activeBoxes) { box in
                ZStack {
                    // Bounding box border
                    RoundedRectangle(cornerRadius: 4)
                        .strokeBorder(box.color, lineWidth: 3)
                        .frame(width: box.rect.width, height: box.rect.height)
                        .position(
                            x: box.rect.midX,
                            y: box.rect.midY
                        )

                    // Semi-transparent fill
                    RoundedRectangle(cornerRadius: 4)
                        .fill(box.color.opacity(0.1))
                        .frame(width: box.rect.width, height: box.rect.height)
                        .position(
                            x: box.rect.midX,
                            y: box.rect.midY
                        )

                    // Label above the box
                    if let label = box.label {
                        Text(label)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(
                                Capsule()
                                    .fill(box.color.opacity(0.85))
                            )
                            .position(
                                x: box.rect.midX,
                                y: box.rect.minY - 16
                            )
                    }
                }
                .transition(.opacity.combined(with: .scale(scale: 1.1)))
            }
        }
        .animation(.easeInOut(duration: 0.15), value: controller.activeBoxes.map(\.id))
    }
}
