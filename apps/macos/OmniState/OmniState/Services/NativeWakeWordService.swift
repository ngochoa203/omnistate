import Foundation
import AVFoundation
import Speech
import Combine

/// Native wake-word detection using Apple's SFSpeechRecognizer.
/// Replaces Python wake_listener scripts with zero-dependency native detection.
///
/// Advantages over Python:
/// - No subprocess management
/// - Optimized for Apple Silicon (Neural Engine)
/// - Lower power consumption
/// - No Python environment required
@MainActor
final class NativeWakeWordService: ObservableObject {
    static let shared = NativeWakeWordService()

    @Published var isListening = false
    @Published var lastDetectedPhrase: String = ""
    @Published var errorMessage: String?

    /// Fires when a wake phrase is detected
    let wakeDetected = PassthroughSubject<WakeDetection, Never>()

    /// Configurable wake phrases (supports Vietnamese)
    var wakePhrases: [String] = [
        "hey omni",
        "ê omni",
        "ok omni",
        "omni ơi",
        "omni state",
    ]

    /// Minimum confidence for phrase match (0.0-1.0)
    var matchThreshold: Double = 0.6

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer: SFSpeechRecognizer?

    // Cooldown to prevent repeated triggers
    private var lastWakeTime: Date = .distantPast
    private let cooldownSeconds: TimeInterval = 2.0

    // Auto-restart on recognition timeout (Apple limits continuous recognition to ~1 min)
    private var restartTimer: Timer?
    private let maxRecognitionDuration: TimeInterval = 55.0  // Restart before 60s limit
    private var recognitionStartTime: Date?

    private init() {}

    // MARK: - Public API

    func startListening() {
        guard !isListening else { return }

        let speechStatus = SFSpeechRecognizer.authorizationStatus()
        guard speechStatus == .authorized else {
            if speechStatus == .notDetermined {
                SFSpeechRecognizer.requestAuthorization { [weak self] status in
                    Task { @MainActor in
                        if status == .authorized {
                            self?.startListeningInternal()
                        } else {
                            self?.errorMessage = "Speech recognition permission denied"
                        }
                    }
                }
            } else {
                errorMessage = "Speech recognition not authorized"
            }
            return
        }

        startListeningInternal()
    }

    func stopListening() {
        isListening = false
        restartTimer?.invalidate()
        restartTimer = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine = nil
    }

    // MARK: - Internal

    private func startListeningInternal() {
        stopListening()  // Clean slate

        // Use Vietnamese recognizer if wake phrases contain Vietnamese
        let hasVietnamese = wakePhrases.contains { $0.contains("ơi") || $0.contains("ê ") }
        let locale = hasVietnamese ? Locale(identifier: "vi-VN") : Locale(identifier: "en-US")
        speechRecognizer = SFSpeechRecognizer(locale: locale)

        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            errorMessage = "Speech recognizer not available for locale: \(locale.identifier)"
            return
        }

        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true  // Keep it local, low latency

        // Prevent task from ending when speech pauses
        if #available(macOS 13.0, *) {
            request.addsPunctuation = false
        }

        let inputNode = engine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            request.append(buffer)
        }

        do {
            engine.prepare()
            try engine.start()
        } catch {
            errorMessage = "Audio engine failed to start: \(error.localizedDescription)"
            return
        }

        self.audioEngine = engine
        self.recognitionRequest = request
        self.recognitionStartTime = Date()

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                if let result = result {
                    let transcript = result.bestTranscription.formattedString.lowercased()
                    self?.checkForWakePhrase(in: transcript)
                }

                if error != nil || result?.isFinal == true {
                    // Recognition ended — restart if still in listening mode
                    if self?.isListening == true {
                        self?.scheduleRestart()
                    }
                }
            }
        }

        isListening = true
        scheduleAutoRestart()
    }

    private func checkForWakePhrase(in transcript: String) {
        // Cooldown check
        guard Date().timeIntervalSince(lastWakeTime) > cooldownSeconds else { return }

        for phrase in wakePhrases {
            if fuzzyMatch(transcript: transcript, phrase: phrase) {
                lastWakeTime = Date()
                lastDetectedPhrase = phrase

                let detection = WakeDetection(
                    phrase: phrase,
                    transcript: transcript,
                    confidence: 1.0,
                    timestamp: Date()
                )
                wakeDetected.send(detection)

                // Restart recognition to clear the buffer
                scheduleRestart(delay: 0.5)
                break
            }
        }
    }

    /// Fuzzy match: checks if the transcript contains the wake phrase,
    /// allowing for minor ASR errors (missing spaces, slight misrecognition).
    private func fuzzyMatch(transcript: String, phrase: String) -> Bool {
        // Exact substring match
        if transcript.contains(phrase) { return true }

        // Normalized match (remove spaces and compare)
        let normTranscript = transcript.replacingOccurrences(of: " ", with: "")
        let normPhrase = phrase.replacingOccurrences(of: " ", with: "")
        if normTranscript.contains(normPhrase) { return true }

        // Check last N characters of transcript (wake phrase is usually at the end)
        let tail = String(transcript.suffix(phrase.count + 10))
        if tail.contains(phrase) { return true }

        return false
    }

    private func scheduleAutoRestart() {
        restartTimer?.invalidate()
        restartTimer = Timer.scheduledTimer(withTimeInterval: maxRecognitionDuration, repeats: false) { [weak self] _ in
            Task { @MainActor in
                if self?.isListening == true {
                    self?.startListeningInternal()
                }
            }
        }
    }

    private func scheduleRestart(delay: TimeInterval = 0.3) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            Task { @MainActor in
                if self?.isListening == true {
                    self?.startListeningInternal()
                }
            }
        }
    }
}

// MARK: - Types

struct WakeDetection {
    let phrase: String
    let transcript: String
    let confidence: Double
    let timestamp: Date
}
