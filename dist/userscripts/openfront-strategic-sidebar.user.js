// ==UserScript==
// @name			OpenFront Strategic Sidebar
// @namespace		https://openfront.io/
// @version			0.1.0
// @description		Adds a resizable, splittable strategic sidebar for OpenFront players, clans, and teams.
// @author			ezbaze
// @match			https://*.openfront.io/*
// @match			https://openfront.io/*
// @updateURL		https://raw.githubusercontent.com/OpenFrontIO/userscripts/main/openfront-strategic-sidebar.user.js
// @downloadURL		https://raw.githubusercontent.com/OpenFrontIO/userscripts/main/openfront-strategic-sidebar.user.js
// @homepageURL		https://github.com/Ezbaze
//
// Created with love using Gorilla
// ==/UserScript==

(function () {
  "use strict";

  const ICON_DEFINITIONS = {
    "split-horizontal": [
      {
        tag: "rect",
        attrs: { x: "3", y: "3", width: "18", height: "18", rx: "2", ry: "2" },
      },
      { tag: "line", attrs: { x1: "3", y1: "12", x2: "21", y2: "12" } },
      { tag: "line", attrs: { x1: "12", y1: "3", x2: "12", y2: "7" } },
      { tag: "line", attrs: { x1: "12", y1: "17", x2: "12", y2: "21" } },
    ],
    "split-vertical": [
      {
        tag: "rect",
        attrs: { x: "3", y: "3", width: "18", height: "18", rx: "2", ry: "2" },
      },
      { tag: "line", attrs: { x1: "12", y1: "3", x2: "12", y2: "21" } },
      { tag: "line", attrs: { x1: "3", y1: "12", x2: "7", y2: "12" } },
      { tag: "line", attrs: { x1: "17", y1: "12", x2: "21", y2: "12" } },
    ],
    close: [
      { tag: "line", attrs: { x1: "18", y1: "6", x2: "6", y2: "18" } },
      { tag: "line", attrs: { x1: "6", y1: "6", x2: "18", y2: "18" } },
    ],
  };
  const SVG_NS = "http://www.w3.org/2000/svg";
  function renderIcon(kind, className) {
    const segments = ICON_DEFINITIONS[kind];
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    if (className) {
      svg.setAttribute("class", className);
    }
    for (const segment of segments) {
      const child = document.createElementNS(SVG_NS, segment.tag);
      for (const [attr, value] of Object.entries(segment.attrs)) {
        child.setAttribute(attr, value);
      }
      svg.appendChild(child);
    }
    svg.setAttribute("aria-hidden", "true");
    return svg;
  }

  const numberFormatter = new Intl.NumberFormat("en-US");
  function normalizeTroopCount(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.floor(Math.max(value, 0) / 10);
  }
  function formatNumber(value) {
    return numberFormatter.format(value);
  }
  function formatTroopCount(rawTroops) {
    return formatNumber(normalizeTroopCount(rawTroops));
  }
  function formatCountdown(targetMs, nowMs) {
    const diff = targetMs - nowMs;
    if (!Number.isFinite(diff)) {
      return "—";
    }
    if (diff <= 0) {
      const elapsed = Math.abs(diff);
      const minutes = Math.floor(elapsed / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      return `Expired ${minutes}:${seconds.toString().padStart(2, "0")} ago`;
    }
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
  function formatTimestamp(ms) {
    const date = new Date(ms);
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function createElement(tag, className, textContent) {
    const el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    if (textContent !== undefined) {
      el.textContent = textContent;
    }
    return el;
  }
  let cachedGoToEmitter = null;
  let cachedEmitterElement = null;
  const GO_TO_SELECTORS = ["events-display", "control-panel", "leader-board"];
  function resolveGoToEmitter() {
    if (
      cachedGoToEmitter &&
      cachedEmitterElement &&
      document.contains(cachedEmitterElement)
    ) {
      return cachedGoToEmitter;
    }
    cachedGoToEmitter = null;
    cachedEmitterElement = null;
    for (const selector of GO_TO_SELECTORS) {
      const element = document.querySelector(selector);
      if (!element) {
        continue;
      }
      const emitter = element.emitGoToPositionEvent;
      if (typeof emitter === "function") {
        cachedEmitterElement = element;
        cachedGoToEmitter = emitter.bind(element);
        return cachedGoToEmitter;
      }
      const prototypeEmitter = element["emitGoToPositionEvent"];
      if (typeof prototypeEmitter === "function") {
        cachedEmitterElement = element;
        cachedGoToEmitter = prototypeEmitter.bind(element);
        return cachedGoToEmitter;
      }
    }
    return null;
  }
  function focusTile(summary) {
    if (!summary) {
      return false;
    }
    const { x, y } = summary;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }
    const emitter = resolveGoToEmitter();
    if (!emitter) {
      console.warn("OpenFront sidebar: unable to locate go-to emitter");
      return false;
    }
    try {
      emitter(x, y);
      return true;
    } catch (error) {
      console.warn("OpenFront sidebar: failed to emit go-to event", error);
      return false;
    }
  }
  let contextMenuElement = null;
  let contextMenuCleanup = null;
  function ensureContextMenuElement() {
    if (!contextMenuElement) {
      contextMenuElement = createElement(
        "div",
        "fixed z-[2147483647] min-w-[160px] overflow-hidden rounded-md border " +
          "border-slate-700/80 bg-slate-950/95 text-sm text-slate-100 shadow-2xl " +
          "backdrop-blur",
      );
      contextMenuElement.dataset.sidebarRole = "context-menu";
      contextMenuElement.style.pointerEvents = "auto";
      contextMenuElement.style.zIndex = "2147483647";
    }
    return contextMenuElement;
  }
  function hideContextMenu() {
    if (contextMenuCleanup) {
      contextMenuCleanup();
      contextMenuCleanup = null;
    }
    if (contextMenuElement && contextMenuElement.parentElement) {
      contextMenuElement.parentElement.removeChild(contextMenuElement);
    }
  }
  function showContextMenu(options) {
    const { x, y, title, items } = options;
    if (!items.length) {
      hideContextMenu();
      return;
    }
    hideContextMenu();
    const menu = ensureContextMenuElement();
    menu.className =
      "fixed z-[2147483647] min-w-[160px] overflow-hidden rounded-md border " +
      "border-slate-700/80 bg-slate-950/95 text-sm text-slate-100 shadow-2xl " +
      "backdrop-blur";
    menu.style.zIndex = "2147483647";
    menu.style.visibility = "hidden";
    menu.style.left = "0px";
    menu.style.top = "0px";
    const wrapper = createElement("div", "flex flex-col");
    if (title) {
      const header = createElement(
        "div",
        "border-b border-slate-800/80 px-3 py-2 text-xs font-semibold uppercase " +
          "tracking-wide text-slate-300",
        title,
      );
      wrapper.appendChild(header);
    }
    const list = createElement("div", "py-1");
    for (const item of items) {
      const button = createElement(
        "button",
        `${
          item.disabled
            ? "cursor-not-allowed text-slate-500"
            : "hover:bg-slate-800/80 hover:text-sky-200"
        } flex w-full items-center gap-2 px-3 py-2 text-left transition-colors`,
        item.label,
      );
      button.type = "button";
      button.disabled = Boolean(item.disabled);
      if (item.tooltip) {
        button.title = item.tooltip;
      }
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        hideContextMenu();
        item.onSelect?.();
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      list.appendChild(button);
    }
    if (list.childElementCount === 0) {
      hideContextMenu();
      return;
    }
    wrapper.appendChild(list);
    menu.replaceChildren(wrapper);
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 8;
    const maxTop = window.innerHeight - rect.height - 8;
    const left = Math.max(8, Math.min(x, Math.max(8, maxLeft)));
    const top = Math.max(8, Math.min(y, Math.max(8, maxTop)));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "visible";
    const cleanupHandlers = [];
    const cleanupContextMenu = () => {
      while (cleanupHandlers.length > 0) {
        const cleanup = cleanupHandlers.pop();
        try {
          cleanup?.();
        } catch (error) {
          console.warn("Failed to clean up context menu listener", error);
        }
      }
      if (menu.parentElement) {
        menu.parentElement.removeChild(menu);
      }
      contextMenuCleanup = null;
    };
    contextMenuCleanup = cleanupContextMenu;
    window.setTimeout(() => {
      if (contextMenuCleanup !== cleanupContextMenu) {
        return;
      }
      const handlePointerDown = (event) => {
        if (!(event.target instanceof Node)) {
          return;
        }
        if (!menu.contains(event.target)) {
          hideContextMenu();
        }
      };
      const handleKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          hideContextMenu();
        }
      };
      const handleBlur = () => hideContextMenu();
      const handleScroll = () => hideContextMenu();
      document.addEventListener("pointerdown", handlePointerDown, true);
      document.addEventListener("contextmenu", handlePointerDown, true);
      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("scroll", handleScroll, true);
      window.addEventListener("blur", handleBlur);
      window.addEventListener("resize", handleBlur);
      cleanupHandlers.push(() => {
        document.removeEventListener("pointerdown", handlePointerDown, true);
        document.removeEventListener("contextmenu", handlePointerDown, true);
        document.removeEventListener("keydown", handleKeyDown);
        document.removeEventListener("scroll", handleScroll, true);
        window.removeEventListener("blur", handleBlur);
        window.removeEventListener("resize", handleBlur);
      });
    }, 0);
  }

  const DEFAULT_ACTIONS = {
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
  const EMPTY_ACTIONS_STATE = {
    revision: 0,
    runningRevision: 0,
    actions: [],
    running: [],
  };
  let editorSettingIdCounter = 0;
  function nextEditorSettingId() {
    editorSettingIdCounter += 1;
    return `editor-setting-${editorSettingIdCounter}`;
  }
  function getActionsState(snapshot) {
    return snapshot.sidebarActions ?? EMPTY_ACTIONS_STATE;
  }
  function getRunModeLabel(mode) {
    return mode === "once" ? "Run once" : "Continuous";
  }
  function describeRunMode(mode) {
    return mode === "once"
      ? "Runs a single time and removes itself from the running list."
      : "Keeps running until you stop it manually.";
  }
  function formatRunStatus(status) {
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
  function defaultValueForType(type) {
    switch (type) {
      case "number":
        return 0;
      case "toggle":
        return false;
      default:
        return "";
    }
  }
  const TABLE_HEADERS = [
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
  const SHIP_HEADERS = [
    { key: "label", label: "Ship", align: "left" },
    { key: "owner", label: "Owner", align: "left" },
    { key: "type", label: "Type", align: "left" },
    { key: "troops", label: "Troops", align: "right" },
    { key: "origin", label: "Origin", align: "left" },
    { key: "current", label: "Current", align: "left" },
    { key: "destination", label: "Destination", align: "left" },
    { key: "status", label: "Status", align: "left" },
  ];
  const DEFAULT_SORT_STATE = { key: "tiles", direction: "desc" };
  function buildViewContent(
    leaf,
    snapshot,
    requestRender,
    existingContainer,
    lifecycle,
    actions,
  ) {
    const view = leaf.view;
    const sortState = ensureSortState(leaf, view);
    const viewActions = actions ?? DEFAULT_ACTIONS;
    const handleSort = (key) => {
      const current = ensureSortState(leaf, view);
      let direction;
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
        return createElement(
          "div",
          "text-slate-200 text-sm",
          "Unsupported view",
        );
    }
  }
  function ensureSortState(leaf, view) {
    const state = leaf.sortStates[view];
    if (state) {
      return state;
    }
    const fallback = { ...DEFAULT_SORT_STATE };
    leaf.sortStates[view] = fallback;
    return fallback;
  }
  function getDefaultDirection(key) {
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
  function renderPlayersView(options) {
    const { leaf, snapshot, sortState, onSort, existingContainer, actions } =
      options;
    const metricsCache = new Map();
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
  function renderClanView(options) {
    const {
      leaf,
      snapshot,
      requestRender,
      sortState,
      onSort,
      existingContainer,
      actions,
    } = options;
    const metricsCache = new Map();
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
  function renderTeamView(options) {
    const {
      leaf,
      snapshot,
      requestRender,
      sortState,
      onSort,
      existingContainer,
      actions,
    } = options;
    const metricsCache = new Map();
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
  function renderShipView(options) {
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
      const row = createElement(
        "tr",
        "hover:bg-slate-800/50 transition-colors",
      );
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
  function renderPlayerPanelView(options) {
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
        summary.appendChild(
          createSummaryStat("Gold", formatNumber(player.gold)),
        );
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
  function renderActionsDirectoryView(options) {
    const { leaf, snapshot, existingContainer, actions } = options;
    const state = getActionsState(snapshot);
    const signature = `${state.revision}:${state.selectedActionId ?? ""}:${state.running.length}`;
    const isDirectoryContainer =
      !!existingContainer &&
      existingContainer.dataset.sidebarRole === "actions-directory";
    const canReuse =
      isDirectoryContainer && existingContainer.dataset.signature === signature;
    const container = isDirectoryContainer
      ? existingContainer
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
    const header = createElement(
      "div",
      "flex items-center justify-between gap-2 border-b border-slate-800/70 bg-slate-900/80 px-3 py-2",
    );
    header.appendChild(
      createElement(
        "div",
        "text-xs font-semibold uppercase tracking-wide text-slate-300",
        "Actions",
      ),
    );
    const newButton = createElement(
      "button",
      "rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-100 transition-colors hover:border-sky-500/70 hover:text-sky-200",
      "New action",
    );
    newButton.type = "button";
    newButton.addEventListener("click", () => {
      actions.createAction?.();
    });
    header.appendChild(newButton);
    const tableWrapper = createElement("div", "flex-1 overflow-auto");
    tableWrapper.dataset.sidebarRole = "table-container";
    const table = createElement(
      "table",
      "min-w-full divide-y divide-slate-800 text-xs text-slate-100",
    );
    const thead = createElement(
      "thead",
      "bg-slate-900/85 text-[0.65rem] uppercase tracking-wide text-slate-300",
    );
    const headerRow = createElement("tr");
    const columns = [
      { key: "name", label: "Action", align: "left" },
      { key: "controls", label: "", align: "right" },
    ];
    for (const column of columns) {
      const th = createElement(
        "th",
        `px-3 py-2 font-semibold ${column.align === "right" ? "text-right" : "text-left"}`,
      );
      th.textContent = column.label;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = createElement("tbody", "divide-y divide-slate-900/80");
    const runningLookup = new Set(state.running.map((run) => run.actionId));
    if (state.actions.length === 0) {
      const row = createElement("tr");
      const cell = createElement(
        "td",
        "px-4 py-6 text-center text-xs text-slate-400",
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
          `cursor-pointer transition-colors ${
            isSelected
              ? "bg-slate-800/50 ring-1 ring-sky-500/40"
              : "hover:bg-slate-800/30"
          }`,
        );
        row.dataset.actionId = action.id;
        row.addEventListener("click", () => {
          actions.selectAction?.(action.id);
        });
        const nameCell = createElement("td", "px-3 py-3 align-top");
        const nameLine = createElement(
          "div",
          "flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100",
          action.name,
        );
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
        const controlsCell = createElement(
          "td",
          "px-3 py-3 align-top text-right",
        );
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
    container.replaceChildren(header, tableWrapper);
    return container;
  }
  function renderActionEditorView(options) {
    const { leaf, snapshot, existingContainer, actions } = options;
    const state = getActionsState(snapshot);
    const selectedAction = state.actions.find(
      (action) => action.id === state.selectedActionId,
    );
    const signature = selectedAction
      ? `${state.revision}:${selectedAction.id}:${selectedAction.updatedAtMs}`
      : `${state.revision}:none`;
    const prior = existingContainer;
    const isEditorContainer =
      !!prior && prior.dataset.sidebarRole === "action-editor";
    const container = isEditorContainer
      ? prior
      : createElement(
          "div",
          "relative flex-1 overflow-auto border border-slate-900/70 bg-slate-950/60 backdrop-blur-sm",
        );
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
    const formState = {
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
      formState.runMode = modeSelect.value;
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
    const removeSetting = (settingId) => {
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
      const newSetting = {
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
      const update = {
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
  function renderRunningActionsView(options) {
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
    const header = createElement(
      "div",
      "flex items-center justify-between gap-2 border-b border-slate-800/70 bg-slate-900/80 px-3 py-2",
    );
    header.appendChild(
      createElement(
        "div",
        "text-xs font-semibold uppercase tracking-wide text-slate-300",
        "Running actions",
      ),
    );
    header.appendChild(
      createElement(
        "div",
        "text-[0.7rem] text-slate-400",
        `${state.running.length} active`,
      ),
    );
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
      container.replaceChildren(header, tableWrapper);
      return container;
    }
    const table = createElement(
      "table",
      "min-w-full divide-y divide-slate-800 text-xs text-slate-100",
    );
    const thead = createElement(
      "thead",
      "bg-slate-900/85 text-[0.65rem] uppercase tracking-wide text-slate-300",
    );
    const headerRow = createElement("tr");
    const columns = [
      { key: "name", label: "Action", align: "left" },
      { key: "mode", label: "Mode", align: "left" },
      { key: "started", label: "Started", align: "left" },
      { key: "controls", label: "", align: "right" },
    ];
    for (const column of columns) {
      const th = createElement(
        "th",
        `px-3 py-2 font-semibold ${column.align === "right" ? "text-right" : "text-left"}`,
      );
      th.textContent = column.label;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = createElement("tbody", "divide-y divide-slate-900/80");
    for (const run of state.running) {
      const isSelected = state.selectedRunningActionId === run.id;
      const row = createElement(
        "tr",
        `cursor-pointer transition-colors ${
          isSelected
            ? "bg-slate-800/50 ring-1 ring-sky-500/40"
            : "hover:bg-slate-800/30"
        }`,
      );
      row.dataset.runningActionId = run.id;
      row.addEventListener("click", () => {
        actions.selectRunningAction?.(run.id);
      });
      const nameCell = createElement("td", "px-3 py-3 align-top");
      const nameLine = createElement(
        "div",
        "flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100",
        run.name,
      );
      nameLine.appendChild(createRunStatusBadge(run.status));
      nameCell.appendChild(nameLine);
      row.appendChild(nameCell);
      row.appendChild(
        createElement(
          "td",
          "px-3 py-3 align-top text-[0.75rem] uppercase tracking-wide text-slate-400",
          getRunModeLabel(run.runMode),
        ),
      );
      row.appendChild(
        createElement(
          "td",
          "px-3 py-3 align-top text-[0.75rem] text-slate-300",
          formatTimestamp(run.startedAtMs),
        ),
      );
      const controlsCell = createElement("td", "px-3 py-3 align-top");
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
    container.replaceChildren(header, tableWrapper);
    return container;
  }
  function renderRunningActionDetailView(options) {
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
    const meta = createElement(
      "div",
      "grid gap-3 text-[0.75rem] sm:grid-cols-3",
    );
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
  function createActionSettingEditorCard(formState, setting, onRemove) {
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
    const updateValue = (value) => {
      setting.value = value;
    };
    let control = createSettingValueInput(setting, updateValue);
    valueContainer.appendChild(control);
    valueWrapper.appendChild(valueContainer);
    card.appendChild(valueWrapper);
    typeSelect.addEventListener("change", () => {
      const nextType = typeSelect.value;
      setting.type = nextType;
      setting.value = defaultValueForType(nextType);
      control = createSettingValueInput(setting, updateValue);
      valueContainer.replaceChildren(control);
    });
    return card;
  }
  function createSettingValueInput(setting, onChange) {
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
  function createRunningSettingField(runId, setting, actions) {
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
          actions.updateRunningActionSetting?.(
            runId,
            setting.id,
            toggle.checked,
          );
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
  function createTableShell(options) {
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
    let table = container.querySelector("table");
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
  function getShipExtraCellClass(key) {
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
  function attachImmediateTileFocus(element, focus) {
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
  function createCoordinateButton(summary) {
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
  function createPlayerNameElement(label, position, options) {
    const classNames = [];
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
      return createElement(tag, className, label);
    }
    const button = createElement("button", className, label);
    button.type = "button";
    button.title = `Focus on ${label}`;
    attachImmediateTileFocus(button, () => {
      focusTile(position);
    });
    return button;
  }
  function getShipCellValue(key, ship) {
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
  function compareShips(options) {
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
  function getShipSortValue(ship, key) {
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
  function tileSortValue(summary) {
    if (!summary) {
      return "";
    }
    const x = summary.x.toString().padStart(5, "0");
    const y = summary.y.toString().padStart(5, "0");
    const owner = summary.ownerName?.toLowerCase() ?? "";
    return `${x}:${y}:${owner}`;
  }
  function formatTileSummary(summary) {
    if (!summary) {
      return "–";
    }
    const coords = `${summary.x}, ${summary.y}`;
    return summary.ownerName ? `${coords} (${summary.ownerName})` : coords;
  }
  function deriveShipStatus(ship) {
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
  const tableContextActions = new WeakMap();
  const playerContextTargets = new WeakMap();
  const groupContextTargets = new WeakMap();
  function findContextMenuTarget(event, container) {
    if (
      event.target instanceof HTMLElement &&
      container.contains(event.target)
    ) {
      let current = event.target;
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
  function registerContextMenuDelegation(container, actions) {
    tableContextActions.set(container, actions);
    if (container.dataset.contextMenuDelegated === "true") {
      return;
    }
    const handleContextMenu = (event) => {
      const tableContainer = event.currentTarget;
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
      const buildIdList = (players) =>
        Array.from(new Set(players.map((player) => player.id)));
      const items = [];
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
  function appendPlayerRows(options) {
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
  function appendGroupRows(options) {
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
  function applyPersistentHover(element, leaf, rowKey, highlightClass) {
    element.dataset.hoverHighlightClass = highlightClass;
    if (leaf.hoveredRowKey === rowKey) {
      if (leaf.hoveredRowElement && leaf.hoveredRowElement !== element) {
        const previousClass =
          leaf.hoveredRowElement.dataset.hoverHighlightClass;
        if (previousClass) {
          leaf.hoveredRowElement.classList.remove(previousClass);
        }
      }
      leaf.hoveredRowElement = element;
      element.classList.add(highlightClass);
    }
    element.addEventListener("pointerenter", () => {
      if (leaf.hoveredRowElement && leaf.hoveredRowElement !== element) {
        const previousClass =
          leaf.hoveredRowElement.dataset.hoverHighlightClass;
        if (previousClass) {
          leaf.hoveredRowElement.classList.remove(previousClass);
        }
      }
      leaf.hoveredRowKey = rowKey;
      leaf.hoveredRowElement = element;
      element.classList.add(highlightClass);
    });
  }
  function appendMetricCells(row, metrics, player) {
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
  function appendAggregateCells(row, metrics, totals) {
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
  function renderPlayerDetails(player, snapshot) {
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
        (attack) =>
          `${attack.from} – ${formatTroopCount(attack.troops)} troops`,
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
  function createDetailSection(title, entries, toLabel) {
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
  function createBadge(label, value, highlight = value > 0) {
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
  function createRunStatusBadge(status) {
    const baseClass =
      "rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide";
    const styles = {
      running: "bg-emerald-500/20 text-emerald-200",
      completed: "bg-sky-500/20 text-sky-200",
      stopped: "bg-amber-500/20 text-amber-200",
      failed: "bg-rose-500/20 text-rose-200",
    };
    const className = `${baseClass} ${styles[status] ?? "bg-slate-700/60 text-slate-200"}`;
    return createElement("span", className, formatRunStatus(status));
  }
  function createSummaryStat(label, value) {
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
  function createLabelBlock(options) {
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
    if (
      toggleAttribute &&
      rowKey &&
      typeof expanded === "boolean" &&
      onToggle
    ) {
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
  function cellClassForColumn(column, extra = "") {
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
  function getExtraCellClass(key, aggregate) {
    if (key === "tiles" || key === "gold" || key === "troops") {
      return "font-mono text-[0.75rem]";
    }
    return aggregate ? "font-semibold" : "font-semibold";
  }
  function getPlayerCellValue(key, metrics, player) {
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
  function getAggregateCellValue(key, metrics, totals) {
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
  function getMetrics(player, snapshot, cache) {
    const cached = cache.get(player.id);
    if (cached) {
      return cached;
    }
    const metrics = computePlayerMetrics(player, snapshot);
    cache.set(player.id, metrics);
    return metrics;
  }
  function comparePlayers(options) {
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
  function compareAggregated(options) {
    const { a, b, sortState } = options;
    const valueA = getAggregateSortValue(a, sortState.key);
    const valueB = getAggregateSortValue(b, sortState.key);
    const result = compareSortValues(valueA, valueB, sortState.direction);
    if (result !== 0) {
      return result;
    }
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  }
  function compareSortValues(a, b, direction) {
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
  function getPlayerSortValue(player, metrics, key) {
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
  function getAggregateSortValue(row, key) {
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
  function groupPlayers(options) {
    const { players, snapshot, metricsCache, getKey, sortState } = options;
    const map = new Map();
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
      const entry = map.get(key);
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
  function computePlayerMetrics(player, snapshot) {
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
  function getActiveAlliances(player, snapshot) {
    return player.alliances.filter((pact) => {
      const expiresAt = pact.startedAtMs + snapshot.allianceDurationMs;
      return expiresAt > snapshot.currentTimeMs;
    });
  }
  function extractClanTag(name) {
    const match = name.match(/\[(.+?)\]/);
    return match ? match[1].trim() : "Unaffiliated";
  }

  const VIEW_OPTIONS = [
    { value: "players", label: "Players" },
    { value: "clanmates", label: "Clanmates" },
    { value: "teams", label: "Teams" },
    { value: "ships", label: "Ships" },
    { value: "player", label: "Player panel" },
    { value: "actions", label: "Actions" },
    { value: "actionEditor", label: "Action Editor" },
    { value: "runningActions", label: "Running Actions" },
    { value: "runningAction", label: "Running Action" },
  ];
  const SIDEBAR_STYLE_ID = "openfront-strategic-sidebar-styles";
  function ensureSidebarStyles() {
    if (document.getElementById(SIDEBAR_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = SIDEBAR_STYLE_ID;
    style.textContent = `
    #openfront-strategic-sidebar [data-sidebar-role="table-container"] {
      scrollbar-width: thin;
      scrollbar-color: rgba(148, 163, 184, 0.7) transparent;
    }

    #openfront-strategic-sidebar [data-sidebar-role="table-container"]::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }

    #openfront-strategic-sidebar [data-sidebar-role="table-container"]::-webkit-scrollbar-thumb {
      background-color: rgba(148, 163, 184, 0.7);
      border-radius: 9999px;
    }

    #openfront-strategic-sidebar [data-sidebar-role="table-container"]::-webkit-scrollbar-track {
      background-color: transparent;
    }
  `;
    document.head.appendChild(style);
  }
  const OVERLAY_SELECTORS = ["game-left-sidebar", "control-panel"];
  let leafIdCounter = 0;
  let groupIdCounter = 0;
  const DEFAULT_SORT_STATES = {
    players: { key: "tiles", direction: "desc" },
    clanmates: { key: "tiles", direction: "desc" },
    teams: { key: "tiles", direction: "desc" },
    ships: { key: "owner", direction: "asc" },
    player: { key: "tiles", direction: "desc" },
    actions: { key: "label", direction: "asc" },
    actionEditor: { key: "label", direction: "asc" },
    runningActions: { key: "label", direction: "asc" },
    runningAction: { key: "label", direction: "asc" },
  };
  function createLeaf(view) {
    return {
      id: `leaf-${++leafIdCounter}`,
      type: "leaf",
      view,
      expandedRows: new Set(),
      expandedGroups: new Set(),
      sortStates: {
        players: { ...DEFAULT_SORT_STATES.players },
        clanmates: { ...DEFAULT_SORT_STATES.clanmates },
        teams: { ...DEFAULT_SORT_STATES.teams },
        ships: { ...DEFAULT_SORT_STATES.ships },
        player: { ...DEFAULT_SORT_STATES.player },
        actions: { ...DEFAULT_SORT_STATES.actions },
        actionEditor: { ...DEFAULT_SORT_STATES.actionEditor },
        runningActions: { ...DEFAULT_SORT_STATES.runningActions },
        runningAction: { ...DEFAULT_SORT_STATES.runningAction },
      },
      scrollTop: 0,
      scrollLeft: 0,
      hoveredRowElement: null,
    };
  }
  function createGroup(orientation, children) {
    const count = Math.max(children.length, 1);
    return {
      id: `group-${++groupIdCounter}`,
      type: "group",
      orientation,
      children,
      sizes: new Array(count).fill(1 / count),
    };
  }
  class SidebarApp {
    constructor(store) {
      this.overlayElements = new Map();
      this.handleOverlayRealign = () => this.repositionGameOverlay();
      this.handleGlobalKeyDown = (event) => this.onGlobalKeyDown(event);
      this.isSidebarHidden = false;
      this.store = store;
      this.snapshot = store.getSnapshot();
      ensureSidebarStyles();
      this.sidebar = this.createSidebarShell();
      this.layoutContainer = this.sidebar.querySelector(
        "[data-sidebar-layout]",
      );
      this.rootNode = createLeaf("clanmates");
      this.viewActions = {
        toggleTrading: (playerIds, stopped) =>
          this.store.setTradingStopped(playerIds, stopped),
        showPlayerDetails: (playerId) => this.showPlayerDetails(playerId),
        createAction: () => {
          this.store.createAction();
        },
        selectAction: (actionId) => {
          this.store.selectAction(actionId);
        },
        saveAction: (actionId, update) => {
          this.store.saveAction(actionId, update);
        },
        deleteAction: (actionId) => {
          this.store.deleteAction(actionId);
        },
        startAction: (actionId) => {
          this.store.startAction(actionId);
        },
        selectRunningAction: (runningId) => {
          this.store.selectRunningAction(runningId);
        },
        stopRunningAction: (runningId) => {
          this.store.stopRunningAction(runningId);
        },
        updateRunningActionSetting: (runningId, settingId, value) => {
          this.store.updateRunningActionSetting(runningId, settingId, value);
        },
        setRunningActionInterval: (runningId, ticks) => {
          this.store.setRunningActionInterval(runningId, ticks);
        },
      };
      this.renderLayout();
      this.store.subscribe((snapshot) => {
        this.snapshot = snapshot;
        this.refreshAllLeaves();
      });
      this.observeGameOverlays();
      this.overlayResizeObserver = new ResizeObserver(
        this.handleOverlayRealign,
      );
      this.overlayResizeObserver.observe(this.sidebar);
      window.addEventListener("resize", this.handleOverlayRealign);
      window.addEventListener("keydown", this.handleGlobalKeyDown);
      this.repositionGameOverlay();
    }
    onGlobalKeyDown(event) {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) {
          return;
        }
        const editableTarget = target.closest(
          "input, textarea, select, [contenteditable='true' i], [contenteditable='']",
        );
        if (editableTarget) {
          return;
        }
      }
      const isToggleShortcut =
        event.code === "KeyH" &&
        event.ctrlKey &&
        event.altKey &&
        !event.shiftKey &&
        !event.metaKey;
      if (!isToggleShortcut) {
        return;
      }
      event.preventDefault();
      this.toggleSidebarVisibility();
    }
    createSidebarShell() {
      const existing = document.getElementById("openfront-strategic-sidebar");
      if (existing) {
        existing.remove();
      }
      const sidebar = createElement(
        "aside",
        "fixed top-0 left-0 z-[2147483646] flex h-full max-w-[90vw] flex-col border-r border-slate-800/80 bg-slate-950/95 text-slate-100 shadow-2xl backdrop-blur",
      );
      sidebar.id = "openfront-strategic-sidebar";
      sidebar.style.width = "420px";
      sidebar.style.fontFamily = `'Inter', 'Segoe UI', system-ui, sans-serif`;
      const resizer = createElement(
        "div",
        "group absolute right-0 top-0 flex h-full w-3 translate-x-full cursor-col-resize items-center justify-center rounded-r-full bg-transparent transition-colors duration-150 hover:bg-sky-500/10",
      );
      resizer.appendChild(
        createElement(
          "span",
          "h-12 w-px rounded-full bg-slate-600/60 transition-colors duration-150 group-hover:bg-sky-400/60",
        ),
      );
      resizer.addEventListener("pointerdown", (event) =>
        this.startSidebarResize(event),
      );
      sidebar.appendChild(resizer);
      const layout = createElement(
        "div",
        "flex h-full flex-1 flex-col gap-3 overflow-hidden p-3",
      );
      layout.dataset.sidebarLayout = "true";
      sidebar.appendChild(layout);
      document.body.appendChild(sidebar);
      return sidebar;
    }
    startSidebarResize(event) {
      event.preventDefault();
      const startWidth = this.sidebar.getBoundingClientRect().width;
      const startX = event.clientX;
      const originalUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      const onMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = clamp(
          startWidth + delta,
          280,
          window.innerWidth * 0.9,
        );
        this.sidebar.style.width = `${nextWidth}px`;
        this.repositionGameOverlay();
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.body.style.userSelect = originalUserSelect;
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }
    observeGameOverlays() {
      let discovered = false;
      for (const selector of OVERLAY_SELECTORS) {
        const registration = this.overlayElements.get(selector);
        if (registration?.root.isConnected && registration.target.isConnected) {
          continue;
        }
        const found = document.querySelector(selector);
        if (found) {
          const target = this.resolveOverlayTarget(selector, found);
          if (target) {
            this.registerOverlay(selector, found, target);
            discovered = true;
          }
        }
      }
      if (discovered) {
        this.repositionGameOverlay();
      }
      const hasMissing = OVERLAY_SELECTORS.some((selector) => {
        const registration = this.overlayElements.get(selector);
        return (
          !registration ||
          !registration.root.isConnected ||
          !registration.target.isConnected
        );
      });
      if (!hasMissing) {
        if (this.overlayObserver) {
          this.overlayObserver.disconnect();
          this.overlayObserver = undefined;
        }
        return;
      }
      if (this.overlayObserver) {
        return;
      }
      this.overlayObserver = new MutationObserver(() => {
        let updated = false;
        for (const selector of OVERLAY_SELECTORS) {
          const registration = this.overlayElements.get(selector);
          if (
            registration?.root.isConnected &&
            registration.target.isConnected
          ) {
            continue;
          }
          const candidate = document.querySelector(selector);
          if (candidate) {
            const target = this.resolveOverlayTarget(selector, candidate);
            if (target) {
              this.registerOverlay(selector, candidate, target);
              updated = true;
            }
          } else if (registration) {
            this.overlayElements.delete(selector);
            updated = true;
          }
        }
        if (updated) {
          this.repositionGameOverlay();
        }
        const stillMissing = OVERLAY_SELECTORS.some((selector) => {
          const current = this.overlayElements.get(selector);
          return (
            !current || !current.root.isConnected || !current.target.isConnected
          );
        });
        if (!stillMissing) {
          this.overlayObserver?.disconnect();
          this.overlayObserver = undefined;
        }
      });
      this.overlayObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
    repositionGameOverlay() {
      let missingElement = false;
      const sidebarWidth = this.isSidebarHidden
        ? 0
        : this.sidebar.getBoundingClientRect().width;
      const offset = Math.round(sidebarWidth) + 16;
      for (const selector of OVERLAY_SELECTORS) {
        const registration = this.ensureOverlayRegistration(selector);
        if (!registration) {
          missingElement = true;
          continue;
        }
        const target = registration.target;
        if (this.isSidebarHidden) {
          target.style.left = registration.originalLeft;
          target.style.right = registration.originalRight;
          target.style.maxWidth = registration.originalMaxWidth;
        } else {
          target.style.left = `${offset}px`;
          target.style.right = "auto";
          target.style.maxWidth = `calc(100vw - ${offset + 24}px)`;
        }
      }
      if (missingElement) {
        this.observeGameOverlays();
      }
    }
    ensureOverlayRegistration(selector) {
      let registration = this.overlayElements.get(selector) ?? null;
      let root = registration?.root;
      if (!root || !root.isConnected) {
        const candidate = document.querySelector(selector);
        if (!candidate) {
          this.overlayElements.delete(selector);
          return null;
        }
        root = candidate;
      }
      let target = registration?.target;
      if (!target || !target.isConnected) {
        const resolved = this.resolveOverlayTarget(selector, root);
        if (!resolved) {
          this.overlayElements.delete(selector);
          return null;
        }
        target = resolved;
      }
      if (
        !registration ||
        registration.root !== root ||
        registration.target !== target
      ) {
        this.registerOverlay(selector, root, target);
        registration = this.overlayElements.get(selector) ?? null;
      }
      return registration;
    }
    registerOverlay(selector, root, target) {
      const existing = this.overlayElements.get(selector);
      const originalLeft =
        existing && existing.target === target
          ? existing.originalLeft
          : target.style.left;
      const originalRight =
        existing && existing.target === target
          ? existing.originalRight
          : target.style.right;
      const originalMaxWidth =
        existing && existing.target === target
          ? existing.originalMaxWidth
          : target.style.maxWidth;
      this.overlayElements.set(selector, {
        root,
        target,
        originalLeft,
        originalRight,
        originalMaxWidth,
      });
    }
    toggleSidebarVisibility(force) {
      const nextHidden =
        typeof force === "boolean" ? force : !this.isSidebarHidden;
      if (nextHidden === this.isSidebarHidden) {
        return;
      }
      this.isSidebarHidden = nextHidden;
      if (nextHidden) {
        this.sidebar.style.display = "none";
        this.sidebar.setAttribute("aria-hidden", "true");
        this.sidebar.dataset.sidebarHidden = "true";
      } else {
        this.sidebar.style.display = "";
        this.sidebar.removeAttribute("aria-hidden");
        delete this.sidebar.dataset.sidebarHidden;
      }
      this.repositionGameOverlay();
    }
    resolveOverlayTarget(selector, root) {
      if (!root.isConnected) {
        return null;
      }
      if (selector === "game-left-sidebar") {
        const fixedChild = this.findPositionedChild(root);
        if (fixedChild) {
          return fixedChild;
        }
      }
      const ancestor = this.findPositionedAncestor(root);
      if (ancestor) {
        return ancestor;
      }
      if (selector === "game-left-sidebar") {
        const aside = root.querySelector("aside");
        if (aside) {
          return aside;
        }
      }
      return root;
    }
    findPositionedAncestor(element) {
      let current = element;
      while (current) {
        const position = window.getComputedStyle(current).position;
        if (position && position !== "static") {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    }
    findPositionedChild(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      const current = walker.currentNode;
      if (current !== root) {
        const position = window.getComputedStyle(current).position;
        if (position && position !== "static") {
          return current;
        }
      }
      while (true) {
        const next = walker.nextNode();
        if (!next) {
          break;
        }
        const position = window.getComputedStyle(next).position;
        if (position && position !== "static") {
          return next;
        }
      }
      return null;
    }
    renderLayout() {
      this.layoutContainer.innerHTML = "";
      const rootElement = this.buildNodeElement(this.rootNode);
      rootElement.classList.add("flex-1", "min-h-0");
      rootElement.style.flex = "1 1 0%";
      this.layoutContainer.appendChild(rootElement);
      this.refreshAllLeaves();
    }
    buildNodeElement(node) {
      if (node.type === "leaf") {
        return this.buildLeafElement(node);
      }
      return this.buildGroupElement(node);
    }
    buildLeafElement(leaf) {
      const wrapper = createElement(
        "div",
        "flex min-h-[200px] flex-1 flex-col overflow-hidden rounded-lg border border-slate-800/70 bg-slate-900/70 shadow-inner",
      );
      wrapper.dataset.nodeId = leaf.id;
      const header = createElement(
        "div",
        "flex items-center justify-between gap-2 border-b border-slate-800/70 bg-slate-900/80 px-3 py-2",
      );
      const select = createElement(
        "select",
        "min-w-[8rem] max-w-full shrink-0 rounded-md border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/70",
      );
      for (const option of VIEW_OPTIONS) {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        select.appendChild(opt);
      }
      select.value = leaf.view;
      select.addEventListener("change", () => {
        leaf.view = select.value;
        this.refreshLeafContent(leaf);
      });
      header.appendChild(select);
      const actions = createElement("div", "flex items-center gap-2");
      actions.appendChild(
        this.createActionButton("Split horizontally", "split-horizontal", () =>
          this.splitLeaf(leaf, "horizontal"),
        ),
      );
      actions.appendChild(
        this.createActionButton("Split vertically", "split-vertical", () =>
          this.splitLeaf(leaf, "vertical"),
        ),
      );
      actions.appendChild(
        this.createActionButton("Close panel", "close", () =>
          this.closeLeaf(leaf),
        ),
      );
      header.appendChild(actions);
      const body = createElement(
        "div",
        "flex flex-1 min-h-0 flex-col overflow-hidden",
      );
      wrapper.appendChild(header);
      wrapper.appendChild(body);
      leaf.element = { wrapper, header, body };
      this.refreshLeafContent(leaf);
      return wrapper;
    }
    createActionButton(label, icon, handler) {
      const button = createElement(
        "button",
        "flex h-7 w-7 items-center justify-center rounded-md border border-slate-700/70 bg-slate-800/70 text-slate-300 transition-colors hover:border-sky-500/60 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50",
      );
      button.type = "button";
      button.title = label;
      button.appendChild(renderIcon(icon, "h-4 w-4"));
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handler();
      });
      return button;
    }
    buildGroupElement(group) {
      const wrapper = createElement(
        "div",
        group.orientation === "horizontal"
          ? "flex min-h-0 flex-1 flex-col"
          : "flex min-h-0 flex-1 flex-row",
      );
      wrapper.dataset.groupId = group.id;
      group.element = { wrapper };
      const count = group.children.length;
      if (group.sizes.length !== count) {
        this.normalizeSizes(group);
      }
      for (let i = 0; i < count; i++) {
        const child = group.children[i];
        const childWrapper = createElement("div", "flex min-h-0 flex-1");
        childWrapper.dataset.panelChild = String(i);
        childWrapper.style.flex = `${group.sizes[i] ?? 1} 1 0%`;
        childWrapper.appendChild(this.buildNodeElement(child));
        wrapper.appendChild(childWrapper);
        if (i < count - 1) {
          const handle = createElement(
            "div",
            group.orientation === "horizontal"
              ? "group relative -my-px flex h-3 w-full cursor-row-resize items-center justify-center rounded-md bg-transparent transition-colors duration-150 hover:bg-sky-500/10"
              : "group relative -mx-px flex w-3 h-full cursor-col-resize items-center justify-center rounded-md bg-transparent transition-colors duration-150 hover:bg-sky-500/10",
          );
          handle.appendChild(
            createElement(
              "span",
              group.orientation === "horizontal"
                ? "h-px w-10 rounded-full bg-slate-600/60 transition-colors duration-150 group-hover:bg-sky-400/60"
                : "w-px h-10 rounded-full bg-slate-600/60 transition-colors duration-150 group-hover:bg-sky-400/60",
            ),
          );
          handle.dataset.handleIndex = String(i);
          handle.addEventListener("pointerdown", (event) =>
            this.startPanelResize(group, i, event),
          );
          wrapper.appendChild(handle);
        }
      }
      return wrapper;
    }
    startPanelResize(group, index, event) {
      const wrapper = group.element?.wrapper;
      if (!wrapper) {
        return;
      }
      const childA = wrapper.querySelector(`[data-panel-child="${index}"]`);
      const childB = wrapper.querySelector(`[data-panel-child="${index + 1}"]`);
      if (!childA || !childB) {
        return;
      }
      event.preventDefault();
      const orientation = group.orientation;
      const rectA = childA.getBoundingClientRect();
      const rectB = childB.getBoundingClientRect();
      const totalPixels =
        orientation === "horizontal"
          ? rectA.height + rectB.height
          : rectA.width + rectB.width;
      const initialPixelsA =
        orientation === "horizontal" ? rectA.height : rectA.width;
      const startCoord =
        orientation === "horizontal" ? event.clientY : event.clientX;
      const originalUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      const onMove = (moveEvent) => {
        const currentCoord =
          orientation === "horizontal" ? moveEvent.clientY : moveEvent.clientX;
        const delta = currentCoord - startCoord;
        const nextPixelsA = clamp(
          initialPixelsA + delta,
          totalPixels * 0.15,
          totalPixels * 0.85,
        );
        const nextPixelsB = totalPixels - nextPixelsA;
        const ratioA = nextPixelsA / totalPixels;
        const ratioB = nextPixelsB / totalPixels;
        group.sizes[index] = ratioA;
        group.sizes[index + 1] = ratioB;
        childA.style.flex = `${ratioA} 1 0%`;
        childB.style.flex = `${ratioB} 1 0%`;
      };
      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        document.body.style.userSelect = originalUserSelect;
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    }
    splitLeaf(leaf, orientation) {
      const newLeaf = createLeaf(leaf.view);
      const parentInfo = this.findParent(leaf);
      if (!parentInfo) {
        this.rootNode = createGroup(orientation, [leaf, newLeaf]);
      } else {
        const { parent, index } = parentInfo;
        if (parent.orientation === orientation) {
          parent.children.splice(index + 1, 0, newLeaf);
          parent.sizes.splice(
            index + 1,
            0,
            parent.sizes[index] ?? 1 / parent.children.length,
          );
          this.normalizeSizes(parent);
        } else {
          const replacement = createGroup(orientation, [leaf, newLeaf]);
          parent.children[index] = replacement;
          this.normalizeSizes(parent);
        }
      }
      this.renderLayout();
    }
    closeLeaf(leaf) {
      this.cleanupLeafView(leaf);
      const parentInfo = this.findParent(leaf);
      if (!parentInfo) {
        this.rootNode = createLeaf("clanmates");
        this.renderLayout();
        return;
      }
      const { parent, index } = parentInfo;
      parent.children.splice(index, 1);
      parent.sizes.splice(index, 1);
      if (parent.children.length === 0) {
        this.rootNode = createLeaf("clanmates");
      } else if (parent.children.length === 1) {
        this.replaceNode(parent, parent.children[0]);
      } else {
        this.normalizeSizes(parent);
      }
      this.renderLayout();
    }
    replaceNode(target, replacement) {
      if (this.rootNode === target) {
        this.rootNode = replacement;
        return;
      }
      const parentInfo = this.findParent(target);
      if (!parentInfo) {
        return;
      }
      const { parent, index } = parentInfo;
      parent.children[index] = replacement;
      this.normalizeSizes(parent);
    }
    findParent(target, current = this.rootNode) {
      if (current.type === "group") {
        for (let i = 0; i < current.children.length; i++) {
          const child = current.children[i];
          if (child === target) {
            return { parent: current, index: i };
          }
          const result = this.findParent(target, child);
          if (result) {
            return result;
          }
        }
      }
      return null;
    }
    normalizeSizes(group) {
      const count = group.children.length;
      if (count === 0) {
        group.sizes = [];
        return;
      }
      const size = 1 / count;
      group.sizes = new Array(count).fill(size);
    }
    refreshAllLeaves() {
      for (const leaf of this.getLeaves()) {
        this.refreshLeafContent(leaf);
      }
    }
    refreshLeafContent(leaf) {
      const element = leaf.element;
      if (!element) {
        return;
      }
      const previousContainer =
        leaf.contentContainer ?? element.body.firstElementChild;
      const previousCleanup = leaf.viewCleanup;
      const previousScrollTop =
        leaf.scrollTop ?? previousContainer?.scrollTop ?? 0;
      const previousScrollLeft =
        leaf.scrollLeft ?? previousContainer?.scrollLeft ?? 0;
      const lifecycle = this.createViewLifecycle(leaf);
      const nextContainer = buildViewContent(
        leaf,
        this.snapshot,
        () => this.refreshLeafContent(leaf),
        previousContainer ?? undefined,
        lifecycle.callbacks,
        this.viewActions,
      );
      const replaced =
        !!previousContainer && nextContainer !== previousContainer;
      if (replaced) {
        if (previousCleanup) {
          previousCleanup();
        }
      }
      const newCleanup = lifecycle.getCleanup();
      if (newCleanup) {
        leaf.viewCleanup = newCleanup;
      } else if (!replaced) {
        leaf.viewCleanup = previousCleanup;
      } else {
        leaf.viewCleanup = undefined;
      }
      if (
        !previousContainer ||
        nextContainer !== previousContainer ||
        nextContainer.parentElement !== element.body
      ) {
        element.body.replaceChildren(nextContainer);
      }
      leaf.contentContainer = nextContainer;
      if (nextContainer) {
        nextContainer.scrollTop = previousScrollTop;
        nextContainer.scrollLeft = previousScrollLeft;
        leaf.scrollTop = nextContainer.scrollTop;
        leaf.scrollLeft = nextContainer.scrollLeft;
        this.bindLeafContainerInteractions(leaf, nextContainer);
      } else {
        leaf.scrollTop = 0;
        leaf.scrollLeft = 0;
      }
    }
    createViewLifecycle(leaf) {
      let cleanup;
      const callbacks = {
        registerCleanup: (fn) => {
          cleanup = fn;
        },
      };
      return {
        callbacks,
        getCleanup: () => cleanup,
      };
    }
    cleanupLeafView(leaf) {
      const cleanup = leaf.viewCleanup;
      leaf.viewCleanup = undefined;
      if (cleanup) {
        cleanup();
      }
    }
    bindLeafContainerInteractions(leaf, container) {
      if (leaf.hoveredRowElement && !leaf.hoveredRowElement.isConnected) {
        leaf.hoveredRowElement = null;
      }
      if (leaf.boundContainer && leaf.boundContainer !== container) {
        if (leaf.scrollHandler) {
          leaf.boundContainer.removeEventListener("scroll", leaf.scrollHandler);
        }
        if (leaf.pointerLeaveHandler) {
          leaf.boundContainer.removeEventListener(
            "pointerleave",
            leaf.pointerLeaveHandler,
          );
        }
      }
      if (leaf.boundContainer !== container) {
        const handleScroll = () => {
          leaf.scrollTop = container.scrollTop;
          leaf.scrollLeft = container.scrollLeft;
        };
        const handlePointerLeave = () => this.clearLeafHover(leaf);
        container.addEventListener("scroll", handleScroll, { passive: true });
        container.addEventListener("pointerleave", handlePointerLeave);
        leaf.boundContainer = container;
        leaf.scrollHandler = handleScroll;
        leaf.pointerLeaveHandler = handlePointerLeave;
      }
    }
    clearLeafHover(leaf) {
      if (leaf.hoveredRowElement) {
        const highlightClass =
          leaf.hoveredRowElement.dataset.hoverHighlightClass;
        if (highlightClass) {
          leaf.hoveredRowElement.classList.remove(highlightClass);
        }
      }
      leaf.hoveredRowElement = null;
      leaf.hoveredRowKey = undefined;
    }
    showPlayerDetails(playerId) {
      for (const leaf of this.getLeaves()) {
        if (leaf.view !== "player") {
          continue;
        }
        leaf.selectedPlayerId = playerId;
        this.refreshLeafContent(leaf);
      }
    }
    getLeaves(node = this.rootNode, acc = []) {
      if (node.type === "leaf") {
        acc.push(node);
        return acc;
      }
      for (const child of node.children) {
        this.getLeaves(child, acc);
      }
      return acc;
    }
  }

  const TICK_MILLISECONDS = 100;
  class DataStore {
    constructor(initialSnapshot) {
      this.listeners = new Set();
      this.game = null;
      this.previousAlliances = new Map();
      this.traitorHistory = new Map();
      this.shipOrigins = new Map();
      this.shipDestinations = new Map();
      this.shipManifests = new Map();
      this.actionIdCounter = 0;
      this.runningActionIdCounter = 0;
      this.settingIdCounter = 0;
      this.runningRemovalTimers = new Map();
      this.actionRuntimes = new Map();
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
    attachActionsState(snapshot) {
      return {
        ...snapshot,
        sidebarActions: this.actionsState,
      };
    }
    createInitialActionsState() {
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
    nextActionId() {
      this.actionIdCounter += 1;
      return `action-${this.actionIdCounter}`;
    }
    nextRunningActionId() {
      this.runningActionIdCounter += 1;
      return `run-${this.runningActionIdCounter}`;
    }
    nextSettingId() {
      this.settingIdCounter += 1;
      return `setting-${this.settingIdCounter}`;
    }
    normalizeSettingValue(type, value) {
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
    createSetting(options) {
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
    createActionDefinition(options) {
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
    cloneSetting(setting) {
      return {
        ...setting,
        id: this.nextSettingId(),
        value: this.normalizeSettingValue(setting.type, setting.value),
      };
    }
    cloneSettings(settings) {
      return settings.map((setting) => this.cloneSetting(setting));
    }
    sanitizeSetting(setting) {
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
    clearRunningRemovalTimer(runId) {
      const handle = this.runningRemovalTimers.get(runId);
      if (handle !== undefined) {
        clearTimeout(handle);
        this.runningRemovalTimers.delete(runId);
      }
    }
    scheduleOneShotRemoval(runId) {
      this.clearRunningRemovalTimer(runId);
      const handler = () => {
        this.runningRemovalTimers.delete(runId);
        this.completeRunningAction(runId);
      };
      const timeout = setTimeout(handler, 1500);
      this.runningRemovalTimers.set(runId, timeout);
    }
    commitActionsState(updater) {
      this.actionsState = updater(this.actionsState);
      this.snapshot = this.attachActionsState(this.snapshot);
      this.notify();
    }
    completeRunningAction(runId) {
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
    getSnapshot() {
      return this.snapshot;
    }
    subscribe(listener) {
      this.listeners.add(listener);
      listener(this.snapshot);
      return () => {
        this.listeners.delete(listener);
      };
    }
    update(snapshot) {
      this.snapshot = this.attachActionsState({
        ...snapshot,
        currentTimeMs: snapshot.currentTimeMs ?? Date.now(),
        ships: snapshot.ships ?? [],
      });
      this.notify();
    }
    setTradingStopped(targetPlayerIds, stopped) {
      if (!this.game) {
        console.warn("Sidebar trading toggle skipped: game unavailable");
        return;
      }
      const localPlayer = this.resolveLocalPlayer();
      if (!localPlayer) {
        console.warn(
          "Sidebar trading toggle skipped: local player unavailable",
        );
        return;
      }
      const selfId = this.resolveSelfId(localPlayer);
      const uniqueIds = new Set(targetPlayerIds);
      const targets = [];
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
    createAction() {
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
    selectAction(actionId) {
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
    saveAction(actionId, update) {
      const normalizedSettings = update.settings.map((setting) =>
        this.sanitizeSetting(setting),
      );
      const trimmedName = update.name.trim();
      const resolvedName = trimmedName === "" ? "Untitled action" : trimmedName;
      const trimmedDescription = update.description?.trim() ?? "";
      const interval = Math.max(1, Math.floor(update.runIntervalTicks ?? 1));
      this.commitActionsState((state) => {
        const index = state.actions.findIndex(
          (action) => action.id === actionId,
        );
        if (index === -1) {
          return state;
        }
        const current = state.actions[index];
        const next = {
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
    deleteAction(actionId) {
      this.commitActionsState((state) => {
        const index = state.actions.findIndex(
          (action) => action.id === actionId,
        );
        if (index === -1) {
          return state;
        }
        const actions = state.actions.filter(
          (action) => action.id !== actionId,
        );
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
    startAction(actionId) {
      const action = this.actionsState.actions.find(
        (entry) => entry.id === actionId,
      );
      if (!action) {
        return;
      }
      const now = Date.now();
      const run = {
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
    launchAction(action, runId) {
      const run = this.getRunningActionEntry(runId);
      if (!run) {
        return;
      }
      if (action.runMode === "once") {
        const state = {};
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
    startContinuousRuntime(action, run) {
      if (typeof window === "undefined") {
        console.warn(
          "Continuous sidebar actions are unavailable outside the browser.",
        );
        this.finalizeRunningAction(run.id, "failed");
        return;
      }
      const runId = run.id;
      const runtime = {
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
        updateInterval: (ticks) => {
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
    selectRunningAction(runId) {
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
    stopRunningAction(runId) {
      const exists = this.actionsState.running.some((run) => run.id === runId);
      if (!exists) {
        return;
      }
      this.clearRunningRemovalTimer(runId);
      this.finalizeRunningAction(runId, "stopped");
    }
    updateRunningActionSetting(runId, settingId, value) {
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
    setRunningActionInterval(runId, ticks) {
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
    async executeActionScript(action, run, state) {
      const context = this.createActionExecutionContext(run, state);
      const module = { exports: {} };
      const exports = module.exports;
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
        if (output && typeof output.then === "function") {
          await output;
        }
        return;
      }
      if (result && typeof result.then === "function") {
        await result;
      }
    }
    resolveActionRunFunction(candidate) {
      if (!candidate) {
        return null;
      }
      if (typeof candidate === "function") {
        return candidate;
      }
      if (typeof candidate === "object") {
        const run = candidate.run;
        if (typeof run === "function") {
          return run;
        }
        const defaultExport = candidate.default;
        if (typeof defaultExport === "function") {
          return defaultExport;
        }
      }
      return null;
    }
    createActionExecutionContext(run, state) {
      const settings = {};
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
      };
    }
    buildActionGameApi() {
      const players = this.snapshot.players.map((player) => ({
        id: player.id,
        name: player.name,
        isSelf: player.isSelf ?? false,
        tradeStopped: player.tradeStopped ?? false,
        tiles: player.tiles,
        gold: player.gold,
        troops: player.troops,
      }));
      const createHandler = (stopped) => (target) => {
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
    normalizeTargetIds(target) {
      if (typeof target === "string" || typeof target === "number") {
        return [String(target)];
      }
      const iterable = target;
      if (!iterable || typeof iterable[Symbol.iterator] !== "function") {
        return [];
      }
      const unique = new Set();
      for (const entry of iterable) {
        if (entry === undefined || entry === null) {
          continue;
        }
        unique.add(String(entry));
      }
      return [...unique];
    }
    getCurrentGameTick() {
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
    touchRunningAction(runId) {
      this.commitActionsState((state) => {
        const index = state.running.findIndex((run) => run.id === runId);
        if (index === -1) {
          return state;
        }
        const current = state.running[index];
        const next = {
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
    finalizeRunningAction(runId, status) {
      this.clearRunningController(runId);
      this.clearRunningRemovalTimer(runId);
      this.commitActionsState((state) => {
        const index = state.running.findIndex((run) => run.id === runId);
        if (index === -1) {
          return state;
        }
        const current = state.running[index];
        const next = {
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
    clearRunningController(runId) {
      const runtime = this.actionRuntimes.get(runId);
      if (!runtime) {
        return;
      }
      runtime.stop();
      this.actionRuntimes.delete(runId);
    }
    getRunningActionEntry(runId) {
      return this.actionsState.running.find((run) => run.id === runId);
    }
    resolvePlayerPanel() {
      if (typeof document === "undefined") {
        return null;
      }
      const element = document.querySelector("player-panel");
      return element ?? null;
    }
    resolveSelfId(localPlayer) {
      if (localPlayer) {
        try {
          return String(localPlayer.id());
        } catch (error) {
          console.warn("Failed to read local player id", error);
        }
      }
      const snapshotSelf = this.snapshot.players.find(
        (player) => player.isSelf,
      );
      return snapshotSelf?.id ?? null;
    }
    notify() {
      for (const listener of this.listeners) {
        listener(this.snapshot);
      }
    }
    scheduleGameDiscovery(immediate = false) {
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
    findLiveGame() {
      const candidates = document.querySelectorAll(
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
    refreshFromGame() {
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
    createShipRecords() {
      if (!this.game) {
        return [];
      }
      const units = this.game.units("Transport", "Trade Ship", "Warship");
      const ships = [];
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
    createShipRecord(unit, type) {
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
    resolveShipRetreating(unit) {
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
    resolveShipOrigin(shipId, unit) {
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
    resolveShipDestination(shipId, unit, type, retreating) {
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
        const inferred = this.inferTransportDestination(
          shipId,
          unit,
          retreating,
        );
        if (inferred) {
          return inferred;
        }
      }
      return undefined;
    }
    getShipDestinationRef(unit, type) {
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
    resolveShipTroops(shipId, unit, type) {
      const troops = unit.troops();
      if (troops > 0 || !this.shipManifests.has(shipId)) {
        this.shipManifests.set(shipId, troops);
      }
      if (type === "Transport" && troops === 0) {
        return this.shipManifests.get(shipId) ?? troops;
      }
      return troops;
    }
    pruneStaleShipMemory(activeIds) {
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
    inferTransportDestination(shipId, unit, retreating) {
      if (!this.game || retreating) {
        return this.shipDestinations.get(shipId);
      }
      const cached = this.shipDestinations.get(shipId);
      if (cached) {
        return cached;
      }
      const start = unit.tile();
      const visited = new Set([start]);
      const queue = [start];
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
            let ownerId = null;
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
    safePlayerSmallId(player) {
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
    describeTile(ref) {
      if (!this.game || ref === undefined) {
        return undefined;
      }
      const x = this.game.x(ref);
      const y = this.game.y(ref);
      let ownerId;
      let ownerName;
      if (this.game.hasOwner(ref)) {
        const smallId = this.game.ownerID(ref);
        ownerId = String(smallId);
        ownerName = this.resolveNameBySmallId(smallId);
      }
      return { ref, x, y, ownerId, ownerName };
    }
    describePlayerFocus(player) {
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
        let ref;
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
        };
      } catch (error) {
        console.warn("Failed to resolve player focus position", error);
        return undefined;
      }
    }
    normalizeShipType(unitType) {
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
    captureAllianceChanges(players) {
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
          const removed = [...previous].filter(
            (id) => !currentAlliances.has(id),
          );
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
    createPlayerRecord(player, currentTimeMs, localPlayer) {
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
      const gold =
        typeof goldValue === "bigint" ? Number(goldValue) : goldValue;
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
    mapIncomingAttacks(attacks) {
      return attacks.map((attack) => ({
        id: attack.id,
        from: this.resolveNameBySmallId(attack.attackerID),
        troops: this.resolveAttackTroops(attack),
      }));
    }
    mapOutgoingAttacks(attacks) {
      return attacks.map((attack) => ({
        id: attack.id,
        target: this.resolveNameBySmallId(attack.targetID),
        troops: this.resolveAttackTroops(attack),
      }));
    }
    resolveAttackTroops(attack) {
      if (attack.troops > 0) {
        return attack.troops;
      }
      const manifest = this.shipManifests.get(String(attack.id));
      return manifest ?? attack.troops;
    }
    mapActiveAlliances(player) {
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
    resolveNameBySmallId(id) {
      if (id === 0) {
        return "Terra Nullius";
      }
      if (!this.game) {
        return `Player ${id}`;
      }
      try {
        const entity = this.game.playerBySmallID(id);
        if (
          "displayName" in entity &&
          typeof entity.displayName === "function"
        ) {
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
    resolveNameByPlayerId(id) {
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
    extractClanFromName(name) {
      if (!name.startsWith("[") || !name.includes("]")) {
        return undefined;
      }
      const match = name.match(/^\[([a-zA-Z]{2,5})\]/);
      return match ? match[1] : undefined;
    }
    getTraitorTargets(playerId) {
      if (!this.traitorHistory.has(playerId)) {
        this.traitorHistory.set(playerId, new Set());
      }
      return this.traitorHistory.get(playerId);
    }
    isPlayerCurrentlyTraitor(player) {
      if (player.isTraitor()) {
        return true;
      }
      if (typeof player.getTraitorRemainingTicks === "function") {
        return player.getTraitorRemainingTicks() > 0;
      }
      const remaining = player.traitorRemainingTicks;
      return typeof remaining === "number" ? remaining > 0 : false;
    }
    resolveLocalPlayer() {
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
    determineTradeStopped(localPlayer, other) {
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
    isSamePlayer(player, otherId) {
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
    resolvePlayerById(playerId) {
      if (!this.game) {
        return null;
      }
      const attempts = [
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
    isPlayerViewLike(value) {
      if (!value || typeof value !== "object") {
        return false;
      }
      const candidate = value;
      return (
        typeof candidate.id === "function" &&
        typeof candidate.displayName === "function" &&
        typeof candidate.smallID === "function"
      );
    }
    describePlayerForLog(player) {
      let name = "Unknown";
      let id = "?";
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

  async function ensureTailwind() {
    if (document.querySelector("script[data-openfront-tailwind]")) {
      return;
    }
    await new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://cdn.tailwindcss.com?plugins=forms,typography";
      script.dataset.openfrontTailwind = "true";
      script.async = true;
      const tailwindGlobal = window.tailwind ?? {};
      tailwindGlobal.config = {
        corePlugins: {
          preflight: false,
        },
        theme: {
          extend: {},
        },
      };
      window.tailwind = tailwindGlobal;
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
  }
  async function initializeSidebar() {
    if (window.openFrontStrategicSidebar) {
      return;
    }
    await ensureTailwind();
    const store = new DataStore();
    new SidebarApp(store);
    window.openFrontStrategicSidebar = {
      updateData: (snapshot) => store.update(snapshot),
    };
  }
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => void initializeSidebar(),
    );
  } else {
    void initializeSidebar();
  }
})();
