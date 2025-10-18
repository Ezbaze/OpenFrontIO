// ==UserScript==
// @name			OpenFront Strategic Sidebar
// @namespace		https://openfront.io/
// @version			0.1.0
// @description		Adds a resizable, splittable strategic sidebar for OpenFront players, clans, and teams.
// @match			https://*.openfront.io/*
// @match			https://openfront.io/*
// @updateURL		https://raw.githubusercontent.com/OpenFrontIO/userscripts/main/openfront-strategic-sidebar.user.js
// @downloadURL		https://raw.githubusercontent.com/OpenFrontIO/userscripts/main/openfront-strategic-sidebar.user.js
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
  function formatNumber(value) {
    return numberFormatter.format(value);
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
        "fixed z-[100000] min-w-[160px] overflow-hidden rounded-md border " +
          "border-slate-700/80 bg-slate-950/95 text-sm text-slate-100 shadow-2xl " +
          "backdrop-blur",
      );
      contextMenuElement.dataset.sidebarRole = "context-menu";
      contextMenuElement.style.pointerEvents = "auto";
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
    const { x, y, items } = options;
    if (!items.length) {
      hideContextMenu();
      return;
    }
    hideContextMenu();
    const menu = ensureContextMenuElement();
    menu.className =
      "fixed z-[100000] min-w-[160px] overflow-hidden rounded-md border " +
      "border-slate-700/80 bg-slate-950/95 text-sm text-slate-100 shadow-2xl " +
      "backdrop-blur";
    menu.style.visibility = "hidden";
    menu.style.left = "0px";
    menu.style.top = "0px";
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
    menu.replaceChildren(list);
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
  const LANDMASS_HEADERS = [
    { key: "label", label: "Player", align: "left" },
    { key: "tiles", label: "Tiles", align: "right" },
    { key: "origin", label: "Location", align: "left" },
  ];
  const DEFAULT_SORT_STATE = { key: "tiles", direction: "desc" };
  function buildViewContent(
    leaf,
    snapshot,
    requestRender,
    existingContainer,
    lifecycle,
  ) {
    const view = leaf.view;
    const sortState = ensureSortState(leaf, view);
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
          lifecycle,
        });
      case "landmasses":
        return renderLandmassView({
          leaf,
          snapshot,
          requestRender,
          sortState,
          onSort: handleSort,
          existingContainer,
          lifecycle,
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
    const {
      leaf,
      snapshot,
      requestRender,
      sortState,
      onSort,
      existingContainer,
    } = options;
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
        requestRender,
        metricsCache,
      });
    }
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
      });
    }
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
      });
    }
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
  function renderLandmassView(options) {
    const { leaf, snapshot, sortState, onSort, existingContainer, lifecycle } =
      options;
    lifecycle?.onLandmassMount?.();
    const { container, tbody } = createTableShell({
      sortState,
      onSort,
      existingContainer,
      view: leaf.view,
      headers: LANDMASS_HEADERS,
    });
    lifecycle?.registerCleanup?.(() => {
      lifecycle.onLandmassUnmount?.();
    });
    const playerLookup = new Map(
      snapshot.players.map((player) => [player.id, player]),
    );
    const landmasses = [...snapshot.landmasses].sort((a, b) =>
      compareLandmasses({ a, b, sortState }),
    );
    for (const landmass of landmasses) {
      const rowKey = `landmass:${landmass.id}`;
      const row = createElement(
        "tr",
        "hover:bg-slate-800/50 transition-colors",
      );
      applyPersistentHover(row, leaf, rowKey, "bg-slate-800/50");
      row.dataset.rowKey = rowKey;
      for (const column of LANDMASS_HEADERS) {
        const td = createElement(
          "td",
          cellClassForColumn(column, getLandmassExtraCellClass(column.key)),
        );
        switch (column.key) {
          case "label": {
            const ownerRecord = playerLookup.get(landmass.ownerId);
            const focus = ownerRecord?.position ?? landmass.anchor;
            const wrapper = createElement("div", "flex flex-col gap-0.5");
            wrapper.appendChild(
              createPlayerNameElement(landmass.ownerName, focus, {
                asBlock: true,
                className:
                  "block font-semibold text-slate-100 transition-colors hover:text-sky-200",
              }),
            );
            wrapper.appendChild(
              createElement(
                "span",
                "text-[0.65rem] uppercase tracking-wide text-slate-400",
                `Landmass #${landmass.sequence}`,
              ),
            );
            td.appendChild(wrapper);
            break;
          }
          case "tiles":
            td.textContent = formatNumber(landmass.tiles);
            break;
          case "origin":
            td.appendChild(createCoordinateButton(landmass.anchor));
            break;
          default:
            td.textContent = "";
            break;
        }
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    return container;
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
  function getLandmassExtraCellClass(key) {
    switch (key) {
      case "label":
        return "font-semibold text-slate-100";
      case "tiles":
        return "font-mono text-[0.75rem] text-slate-200";
      case "origin":
        return "text-[0.75rem] text-slate-300";
      default:
        return "text-slate-300";
    }
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
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
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
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
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
        return formatNumber(ship.troops);
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
  function compareLandmasses(options) {
    const { a, b, sortState } = options;
    const valueA = getLandmassSortValue(a, sortState.key);
    const valueB = getLandmassSortValue(b, sortState.key);
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
    return a.sequence - b.sequence;
  }
  function getLandmassSortValue(landmass, key) {
    switch (key) {
      case "label":
      case "owner":
        return landmass.ownerName.toLowerCase();
      case "tiles":
        return landmass.tiles;
      case "origin":
        return tileSortValue(landmass.anchor);
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
  function appendPlayerRows(options) {
    const {
      player,
      indent,
      leaf,
      snapshot,
      tbody,
      requestRender,
      metricsCache,
    } = options;
    const metrics = getMetrics(player, snapshot, metricsCache);
    const rowKey = player.id;
    const expanded = leaf.expandedRows.has(rowKey);
    const tr = createElement("tr", "hover:bg-slate-800/50 transition-colors");
    tr.dataset.rowKey = rowKey;
    applyPersistentHover(tr, leaf, rowKey, "bg-slate-800/50");
    if (!player.isSelf) {
      const handleContextMenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const tradeStopped = player.tradeStopped ?? false;
        showContextMenu({
          x: event.clientX,
          y: event.clientY,
          items: [
            {
              label: tradeStopped ? "Start trading" : "Stop trading",
            },
          ],
        });
      };
      tr.addEventListener("contextmenu", handleContextMenu, { capture: true });
    }
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
        expanded,
        toggleAttribute: "data-player-toggle",
        rowKey,
        onToggle: (next) => {
          if (next) {
            leaf.expandedRows.add(rowKey);
          } else {
            leaf.expandedRows.delete(rowKey);
          }
          requestRender();
        },
        focus: player.position,
      }),
    );
    tr.appendChild(firstCell);
    appendMetricCells(tr, metrics, player);
    tbody.appendChild(tr);
    if (expanded) {
      const detailRow = createElement("tr", "bg-slate-900/80 backdrop-blur-sm");
      applyPersistentHover(detailRow, leaf, rowKey, "bg-slate-900/70");
      const detailCell = createElement(
        "td",
        "border-b border-slate-800 px-4 py-4",
      );
      detailCell.colSpan = TABLE_HEADERS.length;
      detailCell.appendChild(renderPlayerDetails(player, snapshot));
      detailRow.appendChild(detailCell);
      tbody.appendChild(detailRow);
    }
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
    } = options;
    const groupKey = `${groupType}:${group.key}`;
    const expanded = leaf.expandedGroups.has(groupKey);
    const row = createElement(
      "tr",
      "bg-slate-900/70 hover:bg-slate-800/60 transition-colors font-semibold",
    );
    row.dataset.groupKey = groupKey;
    applyPersistentHover(row, leaf, groupKey, "bg-slate-800/60");
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
          requestRender,
          metricsCache,
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
        (attack) => `${attack.from} – ${formatNumber(attack.troops)} troops`,
      ),
    );
    grid.appendChild(
      createDetailSection(
        "Outgoing attacks",
        player.outgoingAttacks,
        (attack) => `${attack.target} – ${formatNumber(attack.troops)} troops`,
      ),
    );
    grid.appendChild(
      createDetailSection(
        "Defensive supports",
        player.defensiveSupports,
        (support) => `${support.ally} – ${formatNumber(support.troops)} troops`,
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
    container.appendChild(button);
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
        return formatNumber(player.troops);
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
        return formatNumber(totals.troops);
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
    { value: "landmasses", label: "Landmasses" },
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
    landmasses: { key: "tiles", direction: "desc" },
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
        landmasses: { ...DEFAULT_SORT_STATES.landmasses },
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
      this.activeLandmassLeaves = new Set();
      this.overlayElements = new Map();
      this.handleOverlayRealign = () => this.repositionGameOverlay();
      this.store = store;
      this.snapshot = store.getSnapshot();
      ensureSidebarStyles();
      this.sidebar = this.createSidebarShell();
      this.layoutContainer = this.sidebar.querySelector(
        "[data-sidebar-layout]",
      );
      this.rootNode = createLeaf("clanmates");
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
      this.repositionGameOverlay();
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
        "absolute right-0 top-0 h-full w-2 translate-x-full cursor-col-resize rounded-r-full bg-transparent transition-colors hover:bg-sky-500/30",
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
            this.overlayElements.set(selector, { root: found, target });
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
              this.overlayElements.set(selector, { root: candidate, target });
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
      const sidebarWidth = this.sidebar.getBoundingClientRect().width;
      const offset = Math.round(sidebarWidth) + 16;
      for (const selector of OVERLAY_SELECTORS) {
        const registration = this.ensureOverlayRegistration(selector);
        if (!registration) {
          missingElement = true;
          continue;
        }
        const target = registration.target;
        target.style.left = `${offset}px`;
        target.style.right = "auto";
        target.style.maxWidth = `calc(100vw - ${offset + 24}px)`;
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
        registration = { root, target };
        this.overlayElements.set(selector, registration);
      }
      return registration;
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
              ? "h-2 w-full cursor-row-resize bg-slate-800/70 hover:bg-slate-700/80"
              : "w-2 h-full cursor-col-resize bg-slate-800/70 hover:bg-slate-700/80",
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
      );
      const replaced =
        !!previousContainer && nextContainer !== previousContainer;
      if (replaced) {
        if (previousCleanup) {
          previousCleanup();
        }
        this.setLeafLandmassActive(leaf, false);
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
        onLandmassMount: () => this.setLeafLandmassActive(leaf, true),
        onLandmassUnmount: () => this.setLeafLandmassActive(leaf, false),
        registerCleanup: (fn) => {
          cleanup = fn;
        },
      };
      return {
        callbacks,
        getCleanup: () => cleanup,
      };
    }
    setLeafLandmassActive(leaf, active) {
      const isActive = this.activeLandmassLeaves.has(leaf.id);
      if (active) {
        if (isActive) {
          return;
        }
        this.activeLandmassLeaves.add(leaf.id);
      } else {
        if (!isActive) {
          return;
        }
        this.activeLandmassLeaves.delete(leaf.id);
      }
      this.store.setLandmassTrackingEnabled(this.activeLandmassLeaves.size > 0);
    }
    cleanupLeafView(leaf) {
      const cleanup = leaf.viewCleanup;
      leaf.viewCleanup = undefined;
      if (cleanup) {
        cleanup();
      }
      this.setLeafLandmassActive(leaf, false);
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
  const LANDMASS_REFRESH_INTERVAL_TICKS = 50;
  class DataStore {
    constructor(initialSnapshot) {
      this.listeners = new Set();
      this.game = null;
      this.previousAlliances = new Map();
      this.traitorHistory = new Map();
      this.shipOrigins = new Map();
      this.shipDestinations = new Map();
      this.shipManifests = new Map();
      this.landmassCache = null;
      this.landmassTrackingEnabled = false;
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
      this.snapshot = {
        ...snapshot,
        currentTimeMs: snapshot.currentTimeMs ?? Date.now(),
        ships: snapshot.ships ?? [],
        landmasses: snapshot.landmasses ?? [],
      };
      this.notify();
    }
    setLandmassTrackingEnabled(enabled) {
      if (this.landmassTrackingEnabled === enabled) {
        return;
      }
      this.landmassTrackingEnabled = enabled;
      if (!enabled) {
        this.landmassCache = null;
        if (this.snapshot.landmasses.length > 0) {
          this.snapshot = {
            ...this.snapshot,
            landmasses: [],
          };
          this.notify();
        }
        return;
      }
      if (this.game) {
        this.refreshFromGame();
      }
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
        const landmasses = this.landmassTrackingEnabled
          ? this.resolveLandmassRecords(currentTick)
          : [];
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
    resolveLandmassRecords(currentTick) {
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
    createLandmassRecords() {
      if (!this.game) {
        return [];
      }
      const visited = new Set();
      const ownerSequences = new Map();
      const records = [];
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
    collectLandmass(startRef, ownerSmallId, visited) {
      if (!this.game) {
        return null;
      }
      const queue = [startRef];
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
    isTileOwnedBy(ref, ownerSmallId) {
      const owner = this.getTileOwner(ref);
      return owner !== null && owner === ownerSmallId;
    }
    getTileOwner(ref) {
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
      const match = name.match(/\[(.+?)\]/);
      return match ? match[1].trim() : undefined;
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
