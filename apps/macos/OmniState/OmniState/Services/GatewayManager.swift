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
    private var restartCount = 0
    private let maxRestarts = 5
    private var stopRequested = false
    private var launchStartedAt: Date?

    private init() {}

    private var runtimeConfigPath: String {
        NSHomeDirectory() + "/.omnistate/llm.runtime.json"
    }

    /// Path to the gateway entry point
    private var gatewayPath: String {
        // In dev: use the source project path
        // In release: use bundled path inside .app
        let bundledPath = Bundle.main.resourcePath.map { "\($0)/gateway/dist/index.js" } ?? ""
        if FileManager.default.fileExists(atPath: bundledPath) {
            return bundledPath
        }
        // Dev fallback: find project root relative to app location
        let projectRoot = findProjectRoot()
        return "\(projectRoot)/packages/gateway/dist/index.js"
    }

    /// Find node executable
    private var nodePath: String {
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

    private func findProjectRoot() -> String {
        // Walk up from bundle location to find pnpm-workspace.yaml
        var dir = Bundle.main.bundlePath
        for _ in 0..<10 {
            dir = (dir as NSString).deletingLastPathComponent
            let marker = (dir as NSString).appendingPathComponent("pnpm-workspace.yaml")
            if FileManager.default.fileExists(atPath: marker) {
                return dir
            }
        }
        // Default to a known dev path
        return NSHomeDirectory() + "/Projects/omnistate"
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
        proc.currentDirectoryURL = URL(fileURLWithPath: findProjectRoot())
        proc.standardOutput = outPipe
        proc.standardError = errPipe

        // Set environment
        var env = ProcessInfo.processInfo.environment
        env["NODE_ENV"] = "production"
        env["OMNISTATE_LOG_LEVEL"] = "info"
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

    func stop() {
        stopRequested = true

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
