import AppKit
import AVFoundation
import ApplicationServices
import CoreGraphics
import Speech
import UserNotifications

@MainActor
final class PermissionBootstrapper {
    static let shared = PermissionBootstrapper()

    private let completedBootstrapKey = "omnistate.didCompleteFullPermissions"
    private let lastPromptTimestampKey = "omnistate.lastPermissionPromptAt"
    private let promptCooldownSeconds: TimeInterval = 60 * 60 * 6

    private init() {}

    func requestAllInitialPermissions(force: Bool = false) async {
        let now = Date().timeIntervalSince1970
        let lastPromptAt = UserDefaults.standard.double(forKey: lastPromptTimestampKey)

        if !force {
            if UserDefaults.standard.bool(forKey: completedBootstrapKey), await hasAllRequiredPermissions() {
                return
            }

            if lastPromptAt > 0, now - lastPromptAt < promptCooldownSeconds {
                return
            }
        }

        UserDefaults.standard.set(now, forKey: lastPromptTimestampKey)

        let hasAccessibility = AXIsProcessTrusted()
        let hasScreenRecording: Bool
        if #available(macOS 10.15, *) {
            hasScreenRecording = CGPreflightScreenCaptureAccess()
        } else {
            hasScreenRecording = true
        }
        let hasAppleEvents = hasAppleEventsAccess()

        // Trigger privacy prompts in a deterministic order.
        if !hasAccessibility { requestAccessibilityPrompt() }
        if !hasScreenRecording { requestScreenRecordingPrompt() }
        if !hasAppleEvents { requestAppleEventsPrompt() }

        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            _ = await requestMicrophonePrompt()
        }
        if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
            _ = await requestCameraPrompt()
        }
        if SFSpeechRecognizer.authorizationStatus() == .notDetermined {
            _ = await requestSpeechPrompt()
        }
        if await notificationAuthorizationStatus() == .notDetermined {
            _ = await requestNotificationPrompt()
        }

        let completed = await hasAllRequiredPermissions()
        UserDefaults.standard.set(completed, forKey: completedBootstrapKey)
    }

    func openPrivacySettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy") else {
            return
        }
        NSWorkspace.shared.open(url)
    }

    private func requestAccessibilityPrompt() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    private func requestScreenRecordingPrompt() {
        if #available(macOS 10.15, *) {
            if !CGPreflightScreenCaptureAccess() {
                _ = CGRequestScreenCaptureAccess()
            }
        }
    }

    private func requestAppleEventsPrompt() {
        let source = "tell application \"Finder\" to get name of startup disk"
        var errorDict: NSDictionary?
        NSAppleScript(source: source)?.executeAndReturnError(&errorDict)
    }

    private func requestMicrophonePrompt() async -> Bool {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        if status == .authorized { return true }
        if status == .denied || status == .restricted { return false }
        return await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    private func requestCameraPrompt() async -> Bool {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .authorized { return true }
        if status == .denied || status == .restricted { return false }
        return await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .video) { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    private func requestSpeechPrompt() async -> Bool {
        let status = SFSpeechRecognizer.authorizationStatus()
        if status == .authorized { return true }
        if status == .denied || status == .restricted { return false }

        return await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { newStatus in
                continuation.resume(returning: newStatus == .authorized)
            }
        }
    }

    private func requestNotificationPrompt() async -> Bool {
        let existing = await notificationAuthorizationStatus()
        if existing == .authorized || existing == .provisional {
            return true
        }
        if existing == .denied {
            return false
        }

        let center = UNUserNotificationCenter.current()
        return await withCheckedContinuation { continuation in
            center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                continuation.resume(returning: granted)
            }
        }
    }

    private func notificationAuthorizationStatus() async -> UNAuthorizationStatus {
        let center = UNUserNotificationCenter.current()
        return await withCheckedContinuation { continuation in
            center.getNotificationSettings { settings in
                continuation.resume(returning: settings.authorizationStatus)
            }
        }
    }

    private func hasAllRequiredPermissions() async -> Bool {
        let hasAccessibility = AXIsProcessTrusted()
        let hasScreenRecording: Bool
        if #available(macOS 10.15, *) {
            hasScreenRecording = CGPreflightScreenCaptureAccess()
        } else {
            hasScreenRecording = true
        }

        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        let camStatus = AVCaptureDevice.authorizationStatus(for: .video)
        let speechStatus = SFSpeechRecognizer.authorizationStatus()
        let notificationStatus = await notificationAuthorizationStatus()

        return hasAccessibility
            && hasScreenRecording
            && hasAppleEventsAccess()
            && micStatus == .authorized
            && camStatus == .authorized
            && speechStatus == .authorized
            && (notificationStatus == .authorized
                || notificationStatus == .provisional)
    }

    private func hasAppleEventsAccess() -> Bool {
        let source = "tell application \"Finder\" to get name of startup disk"
        var errorDict: NSDictionary?
        _ = NSAppleScript(source: source)?.executeAndReturnError(&errorDict)

        guard let errorDict else {
            return true
        }

        if let errorNumber = errorDict[NSAppleScript.errorNumber] as? Int {
            return errorNumber != -1743
        }
        return false
    }
}
