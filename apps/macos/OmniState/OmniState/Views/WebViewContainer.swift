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
        webView.uiDelegate = context.coordinator

        // Inject native bridge JS
        let bridgeScript = WKUserScript(
            source: Self.makeNativeBridgeJS(),
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
        // Dev mode is opt-in. Set OMNISTATE_USE_DEV_SERVER=1 to force localhost:5173.
        if ProcessInfo.processInfo.environment["OMNISTATE_USE_DEV_SERVER"] == "1",
           let url = URL(string: "http://localhost:5173") {
            webView.load(URLRequest(url: url))
            return
        }
        #endif

        // Default: load bundled web assets from app resources.
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

        // Last fallback: try localhost dev server.
    #if DEBUG
        if let url = URL(string: "http://localhost:5173") {
            webView.load(URLRequest(url: url))
        }
    #else
        let html = """
        <html><body style=\"background:#0b1020;color:#c7d2fe;font-family:-apple-system;padding:24px;\">
        <h2>OmniState UI assets not found</h2>
        <p>Bundled web-dist is missing in this build. Please rebuild the app bundle.</p>
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    #endif
    }

    private static func makeNativeStorageBootstrapJSON() -> String {
        let all = UserDefaults.standard.dictionaryRepresentation()
        let filtered = all.reduce(into: [String: String]()) { result, item in
            guard item.key.hasPrefix("omnistate.") else { return }
            if let str = item.value as? String {
                result[item.key] = str
            }
        }

        guard let data = try? JSONSerialization.data(withJSONObject: filtered, options: []),
              let json = String(data: data, encoding: .utf8) else {
            return "{}"
        }

        return json
    }

    /// JavaScript injected into web view for native bridge
    private static func makeNativeBridgeJS() -> String {
        let storageJson = makeNativeStorageBootstrapJSON()
        return """
    window.__OMNISTATE_NATIVE_STORAGE__ = \(storageJson);

    window.omnistateNative = {
        isNative: true,
        platform: 'macos',
        storageGet: function(key) {
            const cache = window.__OMNISTATE_NATIVE_STORAGE__ || {};
            const v = cache[key];
            return typeof v === 'string' ? v : null;
        },
        storageSet: function(key, value) {
            if (!window.__OMNISTATE_NATIVE_STORAGE__) window.__OMNISTATE_NATIVE_STORAGE__ = {};
            window.__OMNISTATE_NATIVE_STORAGE__[key] = String(value);
            window.webkit.messageHandlers.omnistate.postMessage({
                type: 'storage.set',
                key: key,
                value: String(value)
            });
        },
        storageRemove: function(key) {
            if (!window.__OMNISTATE_NATIVE_STORAGE__) window.__OMNISTATE_NATIVE_STORAGE__ = {};
            delete window.__OMNISTATE_NATIVE_STORAGE__[key];
            window.webkit.messageHandlers.omnistate.postMessage({
                type: 'storage.remove',
                key: key
            });
        },
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
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
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

            case "storage.set":
                guard let key = body["key"] as? String,
                      let value = body["value"] as? String else {
                    return
                }
                guard key.hasPrefix("omnistate."), key.count <= 160, value.count <= 2_000_000 else {
                    return
                }
                UserDefaults.standard.set(value, forKey: key)

            case "storage.remove":
                guard let key = body["key"] as? String else {
                    return
                }
                guard key.hasPrefix("omnistate."), key.count <= 160 else {
                    return
                }
                UserDefaults.standard.removeObject(forKey: key)

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

        func webView(
            _ webView: WKWebView,
            runOpenPanelWith parameters: WKOpenPanelParameters,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping ([URL]?) -> Void
        ) {
            let panel = NSOpenPanel()
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = parameters.allowsMultipleSelection
            panel.resolvesAliases = true

            panel.begin { response in
                guard response == .OK else {
                    completionHandler(nil)
                    return
                }
                completionHandler(panel.urls)
            }
        }
    }
}
