// swift-tools-version: 6.2
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "MLXTest",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-docc-plugin", from: "1.4.3"),
    ],
    targets: [
        .target(
            name: "MLXTest"
        ),
        .testTarget(
            name: "MLXTestTests",
            dependencies: ["MLXTest"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
