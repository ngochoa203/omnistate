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
    private let rmsWindowSize = 129  // ~3s at 1024 samples / 44100Hz — tolerates longer mid-sentence pauses in Vietnamese
    private let speechOnsetThreshold: Float = 0.03
    private let minRecordingDuration: TimeInterval = 1.2
    private let trailingSilenceStopMs: Double = 1800
    private let noSpeechTimeoutSec: TimeInterval = 5.0
    private let hardMaxRecordingSec: TimeInterval = 20.0
    private var recordingStartedAt: Date?
    private var hasHeardSpeech = false
    private var trailingSilenceMs: Double = 0

    // PCM16 accumulator for gateway STT upload (16kHz mono)
    private var pcm16Accumulator = Data()
    private var audioConverter: AVAudioConverter?
    private let targetAudioFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!

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
        request.contextualStrings = [
            // Chào hỏi & điều hướng
            "xin chào", "chào", "ơi", "mở", "tắt", "đóng", "dừng", "tiếp tục", "quay lại", "thoát",
            // Ứng dụng phổ biến
            "Safari", "Chrome", "Firefox", "Facebook", "Messenger", "Zalo", "Telegram",
            "YouTube", "Google", "Spotify", "TikTok", "Instagram", "Twitter",
            // Hành động nhắn tin / gọi
            "tin nhắn", "gửi tin nhắn", "nhắn tin", "gọi điện", "gọi video", "gửi", "nhận",
            // Phương tiện
            "phát nhạc", "tạm dừng", "âm lượng", "tăng âm lượng", "giảm âm lượng", "bài tiếp theo", "bài trước",
            // Tiện ích
            "báo thức", "ghi chú", "lịch", "email", "tìm kiếm", "thời tiết", "đồng hồ", "máy tính",
            // Tên người Việt phổ biến
            "Nam", "Linh", "Anh", "Hà", "Mai", "Tuấn", "Hùng", "Bình", "Hoa", "Hằng",
            "Minh", "Lan", "Phương", "Dũng", "Quân",
            // Số đếm
            "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín", "mười",
        ]
        request.taskHint = .search
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        request.addsPunctuation = true

        recentRMSValues = []
        recordingStartedAt = Date()
        hasHeardSpeech = false
        trailingSilenceMs = 0
        pcm16Accumulator = Data()

        let inputNode = engine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        audioConverter = AVAudioConverter(from: recordingFormat, to: targetAudioFormat)

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            request.append(buffer)

            // Convert to 16kHz mono PCM16 and accumulate for gateway STT upload.
            // Sending 16kHz PCM16 WAV — gateway can write directly without conversion.
            if let converter = self?.audioConverter,
               let outFormat = self?.targetAudioFormat,
               let pcmOut = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: AVAudioFrameCount(outFormat.sampleRate * Double(buffer.frameLength) / buffer.format.sampleRate) + 1) {
                var inputConsumed = false
                let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
                    if inputConsumed { outStatus.pointee = .noDataNow; return nil }
                    inputConsumed = true
                    outStatus.pointee = .haveData
                    return buffer
                }
                var error: NSError?
                let status = converter.convert(to: pcmOut, error: &error, withInputFrom: inputBlock)
                if status != .error, let int16Ptr = pcmOut.int16ChannelData?[0] {
                    let byteCount = Int(pcmOut.frameLength) * 2
                    let bytes = Data(bytes: int16Ptr, count: byteCount)
                    Task { @MainActor [weak self] in self?.pcm16Accumulator.append(bytes) }
                }
            }

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
                let frameDurationMs = Double(frameCount) / buffer.format.sampleRate * 1000.0

                // Wait until user clearly starts speaking before VAD can stop us.
                if !self.hasHeardSpeech && rms > self.speechOnsetThreshold {
                    self.hasHeardSpeech = true
                    self.trailingSilenceMs = 0
                } else if self.hasHeardSpeech {
                    if rms <= self.speechOnsetThreshold {
                        self.trailingSilenceMs += frameDurationMs
                    } else {
                        self.trailingSilenceMs = 0
                    }
                }

                guard let started = self.recordingStartedAt else { return }
                let elapsedSec = Date().timeIntervalSince(started)

                if !self.hasHeardSpeech && elapsedSec >= self.noSpeechTimeoutSec {
                    // No speech at all: stop and do not send noisy blob upstream.
                    self.stopRecording(userCancelled: true)
                    return
                }

                if elapsedSec >= self.hardMaxRecordingSec {
                    self.stopRecording()
                    return
                }

                if self.hasHeardSpeech &&
                    elapsedSec >= self.minRecordingDuration &&
                    self.trailingSilenceMs >= self.trailingSilenceStopMs {
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
                        if avgConfidence < 0.15 {
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
                    ListeningBubbleController.shared.keepAlive()

                    if result.isFinal {
                        // Drop Apple transcript if it looks like garbage: recording > 1.5s but transcript < 5 chars.
                        // Let gateway Whisper (PCM already uploaded via stopRecording) handle it instead.
                        let duration = self?.recordingStartedAt.map { Date().timeIntervalSince($0) } ?? 0
                        if duration > 1.5 && rawText.count < 5 {
                            self?.transcript = ""
                            self?.isTranscriptFinal = false
                        }
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

    func stopRecording(cancelRecognition: Bool = false, userCancelled: Bool = false) {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        isRecording = false
        ListeningBubbleController.shared.hide()

        // Flush PCM16 accumulator to gateway as WAV.
        // Only suppress when the USER explicitly cancelled — Apple STT errors
        // (cancelRecognition=true, userCancelled=false) should still fall back
        // to the gateway's Whisper transcription.
        let pcmSnapshot = pcm16Accumulator
        pcm16Accumulator = Data()
        audioConverter = nil
        if !userCancelled && !pcmSnapshot.isEmpty {
            let wavData = makeWavHeader(pcmDataLength: pcmSnapshot.count) + pcmSnapshot
            GatewaySocketClient.shared.sendTranscribeAudio(wavData)
        }

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

    /// Builds a 44-byte RIFF/WAVE/PCM header for the given raw PCM data length.
    private func makeWavHeader(pcmDataLength: Int, sampleRate: Int = 16000, channels: Int = 1, bitsPerSample: Int = 16) -> Data {
        var header = Data(count: 44)
        let byteRate = sampleRate * channels * bitsPerSample / 8
        let blockAlign = channels * bitsPerSample / 8
        header.withUnsafeMutableBytes { ptr in
            // RIFF chunk
            ptr.storeBytes(of: 0x46464952, toByteOffset: 0, as: UInt32.self) // "RIFF"
            ptr.storeBytes(of: UInt32(36 + pcmDataLength).littleEndian, toByteOffset: 4, as: UInt32.self)
            ptr.storeBytes(of: 0x45564157, toByteOffset: 8, as: UInt32.self) // "WAVE"
            // fmt sub-chunk
            ptr.storeBytes(of: 0x20746D66, toByteOffset: 12, as: UInt32.self) // "fmt "
            ptr.storeBytes(of: UInt32(16).littleEndian, toByteOffset: 16, as: UInt32.self)
            ptr.storeBytes(of: UInt16(1).littleEndian, toByteOffset: 20, as: UInt16.self)  // PCM
            ptr.storeBytes(of: UInt16(channels).littleEndian, toByteOffset: 22, as: UInt16.self)
            ptr.storeBytes(of: UInt32(sampleRate).littleEndian, toByteOffset: 24, as: UInt32.self)
            ptr.storeBytes(of: UInt32(byteRate).littleEndian, toByteOffset: 28, as: UInt32.self)
            ptr.storeBytes(of: UInt16(blockAlign).littleEndian, toByteOffset: 32, as: UInt16.self)
            ptr.storeBytes(of: UInt16(bitsPerSample).littleEndian, toByteOffset: 34, as: UInt16.self)
            // data sub-chunk
            ptr.storeBytes(of: 0x61746164, toByteOffset: 36, as: UInt32.self) // "data"
            ptr.storeBytes(of: UInt32(pcmDataLength).littleEndian, toByteOffset: 40, as: UInt32.self)
        }
        return header
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
