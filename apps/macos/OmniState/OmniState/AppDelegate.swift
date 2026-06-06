import AppKit

class AppDelegate: NSObject, NSApplicationDelegate {
    private var hotkeyManager: HotkeyManager?
    private var sleepObserver: NSObjectProtocol?
    private var wakeObserver: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            await PermissionBootstrapper.shared.requestAllInitialPermissions(force: true)
        }

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
        observeSystemPowerLifecycle()
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let sleepObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(sleepObserver)
        }
        if let wakeObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(wakeObserver)
        }
        NetworkMonitor.shared.stopMonitoring()
        DeviceManager.shared.stopPINRefresh()
        GatewayManager.shared.stop()
        hotkeyManager?.unregister()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false  // Keep running in menu bar
    }

    private func observeSystemPowerLifecycle() {
        let center = NSWorkspace.shared.notificationCenter
        sleepObserver = center.addObserver(
            forName: NSWorkspace.willSleepNotification,
            object: nil,
            queue: .main
        ) { _ in
            HealthChecker.shared.stopPolling()
            GatewayManager.shared.handleSystemWillSleep()
        }

        wakeObserver = center.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { _ in
            GatewayManager.shared.handleSystemDidWake()
            HealthChecker.shared.startPolling()
            HealthChecker.shared.check()
        }
    }
}
