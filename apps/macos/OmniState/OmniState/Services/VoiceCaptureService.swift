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

        let inputNode = engine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            request.append(buffer)
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                if let result {
                    self?.transcript = result.bestTranscription.formattedString
                    self?.isTranscriptFinal = result.isFinal

                    if result.isFinal {
                        self?.recognitionTask = nil
                        self?.recognitionRequest = nil
                        self?.audioEngine = nil
                    }
                }

                if let error {
                    let nsError = error as NSError
                    if self?.isCancellationNoise(nsError) == true {
                        self?.isRecording = false
                        self?.recognitionTask = nil
                        self?.recognitionRequest = nil
                        self?.audioEngine = nil
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
