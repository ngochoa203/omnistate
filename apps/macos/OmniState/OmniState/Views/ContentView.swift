import SwiftUI
import WebKit

struct ContentView: View {
    @EnvironmentObject var gatewayManager: GatewayManager
    @EnvironmentObject var healthChecker: HealthChecker

    var body: some View {
        ZStack {
            WebViewContainer()
                .opacity(healthChecker.isHealthy ? 1 : 0)

            if !healthChecker.isHealthy {
                VStack(spacing: 16) {
                    ProgressView()
                        .scaleEffect(1.5)

                    Text(gatewayManager.isRunning ? "Connecting to Gateway..." : "Starting Gateway...")
                        .font(.title2)
                        .foregroundColor(.secondary)

                    if let error = gatewayManager.lastError {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .padding(.horizontal)
                    }

                    Button("Retry") {
                        gatewayManager.stop()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                            gatewayManager.start()
                        }
                    }
                    .padding(.top, 8)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(nsColor: .windowBackgroundColor))
            }
        }
    }
}
