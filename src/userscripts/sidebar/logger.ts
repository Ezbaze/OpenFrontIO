import {
  type SidebarLogEntry,
  type SidebarLogLevel,
  type SidebarLogger,
} from "./types";

export type SidebarLogListener = (entry: SidebarLogEntry) => void;

const listeners = new Set<SidebarLogListener>();
let logEntryCounter = 0;

function formatLogArg(arg: unknown): string {
  if (typeof arg === "string") {
    return arg;
  }
  if (
    typeof arg === "number" ||
    typeof arg === "boolean" ||
    arg === null ||
    arg === undefined
  ) {
    return String(arg);
  }
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`;
  }
  try {
    return JSON.stringify(arg);
  } catch (error) {
    return String(arg);
  }
}

function emitLogEntry(
  level: SidebarLogLevel,
  args: readonly unknown[],
  source?: string,
): SidebarLogEntry {
  const message = args.map((arg) => formatLogArg(arg)).join(" ");
  const entry: SidebarLogEntry = {
    id: `log-${++logEntryCounter}`,
    level,
    message,
    timestampMs: Date.now(),
    source,
  };
  for (const listener of listeners) {
    listener(entry);
  }
  return entry;
}

function callConsole(method: keyof Console, args: readonly unknown[]): void {
  const fn = console[method];
  if (typeof fn === "function") {
    fn.apply(console, args as []);
    return;
  }
  console.log(...(args as []));
}

function logWithConsole(
  method: keyof Console,
  level: SidebarLogLevel,
  source: string | undefined,
  args: readonly unknown[],
): void {
  callConsole(method, args);
  emitLogEntry(level, args, source);
}

export function createSidebarLogger(source?: string): SidebarLogger {
  return {
    log: (...args: unknown[]) => logWithConsole("log", "info", source, args),
    info: (...args: unknown[]) => logWithConsole("info", "info", source, args),
    warn: (...args: unknown[]) => logWithConsole("warn", "warn", source, args),
    error: (...args: unknown[]) =>
      logWithConsole("error", "error", source, args),
    debug: (...args: unknown[]) =>
      logWithConsole("debug", "debug", source, args),
  } satisfies SidebarLogger;
}

export const sidebarLogger = createSidebarLogger("Sidebar");

export function logSidebarMessage(
  level: SidebarLogLevel,
  message: string,
  options?: { source?: string },
): void {
  switch (level) {
    case "warn":
      logWithConsole("warn", level, options?.source, [message]);
      break;
    case "error":
      logWithConsole("error", level, options?.source, [message]);
      break;
    case "debug":
      logWithConsole("debug", level, options?.source, [message]);
      break;
    default:
      logWithConsole("info", level, options?.source, [message]);
      break;
  }
}

export function subscribeToSidebarLogs(
  listener: SidebarLogListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
