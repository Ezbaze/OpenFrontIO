import {
  AlliancePact,
  GameSnapshot,
  IncomingAttack,
  LandmassRecord,
  OutgoingAttack,
  PlayerRecord,
  ShipRecord,
  ShipType,
  TileSummary,
} from "./types";

const TICK_MILLISECONDS = 100;
const LANDMASS_REFRESH_INTERVAL_TICKS = 50;

type SnapshotListener = (snapshot: GameSnapshot) => void;

interface AttackUpdateLike {
  attackerID: number;
  targetID: number;
  troops: number;
  id: string;
  retreating: boolean;
}

interface AllianceViewLike {
  id: number | string;
  other: string | number;
  createdAt: number;
  expiresAt: number;
}

interface PlayerViewLike {
  id(): string | number;
  displayName(): string;
  smallID(): number;
  nameLocation(): { x: number; y: number; size: number } | undefined;
  team(): string | null | undefined;
  numTilesOwned(): number;
  gold(): number | bigint;
  troops(): number;
  incomingAttacks(): AttackUpdateLike[];
  outgoingAttacks(): AttackUpdateLike[];
  alliances(): AllianceViewLike[];
  hasSpawned(): boolean;
  isAlive(): boolean;
  isDisconnected(): boolean;
  isTraitor(): boolean;
  getTraitorRemainingTicks?(): number;
  traitorRemainingTicks?: number;
  hasEmbargo?(other: PlayerViewLike): boolean;
  hasEmbargoAgainst?(other: PlayerViewLike): boolean;
}

interface GameConfigLike {
  allianceDuration(): number;
}

interface UnitViewLike {
  id(): number;
  type(): string;
  troops(): number;
  tile(): number;
  lastTile(): number;
  targetTile(): number | undefined;
  owner(): PlayerViewLike;
  reachedTarget(): boolean;
  targetUnitId(): number | undefined;
  retreating?(): boolean;
}

interface GameViewLike {
  playerViews(): PlayerViewLike[];
  ticks(): number;
  config(): GameConfigLike;
  playerBySmallID(id: number): PlayerViewLike | Record<string, unknown>;
  player(id: string): PlayerViewLike;
  units(...types: string[]): UnitViewLike[];
  unit(id: number): UnitViewLike | undefined;
  x(ref: number): number;
  y(ref: number): number;
  ref(x: number, y: number): number;
  isValidCoord(x: number, y: number): boolean;
  hasOwner(ref: number): boolean;
  ownerID(ref: number): number;
  neighbors(ref: number): number[];
  isWater(ref: number): boolean;
  forEachTile(fn: (ref: number) => void): void;
  myPlayer?(): PlayerViewLike | null;
}

type GameAwareElement = Element & { g?: GameViewLike; game?: GameViewLike };

type AllianceMap = Map<string, Set<string>>;
type TraitorHistory = Map<string, Set<string>>;

export class DataStore {
  private snapshot: GameSnapshot;
  private readonly listeners = new Set<SnapshotListener>();
  private refreshHandle: number | undefined;
  private attachHandle: number | undefined;
  private game: GameViewLike | null = null;
  private readonly previousAlliances: AllianceMap = new Map();
  private readonly traitorHistory: TraitorHistory = new Map();
  private readonly shipOrigins: Map<string, TileSummary> = new Map();
  private readonly shipDestinations: Map<string, TileSummary> = new Map();
  private readonly shipManifests: Map<string, number> = new Map();
  private landmassCache: { tick: number; records: LandmassRecord[] } | null =
    null;

  constructor(initialSnapshot?: GameSnapshot) {
    this.snapshot = initialSnapshot ?? {
      players: [],
      allianceDurationMs: 0,
      currentTimeMs: Date.now(),
      ships: [],
      landmasses: [],
    };

    if (typeof window !== "undefined") {
      this.scheduleGameDiscovery(true);
    }
  }

  getSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  update(snapshot: GameSnapshot): void {
    this.snapshot = {
      ...snapshot,
      currentTimeMs: snapshot.currentTimeMs ?? Date.now(),
      ships: snapshot.ships ?? [],
      landmasses: snapshot.landmasses ?? [],
    };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  private scheduleGameDiscovery(immediate = false): void {
    if (typeof window === "undefined") {
      return;
    }

    if (!immediate && this.attachHandle !== undefined) {
      return;
    }

    const attemptAttach = () => {
      const discovered = this.findLiveGame();
      if (discovered) {
        this.game = discovered;
        this.landmassCache = null;
        this.refreshFromGame();
        if (this.attachHandle !== undefined) {
          window.clearTimeout(this.attachHandle);
          this.attachHandle = undefined;
        }
        if (this.refreshHandle !== undefined) {
          window.clearInterval(this.refreshHandle);
        }
        this.refreshHandle = window.setInterval(
          () => this.refreshFromGame(),
          500,
        );
      } else {
        this.attachHandle = window.setTimeout(attemptAttach, 1000);
      }
    };

    if (immediate) {
      attemptAttach();
    } else {
      this.attachHandle = window.setTimeout(attemptAttach, 0);
    }
  }

  private findLiveGame(): GameViewLike | null {
    const candidates: NodeListOf<GameAwareElement> = document.querySelectorAll(
      "player-panel, leader-board, game-right-sidebar",
    );
    for (const element of candidates) {
      if (element.g) {
        return element.g;
      }
      if (element.game) {
        return element.game;
      }
    }
    return null;
  }

  private refreshFromGame(): void {
    if (!this.game) {
      return;
    }

    try {
      const players = this.game.playerViews();
      this.captureAllianceChanges(players);
      const currentTick = this.game.ticks();
      const currentTimeMs = currentTick * TICK_MILLISECONDS;
      const allianceDurationMs =
        this.game.config().allianceDuration() * TICK_MILLISECONDS;

      const localPlayer = this.resolveLocalPlayer();
      const records = players.map((player) =>
        this.createPlayerRecord(player, currentTimeMs, localPlayer),
      );
      const ships = this.createShipRecords();
      const landmasses = this.resolveLandmassRecords(currentTick);

      this.snapshot = {
        players: records,
        allianceDurationMs,
        currentTimeMs,
        ships,
        landmasses,
      };
      this.notify();
    } catch (error) {
      // If the game context changes while we're reading from it, try attaching again.
      console.warn("Failed to refresh sidebar data", error);
      this.game = null;
      this.landmassCache = null;
      if (this.refreshHandle !== undefined) {
        window.clearInterval(this.refreshHandle);
        this.refreshHandle = undefined;
      }
      this.scheduleGameDiscovery();
    }
  }

  private createShipRecords(): ShipRecord[] {
    if (!this.game) {
      return [];
    }

    const units = this.game.units("Transport", "Trade Ship", "Warship");
    const ships: ShipRecord[] = [];
    for (const unit of units) {
      const type = this.normalizeShipType(unit.type());
      if (!type) {
        continue;
      }
      ships.push(this.createShipRecord(unit, type));
    }
    ships.sort((a, b) => a.ownerName.localeCompare(b.ownerName));
    this.pruneStaleShipMemory(new Set(ships.map((ship) => ship.id)));
    return ships;
  }

  private resolveLandmassRecords(currentTick: number): LandmassRecord[] {
    if (!this.game) {
      this.landmassCache = null;
      return [];
    }

    const cache = this.landmassCache;
    if (
      cache &&
      cache.tick <= currentTick &&
      currentTick - cache.tick < LANDMASS_REFRESH_INTERVAL_TICKS
    ) {
      return cache.records;
    }

    const records = this.createLandmassRecords();
    this.landmassCache = { tick: currentTick, records };
    return records;
  }

  private createLandmassRecords(): LandmassRecord[] {
    if (!this.game) {
      return [];
    }

    const visited = new Set<number>();
    const ownerSequences = new Map<number, number>();
    const records: LandmassRecord[] = [];

    this.game.forEachTile((ref) => {
      if (visited.has(ref)) {
        return;
      }

      const ownerSmallId = this.getTileOwner(ref);
      if (ownerSmallId === null || ownerSmallId === 0) {
        return;
      }

      const component = this.collectLandmass(ref, ownerSmallId, visited);
      if (!component) {
        return;
      }

      const ownerId = String(ownerSmallId);
      const ownerName = this.resolveNameBySmallId(ownerSmallId);
      const sequence = (ownerSequences.get(ownerSmallId) ?? 0) + 1;
      ownerSequences.set(ownerSmallId, sequence);

      const anchorSummary =
        this.describeTile(component.anchorRef) ??
        (this.game
          ? {
              ref: component.anchorRef,
              x: this.game.x(component.anchorRef),
              y: this.game.y(component.anchorRef),
              ownerId,
              ownerName,
            }
          : undefined);

      records.push({
        id: `${ownerId}:${sequence}`,
        ownerId,
        ownerName,
        tiles: component.tiles,
        anchor: anchorSummary,
        sequence,
      });
    });

    return records;
  }

  private collectLandmass(
    startRef: number,
    ownerSmallId: number,
    visited: Set<number>,
  ): { tiles: number; anchorRef: number } | null {
    if (!this.game) {
      return null;
    }

    const queue: number[] = [startRef];
    let index = 0;
    visited.add(startRef);
    let tiles = 0;
    let anchorRef = startRef;
    let anchorX = this.game.x(startRef);
    let anchorY = this.game.y(startRef);

    while (index < queue.length) {
      const ref = queue[index++];
      if (!this.isTileOwnedBy(ref, ownerSmallId)) {
        continue;
      }

      tiles += 1;
      const x = this.game.x(ref);
      const y = this.game.y(ref);
      if (y < anchorY || (y === anchorY && x < anchorX)) {
        anchorRef = ref;
        anchorX = x;
        anchorY = y;
      }

      const neighbors = this.game.neighbors(ref) ?? [];
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) {
          continue;
        }
        if (!this.isTileOwnedBy(neighbor, ownerSmallId)) {
          continue;
        }
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    if (tiles === 0) {
      return null;
    }

    return { tiles, anchorRef };
  }

  private isTileOwnedBy(ref: number, ownerSmallId: number): boolean {
    const owner = this.getTileOwner(ref);
    return owner !== null && owner === ownerSmallId;
  }

  private getTileOwner(ref: number): number | null {
    if (!this.game) {
      return null;
    }

    try {
      if (!this.game.hasOwner(ref)) {
        return null;
      }
    } catch (error) {
      console.warn("Failed to inspect tile ownership", error);
      return null;
    }

    try {
      return this.game.ownerID(ref);
    } catch (error) {
      console.warn("Failed to read tile owner id", error);
      return null;
    }
  }

  private createShipRecord(unit: UnitViewLike, type: ShipType): ShipRecord {
    const owner = unit.owner();
    const ownerId = String(owner.id());
    const ownerName = owner.displayName();
    const shipId = String(unit.id());
    const troops = this.resolveShipTroops(shipId, unit, type);
    const origin = this.resolveShipOrigin(shipId, unit);
    const current = this.describeTile(unit.tile());
    const retreating = this.resolveShipRetreating(unit);
    const destination = this.resolveShipDestination(
      shipId,
      unit,
      type,
      retreating,
    );
    return {
      id: String(unit.id()),
      type,
      ownerId,
      ownerName,
      troops,
      origin,
      current,
      destination,
      retreating,
      reachedTarget: unit.reachedTarget(),
    };
  }

  private resolveShipRetreating(unit: UnitViewLike): boolean {
    if (typeof unit.retreating !== "function") {
      return false;
    }
    try {
      return unit.retreating();
    } catch (error) {
      console.warn("Failed to read ship retreating state", error);
      return false;
    }
  }

  private resolveShipOrigin(
    shipId: string,
    unit: UnitViewLike,
  ): TileSummary | undefined {
    const existing = this.shipOrigins.get(shipId);
    if (existing) {
      return existing;
    }

    const origin =
      this.describeTile(unit.lastTile()) ?? this.describeTile(unit.tile());
    if (origin) {
      this.shipOrigins.set(shipId, origin);
    }
    return origin;
  }

  private resolveShipDestination(
    shipId: string,
    unit: UnitViewLike,
    type: ShipType,
    retreating: boolean,
  ): TileSummary | undefined {
    if (retreating) {
      const origin = this.shipOrigins.get(shipId);
      if (origin) {
        this.shipDestinations.set(shipId, origin);
        return origin;
      }
    }

    const targetRef = this.getShipDestinationRef(unit, type);
    if (targetRef !== undefined) {
      const destination = this.describeTile(targetRef);
      if (destination) {
        this.shipDestinations.set(shipId, destination);
        return destination;
      }
    }

    const existing = this.shipDestinations.get(shipId);
    if (existing) {
      return existing;
    }

    if (type === "Transport") {
      const inferred = this.inferTransportDestination(shipId, unit, retreating);
      if (inferred) {
        return inferred;
      }
    }

    return undefined;
  }

  private getShipDestinationRef(
    unit: UnitViewLike,
    type: ShipType,
  ): number | undefined {
    try {
      const direct = unit.targetTile();
      if (direct !== undefined) {
        return direct;
      }
    } catch (error) {
      console.warn("Failed to read ship target tile", error);
    }

    if (type === "Trade Ship") {
      try {
        const targetUnitId = unit.targetUnitId();
        if (targetUnitId !== undefined) {
          const targetUnit = this.game?.unit(targetUnitId);
          if (targetUnit) {
            return targetUnit.tile();
          }
        }
      } catch (error) {
        console.warn("Failed to resolve trade ship destination", error);
      }
    }

    return undefined;
  }

  private resolveShipTroops(
    shipId: string,
    unit: UnitViewLike,
    type: ShipType,
  ): number {
    const troops = unit.troops();
    if (troops > 0 || !this.shipManifests.has(shipId)) {
      this.shipManifests.set(shipId, troops);
    }

    if (type === "Transport" && troops === 0) {
      return this.shipManifests.get(shipId) ?? troops;
    }

    return troops;
  }

  private pruneStaleShipMemory(activeIds: Set<string>): void {
    for (const [shipId] of this.shipOrigins) {
      if (!activeIds.has(shipId)) {
        this.shipOrigins.delete(shipId);
      }
    }
    for (const [shipId] of this.shipDestinations) {
      if (!activeIds.has(shipId)) {
        this.shipDestinations.delete(shipId);
      }
    }
    for (const [shipId] of this.shipManifests) {
      if (!activeIds.has(shipId)) {
        this.shipManifests.delete(shipId);
      }
    }
  }

  private inferTransportDestination(
    shipId: string,
    unit: UnitViewLike,
    retreating: boolean,
  ): TileSummary | undefined {
    if (!this.game || retreating) {
      return this.shipDestinations.get(shipId);
    }

    const cached = this.shipDestinations.get(shipId);
    if (cached) {
      return cached;
    }

    const start = unit.tile();
    const visited = new Set<number>([start]);
    const queue: number[] = [start];
    let index = 0;
    const ownerSmallId = this.safePlayerSmallId(unit.owner());
    const maxExplored = 4096;

    while (index < queue.length && visited.size <= maxExplored) {
      const current = queue[index++];
      const neighbors = this.game.neighbors(current) ?? [];
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);

        if (!this.game.isWater(neighbor)) {
          let ownerId: number | null = null;
          try {
            ownerId = this.game.hasOwner(neighbor)
              ? this.game.ownerID(neighbor)
              : null;
          } catch (error) {
            console.warn(
              "Failed to inspect transport destination owner",
              error,
            );
          }

          if (ownerSmallId !== null && ownerId === ownerSmallId) {
            continue;
          }

          const summary = this.describeTile(neighbor);
          if (summary) {
            this.shipDestinations.set(shipId, summary);
            return summary;
          }
          continue;
        }

        queue.push(neighbor);
      }
    }

    return this.shipDestinations.get(shipId);
  }

  private safePlayerSmallId(player: PlayerViewLike): number | null {
    try {
      const small = player.smallID();
      if (Number.isFinite(small)) {
        return small;
      }
    } catch (error) {
      console.warn("Failed to resolve player smallID", error);
    }

    const rawId = player.id();
    const numeric = typeof rawId === "number" ? rawId : Number(rawId);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private describeTile(ref: number | undefined): TileSummary | undefined {
    if (!this.game || ref === undefined) {
      return undefined;
    }
    const x = this.game.x(ref);
    const y = this.game.y(ref);
    let ownerId: string | undefined;
    let ownerName: string | undefined;
    if (this.game.hasOwner(ref)) {
      const smallId = this.game.ownerID(ref);
      ownerId = String(smallId);
      ownerName = this.resolveNameBySmallId(smallId);
    }
    return { ref, x, y, ownerId, ownerName } satisfies TileSummary;
  }

  private describePlayerFocus(player: PlayerViewLike): TileSummary | undefined {
    if (!this.game) {
      return undefined;
    }

    try {
      const location = player.nameLocation?.();
      if (!location) {
        return undefined;
      }

      const { x, y } = location;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return undefined;
      }

      let ref: number | undefined;
      try {
        if (this.game.isValidCoord(x, y)) {
          ref = this.game.ref(x, y);
        }
      } catch (error) {
        console.warn("Failed to resolve player focus ref", error);
      }

      return {
        ref,
        x,
        y,
        ownerId: String(player.id()),
        ownerName: player.displayName(),
      } satisfies TileSummary;
    } catch (error) {
      console.warn("Failed to resolve player focus position", error);
      return undefined;
    }
  }

  private normalizeShipType(unitType: string): ShipType | null {
    switch (unitType) {
      case "Transport":
        return "Transport";
      case "Trade Ship":
        return "Trade Ship";
      case "Warship":
        return "Warship";
      default:
        return null;
    }
  }

  private captureAllianceChanges(players: PlayerViewLike[]): void {
    const nowTicks = this.game?.ticks() ?? 0;

    for (const player of players) {
      const playerId = String(player.id());
      const currentAlliances = new Set(
        player
          .alliances()
          .filter((alliance) => alliance.expiresAt > nowTicks)
          .map((alliance) => String(alliance.other)),
      );

      const previous = this.previousAlliances.get(playerId);
      if (previous) {
        const removed = [...previous].filter((id) => !currentAlliances.has(id));
        if (removed.length > 0 && this.isPlayerCurrentlyTraitor(player)) {
          for (const removedId of removed) {
            const targetName =
              this.resolveNameByPlayerId(removedId) ?? `Player ${removedId}`;
            this.getTraitorTargets(playerId).add(targetName);
          }
        }
      }

      this.previousAlliances.set(playerId, currentAlliances);
    }
  }

  private createPlayerRecord(
    player: PlayerViewLike,
    currentTimeMs: number,
    localPlayer: PlayerViewLike | null,
  ): PlayerRecord {
    const playerId = String(player.id());
    const name = player.displayName();
    const clan = this.extractClanFromName(name);

    const incomingRaw = player
      .incomingAttacks()
      .filter((attack) => !attack.retreating);
    const outgoingRaw = player
      .outgoingAttacks()
      .filter((attack) => !attack.retreating);

    const incomingAttacks = this.mapIncomingAttacks(incomingRaw);
    const outgoingAttacks = this.mapOutgoingAttacks(outgoingRaw);
    const expansions = outgoingRaw.filter(
      (attack) => attack.targetID === 0,
    ).length;

    const alliances = this.mapActiveAlliances(player);
    const goldValue = player.gold();
    const gold = typeof goldValue === "bigint" ? Number(goldValue) : goldValue;

    const tradeStopped = this.determineTradeStopped(localPlayer, player);
    const isSelf = this.isSamePlayer(localPlayer, playerId);

    return {
      id: playerId,
      name,
      clan,
      team: player.team() ?? undefined,
      position: this.describePlayerFocus(player),
      traitorTargets: Array.from(this.getTraitorTargets(playerId)),
      tradeStopped,
      isSelf,
      tiles: player.numTilesOwned(),
      gold,
      troops: player.troops(),
      incomingAttacks,
      outgoingAttacks,
      defensiveSupports: [],
      expansions,
      waiting: !player.hasSpawned(),
      eliminated: !player.isAlive(),
      disconnected: player.isDisconnected(),
      traitor: player.isTraitor(),
      alliances,
      lastUpdatedMs: currentTimeMs,
    };
  }

  private mapIncomingAttacks(attacks: AttackUpdateLike[]): IncomingAttack[] {
    return attacks.map((attack) => ({
      id: attack.id,
      from: this.resolveNameBySmallId(attack.attackerID),
      troops: attack.troops,
    }));
  }

  private mapOutgoingAttacks(attacks: AttackUpdateLike[]): OutgoingAttack[] {
    return attacks.map((attack) => ({
      id: attack.id,
      target: this.resolveNameBySmallId(attack.targetID),
      troops: attack.troops,
    }));
  }

  private mapActiveAlliances(player: PlayerViewLike): AlliancePact[] {
    const nowTicks = this.game?.ticks() ?? 0;
    return player
      .alliances()
      .filter((alliance) => alliance.expiresAt > nowTicks)
      .map((alliance) => ({
        id: `${player.id()}-${alliance.id}`,
        partner:
          this.resolveNameByPlayerId(String(alliance.other)) ??
          `Player ${alliance.other}`,
        startedAtMs: alliance.createdAt * TICK_MILLISECONDS,
      }));
  }

  private resolveNameBySmallId(id: number): string {
    if (id === 0) {
      return "Terra Nullius";
    }

    if (!this.game) {
      return `Player ${id}`;
    }

    try {
      const entity = this.game.playerBySmallID(id);
      if ("displayName" in entity && typeof entity.displayName === "function") {
        return entity.displayName();
      }
      if ("name" in entity && typeof entity.name === "function") {
        return entity.name();
      }
    } catch (error) {
      console.warn("Failed to resolve player by small id", id, error);
    }

    return `Player ${id}`;
  }

  private resolveNameByPlayerId(id: string): string | undefined {
    if (!this.game) {
      return undefined;
    }

    try {
      return this.game.player(id).displayName();
    } catch (error) {
      console.warn("Failed to resolve player by id", id, error);
      return undefined;
    }
  }

  private extractClanFromName(name: string): string | undefined {
    const match = name.match(/\[(.+?)\]/);
    return match ? match[1].trim() : undefined;
  }

  private getTraitorTargets(playerId: string): Set<string> {
    if (!this.traitorHistory.has(playerId)) {
      this.traitorHistory.set(playerId, new Set());
    }
    return this.traitorHistory.get(playerId)!;
  }

  private isPlayerCurrentlyTraitor(player: PlayerViewLike): boolean {
    if (player.isTraitor()) {
      return true;
    }
    if (typeof player.getTraitorRemainingTicks === "function") {
      return player.getTraitorRemainingTicks() > 0;
    }
    const remaining = player.traitorRemainingTicks;
    return typeof remaining === "number" ? remaining > 0 : false;
  }

  private resolveLocalPlayer(): PlayerViewLike | null {
    if (!this.game) {
      return null;
    }

    if (typeof this.game.myPlayer !== "function") {
      return null;
    }

    try {
      return this.game.myPlayer() ?? null;
    } catch (error) {
      console.warn("Failed to resolve local player", error);
      return null;
    }
  }

  private determineTradeStopped(
    localPlayer: PlayerViewLike | null,
    other: PlayerViewLike,
  ): boolean {
    if (!localPlayer) {
      return false;
    }

    if (this.isSamePlayer(localPlayer, String(other.id()))) {
      return false;
    }

    if (typeof localPlayer.hasEmbargo === "function") {
      try {
        const result = localPlayer.hasEmbargo(other);
        if (typeof result === "boolean") {
          return result;
        }
      } catch (error) {
        console.warn("Failed to read embargo state", error);
      }
    }

    if (typeof localPlayer.hasEmbargoAgainst === "function") {
      try {
        const result = localPlayer.hasEmbargoAgainst(other);
        if (typeof result === "boolean") {
          return result;
        }
      } catch (error) {
        console.warn("Failed to read outbound embargo state", error);
      }
    }

    if (typeof other.hasEmbargoAgainst === "function") {
      try {
        const result = other.hasEmbargoAgainst(localPlayer);
        if (typeof result === "boolean") {
          return result;
        }
      } catch (error) {
        console.warn("Failed to read inbound embargo state", error);
      }
    }

    return false;
  }

  private isSamePlayer(
    player: PlayerViewLike | null,
    otherId: string,
  ): boolean {
    if (!player) {
      return false;
    }

    try {
      const id = player.id();
      return String(id) === otherId;
    } catch (error) {
      console.warn("Failed to compare player identity", error);
      return false;
    }
  }
}
