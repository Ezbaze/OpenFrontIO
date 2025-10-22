import {
  GameSnapshot,
  PanelLeafNode,
  PlayerRecord,
  ShipRecord,
  SortDirection,
  SortKey,
  SortState,
  TileSummary,
  ViewType,
} from "./types";
import {
  createElement,
  focusTile,
  formatCountdown,
  formatNumber,
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
}

const DEFAULT_ACTIONS: ViewActionHandlers = {
  toggleTrading: () => undefined,
  showPlayerDetails: () => undefined,
};

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
  getKey: (player: PlayerRecord) => string;
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

function extractClanTag(name: string): string {
  const match = name.match(/\[(.+?)\]/);
  return match ? match[1].trim() : "Unaffiliated";
}
