import WebKit

class OmniStateSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "OmniState", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"]))
            return
        }

        // Convert omnistate:// to file path within bundled web-dist
        let path = url.path
        let resourcePath = Bundle.main.resourcePath ?? ""
        let filePath = "\(resourcePath)/web-dist\(path.isEmpty || path == "/" ? "/index.html" : path)"

        guard FileManager.default.fileExists(atPath: filePath) else {
            // Try index.html for SPA routing
            let indexPath = "\(resourcePath)/web-dist/index.html"
            if FileManager.default.fileExists(atPath: indexPath) {
                serveFile(at: indexPath, for: urlSchemeTask)
            } else {
                urlSchemeTask.didFailWithError(NSError(domain: "OmniState", code: 404, userInfo: [NSLocalizedDescriptionKey: "File not found: \(path)"]))
            }
            return
        }

        serveFile(at: filePath, for: urlSchemeTask)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // No-op
    }

    private func serveFile(at path: String, for task: WKURLSchemeTask) {
        guard let data = FileManager.default.contents(atPath: path) else {
            task.didFailWithError(NSError(domain: "OmniState", code: 500, userInfo: [NSLocalizedDescriptionKey: "Cannot read file"]))
            return
        }

        let mimeType = Self.mimeType(for: path)
        let response = URLResponse(
            url: task.request.url!,
            mimeType: mimeType,
            expectedContentLength: data.count,
            textEncodingName: mimeType.hasPrefix("text/") ? "utf-8" : nil
        )

        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private static func mimeType(for path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "html": return "text/html"
        case "css": return "text/css"
        case "js", "mjs": return "application/javascript"
        case "json": return "application/json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ico": return "image/x-icon"
        case "webp": return "image/webp"
        case "map": return "application/json"
        default: return "application/octet-stream"
        }
    }
}
