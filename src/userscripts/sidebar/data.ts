import {
  AlliancePact,
  GameSnapshot,
  IncomingAttack,
  OutgoingAttack,
  PlayerRecord,
  ShipRecord,
  ShipType,
  SidebarActionDefinition,
  SidebarActionDefinitionUpdate,
  SidebarActionSetting,
  SidebarActionSettingType,
  SidebarActionSettingValue,
  SidebarActionsState,
  SidebarRunningAction,
  SidebarRunningActionStatus,
  TileSummary,
} from "./types";
import { extractClanTag } from "./utils";

const TICK_MILLISECONDS = 100;

type ActionExecutionState = Record<string, unknown>;

interface ActionGamePlayerInfo {
  id: string;
  name: string;
  isSelf: boolean;
  tradeStopped: boolean;
  tiles: number;
  gold: number;
  troops: number;
}

interface ActionGameApi {
  readonly players: ActionGamePlayerInfo[];
  readonly tick: number;
  stopTrade(target: string | number | Iterable<string | number>): void;
  startTrade(target: string | number | Iterable<string | number>): void;
}

interface ActionExecutionContext {
  game: ActionGameApi;
  settings: Record<string, SidebarActionSettingValue>;
  state: ActionExecutionState;
  run: SidebarRunningAction;
  snapshot: GameSnapshot;
  logger: Console;
}

interface RunningActionRuntime {
  intervalTicks: number;
  lastExecutedTick: number;
  active: boolean;
  state: ActionExecutionState;
  stop(): void;
  updateInterval(ticks: number): void;
}

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
  private actionsState: SidebarActionsState;
  private actionIdCounter = 0;
  private runningActionIdCounter = 0;
  private settingIdCounter = 0;
  private readonly runningRemovalTimers: Map<
    string,
    ReturnType<typeof setTimeout>
  > = new Map();
  private readonly actionRuntimes: Map<string, RunningActionRuntime> =
    new Map();
  private pendingTradingRefreshHandle: number | undefined;

  constructor(initialSnapshot?: GameSnapshot) {
    this.actionsState = this.createInitialActionsState();
    const baseSnapshot = initialSnapshot ?? {
      players: [],
      allianceDurationMs: 0,
      currentTimeMs: Date.now(),
      ships: [],
    };
    this.snapshot = this.attachActionsState({
      ...baseSnapshot,
      currentTimeMs: baseSnapshot.currentTimeMs ?? Date.now(),
      ships: baseSnapshot.ships ?? [],
    });

    if (typeof window !== "undefined") {
      this.scheduleGameDiscovery(true);
    }
  }

  private attachActionsState(snapshot: GameSnapshot): GameSnapshot {
    return {
      ...snapshot,
      sidebarActions: this.actionsState,
    };
  }

  private createInitialActionsState(): SidebarActionsState {
    const now = Date.now();
    const tradeBan = this.createActionDefinition({
      name: "Trade ban everyone in the game",
      code:
        "// Stops trading with every known player\n" +
        "for (const player of game.players) {\n" +
        "  game.stopTrade(player.id);\n" +
        "}\n",
      runMode: "once",
      description: "Stops trading with every known player immediately.",
      runIntervalTicks: 1,
      settings: [
        this.createSetting({
          key: "includeAllies",
          label: "Include allies",
          type: "toggle",
          value: false,
        }),
      ],
      timestamp: now,
    });
    const enableTrade = this.createActionDefinition({
      name: "Enable trade with everyone in the game",
      code:
        "// Restores trading with every known player\n" +
        "for (const player of game.players) {\n" +
        "  game.startTrade(player.id);\n" +
        "}\n",
      runMode: "once",
      description: "Resumes trading with every known player.",
      runIntervalTicks: 1,
      settings: [
        this.createSetting({
          key: "skipAllies",
          label: "Skip current allies",
          type: "toggle",
          value: true,
        }),
      ],
      timestamp: now,
    });

    const actions = [tradeBan, enableTrade];
    return {
      revision: 1,
      runningRevision: 1,
      actions,
      running: [],
      selectedActionId: actions[0]?.id,
      selectedRunningActionId: undefined,
    };
  }

  private nextActionId(): string {
    this.actionIdCounter += 1;
    return `action-${this.actionIdCounter}`;
  }

  private nextRunningActionId(): string {
    this.runningActionIdCounter += 1;
    return `run-${this.runningActionIdCounter}`;
  }

  private nextSettingId(): string {
    this.settingIdCounter += 1;
    return `setting-${this.settingIdCounter}`;
  }

  private normalizeSettingValue(
    type: SidebarActionSettingType,
    value: SidebarActionSettingValue,
  ): SidebarActionSettingValue {
    switch (type) {
      case "number": {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
      }
      case "toggle":
        return Boolean(value);
      default:
        return String(value ?? "");
    }
  }

  private createSetting(options: {
    key: string;
    label: string;
    type?: SidebarActionSettingType;
    value?: SidebarActionSettingValue;
  }): SidebarActionSetting {
    const type = options.type ?? "text";
    const fallback = type === "number" ? 0 : type === "toggle" ? false : "";
    const rawValue = options.value ?? fallback;
    return {
      id: this.nextSettingId(),
      key: options.key,
      label: options.label,
      type,
      value: this.normalizeSettingValue(type, rawValue),
    };
  }

  private createActionDefinition(options: {
    name: string;
    code: string;
    runMode: SidebarActionDefinition["runMode"];
    description?: string;
    runIntervalTicks?: number;
    settings?: SidebarActionSetting[];
    timestamp?: number;
  }): SidebarActionDefinition {
    const createdAtMs = options.timestamp ?? Date.now();
    const settings = options.settings
      ? options.settings.map((setting) => ({ ...setting }))
      : [];
    const interval = Math.max(1, Math.floor(options.runIntervalTicks ?? 1));
    return {
      id: this.nextActionId(),
      name: options.name,
      code: options.code,
      runMode: options.runMode,
      description: options.description?.trim() ?? "",
      runIntervalTicks: interval,
      settings,
      createdAtMs,
      updatedAtMs: createdAtMs,
    };
  }

  private cloneSetting(setting: SidebarActionSetting): SidebarActionSetting {
    return {
      ...setting,
      id: this.nextSettingId(),
      value: this.normalizeSettingValue(setting.type, setting.value),
    };
  }

  private cloneSettings(
    settings: SidebarActionSetting[],
  ): SidebarActionSetting[] {
    return settings.map((setting) => this.cloneSetting(setting));
  }

  private sanitizeSetting(setting: SidebarActionSetting): SidebarActionSetting {
    const type = setting.type ?? "text";
    const key = setting.key?.trim() ?? "";
    const label = setting.label?.trim() ?? "";
    const id = setting.id?.trim() ? setting.id : this.nextSettingId();
    const resolvedLabel = label !== "" ? label : key !== "" ? key : "Setting";
    return {
      id,
      key,
      label: resolvedLabel,
      type,
      value: this.normalizeSettingValue(type, setting.value),
    };
  }

  private clearRunningRemovalTimer(runId: string): void {
    const handle = this.runningRemovalTimers.get(runId);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.runningRemovalTimers.delete(runId);
    }
  }

  private scheduleOneShotRemoval(runId: string): void {
    this.clearRunningRemovalTimer(runId);
    const handler = () => {
      this.runningRemovalTimers.delete(runId);
      this.completeRunningAction(runId);
    };
    const timeout = setTimeout(handler, 1500);
    this.runningRemovalTimers.set(runId, timeout);
  }

  private commitActionsState(
    updater: (state: SidebarActionsState) => SidebarActionsState,
  ): void {
    this.actionsState = updater(this.actionsState);
    this.snapshot = this.attachActionsState(this.snapshot);
    this.notify();
  }

  private completeRunningAction(runId: string): void {
    this.runningRemovalTimers.delete(runId);
    this.clearRunningController(runId);
    this.commitActionsState((state) => {
      if (!state.running.some((run) => run.id === runId)) {
        return state;
      }
      const running = state.running.filter((run) => run.id !== runId);
      const selectedRunningActionId =
        state.selectedRunningActionId === runId
          ? running[running.length - 1]?.id
          : state.selectedRunningActionId;
      return {
        ...state,
        running,
        runningRevision: state.runningRevision + 1,
        selectedRunningActionId,
      };
    });
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
    this.snapshot = this.attachActionsState({
      ...snapshot,
      currentTimeMs: snapshot.currentTimeMs ?? Date.now(),
      ships: snapshot.ships ?? [],
    });
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
      this.scheduleTradingRefresh();
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

    this.scheduleTradingRefresh();
  }

  private scheduleTradingRefresh(): void {
    if (typeof window === "undefined") {
      this.refreshFromGame();
      return;
    }

    if (this.pendingTradingRefreshHandle !== undefined) {
      return;
    }

    this.pendingTradingRefreshHandle = window.setTimeout(() => {
      this.pendingTradingRefreshHandle = undefined;
      this.refreshFromGame();
    }, 0);
  }

  createAction(): string {
    const existingCount = this.actionsState.actions.length + 1;
    const action = this.createActionDefinition({
      name: `New action ${existingCount}`,
      code:
        "// Access the game through the `game` helper\n" +
        "// This function is invoked whenever the action runs\n" +
        "export function run(context) {\n" +
        "  context.logger.info('Running action tick', context.game.tick);\n" +
        "}\n",
      runMode: "continuous",
      description: "Describe what this action does.",
      runIntervalTicks: 1,
      settings: [],
    });
    this.commitActionsState((state) => ({
      ...state,
      actions: [...state.actions, action],
      revision: state.revision + 1,
      selectedActionId: action.id,
    }));
    return action.id;
  }

  selectAction(actionId?: string): void {
    if (this.actionsState.selectedActionId === actionId) {
      return;
    }
    this.commitActionsState((state) => {
      if (state.selectedActionId === actionId) {
        return state;
      }
      return { ...state, selectedActionId: actionId };
    });
  }

  saveAction(actionId: string, update: SidebarActionDefinitionUpdate): void {
    const normalizedSettings = update.settings.map((setting) =>
      this.sanitizeSetting(setting),
    );
    const trimmedName = update.name.trim();
    const resolvedName = trimmedName === "" ? "Untitled action" : trimmedName;
    const trimmedDescription = update.description?.trim() ?? "";
    const interval = Math.max(1, Math.floor(update.runIntervalTicks ?? 1));
    this.commitActionsState((state) => {
      const index = state.actions.findIndex((action) => action.id === actionId);
      if (index === -1) {
        return state;
      }
      const current = state.actions[index];
      const next: SidebarActionDefinition = {
        ...current,
        name: resolvedName,
        code: update.code,
        runMode: update.runMode,
        description: trimmedDescription,
        runIntervalTicks: interval,
        settings: normalizedSettings.map((setting) => ({ ...setting })),
        updatedAtMs: Date.now(),
      };
      const actions = [...state.actions];
      actions[index] = next;
      return {
        ...state,
        actions,
        revision: state.revision + 1,
      };
    });
  }

  deleteAction(actionId: string): void {
    this.commitActionsState((state) => {
      const index = state.actions.findIndex((action) => action.id === actionId);
      if (index === -1) {
        return state;
      }

      const actions = state.actions.filter((action) => action.id !== actionId);
      let selectedActionId = state.selectedActionId;
      if (selectedActionId === actionId) {
        selectedActionId = actions[index]?.id ?? actions[index - 1]?.id;
      }

      const removedRuns = state.running.filter(
        (run) => run.actionId === actionId,
      );
      for (const run of removedRuns) {
        this.clearRunningRemovalTimer(run.id);
      }
      const running = removedRuns.length
        ? state.running.filter((run) => run.actionId !== actionId)
        : state.running;
      const runningRevision = removedRuns.length
        ? state.runningRevision + 1
        : state.runningRevision;
      const selectedRunningActionId = running.some(
        (run) => run.id === state.selectedRunningActionId,
      )
        ? state.selectedRunningActionId
        : running[running.length - 1]?.id;

      return {
        ...state,
        actions,
        revision: state.revision + 1,
        running,
        runningRevision,
        selectedActionId,
        selectedRunningActionId,
      };
    });
  }

  startAction(actionId: string): void {
    const action = this.actionsState.actions.find(
      (entry) => entry.id === actionId,
    );
    if (!action) {
      return;
    }

    const now = Date.now();
    const run: SidebarRunningAction = {
      id: this.nextRunningActionId(),
      actionId: action.id,
      name: action.name,
      description: action.description,
      runMode: action.runMode,
      runIntervalTicks: action.runIntervalTicks,
      status: "running",
      startedAtMs: now,
      lastUpdatedMs: now,
      settings: this.cloneSettings(action.settings),
    };

    this.commitActionsState((state) => ({
      ...state,
      running: [...state.running, run],
      runningRevision: state.runningRevision + 1,
      selectedRunningActionId: run.id,
    }));

    this.launchAction(action, run.id);
  }

  private launchAction(action: SidebarActionDefinition, runId: string): void {
    const run = this.getRunningActionEntry(runId);
    if (!run) {
      return;
    }

    if (action.runMode === "once") {
      const state: ActionExecutionState = {};
      void this.executeActionScript(action, run, state)
        .then(() => {
          this.touchRunningAction(runId);
          this.finalizeRunningAction(runId, "completed");
        })
        .catch((error) => {
          console.error("Sidebar action failed", action.name, error);
          this.finalizeRunningAction(runId, "failed");
        });
      return;
    }

    this.startContinuousRuntime(action, run);
  }

  private startContinuousRuntime(
    action: SidebarActionDefinition,
    run: SidebarRunningAction,
  ): void {
    if (typeof window === "undefined") {
      console.warn(
        "Continuous sidebar actions are unavailable outside the browser.",
      );
      this.finalizeRunningAction(run.id, "failed");
      return;
    }

    const runId = run.id;
    const runtime: RunningActionRuntime = {
      intervalTicks: Math.max(1, run.runIntervalTicks ?? 1),
      lastExecutedTick:
        this.getCurrentGameTick() - Math.max(1, run.runIntervalTicks ?? 1),
      active: true,
      state: {},
      stop: () => {
        if (!runtime.active) {
          return;
        }
        runtime.active = false;
        window.clearInterval(intervalHandle);
      },
      updateInterval: (ticks: number) => {
        const normalized = Math.max(1, Math.floor(Number(ticks) || 1));
        runtime.intervalTicks = normalized;
      },
    };

    const execute = async () => {
      if (!runtime.active) {
        return;
      }
      const currentRun = this.getRunningActionEntry(runId);
      if (!currentRun) {
        runtime.stop();
        return;
      }
      const currentTick = this.getCurrentGameTick();
      if (currentTick - runtime.lastExecutedTick < runtime.intervalTicks) {
        return;
      }
      runtime.lastExecutedTick = currentTick;
      try {
        await this.executeActionScript(action, currentRun, runtime.state);
        this.touchRunningAction(runId);
      } catch (error) {
        console.error("Sidebar action failed", action.name, error);
        this.finalizeRunningAction(runId, "failed");
      }
    };

    const intervalHandle = window.setInterval(() => {
      void execute();
    }, TICK_MILLISECONDS);

    this.actionRuntimes.set(runId, runtime);
    void execute();
  }

  selectRunningAction(runId?: string): void {
    this.commitActionsState((state) => {
      const effectiveId =
        runId && state.running.some((entry) => entry.id === runId)
          ? runId
          : undefined;
      if (state.selectedRunningActionId === effectiveId) {
        return state;
      }
      return { ...state, selectedRunningActionId: effectiveId };
    });
  }

  stopRunningAction(runId: string): void {
    const exists = this.actionsState.running.some((run) => run.id === runId);
    if (!exists) {
      return;
    }
    this.clearRunningRemovalTimer(runId);
    this.finalizeRunningAction(runId, "stopped");
  }

  updateRunningActionSetting(
    runId: string,
    settingId: string,
    value: SidebarActionSettingValue,
  ): void {
    this.commitActionsState((state) => {
      const index = state.running.findIndex((run) => run.id === runId);
      if (index === -1) {
        return state;
      }
      const entry = state.running[index];
      let changed = false;
      const settings = entry.settings.map((setting) => {
        if (setting.id !== settingId) {
          return setting;
        }
        const normalized = this.normalizeSettingValue(setting.type, value);
        if (setting.value === normalized) {
          return setting;
        }
        changed = true;
        return { ...setting, value: normalized };
      });
      if (!changed) {
        return state;
      }
      const running = [...state.running];
      running[index] = {
        ...entry,
        settings,
        lastUpdatedMs: Date.now(),
      };
      return {
        ...state,
        running,
        runningRevision: state.runningRevision + 1,
      };
    });
  }

  setRunningActionInterval(runId: string, ticks: number): void {
    const normalized = Math.max(1, Math.floor(Number(ticks) || 1));
    this.commitActionsState((state) => {
      const index = state.running.findIndex((run) => run.id === runId);
      if (index === -1) {
        return state;
      }
      const current = state.running[index];
      if (current.runIntervalTicks === normalized) {
        return state;
      }
      const running = [...state.running];
      running[index] = {
        ...current,
        runIntervalTicks: normalized,
        lastUpdatedMs: Date.now(),
      };
      return {
        ...state,
        running,
        runningRevision: state.runningRevision + 1,
      };
    });

    const runtime = this.actionRuntimes.get(runId);
    runtime?.updateInterval(normalized);
  }

  private async executeActionScript(
    action: SidebarActionDefinition,
    run: SidebarRunningAction,
    state: ActionExecutionState,
  ): Promise<void> {
    const context = this.createActionExecutionContext(run, state);
    const module = { exports: {} as unknown };
    const exports = module.exports as Record<string, unknown>;
    const evaluator = new Function(
      "game",
      "settings",
      "context",
      "exports",
      "module",
      '"use strict";\n' + action.code,
    );
    const result = evaluator(
      context.game,
      context.settings,
      context,
      exports,
      module,
    );

    const runFunction =
      this.resolveActionRunFunction(module.exports) ??
      this.resolveActionRunFunction(exports) ??
      this.resolveActionRunFunction(result);
    if (runFunction) {
      const output = runFunction(context);
      if (output && typeof (output as Promise<unknown>).then === "function") {
        await output;
      }
      return;
    }

    if (result && typeof (result as Promise<unknown>).then === "function") {
      await result;
    }
  }

  private resolveActionRunFunction(
    candidate: unknown,
  ): ((context: ActionExecutionContext) => unknown) | null {
    if (!candidate) {
      return null;
    }
    if (typeof candidate === "function") {
      return candidate as (context: ActionExecutionContext) => unknown;
    }
    if (typeof candidate === "object") {
      const run = (candidate as Record<string, unknown>).run;
      if (typeof run === "function") {
        return run as (context: ActionExecutionContext) => unknown;
      }
      const defaultExport = (candidate as Record<string, unknown>).default;
      if (typeof defaultExport === "function") {
        return defaultExport as (context: ActionExecutionContext) => unknown;
      }
    }
    return null;
  }

  private createActionExecutionContext(
    run: SidebarRunningAction,
    state: ActionExecutionState,
  ): ActionExecutionContext {
    const settings: Record<string, SidebarActionSettingValue> = {};
    for (const setting of run.settings) {
      const key = setting.key?.trim();
      if (!key) {
        continue;
      }
      settings[key] = setting.value;
    }
    return {
      game: this.buildActionGameApi(),
      settings,
      state,
      run,
      snapshot: this.snapshot,
      logger: console,
    } satisfies ActionExecutionContext;
  }

  private buildActionGameApi(): ActionGameApi {
    const players = this.snapshot.players.map((player) => ({
      id: player.id,
      name: player.name,
      isSelf: player.isSelf ?? false,
      tradeStopped: player.tradeStopped ?? false,
      tiles: player.tiles,
      gold: player.gold,
      troops: player.troops,
    }));
    const createHandler =
      (stopped: boolean) =>
      (target: string | number | Iterable<string | number>) => {
        const ids = this.normalizeTargetIds(target);
        if (ids.length === 0) {
          return;
        }
        this.setTradingStopped(ids, stopped);
      };
    return {
      players,
      tick: this.getCurrentGameTick(),
      stopTrade: createHandler(true),
      startTrade: createHandler(false),
    };
  }

  private normalizeTargetIds(
    target: string | number | Iterable<string | number>,
  ): string[] {
    if (typeof target === "string" || typeof target === "number") {
      return [String(target)];
    }
    const iterable = target as Iterable<string | number> | null;
    if (!iterable || typeof iterable[Symbol.iterator] !== "function") {
      return [];
    }
    const unique = new Set<string>();
    for (const entry of iterable) {
      if (entry === undefined || entry === null) {
        continue;
      }
      unique.add(String(entry));
    }
    return [...unique];
  }

  private getCurrentGameTick(): number {
    if (this.game && typeof this.game.ticks === "function") {
      try {
        return this.game.ticks();
      } catch (error) {
        // Ignore and fall back to a derived tick counter.
      }
    }
    const now = Date.now();
    const base = this.snapshot.currentTimeMs ?? now;
    if (!Number.isFinite(base)) {
      return 0;
    }
    return Math.max(0, Math.floor((now - base) / TICK_MILLISECONDS));
  }

  private touchRunningAction(runId: string): void {
    this.commitActionsState((state) => {
      const index = state.running.findIndex((run) => run.id === runId);
      if (index === -1) {
        return state;
      }
      const current = state.running[index];
      const next: SidebarRunningAction = {
        ...current,
        lastUpdatedMs: Date.now(),
        status: current.status === "running" ? "running" : current.status,
      };
      const running = [...state.running];
      running[index] = next;
      return {
        ...state,
        running,
        runningRevision: state.runningRevision + 1,
      };
    });
  }

  private finalizeRunningAction(
    runId: string,
    status: SidebarRunningActionStatus,
  ): void {
    this.clearRunningController(runId);
    this.clearRunningRemovalTimer(runId);
    this.commitActionsState((state) => {
      const index = state.running.findIndex((run) => run.id === runId);
      if (index === -1) {
        return state;
      }
      const current = state.running[index];
      const next: SidebarRunningAction = {
        ...current,
        status,
        lastUpdatedMs: Date.now(),
      };
      const running = [...state.running];
      running[index] = next;
      return {
        ...state,
        running,
        runningRevision: state.runningRevision + 1,
      };
    });
    this.scheduleOneShotRemoval(runId);
  }

  private clearRunningController(runId: string): void {
    const runtime = this.actionRuntimes.get(runId);
    if (!runtime) {
      return;
    }
    runtime.stop();
    this.actionRuntimes.delete(runId);
  }

  private getRunningActionEntry(
    runId: string,
  ): SidebarRunningAction | undefined {
    return this.actionsState.running.find((run) => run.id === runId);
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

      this.snapshot = this.attachActionsState({
        players: records,
        allianceDurationMs,
        currentTimeMs,
        ships,
      });
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
    const clan = extractClanTag(name);

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
