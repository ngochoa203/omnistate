# OmniState iOS

The iOS app shares **all React Native JS/TS code** with the Android app — screens,
navigation, stores, services, and hooks live in `../src/`. Only the native bootstrap
files (this `ios/` directory) are iOS-specific.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Xcode | ≥ 15 | App Store |
| CocoaPods | ≥ 1.14 | `gem install cocoapods` or `brew install cocoapods` |
| Node.js | ≥ 22 | [nodejs.org](https://nodejs.org) or `brew install node` |
| pnpm | ≥ 9 | `npm i -g pnpm` |
| React Native CLI | 0.77 | included via `react-native` package |

---

## First-time setup

```bash
# 1. Install JS dependencies (from monorepo root)
cd /path/to/omnistate
pnpm install

# 2. Install iOS native pods
cd apps/android/ios
pod install

# 3. Start Metro bundler (from apps/android/)
cd ..
pnpm start

# 4. In a second terminal, build and run on the simulator
pnpm ios
# — or specify a device —
pnpm ios:device
```

The app opens in the default booted iOS Simulator. To choose a specific device:

```bash
react-native run-ios --simulator "iPhone 16 Pro"
```

---

## Project structure

```
apps/android/
├── ios/                          ← This directory (iOS native layer)
│   ├── Podfile                   ← CocoaPods dependencies
│   ├── .xcode.env                ← Node binary path for Xcode build phases
│   ├── OmniState/
│   │   ├── AppDelegate.h/.mm     ← UIKit entry point, wires RCTAppDelegate
│   │   ├── main.m                ← C entry point (UIApplicationMain)
│   │   ├── Info.plist            ← Bundle ID, permissions, ATS config
│   │   ├── LaunchScreen.storyboard
│   │   └── Images.xcassets/
│   │       └── AppIcon.appiconset/
│   └── OmniState.xcodeproj/
│       └── project.pbxproj       ← Xcode project definition
│
├── src/                          ← Shared RN screens/stores/hooks (Android + iOS)
├── App.tsx                       ← Root component
├── index.js                      ← AppRegistry entry
└── metro.config.js               ← Bundler (handles both platforms)
```

---

## Bundle identifier & signing

| Setting | Value |
|---------|-------|
| Bundle ID | `com.omnistate.mobile` |
| Minimum iOS | 15.1 |
| Display name | OmniState |

To build for a **real device** or the App Store you must configure a Development
Team in Xcode:

1. Open `ios/OmniState.xcworkspace` (not `.xcodeproj`) in Xcode
2. Select the **OmniState** target → **Signing & Capabilities**
3. Set your Apple Developer Team
4. Xcode will auto-manage provisioning profiles

---

## Key permissions

| Key | Why |
|-----|-----|
| `NSMicrophoneUsageDescription` | Voice enrollment + Hold-to-Speak (VoiceScreen) |
| `NSLocalNetworkUsageDescription` | mDNS scan for gateway on LAN (ConnectScreen) |
| `NSBonjourServices` (`_omnistate._tcp`) | Required by iOS 14+ for Bonjour scanning |
| `NSCameraUsageDescription` | Reserved — future QR-code pairing |
| `NSFaceIDUsageDescription` | Reserved — future biometric lock |

App Transport Security is configured to allow plain `ws://` connections to:
- Local network addresses (LAN gateway)
- Tailscale CGNAT range (`100.x.x.x`) for remote mode

---

## Enabling real audio recording

The app ships with a **dev-mock** recorder (no native dep required). To enable
real microphone recording:

```bash
pnpm add react-native-audio-recorder-player   # from apps/android/
cd ios && pod install
```

The `AudioRecorder` bridge (`src/native/AudioRecorder.ts`) auto-detects the
library at runtime — no code changes needed.

---

## Adding a native iOS module

1. Create your native module in `ios/OmniState/` (`.h` + `.mm` files)
2. Add both files to `OmniState.xcodeproj/project.pbxproj` under the
   `PBXFileReference` and `PBXSourcesBuildPhase` sections
3. Register the module using `RCT_EXPORT_MODULE()`
4. Access it in JS via `NativeModules.YourModule`

For complex modules, prefer **Turbo Native Modules** (codegen) — see the
[RN 0.77 docs](https://reactnative.dev/docs/turbo-native-modules-introduction).

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pod install` fails with "Unable to find a specification for React-Core" | Run `pnpm install` from the monorepo root first, then retry |
| Metro can't find `@omnistate/mobile-core` | Ensure `pnpm install` ran at the monorepo root; check `metro.config.js` `watchFolders` |
| Build fails: "No such module 'React'" | Open `.xcworkspace`, not `.xcodeproj` |
| Simulator shows white screen | Check Metro is running (`pnpm start`); look for JS errors in the Metro terminal |
| `NODE_BINARY` not found in Xcode | Add `echo export NODE_BINARY=$(command -v node) > .xcode.env.local` from the `ios/` directory |
| LAN discovery doesn't work | Ensure `NSLocalNetworkUsageDescription` + `NSBonjourServices` are in Info.plist (they are); grant permission when iOS prompts |
