// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OmniState",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "OmniState",
            path: "OmniState",
            exclude: [
                "Info.plist",
                "OmniState.entitlements",
            ],
            resources: [
                .copy("Resources"),
            ]
        ),
    ]
)
