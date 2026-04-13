import SwiftUI

@main
struct OmniStateApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var gatewayManager = GatewayManager.shared
    @StateObject private var healthChecker = HealthChecker.shared
    @StateObject private var networkMonitor = NetworkMonitor.shared
    @StateObject private var deviceManager = DeviceManager.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(gatewayManager)
                .environmentObject(healthChecker)
                .environmentObject(networkMonitor)
                .environmentObject(deviceManager)
                .frame(minWidth: 900, minHeight: 600)
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified)
        .commands {
            CommandGroup(replacing: .newItem) { }
            CommandMenu("OmniState") {
                Button("Start Gateway") {
                    gatewayManager.start()
                }
                .keyboardShortcut("g", modifiers: [.command, .shift])
                .disabled(gatewayManager.isRunning)

                Button("Stop Gateway") {
                    gatewayManager.stop()
                }
                .disabled(!gatewayManager.isRunning)

                Divider()

                Button("Open Dashboard") {
                    NSApp.activate(ignoringOtherApps: true)
                }
                .keyboardShortcut("o", modifiers: [.command, .shift])
            }
        }

        MenuBarExtra {
            MenuBarView()
                .environmentObject(gatewayManager)
                .environmentObject(healthChecker)
                .environmentObject(networkMonitor)
                .environmentObject(deviceManager)
        } label: {
            Image(systemName: healthChecker.isHealthy ? "circle.fill" : "circle")
                .foregroundColor(healthChecker.isHealthy ? .green : .red)
            Text("OS")
        }
    }
}
