import Foundation
import AVFoundation
import Speech

@MainActor
final class VoiceCaptureService: ObservableObject {
    static let shared = VoiceCaptureService()

    @Published var isAuthorized = false
    @Published var isRecording = false
    @Published var transcript = ""
    @Published var isTranscriptFinal = false
    @Published var errorMessage: String?

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer: SFSpeechRecognizer?
    private var recentRMSValues: [Float] = []
    private let rmsWindowSize = 86  // ~2s at 1024 samples / 44100Hz ≈ 86 buffers (tolerates mid-sentence pauses)
    private let silenceThreshold: Float = 0.008
    private let speechOnsetThreshold: Float = 0.03
    private let minRecordingDuration: TimeInterval = 2.0
    private var recordingStartedAt: Date?
    private var hasHeardSpeech = false

    private init() {}

    func requestPermissionsIfNeeded() {
        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        let speechStatus = SFSpeechRecognizer.authorizationStatus()
        switch speechStatus {
        case .authorized:
            isAuthorized = (micStatus == .authorized)
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { [weak self] status in
                Task { @MainActor in
                    let mic = AVCaptureDevice.authorizationStatus(for: .audio)
                    self?.isAuthorized = (status == .authorized && mic == .authorized)
                    if status != .authorized {
                        self?.errorMessage = "Speech recognition permission denied"
                    }
                }
            }
        default:
            isAuthorized = false
            errorMessage = "Speech recognition permission denied"
        }

        switch micStatus {
        case .authorized:
            isAuthorized = isAuthorized && true
            break
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                Task { @MainActor in
                    if !granted {
                        self?.errorMessage = "Microphone permission denied"
                        self?.isAuthorized = false
                    } else {
                        self?.isAuthorized = (SFSpeechRecognizer.authorizationStatus() == .authorized)
                    }
                }
            }
        default:
            errorMessage = "Microphone permission denied"
            isAuthorized = false
        }
    }

    func startRecording(localeIdentifier: String) {
        stopRecording()
        errorMessage = nil
        transcript = ""
        isTranscriptFinal = false

        let locale = Locale(identifier: localeIdentifier)
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            errorMessage = "Speech recognizer unavailable for locale \(localeIdentifier)"
            return
        }

        speechRecognizer = recognizer

        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.contextualStrings = []
        request.taskHint = .dictation
        request.requiresOnDeviceRecognition = false
        request.addsPunctuation = true

        recentRMSValues = []
        recordingStartedAt = Date()
        hasHeardSpeech = false

        let inputNode = engine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            request.append(buffer)

            // Compute RMS energy for silence detection
            guard let channelData = buffer.floatChannelData?[0] else { return }
            let frameCount = Int(buffer.frameLength)
            var sumSquares: Float = 0
            for i in 0..<frameCount { sumSquares += channelData[i] * channelData[i] }
            let rms = sqrt(sumSquares / Float(max(frameCount, 1)))

            Task { @MainActor [weak self] in
                guard let self else { return }
                self.recentRMSValues.append(rms)
                if self.recentRMSValues.count > self.rmsWindowSize {
                    self.recentRMSValues.removeFirst()
                }

                // Wait until user clearly starts speaking before VAD can stop us.
                if !self.hasHeardSpeech && rms > self.speechOnsetThreshold {
                    self.hasHeardSpeech = true
                }

                guard self.hasHeardSpeech,
                      self.recentRMSValues.count == self.rmsWindowSize,
                      let started = self.recordingStartedAt,
                      Date().timeIntervalSince(started) >= self.minRecordingDuration
                else { return }

                let avgRMS = self.recentRMSValues.reduce(0, +) / Float(self.rmsWindowSize)
                if avgRMS < self.silenceThreshold {
                    self.stopRecording()
                }
            }
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                if let result {
                    // Confidence gating: drop result if average segment confidence < 0.3
                    let segments = result.bestTranscription.segments
                    if !segments.isEmpty {
                        let avgConfidence = segments.map(\.confidence).reduce(0, +) / Float(segments.count)
                        if avgConfidence < 0.3 {
                            if result.isFinal {
                                self?.stopRecording()
                            }
                            return  // treat as noise
                        }
                    }

                    // Wake-word guard: drop transcript if it's just the wake word or too short
                    let rawText = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                    let lower = rawText.lowercased()
                    let wakeWords: Set<String> = ["hey mimi", "mimi", "hey", "ok mimi"]
                    let isWakeOrEmpty = rawText.count < 2 || wakeWords.contains(lower)

                    if isWakeOrEmpty {
                        if result.isFinal {
                            self?.stopRecording()
                        }
                        return  // drop wake-word-only results
                    }

                    self?.transcript = rawText
                    self?.isTranscriptFinal = result.isFinal

                    if result.isFinal {
                        self?.stopRecording()
                    }
                }

                if let error {
                    let nsError = error as NSError
                    if self?.isCancellationNoise(nsError) == true {
                        self?.stopRecording()
                        return
                    }

                    self?.errorMessage = error.localizedDescription
                    self?.stopRecording(cancelRecognition: true)
                }
            }
        }

        do {
            try engine.start()
            audioEngine = engine
            recognitionRequest = request
            isRecording = true
            ListeningBubbleController.shared.show()
        } catch {
            errorMessage = "Failed to start recording: \(error.localizedDescription)"
            stopRecording()
        }
    }

    func stopRecording(cancelRecognition: Bool = false) {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        isRecording = false
        ListeningBubbleController.shared.hide()

        if cancelRecognition {
            recognitionTask?.cancel()
            recognitionTask = nil
            recognitionRequest = nil
            audioEngine = nil
            return
        }

        let currentTask = recognitionTask
        let currentRequest = recognitionRequest
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard let self else { return }

            if self.recognitionTask === currentTask {
                currentTask?.cancel()
                self.recognitionTask = nil
            }
            if self.recognitionRequest === currentRequest {
                self.recognitionRequest = nil
            }
            self.audioEngine = nil
        }

    }

    private func isCancellationNoise(_ error: NSError) -> Bool {
        if error.domain == "kAFAssistantErrorDomain" {
            return error.code == 203 || error.code == 216
        }
        if error.domain == NSURLErrorDomain {
            return error.code == NSURLErrorCancelled
        }
        return false

    }
}
