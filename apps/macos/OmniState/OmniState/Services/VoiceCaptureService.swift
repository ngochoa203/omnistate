import Foundation
import AVFoundation
import Speech

@MainActor
final class VoiceCaptureService: ObservableObject {
    static let shared = VoiceCaptureService()

    @Published var isAuthorized = false
    @Published var isRecording = false
    @Published var transcript = ""
    @Published var errorMessage: String?

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer: SFSpeechRecognizer?

    private init() {}

    func requestPermissionsIfNeeded() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            Task { @MainActor in
                self?.isAuthorized = (status == .authorized)
                if status != .authorized {
                    self?.errorMessage = "Speech recognition permission denied"
                }
            }
        }

        AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
            Task { @MainActor in
                if !granted {
                    self?.errorMessage = "Microphone permission denied"
                }
            }
        }
    }

    func startRecording(localeIdentifier: String) {
        stopRecording()
        errorMessage = nil
        transcript = ""

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
                }

                if let error {
                    self?.errorMessage = error.localizedDescription
                    self?.stopRecording()
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

    func stopRecording() {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()

        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        audioEngine = nil

        isRecording = false

    }
}
