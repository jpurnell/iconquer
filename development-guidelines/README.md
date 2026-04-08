# Development Guidelines - AI Assistant Instruction Set

**Purpose:** Reusable template for guiding AI assistants (Claude, etc.) in software development projects.

**How to Use:** Fork or copy this repository, then customize the `[PROJECT_NAME]` placeholders and project-specific content for your project.

---

## Quick Start

1. **Clone this repo** into your project:
   ```bash
   cd ~/Projects/MyProject
   git clone https://github.com/jpurnell/development-guidelines.git
   ```
2. **Run the setup script** to generate the `.claude/` bridge layer and project scaffolding:
   ```bash
   swift development-guidelines/setup.swift
   ```
3. **Replace `[PROJECT_NAME]`** placeholders in `00_CORE_RULES/00_MASTER_PLAN.md` with your project name
4. **Customize `00_CORE_RULES/`** for your project's specific standards
5. **Commit** the generated files (`.claude/`, `CLAUDE.md`, project directories)

The setup script creates:
- `CLAUDE.md` — AI session entry point with read order and key rules (project root)
- `.claude/rules/` — Path-scoped Swift development rules (project root)
- `.claude/commands/` — Workflow commands `/project:design`, `/project:recover`, `/project:summarize`, `/project:checklist` (project root)
- `.claude/settings.json` — Default permissions for Swift development (project root)
- **Project-state directories scaffolded *inside* `development-guidelines/`** — `02_IMPLEMENTATION_PLANS/`, `04_IMPLEMENTATION_CHECKLISTS/`, `05_SUMMARIES/`. Keeping them inside the cloned guidelines folder means they sit within that folder's git boundary and don't pollute the outer project's working tree. Templates (`TEMPLATE.md`, `SESSION_SUMMARY_TEMPLATE.md`) already live in those folders, so no copying is needed.

Only `.claude/` and `CLAUDE.md` are written to the project root because those are conventions Claude Code expects there.

---

## Folder Organization

### 00_CORE_RULES - **Read First, Reference Always**
Fundamental rules, guidelines, and standards that govern all development work.

| File | Purpose |
|------|---------|
| `00_MASTER_PLAN.md` | Project vision and architecture |
| `01_CODING_RULES.md` | Code style, patterns, and standards |
| `02_USAGE_EXAMPLES.md` | API usage patterns and examples |
| `03_DOCC_GUIDELINES.md` | Documentation standards (DocC) |
| `05_DESIGN_PROPOSAL.md` | Architecture validation before coding |
| `07_SESSION_WORKFLOW.md` | **Context recovery and session protocols** |
| `08_FLOATING_POINT_FORMATTING.md` | Number formatting standards |
| `09_TEST_DRIVEN_DEVELOPMENT.md` | TDD approach and testing contract |
| `10_APPLICATION_TESTING_PATTERNS.md` | Integration, E2E, benchmarks, and test metrics |
| `PERFORMANCE.md` | Performance guidelines |
| `RELEASE_CHECKLIST.md` | Release verification checklist |
| `TESTING.md` | Testing strategy |

### 01_ROADMAPS - **Strategic Planning**
Long-term strategic plans and phase roadmaps.

### 02_IMPLEMENTATION_PLANS - **Tactical Implementation**
Detailed implementation plans organized by status:
- `PROPOSALS/` - Drafted but not-yet-approved design proposals
- `UPCOMING/` - Approved work ready for implementation
- `COMPLETED/` - Past implementations (for reference)
- `MIGRATIONS/` - Migration guides
  - `02_99_ARCHIVE/` Maintenance folder

### 03_STRATEGIES_AND_FRAMEWORKS - **High-Level Guidance**
Strategic documents for product direction and architecture.

### 04_IMPLEMENTATION_CHECKLISTS - **Task Tracking**
Per-feature implementation checklists using Design-First TDD workflow.
- `TEMPLATE.md` - Checklist template for new features
- `CURRENT_*.md` - Active feature checklists
- `04_99_COMPLETED/` - Archived shipped features
- `04_99_BLOCKED/` - Parked features waiting on dependencies

### 05_SUMMARIES - **Session History**
Post-session summaries of completed work:
- `SESSION_SUMMARY_TEMPLATE.md` - **Template for session summaries**
- `05_00_PHASE_SUMMARIES/` - Phase completions
- `05_01_FIX_SUMMARIES/` - Bug fix summaries

### 06_BACKUP_FILES - **Archive**
Archived files for reference only.

### 07_LIBRARY - **Reference Materials**
Educational and reference materials (papers, tutorials, etc.)

---

## For AI Assistants (Claude, etc.)

> **📖 Full Protocol: [07_SESSION_WORKFLOW.md](00_CORE_RULES/07_SESSION_WORKFLOW.md)**

### Session Start — Context Recovery

Choose the appropriate recovery tier:

**Quick Recovery** (bug fixes, resuming same-day work):
```
1. Latest file in 05_SUMMARIES/                → Where we left off
2. 04_IMPLEMENTATION_CHECKLISTS/CURRENT_*.md   → Active tasks
```

**Full Recovery** (new sessions, complex features, after long breaks):
Read documents in this order:
```
1. 00_MASTER_PLAN.md                           → Vision and priorities
2. 01_CODING_RULES.md                          → Forbidden patterns, safety rules
3. 09_TEST_DRIVEN_DEVELOPMENT.md               → Testing contract
4. 04_IMPLEMENTATION_CHECKLISTS/CURRENT_*.md   → Current tasks
5. Latest file in 05_SUMMARIES/                → Where we left off
```

Then confirm: *"Context recovered. Current task is [X]. Ready to follow Zero Warnings Gate."*

### Development Workflow — Design-First TDD

```
0. DESIGN   → Propose architecture (see 05_DESIGN_PROPOSAL.md)
1. RED      → Write failing tests
2. GREEN    → Write minimum code to pass
3. REFACTOR → Improve code, keep tests green
4. DOCUMENT → DocC comments and examples
5. VERIFY   → Zero warnings/errors gate
```

### Session End — Handover Protocol

Before ending any session:

1. **Verify Quality Gate** — All checks pass (zero warnings, zero failures)
2. **Update State** — Move tasks in `04_IMPLEMENTATION_CHECKLISTS/CURRENT_*.md`
3. **Create Summary** — New file in `05_SUMMARIES/` with:
   - Work completed
   - Quality gate status
   - **Immediate next step** (exact starting point for next session)
   - Pending blockers

### Decision Framework

| Task Type | Reference |
|-----------|-----------|
| New Feature | `05_DESIGN_PROPOSAL.md` → `04_IMPLEMENTATION_CHECKLISTS/TEMPLATE.md` |
| Design Proposal | `05_DESIGN_PROPOSAL.md` → `02_IMPLEMENTATION_PLANS/PROPOSALS/` |
| Bug Fix | TDD approach, create summary in `05_01_FIX_SUMMARIES/` |
| Documentation | `03_DOCC_GUIDELINES.md` |
| Planning | `01_ROADMAPS/`, `02_IMPLEMENTATION_PLANS/` |
| Release | `RELEASE_CHECKLIST.md` (verification only) |

---

## Customization Guide

### Required Customizations

1. **`00_MASTER_PLAN.md`** - Replace with your project's vision and architecture
2. **`01_CODING_RULES.md`** - Adapt to your tech stack and conventions
3. **`02_USAGE_EXAMPLES.md`** - Add your project's API examples

### Optional Customizations

- Add project-specific guides to `00_CORE_RULES/`
- Create roadmaps in `01_ROADMAPS/`
- Add reference materials to `07_LIBRARY/`

---

## MCP Server (Live Guidelines)

These guidelines are served as an MCP server at `https://roseclub.org:8082/mcp`, making them queryable from any Claude Code session. The server reads files from disk on every request.

### Publishing changes

After editing any guideline files, sync them to the server:

```bash
rsync -av --exclude='.build' --exclude='.DS_Store' --exclude='.git' --exclude='BLOG_POST*' \
  ~/Dropbox/Computer/Development/Swift/Tools/development-guidelines/ \
  roseclub.org:~/development-guidelines/
```

Changes are live immediately — no rebuild or restart needed.

### When a rebuild is needed

If you add/remove documents, change the document map, or modify tool definitions, the MCP server itself needs to be rebuilt:

```bash
# Sync server source and rebuild
rsync -av --exclude='.build' --exclude='.DS_Store' \
  ~/Dropbox/Computer/Development/Swift/Tools/DevGuidelinesMCP/ \
  roseclub.org:~/DevGuidelinesMCP/

ssh roseclub.org "source ~/.swiftly/env.sh && cd ~/DevGuidelinesMCP && swift build -c release"

# Restart the service
ssh roseclub.org "launchctl stop com.roseclub.devguidelines-mcp && launchctl start com.roseclub.devguidelines-mcp"
```

### Available tools

| Tool | Purpose |
|------|---------|
| `list_documents` | Browse all guideline documents |
| `list_sections` | See H2 sections within a document |
| `get_section` | Retrieve a specific section by number or keyword |
| `search_guidelines` | Full-text search across all guidelines |
| `get_quick_reference` | Topic lookup (concurrency, testing, docc, etc.) |
| `get_workflow` | Workflow steps for new_feature, bug_fix, release, etc. |
| `get_template` | Blank templates (design_proposal, checklist, summary) |

Server source: [DevGuidelinesMCP](../DevGuidelinesMCP/)

---

## Branches

- **`main`** - Clean template with placeholders
- **`example`** - Working example (BusinessMath project) for reference

---

**Maintained By:** Justin Purnell
**Template Version:** 1.0.1
