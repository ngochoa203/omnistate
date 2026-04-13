import AppKit
import UserNotifications

class AppDelegate: NSObject, NSApplicationDelegate {
    private var hotkeyManager: HotkeyManager?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Auto-start gateway
        GatewayManager.shared.start()
        HealthChecker.shared.startPolling()

        // Start network + device monitors (gateway may not be up yet; they will
        // simply no-op until it responds)
        NetworkMonitor.shared.startMonitoring()
        DeviceManager.shared.startPINRefresh()
        Task { await DeviceManager.shared.fetchDevices() }

        // Register global hotkey ⌘⇧O
        hotkeyManager = HotkeyManager()
        hotkeyManager?.register()

        // Request notification permission
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                print("[OmniState] Notification permission error: \(error)")
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        NetworkMonitor.shared.stopMonitoring()
        DeviceManager.shared.stopPINRefresh()
        GatewayManager.shared.stop()
        hotkeyManager?.unregister()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false  // Keep running in menu bar
    }
}
