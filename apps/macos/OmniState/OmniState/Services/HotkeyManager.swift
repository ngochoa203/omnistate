import AppKit
import Carbon.HIToolbox

class HotkeyManager {
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?

    func register() {
        // Create event tap for key down events
        let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: { proxy, type, event, refcon -> Unmanaged<CGEvent>? in
                guard type == .keyDown else {
                    return Unmanaged.passRetained(event)
                }

                let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
                let flags = event.flags

                // ⌘⇧O = keyCode 31 (O) + command + shift
                let isCommand = flags.contains(.maskCommand)
                let isShift = flags.contains(.maskShift)
                let isNoOtherMod = !flags.contains(.maskControl) && !flags.contains(.maskAlternate)

                if keyCode == 31 && isCommand && isShift && isNoOtherMod {
                    DispatchQueue.main.async {
                        NSApp.activate(ignoringOtherApps: true)
                        if let window = NSApp.windows.first(where: { $0.canBecomeMain }) {
                            window.makeKeyAndOrderFront(nil)
                        } else {
                            // Open a new window if none exist
                            NSApp.windows.first?.makeKeyAndOrderFront(nil)
                        }
                    }
                    return nil // Consume the event
                }

                return Unmanaged.passRetained(event)
            },
            userInfo: nil
        ) else {
            print("[OmniState] Failed to create event tap. Accessibility permission may be needed.")
            return
        }

        eventTap = tap
        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)

        print("[OmniState] Global hotkey ⌘⇧O registered")
    }

    func unregister() {
        if let source = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, .commonModes)
        }
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
        }
        eventTap = nil
        runLoopSource = nil
        print("[OmniState] Global hotkey unregistered")
    }
}
