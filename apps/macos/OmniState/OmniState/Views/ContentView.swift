import SwiftUI

struct ContentView: View {
    @EnvironmentObject var gatewayManager: GatewayManager
    @EnvironmentObject var healthChecker: HealthChecker

    var body: some View {
        ZStack(alignment: .topLeading) {
            WebViewContainer()
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            HStack(spacing: 8) {
                Circle()
                    .fill(healthChecker.isHealthy ? Color.green : (gatewayManager.isRunning ? Color.orange : Color.red))
                    .frame(width: 8, height: 8)
                Text(healthChecker.isHealthy ? "Gateway Healthy" : (gatewayManager.isRunning ? "Gateway Starting" : "Gateway Stopped"))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .padding(12)
        }
    }
}
