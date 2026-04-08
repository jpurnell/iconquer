#!/usr/bin/env swift

// setup.swift — Generate .claude/ bridge layer for a project using development guidelines
//
// Usage:
//   From your project root, after cloning development-guidelines:
//     swift development-guidelines/setup.swift
//
//   Or with a custom guidelines path:
//     swift setup.swift --guidelines-path .guidelines

import Foundation

// MARK: - Configuration

struct Config {
    let projectRoot: URL
    let guidelinesPath: String  // relative to project root
    let projectName: String
}

// MARK: - Helpers

func fileManager() -> FileManager { .default }

func writeFile(at path: String, content: String, relativeTo root: URL) {
    let url = root.appendingPathComponent(path)
    let dir = url.deletingLastPathComponent()
    try! fileManager().createDirectory(at: dir, withIntermediateDirectories: true)
    try! content.write(to: url, atomically: true, encoding: .utf8)
    print("  ✓ \(path)")
}

func fileExists(at path: String, relativeTo root: URL) -> Bool {
    fileManager().fileExists(atPath: root.appendingPathComponent(path).path)
}

func readExisting(at path: String, relativeTo root: URL) -> String? {
    try? String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
}

// MARK: - Parse Arguments

func parseArgs() -> Config {
    let args = CommandLine.arguments
    let cwd = URL(fileURLWithPath: fileManager().currentDirectoryPath)

    // Determine guidelines path relative to project root
    var guidelinesRelPath: String?
    var projectRoot = cwd

    for i in 1..<args.count {
        if args[i] == "--guidelines-path", i + 1 < args.count {
            guidelinesRelPath = args[i + 1]
        }
        if args[i] == "--project-root", i + 1 < args.count {
            projectRoot = URL(fileURLWithPath: args[i + 1])
        }
    }

    // Auto-detect: if this script lives inside the guidelines dir, infer the relative path
    if guidelinesRelPath == nil {
        let scriptPath = URL(fileURLWithPath: args[0]).resolvingSymlinksInPath().path
        let cwdPath = projectRoot.path

        // Find common prefix — the script's parent directory relative to cwd is the guidelines path
        if scriptPath.hasPrefix(cwdPath) {
            let relative = String(scriptPath.dropFirst(cwdPath.count + 1)) // drop leading /
            // e.g., "development-guidelines/setup.swift" → "development-guidelines"
            if let lastSlash = relative.lastIndex(of: "/") {
                guidelinesRelPath = String(relative[..<lastSlash])
            }
        }
    }

    let guidelinesPath = guidelinesRelPath ?? "development-guidelines"

    // Verify guidelines exist
    guard fileExists(at: "\(guidelinesPath)/README.md", relativeTo: projectRoot) else {
        print("Error: Cannot find guidelines at '\(guidelinesPath)/README.md'")
        print("Run this script from your project root, e.g.:")
        print("  swift \(guidelinesPath)/setup.swift")
        print("")
        print("Or specify the path:")
        print("  swift setup.swift --guidelines-path <relative-path-to-guidelines>")
        exit(1)
    }

    // Derive project name from the directory name
    let projectName = projectRoot.lastPathComponent

    return Config(
        projectRoot: projectRoot,
        guidelinesPath: guidelinesPath,
        projectName: projectName
    )
}

// MARK: - Generators

func generateCLAUDEmd(_ config: Config) -> String {
    """
    # \(config.projectName) — Development Guidelines

    This project follows the Design-First TDD workflow defined in `\(config.guidelinesPath)/`.

    ## Session Start

    Read documents in this order for full context recovery:
    1. `\(config.guidelinesPath)/00_CORE_RULES/00_MASTER_PLAN.md` — Vision and priorities
    2. `\(config.guidelinesPath)/00_CORE_RULES/01_CODING_RULES.md` — Forbidden patterns, safety rules
    3. `\(config.guidelinesPath)/00_CORE_RULES/09_TEST_DRIVEN_DEVELOPMENT.md` — Testing contract
    4. `\(config.guidelinesPath)/04_IMPLEMENTATION_CHECKLISTS/CURRENT_*.md` — Active tasks (if any)
    5. Latest file in `\(config.guidelinesPath)/05_SUMMARIES/` — Where we left off (if any)

    For quick recovery (same-day, simple bug fixes), read only items 4-5.

    ## Development Workflow

    ```
    0. DESIGN   → Propose architecture (05_DESIGN_PROPOSAL.md)
    1. RED      → Write failing tests first
    2. GREEN    → Minimum code to pass
    3. REFACTOR → Clean up, keep tests green
    4. DOCUMENT → DocC comments and examples
    5. VERIFY   → Run quality-gate (zero warnings/errors)
    ```

    ## Key Rules

    - No force unwraps (`!`), no `try!`, no force casts (`as!`)
    - Guard clauses for all validation; early returns over nested ifs
    - Division safety: always check for zero before dividing
    - Swift 6 strict concurrency compliance
    - All public APIs require DocC documentation

    ## Quality Gate

    Run `quality-gate` before every commit. All checks must pass.

    ## References

    - Full guidelines: `\(config.guidelinesPath)/README.md`
    - Coding rules: `\(config.guidelinesPath)/00_CORE_RULES/01_CODING_RULES.md`
    - TDD contract: `\(config.guidelinesPath)/00_CORE_RULES/09_TEST_DRIVEN_DEVELOPMENT.md`
    - Session workflow: `\(config.guidelinesPath)/00_CORE_RULES/07_SESSION_WORKFLOW.md`
    """
}

func generateSwiftRules(_ config: Config) -> String {
    """
    ---
    paths:
      - "Sources/**/*.swift"
      - "Tests/**/*.swift"
    ---
    # Swift Development Rules

    Follow the coding standards in `\(config.guidelinesPath)/00_CORE_RULES/01_CODING_RULES.md`.

    ## Mandatory

    - No force unwraps, no `try!`, no force casts
    - Guard clauses for validation, early returns over nesting
    - Division safety: check for zero before dividing
    - Swift 6 strict concurrency compliance
    - All public APIs need DocC comments (see `\(config.guidelinesPath)/00_CORE_RULES/03_DOCC_GUIDELINES.md`)

    ## Testing (TDD)

    Follow `\(config.guidelinesPath)/00_CORE_RULES/09_TEST_DRIVEN_DEVELOPMENT.md`:
    - Write failing tests BEFORE implementation
    - Test golden path, edge cases, invalid inputs
    - Use deterministic test data (no random values)
    - Floating point: use accuracy-based assertions, not exact equality
    """
}

func generateDesignCommand(_ config: Config) -> String {
    """
    ---
    description: Start a new feature with a Design Proposal (Phase 0)
    ---
    Create a Design Proposal for the following feature: $ARGUMENTS

    Follow the template in `\(config.guidelinesPath)/00_CORE_RULES/05_DESIGN_PROPOSAL.md`.

    Save the proposal to `\(config.guidelinesPath)/02_IMPLEMENTATION_PLANS/PROPOSALS/`.

    Include:
    - Problem statement and motivation
    - Proposed API with Swift signatures
    - Error handling strategy
    - Testing strategy
    - Performance considerations
    """
}

func generateRecoverCommand(_ config: Config) -> String {
    """
    ---
    description: Recover session context after a break
    ---
    Perform context recovery following `\(config.guidelinesPath)/00_CORE_RULES/07_SESSION_WORKFLOW.md`.

    Read in order:
    1. `\(config.guidelinesPath)/00_CORE_RULES/00_MASTER_PLAN.md`
    2. `\(config.guidelinesPath)/00_CORE_RULES/01_CODING_RULES.md`
    3. `\(config.guidelinesPath)/00_CORE_RULES/09_TEST_DRIVEN_DEVELOPMENT.md`
    4. Any `\(config.guidelinesPath)/04_IMPLEMENTATION_CHECKLISTS/CURRENT_*.md` files
    5. The most recent file in `\(config.guidelinesPath)/05_SUMMARIES/`
    6. Recent git log (`git log --oneline -20`)

    Then report:
    - Current phase and feature being worked on
    - What was completed last session
    - Exact next step to resume work
    - Any blockers or open questions
    """
}

func generateSummarizeCommand(_ config: Config) -> String {
    """
    ---
    description: Create an end-of-session summary
    ---
    Create a session summary following the template at `\(config.guidelinesPath)/05_SUMMARIES/SESSION_SUMMARY_TEMPLATE.md`.

    Save it to `\(config.guidelinesPath)/05_SUMMARIES/` with today's date as the filename prefix (YYYY-MM-DD_description.md).

    Include:
    - Work completed this session
    - Current phase and status
    - Quality gate results (run `quality-gate` if not already run)
    - Exact next step for the next session
    - Any blockers or decisions needed

    Also update any active `\(config.guidelinesPath)/04_IMPLEMENTATION_CHECKLISTS/CURRENT_*.md` to reflect current progress.
    """
}

func generateChecklistCommand(_ config: Config) -> String {
    """
    ---
    description: Create a new feature implementation checklist
    ---
    Create a new implementation checklist for: $ARGUMENTS

    Use the template at `\(config.guidelinesPath)/04_IMPLEMENTATION_CHECKLISTS/TEMPLATE.md`.

    Save it to `\(config.guidelinesPath)/04_IMPLEMENTATION_CHECKLISTS/CURRENT_$ARGUMENTS.md` (sanitize the filename).

    The checklist should track all phases:
    - [ ] Phase 0: Design Proposal
    - [ ] Phase 1: Tests (RED)
    - [ ] Phase 2: Implementation (GREEN)
    - [ ] Phase 3: Refactoring
    - [ ] Phase 4: Documentation
    - [ ] Phase 5: Quality Gates
    """
}

func generateSettings() -> String {
    """
    {
      "permissions": {
        "allow": [
          "Bash(swift build:*)",
          "Bash(swift test:*)",
          "Bash(swift package:*)",
          "Bash(quality-gate:*)",
          "Bash(quality-gate)",
          "Bash(git status:*)",
          "Bash(git diff:*)",
          "Bash(git log:*)"
        ],
        "deny": [
          "Bash(rm -rf:*)",
          "Read(.env)",
          "Read(.env.*)"
        ]
      }
    }
    """
}

// MARK: - Gitignore helpers

func ensureGitignoreEntries(config: Config) {
    let gitignorePath = ".gitignore"
    let url = config.projectRoot.appendingPathComponent(gitignorePath)

    var content = (try? String(contentsOf: url, encoding: .utf8)) ?? ""

    let entries = [
        "# Claude Code local settings (personal preferences, not shared)",
        ".claude/settings.local.json",
        "CLAUDE.local.md",
    ]

    var added: [String] = []
    for entry in entries {
        if !content.contains(entry) {
            added.append(entry)
        }
    }

    if !added.isEmpty {
        if !content.isEmpty && !content.hasSuffix("\n") {
            content += "\n"
        }
        content += "\n" + added.joined(separator: "\n") + "\n"
        try! content.write(to: url, atomically: true, encoding: .utf8)
        print("  ✓ .gitignore (added local claude entries)")
    }
}

// MARK: - Project scaffolding directories
//
// All project-state directories live INSIDE the cloned guidelines folder
// so they sit within that folder's git boundary and don't pollute the
// outer project's working tree. The slash commands and CLAUDE.md
// reference paths under `<guidelinesPath>/...` for the same reason.

func ensureProjectDirectories(config: Config) {
    let dirs = [
        "02_IMPLEMENTATION_PLANS/PROPOSALS",
        "02_IMPLEMENTATION_PLANS/UPCOMING",
        "02_IMPLEMENTATION_PLANS/COMPLETED",
        "04_IMPLEMENTATION_CHECKLISTS",
        "04_IMPLEMENTATION_CHECKLISTS/04_99_COMPLETED",
        "04_IMPLEMENTATION_CHECKLISTS/04_99_BLOCKED",
        "05_SUMMARIES",
        "05_SUMMARIES/05_00_PHASE_SUMMARIES",
        "05_SUMMARIES/05_01_FIX_SUMMARIES",
        "05_SUMMARIES/05_99_ARCHIVE",
    ]

    for dir in dirs {
        let relative = "\(config.guidelinesPath)/\(dir)"
        let url = config.projectRoot.appendingPathComponent(relative)
        if !fileManager().fileExists(atPath: url.path) {
            try! fileManager().createDirectory(at: url, withIntermediateDirectories: true)
            // Add .gitkeep so empty dirs are tracked
            let gitkeep = url.appendingPathComponent(".gitkeep")
            fileManager().createFile(atPath: gitkeep.path, contents: nil)
        }
    }
    print("  ✓ Project directories under \(config.guidelinesPath)/ (implementation plans, checklists, summaries)")
}

// MARK: - Copy templates
//
// Templates already live inside the guidelines folder
// (`<guidelinesPath>/04_IMPLEMENTATION_CHECKLISTS/TEMPLATE.md` and
// `<guidelinesPath>/05_SUMMARIES/SESSION_SUMMARY_TEMPLATE.md`), and the
// project-state directories also live inside the guidelines folder, so
// no copying is required. This function is kept for forward
// compatibility but is intentionally a no-op.

func copyTemplates(config: Config) {
    _ = config
    print("  ⏭ Templates remain in place under \(config.guidelinesPath)/ (no copy needed)")
}

// MARK: - Main

func main() {
    let config = parseArgs()

    print("")
    print("╔══════════════════════════════════════════════════════╗")
    print("║     Development Guidelines — Claude Code Setup      ║")
    print("╠══════════════════════════════════════════════════════╣")
    print("║  Project:    \(config.projectName.padding(toLength: 38, withPad: " ", startingAt: 0)) ║")
    print("║  Guidelines: \(config.guidelinesPath.padding(toLength: 38, withPad: " ", startingAt: 0)) ║")
    print("╚══════════════════════════════════════════════════════╝")
    print("")

    // 1. CLAUDE.md
    print("Creating CLAUDE.md...")
    if fileExists(at: "CLAUDE.md", relativeTo: config.projectRoot) {
        let existing = readExisting(at: "CLAUDE.md", relativeTo: config.projectRoot) ?? ""
        if existing.contains("Development Guidelines") {
            print("  ⏭ CLAUDE.md already configured (skipping)")
        } else {
            // Prepend guidelines to existing CLAUDE.md
            let combined = generateCLAUDEmd(config) + "\n\n---\n\n" + existing
            writeFile(at: "CLAUDE.md", content: combined, relativeTo: config.projectRoot)
            print("  ↑ Prepended guidelines to existing CLAUDE.md")
        }
    } else {
        writeFile(at: "CLAUDE.md", content: generateCLAUDEmd(config), relativeTo: config.projectRoot)
    }

    // 2. .claude/rules/
    print("\nCreating .claude/rules/...")
    writeFile(at: ".claude/rules/swift-development.md",
              content: generateSwiftRules(config),
              relativeTo: config.projectRoot)

    // 3. .claude/commands/
    print("\nCreating .claude/commands/...")
    writeFile(at: ".claude/commands/design.md",
              content: generateDesignCommand(config),
              relativeTo: config.projectRoot)
    writeFile(at: ".claude/commands/recover.md",
              content: generateRecoverCommand(config),
              relativeTo: config.projectRoot)
    writeFile(at: ".claude/commands/summarize.md",
              content: generateSummarizeCommand(config),
              relativeTo: config.projectRoot)
    writeFile(at: ".claude/commands/checklist.md",
              content: generateChecklistCommand(config),
              relativeTo: config.projectRoot)

    // 4. .claude/settings.json (only if not present — don't overwrite team config)
    print("\nCreating .claude/settings.json...")
    if fileExists(at: ".claude/settings.json", relativeTo: config.projectRoot) {
        print("  ⏭ .claude/settings.json already exists (skipping)")
    } else {
        writeFile(at: ".claude/settings.json",
                  content: generateSettings(),
                  relativeTo: config.projectRoot)
    }

    // 5. Project scaffolding directories
    print("\nCreating project directories...")
    ensureProjectDirectories(config: config)

    // 6. Copy templates from guidelines
    print("\nCopying templates...")
    copyTemplates(config: config)

    // 7. Gitignore
    print("\nUpdating .gitignore...")
    ensureGitignoreEntries(config: config)

    // Summary
    print("")
    print("══════════════════════════════════════════════════════")
    print("  Setup complete!")
    print("")
    print("  Generated:")
    print("    CLAUDE.md                        — AI session entry point")
    print("    .claude/rules/swift-development.md — Path-scoped Swift rules")
    print("    .claude/commands/design.md        — /project:design <feature>")
    print("    .claude/commands/recover.md       — /project:recover")
    print("    .claude/commands/summarize.md     — /project:summarize")
    print("    .claude/commands/checklist.md     — /project:checklist <feature>")
    print("    .claude/settings.json             — Default permissions")
    print("")
    print("  Commit .claude/ and CLAUDE.md to share with your team.")
    print("  Personal overrides go in .claude/settings.local.json")
    print("  and CLAUDE.local.md (both gitignored).")
    print("")
    print("  Start a session with:  claude")
    print("  Recover context with:  /project:recover")
    print("══════════════════════════════════════════════════════")
    print("")
}

main()
