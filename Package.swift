// swift-tools-version: 6.0
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "MarketEvents",
    platforms: [ // minimum for DiscordBM
        .macOS(.v13),
        .iOS(.v16),
        .tvOS(.v16),
        .watchOS(.v9),
    ],
    dependencies: [
        .package(url: "https://github.com/DiscordBM/DiscordBM", from: "1.0.0"),
    ],
    targets: [
        .executableTarget(
            name: "MarketEvents",
            dependencies: [
                .product(name: "DiscordBM", package: "DiscordBM"),
            ]
        ),
    ]
)
