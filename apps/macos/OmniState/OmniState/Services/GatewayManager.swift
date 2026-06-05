import Foundation
import Combine

class GatewayManager: ObservableObject {
    static let shared = GatewayManager()

    @Published var isRunning = false
    @Published var lastError: String?
    @Published var lanPin: String?

    private var process: Process?
    private var outputPipe: Pipe?
    private var errorPipe: Pipe?
    private var wakeRecoveryWorkItem: DispatchWorkItem?
    private var restartCount = 0
    private let maxRestarts = 5
    private var stopRequested = false
    private var launchStartedAt: Date?

    private init() {}

    private var runtimeConfigPath: String {
        NSHomeDirectory() + "/.omnistate/llm.runtime.json"
    }

    private var bundledRuntimeRoot: String? {
        guard let resourcePath = Bundle.main.resourcePath else { return nil }
        let runtimeRoot = resourcePath + "/runtime"
        if FileManager.default.fileExists(atPath: runtimeRoot) {
            return runtimeRoot
        }
        return nil
    }

    /// Path to the gateway entry point inside the bundled runtime.
    /// Layout: OmniState.app/Contents/Resources/runtime/gateway/dist/index.js
    /// Falls back to a project-root scan only in DEBUG builds (never in shipped product).
    private var gatewayPath: String {
        if let runtimeRoot = bundledRuntimeRoot {
            let bundled = runtimeRoot + "/gateway/dist/index.js"
            if FileManager.default.fileExists(atPath: bundled) {
                return bundled
            }
        }
        #if DEBUG
        // Walk up from bundle to project root in dev only.
        let projectRoot = findProjectRoot()
        let devPath = projectRoot + "/packages/gateway/dist/index.js"
        if FileManager.default.fileExists(atPath: devPath) {
            return devPath
        }
        // Last-resort dev path — only present in DEBUG so the app can
        // still launch during iterative development without a bundled copy.
        return NSHomeDirectory() + "/Projects/omnistate/packages/gateway/dist/index.js"
        #else
        return ""
        #endif
    }

    /// Find node executable
    private var nodePath: String {
        if let runtimeRoot = bundledRuntimeRoot {
            let bundledNode = runtimeRoot + "/bin/node"
            if FileManager.default.fileExists(atPath: bundledNode),
               validateNodeBinary(at: bundledNode) {
                return bundledNode
            }
        }

        // Check common locations
        let candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
            ProcessInfo.processInfo.environment["NODE_PATH"].map { "\($0)/node" },
        ].compactMap { $0 }

        for candidate in candidates {
            if FileManager.default.fileExists(atPath: candidate) {
                return candidate
            }
        }

        // Try `which node`
        let whichProcess = Process()
        let whichPipe = Pipe()
        whichProcess.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        whichProcess.arguments = ["node"]
        whichProcess.standardOutput = whichPipe
        whichProcess.standardError = FileHandle.nullDevice
        try? whichProcess.run()
        whichProcess.waitUntilExit()
        let output = String(data: whichPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !output.isEmpty && FileManager.default.fileExists(atPath: output) {
            return output
        }

        return "node" // hope it's in PATH
    }

    private func validateNodeBinary(at path: String) -> Bool {
        let proc = Process()
        let pipe = Pipe()
        proc.executableURL = URL(fileURLWithPath: path)
        proc.arguments = ["--version"]
        proc.standardOutput = pipe
        proc.standardError = pipe

        do {
            try proc.run()
        } catch {
            return false
        }

        let deadline = Date().addingTimeInterval(2.0)
        while proc.isRunning && Date() < deadline {
            usleep(50_000)
        }

        if proc.isRunning {
            proc.terminate()
            return false
        }

        return proc.terminationStatus == 0
    }

    private func findProjectRoot() -> String {
        // Walk up from bundle location to find pnpm-workspace.yaml marker.
        var dir = Bundle.main.bundlePath
        for _ in 0..<10 {
            dir = (dir as NSString).deletingLastPathComponent
            let marker = (dir as NSString).appendingPathComponent("pnpm-workspace.yaml")
            if FileManager.default.fileExists(atPath: marker) {
                return dir
            }
        }
        // No hardcoded fallback — return empty so callers can handle gracefully.
        return ""
    }

    private func runtimeWorkingDirectory(for gateway: String) -> String {
        if let runtimeRoot = bundledRuntimeRoot {
            return runtimeRoot
        }
        return (gateway as NSString).deletingLastPathComponent
    }

    private func siriHTTPPort() -> Int {
        guard let data = FileManager.default.contents(atPath: runtimeConfigPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let voice = json["voice"] as? [String: Any],
              let siri = voice["siri"] as? [String: Any],
              let endpoint = siri["endpoint"] as? String,
              let url = URL(string: endpoint),
              let port = url.port
        else {
            return 19801
        }
        return port
    }

    private func pidsListening(on port: Int) -> [pid_t] {
        let proc = Process()
        let pipe = Pipe()
        proc.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        proc.arguments = ["-ti", "tcp:\(port)"]
        proc.standardOutput = pipe
        proc.standardError = FileHandle.nullDevice

        do {
            try proc.run()
            proc.waitUntilExit()
        } catch {
            return []
        }

        let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        return output
            .split(whereSeparator: \.isNewline)
            .compactMap { pid_t(Int32(String($0)) ?? -1) }
            .filter { $0 > 0 }
    }

    private func cleanupGatewayPorts() {
        let ports = [19800, siriHTTPPort()]
        let ownPid = getpid()
        var pids = Set<pid_t>()

        for port in ports {
            for pid in pidsListening(on: port) where pid != ownPid {
                pids.insert(pid)
            }
        }

        if pids.isEmpty { return }

        for pid in pids {
            _ = kill(pid, SIGTERM)
        }

        usleep(350_000)

        var stubborn = Set<pid_t>()
        for port in ports {
            for pid in pidsListening(on: port) where pid != ownPid {
                stubborn.insert(pid)
            }
        }

        for pid in stubborn {
            _ = kill(pid, SIGKILL)
        }
    }

    func start() {
        guard !isRunning else { return }

        stopRequested = false
        cleanupGatewayPorts()

        let gateway = gatewayPath
        guard FileManager.default.fileExists(atPath: gateway) else {
            DispatchQueue.main.async {
                self.lastError = "Gateway not found at \(gateway). Run 'pnpm --filter gateway build' first."
            }
            return
        }

        let proc = Process()
        let outPipe = Pipe()
        let errPipe = Pipe()

        proc.executableURL = URL(fileURLWithPath: nodePath)
        proc.arguments = [gateway]
        proc.currentDirectoryURL = URL(fileURLWithPath: runtimeWorkingDirectory(for: gateway))
        proc.standardOutput = outPipe
        proc.standardError = errPipe

        // Set environment
        var env = ProcessInfo.processInfo.environment
        env["NODE_ENV"] = "production"
        env["OMNISTATE_LOG_LEVEL"] = "info"
        if env["WHISPER_DEVICE"] == nil || env["WHISPER_DEVICE"]?.isEmpty == true {
            env["WHISPER_DEVICE"] = "cpu"
        }
        proc.environment = env

        // Handle stdout
        outPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let line = String(data: data, encoding: .utf8) else { return }
            print("[Gateway] \(line)", terminator: "")

            // Parse LAN PIN if announced
            if line.contains("LAN PIN:") {
                let pin = line.components(separatedBy: "LAN PIN:").last?.trimmingCharacters(in: .whitespacesAndNewlines).prefix(6)
                if let pin = pin {
                    DispatchQueue.main.async {
                        self?.lanPin = String(pin)
                    }
                }
            }
        }

        // Handle stderr
        errPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty, let line = String(data: data, encoding: .utf8) else { return }
            print("[Gateway:err] \(line)", terminator: "")
        }

        // Handle termination
        proc.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                self?.isRunning = false
                self?.lanPin = nil
                self?.process = nil

                let exitedQuickly: Bool
                if let startedAt = self?.launchStartedAt {
                    exitedQuickly = Date().timeIntervalSince(startedAt) < 2.0
                } else {
                    exitedQuickly = false
                }

                if proc.terminationStatus != 0 && proc.terminationStatus != 15 {
                    self?.lastError = "Gateway exited with code \(proc.terminationStatus)"
                    // Auto-restart if under limit
                    if let self = self, self.restartCount < self.maxRestarts {
                        self.restartCount += 1
                        print("[OmniState] Gateway crashed, restarting (\(self.restartCount)/\(self.maxRestarts))...")
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            self.start()
                        }
                    }
                } else if exitedQuickly && self?.stopRequested == false {
                    self?.lastError = "Gateway exited too quickly. Possible occupied port or invalid runtime endpoint."
                }
            }
        }

        do {
            try proc.run()
            process = proc
            outputPipe = outPipe
            errorPipe = errPipe
            launchStartedAt = Date()
            DispatchQueue.main.async {
                self.isRunning = true
                self.lastError = nil
                self.restartCount = 0
            }
            print("[OmniState] Gateway started (PID: \(proc.processIdentifier))")
        } catch {
            DispatchQueue.main.async {
                self.lastError = "Failed to start gateway: \(error.localizedDescription)"
            }
        }
    }

    func handleSystemWillSleep() {
        wakeRecoveryWorkItem?.cancel()
        Task { @MainActor in
            GatewaySocketClient.shared.disconnect()
        }
        print("[OmniState] System will sleep — disconnected gateway socket")
    }

    func handleSystemDidWake() {
        wakeRecoveryWorkItem?.cancel()

        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }

            if let proc = self.process, proc.isRunning {
                Task { @MainActor in
                    GatewaySocketClient.shared.connect()
                    GatewaySocketClient.shared.queryRuntimeConfig()
                }
                print("[OmniState] System woke — refreshed gateway runtime state")
                return
            }

            self.start()
            Task { @MainActor in
                GatewaySocketClient.shared.connect()
                GatewaySocketClient.shared.queryRuntimeConfig()
            }
            print("[OmniState] System woke — restarted gateway after sleep")
        }

        wakeRecoveryWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: workItem)
    }

    func stop() {
        stopRequested = true
        wakeRecoveryWorkItem?.cancel()

        guard let proc = process, proc.isRunning else {
            DispatchQueue.main.async {
                self.isRunning = false
            }
            cleanupGatewayPorts()
            return
        }

        // Graceful SIGTERM first
        proc.terminate()

        // Force kill after 5 seconds if still running
        DispatchQueue.global().asyncAfter(deadline: .now() + 5) { [weak self] in
            if proc.isRunning {
                kill(proc.processIdentifier, SIGKILL)
            }
            DispatchQueue.main.async {
                self?.process = nil
                self?.isRunning = false
                self?.lanPin = nil
            }

            self?.cleanupGatewayPorts()
        }
    }
}
