// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BambuSlicerServer",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "BambuSlicerServer",
            path: "BambuSlicerServer"
        )
    ]
)
