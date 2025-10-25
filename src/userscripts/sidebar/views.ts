import {
  ActionRunMode,
  GameSnapshot,
  PanelLeafNode,
  PlayerRecord,
  ShipRecord,
  SidebarActionDefinitionUpdate,
  SidebarActionSetting,
  SidebarActionSettingType,
  SidebarActionSettingValue,
  SidebarActionsState,
  SidebarRunningActionStatus,
  SortDirection,
  SortKey,
  SortState,
  TileSummary,
  ViewType,
} from "./types";
import {
  createElement,
  extractClanTag,
  focusTile,
  formatCountdown,
  formatNumber,
  formatTimestamp,
  formatTroopCount,
  showContextMenu,
} from "./utils";

type RequestRender = () => void;

type Metrics = ReturnType<typeof computePlayerMetrics>;

export interface ViewLifecycleCallbacks {
  registerCleanup?: (cleanup: () => void) => void;
}

export interface ViewActionHandlers {
  toggleTrading: (playerIds: string[], stopped: boolean) => void;
  showPlayerDetails: (playerId: string) => void;
  createAction?: () => void;
  selectAction?: (actionId?: string) => void;
  saveAction?: (
    actionId: string,
    update: SidebarActionDefinitionUpdate,
  ) => void;
  deleteAction?: (actionId: string) => void;
  startAction?: (actionId: string) => void;
  selectRunningAction?: (runningId?: string) => void;
  stopRunningAction?: (runningId: string) => void;
  updateRunningActionSetting?: (
    runningId: string,
    settingId: string,
    value: SidebarActionSettingValue,
  ) => void;
  setRunningActionInterval?: (runId: string, ticks: number) => void;
}

const DEFAULT_ACTIONS: ViewActionHandlers = {
  toggleTrading: () => undefined,
  showPlayerDetails: () => undefined,
  createAction: () => undefined,
  selectAction: () => undefined,
  saveAction: () => undefined,
  deleteAction: () => undefined,
  startAction: () => undefined,
  selectRunningAction: () => undefined,
  stopRunningAction: () => undefined,
  updateRunningActionSetting: () => undefined,
  setRunningActionInterval: () => undefined,
};

const EMPTY_ACTIONS_STATE: SidebarActionsState = {
  revision: 0,
  runningRevision: 0,
  actions: [],
  running: [],
};

interface ActionEditorSettingState {
  id: string;
  key: string;
  label: string;
  type: SidebarActionSettingType;
  value: SidebarActionSettingValue;
}

interface ActionEditorFormState {
  id: string;
  name: string;
  runMode: ActionRunMode;
  description: string;
  runIntervalTicks: number;
  code: string;
  settings: ActionEditorSettingState[];
}

type ActionEditorContainer = HTMLElement & {
  formState?: ActionEditorFormState;
};

let editorSettingIdCounter = 0;

function nextEditorSettingId(): string {
  editorSettingIdCounter += 1;
  return `editor-setting-${editorSettingIdCounter}`;
}

function getActionsState(snapshot: GameSnapshot): SidebarActionsState {
  return snapshot.sidebarActions ?? EMPTY_ACTIONS_STATE;
}

function getRunModeLabel(mode: ActionRunMode): string {
  return mode === "once" ? "Run once" : "Continuous";
}

function describeRunMode(mode: ActionRunMode): string {
  return mode === "once"
    ? "Runs a single time and removes itself from the running list."
    : "Keeps running until you stop it manually.";
}

const SELECTED_ROW_INDICATOR_BOX_SHADOW =
  "inset 0.25rem 0 0 0 rgba(125, 211, 252, 0.65)";

function applyRowSelectionIndicator(
  row: HTMLElement,
  isSelected: boolean,
): void {
  row.style.boxShadow = isSelected ? SELECTED_ROW_INDICATOR_BOX_SHADOW : "";
}

function formatRunStatus(status: SidebarRunningActionStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function defaultValueForType(
  type: SidebarActionSettingType,
): SidebarActionSettingValue {
  switch (type) {
    case "number":
      return 0;
    case "toggle":
      return false;
    default:
      return "";
  }
}

interface AggregatedRow {
  key: string;
  label: string;
  players: PlayerRecord[];
  metrics: Metrics;
  totals: {
    tiles: number;
    gold: number;
    troops: number;
  };
}

interface TableHeader {
  key: SortKey;
  label: string;
  align: "left" | "center" | "right";
}

const TABLE_HEADERS: TableHeader[] = [
  { key: "label", label: "Clan / Player", align: "left" },
  { key: "tiles", label: "Tiles", align: "right" },
  { key: "gold", label: "Gold", align: "right" },
  { key: "troops", label: "Troops", align: "right" },
  { key: "incoming", label: "⚠️", align: "center" },
  { key: "outgoing", label: "⚔️", align: "center" },
  { key: "expanding", label: "🌱", align: "center" },
  { key: "alliances", label: "🤝", align: "center" },
  { key: "disconnected", label: "📡", align: "center" },
  { key: "traitor", label: "🕱", align: "center" },
  { key: "stable", label: "🛡️", align: "center" },
  { key: "waiting", label: "⏳", align: "center" },
  { key: "eliminated", label: "☠️", align: "center" },
];

const SHIP_HEADERS: TableHeader[] = [
  { key: "label", label: "Ship", align: "left" },
  { key: "owner", label: "Owner", align: "left" },
  { key: "type", label: "Type", align: "left" },
  { key: "troops", label: "Troops", align: "right" },
  { key: "origin", label: "Origin", align: "left" },
  { key: "current", label: "Current", align: "left" },
  { key: "destination", label: "Destination", align: "left" },
  { key: "status", label: "Status", align: "left" },
];

const DEFAULT_SORT_STATE: SortState = { key: "tiles", direction: "desc" };

export function buildViewContent(
  leaf: PanelLeafNode,
  snapshot: GameSnapshot,
  requestRender: RequestRender,
  existingContainer?: HTMLElement,
  lifecycle?: ViewLifecycleCallbacks,
  actions?: ViewActionHandlers,
): HTMLElement {
  const view = leaf.view;
  const sortState = ensureSortState(leaf, view);
  const viewActions = actions ?? DEFAULT_ACTIONS;
  const handleSort = (key: SortKey) => {
    const current = ensureSortState(leaf, view);
    let direction: SortDirection;
    if (current.key === key) {
      direction = current.direction === "asc" ? "desc" : "asc";
    } else {
      direction = getDefaultDirection(key);
    }
    leaf.sortStates[view] = { key, direction };
    requestRender();
  };

  switch (leaf.view) {
    case "players":
      return renderPlayersView({
        leaf,
        snapshot,
        requestRender,
        sortState,
        onSort: handleSort,
        existingContainer,
        actions: viewActions,
        lifecycle,
      });
    case "clanmates":
      return renderClanView({
        leaf,
        snapshot,
        requestRender,
        sortState,
        onSort: handleSort,
        existingContainer,
        actions: viewActions,
        lifecycle,
      });
    case "teams":
      return renderTeamView({
        leaf,
        snapshot,
        requestRender,
        sortState,
        onSort: handleSort,
        existingContainer,
        actions: viewActions,
        lifecycle,
      });
    case "ships":
      return renderShipView({
        leaf,
        snapshot,
        requestRender,
        sortState,
        onSort: handleSort,
        existingContainer,
        actions: viewActions,
        lifecycle,
      });
    case "player":
      return renderPlayerPanelView({
        leaf,
        snapshot,
        requestRender,
        sortState,
        onSort: handleSort,
        existingContainer,
        actions: viewActions,
        lifecycle,
      });
    case "actions":
      return renderActionsDirectoryView({
        leaf,
        snapshot,
        existingContainer,
        actions: viewActions,
      });
    case "actionEditor":
      return renderActionEditorView({
        leaf,
        snapshot,
        existingContainer,
        lifecycle,
        actions: viewActions,
      });
    case "runningActions":
      return renderRunningActionsView({
        leaf,
        snapshot,
        existingContainer,
        actions: viewActions,
      });
    case "runningAction":
      return renderRunningActionDetailView({
        leaf,
        snapshot,
        existingContainer,
        lifecycle,
        actions: viewActions,
      });
    default:
      return createElement("div", "text-slate-200 text-sm", "Unsupported view");
  }
}

function ensureSortState(leaf: PanelLeafNode, view: ViewType): SortState {
  const state = leaf.sortStates[view];
  if (state) {
    return state;
  }
  const fallback = { ...DEFAULT_SORT_STATE };
  leaf.sortStates[view] = fallback;
  return fallback;
}

function getDefaultDirection(key: SortKey): SortDirection {
  switch (key) {
    case "label":
    case "owner":
    case "type":
    case "origin":
    case "current":
    case "destination":
    case "status":
      return "asc";
    default:
      return "desc";
  }
}

interface ViewRenderOptions {
  leaf: PanelLeafNode;
  snapshot: GameSnapshot;
  requestRender: RequestRender;
  sortState: SortState;
  onSort: (key: SortKey) => void;
  existingContainer?: HTMLElement;
  actions: ViewActionHandlers;
  lifecycle?: ViewLifecycleCallbacks;
}

function renderPlayersView(options: ViewRenderOptions): HTMLElement {
  const { leaf, snapshot, sortState, onSort, existingContainer, actions } =
    options;
  const metricsCache = new Map<string, Metrics>();
  const { container, tbody } = createTableShell({
    sortState,
    onSort,
    existingContainer,
    view: leaf.view,
    headers: TABLE_HEADERS,
  });
  const players = [...snapshot.players].sort((a, b) =>
    comparePlayers({ a, b, sortState, snapshot, metricsCache }),
  );

  for (const player of players) {
    appendPlayerRows({
      player,
      indent: 0,
      leaf,
      snapshot,
      tbody,
      metricsCache,
      actions,
    });
  }

  registerContextMenuDelegation(container, actions);
  return container;
}

function renderClanView(options: ViewRenderOptions): HTMLElement {
  const {
    leaf,
    snapshot,
    requestRender,
    sortState,
    onSort,
    existingContainer,
    actions,
  } = options;
  const metricsCache = new Map<string, Metrics>();
  const { container, tbody } = createTableShell({
    sortState,
    onSort,
    existingContainer,
    view: leaf.view,
    headers: TABLE_HEADERS,
  });
  const groups = groupPlayers({
    players: snapshot.players,
    snapshot,
    metricsCache,
    getKey: (player) => extractClanTag(player.name),
    sortState,
  });

  for (const group of groups) {
    appendGroupRows({
      group,
      leaf,
      snapshot,
      tbody,
      requestRender,
      groupType: "clan",
      metricsCache,
      actions,
    });
  }

  registerContextMenuDelegation(container, actions);
  return container;
}

function renderTeamView(options: ViewRenderOptions): HTMLElement {
  const {
    leaf,
    snapshot,
    requestRender,
    sortState,
    onSort,
    existingContainer,
    actions,
  } = options;
  const metricsCache = new Map<string, Metrics>();
  const { container, tbody } = createTableShell({
    sortState,
    onSort,
    existingContainer,
    view: leaf.view,
    headers: TABLE_HEADERS,
  });
  const groups = groupPlayers({
    players: snapshot.players,
    snapshot,
    metricsCache,
    getKey: (player) => player.team ?? "Solo",
    sortState,
  });

  for (const group of groups) {
    appendGroupRows({
      group,
      leaf,
      snapshot,
      tbody,
      requestRender,
      groupType: "team",
      metricsCache,
      actions,
    });
  }

  registerContextMenuDelegation(container, actions);
  return container;
}

function renderShipView(options: ViewRenderOptions): HTMLElement {
  const { leaf, snapshot, sortState, onSort, existingContainer } = options;
  const { container, tbody } = createTableShell({
    sortState,
    onSort,
    existingContainer,
    view: leaf.view,
    headers: SHIP_HEADERS,
  });
  const playerLookup = new Map(
    snapshot.players.map((player) => [player.id, player]),
  );
  const ships = [...snapshot.ships].sort((a, b) =>
    compareShips({ a, b, sortState }),
  );

  for (const ship of ships) {
    const rowKey = `ship:${ship.id}`;
    const row = createElement("tr", "hover:bg-slate-800/50 transition-colors");
    applyPersistentHover(row, leaf, rowKey, "bg-slate-800/50");
    row.dataset.rowKey = rowKey;

    for (const column of SHIP_HEADERS) {
      const td = createElement(
        "td",
        cellClassForColumn(column, getShipExtraCellClass(column.key)),
      );
      switch (column.key) {
        case "origin":
          td.appendChild(createCoordinateButton(ship.origin));
          break;
        case "current":
          td.appendChild(createCoordinateButton(ship.current));
          break;
        case "destination":
          td.appendChild(createCoordinateButton(ship.destination));
          break;
        case "owner": {
          const ownerRecord = playerLookup.get(ship.ownerId);
          td.appendChild(
            createPlayerNameElement(ship.ownerName, ownerRecord?.position, {
              className:
                "inline-flex max-w-full items-center gap-1 text-left text-slate-200 hover:text-sky-200",
            }),
          );
          break;
        }
        default:
          td.textContent = getShipCellValue(column.key, ship);
          break;
      }
      row.appendChild(td);
    }

    tbody.appendChild(row);
  }

  return container;
}

function renderPlayerPanelView(options: ViewRenderOptions): HTMLElement {
  const { leaf, snapshot, existingContainer } = options;
  const containerClass =
    "relative flex-1 overflow-auto border border-slate-900/70 bg-slate-950/60 backdrop-blur-sm";
  const canReuse =
    !!existingContainer &&
    existingContainer.dataset.sidebarRole === "player-panel" &&
    existingContainer.dataset.sidebarView === leaf.view;
  const container = canReuse
    ? existingContainer
    : createElement("div", containerClass);
  container.className = containerClass;
  container.dataset.sidebarRole = "player-panel";
  container.dataset.sidebarView = leaf.view;

  const content = createElement(
    "div",
    "flex min-h-full flex-col gap-6 p-4 text-sm text-slate-100",
  );

  const playerId = leaf.selectedPlayerId;
  if (!playerId) {
    content.appendChild(
      createElement(
        "p",
        "text-slate-400 italic",
        "Select a player from any table to view their details.",
      ),
    );
  } else {
    const player = snapshot.players.find((entry) => entry.id === playerId);
    if (!player) {
      content.appendChild(
        createElement(
          "p",
          "text-slate-400 italic",
          "That player is no longer available in the latest snapshot.",
        ),
      );
    } else {
      const header = createElement("div", "space-y-3");
      const title = createElement(
        "div",
        "flex flex-wrap items-baseline justify-between gap-3",
      );
      const name = createPlayerNameElement(player.name, player.position, {
        asBlock: true,
        className:
          "text-lg font-semibold text-slate-100 transition-colors hover:text-sky-200",
      });
      title.appendChild(name);

      const meta = [player.clan, player.team].filter(Boolean).join(" • ");
      if (meta) {
        title.appendChild(
          createElement(
            "div",
            "text-xs uppercase tracking-wide text-slate-400",
            meta,
          ),
        );
      }
      header.appendChild(title);

      const summary = createElement(
        "div",
        "grid gap-3 sm:grid-cols-3 text-[0.75rem]",
      );
      summary.appendChild(
        createSummaryStat("Tiles", formatNumber(player.tiles)),
      );
      summary.appendChild(createSummaryStat("Gold", formatNumber(player.gold)));
      summary.appendChild(
        createSummaryStat("Troops", formatTroopCount(player.troops)),
      );
      header.appendChild(summary);

      if (player.tradeStopped) {
        header.appendChild(
          createElement(
            "p",
            "text-[0.7rem] font-semibold uppercase tracking-wide text-amber-300",
            "Trading is currently stopped with this player.",
          ),
        );
      }

      content.appendChild(header);
      content.appendChild(renderPlayerDetails(player, snapshot));
    }
  }

  container.replaceChildren(content);
  return container;
}

function renderActionsDirectoryView(options: {
  leaf: PanelLeafNode;
  snapshot: GameSnapshot;
  existingContainer?: HTMLElement;
  actions: ViewActionHandlers;
}): HTMLElement {
  const { leaf, snapshot, existingContainer, actions } = options;
  const state = getActionsState(snapshot);
  const signature = `${state.revision}:${state.selectedActionId ?? ""}:${state.running.length}`;
  const isDirectoryContainer =
    !!existingContainer &&
    existingContainer.dataset.sidebarRole === "actions-directory";
  const canReuse =
    isDirectoryContainer && existingContainer.dataset.signature === signature;
  const container = isDirectoryContainer
    ? (existingContainer as HTMLElement)
    : createElement(
        "div",
        "relative flex-1 overflow-hidden border border-slate-900/70 bg-slate-950/60 backdrop-blur-sm",
      );
  container.className =
    "relative flex-1 overflow-hidden border border-slate-900/70 bg-slate-950/60 backdrop-blur-sm";
  container.dataset.sidebarRole = "actions-directory";
  container.dataset.sidebarView = leaf.view;
  if (canReuse) {
    return container;
  }
  container.dataset.signature = signature;

  const tableWrapper = createElement("div", "flex-1 overflow-auto");
  tableWrapper.dataset.sidebarRole = "table-container";
  const columns = [
    { key: "name", label: "Action", align: "left" as const },
    { key: "controls", label: "", align: "right" as const },
  ];
  const table = createElement(
    "table",
    "min-w-full border-collapse text-xs text-slate-100",
  );
  const thead = createElement("thead", "sticky top-0 z-10");
  const headerRow = createElement("tr", "bg-slate-900/95");
  for (const column of columns) {
    const alignClass = column.align === "right" ? "text-right" : "text-left";
    const th = createElement(
      "th",
      `border-b border-r border-slate-800 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-300 last:border-r-0 ${alignClass}`,
      column.label,
    );
    th.classList.add("bg-slate-900/90");
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = createElement("tbody", "text-[0.75rem]");
  const runningLookup = new Set(state.running.map((run) => run.actionId));
  const cellBaseClass =
    "border-b border-r border-slate-800 border-slate-900/80 px-3 py-2 align-top last:border-r-0";

  if (state.actions.length === 0) {
    const row = createElement("tr", "hover:bg-transparent");
    const cell = createElement(
      "td",
      `${cellBaseClass} text-center text-slate-400`,
      "No actions yet. Create a new action to get started.",
    );
    cell.colSpan = columns.length;
    row.appendChild(cell);
    tbody.appendChild(row);
  } else {
    for (const action of state.actions) {
      const isSelected = state.selectedActionId === action.id;
      const isRunning = runningLookup.has(action.id);
      const row = createElement(
        "tr",
        "cursor-pointer transition-colors hover:bg-slate-800/40",
      );
      applyRowSelectionIndicator(row, isSelected);
      row.dataset.actionId = action.id;
      row.addEventListener("click", () => {
        actions.selectAction?.(action.id);
      });

      const nameCell = createElement("td", `${cellBaseClass} text-left`);
      const nameLine = createElement(
        "div",
        "flex flex-wrap items-center gap-2",
      );
      const nameLabel = createPlayerNameElement(action.name, undefined, {
        className:
          "font-semibold text-slate-100 transition-colors hover:text-sky-200",
      });
      nameLine.appendChild(nameLabel);
      if (isRunning) {
        nameLine.appendChild(
          createElement(
            "span",
            "rounded-full bg-emerald-500/20 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-emerald-200",
            "Running",
          ),
        );
      }
      nameCell.appendChild(nameLine);
      row.appendChild(nameCell);

      const controlsCell = createElement("td", `${cellBaseClass} text-right`);
      const controls = createElement("div", "flex justify-end gap-2");
      const runButton = createElement(
        "button",
        "rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-100 transition-colors hover:bg-sky-500/20",
        "Run",
      );
      runButton.type = "button";
      runButton.addEventListener("click", (event) => {
        event.stopPropagation();
        actions.startAction?.(action.id);
      });
      controls.appendChild(runButton);

      const editButton = createElement(
        "button",
        "rounded-md border border-slate-700 bg-slate-800/70 px-3 py-1 text-xs font-medium text-slate-200 transition-colors hover:border-sky-500/60 hover:text-sky-200",
        "Edit",
      );
      editButton.type = "button";
      editButton.addEventListener("click", (event) => {
        event.stopPropagation();
        actions.selectAction?.(action.id);
      });
      controls.appendChild(editButton);
      controlsCell.appendChild(controls);
      row.appendChild(controlsCell);

      tbody.appendChild(row);
    }
  }

  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  container.replaceChildren(tableWrapper);
  return container;
}

function renderActionEditorView(options: {
  leaf: PanelLeafNode;
  snapshot: GameSnapshot;
  existingContainer?: HTMLElement;
  lifecycle?: ViewLifecycleCallbacks;
  actions: ViewActionHandlers;
}): HTMLElement {
  const { leaf, snapshot, existingContainer, actions } = options;
  const state = getActionsState(snapshot);
  const selectedAction = state.actions.find(
    (action) => action.id === state.selectedActionId,
  );
  const signature = selectedAction
    ? `${state.revision}:${selectedAction.id}:${selectedAction.updatedAtMs}`
    : `${state.revision}:none`;
  const prior = existingContainer as ActionEditorContainer | undefined;
  const isEditorContainer =
    !!prior && prior.dataset.sidebarRole === "action-editor";
  const container = isEditorContainer
    ? prior
    : (createElement(
        "div",
        "relative flex-1 overflow-auto border border-slate-900/70 bg-slate-950/60 backdrop-blur-sm",
      ) as ActionEditorContainer);
  container.className =
    "relative flex-1 overflow-auto border border-slate-900/70 bg-slate-950/60 backdrop-blur-sm";
  container.dataset.sidebarRole = "action-editor";
  container.dataset.sidebarView = leaf.view;
  if (container.dataset.signature === signature) {
    return container;
  }
  container.dataset.signature = signature;
  container.formState = undefined;

  if (!selectedAction) {
    container.replaceChildren(
      createElement(
        "div",
        "flex h-full items-center justify-center p-6 text-center text-sm text-slate-400",
        state.actions.length === 0
          ? "Create an action to begin editing its script."
          : "Select an action from the Actions view to edit its script and settings.",
      ),
    );
    return container;
  }

  const formState: ActionEditorFormState = {
    id: selectedAction.id,
    name: selectedAction.name,
    runMode: selectedAction.runMode,
    description: selectedAction.description ?? "",
    runIntervalTicks: selectedAction.runIntervalTicks ?? 1,
    code: selectedAction.code,
    settings: selectedAction.settings.map((setting) => ({
      id: setting.id ?? nextEditorSettingId(),
      key: setting.key,
      label: setting.label,
      type: setting.type,
      value: setting.value ?? defaultValueForType(setting.type),
    })),
  };
  container.formState = formState;

  const layout = createElement(
    "div",
    "flex min-h-full flex-col gap-6 p-4 text-sm text-slate-100",
  );

  const header = createElement(
    "div",
    "flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/70 pb-3",
  );
  const initialTitle = formState.name.trim();
  const titlePreview = createElement(
    "div",
    "text-lg font-semibold text-slate-100",
    initialTitle === "" ? "Untitled action" : formState.name,
  );
  const descriptionPreview = createElement(
    "div",
    "text-sm text-slate-400",
    formState.description.trim() === ""
      ? "Add a description..."
      : formState.description,
  );
  if (formState.description.trim() === "") {
    descriptionPreview.classList.add("italic", "text-slate-500");
  }
  const headerText = createElement("div", "flex flex-col gap-1");
  headerText.appendChild(titlePreview);
  headerText.appendChild(descriptionPreview);
  header.appendChild(headerText);

  const headerMeta = createElement(
    "div",
    "flex flex-col items-end gap-1 text-right text-[0.7rem] text-slate-400",
  );
  const headerMode = createElement(
    "div",
    "",
    describeRunMode(formState.runMode),
  );
  headerMeta.appendChild(headerMode);
  headerMeta.appendChild(
    createElement(
      "div",
      "text-[0.65rem] uppercase tracking-wide text-slate-500",
      `Last updated ${formatTimestamp(selectedAction.updatedAtMs)}`,
    ),
  );
  header.appendChild(headerMeta);
  layout.appendChild(header);

  const nameField = createElement("label", "flex flex-col gap-1");
  nameField.appendChild(
    createElement(
      "span",
      "text-xs uppercase tracking-wide text-slate-400",
      "Name",
    ),
  );
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className =
    "rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
  nameInput.value = formState.name;
  nameInput.addEventListener("input", () => {
    formState.name = nameInput.value;
    const trimmed = nameInput.value.trim();
    titlePreview.textContent =
      trimmed === "" ? "Untitled action" : nameInput.value;
  });
  nameField.appendChild(nameInput);
  layout.appendChild(nameField);

  const descriptionField = createElement("label", "flex flex-col gap-1");
  descriptionField.appendChild(
    createElement(
      "span",
      "text-xs uppercase tracking-wide text-slate-400",
      "Description",
    ),
  );
  const descriptionInput = document.createElement("textarea");
  descriptionInput.className =
    "min-h-[72px] w-full rounded-md border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
  descriptionInput.value = formState.description;
  descriptionInput.addEventListener("input", () => {
    formState.description = descriptionInput.value;
    const trimmed = descriptionInput.value.trim();
    if (trimmed === "") {
      descriptionPreview.textContent = "Add a description...";
      descriptionPreview.classList.add("italic", "text-slate-500");
    } else {
      descriptionPreview.textContent = descriptionInput.value;
      descriptionPreview.classList.remove("italic", "text-slate-500");
    }
  });
  descriptionField.appendChild(descriptionInput);
  layout.appendChild(descriptionField);

  const runConfigRow = createElement("div", "flex flex-wrap gap-4");

  const modeField = createElement("label", "flex flex-col gap-1");
  modeField.appendChild(
    createElement(
      "span",
      "text-xs uppercase tracking-wide text-slate-400",
      "Run mode",
    ),
  );
  const modeSelect = document.createElement("select");
  modeSelect.className =
    "w-48 rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
  for (const option of [
    { value: "continuous", label: "Continuous" },
    { value: "once", label: "Run once" },
  ]) {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    modeSelect.appendChild(opt);
  }
  modeSelect.value = formState.runMode;
  modeField.appendChild(modeSelect);
  runConfigRow.appendChild(modeField);

  const intervalField = createElement("label", "flex flex-col gap-1");
  intervalField.appendChild(
    createElement(
      "span",
      "text-xs uppercase tracking-wide text-slate-400",
      "Run every (ticks)",
    ),
  );
  const intervalInput = document.createElement("input");
  intervalInput.type = "number";
  intervalInput.min = "1";
  intervalInput.className =
    "w-40 rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
  intervalInput.value = String(formState.runIntervalTicks);
  intervalInput.addEventListener("change", () => {
    const numeric = Number(intervalInput.value);
    const normalized =
      Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 1;
    intervalInput.value = String(normalized);
    formState.runIntervalTicks = normalized;
  });
  intervalField.appendChild(intervalInput);
  if (formState.runMode !== "continuous") {
    intervalField.classList.add("hidden");
  }
  runConfigRow.appendChild(intervalField);

  modeSelect.addEventListener("change", () => {
    formState.runMode = modeSelect.value as ActionRunMode;
    headerMode.textContent = describeRunMode(formState.runMode);
    intervalField.classList.toggle(
      "hidden",
      formState.runMode !== "continuous",
    );
  });

  layout.appendChild(runConfigRow);

  const codeField = createElement("div", "flex flex-col gap-2");
  codeField.appendChild(
    createElement(
      "span",
      "text-xs uppercase tracking-wide text-slate-400",
      "Script",
    ),
  );
  const codeArea = document.createElement("textarea");
  codeArea.className =
    "min-h-[220px] w-full rounded-md border border-slate-700 bg-slate-950/80 px-3 py-2 font-mono text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
  codeArea.value = formState.code;
  codeArea.spellcheck = false;
  codeArea.addEventListener("input", () => {
    formState.code = codeArea.value;
  });
  codeField.appendChild(codeArea);
  layout.appendChild(codeField);

  const settingsSection = createElement("div", "flex flex-col gap-3");
  const settingsHeader = createElement(
    "div",
    "flex items-center justify-between gap-2",
  );
  settingsHeader.appendChild(
    createElement(
      "span",
      "text-xs uppercase tracking-wide text-slate-400",
      "Settings",
    ),
  );
  const settingsList = createElement("div", "flex flex-col gap-3");
  const removeSetting = (settingId: string) => {
    const index = formState.settings.findIndex(
      (entry) => entry.id === settingId,
    );
    if (index !== -1) {
      formState.settings.splice(index, 1);
    }
  };
  for (const setting of formState.settings) {
    settingsList.appendChild(
      createActionSettingEditorCard(formState, setting, removeSetting),
    );
  }
  const addSettingButton = createElement(
    "button",
    "rounded-md border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs font-medium text-slate-200 transition-colors hover:border-sky-500/60 hover:text-sky-200",
    "Add setting",
  );
  addSettingButton.type = "button";
  addSettingButton.addEventListener("click", () => {
    const newSetting: ActionEditorSettingState = {
      id: nextEditorSettingId(),
      key: "",
      label: "",
      type: "text",
      value: "",
    };
    formState.settings.push(newSetting);
    settingsList.appendChild(
      createActionSettingEditorCard(formState, newSetting, removeSetting),
    );
  });
  settingsHeader.appendChild(addSettingButton);
  settingsSection.appendChild(settingsHeader);
  if (formState.settings.length === 0) {
    settingsSection.appendChild(
      createElement(
        "p",
        "text-[0.75rem] text-slate-400",
        "Add settings to expose configurable values that can be adjusted while the action runs.",
      ),
    );
  }
  settingsSection.appendChild(settingsList);
  layout.appendChild(settingsSection);

  const footer = createElement(
    "div",
    "flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 pt-4",
  );
  const leftControls = createElement("div", "flex items-center gap-2");
  const runButton = createElement(
    "button",
    "rounded-md border border-sky-500/60 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-100 transition-colors hover:bg-sky-500/20",
    "Run action",
  );
  runButton.type = "button";
  runButton.addEventListener("click", () => {
    actions.startAction?.(selectedAction.id);
  });
  leftControls.appendChild(runButton);
  footer.appendChild(leftControls);

  const rightControls = createElement("div", "flex items-center gap-2");
  const deleteButton = createElement(
    "button",
    "rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-500/20",
    "Delete",
  );
  deleteButton.type = "button";
  deleteButton.addEventListener("click", () => {
    actions.deleteAction?.(selectedAction.id);
  });
  const saveButton = createElement(
    "button",
    "rounded-md border border-sky-500/60 bg-sky-500/20 px-4 py-1.5 text-xs font-semibold text-sky-100 transition-colors hover:bg-sky-500/30",
    "Save changes",
  );
  saveButton.type = "button";
  saveButton.addEventListener("click", () => {
    const update: SidebarActionDefinitionUpdate = {
      name: formState.name,
      code: formState.code,
      runMode: formState.runMode,
      description: formState.description,
      runIntervalTicks: formState.runIntervalTicks,
      settings: formState.settings.map((setting) => ({
        id: setting.id,
        key: setting.key,
        label: setting.label,
        type: setting.type,
        value:
          setting.type === "number"
            ? Number(setting.value)
            : setting.type === "toggle"
              ? Boolean(setting.value)
              : String(setting.value ?? ""),
      })),
    };
    actions.saveAction?.(selectedAction.id, update);
  });
  rightControls.appendChild(deleteButton);
  rightControls.appendChild(saveButton);
  footer.appendChild(rightControls);
  layout.appendChild(footer);

  container.replaceChildren(layout);
  return container;
}

function renderRunningActionsView(options: {
  leaf: PanelLeafNode;
  snapshot: GameSnapshot;
  existingContainer?: HTMLElement;
  actions: ViewActionHandlers;
}): HTMLElement {
  const { leaf, snapshot, existingContainer, actions } = options;
  const state = getActionsState(snapshot);
  const signature = `${state.runningRevision}:${state.selectedRunningActionId ?? ""}:${state.running.length}`;
  const isContainer =
    !!existingContainer &&
    existingContainer.dataset.sidebarRole === "running-actions";
  const canReuse =
    isContainer && existingContainer.dataset.signature === signature;
  const container = isContainer
    ? existingContainer
    : createElement(
        "div",
        "relative flex-1 overflow-hidden border border-slate-900/70 bg-slate-950/60 backdrop-blur-sm",
      );
  container.className =
    "relative flex-1 overflow-hidden border border-slate-900/70 bg-slate-950/60 backdrop-blur-sm";
  container.dataset.sidebarRole = "running-actions";
  container.dataset.sidebarView = leaf.view;
  if (canReuse) {
    return container;
  }
  container.dataset.signature = signature;

  const tableWrapper = createElement("div", "flex-1 overflow-auto");
  tableWrapper.dataset.sidebarRole = "table-container";
  if (state.running.length === 0) {
    tableWrapper.replaceChildren(
      createElement(
        "div",
        "flex h-full items-center justify-center px-4 py-8 text-center text-sm text-slate-400",
        "No actions are currently running.",
      ),
    );
    container.replaceChildren(tableWrapper);
    return container;
  }

  const table = createElement(
    "table",
    "min-w-full border-collapse text-xs text-slate-100",
  );
  const thead = createElement("thead", "sticky top-0 z-10");
  const headerRow = createElement("tr", "bg-slate-900/95");
  const columns = [
    { key: "name", label: "Action", align: "left" as const },
    { key: "mode", label: "Mode", align: "left" as const },
    { key: "started", label: "Started", align: "left" as const },
    { key: "controls", label: "", align: "right" as const },
  ];
  for (const column of columns) {
    const alignClass = column.align === "right" ? "text-right" : "text-left";
    const th = createElement(
      "th",
      `border-b border-r border-slate-800 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-300 last:border-r-0 ${alignClass}`,
      column.label,
    );
    th.classList.add("bg-slate-900/90");
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = createElement("tbody", "text-[0.75rem]");
  const cellBaseClass =
    "border-b border-r border-slate-800 border-slate-900/80 px-3 py-2 align-top last:border-r-0";
  for (const run of state.running) {
    const isSelected = state.selectedRunningActionId === run.id;
    const row = createElement(
      "tr",
      "cursor-pointer transition-colors hover:bg-slate-800/40",
    );
    applyRowSelectionIndicator(row, isSelected);
    row.dataset.runningActionId = run.id;
    row.addEventListener("click", () => {
      actions.selectRunningAction?.(run.id);
    });

    const nameCell = createElement("td", `${cellBaseClass} text-left`);
    const nameLine = createElement("div", "flex flex-wrap items-center gap-2");
    const nameLabel = createPlayerNameElement(run.name, undefined, {
      className:
        "font-semibold text-slate-100 transition-colors hover:text-sky-200",
    });
    nameLine.appendChild(nameLabel);
    nameLine.appendChild(createRunStatusBadge(run.status));
    nameCell.appendChild(nameLine);
    row.appendChild(nameCell);
    row.appendChild(
      createElement(
        "td",
        `${cellBaseClass} text-[0.75rem] uppercase tracking-wide text-slate-400`,
        getRunModeLabel(run.runMode),
      ),
    );
    row.appendChild(
      createElement(
        "td",
        `${cellBaseClass} text-[0.75rem] text-slate-300`,
        formatTimestamp(run.startedAtMs),
      ),
    );

    const controlsCell = createElement("td", `${cellBaseClass} text-right`);
    const stopButton = createElement(
      "button",
      "rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-500/20",
      "Stop",
    );
    stopButton.type = "button";
    stopButton.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.stopRunningAction?.(run.id);
    });
    if (run.status !== "running") {
      stopButton.disabled = true;
      stopButton.classList.add("cursor-not-allowed", "opacity-50");
    }
    controlsCell.appendChild(stopButton);
    row.appendChild(controlsCell);

    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  tableWrapper.replaceChildren(table);

  container.replaceChildren(tableWrapper);
  return container;
}

function renderRunningActionDetailView(options: {
  leaf: PanelLeafNode;
  snapshot: GameSnapshot;
  existingContainer?: HTMLElement;
  lifecycle?: ViewLifecycleCallbacks;
  actions: ViewActionHandlers;
}): HTMLElement {
  const { leaf, snapshot, existingContainer, actions } = options;
  const state = getActionsState(snapshot);
  const selectedRun = state.running.find(
    (run) => run.id === state.selectedRunningActionId,
  );
  const signature = selectedRun
    ? `${state.runningRevision}:${selectedRun.id}:${selectedRun.lastUpdatedMs}`
    : `${state.runningRevision}:none`;
  const isContainer =
    !!existingContainer &&
    existingContainer.dataset.sidebarRole === "running-action";
  const container = isContainer
    ? existingContainer
    : createElement(
        "div",
        "relative flex-1 overflow-auto border border-slate-900/70 bg-slate-950/60 backdrop-blur-sm",
      );
  container.className =
    "relative flex-1 overflow-auto border border-slate-900/70 bg-slate-950/60 backdrop-blur-sm";
  container.dataset.sidebarRole = "running-action";
  container.dataset.sidebarView = leaf.view;
  if (container.dataset.signature === signature) {
    return container;
  }
  container.dataset.signature = signature;

  if (!selectedRun) {
    container.replaceChildren(
      createElement(
        "div",
        "flex h-full items-center justify-center p-6 text-center text-sm text-slate-400",
        state.running.length === 0
          ? "No actions are currently running."
          : "Select a running action to adjust its settings.",
      ),
    );
    return container;
  }

  const layout = createElement(
    "div",
    "flex min-h-full flex-col gap-6 p-4 text-sm text-slate-100",
  );

  const header = createElement(
    "div",
    "flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/70 pb-3",
  );
  const headerText = createElement("div", "flex flex-col gap-1");
  const titleLine = createElement(
    "div",
    "flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-100",
  );
  titleLine.appendChild(createElement("span", "", selectedRun.name));
  titleLine.appendChild(createRunStatusBadge(selectedRun.status));
  headerText.appendChild(titleLine);
  const trimmedDescription = selectedRun.description?.trim() ?? "";
  if (trimmedDescription !== "") {
    headerText.appendChild(
      createElement("div", "text-sm text-slate-400", trimmedDescription),
    );
  }
  headerText.appendChild(
    createElement(
      "div",
      "text-[0.7rem] text-slate-400",
      describeRunMode(selectedRun.runMode),
    ),
  );
  header.appendChild(headerText);
  const stopButton = createElement(
    "button",
    "rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-500/20",
    "Stop action",
  );
  stopButton.type = "button";
  stopButton.addEventListener("click", () => {
    actions.stopRunningAction?.(selectedRun.id);
  });
  if (selectedRun.status !== "running") {
    stopButton.disabled = true;
    stopButton.classList.add("cursor-not-allowed", "opacity-50");
  }
  header.appendChild(stopButton);
  layout.appendChild(header);

  const meta = createElement("div", "grid gap-3 text-[0.75rem] sm:grid-cols-3");
  meta.appendChild(
    createSummaryStat("Status", formatRunStatus(selectedRun.status)),
  );
  meta.appendChild(
    createSummaryStat("Started", formatTimestamp(selectedRun.startedAtMs)),
  );
  meta.appendChild(
    createSummaryStat(
      "Last update",
      formatTimestamp(selectedRun.lastUpdatedMs),
    ),
  );
  layout.appendChild(meta);

  if (selectedRun.runMode === "continuous") {
    const intervalField = createElement(
      "label",
      "flex w-full max-w-xs flex-col gap-1",
    );
    intervalField.appendChild(
      createElement(
        "span",
        "text-xs uppercase tracking-wide text-slate-400",
        "Run every (ticks)",
      ),
    );
    const intervalInput = document.createElement("input");
    intervalInput.type = "number";
    intervalInput.min = "1";
    intervalInput.className =
      "w-full rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
    intervalInput.value = String(selectedRun.runIntervalTicks ?? 1);
    intervalInput.addEventListener("change", () => {
      const numeric = Number(intervalInput.value);
      const normalized =
        Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 1;
      intervalInput.value = String(normalized);
      if (normalized === selectedRun.runIntervalTicks) {
        return;
      }
      actions.setRunningActionInterval?.(selectedRun.id, normalized);
    });
    intervalField.appendChild(intervalInput);
    layout.appendChild(intervalField);
  }

  const settingsSection = createElement("div", "flex flex-col gap-3");
  settingsSection.appendChild(
    createElement(
      "span",
      "text-xs uppercase tracking-wide text-slate-400",
      "Runtime settings",
    ),
  );
  const settingsList = createElement("div", "flex flex-col gap-3");
  if (selectedRun.settings.length === 0) {
    settingsList.appendChild(
      createElement(
        "p",
        "text-[0.75rem] text-slate-400",
        "This action does not expose any runtime settings.",
      ),
    );
  } else {
    for (const setting of selectedRun.settings) {
      settingsList.appendChild(
        createRunningSettingField(selectedRun.id, setting, actions),
      );
    }
  }
  settingsSection.appendChild(settingsList);
  layout.appendChild(settingsSection);

  container.replaceChildren(layout);
  return container;
}

function createActionSettingEditorCard(
  formState: ActionEditorFormState,
  setting: ActionEditorSettingState,
  onRemove: (settingId: string) => void,
): HTMLElement {
  const card = createElement(
    "div",
    "rounded-md border border-slate-800/70 bg-slate-900/70 p-3",
  );
  const header = createElement("div", "flex flex-wrap items-center gap-3");

  const labelField = createElement(
    "label",
    "flex min-w-[160px] flex-1 flex-col gap-1",
  );
  labelField.appendChild(
    createElement(
      "span",
      "text-[0.65rem] uppercase tracking-wide text-slate-400",
      "Label",
    ),
  );
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className =
    "rounded-md border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
  labelInput.value = setting.label;
  labelInput.addEventListener("input", () => {
    setting.label = labelInput.value;
  });
  labelField.appendChild(labelInput);
  header.appendChild(labelField);

  const keyField = createElement("label", "flex w-36 flex-col gap-1");
  keyField.appendChild(
    createElement(
      "span",
      "text-[0.65rem] uppercase tracking-wide text-slate-400",
      "Key",
    ),
  );
  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className =
    "rounded-md border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
  keyInput.value = setting.key;
  keyInput.addEventListener("input", () => {
    setting.key = keyInput.value;
  });
  keyField.appendChild(keyInput);
  header.appendChild(keyField);

  const typeField = createElement("label", "flex w-32 flex-col gap-1");
  typeField.appendChild(
    createElement(
      "span",
      "text-[0.65rem] uppercase tracking-wide text-slate-400",
      "Type",
    ),
  );
  const typeSelect = document.createElement("select");
  typeSelect.className =
    "rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
  for (const option of [
    { value: "text", label: "Text" },
    { value: "number", label: "Number" },
    { value: "toggle", label: "Toggle" },
  ]) {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    typeSelect.appendChild(opt);
  }
  typeSelect.value = setting.type;
  typeField.appendChild(typeSelect);
  header.appendChild(typeField);

  const removeButton = createElement(
    "button",
    "rounded-md border border-slate-700 bg-transparent px-2 py-1 text-xs text-slate-300 transition-colors hover:border-rose-500/60 hover:text-rose-300",
    "Remove",
  );
  removeButton.type = "button";
  removeButton.addEventListener("click", (event) => {
    event.preventDefault();
    onRemove(setting.id);
    card.remove();
  });
  header.appendChild(removeButton);
  card.appendChild(header);

  const valueWrapper = createElement("div", "mt-3 flex flex-col gap-1");
  valueWrapper.appendChild(
    createElement(
      "span",
      "text-[0.65rem] uppercase tracking-wide text-slate-400",
      "Value",
    ),
  );
  const valueContainer = createElement("div", "flex items-center gap-2");
  const updateValue = (value: SidebarActionSettingValue) => {
    setting.value = value;
  };
  let control = createSettingValueInput(setting, updateValue);
  valueContainer.appendChild(control);
  valueWrapper.appendChild(valueContainer);
  card.appendChild(valueWrapper);

  typeSelect.addEventListener("change", () => {
    const nextType = typeSelect.value as SidebarActionSettingType;
    setting.type = nextType;
    setting.value = defaultValueForType(nextType);
    control = createSettingValueInput(setting, updateValue);
    valueContainer.replaceChildren(control);
  });

  return card;
}

function createSettingValueInput(
  setting: ActionEditorSettingState,
  onChange: (value: SidebarActionSettingValue) => void,
): HTMLElement {
  switch (setting.type) {
    case "number": {
      const input = document.createElement("input");
      input.type = "number";
      input.className =
        "w-40 rounded-md border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
      input.value = setting.value !== undefined ? String(setting.value) : "0";
      input.addEventListener("change", () => {
        const numeric = Number(input.value);
        onChange(Number.isFinite(numeric) ? numeric : 0);
      });
      return input;
    }
    case "toggle": {
      const wrapper = createElement(
        "label",
        "flex items-center gap-2 text-xs text-slate-200",
      );
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.className =
        "h-4 w-4 rounded border border-slate-600 bg-slate-900 text-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500";
      toggle.checked = Boolean(setting.value);
      toggle.addEventListener("change", () => {
        onChange(toggle.checked);
      });
      wrapper.appendChild(toggle);
      wrapper.appendChild(createElement("span", "", "Enabled"));
      return wrapper;
    }
    default: {
      const input = document.createElement("input");
      input.type = "text";
      input.className =
        "w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
      input.value = setting.value !== undefined ? String(setting.value) : "";
      input.addEventListener("input", () => {
        onChange(input.value);
      });
      return input;
    }
  }
}

function createRunningSettingField(
  runId: string,
  setting: SidebarActionSetting,
  actions: ViewActionHandlers,
): HTMLElement {
  const field = createElement(
    "div",
    "rounded-md border border-slate-800/70 bg-slate-900/70 p-3",
  );
  const header = createElement(
    "div",
    "flex items-center justify-between gap-2",
  );
  const rawLabel = setting.label?.trim() ?? "";
  const rawKey = setting.key?.trim() ?? "";
  const displayLabel =
    rawLabel !== "" ? rawLabel : rawKey !== "" ? rawKey : "Setting";
  header.appendChild(
    createElement("div", "text-sm font-medium text-slate-100", displayLabel),
  );
  header.appendChild(
    createElement(
      "span",
      "text-[0.65rem] uppercase tracking-wide text-slate-400",
      setting.type,
    ),
  );
  field.appendChild(header);
  if (setting.key) {
    field.appendChild(
      createElement(
        "div",
        "text-[0.65rem] text-slate-500",
        `Key: ${setting.key}`,
      ),
    );
  }

  const controlContainer = createElement("div", "mt-3");
  switch (setting.type) {
    case "number": {
      const input = document.createElement("input");
      input.type = "number";
      input.className =
        "w-40 rounded-md border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
      input.value = setting.value !== undefined ? String(setting.value) : "0";
      input.addEventListener("change", () => {
        const numeric = Number(input.value);
        actions.updateRunningActionSetting?.(
          runId,
          setting.id,
          Number.isFinite(numeric) ? numeric : 0,
        );
      });
      controlContainer.appendChild(input);
      break;
    }
    case "toggle": {
      const wrapper = createElement(
        "label",
        "flex items-center gap-2 text-xs text-slate-200",
      );
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.className =
        "h-4 w-4 rounded border border-slate-600 bg-slate-900 text-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500";
      toggle.checked = Boolean(setting.value);
      toggle.addEventListener("change", () => {
        actions.updateRunningActionSetting?.(runId, setting.id, toggle.checked);
      });
      wrapper.appendChild(toggle);
      wrapper.appendChild(createElement("span", "", "Enabled"));
      controlContainer.appendChild(wrapper);
      break;
    }
    default: {
      const input = document.createElement("input");
      input.type = "text";
      input.className =
        "w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70";
      input.value = setting.value !== undefined ? String(setting.value) : "";
      input.addEventListener("change", () => {
        actions.updateRunningActionSetting?.(runId, setting.id, input.value);
      });
      controlContainer.appendChild(input);
      break;
    }
  }

  field.appendChild(controlContainer);
  return field;
}

function createTableShell(options: {
  sortState: SortState;
  onSort: (key: SortKey) => void;
  existingContainer?: HTMLElement;
  view: ViewType;
  headers: TableHeader[];
}): { container: HTMLElement; tbody: HTMLElement } {
  const { sortState, onSort, existingContainer, view, headers } = options;
  const containerClass =
    "relative flex-1 overflow-auto border border-slate-900/70 bg-slate-950/60 backdrop-blur-sm";
  const tableClass = "min-w-full border-collapse text-xs text-slate-100";
  const canReuse =
    !!existingContainer &&
    existingContainer.dataset.sidebarRole === "table-container" &&
    existingContainer.dataset.sidebarView === view;
  const container = canReuse
    ? existingContainer
    : createElement("div", containerClass);
  container.className = containerClass;
  container.dataset.sidebarRole = "table-container";
  container.dataset.sidebarView = view;

  let table = container.querySelector("table") as HTMLTableElement | null;
  if (!table || !canReuse) {
    table = createElement("table", tableClass);
  } else {
    table.className = tableClass;
  }

  const thead = table.tHead ?? createElement("thead", "sticky top-0 z-10");
  thead.className = "sticky top-0 z-10";
  thead.replaceChildren();
  const headerRow = createElement("tr", "bg-slate-900/95");
  for (const column of headers) {
    const th = createElement(
      "th",
      `border-b border-r border-slate-800 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-300 last:border-r-0 ${
        column.align === "left"
          ? "text-left"
          : column.align === "right"
            ? "text-right"
            : "text-center"
      }`,
    );
    th.classList.add("bg-slate-900/90", "cursor-pointer", "select-none");
    th.dataset.sortKey = column.key;
    const button = createElement(
      "span",
      `flex w-full items-center gap-1 text-inherit ${
        column.align === "left"
          ? "justify-start"
          : column.align === "right"
            ? "justify-end"
            : "justify-center"
      }`,
      column.label,
    );
    const isActive = sortState.key === column.key;
    const indicator = createElement(
      "span",
      `text-[0.6rem] ${isActive ? "text-sky-300" : "text-slate-500"}`,
      isActive ? (sortState.direction === "asc" ? "▲" : "▼") : "↕",
    );
    if (column.align === "right") {
      button.appendChild(indicator);
    } else {
      button.insertBefore(indicator, button.firstChild);
    }
    th.appendChild(button);
    th.addEventListener("click", (event) => {
      event.preventDefault();
      onSort(column.key);
    });
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  const tbody = table.tBodies[0] ?? createElement("tbody", "text-[0.75rem]");
  tbody.className = "text-[0.75rem]";
  tbody.replaceChildren();

  if (!table.contains(thead)) {
    table.appendChild(thead);
  }
  if (!table.contains(tbody)) {
    table.appendChild(tbody);
  }

  if (
    container.firstElementChild !== table ||
    container.childElementCount !== 1
  ) {
    container.replaceChildren(table);
  }

  return { container, tbody };
}

function getShipExtraCellClass(key: SortKey): string {
  switch (key) {
    case "label":
      return "font-semibold text-slate-100";
    case "owner":
      return "text-slate-200";
    case "type":
      return "text-[0.75rem] text-slate-300";
    case "troops":
      return "font-mono text-[0.75rem] text-slate-200";
    case "status":
      return "capitalize text-slate-200";
    case "origin":
    case "current":
    case "destination":
      return "text-[0.75rem] text-slate-300";
    default:
      return "text-slate-300";
  }
}

function attachImmediateTileFocus(
  element: HTMLButtonElement,
  focus: () => void,
): void {
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    focus();
  });
  element.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.detail === 0) {
      focus();
    }
  });
}

function createCoordinateButton(summary?: TileSummary): HTMLElement {
  if (!summary) {
    return createElement("span", "text-slate-500", "–");
  }
  const label = formatTileSummary(summary);
  const button = createElement(
    "button",
    "inline-flex max-w-full items-center rounded-sm px-0 text-left text-sky-300 transition-colors hover:text-sky-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60",
    label,
  );
  button.type = "button";
  button.title = `Focus on ${label}`;
  attachImmediateTileFocus(button, () => {
    focusTile(summary);
  });
  return button;
}

function createPlayerNameElement(
  label: string,
  position: TileSummary | undefined,
  options?: { className?: string; asBlock?: boolean },
): HTMLElement {
  const classNames: string[] = [];
  if (options?.className) {
    classNames.push(options.className);
  }
  if (position) {
    classNames.push(
      "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 rounded-sm transition-colors",
    );
  }
  const className = classNames.filter(Boolean).join(" ").trim();

  if (!position) {
    const tag = options?.asBlock ? "div" : "span";
    return createElement(tag as "div" | "span", className, label);
  }

  const button = createElement("button", className, label);
  button.type = "button";
  button.title = `Focus on ${label}`;
  attachImmediateTileFocus(button, () => {
    focusTile(position);
  });
  return button;
}

function getShipCellValue(key: SortKey, ship: ShipRecord): string {
  switch (key) {
    case "label":
      return `${ship.type} #${ship.id}`;
    case "owner":
      return ship.ownerName;
    case "type":
      return ship.type;
    case "troops":
      return formatTroopCount(ship.troops);
    case "origin":
      return formatTileSummary(ship.origin);
    case "current":
      return formatTileSummary(ship.current);
    case "destination":
      return formatTileSummary(ship.destination);
    case "status":
      return deriveShipStatus(ship);
    default:
      return "";
  }
}

function compareShips(options: {
  a: ShipRecord;
  b: ShipRecord;
  sortState: SortState;
}): number {
  const { a, b, sortState } = options;
  const valueA = getShipSortValue(a, sortState.key);
  const valueB = getShipSortValue(b, sortState.key);
  const result = compareSortValues(valueA, valueB, sortState.direction);
  if (result !== 0) {
    return result;
  }
  const ownerCompare = a.ownerName.localeCompare(b.ownerName, undefined, {
    sensitivity: "base",
  });
  if (ownerCompare !== 0) {
    return ownerCompare;
  }
  return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
}

function getShipSortValue(ship: ShipRecord, key: SortKey): number | string {
  switch (key) {
    case "label":
      return `${ship.type.toLowerCase()}-${ship.id}`;
    case "owner":
      return ship.ownerName.toLowerCase();
    case "type":
      return ship.type.toLowerCase();
    case "troops":
      return ship.troops;
    case "origin":
      return tileSortValue(ship.origin);
    case "current":
      return tileSortValue(ship.current);
    case "destination":
      return tileSortValue(ship.destination);
    case "status":
      return deriveShipStatus(ship).toLowerCase();
    default:
      return 0;
  }
}

function tileSortValue(summary?: TileSummary): string {
  if (!summary) {
    return "";
  }
  const x = summary.x.toString().padStart(5, "0");
  const y = summary.y.toString().padStart(5, "0");
  const owner = summary.ownerName?.toLowerCase() ?? "";
  return `${x}:${y}:${owner}`;
}

function formatTileSummary(summary?: TileSummary): string {
  if (!summary) {
    return "–";
  }
  const coords = `${summary.x}, ${summary.y}`;
  return summary.ownerName ? `${coords} (${summary.ownerName})` : coords;
}

function deriveShipStatus(ship: ShipRecord): string {
  if (ship.retreating) {
    return "Retreating";
  }
  if (ship.reachedTarget) {
    return "Arrived";
  }
  if (ship.type === "Transport") {
    return "En Route";
  }
  if (!ship.destination) {
    return ship.current ? "Idle" : "Unknown";
  }
  if (
    ship.current &&
    ship.destination &&
    ship.current.ref === ship.destination.ref
  ) {
    return "Stationed";
  }
  return "En route";
}

interface PlayerContextTarget {
  id: string;
  name: string;
  tradeStopped: boolean;
  isSelf: boolean;
}

interface GroupContextTarget {
  label: string;
  players: PlayerRecord[];
}

const tableContextActions = new WeakMap<HTMLElement, ViewActionHandlers>();
const playerContextTargets = new WeakMap<HTMLElement, PlayerContextTarget>();
const groupContextTargets = new WeakMap<HTMLElement, GroupContextTarget>();

function findContextMenuTarget(
  event: MouseEvent,
  container: HTMLElement,
): { element: HTMLElement; type: "player" | "group" } | null {
  if (event.target instanceof HTMLElement && container.contains(event.target)) {
    let current: HTMLElement | null = event.target;
    while (current && current !== container) {
      const type = current.dataset.contextTarget;
      if (type === "player" || type === "group") {
        return { element: current, type };
      }
      current = current.parentElement;
    }
  }

  const composedPath =
    typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const node of composedPath) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (!container.contains(node)) {
      continue;
    }
    const type = node.dataset.contextTarget;
    if (type === "player" || type === "group") {
      return { element: node, type };
    }
  }

  return null;
}

function registerContextMenuDelegation(
  container: HTMLElement,
  actions: ViewActionHandlers,
): void {
  tableContextActions.set(container, actions);
  if (container.dataset.contextMenuDelegated === "true") {
    return;
  }

  const handleContextMenu = (event: MouseEvent) => {
    const tableContainer = event.currentTarget as HTMLElement;
    const activeActions = tableContextActions.get(tableContainer);
    if (!activeActions) {
      return;
    }

    const targetInfo = findContextMenuTarget(event, tableContainer);
    if (!targetInfo) {
      return;
    }

    if (targetInfo.type === "player") {
      const target = playerContextTargets.get(targetInfo.element);
      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const nextStopped = !target.tradeStopped;
      const disabled = target.isSelf;
      const actionLabel = nextStopped ? "Stop trading" : "Start trading";
      showContextMenu({
        x: event.clientX,
        y: event.clientY,
        title: target.name,
        items: [
          {
            label: actionLabel,
            disabled,
            tooltip: disabled
              ? "You cannot toggle trading with yourself."
              : undefined,
            onSelect: disabled
              ? undefined
              : () => activeActions.toggleTrading([target.id], nextStopped),
          },
        ],
      });
      return;
    }

    const target = groupContextTargets.get(targetInfo.element);
    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (target.players.length === 0) {
      showContextMenu({
        x: event.clientX,
        y: event.clientY,
        title: target.label,
        items: [
          {
            label: "Stop trading",
            disabled: true,
            tooltip: "No eligible players in this group.",
          },
        ],
      });
      return;
    }

    const tradingPlayers = target.players.filter(
      (player) => !(player.tradeStopped ?? false),
    );
    const stoppedPlayers = target.players.filter(
      (player) => player.tradeStopped ?? false,
    );

    const buildIdList = (players: PlayerRecord[]) =>
      Array.from(new Set(players.map((player) => player.id)));

    const items = [] as {
      label: string;
      onSelect?: () => void;
      disabled?: boolean;
      tooltip?: string;
    }[];

    if (tradingPlayers.length > 0) {
      const ids = buildIdList(tradingPlayers);
      items.push({
        label:
          tradingPlayers.length === target.players.length
            ? "Stop trading"
            : `Stop trading (${tradingPlayers.length})`,
        onSelect: () => activeActions.toggleTrading(ids, true),
      });
    }

    if (stoppedPlayers.length > 0) {
      const ids = buildIdList(stoppedPlayers);
      items.push({
        label:
          stoppedPlayers.length === target.players.length
            ? "Start trading"
            : `Start trading (${stoppedPlayers.length})`,
        onSelect: () => activeActions.toggleTrading(ids, false),
      });
    }

    if (!items.length) {
      items.push({
        label: "Stop trading",
        disabled: true,
        tooltip: "No eligible players in this group.",
      });
    }

    showContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: target.label,
      items,
    });
  };

  container.addEventListener("contextmenu", handleContextMenu);
  container.dataset.contextMenuDelegated = "true";
}

function appendPlayerRows(options: {
  player: PlayerRecord;
  indent: number;
  leaf: PanelLeafNode;
  snapshot: GameSnapshot;
  tbody: HTMLElement;
  metricsCache: Map<string, Metrics>;
  actions: ViewActionHandlers;
}) {
  const { player, indent, leaf, snapshot, tbody, metricsCache, actions } =
    options;
  const metrics = getMetrics(player, snapshot, metricsCache);
  const rowKey = player.id;

  const tr = createElement("tr", "hover:bg-slate-800/50 transition-colors");
  tr.dataset.rowKey = rowKey;
  applyPersistentHover(tr, leaf, rowKey, "bg-slate-800/50");

  tr.dataset.contextTarget = "player";
  playerContextTargets.set(tr, {
    id: player.id,
    name: player.name,
    tradeStopped: player.tradeStopped ?? false,
    isSelf: player.isSelf ?? false,
  });

  const firstCell = createElement(
    "td",
    "border-b border-r border-slate-800 border-slate-900/80 px-3 py-2 align-top last:border-r-0",
  );
  firstCell.appendChild(
    createLabelBlock({
      label: player.name,
      subtitle:
        [player.clan, player.team].filter(Boolean).join(" • ") || undefined,
      indent,
      focus: player.position,
    }),
  );
  tr.appendChild(firstCell);

  appendMetricCells(tr, metrics, player);
  tbody.appendChild(tr);

  tr.addEventListener("click", () => {
    actions.showPlayerDetails(player.id);
  });
}

function appendGroupRows(options: {
  group: AggregatedRow;
  leaf: PanelLeafNode;
  snapshot: GameSnapshot;
  tbody: HTMLElement;
  requestRender: RequestRender;
  groupType: "clan" | "team";
  metricsCache: Map<string, Metrics>;
  actions: ViewActionHandlers;
}) {
  const {
    group,
    leaf,
    snapshot,
    tbody,
    requestRender,
    groupType,
    metricsCache,
    actions,
  } = options;
  const groupKey = `${groupType}:${group.key}`;
  const expanded = leaf.expandedGroups.has(groupKey);

  const row = createElement(
    "tr",
    "bg-slate-900/70 hover:bg-slate-800/60 transition-colors font-semibold",
  );
  row.dataset.groupKey = groupKey;
  applyPersistentHover(row, leaf, groupKey, "bg-slate-800/60");

  const eligiblePlayers = group.players.filter((player) => !player.isSelf);
  row.dataset.contextTarget = "group";
  groupContextTargets.set(row, {
    label: group.label,
    players: eligiblePlayers,
  });

  const firstCell = createElement(
    "td",
    "border-b border-r border-slate-800 border-slate-900/80 px-3 py-2 align-top last:border-r-0",
  );
  firstCell.appendChild(
    createLabelBlock({
      label: `${group.label} (${group.players.length})`,
      subtitle: groupType === "clan" ? "Clan summary" : "Team summary",
      indent: 0,
      expanded,
      toggleAttribute: "data-group-toggle",
      rowKey: groupKey,
      onToggle: (next) => {
        if (next) {
          leaf.expandedGroups.add(groupKey);
        } else {
          leaf.expandedGroups.delete(groupKey);
        }
        requestRender();
      },
    }),
  );
  row.appendChild(firstCell);

  appendAggregateCells(row, group.metrics, group.totals);
  tbody.appendChild(row);

  if (expanded) {
    for (const player of group.players) {
      appendPlayerRows({
        player,
        indent: 1,
        leaf,
        snapshot,
        tbody,
        metricsCache,
        actions,
      });
    }
  }
}

function applyPersistentHover(
  element: HTMLElement,
  leaf: PanelLeafNode,
  rowKey: string,
  highlightClass: string,
): void {
  element.dataset.hoverHighlightClass = highlightClass;
  if (leaf.hoveredRowKey === rowKey) {
    if (leaf.hoveredRowElement && leaf.hoveredRowElement !== element) {
      const previousClass = leaf.hoveredRowElement.dataset.hoverHighlightClass;
      if (previousClass) {
        leaf.hoveredRowElement.classList.remove(previousClass);
      }
    }
    leaf.hoveredRowElement = element;
    element.classList.add(highlightClass);
  }
  element.addEventListener("pointerenter", () => {
    if (leaf.hoveredRowElement && leaf.hoveredRowElement !== element) {
      const previousClass = leaf.hoveredRowElement.dataset.hoverHighlightClass;
      if (previousClass) {
        leaf.hoveredRowElement.classList.remove(previousClass);
      }
    }
    leaf.hoveredRowKey = rowKey;
    leaf.hoveredRowElement = element;
    element.classList.add(highlightClass);
  });
}

function appendMetricCells(
  row: HTMLTableRowElement,
  metrics: Metrics,
  player: PlayerRecord,
) {
  for (const column of TABLE_HEADERS.slice(1)) {
    const extraClasses = [getExtraCellClass(column.key, false)];
    if (column.key === "incoming" && metrics.incoming > 0) {
      extraClasses.push("bg-red-500 text-white");
    }
    const td = createElement(
      "td",
      cellClassForColumn(column, extraClasses.filter(Boolean).join(" ")),
    );
    td.textContent = getPlayerCellValue(column.key, metrics, player);
    row.appendChild(td);
  }
}

function appendAggregateCells(
  row: HTMLTableRowElement,
  metrics: Metrics,
  totals: AggregatedRow["totals"],
) {
  for (const column of TABLE_HEADERS.slice(1)) {
    const extraClasses = [getExtraCellClass(column.key, true)];
    if (column.key === "incoming" && metrics.incoming > 0) {
      extraClasses.push("bg-red-500 text-white");
    }
    const td = createElement(
      "td",
      cellClassForColumn(column, extraClasses.filter(Boolean).join(" ")),
    );
    td.textContent = getAggregateCellValue(column.key, metrics, totals);
    row.appendChild(td);
  }
}

function renderPlayerDetails(
  player: PlayerRecord,
  snapshot: GameSnapshot,
): HTMLElement {
  const wrapper = createElement(
    "div",
    "space-y-4 text-[0.75rem] text-slate-100",
  );

  const metrics = computePlayerMetrics(player, snapshot);
  const badgeRow = createElement("div", "flex flex-wrap gap-2");
  badgeRow.appendChild(createBadge("⚠️ Incoming", metrics.incoming));
  badgeRow.appendChild(createBadge("⚔️ Outgoing", metrics.outgoing));
  badgeRow.appendChild(createBadge("🌱 Expanding", metrics.expanding));
  badgeRow.appendChild(createBadge("🤝 Alliances", metrics.alliances));
  badgeRow.appendChild(createBadge("📡 Disconnected", metrics.disconnected));
  badgeRow.appendChild(createBadge("🕱 Traitor", metrics.traitor));
  badgeRow.appendChild(createBadge("⏳ Waiting", metrics.waiting));
  badgeRow.appendChild(createBadge("☠️ Eliminated", metrics.eliminated));
  badgeRow.appendChild(
    createBadge("🛡️ Stable", metrics.stable, metrics.stable > 0),
  );
  wrapper.appendChild(badgeRow);

  const grid = createElement("div", "grid gap-4 md:grid-cols-2");
  grid.appendChild(
    createDetailSection(
      "Incoming attacks",
      player.incomingAttacks,
      (attack) => `${attack.from} – ${formatTroopCount(attack.troops)} troops`,
    ),
  );
  grid.appendChild(
    createDetailSection(
      "Outgoing attacks",
      player.outgoingAttacks,
      (attack) =>
        `${attack.target} – ${formatTroopCount(attack.troops)} troops`,
    ),
  );
  grid.appendChild(
    createDetailSection(
      "Defensive supports",
      player.defensiveSupports,
      (support) =>
        `${support.ally} – ${formatTroopCount(support.troops)} troops`,
    ),
  );

  const activeAlliances = getActiveAlliances(player, snapshot);
  grid.appendChild(
    createDetailSection("Alliances", activeAlliances, (pact) => {
      const expiresAt = pact.startedAtMs + snapshot.allianceDurationMs;
      const countdown = formatCountdown(expiresAt, snapshot.currentTimeMs);
      return `${pact.partner} – expires in ${countdown}`;
    }),
  );

  if (player.traitor || player.traitorTargets.length) {
    grid.appendChild(
      createDetailSection(
        "Traitor activity",
        player.traitorTargets,
        (target) => `Betrayed ${target}`,
      ),
    );
  }

  wrapper.appendChild(grid);
  return wrapper;
}

function createDetailSection<T>(
  title: string,
  entries: T[],
  toLabel: (entry: T) => string,
): HTMLElement {
  const section = createElement("section", "space-y-2");
  const heading = createElement(
    "h4",
    "font-semibold uppercase text-slate-300 tracking-wide text-[0.7rem]",
    title,
  );
  section.appendChild(heading);
  if (!entries.length) {
    section.appendChild(
      createElement("p", "text-slate-500 italic", "No records."),
    );
    return section;
  }
  const list = createElement("ul", "space-y-2");
  for (const entry of entries) {
    const item = createElement(
      "li",
      "rounded-md border border-slate-800 bg-slate-900/80 px-3 py-2",
    );
    item.appendChild(
      createElement("div", "font-medium text-slate-200", toLabel(entry)),
    );
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

function createBadge(
  label: string,
  value: number,
  highlight = value > 0,
): HTMLElement {
  const badge = createElement(
    "span",
    `inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.65rem] font-semibold ${
      highlight
        ? "bg-sky-500/20 text-sky-200 border border-sky-500/40"
        : "bg-slate-800/80 text-slate-300"
    }`,
  );
  const [emoji, ...rest] = label.split(" ");
  const emojiSpan = createElement("span", "text-base");
  emojiSpan.textContent = emoji;
  badge.appendChild(emojiSpan);
  badge.appendChild(createElement("span", "", rest.join(" ")));
  badge.appendChild(
    createElement("span", "font-mono text-[0.7rem]", String(value)),
  );
  return badge;
}

function createRunStatusBadge(status: SidebarRunningActionStatus): HTMLElement {
  const baseClass =
    "rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide";
  const styles: Record<SidebarRunningActionStatus, string> = {
    running: "bg-emerald-500/20 text-emerald-200",
    completed: "bg-sky-500/20 text-sky-200",
    stopped: "bg-amber-500/20 text-amber-200",
    failed: "bg-rose-500/20 text-rose-200",
  };
  const className = `${baseClass} ${styles[status] ?? "bg-slate-700/60 text-slate-200"}`;
  return createElement("span", className, formatRunStatus(status));
}

function createSummaryStat(label: string, value: string): HTMLElement {
  const wrapper = createElement(
    "div",
    "rounded-md border border-slate-800/70 bg-slate-900/70 px-3 py-2",
  );
  const title = createElement(
    "div",
    "text-[0.65rem] uppercase tracking-wide text-slate-400",
    label,
  );
  const content = createElement(
    "div",
    "font-mono text-base text-slate-100",
    value,
  );
  wrapper.appendChild(title);
  wrapper.appendChild(content);
  return wrapper;
}

function createLabelBlock(options: {
  label: string;
  subtitle?: string;
  indent: number;
  expanded?: boolean;
  toggleAttribute?: string;
  rowKey?: string;
  onToggle?: (expanded: boolean) => void;
  focus?: TileSummary;
}): HTMLElement {
  const {
    label,
    subtitle,
    indent,
    expanded,
    toggleAttribute,
    rowKey,
    onToggle,
    focus,
  } = options;
  const container = createElement("div", "flex items-start gap-3");
  container.style.marginLeft = `${indent * 1.5}rem`;

  const labelBlock = createElement("div", "space-y-1");
  const labelEl = createPlayerNameElement(label, focus, {
    asBlock: true,
    className:
      "block font-semibold text-slate-100 transition-colors hover:text-sky-200",
  });
  labelBlock.appendChild(labelEl);
  if (subtitle) {
    labelBlock.appendChild(
      createElement(
        "div",
        "text-[0.65rem] uppercase tracking-wide text-slate-400",
        subtitle,
      ),
    );
  }

  if (toggleAttribute && rowKey && typeof expanded === "boolean" && onToggle) {
    const button = createElement(
      "button",
      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-slate-300 hover:text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500/60 transition-colors",
    );
    button.setAttribute(toggleAttribute, rowKey);
    button.type = "button";
    button.title = expanded ? "Collapse" : "Expand";
    button.textContent = expanded ? "−" : "+";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onToggle(!expanded);
    });
    container.appendChild(button);
  }
  container.appendChild(labelBlock);
  return container;
}

function cellClassForColumn(column: TableHeader, extra = ""): string {
  const alignClass =
    column.align === "left"
      ? "text-left"
      : column.align === "right"
        ? "text-right"
        : "text-center";
  return [
    "border-b border-r border-slate-800/70 px-3 py-2 last:border-r-0",
    alignClass,
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

function getExtraCellClass(key: SortKey, aggregate: boolean): string {
  if (key === "tiles" || key === "gold" || key === "troops") {
    return "font-mono text-[0.75rem]";
  }
  return aggregate ? "font-semibold" : "font-semibold";
}

function getPlayerCellValue(
  key: SortKey,
  metrics: Metrics,
  player: PlayerRecord,
): string {
  switch (key) {
    case "tiles":
      return formatNumber(player.tiles);
    case "gold":
      return formatNumber(player.gold);
    case "troops":
      return formatTroopCount(player.troops);
    case "incoming":
      return String(metrics.incoming);
    case "outgoing":
      return String(metrics.outgoing);
    case "expanding":
      return String(metrics.expanding);
    case "alliances":
      return String(metrics.alliances);
    case "disconnected":
      return String(metrics.disconnected);
    case "traitor":
      return String(metrics.traitor);
    case "stable":
      return String(metrics.stable);
    case "waiting":
      return String(metrics.waiting);
    case "eliminated":
      return String(metrics.eliminated);
    default:
      return "";
  }
}

function getAggregateCellValue(
  key: SortKey,
  metrics: Metrics,
  totals: AggregatedRow["totals"],
): string {
  switch (key) {
    case "tiles":
      return formatNumber(totals.tiles);
    case "gold":
      return formatNumber(totals.gold);
    case "troops":
      return formatTroopCount(totals.troops);
    case "incoming":
      return String(metrics.incoming);
    case "outgoing":
      return String(metrics.outgoing);
    case "expanding":
      return String(metrics.expanding);
    case "alliances":
      return String(metrics.alliances);
    case "disconnected":
      return String(metrics.disconnected);
    case "traitor":
      return String(metrics.traitor);
    case "stable":
      return String(metrics.stable);
    case "waiting":
      return String(metrics.waiting);
    case "eliminated":
      return String(metrics.eliminated);
    default:
      return "";
  }
}

function getMetrics(
  player: PlayerRecord,
  snapshot: GameSnapshot,
  cache: Map<string, Metrics>,
): Metrics {
  const cached = cache.get(player.id);
  if (cached) {
    return cached;
  }
  const metrics = computePlayerMetrics(player, snapshot);
  cache.set(player.id, metrics);
  return metrics;
}

function comparePlayers(options: {
  a: PlayerRecord;
  b: PlayerRecord;
  sortState: SortState;
  snapshot: GameSnapshot;
  metricsCache: Map<string, Metrics>;
}): number {
  const { a, b, sortState, snapshot, metricsCache } = options;
  const metricsA = getMetrics(a, snapshot, metricsCache);
  const metricsB = getMetrics(b, snapshot, metricsCache);
  const valueA = getPlayerSortValue(a, metricsA, sortState.key);
  const valueB = getPlayerSortValue(b, metricsB, sortState.key);
  const result = compareSortValues(valueA, valueB, sortState.direction);
  if (result !== 0) {
    return result;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function compareAggregated(options: {
  a: AggregatedRow;
  b: AggregatedRow;
  sortState: SortState;
}): number {
  const { a, b, sortState } = options;
  const valueA = getAggregateSortValue(a, sortState.key);
  const valueB = getAggregateSortValue(b, sortState.key);
  const result = compareSortValues(valueA, valueB, sortState.direction);
  if (result !== 0) {
    return result;
  }
  return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
}

function compareSortValues(
  a: number | string,
  b: number | string,
  direction: SortDirection,
): number {
  if (typeof a === "string" && typeof b === "string") {
    const cmp = a.localeCompare(b, undefined, { sensitivity: "base" });
    return direction === "asc" ? cmp : -cmp;
  }
  const numA = Number(a);
  const numB = Number(b);
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
    const diff = numA - numB;
    if (diff !== 0) {
      return direction === "asc" ? diff : -diff;
    }
    return 0;
  }
  const fallback = String(a).localeCompare(String(b), undefined, {
    sensitivity: "base",
  });
  return direction === "asc" ? fallback : -fallback;
}

function getPlayerSortValue(
  player: PlayerRecord,
  metrics: Metrics,
  key: SortKey,
): number | string {
  switch (key) {
    case "label":
      return player.name.toLowerCase();
    case "tiles":
      return player.tiles;
    case "gold":
      return player.gold;
    case "troops":
      return player.troops;
    case "incoming":
      return metrics.incoming;
    case "outgoing":
      return metrics.outgoing;
    case "expanding":
      return metrics.expanding;
    case "alliances":
      return metrics.alliances;
    case "disconnected":
      return metrics.disconnected;
    case "traitor":
      return metrics.traitor;
    case "stable":
      return metrics.stable;
    case "waiting":
      return metrics.waiting;
    case "eliminated":
      return metrics.eliminated;
    default:
      return 0;
  }
}

function getAggregateSortValue(
  row: AggregatedRow,
  key: SortKey,
): number | string {
  switch (key) {
    case "label":
      return row.label.toLowerCase();
    case "tiles":
      return row.totals.tiles;
    case "gold":
      return row.totals.gold;
    case "troops":
      return row.totals.troops;
    case "incoming":
      return row.metrics.incoming;
    case "outgoing":
      return row.metrics.outgoing;
    case "expanding":
      return row.metrics.expanding;
    case "alliances":
      return row.metrics.alliances;
    case "disconnected":
      return row.metrics.disconnected;
    case "traitor":
      return row.metrics.traitor;
    case "stable":
      return row.metrics.stable;
    case "waiting":
      return row.metrics.waiting;
    case "eliminated":
      return row.metrics.eliminated;
    default:
      return 0;
  }
}

function groupPlayers(options: {
  players: PlayerRecord[];
  snapshot: GameSnapshot;
  metricsCache: Map<string, Metrics>;
  getKey: (player: PlayerRecord) => string | undefined;
  sortState: SortState;
}): AggregatedRow[] {
  const { players, snapshot, metricsCache, getKey, sortState } = options;
  const map = new Map<string, AggregatedRow>();

  for (const player of players) {
    const key = getKey(player) ?? "Unaffiliated";
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: key,
        players: [],
        metrics: {
          incoming: 0,
          outgoing: 0,
          expanding: 0,
          waiting: 0,
          eliminated: 0,
          disconnected: 0,
          traitor: 0,
          alliances: 0,
          stable: 0,
        },
        totals: {
          tiles: 0,
          gold: 0,
          troops: 0,
        },
      });
    }
    const entry = map.get(key)!;
    entry.players.push(player);
    const metrics = getMetrics(player, snapshot, metricsCache);
    entry.metrics.incoming += metrics.incoming;
    entry.metrics.outgoing += metrics.outgoing;
    entry.metrics.expanding += metrics.expanding;
    entry.metrics.waiting += metrics.waiting;
    entry.metrics.eliminated += metrics.eliminated;
    entry.metrics.disconnected += metrics.disconnected;
    entry.metrics.traitor += metrics.traitor;
    entry.metrics.alliances += metrics.alliances;
    entry.metrics.stable += metrics.stable;
    entry.totals.tiles += player.tiles;
    entry.totals.gold += player.gold;
    entry.totals.troops += player.troops;
  }

  const rows = Array.from(map.values());
  for (const row of rows) {
    row.players.sort((a, b) =>
      comparePlayers({ a, b, sortState, snapshot, metricsCache }),
    );
  }
  rows.sort((a, b) => compareAggregated({ a, b, sortState }));
  return rows;
}

function computePlayerMetrics(player: PlayerRecord, snapshot: GameSnapshot) {
  const incoming = player.incomingAttacks.length;
  const outgoing = player.outgoingAttacks.length;
  const expanding = player.expansions;
  const waiting = player.waiting ? 1 : 0;
  const eliminated = player.eliminated ? 1 : 0;
  const disconnected = player.disconnected ? 1 : 0;
  const traitor = player.traitor ? 1 : 0;
  const alliances = getActiveAlliances(player, snapshot).length;
  const stable =
    incoming +
      outgoing +
      expanding +
      waiting +
      eliminated +
      disconnected +
      traitor ===
    0
      ? 1
      : 0;
  return {
    incoming,
    outgoing,
    expanding,
    waiting,
    eliminated,
    disconnected,
    traitor,
    alliances,
    stable,
  };
}

function getActiveAlliances(player: PlayerRecord, snapshot: GameSnapshot) {
  return player.alliances.filter((pact) => {
    const expiresAt = pact.startedAtMs + snapshot.allianceDurationMs;
    return expiresAt > snapshot.currentTimeMs;
  });
}
