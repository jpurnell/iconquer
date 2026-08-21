import { defaultSettings } from "./defaults";
import { Rng } from "./rng";
import {
  AttackMode,
  GamePhase,
  TurnPhase,
  type AttackResult,
  type Card,
  type CountryId,
  type CountryState,
  type GameSnapshot,
  type MapDefinition,
  type PlayerId,
  type PlayerState,
  type Settings,
} from "../types/game";
import type { PlayerPlugin } from "../plugins/players/plugin";

export interface PlayerConfig {
  id: PlayerId;
  name: string;
  color: string;
  isComputer: boolean;
  pluginId?: string;
}

interface RuntimeState {
  selectedAttackFrom: CountryId | null;
  fortifyFrom: CountryId | null;
  destinations: Set<CountryId>;
  pendingAdvance: { from: CountryId; to: CountryId } | null;
}

// Official Risk trade-in schedule: 4, 6, 8, 10, 15, 20, 25 ... then +5
// per set beyond the table. Mirrors IconquerCore's
// CardValueMode.officialProgressive.
const OFFICIAL_CARD_SCHEDULE = [4, 6, 8, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

// Sentinel suit identifying a wild card. Mirrors IconquerCore's
// Card.wildSuit.
const WILD_SUIT = -1;

// Cards required to make one trade-in set.
const CARD_SET_SIZE = 3;

// Whether `cards` form a valid trade-in set: all the same design or all
// different designs, with wilds standing in for any design. With at least
// one wild any correctly sized hand qualifies — the two remaining cards are
// either a pair or two different designs, and the wild completes either.
function isValidSet(cards: Card[], setSize: number): boolean {
  if (setSize <= 0 || cards.length !== setSize) return false;
  const suits = cards.filter((card) => card.suit !== WILD_SUIT).map((card) => card.suit);
  if (suits.length <= 1) return true;
  const distinct = new Set(suits);
  return distinct.size === 1 || distinct.size === suits.length;
}

// Whether `cards` divides cleanly into whole valid sets.
function formsValidSets(cards: Card[], setSize: number): boolean {
  if (setSize <= 0 || cards.length === 0 || cards.length % setSize !== 0) return false;
  for (let i = 0; i < cards.length; i += setSize) {
    if (!isValidSet(cards.slice(i, i + setSize), setSize)) return false;
  }
  return true;
}

// Army bonus for the nth trade-in of the game (n is 1-based).
function cardSetValue(n: number): number {
  if (n <= 0) return 0;
  const idx = n - 1;
  if (idx < OFFICIAL_CARD_SCHEDULE.length) return OFFICIAL_CARD_SCHEDULE[idx];
  return OFFICIAL_CARD_SCHEDULE[OFFICIAL_CARD_SCHEDULE.length - 1] + (idx - OFFICIAL_CARD_SCHEDULE.length + 1) * 5;
}

export class GameEngine {
  readonly map: MapDefinition;
  readonly settings: Settings;
  readonly rng: Rng;

  private phase: GamePhase = GamePhase.PickCountries;
  private turnPhase: TurnPhase = TurnPhase.Done;
  private turnNumber = 0;
  private currentPlayerIndex = 0;
  private currentCountryId: CountryId | null = null;
  private mustTurnInCards = false;
  private needsCardTurnIn = false;
  private winnerId: PlayerId | null = null;
  // Number of card sets traded in across the whole game. Drives the
  // official progressive schedule below.
  private cardSetsTurnedIn = 0;
  private conquestEvents = 0;

  private readonly playersOrder: PlayerId[];
  private readonly players = new Map<PlayerId, PlayerState>();
  private readonly countries = new Map<CountryId, CountryState>();
  private readonly runtime = new Map<PlayerId, RuntimeState>();
  private readonly plugins: Record<string, PlayerPlugin>;
  private readonly playerPluginIds = new Map<PlayerId, string>();
  private drawPile: Card[] = [];
  private discardPile: Card[] = [];

  constructor(args: {
    map: MapDefinition;
    players: PlayerConfig[];
    plugins: Record<string, PlayerPlugin>;
    settings?: Partial<Settings>;
    seed?: number;
  }) {
    this.map = args.map;
    this.settings = { ...defaultSettings, ...args.settings };
    this.rng = new Rng(args.seed);
    this.plugins = args.plugins;

    this.playersOrder = args.players.map((p) => p.id);

    for (const player of args.players) {
      if (player.pluginId) this.playerPluginIds.set(player.id, player.pluginId);
      this.players.set(player.id, {
        id: player.id,
        name: player.name,
        color: player.color,
        isComputer: player.isComputer,
        countries: [],
        cards: [],
        unallocatedInitialArmies: 20,
        unallocatedArmies: 0,
        hasWonThisTurn: false,
        victories: 0,
        defeats: 0,
      });
      this.runtime.set(player.id, {
        selectedAttackFrom: null,
        fortifyFrom: null,
        destinations: new Set(),
        pendingAdvance: null,
      });
    }

    for (const countryId of Object.keys(this.map.countries)) {
      this.countries.set(countryId, {
        id: countryId,
        ownerId: null,
        armies: 0,
        tiredArmies: -1,
        reserveArmies: 0,
        selected: false,
      });
    }

    this.initializeDeck();
  }

  startGame(): void {
    this.phase = GamePhase.PickCountries;
    this.turnPhase = TurnPhase.Done;
    this.turnNumber = 0;
    this.currentPlayerIndex = 0;
    this.winnerId = null;

    if (this.settings.assignCountries) {
      this.randomlyPickCountries();
      this.donePickingCountries();
    }
  }

  getSnapshot(): GameSnapshot {
    return {
      phase: this.phase,
      turnPhase: this.turnPhase,
      turnNumber: this.turnNumber,
      currentPlayerId: this.currentPlayerId(),
      currentCountryId: this.currentCountryId,
      countries: Object.fromEntries(this.countries.entries()),
      players: Object.fromEntries(this.players.entries()),
      winnerId: this.winnerId,
      mustTurnInCards: this.mustTurnInCards,
      needsCardTurnIn: this.needsCardTurnIn,
      cardSetsTurnedIn: this.cardSetsTurnedIn,
    };
  }

  currentPlayerId(): PlayerId {
    return this.playersOrder[this.currentPlayerIndex];
  }

  currentPlayer(): PlayerState {
    return this.player(this.currentPlayerId());
  }

  player(playerId: PlayerId): PlayerState {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Missing player ${playerId}`);
    return player;
  }

  country(countryId: CountryId): CountryState {
    const country = this.countries.get(countryId);
    if (!country) throw new Error(`Missing country ${countryId}`);
    return country;
  }

  countryIds(): CountryId[] {
    return [...this.countries.keys()];
  }

  playerCountries(playerId: PlayerId): CountryId[] {
    return this.player(playerId).countries;
  }

  neighbors(countryId: CountryId): CountryId[] {
    return this.map.countries[countryId].neighbors;
  }

  ownedNeighbors(countryId: CountryId): CountryId[] {
    const ownerId = this.country(countryId).ownerId;
    return this.neighbors(countryId).filter((n) => this.country(n).ownerId === ownerId);
  }

  enemyNeighbors(countryId: CountryId): CountryId[] {
    const ownerId = this.country(countryId).ownerId;
    return this.neighbors(countryId).filter((n) => this.country(n).ownerId !== ownerId);
  }

  canAttack(fromCountryId: CountryId, toCountryId: CountryId): boolean {
    const from = this.country(fromCountryId);
    const to = this.country(toCountryId);
    return (
      this.phase === GamePhase.Play &&
      this.turnPhase === TurnPhase.Attack &&
      from.ownerId === this.currentPlayerId() &&
      to.ownerId !== this.currentPlayerId() &&
      this.neighbors(fromCountryId).includes(toCountryId) &&
      from.armies > 0
    );
  }

  setCurrentCountry(countryId: CountryId | null): void {
    if (this.currentCountryId) this.country(this.currentCountryId).selected = false;
    this.currentCountryId = countryId;
    if (this.currentCountryId) this.country(this.currentCountryId).selected = true;
  }

  pickCountry(playerId: PlayerId, countryId: CountryId): void {
    if (this.phase !== GamePhase.PickCountries) return;
    // Claims follow the seat rotation, one country at a time, as in a
    // physical Risk setup. Without this the caller could claim for any
    // player and hand one seat a board the rules never granted it.
    if (playerId !== this.currentPlayerId()) return;
    const country = this.country(countryId);
    if (country.ownerId) return;
    this.transferCountry(countryId, playerId, false);
    // Plain +1 rotation, NOT selectNextAlivePlayer(): that one skips players
    // holding zero countries, and during PickCountries every player holds
    // zero. Using it here parks currentPlayerIndex on the first seat, which
    // let that seat claim the entire board.
    this.rotateToNextPlayer();

    if (this.countryIds().every((id) => this.country(id).ownerId !== null)) {
      this.donePickingCountries();
    }
  }

  placeArmies(playerId: PlayerId, countryId: CountryId, count: number): void {
    if (this.needsCardTurnIn) return;
    const player = this.player(playerId);
    const country = this.country(countryId);
    const runtime = this.runtime.get(playerId)!;
    if (count <= 0) return;
    if (player.unallocatedArmies <= 0) return;
    if (!runtime.destinations.has(countryId)) return;
    if (country.ownerId !== playerId) return;

    const actual = Math.min(count, player.unallocatedArmies);
    country.armies += actual;
    player.unallocatedArmies -= actual;

    if (this.turnPhase === TurnPhase.Fortify && runtime.fortifyFrom && runtime.fortifyFrom !== countryId) {
      country.tiredArmies += actual;
    }

    if (player.unallocatedArmies === 0) {
      if (this.phase === GamePhase.InitializeArmies) {
        this.advanceInitializationTurn();
      } else if (this.turnPhase === TurnPhase.AssignArmies) {
        this.startAttackPhase();
      } else if (this.turnPhase === TurnPhase.Attack && this.mustTurnInCards) {
        if (player.isComputer) {
          this.turnInCards(player.id, this.bestCardsToTurnIn(player.id).slice(0, 3));
          this.mustTurnInCards = false;
        } else {
          this.needsCardTurnIn = true;
        }
      } else if (this.turnPhase === TurnPhase.Fortify) {
        runtime.fortifyFrom = null;
        runtime.destinations = new Set();
        this.setCurrentCountry(null);
      }
    }
  }

  beginTurnIfReady(): void {
    if (this.phase === GamePhase.Victory) return;
    if (this.needsCardTurnIn) return;

    if (this.phase === GamePhase.InitializeArmies) {
      const player = this.currentPlayer();
      const runtime = this.runtime.get(player.id)!;
      runtime.destinations = new Set(player.countries);
      if (player.unallocatedArmies === 0 && player.unallocatedInitialArmies > 0) {
        player.unallocatedArmies = Math.min(5, player.unallocatedInitialArmies);
        player.unallocatedInitialArmies -= player.unallocatedArmies;
      }
      return;
    }

    if (this.phase === GamePhase.Play && this.turnPhase === TurnPhase.Done) {
      this.turnPhase = TurnPhase.AssignArmies;
      const player = this.currentPlayer();
      player.hasWonThisTurn = false;
      const runtime = this.runtime.get(player.id)!;
      runtime.selectedAttackFrom = null;
      runtime.fortifyFrom = null;
      runtime.pendingAdvance = null;
      runtime.destinations = new Set(player.countries);

      if (player.unallocatedArmies <= 0) {
        player.unallocatedArmies = this.incomeForCountries(player.countries);
      }

      if (player.cards.length > 4) {
        if (player.isComputer) {
          this.turnInCards(player.id, this.bestCardsToTurnIn(player.id).slice(0, 3));
        } else {
          this.needsCardTurnIn = true;
        }
      }
    }
  }

  resolveCardTurnIn(playerId: PlayerId, cards: Card[]): void {
    if (!this.needsCardTurnIn) return;
    if (playerId !== this.currentPlayerId()) return;
    this.turnInCards(playerId, cards);
    this.mustTurnInCards = false;
    this.needsCardTurnIn = false;
  }

  attack(fromCountryId: CountryId, toCountryId: CountryId, mode = this.settings.attacksPerClick): AttackResult {
    if (this.needsCardTurnIn) {
      return { conquered: false, attackerLosses: 0, defenderLosses: 0 };
    }
    if (!this.canAttack(fromCountryId, toCountryId)) {
      return { conquered: false, attackerLosses: 0, defenderLosses: 0 };
    }

    this.setCurrentCountry(fromCountryId);
    const attacker = this.country(fromCountryId);
    const defender = this.country(toCountryId);
    const attackerPlayerId = attacker.ownerId!;
    const defenderPlayerId = defender.ownerId!;
    let attackerLosses = 0;
    let defenderLosses = 0;

    if (mode === AttackMode.AttackOnce) {
      const r = this.attackOnce(attacker, defender);
      attackerLosses += r.attackerLosses;
      defenderLosses += r.defenderLosses;
    } else if (mode === AttackMode.AttackUntilLossesExceed) {
      while (
        attacker.armies > 0 &&
        defender.armies > -1 &&
        attackerLosses < this.settings.lossesExceedValue
      ) {
        const r = this.attackOnce(attacker, defender);
        attackerLosses += r.attackerLosses;
        defenderLosses += r.defenderLosses;
      }
    } else {
      while (attacker.armies > 0 && defender.armies > -1) {
        const r = this.attackOnce(attacker, defender);
        attackerLosses += r.attackerLosses;
        defenderLosses += r.defenderLosses;
      }
    }

    let eliminatedPlayerId: PlayerId | undefined;

    if (defender.armies < 0) {
      const diceToRoll = this.settings.diceToRoll;
      const armiesToMove = this.settings.advanceArmies || attacker.armies < diceToRoll ? attacker.armies : diceToRoll;

      this.transferCountry(toCountryId, attackerPlayerId, true);
      attacker.armies -= armiesToMove;
      defender.armies = armiesToMove - 1;
      this.conquestEvents += 1;
      this.runtime.get(attackerPlayerId)!.selectedAttackFrom = toCountryId;
      this.setCurrentCountry(toCountryId);

      const defenderPlayer = this.player(defenderPlayerId);
      if (defenderPlayer.countries.length === 0) {
        eliminatedPlayerId = defenderPlayerId;
        this.takeCards(attackerPlayerId, defenderPlayerId);
        this.removePlayer(defenderPlayerId);

        const attackerPlayer = this.player(attackerPlayerId);
        if (this.settings.allowTurningInCards && attackerPlayer.cards.length > 4) {
          this.mustTurnInCards = true;
        }
      }

      if (this.playersOrder.length === 1) {
        this.phase = GamePhase.Victory;
        this.winnerId = attackerPlayerId;
      } else {
        this.currentPlayer().hasWonThisTurn = true;
        this.startAdvanceArmies(attackerPlayerId, fromCountryId, toCountryId);
        if (!this.currentPlayer().isComputer) {
          const player = this.currentPlayer();
          this.placeArmies(player.id, toCountryId, player.unallocatedArmies);
          if (this.mustTurnInCards && player.cards.length > 4) {
            this.needsCardTurnIn = true;
          }
        }
      }
    } else if (attacker.armies === 0) {
      this.setCurrentCountry(null);
    }

    return {
      conquered: defender.armies >= 0 ? false : true,
      attackerLosses,
      defenderLosses,
      eliminatedPlayerId,
    };
  }

  finishAttackPhase(): void {
    if (this.needsCardTurnIn) return;
    if (this.phase !== GamePhase.Play || this.turnPhase !== TurnPhase.Attack) return;
    this.turnPhase = TurnPhase.Fortify;
    this.setCurrentCountry(null);
    const runtime = this.runtime.get(this.currentPlayerId())!;
    runtime.fortifyFrom = null;
    runtime.destinations = new Set();
  }

  beginFortifyFrom(countryId: CountryId): void {
    if (this.needsCardTurnIn) return;
    if (this.turnPhase !== TurnPhase.Fortify) return;
    const playerId = this.currentPlayerId();
    const country = this.country(countryId);
    if (country.ownerId !== playerId) return;

    // A territory always keeps a garrison of at least one army, as in
    // official Risk. `tiredArmies` can be 0 (or the -1 sentinel), so the
    // floor of 1 is what stops a fortify from emptying the origin.
    const tired = Math.max(country.tiredArmies, 0);
    const garrison = Math.max(tired, 1);
    const movable = country.armies - garrison;
    if (movable <= 0) return;

    const runtime = this.runtime.get(playerId)!;
    runtime.fortifyFrom = countryId;
    runtime.destinations = new Set([countryId, ...this.ownedNeighbors(countryId)]);

    const player = this.player(playerId);
    player.unallocatedArmies = movable;
    country.armies = garrison;
    this.setCurrentCountry(countryId);
  }

  finishTurn(): void {
    if (this.needsCardTurnIn) return;
    if (this.phase !== GamePhase.Play) return;
    const currentPlayer = this.currentPlayer();

    for (const countryId of currentPlayer.countries) {
      this.country(countryId).tiredArmies = -1;
    }

    if (currentPlayer.hasWonThisTurn) {
      const card = this.takeCard();
      if (card) currentPlayer.cards.push(card);
    }

    const nextBeforeWrap = this.findNextAlivePlayerIndex(this.currentPlayerIndex);
    if (nextBeforeWrap <= this.currentPlayerIndex) {
      this.turnNumber += 1;
    }

    this.currentPlayerIndex = nextBeforeWrap;
    this.turnPhase = TurnPhase.Done;
    this.setCurrentCountry(null);
    this.beginTurnIfReady();
  }

  stepAiTurn(): { pending: boolean; conquestOccurred: boolean } {
    let conquestOccurred = false;
    while (this.phase !== GamePhase.Victory) {
      this.beginTurnIfReady();
      const player = this.currentPlayer();
      if (!player.isComputer) return { pending: false, conquestOccurred };

      const pluginId = this.findPluginIdForPlayer(player.id);
      const plugin = this.plugins[pluginId];
      if (!plugin) throw new Error(`Missing plugin ${pluginId}`);

      const conquestsBefore = this.conquestEvents;
      if (this.phase === GamePhase.PickCountries) {
        plugin.runPickCountry(this, player.id);
      } else if (this.phase === GamePhase.InitializeArmies) {
        plugin.runAssignInitialArmies(this, player.id);
      } else if (this.phase === GamePhase.Play) {
        if (this.mustTurnInCards && player.cards.length > 4) {
          plugin.runAssignArmiesFromConquer(this, player.id);
        }

        if (this.turnPhase === TurnPhase.AssignArmies) {
          plugin.runAssignArmiesFromIncome(this, player.id);
        }
        if (this.turnPhase === TurnPhase.Attack) {
          plugin.runAttack(this, player.id);
        }
        if (this.turnPhase === TurnPhase.Fortify) {
          plugin.runFortify(this, player.id);
        }
      }
      conquestOccurred = conquestOccurred || this.conquestEvents > conquestsBefore;

      if (!this.currentPlayer().isComputer) {
        return { pending: false, conquestOccurred };
      }
      if (conquestOccurred) {
        return { pending: true, conquestOccurred: true };
      }

      if (this.phase === GamePhase.Play && this.turnPhase === TurnPhase.Done) {
        continue;
      }
      if (this.phase === GamePhase.InitializeArmies || this.phase === GamePhase.PickCountries) {
        continue;
      }
      return { pending: this.currentPlayer().isComputer, conquestOccurred };
    }
    return { pending: false, conquestOccurred };
  }

  startAttackPhase(): void {
    if (this.phase !== GamePhase.Play) return;
    this.turnPhase = TurnPhase.Attack;
    this.currentPlayer().unallocatedArmies = 0;
    this.runtime.get(this.currentPlayerId())!.destinations = new Set();
  }

  incomeForCountries(countryIds: CountryId[]): number {
    const count = countryIds.length;
    if (count === 0) return 0;
    let income = count < 9 ? 3 : Math.floor(count / 3);

    for (const continent of Object.values(this.map.continents)) {
      if (continent.countries.every((id) => countryIds.includes(id))) {
        income += continent.armies;
      }
    }
    return income;
  }

  bestCardsToTurnIn(playerId: PlayerId): Card[] {
    const cards = [...this.player(playerId).cards];
    const soldiers: Card[] = [];
    const cannons: Card[] = [];
    const horses: Card[] = [];
    const wilds: Card[] = [];

    for (const card of cards) {
      const owned = card.countryId ? this.country(card.countryId).ownerId === playerId : false;
      const push = (arr: Card[]): void => {
        if (owned) arr.unshift(card);
        else arr.push(card);
      };
      if (card.suit === 0) push(soldiers);
      else if (card.suit === 1) push(cannons);
      else if (card.suit === 2) push(horses);
      else push(wilds);
    }

    const unmatched = [...soldiers, ...cannons, ...horses];
    const best: Card[] = [];

    while (true) {
      const sameCount = Math.floor(soldiers.length / 3) + Math.floor(cannons.length / 3) + Math.floor(horses.length / 3);
      const differentCount = Math.min(soldiers.length, cannons.length, horses.length);

      if (differentCount > 0 && differentCount > sameCount) {
        const set = [soldiers.shift()!, cannons.shift()!, horses.shift()!];
        best.push(...set);
        for (const card of set) {
          const idx = unmatched.indexOf(card);
          if (idx >= 0) unmatched.splice(idx, 1);
        }
      } else if (soldiers.length > 2) {
        const set = soldiers.splice(0, 3);
        best.push(...set);
        for (const card of set) unmatched.splice(unmatched.indexOf(card), 1);
      } else if (cannons.length > 2) {
        const set = cannons.splice(0, 3);
        best.push(...set);
        for (const card of set) unmatched.splice(unmatched.indexOf(card), 1);
      } else if (horses.length > 2) {
        const set = horses.splice(0, 3);
        best.push(...set);
        for (const card of set) unmatched.splice(unmatched.indexOf(card), 1);
      } else if (wilds.length > 0 && unmatched.length > 1) {
        best.push(wilds.shift()!, unmatched.shift()!, unmatched.shift()!);
      } else if (wilds.length > 1 && unmatched.length > 0) {
        best.push(unmatched.shift()!, wilds.shift()!, wilds.shift()!);
      } else if (wilds.length > 2) {
        best.push(wilds.shift()!, wilds.shift()!, wilds.shift()!);
      } else {
        break;
      }
    }

    return best;
  }

  turnInCards(playerId: PlayerId, cards: Card[]): void {
    if (!cards.length) return;
    // Three of a kind, one of each, or a wild standing in for either — and
    // whole sets only. The old count-of-three loop paid out for any three
    // cards, and dropped the fourth card of a four-card hand while paying
    // for one set.
    if (!formsValidSets(cards, CARD_SET_SIZE)) return;
    const player = this.player(playerId);

    for (let i = 0; i < Math.floor(cards.length / CARD_SET_SIZE); i += 1) {
      this.cardSetsTurnedIn += 1;
      player.unallocatedArmies += cardSetValue(this.cardSetsTurnedIn);
    }

    for (const card of cards) {
      if (card.countryId && this.country(card.countryId).ownerId === playerId) {
        this.country(card.countryId).armies += 2;
      }
    }

    player.cards = player.cards.filter((card) => !cards.includes(card));
    this.discardPile.push(...cards);
  }

  randomOwnedCountry(playerId: PlayerId): CountryId | null {
    const owned = this.player(playerId).countries;
    return owned.length ? this.rng.pick(owned) : null;
  }

  mostVulnerableNeighbor(countryId: CountryId): CountryId | null {
    const enemies = this.enemyNeighbors(countryId);
    if (!enemies.length) return null;
    let best = enemies[0];
    for (const enemy of enemies.slice(1)) {
      if (this.country(enemy).armies < this.country(best).armies) best = enemy;
    }
    return best;
  }

  threat(countryId: CountryId): number {
    const country = this.country(countryId);
    const enemies = this.enemyNeighbors(countryId);
    if (!enemies.length) return -10000;
    return enemies.reduce((sum, enemyId) => sum + this.country(enemyId).armies + 1, -country.armies);
  }

  updateReserveArmies(playerId: PlayerId, reserveFactor: number): void {
    for (const countryId of this.playerCountries(playerId)) {
      const country = this.country(countryId);
      country.reserveArmies = Math.floor(country.armies * reserveFactor);
    }
  }

  attackRandomCountries(playerId: PlayerId): boolean {
    for (const countryId of this.playerCountries(playerId)) {
      const country = this.country(countryId);
      const target = this.enemyNeighbors(countryId);
      if (!target.length) continue;
      if (country.armies <= country.reserveArmies) continue;

      let attackCount = country.armies;
      while (country.armies > country.reserveArmies && attackCount > 0) {
        const victim = this.rng.pick(target);
        const result = this.attack(countryId, victim, AttackMode.AttackOnce);
        if (result.conquered) return false;
        attackCount -= 1;
      }
    }
    return true;
  }

  attackVulnerableCountries(playerId: PlayerId): boolean {
    for (const countryId of this.playerCountries(playerId)) {
      const country = this.country(countryId);
      const target = this.mostVulnerableNeighbor(countryId);
      if (!target) continue;
      if (country.armies <= country.reserveArmies) continue;

      let attackCount = country.armies;
      while (country.armies > country.reserveArmies && attackCount > 0) {
        const result = this.attack(countryId, target, AttackMode.AttackOnce);
        if (result.conquered) return false;
        attackCount -= 1;
      }
    }
    return true;
  }

  fortifyVulnerableCountries(playerId: PlayerId): void {
    for (const countryId of this.playerCountries(playerId)) {
      const neighbors = this.ownedNeighbors(countryId);
      const country = this.country(countryId);
      if (neighbors.length === 0 || country.armies <= Math.max(country.tiredArmies, 0)) continue;
      this.beginFortifyFrom(countryId);
      const player = this.player(playerId);
      const destinations = neighbors.sort((a, b) => this.threat(b) - this.threat(a));
      if (destinations.length) {
        this.placeArmies(playerId, destinations[0], player.unallocatedArmies);
      }
    }

    if (this.turnPhase === TurnPhase.Fortify) this.finishTurn();
  }

  allocateArmiesRandomly(playerId: PlayerId): void {
    const player = this.player(playerId);
    const runtime = this.runtime.get(playerId)!;
    if (runtime.destinations.size === 0) {
      player.unallocatedArmies = 0;
      this.advanceAfterAllocationDepleted(playerId);
      return;
    }
    while (player.unallocatedArmies > 0) {
      const destination = this.rng.pick([...runtime.destinations]);
      this.placeArmies(playerId, destination, 1);
    }
  }

  allocateArmiesToMostThreatened(playerId: PlayerId, randomNearEnd = false): void {
    const player = this.player(playerId);
    const runtime = this.runtime.get(playerId)!;
    if (runtime.destinations.size === 0) {
      player.unallocatedArmies = 0;
      this.advanceAfterAllocationDepleted(playerId);
      return;
    }
    while (player.unallocatedArmies > 0) {
      const ranked = [...runtime.destinations].sort((a, b) => this.threat(a) - this.threat(b));
      if (ranked.length === 0) {
        player.unallocatedArmies = 0;
        this.advanceAfterAllocationDepleted(playerId);
        return;
      }
      const index = randomNearEnd ? Math.max(0, ranked.length - 1 - this.rng.int(Math.min(3, ranked.length))) : ranked.length - 1;
      this.placeArmies(playerId, ranked[index], 1);
    }
  }

  attackUntilWinOrLose(fromCountryId: CountryId, toCountryId: CountryId): boolean {
    const result = this.attack(fromCountryId, toCountryId, AttackMode.AttackUntilWinOrLose);
    return result.conquered;
  }

  pickRandomUnownedCountry(): CountryId | null {
    const available = this.countryIds().filter((id) => this.country(id).ownerId === null);
    return available.length ? this.rng.pick(available) : null;
  }

  humanClickCountry(countryId: CountryId): void {
    if (this.needsCardTurnIn) return;
    const playerId = this.currentPlayerId();
    const player = this.currentPlayer();
    const country = this.country(countryId);

    if (this.phase === GamePhase.PickCountries) {
      this.pickCountry(playerId, countryId);
      return;
    }

    if (this.phase === GamePhase.InitializeArmies || this.turnPhase === TurnPhase.AssignArmies) {
      this.placeArmies(playerId, countryId, 1);
      return;
    }

    if (this.turnPhase === TurnPhase.Attack) {
      const runtime = this.runtime.get(playerId)!;
      if (country.ownerId === playerId) {
        runtime.selectedAttackFrom = countryId;
        this.setCurrentCountry(countryId);
      } else if (runtime.selectedAttackFrom && this.canAttack(runtime.selectedAttackFrom, countryId)) {
        this.attack(runtime.selectedAttackFrom, countryId, this.settings.attacksPerClick);
      }
      return;
    }

    if (this.turnPhase === TurnPhase.Fortify) {
      const runtime = this.runtime.get(playerId)!;
      if (!runtime.fortifyFrom) {
        this.beginFortifyFrom(countryId);
      } else if (runtime.destinations.has(countryId)) {
        this.placeArmies(playerId, countryId, player.unallocatedArmies);
      }
    }
  }

  findWeakestEnemyNeighbor(countryId: CountryId): CountryId | null {
    const neighbors = this.enemyNeighbors(countryId);
    if (!neighbors.length) return null;
    return neighbors.sort((a, b) => this.country(a).armies - this.country(b).armies)[0];
  }

  private findPluginIdForPlayer(playerId: PlayerId): string {
    return this.playerPluginIds.get(playerId) ?? playerId;
  }

  private donePickingCountries(): void {
    this.turnNumber += 1;
    this.phase = GamePhase.InitializeArmies;
    this.currentPlayerIndex = 0;
    this.beginTurnIfReady();
  }

  private advanceInitializationTurn(): void {
    const anyInitialLeft = this.playersOrder.some((id) => this.player(id).unallocatedInitialArmies > 0);
    if (!anyInitialLeft) {
      this.phase = GamePhase.Play;
      this.turnPhase = TurnPhase.Done;
      this.currentPlayerIndex = 0;
      this.beginTurnIfReady();
      return;
    }

    this.currentPlayerIndex = this.findNextAlivePlayerIndex(this.currentPlayerIndex);
    this.beginTurnIfReady();
  }

  private findNextAlivePlayerIndex(index: number): number {
    if (this.playersOrder.length === 1) return 0;

    let next = (index + 1) % this.playersOrder.length;
    while (this.player(this.playersOrder[next]).countries.length === 0) {
      next = (next + 1) % this.playersOrder.length;
      if (next === index) break;
    }
    return next;
  }

  // Plain +1 rotation through playersOrder, with no skip-empty check.
  // Used during PickCountries, where every player legitimately starts
  // with no countries.
  private rotateToNextPlayer(): void {
    if (this.playersOrder.length === 1) {
      this.currentPlayerIndex = 0;
      return;
    }
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playersOrder.length;
  }

  private selectNextAlivePlayer(): void {
    this.currentPlayerIndex = this.findNextAlivePlayerIndex(this.currentPlayerIndex);
  }

  private attackOnce(attacker: CountryState, defender: CountryState): { attackerLosses: number; defenderLosses: number } {
    const diceToRoll = this.settings.diceToRoll;
    const attackDiceCount = Math.min(attacker.armies, diceToRoll);
    const defendDiceCount = diceToRoll > 1 && defender.armies > 1 ? 2 : 1;

    const attackDice = this.rollDice(attackDiceCount);
    const defendDice = this.rollDice(defendDiceCount);

    let attackerLosses = 0;
    let defenderLosses = 0;

    if (attackDice[0] > defendDice[0]) {
      defender.armies -= 1;
      defenderLosses += 1;
    } else {
      attacker.armies -= 1;
      attackerLosses += 1;
    }

    if (attackDiceCount > 1 && defendDiceCount > 1) {
      if (attackDice[1] > defendDice[1]) {
        defender.armies -= 1;
        defenderLosses += 1;
      } else {
        attacker.armies -= 1;
        attackerLosses += 1;
      }
    }

    return { attackerLosses, defenderLosses };
  }

  private rollDice(count: number): number[] {
    const dice = Array.from({ length: count }, () => this.rng.die());
    dice.sort((a, b) => b - a);
    return dice;
  }

  private transferCountry(countryId: CountryId, newOwnerId: PlayerId, countVictory: boolean): void {
    const country = this.country(countryId);
    const oldOwnerId = country.ownerId;

    if (oldOwnerId === newOwnerId) return;

    if (oldOwnerId) {
      const oldOwner = this.player(oldOwnerId);
      oldOwner.countries = oldOwner.countries.filter((id) => id !== countryId);
      if (this.phase === GamePhase.Play && countVictory) oldOwner.defeats += 1;
    }

    const newOwner = this.player(newOwnerId);
    newOwner.countries.push(countryId);
    if (this.phase === GamePhase.Play && countVictory) {
      newOwner.victories += 1;
      newOwner.hasWonThisTurn = true;
    }

    country.ownerId = newOwnerId;
    country.tiredArmies = -1;
  }

  private removePlayer(playerId: PlayerId): void {
    const idx = this.playersOrder.indexOf(playerId);
    if (idx === -1) return;
    this.playersOrder.splice(idx, 1);
    if (idx <= this.currentPlayerIndex && this.currentPlayerIndex > 0) {
      this.currentPlayerIndex -= 1;
    }
  }

  private initializeDeck(): void {
    const cards: Card[] = [];
    this.countryIds().forEach((countryId, i) => {
      cards.push({ name: countryId, countryId, suit: (i % 3) as 0 | 1 | 2 });
    });
    cards.push({ name: "Wild 0", countryId: null, suit: WILD_SUIT });
    cards.push({ name: "Wild 1", countryId: null, suit: WILD_SUIT });

    this.discardPile = cards;
    this.shuffleDeck();
  }

  private shuffleDeck(): void {
    this.drawPile = this.rng.shuffle([...this.discardPile]);
    this.discardPile = [];
  }

  private takeCard(): Card | null {
    if (!this.drawPile.length) this.shuffleDeck();
    return this.drawPile.shift() ?? null;
  }

  private takeCards(winnerId: PlayerId, loserId: PlayerId): void {
    const winner = this.player(winnerId);
    const loser = this.player(loserId);
    winner.cards.push(...loser.cards);
    loser.cards = [];
  }

  private randomlyPickCountries(): void {
    const unowned = this.countryIds();
    this.rng.shuffle(unowned);
    let i = 0;
    while (unowned.length) {
      const countryId = unowned.pop()!;
      const playerId = this.playersOrder[i % this.playersOrder.length];
      this.transferCountry(countryId, playerId, false);
      i += 1;
    }
  }

  private startAdvanceArmies(playerId: PlayerId, fromCountryId: CountryId, toCountryId: CountryId): void {
    const player = this.player(playerId);
    const runtime = this.runtime.get(playerId)!;
    runtime.pendingAdvance = { from: fromCountryId, to: toCountryId };
    runtime.destinations = new Set([fromCountryId, toCountryId]);

    player.unallocatedArmies = this.country(fromCountryId).armies;
    this.country(fromCountryId).armies = 0;
  }

  private advanceAfterAllocationDepleted(playerId: PlayerId): void {
    if (playerId !== this.currentPlayerId()) return;
    if (this.phase === GamePhase.InitializeArmies) {
      this.advanceInitializationTurn();
      return;
    }
    if (this.phase === GamePhase.Play && this.turnPhase === TurnPhase.AssignArmies) {
      this.startAttackPhase();
    }
  }
}
