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
    {
        name: "05_attack_until_win_or_lose",
        seed: 42,
        description:
            "Two-country isolated map (Atlantis ↔ Pacifica), one continent. Each player owns one country, drains their full 20 initial armies onto it, P1 spends their first 3-army income on Atlantis, then attacks Pacifica until win or lose. Exercises canAttack, attackOnce, the dice resolver, the capture sentinel, and post-capture army transfer.",
        run() {
            const duelMap: MapDefinition = {
                id: "test.duel",
                name: "Duel",
                background: "",
                baseWidth: 100,
                baseHeight: 100,
                countries: {
                    Atlantis: { id: "Atlantis", x: 0, y: 0, neighbors: ["Pacifica"] },
                    Pacifica: { id: "Pacifica", x: 0, y: 0, neighbors: ["Atlantis"] },
                },
                continents: {
                    Ocean: { id: "Ocean", armies: 0, countries: ["Atlantis", "Pacifica"] },
                },
            };
            const engine = new GameEngine({
                map: duelMap,
                players: [
                    { id: "P1", name: "Player 1", color: "#e53935", isComputer: false },
                    { id: "P2", name: "Player 2", color: "#1e88e5", isComputer: false },
                ],
                plugins: {},
                settings: { assignCountries: false },
                seed: 42,
            });
            engine.startGame();
            engine.pickCountry("P1", "Atlantis");
            engine.pickCountry("P2", "Pacifica");
            // pickCountry of the final country auto-fires donePickingCountries
            // and we are now in InitializeArmies. Drain both pools.
            for (let i = 0; i < 100; i += 1) {
                const snap = engine.getSnapshot();
                if (snap.phase !== "initializeArmies") break;
                const pid = snap.currentPlayerId;
                const player = snap.players[pid];
                const country = player.countries[0];
                engine.placeArmies(pid, country, player.unallocatedArmies);
            }
            // Now P1 is in Play / AssignArmies with 3 income.
            engine.placeArmies("P1", "Atlantis", 3);
            // placeArmies fully drains, which auto-calls startAttackPhase.
            engine.attack("Atlantis", "Pacifica", AttackMode.AttackUntilWinOrLose);
            return engine.getSnapshot();
        },
    },
    {
        name: "06_attack_once",
        seed: 42,
        description:
            "Same duel-map setup as fixture 05, but a single AttackOnce exchange instead of fighting until resolution. Verifies the .once branch: one dice exchange, no escalation, no capture (with this seed and these stacks).",
        run() {
            const duelMap: MapDefinition = {
                id: "test.duel",
                name: "Duel",
                background: "",
                baseWidth: 100,
                baseHeight: 100,
                countries: {
                    Atlantis: { id: "Atlantis", x: 0, y: 0, neighbors: ["Pacifica"] },
                    Pacifica: { id: "Pacifica", x: 0, y: 0, neighbors: ["Atlantis"] },
                },
                continents: {
                    Ocean: { id: "Ocean", armies: 0, countries: ["Atlantis", "Pacifica"] },
                },
            };
            const engine = new GameEngine({
                map: duelMap,
                players: [
                    { id: "P1", name: "Player 1", color: "#e53935", isComputer: false },
                    { id: "P2", name: "Player 2", color: "#1e88e5", isComputer: false },
                ],
                plugins: {},
                settings: { assignCountries: false },
                seed: 42,
            });
            engine.startGame();
            engine.pickCountry("P1", "Atlantis");
            engine.pickCountry("P2", "Pacifica");
            for (let i = 0; i < 100; i += 1) {
                const snap = engine.getSnapshot();
                if (snap.phase !== "initializeArmies") break;
                const pid = snap.currentPlayerId;
                const player = snap.players[pid];
                engine.placeArmies(pid, player.countries[0], player.unallocatedArmies);
            }
            engine.placeArmies("P1", "Atlantis", 3);
            engine.attack("Atlantis", "Pacifica", AttackMode.AttackOnce);
            return engine.getSnapshot();
        },
    },
    {
        name: "07_attack_until_losses_exceed",
        seed: 42,
        description:
            "Same duel-map setup as fixture 05, but using AttackUntilLossesExceed mode with the default lossesExceedValue=5. Verifies the loop bound: attack repeats until cumulative attacker losses cross the threshold (or the fight ends).",
        run() {
            const duelMap: MapDefinition = {
                id: "test.duel",
                name: "Duel",
                background: "",
                baseWidth: 100,
                baseHeight: 100,
                countries: {
                    Atlantis: { id: "Atlantis", x: 0, y: 0, neighbors: ["Pacifica"] },
                    Pacifica: { id: "Pacifica", x: 0, y: 0, neighbors: ["Atlantis"] },
                },
                continents: {
                    Ocean: { id: "Ocean", armies: 0, countries: ["Atlantis", "Pacifica"] },
                },
            };
            const engine = new GameEngine({
                map: duelMap,
                players: [
                    { id: "P1", name: "Player 1", color: "#e53935", isComputer: false },
                    { id: "P2", name: "Player 2", color: "#1e88e5", isComputer: false },
                ],
                plugins: {},
                settings: { assignCountries: false },
                seed: 42,
            });
            engine.startGame();
            engine.pickCountry("P1", "Atlantis");
            engine.pickCountry("P2", "Pacifica");
            for (let i = 0; i < 100; i += 1) {
                const snap = engine.getSnapshot();
                if (snap.phase !== "initializeArmies") break;
                const pid = snap.currentPlayerId;
                const player = snap.players[pid];
                engine.placeArmies(pid, player.countries[0], player.unallocatedArmies);
            }
            engine.placeArmies("P1", "Atlantis", 3);
            engine.attack("Atlantis", "Pacifica", AttackMode.AttackUntilLossesExceed);
            return engine.getSnapshot();
        },
    },
    {
        name: "08_fortify_adjacent_with_tired_sentinel",
        seed: 42,
        description:
            "Three-country linear map (North ↔ Middle ↔ South). P1 owns North + Middle (adjacent), P2 owns South. After init, P1 dumps everything on North, finishes the attack phase without attacking, beginFortifyFrom(North), then fortifies all movable armies onto Middle. Exercises finishAttackPhase, beginFortifyFrom (movable = armies - max(tired,0)), placeArmies in Fortify (tiredArmies += actual, starting from the -1 sentinel), and the post-fortify runtime clear.",
        run() {
            const lineMap: MapDefinition = {
                id: "test.line",
                name: "Line",
                background: "",
                baseWidth: 100,
                baseHeight: 100,
                countries: {
                    North: { id: "North", x: 0, y: 0, neighbors: ["Middle"] },
                    Middle: { id: "Middle", x: 0, y: 0, neighbors: ["North", "South"] },
                    South: { id: "South", x: 0, y: 0, neighbors: ["Middle"] },
                },
                continents: {
                    Land: { id: "Land", armies: 0, countries: ["North", "Middle", "South"] },
                },
            };
            const engine = new GameEngine({
                map: lineMap,
                players: [
                    { id: "P1", name: "Player 1", color: "#e53935", isComputer: false },
                    { id: "P2", name: "Player 2", color: "#1e88e5", isComputer: false },
                ],
                plugins: {},
                settings: { assignCountries: false },
                seed: 42,
            });
            engine.startGame();
            engine.pickCountry("P1", "North");
            engine.pickCountry("P2", "South");
            engine.pickCountry("P1", "Middle");
            // donePickingCountries fires on the third pick.
            // Drain init (drip-fed alternating). Each player dumps onto their first owned country.
            for (let i = 0; i < 100; i += 1) {
                const snap = engine.getSnapshot();
                if (snap.phase !== "initializeArmies") break;
                const pid = snap.currentPlayerId;
                const player = snap.players[pid];
                engine.placeArmies(pid, player.countries[0], player.unallocatedArmies);
            }
            // P1 in AssignArmies with income = 3 (count<9). Pile onto North.
            engine.placeArmies("P1", "North", 3);
            // placeArmies drained → startAttackPhase fired automatically.
            engine.finishAttackPhase();
            // Now in Fortify. Begin from North.
            engine.beginFortifyFrom("North");
            // All movable armies are now in P1.unallocatedArmies. Dump onto Middle.
            const midSnap = engine.getSnapshot();
            engine.placeArmies("P1", "Middle", midSnap.players.P1.unallocatedArmies);
            return engine.getSnapshot();
        },
    },
    {
        name: "09_card_draw_on_conquest",
        seed: 42,
        description:
            "Three-country line map (North ↔ Middle ↔ South). P1 owns North, P2 owns Middle + South. After init, P1 piles 3 income on North and attacks Middle untilWinOrLose. With this seed P1 captures Middle. P2 still alive (owns South), so no victory. Then finishTurn() — P1 has hasWonThisTurn=true so the engine draws one card from the top of the draw pile and pushes it onto P1's hand. Snapshot at the end of P1's turn (engine has rotated to P2 and granted P2 the first reinforcement income).",
        run() {
            const lineMap: MapDefinition = {
                id: "test.line",
                name: "Line",
                background: "",
                baseWidth: 100,
                baseHeight: 100,
                countries: {
                    North: { id: "North", x: 0, y: 0, neighbors: ["Middle"] },
                    Middle: { id: "Middle", x: 0, y: 0, neighbors: ["North", "South"] },
                    South: { id: "South", x: 0, y: 0, neighbors: ["Middle"] },
                },
                continents: {
                    Land: { id: "Land", armies: 0, countries: ["North", "Middle", "South"] },
                },
            };
            const engine = new GameEngine({
                map: lineMap,
                players: [
                    { id: "P1", name: "Player 1", color: "#e53935", isComputer: false },
                    { id: "P2", name: "Player 2", color: "#1e88e5", isComputer: false },
                ],
                plugins: {},
                settings: { assignCountries: false },
                seed: 42,
            });
            engine.startGame();
            engine.pickCountry("P1", "North");
            engine.pickCountry("P2", "Middle");
            engine.pickCountry("P2", "South");
            for (let i = 0; i < 100; i += 1) {
                const snap = engine.getSnapshot();
                if (snap.phase !== "initializeArmies") break;
                const pid = snap.currentPlayerId;
                const player = snap.players[pid];
                engine.placeArmies(pid, player.countries[0], player.unallocatedArmies);
            }
            engine.placeArmies("P1", "North", 3);
            engine.attack("North", "Middle", AttackMode.AttackUntilWinOrLose);
            engine.finishTurn();
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
