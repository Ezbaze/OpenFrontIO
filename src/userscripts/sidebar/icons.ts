type IconKind =
  | "split-horizontal"
  | "split-vertical"
  | "close"
  | "plus"
  | "trash";

type IconSegment = {
  tag: "rect" | "line" | "path";
  attrs: Record<string, string>;
};

const ICON_DEFINITIONS: Record<IconKind, IconSegment[]> = {
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
  plus: [
    { tag: "line", attrs: { x1: "12", y1: "5", x2: "12", y2: "19" } },
    { tag: "line", attrs: { x1: "5", y1: "12", x2: "19", y2: "12" } },
  ],
  trash: [
    { tag: "path", attrs: { d: "M3 6h18" } },
    { tag: "path", attrs: { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" } },
    {
      tag: "path",
      attrs: { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" },
    },
    { tag: "line", attrs: { x1: "10", y1: "11", x2: "10", y2: "17" } },
    { tag: "line", attrs: { x1: "14", y1: "11", x2: "14", y2: "17" } },
  ],
};

const SVG_NS = "http://www.w3.org/2000/svg";

export function renderIcon(kind: IconKind, className: string): SVGSVGElement {
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
