import Foundation
import Combine

/// Monitors system-wide events: clipboard changes, Downloads folder, app switches.
/// Publishes events that the GatewaySocketClient can forward to the gateway.
@MainActor
final class GlobalEventMonitor: ObservableObject {
    static let shared = GlobalEventMonitor()

    @Published var lastClipboardContent: String = ""
    @Published var lastDownloadedFile: String = ""
    @Published var isMonitoring = false

    /// Event stream for the gateway
    let eventSubject = PassthroughSubject<SystemEvent, Never>()

    private var clipboardTimer: Timer?
    private var lastClipboardChangeCount: Int = 0
    private var downloadsMonitor: DispatchSourceFileSystemObject?
    private var downloadsFileDescriptor: Int32 = -1

    private init() {}

    // MARK: - Start/Stop

    func startMonitoring() {
        guard !isMonitoring else { return }
        isMonitoring = true
        startClipboardMonitor()
        startDownloadsMonitor()
    }

    func stopMonitoring() {
        isMonitoring = false
        clipboardTimer?.invalidate()
        clipboardTimer = nil
        downloadsMonitor?.cancel()
        downloadsMonitor = nil
        if downloadsFileDescriptor >= 0 {
            close(downloadsFileDescriptor)
            downloadsFileDescriptor = -1
        }
    }

    // MARK: - Clipboard Monitor (polling NSPasteboard every 500ms)

    private func startClipboardMonitor() {
        lastClipboardChangeCount = NSPasteboard.general.changeCount
        clipboardTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.checkClipboard()
            }
        }
    }

    private func checkClipboard() {
        let current = NSPasteboard.general.changeCount
        guard current != lastClipboardChangeCount else { return }
        lastClipboardChangeCount = current

        if let content = NSPasteboard.general.string(forType: .string) {
            let truncated = String(content.prefix(500))
            lastClipboardContent = truncated
            eventSubject.send(.clipboardChanged(content: truncated))
        }
    }

    // MARK: - Downloads Folder Monitor (FSEvents via GCD)

    private func startDownloadsMonitor() {
        let downloadsPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Downloads").path

        downloadsFileDescriptor = open(downloadsPath, O_EVTONLY)
        guard downloadsFileDescriptor >= 0 else { return }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: downloadsFileDescriptor,
            eventMask: .write,
            queue: .global(qos: .utility)
        )

        source.setEventHandler { [weak self] in
            self?.handleDownloadsChange(path: downloadsPath)
        }

        source.setCancelHandler { [weak self] in
            if let fd = self?.downloadsFileDescriptor, fd >= 0 {
                close(fd)
                self?.downloadsFileDescriptor = -1
            }
        }

        source.resume()
        downloadsMonitor = source
    }

    private func handleDownloadsChange(path: String) {
        // Find the most recently modified file
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: URL(fileURLWithPath: path),
            includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else { return }

        let recent = contents
            .compactMap { url -> (URL, Date)? in
                guard let date = try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate else { return nil }
                return (url, date)
            }
            .sorted { $0.1 > $1.1 }
            .first

        guard let (fileURL, modDate) = recent,
              Date().timeIntervalSince(modDate) < 5.0 // Only report files modified in last 5s
        else { return }

        let fileName = fileURL.lastPathComponent
        // Skip partial downloads
        guard !fileName.hasSuffix(".crdownload"),
              !fileName.hasSuffix(".download"),
              !fileName.hasSuffix(".part")
        else { return }

        Task { @MainActor in
            self.lastDownloadedFile = fileName
            let size = (try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            self.eventSubject.send(.fileDownloaded(
                name: fileName,
                path: fileURL.path,
                sizeBytes: size
            ))
        }
    }

    deinit {
        // Best-effort cleanup (not MainActor-isolated)
        clipboardTimer?.invalidate()
        downloadsMonitor?.cancel()
        if downloadsFileDescriptor >= 0 { close(downloadsFileDescriptor) }
    }
}

// MARK: - Event Types

enum SystemEvent {
    case clipboardChanged(content: String)
    case fileDownloaded(name: String, path: String, sizeBytes: Int)
    case appSwitched(from: String, to: String)

    /// Serialize to JSON for WebSocket transmission.
    var asJson: [String: Any] {
        switch self {
        case .clipboardChanged(let content):
            return ["type": "system.clipboard.changed", "content": content]
        case .fileDownloaded(let name, let path, let size):
            return ["type": "system.file.downloaded", "name": name, "path": path, "sizeBytes": size]
        case .appSwitched(let from, let to):
            return ["type": "system.app.switched", "from": from, "to": to]
        }
    }
}
