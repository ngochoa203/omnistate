import SwiftUI
import WebKit

struct WebViewContainer: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Enable developer tools in debug
        #if DEBUG
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        #endif

        // Set up JS→Swift message handler
        let userContentController = WKUserContentController()
        userContentController.add(context.coordinator, name: "omnistate")
        config.userContentController = userContentController

        // Register custom URL scheme for file:// CORS bypass
        config.setURLSchemeHandler(OmniStateSchemeHandler(), forURLScheme: "omnistate")

        // Allow local file access
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator

        // Inject native bridge JS
        let bridgeScript = WKUserScript(
            source: Self.nativeBridgeJS,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(bridgeScript)

        // Load the web UI
        loadWebUI(webView)

        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        // No-op for now
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    private func loadWebUI(_ webView: WKWebView) {
        #if DEBUG
        // Dev mode: load from Vite dev server
        if let url = URL(string: "http://localhost:5173") {
            webView.load(URLRequest(url: url))
            return
        }
        #endif

        // Production: load bundled web assets
        if let resourcePath = Bundle.main.resourcePath {
            let distPath = "\(resourcePath)/web-dist"
            let indexPath = "\(distPath)/index.html"
            if FileManager.default.fileExists(atPath: indexPath) {
                let indexURL = URL(fileURLWithPath: indexPath)
                let distURL = URL(fileURLWithPath: distPath)
                webView.loadFileURL(indexURL, allowingReadAccessTo: distURL)
                return
            }
        }

        // Fallback: try localhost
        if let url = URL(string: "http://localhost:5173") {
            webView.load(URLRequest(url: url))
        }
    }

    /// JavaScript injected into web view for native bridge
    private static let nativeBridgeJS = """
    window.omnistateNative = {
        isNative: true,
        platform: 'macos',
        sendNotification: function(title, body) {
            window.webkit.messageHandlers.omnistate.postMessage({
                type: 'notification',
                title: title,
                body: body
            });
        },
        getGatewayStatus: function() {
            window.webkit.messageHandlers.omnistate.postMessage({
                type: 'gateway.status'
            });
        },
        log: function(message) {
            window.webkit.messageHandlers.omnistate.postMessage({
                type: 'log',
                message: message
            });
        }
    };

    // Override gateway URL for native app (always local)
    if (!window.OMNISTATE_GATEWAY_URL) {
        window.OMNISTATE_GATEWAY_URL = 'ws://127.0.0.1:19800';
    }
    """

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String else { return }

            switch type {
            case "notification":
                let title = body["title"] as? String ?? "OmniState"
                let notifBody = body["body"] as? String ?? ""
                NotificationBridge.shared.send(title: title, body: notifBody)

            case "gateway.status":
                // Send status back to JS
                let isRunning = GatewayManager.shared.isRunning
                let isHealthy = HealthChecker.shared.isHealthy
                let js = "window.omnistateNative._onStatus && window.omnistateNative._onStatus({running:\(isRunning),healthy:\(isHealthy)})"
                message.webView?.evaluateJavaScript(js)

            case "log":
                let msg = body["message"] as? String ?? ""
                print("[WebView] \(msg)")

            default:
                print("[WebView] Unknown message type: \(type)")
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            print("[OmniState] Web UI loaded successfully")
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("[OmniState] Web navigation failed: \(error.localizedDescription)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("[OmniState] Web provisional navigation failed: \(error.localizedDescription)")
            // Retry after delay (Vite may not be ready yet)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                if let url = webView.url ?? URL(string: "http://localhost:5173") {
                    webView.load(URLRequest(url: url))
                }
            }
        }
    }
}
