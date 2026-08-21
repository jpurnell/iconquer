export type PlayerId = string;
export type CountryId = string;

export enum GamePhase {
  PickCountries = "pickCountries",
  InitializeArmies = "initializeArmies",
  Play = "play",
  Victory = "victory",
}

export enum TurnPhase {
  AssignArmies = "assignArmies",
  Attack = "attack",
  Fortify = "fortify",
  Done = "done",
}

export enum AttackMode {
  AttackOnce = 0,
  AttackUntilLossesExceed = 1,
  AttackUntilWinOrLose = 2,
}

export interface Settings {
  assignCountries: boolean;
  attacksPerClick: AttackMode;
  diceToRoll: 1 | 2 | 3;
  lossesExceedValue: number;
  cardValues: number;
  allowTurningInCards: boolean;
  advanceArmies: boolean;
}

export interface CountryDefinition {
  id: CountryId;
  x: number;
  y: number;
  width?: number;
  height?: number;
  dotOffsetX?: number;
  dotOffsetY?: number;
  neighbors: CountryId[];
}

export interface ContinentDefinition {
  id: string;
  armies: number;
  countries: CountryId[];
}

export interface MapDefinition {
  id: string;
  name: string;
  background: string;
  baseWidth: number;
  baseHeight: number;
  countries: Record<CountryId, CountryDefinition>;
  continents: Record<string, ContinentDefinition>;
}

export interface Card {
  name: string;
  countryId: CountryId | null;
  suit: 0 | 1 | 2 | -1;
}

export interface CountryState {
  id: CountryId;
  ownerId: PlayerId | null;
  armies: number;
  tiredArmies: number;
  reserveArmies: number;
  selected: boolean;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: string;
  isComputer: boolean;
  countries: CountryId[];
  cards: Card[];
  unallocatedInitialArmies: number;
  unallocatedArmies: number;
  hasWonThisTurn: boolean;
  victories: number;
  defeats: number;
}

export interface AttackResult {
  conquered: boolean;
  attackerLosses: number;
  defenderLosses: number;
  eliminatedPlayerId?: PlayerId;
}

export interface GameSnapshot {
  phase: GamePhase;
  turnPhase: TurnPhase;
  turnNumber: number;
  currentPlayerId: PlayerId;
  currentCountryId: CountryId | null;
  countries: Record<CountryId, CountryState>;
  players: Record<PlayerId, PlayerState>;
  winnerId: PlayerId | null;
  mustTurnInCards: boolean;
  needsCardTurnIn: boolean;
  // Card sets traded in across the whole game. Drives the escalating value
  // of the next trade-in — without it an agent reading a snapshot cannot
  // tell a 4-army set from a 20-army one.
  cardSetsTurnedIn: number;
}
