import type { TileSummary } from "./types";

const numberFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatCountdown(targetMs: number, nowMs: number): string {
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

export function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (textContent !== undefined) {
    el.textContent = textContent;
  }
  return el;
}

type GoToEmitter = ((x: number, y: number) => void) | null;

let cachedGoToEmitter: GoToEmitter = null;
let cachedEmitterElement: Element | null = null;

const GO_TO_SELECTORS = [
  "events-display",
  "control-panel",
  "leader-board",
] as const;

function resolveGoToEmitter(): GoToEmitter {
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
    const element = document.querySelector(selector) as
      | (Element & {
          emitGoToPositionEvent?: (x: number, y: number) => void;
        })
      | null;
    if (!element) {
      continue;
    }

    const emitter = element.emitGoToPositionEvent;
    if (typeof emitter === "function") {
      cachedEmitterElement = element;
      cachedGoToEmitter = emitter.bind(element);
      return cachedGoToEmitter;
    }

    const prototypeEmitter = (element as unknown as Record<string, unknown>)[
      "emitGoToPositionEvent"
    ];
    if (typeof prototypeEmitter === "function") {
      cachedEmitterElement = element;
      cachedGoToEmitter = (
        prototypeEmitter as (x: number, y: number) => void
      ).bind(element);
      return cachedGoToEmitter;
    }
  }

  return null;
}

export function focusTile(summary?: Pick<TileSummary, "x" | "y">): boolean {
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

interface ContextMenuItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
}

interface ShowContextMenuOptions {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

let contextMenuElement: HTMLDivElement | null = null;
let contextMenuCleanup: (() => void) | null = null;

function ensureContextMenuElement(): HTMLDivElement {
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

export function hideContextMenu(): void {
  if (contextMenuCleanup) {
    contextMenuCleanup();
    contextMenuCleanup = null;
  }

  if (contextMenuElement && contextMenuElement.parentElement) {
    contextMenuElement.parentElement.removeChild(contextMenuElement);
  }
}

export function showContextMenu(options: ShowContextMenuOptions): void {
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

  const cleanupHandlers: Array<() => void> = [];

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

    const handlePointerDown = (event: Event) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (!menu.contains(event.target)) {
        hideContextMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
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
