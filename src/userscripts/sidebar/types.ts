export type ViewType = "players" | "clanmates" | "teams" | "ships";

export type ShipType = "Transport" | "Trade Ship" | "Warship";

export interface TileSummary {
  ref?: number;
  x: number;
  y: number;
  ownerId?: string;
  ownerName?: string;
}

export interface ShipRecord {
  id: string;
  type: ShipType;
  ownerId: string;
  ownerName: string;
  troops: number;
  origin?: TileSummary;
  current?: TileSummary;
  destination?: TileSummary;
  retreating: boolean;
  reachedTarget: boolean;
}

export interface IncomingAttack {
  id: string;
  from: string;
  troops: number;
  launchedAtMs?: number;
}

export interface OutgoingAttack {
  id: string;
  target: string;
  troops: number;
  launchedAtMs?: number;
}

export interface DefensiveSupport {
  id: string;
  ally: string;
  troops: number;
  deployedAtMs?: number;
}

export interface AlliancePact {
  id: string;
  partner: string;
  startedAtMs: number;
}

export interface PlayerRecord {
  id: string;
  name: string;
  clan?: string;
  team?: string;
  position?: TileSummary;
  traitorTargets: string[];
  /**
   * Indicates whether trading between the current player and this player is currently stopped.
   * If omitted (e.g. when custom data is pushed in), the UI treats it as `false`.
   */
  tradeStopped?: boolean;
  /**
   * Marks the snapshot entry that represents the local player. Consumers can use this to suppress
   * self-targeted interactions such as the trading context menu. Optional for backwards compatibility.
   */
  isSelf?: boolean;
  tiles: number;
  gold: number;
  troops: number;
  incomingAttacks: IncomingAttack[];
  outgoingAttacks: OutgoingAttack[];
  defensiveSupports: DefensiveSupport[];
  expansions: number;
  waiting: boolean;
  eliminated: boolean;
  disconnected: boolean;
  traitor: boolean;
  alliances: AlliancePact[];
  lastUpdatedMs: number;
}

export interface GameSnapshot {
  players: PlayerRecord[];
  allianceDurationMs: number;
  currentTimeMs: number;
  ships: ShipRecord[];
}

export type PanelOrientation = "horizontal" | "vertical";

export type SortKey =
  | "label"
  | "tiles"
  | "gold"
  | "troops"
  | "owner"
  | "type"
  | "origin"
  | "current"
  | "destination"
  | "status"
  | "incoming"
  | "outgoing"
  | "expanding"
  | "alliances"
  | "disconnected"
  | "traitor"
  | "stable"
  | "waiting"
  | "eliminated";

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export interface PanelLeafNode {
  id: string;
  type: "leaf";
  view: ViewType;
  expandedRows: Set<string>;
  expandedGroups: Set<string>;
  sortStates: Partial<Record<ViewType, SortState>>;
  scrollTop: number;
  scrollLeft: number;
  hoveredRowKey?: string;
  hoveredRowElement?: HTMLElement | null;
  contentContainer?: HTMLElement;
  boundContainer?: HTMLElement;
  scrollHandler?: EventListener;
  pointerLeaveHandler?: EventListener;
  viewCleanup?: () => void;
  element?: PanelLeafElements;
}

export interface PanelGroupNode {
  id: string;
  type: "group";
  orientation: PanelOrientation;
  children: PanelNode[];
  sizes: number[];
  element?: PanelGroupElements;
}

export type PanelNode = PanelLeafNode | PanelGroupNode;

export interface PanelLeafElements {
  wrapper: HTMLElement;
  header: HTMLElement;
  body: HTMLElement;
}

export interface PanelGroupElements {
  wrapper: HTMLElement;
}

export interface SidebarWindowHandle {
  updateData: (snapshot: GameSnapshot) => void;
}
