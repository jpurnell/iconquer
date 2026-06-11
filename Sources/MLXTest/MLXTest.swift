import os

private let logger = Logger(subsystem: "com.iconquer.mlxtest", category: "main")

/// Entry point logic for the MLXTest application.
public enum MLXTestApp {
    /// Runs the application.
    public static func run() {
        logger.info("Hello, world!")
    }
}
