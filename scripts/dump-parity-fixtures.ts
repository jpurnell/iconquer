// dump-parity-fixtures.ts
//
// Drives the TypeScript reference engine through scripted scenarios under
// fixed seeds and writes deterministic JSON snapshots to
// ../IconquerCore/Tests/IconquerCoreTests/ParityFixtures/.
//
// The Swift port's parity tests will load these same fixtures and assert
// byte-for-byte equivalence after running the same scripted scenario
// through the Swift Game type.
//
// Usage:
//   npm run dump-fixtures
//
// Determinism contract:
//   - All map data loaded from disk (not over the network)
//   - All RNG seeded explicitly per scenario
//   - JSON output uses sorted keys so dictionary iteration order does not
//     leak into the fixture bytes

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GameEngine } from "../src/core/game.js";
import { AttackMode, type GameSnapshot, type MapDefinition } from "../src/types/game.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const MAP_DIR = join(REPO_ROOT, "public", "maps", "iconquer-world");
const OUTPUT_DIR = join(
    REPO_ROOT,
    "..",
    "IconquerCore",
    "Tests",
    "IconquerCoreTests",
    "ParityFixtures"
);

// ─── Map loader ─────────────────────────────────────────────────────────────
//
// Reads Countries.json and Continents.json from disk and assembles the same
// MapDefinition shape that src/plugins/maps/world.ts produces over fetch().

interface CountriesRaw {
    [key: string]: {
        x: number;
        y: number;
        width?: number;
        height?: number;
        dotOffsetX?: number;
        dotOffsetY?: number;
        neighbors: string[];
    };
}
interface ContinentsRaw {
    [key: string]: { armies: number; countries: string[] };
}

function loadWorldMap(): MapDefinition {
    const countriesRaw = JSON.parse(
        readFileSync(join(MAP_DIR, "Countries.json"), "utf8")
    ) as CountriesRaw;
    const continentsRaw = JSON.parse(
        readFileSync(join(MAP_DIR, "Continents.json"), "utf8")
    ) as ContinentsRaw;

    const countries: MapDefinition["countries"] = {};
    for (const [name, value] of Object.entries(countriesRaw)) {
        countries[name] = {
            id: name,
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
            dotOffsetX: value.dotOffsetX,
            dotOffsetY: value.dotOffsetY,
            neighbors: value.neighbors,
        };
    }

    const continents: MapDefinition["continents"] = {};
    for (const [name, value] of Object.entries(continentsRaw)) {
        continents[name] = {
            id: name,
            armies: value.armies,
            countries: value.countries,
        };
    }

    return {
        id: "com.kavasoft.iConquer.maps.world.hd",
        name: "iConquer World",
        background: "/maps/iconquer-world/Background.jpg",
        baseWidth: 1820,
        baseHeight: 950,
        countries,
        continents,
    };
}

// ─── Deterministic JSON ─────────────────────────────────────────────────────
//
// JSON.stringify preserves insertion order for plain objects, but the engine
// builds players/countries dictionaries via Object.fromEntries on Map
// iteration order. To prevent dictionary iteration order leaking into the
// fixture bytes, we recursively sort object keys before serializing.
//
// Arrays are NEVER reordered (their order is part of the semantics — e.g.
// player turn order, card piles).

function sortKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeysDeep);
    }
    if (value !== null && typeof value === "object") {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as object).sort()) {
            sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        }
        return sorted;
    }
    return value;
}

function deterministicStringify(snapshot: GameSnapshot): string {
    return JSON.stringify(sortKeysDeep(snapshot), null, 2) + "\n";
}

// ─── Scenario runner ────────────────────────────────────────────────────────

interface Scenario {
    name: string;
    seed: number;
    description: string;
    run(map: MapDefinition): GameSnapshot;
}

const SCENARIOS: Scenario[] = [
    {
        name: "01_start_no_assign",
        seed: 42,
        description:
            "New game with assignCountries=false. Phase should be PickCountries; no countries owned; no armies placed.",
        run(map) {
            const engine = new GameEngine({
                map,
                players: [
                    { id: "P1", name: "Player 1", color: "#e53935", isComputer: false },
                    { id: "P2", name: "Player 2", color: "#1e88e5", isComputer: false },
                    { id: "P3", name: "Player 3", color: "#43a047", isComputer: false },
                ],
                plugins: {},
                settings: { assignCountries: false },
                seed: 42,
            });
            engine.startGame();
            return engine.getSnapshot();
        },
    },
    {
        name: "02_start_random_assign",
        seed: 42,
        description:
            "New game with assignCountries=true (default) and seed=42. The 42 countries should be deterministically distributed via the mulberry32 shuffle. After distribution the engine immediately advances to InitializeArmies and grants player 0 their first 5-army drip.",
        run(map) {
            const engine = new GameEngine({
                map,
                players: [
                    { id: "P1", name: "Player 1", color: "#e53935", isComputer: false },
                    { id: "P2", name: "Player 2", color: "#1e88e5", isComputer: false },
                    { id: "P3", name: "Player 3", color: "#43a047", isComputer: false },
                ],
                plugins: {},
                seed: 42,
            });
            engine.startGame();
            return engine.getSnapshot();
        },
    },
    {
        name: "03_initialize_armies_first_drip",
        seed: 42,
        description:
            "After random distribution, place player 0's full first drip (5 armies) onto the player's first owned country, then snapshot. Verifies placeArmies → advanceInitializationTurn transition.",
        run(map) {
            const engine = new GameEngine({
                map,
                players: [
                    { id: "P1", name: "Player 1", color: "#e53935", isComputer: false },
                    { id: "P2", name: "Player 2", color: "#1e88e5", isComputer: false },
                    { id: "P3", name: "Player 3", color: "#43a047", isComputer: false },
                ],
                plugins: {},
                seed: 42,
            });
            engine.startGame();
            // After startGame the current player has 5 unallocatedArmies
            // (the first drip). Place all 5 on their first owned country.
            const snap = engine.getSnapshot();
            const currentPlayerId = snap.currentPlayerId;
            const firstCountry = snap.players[currentPlayerId].countries[0];
            engine.placeArmies(currentPlayerId, firstCountry, 5);
            return engine.getSnapshot();
        },
    },
    {
        name: "04_initialize_armies_complete",
        seed: 42,
        description:
            "Drain every player's full 20 initial armies onto each player's first owned country. After the final drip the engine should advance from InitializeArmies into Play, set turnPhase=AssignArmies, and grant the first reinforcement income to player 0. Exercises the Play branch of beginTurnIfReady and incomeForCountries (the count<9?3:floor/3 quirk plus continent bonuses).",
        run(map) {
            const engine = new GameEngine({
                map,
                players: [
                    { id: "P1", name: "Player 1", color: "#e53935", isComputer: false },
                    { id: "P2", name: "Player 2", color: "#1e88e5", isComputer: false },
                    { id: "P3", name: "Player 3", color: "#43a047", isComputer: false },
                ],
                plugins: {},
                seed: 42,
            });
            engine.startGame();
            // Drip-fed allocation: each placeArmies() call dumps the full
            // current drip onto the player's first owned country, which
            // triggers advanceInitializationTurn() → next player → next
            // drip. Loop until we transition out of InitializeArmies.
            //
            // Hard cap iterations so a bug can't loop forever: with 3
            // players × 20 armies × 5/drip we expect exactly 12 calls.
            for (let i = 0; i < 100; i += 1) {
                const snap = engine.getSnapshot();
                if (snap.phase !== "initializeArmies") break;
                const pid = snap.currentPlayerId;
                const player = snap.players[pid];
                const country = player.countries[0];
                engine.placeArmies(pid, country, player.unallocatedArmies);
            }
            return engine.getSnapshot();
        },
    },
];

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const map = loadWorldMap();

    let dumped = 0;
    for (const scenario of SCENARIOS) {
        const snapshot = scenario.run(map);
        const json = deterministicStringify(snapshot);
        const outPath = join(OUTPUT_DIR, `${scenario.name}.json`);
        writeFileSync(outPath, json, "utf8");
        console.log(`  ✓ ${scenario.name}.json (${json.length} bytes)`);
        dumped += 1;
    }

    console.log(`\nDumped ${dumped} fixture(s) to:\n  ${OUTPUT_DIR}`);
}

main();
