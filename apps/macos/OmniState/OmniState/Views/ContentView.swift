import SwiftUI
import WebKit

struct ContentView: View {
    @EnvironmentObject var gatewayManager: GatewayManager
    @EnvironmentObject var healthChecker: HealthChecker

    var body: some View {
        ZStack {
            WebViewContainer()
                .opacity(1)

            if !healthChecker.isHealthy {
                VStack {
                    HStack(spacing: 12) {
                        ProgressView()

                        Text(gatewayManager.isRunning ? "Connecting to Gateway..." : "Starting Gateway...")
                            .font(.callout)
                            .foregroundColor(.secondary)

                        if let error = gatewayManager.lastError {
                            Text(error)
                                .font(.caption)
                                .foregroundColor(.red)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }

                        Button("Retry") {
                            gatewayManager.stop()
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                                gatewayManager.start()
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(.ultraThinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .shadow(radius: 4)
                    .padding(.top, 12)

                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .padding(.horizontal, 12)
            }
        }
    }
}
