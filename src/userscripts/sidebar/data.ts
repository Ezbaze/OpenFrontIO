import {
  AlliancePact,
  GameSnapshot,
  IncomingAttack,
  OutgoingAttack,
  PlayerRecord,
  ShipRecord,
  ShipType,
  TileSummary,
} from "./types";

const TICK_MILLISECONDS = 100;

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
  addEmbargo?(other: PlayerViewLike, isTemporary?: boolean): void;
  stopEmbargo?(other: PlayerViewLike): void;
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
  player(id: string | number): PlayerViewLike;
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
type PlayerPanelElement = Element & {
  handleEmbargoClick?: (
    event: Event,
    myPlayer: PlayerViewLike,
    other: PlayerViewLike,
  ) => void;
  handleStopEmbargoClick?: (
    event: Event,
    myPlayer: PlayerViewLike,
    other: PlayerViewLike,
  ) => void;
};

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

  constructor(initialSnapshot?: GameSnapshot) {
    this.snapshot = initialSnapshot ?? {
      players: [],
      allianceDurationMs: 0,
      currentTimeMs: Date.now(),
      ships: [],
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
    };
    this.notify();
  }

  setTradingStopped(
    targetPlayerIds: readonly string[],
    stopped: boolean,
  ): void {
    if (!this.game) {
      console.warn("Sidebar trading toggle skipped: game unavailable");
      return;
    }

    const localPlayer = this.resolveLocalPlayer();
    if (!localPlayer) {
      console.warn("Sidebar trading toggle skipped: local player unavailable");
      return;
    }

    const selfId = this.resolveSelfId(localPlayer);
    const uniqueIds = new Set(targetPlayerIds);
    const targets: PlayerViewLike[] = [];
    for (const id of uniqueIds) {
      if (selfId !== null && id === selfId) {
        continue;
      }
      const resolved = this.resolvePlayerById(id);
      if (resolved) {
        targets.push(resolved);
      }
    }

    if (targets.length === 0) {
      return;
    }

    const panel = this.resolvePlayerPanel();
    const handler = stopped
      ? panel?.handleEmbargoClick
      : panel?.handleStopEmbargoClick;
    if (panel && typeof handler === "function") {
      for (const target of targets) {
        try {
          handler.call(
            panel,
            new MouseEvent("click", { bubbles: false, cancelable: true }),
            localPlayer,
            target,
          );
        } catch (error) {
          console.warn(
            "Sidebar trading toggle failed via player panel",
            this.describePlayerForLog(target),
            error,
          );
        }
      }
      this.refreshFromGame();
      return;
    }

    if (stopped) {
      const addEmbargo = localPlayer.addEmbargo;
      if (typeof addEmbargo !== "function") {
        console.warn(
          "Sidebar trading toggle skipped: local player cannot add embargoes",
        );
        return;
      }
      for (const target of targets) {
        try {
          addEmbargo.call(localPlayer, target, false);
        } catch (error) {
          console.warn(
            "Failed to stop trading with player",
            this.describePlayerForLog(target),
            error,
          );
        }
      }
    } else {
      const stopEmbargo = localPlayer.stopEmbargo;
      if (typeof stopEmbargo !== "function") {
        console.warn(
          "Sidebar trading toggle skipped: local player cannot stop embargoes",
        );
        return;
      }
      for (const target of targets) {
        try {
          stopEmbargo.call(localPlayer, target);
        } catch (error) {
          console.warn(
            "Failed to resume trading with player",
            this.describePlayerForLog(target),
            error,
          );
        }
      }
    }

    this.refreshFromGame();
  }

  private resolvePlayerPanel(): PlayerPanelElement | null {
    if (typeof document === "undefined") {
      return null;
    }

    const element = document.querySelector(
      "player-panel",
    ) as PlayerPanelElement | null;
    return element ?? null;
  }

  private resolveSelfId(localPlayer: PlayerViewLike | null): string | null {
    if (localPlayer) {
      try {
        return String(localPlayer.id());
      } catch (error) {
        console.warn("Failed to read local player id", error);
      }
    }

    const snapshotSelf = this.snapshot.players.find((player) => player.isSelf);
    return snapshotSelf?.id ?? null;
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
      const ships = this.createShipRecords();
      const records = players.map((player) =>
        this.createPlayerRecord(player, currentTimeMs, localPlayer),
      );

      this.snapshot = {
        players: records,
        allianceDurationMs,
        currentTimeMs,
        ships,
      };
      this.notify();
    } catch (error) {
      // If the game context changes while we're reading from it, try attaching again.
      console.warn("Failed to refresh sidebar data", error);
      this.game = null;
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
      troops: this.resolveAttackTroops(attack),
    }));
  }

  private mapOutgoingAttacks(attacks: AttackUpdateLike[]): OutgoingAttack[] {
    return attacks.map((attack) => ({
      id: attack.id,
      target: this.resolveNameBySmallId(attack.targetID),
      troops: this.resolveAttackTroops(attack),
    }));
  }

  private resolveAttackTroops(attack: AttackUpdateLike): number {
    if (attack.troops > 0) {
      return attack.troops;
    }

    const manifest = this.shipManifests.get(String(attack.id));
    return manifest ?? attack.troops;
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

  private resolvePlayerById(playerId: string): PlayerViewLike | null {
    if (!this.game) {
      return null;
    }

    const attempts: Array<() => PlayerViewLike | null> = [
      () => {
        try {
          const candidate = this.game?.player(playerId);
          return this.isPlayerViewLike(candidate) ? candidate : null;
        } catch (error) {
          return null;
        }
      },
    ];

    const numericId = Number(playerId);
    if (Number.isFinite(numericId)) {
      attempts.push(() => {
        try {
          const candidate = this.game?.player(numericId);
          return this.isPlayerViewLike(candidate) ? candidate : null;
        } catch (error) {
          return null;
        }
      });
      attempts.push(() => {
        try {
          const candidate = this.game?.playerBySmallID(numericId);
          return this.isPlayerViewLike(candidate) ? candidate : null;
        } catch (error) {
          return null;
        }
      });
    }

    for (const attempt of attempts) {
      const result = attempt();
      if (result) {
        return result;
      }
    }

    console.warn(`Failed to resolve player ${playerId} in game context`);
    return null;
  }

  private isPlayerViewLike(value: unknown): value is PlayerViewLike {
    if (!value || typeof value !== "object") {
      return false;
    }
    const candidate = value as PlayerViewLike;
    return (
      typeof candidate.id === "function" &&
      typeof candidate.displayName === "function" &&
      typeof candidate.smallID === "function"
    );
  }

  private describePlayerForLog(player: PlayerViewLike): string {
    let name = "Unknown";
    let id: string | number = "?";
    try {
      name = player.displayName();
    } catch (error) {
      // ignore
    }
    try {
      id = player.id();
    } catch (error) {
      // ignore
    }
    return `${name} (#${id})`;
  }
}
