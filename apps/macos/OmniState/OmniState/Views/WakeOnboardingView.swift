import SwiftUI
import AVFoundation

/// 5-sample wake-word onboarding wizard shown on first launch.
///
/// Flow:
///   Step 1 → record phrase 1 (up to 12 s, stops on silence)
///   ...
///   Step 5 → record phrase 5
///   Step 6 → POST /api/wake/personal-train → show result
///
/// User data stays on-device: samples go to ~/.omnistate/wake-samples/.
struct WakeOnboardingView: View {
    @Binding var isPresented: Bool
    @AppStorage("omnistate.wakeOnboarding.completed") private var completed: Bool = false

    @State private var currentStep: Int = 1  // 1..5 record, 6 train, 7 done
    @State private var isRecording: Bool = false
    @State private var recorder: AVAudioRecorder?
    @State private var recordingURL: URL?
    @State private var statusMessage: String = ""
    @State private var trainingLog: String = ""
    @State private var trainFailed: Bool = false

    // Silence-detection state (reset each recording)
    @State private var elapsedSec: Double = 0
    @State private var silenceWindow: [Float] = []
    @State private var silenceTimer: Timer?

    private let totalSamples = 5
    private let maxRecordSec: Double = 12.0       // hard ceiling
    private let minRecordSec: Double = 2.0        // reject below this
    private let speechMinSec: Double = 1.5        // must capture before silence-stop
    private let silenceWindowSec: Double = 0.8    // trailing silence window
    private let silenceDBFS: Float = -40.0        // threshold
    private let pollInterval: Double = 0.1        // meters poll rate

    private let gatewayBase = "http://localhost:19800"
    private let trainingPhrases = [
        "Hey Mimi, mở Safari rồi tìm giúp tôi tin tức công nghệ mới nhất trong tuần này nhé",
        "Hey Mimi, đặt báo thức bảy giờ sáng mai và nhắc tôi uống thuốc trước khi ăn",
        "Hey Mimi, hôm nay trời đẹp quá, bật danh sách nhạc thư giãn buổi sáng giúp tôi",
        "Hey Mimi, ghi chú lại cuộc họp lúc hai giờ chiều với khách hàng quan trọng ngày mai",
        "Hey Mimi, gọi điện cho mẹ rồi nhắn anh hai là tối nay mình về ăn cơm cùng cả nhà",
    ]

    var body: some View {
        VStack(spacing: 16) {
            Text("Huấn luyện giọng nói của bạn")
                .font(.title2).bold()
            Text("Đọc 5 câu khác nhau bắt đầu bằng \"hey mimi …\" — không cần Colab, không cần GPU, tất cả xử lý trên máy bạn.")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            ProgressView(value: Double(min(currentStep - 1, totalSamples)), total: Double(totalSamples))
                .frame(maxWidth: 320)

            if currentStep <= totalSamples {
                VStack(spacing: 8) {
                    Text("Mẫu \(currentStep) / \(totalSamples)")
                        .font(.headline)
                    Text("Nhấn nút rồi đọc rõ câu:")
                        .foregroundColor(.secondary)
                    Text(trainingPhrases[currentStep - 1])
                        .font(.title3).italic()
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    Button(action: recordSample) {
                        Label(
                            isRecording
                                ? "Đang nghe (\(String(format: "%.1f", elapsedSec))s)..."
                                : "🎙 Ghi âm mẫu \(currentStep)",
                            systemImage: isRecording ? "mic.fill" : "mic"
                        )
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isRecording)
                }
            } else if currentStep == 6 {
                VStack(spacing: 8) {
                    ProgressView().controlSize(.large)
                    Text("Đang học giọng của bạn...").font(.headline)
                }
                .onAppear { trainTemplate() }
            } else {
                // Step 7 — success
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.green)
                    Text("Xong! Bạn có thể gọi \"hey mimi\".")
                        .font(.headline)
                    Button("Đóng") {
                        isPresented = false
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                }
            }

            if !statusMessage.isEmpty {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            // Retry button shown only when training failed
            if trainFailed {
                Button("Thử lại huấn luyện") {
                    trainFailed = false
                    statusMessage = ""
                    currentStep = 6   // re-trigger onAppear via identity trick below
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                        trainTemplate()
                    }
                }
                .buttonStyle(.bordered)
            }

            // Disabled close shown while training is pending (step 6) so there
            // is always a visible close affordance, but it does nothing until done.
            if currentStep != 7 {
                Button("Đóng") { }
                    .buttonStyle(.plain)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .disabled(true)
            }
        }
        .padding(24)
        .frame(width: 440)
    }

    // MARK: - Recording

    private func recordSample() {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        switch status {
        case .authorized:
            startRecording()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    if granted {
                        self.startRecording()
                    } else {
                        self.statusMessage = "Quyền micrô bị từ chối — vào System Settings > Privacy & Security > Microphone để cấp quyền."
                    }
                }
            }
        default:
            statusMessage = "Quyền micrô bị từ chối — vào System Settings > Privacy & Security > Microphone để cấp quyền."
        }
    }

    private func startRecording() {
        let fm = FileManager.default
        let url = fm.temporaryDirectory.appendingPathComponent("wake_sample_\(currentStep).wav")
        recordingURL = url

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]

        do {
            recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder?.isMeteringEnabled = true
            guard recorder?.prepareToRecord() == true else {
                statusMessage = "Không chuẩn bị được micrô — kiểm tra lại thiết bị."
                return
            }
            recorder?.record()   // no fixed duration — we stop on silence
            isRecording = true
            statusMessage = ""
            elapsedSec = 0
            silenceWindow = []

            let windowCount = Int((silenceWindowSec / pollInterval).rounded())

            silenceTimer?.invalidate()
            silenceTimer = Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { timer in
                guard let rec = self.recorder, rec.isRecording else {
                    timer.invalidate()
                    self.silenceTimer = nil
                    return
                }
                rec.updateMeters()
                let avg = rec.averagePower(forChannel: 0)
                self.elapsedSec += self.pollInterval

                self.silenceWindow.append(avg)
                if self.silenceWindow.count > windowCount {
                    self.silenceWindow.removeFirst()
                }

                let hitMaxDuration = self.elapsedSec >= self.maxRecordSec
                let windowFull = self.silenceWindow.count == windowCount
                let allSilent = windowFull && self.silenceWindow.allSatisfy { $0 < self.silenceDBFS }
                let enoughSpeech = self.elapsedSec >= self.speechMinSec

                guard hitMaxDuration || (enoughSpeech && allSilent) else { return }

                // Stop recording
                timer.invalidate()
                self.silenceTimer = nil
                rec.stop()
                self.isRecording = false

                let captured = self.elapsedSec
                print("[WakeOnboarding] sample \(self.currentStep) elapsed=\(String(format: "%.2f", captured))s")

                if captured < self.minRecordSec {
                    self.statusMessage = "Hãy đọc to hơn và dài hơn"
                    return
                }

                if let recordURL = self.recordingURL {
                    self.verifySample(url: recordURL, index: self.currentStep) { accepted, transcript in
                        if accepted {
                            self.uploadSample(url: recordURL, index: self.currentStep)
                        } else if let t = transcript {
                            self.statusMessage = "Nghe được: \(t). Đọc lại giúp mình nhé"
                        }
                    }
                }
            }
        } catch {
            statusMessage = "Không mở được mic: \(error.localizedDescription)"
            isRecording = false
        }
    }

    // MARK: - STT Verify

    private struct STTVerifyResponse: Decodable {
        let transcript: String
        let similarity: Double
        let accepted: Bool
    }

    /// Base64-encodes the WAV at `url`, POSTs to /api/stt/verify (4 s timeout),
    /// and calls `completion(accepted, transcript?)`.
    /// Network/timeout/decode failures → accept silently (tone is what matters).
    private func verifySample(url: URL, index: Int, completion: @escaping (Bool, String?) -> Void) {
        guard let data = try? Data(contentsOf: url) else {
            statusMessage = "Không đọc được file ghi âm"
            completion(false, nil)
            return
        }
        guard data.count >= 32 * 1024 else {
            statusMessage = "File ghi âm quá ngắn — hãy đọc to và rõ hơn"
            completion(false, nil)
            return
        }

        let body: [String: String] = [
            "audio": data.base64EncodedString(),
            "expectedPhrase": trainingPhrases[index - 1],
        ]
        guard let bodyData = try? JSONSerialization.data(withJSONObject: body) else {
            completion(true, nil)   // encode failure → accept, tone captured
            return
        }

        var req = URLRequest(url: URL(string: "\(gatewayBase)/api/stt/verify")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = bodyData
        req.timeoutInterval = 4.0

        URLSession.shared.dataTask(with: req) { responseData, _, err in
            DispatchQueue.main.async {
                if let err = err {
                    // Network/timeout — accept silently
                    print("[WakeOnboarding] stt/verify soft-fail (accepted): \(err)")
                    completion(true, nil)
                    return
                }
                guard let responseData,
                      let result = try? JSONDecoder().decode(STTVerifyResponse.self, from: responseData)
                else {
                    // Decode error — accept silently
                    print("[WakeOnboarding] stt/verify decode error — accepted anyway")
                    completion(true, nil)
                    return
                }

                let t = result.transcript
                let words = t.split(separator: " ").count
                let hasTrigger = t.lowercased().contains("mimi") || t.lowercased().contains("hey")

                if result.similarity >= 0.2 || hasTrigger {
                    completion(true, t)
                } else if words < 3 {
                    // Sparse transcript — mic quirk, accept for tone
                    completion(true, t)
                } else {
                    // User said something clearly unrelated
                    completion(false, t)
                }
            }
        }.resume()
    }

    // MARK: - Upload

    private func uploadSample(url: URL, index: Int) {
        guard let data = try? Data(contentsOf: url) else {
            statusMessage = "Không đọc được file ghi âm"
            return
        }

        // NOTE: Size + duration guards are enforced before verifySample is called.
        var req = URLRequest(url: URL(string: "\(gatewayBase)/api/wake/personal-sample")!)
        req.httpMethod = "POST"
        req.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        req.setValue("\(index)", forHTTPHeaderField: "X-Sample-Index")
        req.setValue(trainingPhrases[index - 1], forHTTPHeaderField: "X-Phrase")
        req.httpBody = data

        URLSession.shared.dataTask(with: req) { _, resp, err in
            DispatchQueue.main.async {
                if let err = err {
                    self.statusMessage = "Tải lên thất bại: \(err.localizedDescription)"
                    return
                }
                guard let http = resp as? HTTPURLResponse, http.statusCode == 201 else {
                    self.statusMessage = "Gateway trả lỗi khi nhận mẫu \(index)"
                    return
                }
                self.currentStep += 1
                self.statusMessage = "Đã lưu mẫu \(index)"
            }
        }.resume()
    }

    // MARK: - Train

    private func trainTemplate() {
        var req = URLRequest(url: URL(string: "\(gatewayBase)/api/wake/personal-train")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = "{}".data(using: .utf8)
        req.timeoutInterval = 180

        URLSession.shared.dataTask(with: req) { data, resp, err in
            DispatchQueue.main.async {
                if let err = err {
                    self.statusMessage = "Huấn luyện lỗi: \(err.localizedDescription)"
                    self.trainFailed = true
                    return
                }
                guard let http = resp as? HTTPURLResponse, http.statusCode == 201 else {
                    if let d = data, let s = String(data: d, encoding: .utf8) {
                        self.statusMessage = "Gateway: \(s.prefix(200))"
                    } else {
                        self.statusMessage = "Huấn luyện thất bại — thử lại."
                    }
                    self.trainFailed = true
                    return
                }
                // Success: mark completed, advance to done screen
                self.completed = true
                GatewaySocketClient.shared.enableWakeIfOnboarded()
                self.currentStep = 7
            }
        }.resume()
    }
}
