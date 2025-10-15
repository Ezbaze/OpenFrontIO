import { DataStore } from "./data";
import { renderIcon } from "./icons";
import {
  GameSnapshot,
  PanelGroupNode,
  PanelLeafElements,
  PanelLeafNode,
  PanelNode,
  PanelOrientation,
  SortState,
  ViewType,
} from "./types";
import { clamp, createElement } from "./utils";
import { buildViewContent } from "./views";

const VIEW_OPTIONS: { value: ViewType; label: string }[] = [
  { value: "players", label: "Players" },
  { value: "clanmates", label: "Clanmates" },
  { value: "teams", label: "Teams" },
  { value: "ships", label: "Ships" },
  { value: "landmasses", label: "Landmasses" },
];

const SIDEBAR_STYLE_ID = "openfront-strategic-sidebar-styles";

function ensureSidebarStyles(): void {
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

const OVERLAY_SELECTORS = ["game-left-sidebar", "control-panel"] as const;
type OverlaySelector = (typeof OVERLAY_SELECTORS)[number];

interface OverlayRegistration {
  root: HTMLElement;
  target: HTMLElement;
}

let leafIdCounter = 0;
let groupIdCounter = 0;

const DEFAULT_SORT_STATES: Record<ViewType, SortState> = {
  players: { key: "tiles", direction: "desc" },
  clanmates: { key: "tiles", direction: "desc" },
  teams: { key: "tiles", direction: "desc" },
  ships: { key: "owner", direction: "asc" },
  landmasses: { key: "tiles", direction: "desc" },
};

function createLeaf(view: ViewType): PanelLeafNode {
  return {
    id: `leaf-${++leafIdCounter}`,
    type: "leaf",
    view,
    expandedRows: new Set<string>(),
    expandedGroups: new Set<string>(),
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

function createGroup(
  orientation: PanelOrientation,
  children: PanelNode[],
): PanelGroupNode {
  const count = Math.max(children.length, 1);
  return {
    id: `group-${++groupIdCounter}`,
    type: "group",
    orientation,
    children,
    sizes: new Array(count).fill(1 / count),
  };
}

export class SidebarApp {
  private readonly sidebar: HTMLElement;
  private readonly layoutContainer: HTMLElement;
  private readonly store: DataStore;
  private snapshot: GameSnapshot;
  private rootNode: PanelNode;
  private readonly overlayElements = new Map<
    OverlaySelector,
    OverlayRegistration
  >();
  private overlayObserver?: MutationObserver;
  private overlayResizeObserver?: ResizeObserver;
  private readonly handleOverlayRealign = () => this.repositionGameOverlay();

  constructor(store: DataStore) {
    this.store = store;
    this.snapshot = store.getSnapshot();
    ensureSidebarStyles();
    this.sidebar = this.createSidebarShell();
    this.layoutContainer = this.sidebar.querySelector(
      "[data-sidebar-layout]",
    ) as HTMLElement;
    this.rootNode = createGroup("horizontal", [
      createLeaf("players"),
      createLeaf("clanmates"),
    ]);
    this.renderLayout();
    this.store.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.refreshAllLeaves();
    });
    this.observeGameOverlays();
    this.overlayResizeObserver = new ResizeObserver(this.handleOverlayRealign);
    this.overlayResizeObserver.observe(this.sidebar);
    window.addEventListener("resize", this.handleOverlayRealign);
    this.repositionGameOverlay();
  }

  private createSidebarShell(): HTMLElement {
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

  private startSidebarResize(event: PointerEvent): void {
    event.preventDefault();
    const startWidth = this.sidebar.getBoundingClientRect().width;
    const startX = event.clientX;
    const originalUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = clamp(startWidth + delta, 280, window.innerWidth * 0.9);
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

  private observeGameOverlays(): void {
    let discovered = false;
    for (const selector of OVERLAY_SELECTORS) {
      const registration = this.overlayElements.get(selector);
      if (registration?.root.isConnected && registration.target.isConnected) {
        continue;
      }
      const found = document.querySelector<HTMLElement>(selector);
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
        if (registration?.root.isConnected && registration.target.isConnected) {
          continue;
        }
        const candidate = document.querySelector<HTMLElement>(selector);
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

  private repositionGameOverlay(): void {
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

  private ensureOverlayRegistration(
    selector: OverlaySelector,
  ): OverlayRegistration | null {
    let registration = this.overlayElements.get(selector) ?? null;
    let root = registration?.root;

    if (!root || !root.isConnected) {
      const candidate = document.querySelector<HTMLElement>(selector);
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
      registration = { root, target } satisfies OverlayRegistration;
      this.overlayElements.set(selector, registration);
    }

    return registration;
  }

  private resolveOverlayTarget(
    selector: OverlaySelector,
    root: HTMLElement,
  ): HTMLElement | null {
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
      const aside = root.querySelector<HTMLElement>("aside");
      if (aside) {
        return aside;
      }
    }

    return root;
  }

  private findPositionedAncestor(element: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = element;
    while (current) {
      const position = window.getComputedStyle(current).position;
      if (position && position !== "static") {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  private findPositionedChild(root: HTMLElement): HTMLElement | null {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const current = walker.currentNode as HTMLElement;
    if (current !== root) {
      const position = window.getComputedStyle(current).position;
      if (position && position !== "static") {
        return current;
      }
    }
    while (true) {
      const next = walker.nextNode() as HTMLElement | null;
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

  private renderLayout(): void {
    this.layoutContainer.innerHTML = "";
    const rootElement = this.buildNodeElement(this.rootNode);
    rootElement.classList.add("flex-1", "min-h-0");
    rootElement.style.flex = "1 1 0%";
    this.layoutContainer.appendChild(rootElement);
    this.refreshAllLeaves();
  }

  private buildNodeElement(node: PanelNode): HTMLElement {
    if (node.type === "leaf") {
      return this.buildLeafElement(node);
    }
    return this.buildGroupElement(node);
  }

  private buildLeafElement(leaf: PanelLeafNode): HTMLElement {
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
      leaf.view = select.value as ViewType;
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
    leaf.element = { wrapper, header, body } satisfies PanelLeafElements;
    this.refreshLeafContent(leaf);
    return wrapper;
  }

  private createActionButton(
    label: string,
    icon: "split-horizontal" | "split-vertical" | "close",
    handler: () => void,
  ) {
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

  private buildGroupElement(group: PanelGroupNode): HTMLElement {
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

  private startPanelResize(
    group: PanelGroupNode,
    index: number,
    event: PointerEvent,
  ): void {
    const wrapper = group.element?.wrapper;
    if (!wrapper) {
      return;
    }
    const childA = wrapper.querySelector<HTMLElement>(
      `[data-panel-child="${index}"]`,
    );
    const childB = wrapper.querySelector<HTMLElement>(
      `[data-panel-child="${index + 1}"]`,
    );
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

    const onMove = (moveEvent: PointerEvent) => {
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

  private splitLeaf(leaf: PanelLeafNode, orientation: PanelOrientation): void {
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

  private closeLeaf(leaf: PanelLeafNode): void {
    const parentInfo = this.findParent(leaf);
    if (!parentInfo) {
      this.rootNode = createLeaf("players");
      this.renderLayout();
      return;
    }
    const { parent, index } = parentInfo;
    parent.children.splice(index, 1);
    parent.sizes.splice(index, 1);

    if (parent.children.length === 0) {
      this.rootNode = createLeaf("players");
    } else if (parent.children.length === 1) {
      this.replaceNode(parent, parent.children[0]);
    } else {
      this.normalizeSizes(parent);
    }
    this.renderLayout();
  }

  private replaceNode(target: PanelNode, replacement: PanelNode): void {
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

  private findParent(
    target: PanelNode,
    current: PanelNode = this.rootNode,
  ): { parent: PanelGroupNode; index: number } | null {
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

  private normalizeSizes(group: PanelGroupNode): void {
    const count = group.children.length;
    if (count === 0) {
      group.sizes = [];
      return;
    }
    const size = 1 / count;
    group.sizes = new Array(count).fill(size);
  }

  private refreshAllLeaves(): void {
    for (const leaf of this.getLeaves()) {
      this.refreshLeafContent(leaf);
    }
  }

  private refreshLeafContent(leaf: PanelLeafNode): void {
    const element = leaf.element;
    if (!element) {
      return;
    }
    const previousContainer =
      leaf.contentContainer ??
      (element.body.firstElementChild as HTMLElement | null);
    const previousScrollTop =
      leaf.scrollTop ?? previousContainer?.scrollTop ?? 0;
    const previousScrollLeft =
      leaf.scrollLeft ?? previousContainer?.scrollLeft ?? 0;
    const nextContainer = buildViewContent(
      leaf,
      this.snapshot,
      () => this.refreshLeafContent(leaf),
      previousContainer ?? undefined,
    );

    if (!previousContainer || nextContainer !== previousContainer) {
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

  private bindLeafContainerInteractions(
    leaf: PanelLeafNode,
    container: HTMLElement,
  ): void {
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

  private clearLeafHover(leaf: PanelLeafNode): void {
    if (leaf.hoveredRowElement) {
      const highlightClass = leaf.hoveredRowElement.dataset.hoverHighlightClass;
      if (highlightClass) {
        leaf.hoveredRowElement.classList.remove(highlightClass);
      }
    }
    leaf.hoveredRowElement = null;
    leaf.hoveredRowKey = undefined;
  }

  private getLeaves(
    node: PanelNode = this.rootNode,
    acc: PanelLeafNode[] = [],
  ): PanelLeafNode[] {
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
