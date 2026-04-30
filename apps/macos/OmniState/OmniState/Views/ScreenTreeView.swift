import SwiftUI

// MARK: - Shared Components (needed by ScreenTree views)

private struct CyberBadge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .heavy, design: .rounded))
            .foregroundColor(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.15))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(color.opacity(0.35), lineWidth: 0.5))
    }
}

private struct GlowCard<Content: View>: View {
    let glowColor: Color
    @ViewBuilder var content: Content

    init(glow: Color = Color.cyan.opacity(0.18), @ViewBuilder content: () -> Content) {
        self.glowColor = glow
        self.content = content()
    }

    var body: some View {
        content
            .padding(15)
            .background(Color(red: 0.06, green: 0.06, blue: 0.12).opacity(0.7))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: [glowColor.opacity(0.5), glowColor.opacity(0.15), glowColor.opacity(0.05)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ), lineWidth: 1
                    )
            )
            .shadow(color: glowColor.opacity(0.12), radius: 14)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SectionLabel: View {
    let text: String
    var body: some View {
        HStack(spacing: 7) {
            Capsule()
                .fill(Color(red: 0.13, green: 0.83, blue: 0.93).opacity(0.7))
                .frame(width: 14, height: 3)
                .shadow(color: Color(red: 0.13, green: 0.83, blue: 0.93).opacity(0.35), radius: 3)

            Text(text.uppercased())
                .font(.system(size: 10, weight: .heavy, design: .monospaced))
                .foregroundColor(Color.white.opacity(0.68))
                .tracking(1.2)
        }
        .padding(.top, 4)
    }
}

private struct HeroSection: View {
    let icon: String
    let iconColor: Color
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 15) {
            ZStack {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [iconColor.opacity(0.35), iconColor.opacity(0.12)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 15, style: .continuous)
                            .stroke(iconColor.opacity(0.4), lineWidth: 1)
                    )
                Image(systemName: icon)
                    .font(.system(size: 19, weight: .bold))
                    .foregroundColor(iconColor)
            }
            .frame(width: 44, height: 44)
            .shadow(color: iconColor.opacity(0.4), radius: 10)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 19, weight: .bold, design: .rounded))
                    .foregroundStyle(
                        LinearGradient(colors: [.white, iconColor.opacity(0.8)], startPoint: .leading, endPoint: .trailing)
                    )
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.white.opacity(0.42))
                    .lineLimit(2)
            }
            Spacer()
        }
        .padding(17)
        .background(
            LinearGradient(
                colors: [iconColor.opacity(0.08), Color.clear],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(iconColor.opacity(0.15), lineWidth: 1)
        )
    }
}

// MARK: - Screen Tree Models

struct ScreenTreeNode: Identifiable {
    let id: String
    let role: String
    let title: String?
    let value: String?
    let description: String?
    let bounds: ScreenBounds?
    let state: ScreenNodeState?
    let children: [ScreenTreeNode]
    var isExpanded: Bool = false
}

struct ScreenBounds: Codable {
    let x: Double; let y: Double; let width: Double; let height: Double
}

struct ScreenNodeState: Codable {
    let visible: Bool?; let enabled: Bool?; let focused: Bool?; let selected: Bool?
}

struct LatencyResult: Codable {
    let p50: Double; let p95: Double; let max: Double
    let passUnder50msP95: Bool
    let frame: FrameStats?
    let tree: FrameStats?
    struct FrameStats: Codable {
        let p50: Double; let p95: Double; let max: Double; let under50Rate: Double
    }
}

// MARK: - ScreenTreeState

final class ScreenTreeState: ObservableObject {
    @Published var screenTreeData: Data?
    @Published var screenTreeError: String?
    @Published var screenTreeLoading = false
    @Published var screenTreeNodes: [ScreenTreeNode] = []
    @Published var latencyData: LatencyResult?
    @Published var latencyLoading = false
    @Published var screenTreeExpanded: Set<String> = []

    func fetchScreenTree() {
        screenTreeLoading = true
        screenTreeError = nil
        guard let url = URL(string: "http://localhost:21425/screen/tree?mode=hierarchy") else { return }
        URLSession.shared.dataTask(with: url) { data, _, error in
            DispatchQueue.main.async {
                self.screenTreeLoading = false
                if let error = error {
                    self.screenTreeError = error.localizedDescription
                    return
                }
                guard let data = data else { return }
                self.screenTreeData = data
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let tree = json["tree"] as? [String: Any] {
                    let node = self.parseTreeNode(tree)
                    self.screenTreeNodes = [node]
                }
            }
        }.resume()
    }

    func fetchLatency() {
        latencyLoading = true
        guard let url = URL(string: "http://localhost:21425/latency/benchmark?profile=full") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data = data else {
                DispatchQueue.main.async { self.latencyLoading = false }
                return
            }
            DispatchQueue.main.async {
                self.latencyLoading = false
                if let result = try? JSONDecoder().decode(LatencyResult.self, from: data) {
                    self.latencyData = result
                }
            }
        }.resume()
    }

    private func parseTreeNode(_ dict: [String: Any]) -> ScreenTreeNode {
        let id = dict["id"] as? String ?? UUID().uuidString
        let role = dict["role"] as? String ?? "Unknown"
        let title = dict["title"] as? String
        let value = dict["value"] as? String
        let description = dict["description"] as? String
        var bounds: ScreenBounds?
        if let b = dict["bounds"] as? [String: Any] {
            bounds = ScreenBounds(x: b["x"] as? Double ?? 0, y: b["y"] as? Double ?? 0, width: b["width"] as? Double ?? 0, height: b["height"] as? Double ?? 0)
        }
        var state: ScreenNodeState?
        if let s = dict["state"] as? [String: Any] {
            state = ScreenNodeState(visible: s["visible"] as? Bool, enabled: s["enabled"] as? Bool, focused: s["focused"] as? Bool, selected: s["selected"] as? Bool)
        }
        let childrenDicts = dict["children"] as? [[String: Any]] ?? []
        let children = childrenDicts.map { parseTreeNode($0) }
        return ScreenTreeNode(id: id, role: role, title: title, value: value, description: description, bounds: bounds, state: state, children: children)
    }
}

// MARK: - TreeNodeRowView

struct TreeNodeRowView: View {
    let node: ScreenTreeNode
    let depth: Int
    @ObservedObject var state: ScreenTreeState

    private let cyan = Color(red: 0.13, green: 0.83, blue: 0.93)
    private let textMuted = Color.white.opacity(0.42)
    private let textPrimary = Color.white.opacity(0.93)

    var body: some View {
        let isExpanded = state.screenTreeExpanded.contains(node.id)
        let childCount = node.children.count
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                if childCount > 0 {
                    Button(action: {
                        if isExpanded {
                            state.screenTreeExpanded.remove(node.id)
                        } else {
                            state.screenTreeExpanded.insert(node.id)
                        }
                    }) {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 9)).foregroundColor(textMuted)
                    }
                    .buttonStyle(.plain)
                } else {
                    Spacer().frame(width: 14)
                }
                roleBadge(node.role)
                if let title = node.title, !title.isEmpty {
                    Text(title).font(.system(size: 11)).foregroundColor(textPrimary)
                } else {
                    Text(node.value ?? "").font(.system(size: 11)).foregroundColor(textMuted).lineLimit(1)
                }
                Spacer()
                if childCount > 0 {
                    Text("\(childCount)").font(.system(size: 9, design: .monospaced)).foregroundColor(textMuted)
                }
                if node.state?.focused == true { CyberBadge(text: "focused", color: .orange) }
                if node.state?.selected == true { CyberBadge(text: "selected", color: .green) }
                if node.state?.enabled == false { CyberBadge(text: "disabled", color: .red) }
            }
            .padding(.leading, CGFloat(depth * 16))
            if isExpanded {
                ForEach(node.children) { child in
                    TreeNodeRowView(node: child, depth: depth + 1, state: state)
                }
            }
        }
    }

    private func roleBadge(_ role: String) -> some View {
        let color: Color = role.contains("Button") ? .blue : role.contains("Text") ? .green : role.contains("Menu") ? .purple : role.contains("Window") ? .orange : .gray
        return Text(role).font(.system(size: 9, weight: .medium)).padding(.horizontal, 4).padding(.vertical, 1).background(color.opacity(0.2)).foregroundColor(color).cornerRadius(3)
    }
}

// MARK: - ScreenTreeLatencyCardView

struct ScreenTreeLatencyCardView: View {
    @ObservedObject var state: ScreenTreeState

    private let cyan = Color(red: 0.13, green: 0.83, blue: 0.93)
    private let textMuted = Color.white.opacity(0.42)
    private let textPrimary = Color.white.opacity(0.93)
    private let green = Color(red: 0.13, green: 0.77, blue: 0.37)
    private let red = Color(red: 0.95, green: 0.27, blue: 0.33)

    private func tx(_ vi: String, _ en: String) -> String { en }

    var body: some View {
        GlowCard(glow: cyan.opacity(0.2)) {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(text: tx("Latency Benchmarks", "Latency Benchmarks"))
                if state.latencyLoading {
                    HStack { ProgressView(); Text(tx("Đang đo latency...", "Measuring latency...")).foregroundColor(textMuted) }
                } else if let lat = state.latencyData {
                    HStack(spacing: 20) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("p50").font(.system(size: 10)).foregroundColor(textMuted)
                            Text(String(format: "%.1fms", lat.p50)).font(.system(size: 15, weight: .bold, design: .monospaced)).foregroundColor(textPrimary)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text("p95").font(.system(size: 10)).foregroundColor(textMuted)
                            Text(String(format: "%.1fms", lat.p95)).font(.system(size: 15, weight: .bold, design: .monospaced)).foregroundColor(textPrimary)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text("max").font(.system(size: 10)).foregroundColor(textMuted)
                            Text(String(format: "%.1fms", lat.max)).font(.system(size: 15, weight: .bold, design: .monospaced)).foregroundColor(textPrimary)
                        }
                        Spacer()
                        CyberBadge(text: lat.passUnder50msP95 ? "PASS" : "FAIL", color: lat.passUnder50msP95 ? green : red)
                    }
                    if let frame = lat.frame {
                        Text("frame • p50: \(String(format: "%.1f", frame.p50))ms p95: \(String(format: "%.1f", frame.p95))ms under50: \(String(format: "%.0f", frame.under50Rate * 100))%")
                            .font(.system(size: 11, design: .monospaced)).foregroundColor(textMuted)
                    }
                    if let tree = lat.tree {
                        Text("tree • p50: \(String(format: "%.1f", tree.p50))ms p95: \(String(format: "%.1f", tree.p95))ms under50: \(String(format: "%.0f", tree.under50Rate * 100))%")
                            .font(.system(size: 11, design: .monospaced)).foregroundColor(textMuted)
                    }
                } else {
                    Text(tx("Chưa có dữ liệu latency", "No latency data")).foregroundColor(textMuted)
                }
                Button(tx("Đo latency", "Measure latency")) { state.fetchLatency() }
                    .buttonStyle(.bordered).tint(cyan.opacity(0.7))
            }
        }
    }
}

// MARK: - ScreenTreeTreePanelView

struct ScreenTreeTreePanelView: View {
    @ObservedObject var state: ScreenTreeState

    private let purple = Color(red: 0.58, green: 0.32, blue: 0.92)
    private let textMuted = Color.white.opacity(0.42)

    private func tx(_ vi: String, _ en: String) -> String { en }

    var body: some View {
        GlowCard(glow: purple.opacity(0.2)) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    SectionLabel(text: tx("Accessibility Tree", "Accessibility Tree"))
                    Spacer()
                    Button(action: { state.fetchScreenTree() }) {
                        HStack(spacing: 4) {
                            if state.screenTreeLoading { ProgressView().scaleEffect(0.6) }
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .buttonStyle(.bordered).controlSize(.small).tint(purple.opacity(0.7))
                }
                if state.screenTreeLoading && state.screenTreeNodes.isEmpty {
                    HStack { ProgressView(); Text(tx("Đang tải cây accessibility...", "Loading accessibility tree...")).foregroundColor(textMuted) }
                } else if let err = state.screenTreeError {
                    Text(err).font(.system(size: 12)).foregroundColor(.red)
                } else if state.screenTreeNodes.isEmpty {
                    VStack(spacing: 8) {
                        Text(tx("Chưa có dữ liệu cây màn hình", "No screen tree data")).foregroundColor(textMuted)
                        Button(tx("Tải ngay", "Fetch now")) { state.fetchScreenTree() }.buttonStyle(.bordered)
                    }
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 1) {
                            ForEach(state.screenTreeNodes) { node in
                                TreeNodeRowView(node: node, depth: 0, state: state)
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - ScreenTreePageView

struct ScreenTreePageView: View {
    @StateObject private var state = ScreenTreeState()

    private let cyan = Color(red: 0.13, green: 0.83, blue: 0.93)
    private let pagePadding: CGFloat = 24

    private func tx(_ vi: String, _ en: String) -> String { en }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroSection(icon: "point.3.connected.trianglepath.dotted", iconColor: cyan, title: tx("Cây màn hình", "Screen Tree"), subtitle: tx("Accessibility tree từ gateway", "Accessibility tree from gateway"))
                ScreenTreeLatencyCardView(state: state)
                ScreenTreeTreePanelView(state: state)
            }
            .padding(pagePadding)
        }
        .onAppear { state.fetchScreenTree(); state.fetchLatency() }
    }
}