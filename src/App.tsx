import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type {
  Board3D,
  CutDirection,
  GrainOrientation,
  GlueOrientation,
  FlipAxis,
  RenderPatternNode,
} from "./shopEngine";
import { KERF, getRenderablePattern } from "./shopEngine";
import type { Project } from "./projectEngine";
import {
  createProject,
  performGlueUp,
  performRipStrips,
  performCut,
  performFlip,
  performFlipMany,
  performRotateFacePatternMany,
  performCrosscutBlocks,
  performProfileCutCorners45,
  reclaimScrapToPieces,
} from "./projectEngine";
import {
  createSnapshot,
  getCrosscutSuggestions,
  getRipSuggestions,
  previewCrosscutBlocks,
  previewGlueUp,
  previewRipStrips,
  restoreSnapshot,
  type ProjectSnapshot,
} from "./workflowEngine";

const PX_PER_INCH = 18;
const CUT_STEP = 0.125;
const END_GRAIN_WORK_SCALE = 1.65;
const END_GRAIN_MIN_PREVIEW = 52;

const SPECIES_OPTIONS = [
  "Cherry",
  "Walnut",
  "Maple",
  "Poplar",
  "Padauk",
  "Purpleheart",
  "Yellowheart",
  "Red Cedar",
  "Blue Pine",
] as const;

const SPECIES_BASE_COLORS: Record<(typeof SPECIES_OPTIONS)[number], string> = {
  Cherry: "#a55a3a",
  Walnut: "#6b4f3a",
  Maple: "#d8c7a2",
  Poplar: "#b9c58f",
  Padauk: "#c24a2d",
  Purpleheart: "#6d46a6",
  Yellowheart: "#e3cc55",
  "Red Cedar": "#9a5a41",
  "Blue Pine": "#7b9fb0",
};

type ToolTab = "BENCH" | "SAW" | "CROSSCUT" | "GLUE" | "STOCK";
type SawMode = "RIP" | "CUT";

function speciesBaseColor(species: string): string {
  const s = species.trim().toLowerCase();
  if (s.includes("walnut")) return SPECIES_BASE_COLORS.Walnut;
  if (s.includes("maple")) return SPECIES_BASE_COLORS.Maple;
  if (s.includes("cherry")) return SPECIES_BASE_COLORS.Cherry;
  if (s.includes("poplar")) return SPECIES_BASE_COLORS.Poplar;
  if (s.includes("padauk") || s.includes("padouk")) return SPECIES_BASE_COLORS.Padauk;
  if (s.includes("purpleheart")) return SPECIES_BASE_COLORS.Purpleheart;
  if (s.includes("yellowheart")) return SPECIES_BASE_COLORS.Yellowheart;
  if (s.includes("cedar")) return SPECIES_BASE_COLORS["Red Cedar"];
  if (s.includes("blue pine") || (s.includes("pine") && s.includes("blue"))) return SPECIES_BASE_COLORS["Blue Pine"];
  return "#b08a64";
}

function splitSpecies(species: string): string[] {
  return species
    .split(/[+,/&|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeSpeciesName(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "Wood";

  const exact = SPECIES_OPTIONS.find((option) => option.toLowerCase() === cleaned.toLowerCase());
  if (exact) return exact;

  const loose = SPECIES_OPTIONS.find(
    (option) =>
      cleaned.toLowerCase().includes(option.toLowerCase()) ||
      option.toLowerCase().includes(cleaned.toLowerCase())
  );
  if (loose) return loose;

  return cleaned
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function primarySpeciesName(species: string): string {
  return normalizeSpeciesName(splitSpecies(species)[0] ?? species);
}

function formatSpeciesLabel(species: string): string {
  const parts = splitSpecies(species).map(normalizeSpeciesName);
  return parts.length > 0 ? parts.join(" + ") : normalizeSpeciesName(species);
}

function isPanelLike(board: Board3D): boolean {
  return board.id.startsWith("panel:") || splitSpecies(board.species).length > 1;
}

function buildDisplayNameMap(boards: Board3D[]): Map<string, string> {
  const counts = new Map<string, number>();
  const names = new Map<string, string>();

  for (const board of boards) {
    let base = primarySpeciesName(board.species);

    if (board.isOffcut) {
      base = `${base} Scrap`;
    } else if (isPanelLike(board)) {
      base = "Panel";
    }

    const next = (counts.get(base) ?? 0) + 1;
    counts.set(base, next);
    names.set(board.id, `${base} ${next}`);
  }

  return names;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

function formatInches(value: number): string {
  const rounded = Math.round(value * 16) / 16;
  const whole = Math.floor(rounded);
  const frac = rounded - whole;

  const denom = 16;
  const num = Math.round(frac * denom);

  if (num === 0) return `${whole}"`;
  if (num === denom) return `${whole + 1}"`;

  const g = gcd(num, denom);
  const reducedNum = num / g;
  const reducedDen = denom / g;

  if (whole === 0) return `${reducedNum}/${reducedDen}"`;
  return `${whole} ${reducedNum}/${reducedDen}"`;
}

function formatVisibleFaceLabel(board: Board3D): string {
  return `${formatInches(board.lengthY)} × ${formatInches(board.widthX)} visible • ${formatInches(board.thicknessZ)} deep`;
}

function snapDownToStep(value: number, step: number) {
  return Math.floor(value / step) * step;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function normalizeRotationDeg(deg: number) {
  const normalized = deg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function dedupe(ids: string[]) {
  return Array.from(new Set(ids));
}

function makeId(prefix: string) {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${rnd}`;
}

function buildSuggestionCandidates(current: number, max: number): number[] {
  const candidates = new Set<number>([current]);
  const quarter = 0.25;

  for (let value = quarter; value <= max + 1e-6; value += quarter) {
    candidates.add(Math.round(value * 1000) / 1000);
  }

  return Array.from(candidates)
    .filter((value) => value > 0 && value < max)
    .sort((a, b) => a - b);
}

function nearlyEqualish(a: number, b: number, tol = 1e-4) {
  return Math.abs(a - b) <= tol;
}

interface PieceLayout {
  id: string;
  x: number;
  y: number;
  rotationDeg: number;
  layer: number;
}

interface ProjectLayout {
  layouts: PieceLayout[];
}

type HistoryEntry = {
  project: Project;
  layout: ProjectLayout;
  selectedPieceIds: string[];
  activeId: string;
  inventoryIds: string[];
};

type VariantSnapshot = {
  id: string;
  name: string;
  createdAt: number;
  projectSnapshot: ProjectSnapshot;
  layout: ProjectLayout;
  selectedPieceIds: string[];
  activeId: string;
  inventoryIds: string[];
};

function layoutMap(layout: ProjectLayout) {
  const m = new Map<string, PieceLayout>();
  for (const l of layout.layouts) m.set(l.id, l);
  return m;
}

function upsertLayout(layout: ProjectLayout, entry: PieceLayout): ProjectLayout {
  const next = layout.layouts.filter((l) => l.id !== entry.id);
  next.push(entry);
  return { layouts: next };
}

function removeLayouts(layout: ProjectLayout, ids: string[]): ProjectLayout {
  const set = new Set(ids);
  return { layouts: layout.layouts.filter((l) => !set.has(l.id)) };
}

function syncLayoutWithBoards(prev: ProjectLayout, boards: Board3D[]): ProjectLayout {
  const ids = new Set(boards.map((b) => b.id));
  const kept = prev.layouts.filter((l) => ids.has(l.id));
  const existing = new Set(kept.map((l) => l.id));

  const next: ProjectLayout = { layouts: [...kept] };
  const startIndex = next.layouts.length;

  boards.forEach((b, i) => {
    if (existing.has(b.id)) return;
    next.layouts.push({
      id: b.id,
      x: 40 + ((startIndex + i) % 12) * 90,
      y: 260 + Math.floor((startIndex + i) / 12) * 70,
      rotationDeg: 0,
      layer: 1,
    });
  });

  return next;
}

function axisLength(board: Board3D, dir: CutDirection) {
  return dir === "ALONG_LENGTH" ? board.lengthY : board.widthX;
}

function getVisibleDims(board: Board3D): {
  primary: number;
  secondary: number;
  visibleLabel: string;
} {
  return {
    primary: board.lengthY,
    secondary: board.widthX,
    visibleLabel: formatVisibleFaceLabel(board),
  };
}

function grainStyle(grain: GrainOrientation, species: string): CSSProperties {
  const base = speciesBaseColor(species);

  if (grain === "END") {
    return {
      backgroundColor: base,
      backgroundImage:
        "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.16) 0 2px, transparent 2px 7px), " +
        "radial-gradient(circle at 70% 60%, rgba(0,0,0,0.18) 0 2px, transparent 2px 8px)",
      backgroundSize: "18px 18px",
    };
  }

  if (grain === "EDGE") {
    return {
      backgroundColor: base,
      backgroundImage:
        "repeating-linear-gradient(90deg, rgba(0,0,0,0.20) 0 2px, rgba(255,255,255,0.07) 2px 7px)",
      backgroundSize: "12px 12px",
    };
  }

  return {
    backgroundColor: base,
    backgroundImage:
      "repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0 1px, rgba(255,255,255,0.07) 1px 6px)",
    backgroundSize: "14px 14px",
  };
}

function PatternFill({
  node,
  grainOrientation,
}: {
  node: RenderPatternNode;
  grainOrientation: GrainOrientation;
}) {
  if (node.kind === "leaf") {
    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          ...grainStyle(grainOrientation, node.species),
        }}
      />
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: node.direction,
      }}
    >
      {node.children.map((child, idx) => {
        const hasVisualRotation = typeof child.visualRotationDeg === "number";

        return (
          <div
            key={idx}
            style={{
              flexGrow: child.size,
              flexBasis: 0,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {hasVisualRotation ? (
              <div
                style={{
                  position: "absolute",
                  inset: "-21%",
                  display: "flex",
                  transform: `rotate(${child.visualRotationDeg}deg)`,
                  transformOrigin: "center center",
                }}
              >
                <PatternFill node={child.node} grainOrientation={grainOrientation} />
              </div>
            ) : (
              <PatternFill node={child.node} grainOrientation={grainOrientation} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PieceCard({
  board,
  selected,
  layout,
  displayName,
  onPointerDown,
}: {
  board: Board3D;
  selected: boolean;
  layout: PieceLayout;
  displayName: string;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const visible = getVisibleDims(board);
  const workScale = board.grainOrientation === "END" ? END_GRAIN_WORK_SCALE : 1;

  const wPx =
    board.grainOrientation === "END"
      ? Math.max(END_GRAIN_MIN_PREVIEW, visible.primary * PX_PER_INCH * workScale)
      : Math.max(30, visible.primary * PX_PER_INCH);

  const hPx =
    board.grainOrientation === "END"
      ? Math.max(END_GRAIN_MIN_PREVIEW, visible.secondary * PX_PER_INCH * workScale)
      : Math.max(18, visible.secondary * PX_PER_INCH);

  const renderPattern = getRenderablePattern(board);

  const minSide = Math.min(wPx, hPx);
  const hideInlineLabel = minSide < 22 || wPx < 70 || hPx < 18;
  const useCompactBadge = !hideInlineLabel && (wPx < 170 || hPx < 44 || board.grainOrientation === "END");

  const isCenterSquare45 = board.profileShape === "CENTER_SQUARE_45";
  const isTriangle45 = board.profileShape === "TRIANGLE_45";

  const triangleClipPath =
    board.triangleCorner45 === "TOP_LEFT"
      ? "polygon(0 0, 100% 0, 0 100%)"
      : board.triangleCorner45 === "TOP_RIGHT"
        ? "polygon(0 0, 100% 0, 100% 100%)"
        : board.triangleCorner45 === "BOTTOM_RIGHT"
          ? "polygon(100% 0, 100% 100%, 0 100%)"
          : board.triangleCorner45 === "BOTTOM_LEFT"
            ? "polygon(0 0, 100% 100%, 0 100%)"
            : "polygon(0 0, 100% 0, 0 100%)";

  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        left: layout.x,
        top: layout.y,
        width: wPx,
        height: hPx,
        touchAction: "none",
        overflow: "visible",
        background: "transparent",
      }}
      title={`${displayName} (${board.id})
${visible.visibleLabel}
${board.grainOrientation}
${formatSpeciesLabel(board.species)}`}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `rotate(${layout.rotationDeg}deg)`,
          transformOrigin: "center center",
          borderRadius: isTriangle45 ? 0 : 14,
          border: selected
            ? "2px solid rgba(255,255,255,0.85)"
            : board.isOffcut
              ? "1px solid rgba(255,120,120,0.55)"
              : "1px solid rgba(255,255,255,0.10)",
          boxShadow: selected ? "0 10px 30px rgba(0,0,0,0.55)" : "0 6px 18px rgba(0,0,0,0.35)",
          opacity: board.isOffcut ? 0.7 : 1,
          overflow: "hidden",
          background: "rgba(0,0,0,0.12)",
          clipPath: isTriangle45 ? triangleClipPath : undefined,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: isCenterSquare45 ? "-21%" : 0,
            display: "flex",
            transform: isCenterSquare45 ? "rotate(45deg)" : "none",
            transformOrigin: "center center",
          }}
        >
          <PatternFill node={renderPattern} grainOrientation={board.grainOrientation} />
        </div>

        {!hideInlineLabel && !isTriangle45 && (
          <div
            style={{
              position: "absolute",
              left: 8,
              bottom: 8,
              padding: useCompactBadge ? "3px 7px" : "4px 8px",
              borderRadius: 999,
              background: "rgba(0,0,0,0.58)",
              color: "white",
              fontSize: useCompactBadge ? 10 : 11,
              fontWeight: 900,
              lineHeight: 1.1,
              backdropFilter: "blur(6px)",
              zIndex: 1,
              maxWidth: "calc(100% - 16px)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              pointerEvents: "none",
            }}
          >
            {displayName}
          </div>
        )}
      </div>
    </div>
  );
}

type DragState = {
  id: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  moved: boolean;
  before: HistoryEntry;
};

export default function App() {
  const initial: Board3D = {
    id: "B1",
    lengthY: 18,
    widthX: 6,
    thicknessZ: 0.75,
    grainOrientation: "FACE",
    species: "Walnut",
    isOffcut: false,
  };

  const [project, setProject] = useState<Project>(() => createProject("My Project", [initial]));
  const [layout, setLayout] = useState<ProjectLayout>(() =>
    syncLayoutWithBoards({ layouts: [] }, [...project.pieces, ...project.scrap])
  );

  const [selectedPieceIds, setSelectedPieceIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string>(() => project.pieces[0]?.id ?? initial.id);

  const [inventoryIds, setInventoryIds] = useState<string[]>([]);
  const [showInventoryOnBench, setShowInventoryOnBench] = useState(false);
  const [showScrapOnBench, setShowScrapOnBench] = useState(false);

  const [toolTab, setToolTab] = useState<ToolTab>("SAW");
  const [sawMode, setSawMode] = useState<SawMode>("RIP");

  const [stripWidth, setStripWidth] = useState<number>(1.5);
  const [cutDir, setCutDir] = useState<CutDirection>("ALONG_WIDTH");
  const [cutAt, setCutAt] = useState<number>(1.5);
  const [cutScrapSide, setCutScrapSide] = useState<"LEFT" | "RIGHT" | "NONE">("RIGHT");
  const [blockLength, setBlockLength] = useState<number>(1.5);

  const [glueOrientation, setGlueOrientation] = useState<GlueOrientation>("FACE_GLUED");
  const [allowProud, setAllowProud] = useState<boolean>(true);
  const [resultName, setResultName] = useState<string>("");

  const [speciesPick, setSpeciesPick] = useState<string>("Walnut");
  const [newLen, setNewLen] = useState(18);
  const [newWid, setNewWid] = useState(6);
  const [newThk, setNewThk] = useState(0.75);
  const [newGrain, setNewGrain] = useState<GrainOrientation>("FACE");

  const [dupCount, setDupCount] = useState<number>(1);
  const [dupToInventory, setDupToInventory] = useState<boolean>(true);

  const [variantName, setVariantName] = useState("");
  const [variants, setVariants] = useState<VariantSnapshot[]>([]);

  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  const dragRef = useRef<DragState | null>(null);
  const benchRef = useRef<HTMLDivElement | null>(null);

  const inventorySet = useMemo(() => new Set(inventoryIds), [inventoryIds]);
  const allBoards = useMemo(() => [...project.pieces, ...project.scrap], [project]);
  const lmap = useMemo(() => layoutMap(layout), [layout]);
  const activeBoard = useMemo(() => project.pieces.find((p) => p.id === activeId), [project, activeId]);
  const displayNames = useMemo(() => buildDisplayNameMap(allBoards), [allBoards]);
  const displayNameFor = (board: Board3D) =>
    displayNames.get(board.id) ?? primarySpeciesName(board.species);

  const selectedUsableIds = useMemo(
    () => selectedPieceIds.filter((id) => project.pieces.some((p) => p.id === id)),
    [selectedPieceIds, project.pieces]
  );

  const selectedScrapIds = useMemo(
    () => selectedPieceIds.filter((id) => project.scrap.some((s) => s.id === id)),
    [selectedPieceIds, project.scrap]
  );

  function cloneDeep<T>(value: T): T {
    return structuredClone(value);
  }

  function snapshotCurrent(): HistoryEntry {
    return {
      project: cloneDeep(project),
      layout: cloneDeep(layout),
      selectedPieceIds: [...selectedPieceIds],
      activeId,
      inventoryIds: [...inventoryIds],
    };
  }

  function pushUndoSnapshot(entry: HistoryEntry = snapshotCurrent()) {
    setUndoStack((prev) => [...prev, cloneDeep(entry)]);
    setRedoStack([]);
  }

  function restoreHistory(entry: HistoryEntry) {
    setProject(cloneDeep(entry.project));
    setLayout(cloneDeep(entry.layout));
    setSelectedPieceIds([...entry.selectedPieceIds]);
    setActiveId(entry.activeId);
    setInventoryIds([...entry.inventoryIds]);
  }

  function handleUndo() {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [...prev, snapshotCurrent()]);
    setUndoStack((prev) => prev.slice(0, -1));
    restoreHistory(previous);
  }

  function handleRedo() {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [...prev, snapshotCurrent()]);
    setRedoStack((prev) => prev.slice(0, -1));
    restoreHistory(next);
  }

  const panelStyle: CSSProperties = {
    padding: 12,
    borderRadius: 16,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
  };

  const primaryButtonStyle: CSSProperties = {
    width: "100%",
    padding: "11px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.28)",
    color: "#eee",
    cursor: "pointer",
    fontWeight: 700,
  };

  const compactButtonStyle: CSSProperties = {
    padding: "7px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.22)",
    color: "#eee",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
  };

  const compactInputStyle: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.22)",
    color: "#eee",
  };

  const sectionTitleStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 900,
    opacity: 0.8,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    marginBottom: 8,
  };

  const boardsOnBench = useMemo(() => {
    return allBoards.filter((b) => {
      if (!showInventoryOnBench && inventorySet.has(b.id)) return false;
      if (!showScrapOnBench && b.isOffcut) return false;
      return true;
    });
  }, [allBoards, inventorySet, showInventoryOnBench, showScrapOnBench]);

  const orderedSelectedPieceIds = useMemo(() => {
    return selectedPieceIds
      .filter((id) => project.pieces.some((p) => p.id === id))
      .sort((a, b) => {
        const la = lmap.get(a);
        const lb = lmap.get(b);
        const ay = la?.y ?? 0;
        const by = lb?.y ?? 0;
        const ax = la?.x ?? 0;
        const bx = lb?.x ?? 0;
        if (Math.abs(ay - by) > 20) return ay - by;
        return ax - bx;
      });
  }, [selectedPieceIds, project.pieces, lmap]);

  const safeCutAt = useMemo(() => {
    if (!activeBoard) return cutAt;
    const axisIn = axisLength(activeBoard, cutDir);
    const maxRaw = axisIn - KERF;
    const maxSnapped = snapDownToStep(maxRaw - 1e-9, CUT_STEP);
    return clamp(snapDownToStep(cutAt, CUT_STEP), CUT_STEP, maxSnapped);
  }, [activeBoard, cutDir, cutAt]);

  const safeStripWidth = useMemo(() => {
    if (!activeBoard) return stripWidth;
    const axisIn = activeBoard.widthX;
    const maxRaw = axisIn - KERF;
    const maxSnapped = snapDownToStep(maxRaw - 1e-9, CUT_STEP);
    return clamp(snapDownToStep(stripWidth, CUT_STEP), CUT_STEP, maxSnapped);
  }, [activeBoard, stripWidth]);

  const safeBlockLength = useMemo(() => {
    if (!activeBoard) return blockLength;
    const axisIn = activeBoard.lengthY;
    const maxRaw = axisIn - KERF;
    const maxSnapped = snapDownToStep(maxRaw - 1e-9, CUT_STEP);
    return clamp(snapDownToStep(blockLength, CUT_STEP), CUT_STEP, maxSnapped);
  }, [activeBoard, blockLength]);

  const gluePreview = useMemo(() => {
    if (orderedSelectedPieceIds.length < 2) return null;
    return previewGlueUp(project, {
      pieceIds: orderedSelectedPieceIds,
      orientation: glueOrientation,
      allowProud,
      resultName: resultName.trim() || undefined,
    });
  }, [project, orderedSelectedPieceIds, glueOrientation, allowProud, resultName]);

  const ripPreview = useMemo(() => {
    if (!activeBoard) return null;
    return previewRipStrips(project, activeBoard.id, safeStripWidth, KERF);
  }, [project, activeBoard, safeStripWidth]);

  const crosscutPreview = useMemo(() => {
    if (!activeBoard) return null;
    return previewCrosscutBlocks(project, activeBoard.id, safeBlockLength, KERF);
  }, [project, activeBoard, safeBlockLength]);

  const ripSuggestions = useMemo(() => {
    if (!activeBoard) return [];
    const max = Math.max(CUT_STEP, activeBoard.widthX - KERF - 0.01);
    return getRipSuggestions(project, activeBoard.id, buildSuggestionCandidates(safeStripWidth, max), KERF).slice(0, 4);
  }, [project, activeBoard, safeStripWidth]);

  const crosscutSuggestions = useMemo(() => {
    if (!activeBoard) return [];
    const max = Math.max(CUT_STEP, activeBoard.lengthY - KERF - 0.01);
    return getCrosscutSuggestions(project, activeBoard.id, buildSuggestionCandidates(safeBlockLength, max), KERF).slice(0, 4);
  }, [project, activeBoard, safeBlockLength]);

  function applyProject(next: Project) {
    setProject(next);

    const mergedBoards = [...next.pieces, ...next.scrap];
    setLayout((prev) => syncLayoutWithBoards(prev, mergedBoards));

    const idSet = new Set(mergedBoards.map((b) => b.id));
    setSelectedPieceIds((prev) => prev.filter((id) => idSet.has(id)));
    setInventoryIds((prev) => prev.filter((id) => idSet.has(id)));

    if (!next.pieces.find((p) => p.id === activeId)) {
      const fallback = next.pieces[0]?.id;
      if (fallback) setActiveId(fallback);
    }
  }

  function toggleSelect(id: string) {
    setSelectedPieceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectOnly(id: string) {
    setSelectedPieceIds([id]);
  }

  function rotateIds(ids: string[], deltaDeg: number) {
    if (ids.length === 0) return;
    pushUndoSnapshot();

    setLayout((prev) => {
      const map = layoutMap(prev);
      let next = prev;
      for (const id of ids) {
        const cur = map.get(id);
        if (!cur) continue;
        next = upsertLayout(next, {
          ...cur,
          rotationDeg: normalizeRotationDeg(cur.rotationDeg + deltaDeg),
        });
      }
      return next;
    });
  }

  function rotateMaterialQuarterTurn(ids: string[], deltaDeg: -90 | 90) {
    const usableIds = ids.filter((id) => project.pieces.some((p) => p.id === id));
    if (usableIds.length === 0) return;

    const res = performRotateFacePatternMany(project, usableIds, deltaDeg);
    if (!res.ok) return alert(`${res.code}: ${res.message}`);

    pushUndoSnapshot();
    applyProject(res.value);

    const usableSet = new Set(usableIds);
    setLayout((prev) => {
      const map = layoutMap(prev);
      let next = prev;

      for (const id of usableSet) {
        const cur = map.get(id);
        if (!cur) continue;

        next = upsertLayout(next, {
          ...cur,
          rotationDeg: 0,
        });
      }

      return next;
    });
  }
  
  function alternateEveryOtherSelected() {
    if (orderedSelectedPieceIds.length < 2) return;
  
    const everyOtherIds = orderedSelectedPieceIds.filter((_, index) => index % 2 === 1);
  
    if (everyOtherIds.length === 0) return;
  
    rotateMaterialQuarterTurn(everyOtherIds, 90);
  }

  function resetRotation(ids: string[]) {
    if (ids.length === 0) return;
    pushUndoSnapshot();

    setLayout((prev) => {
      const map = layoutMap(prev);
      let next = prev;
      for (const id of ids) {
        const cur = map.get(id);
        if (!cur) continue;
        next = upsertLayout(next, { ...cur, rotationDeg: 0 });
      }
      return next;
    });
  }

  function diffNewPieceIds(prev: Project, next: Project) {
    const prevSet = new Set([...prev.pieces, ...prev.scrap].map((b) => b.id));
    return next.pieces.map((p) => p.id).filter((id) => !prevSet.has(id));
  }

  function placeIdsWrapped(
    ids: string[],
    boardsById: Map<string, Board3D>,
    startX: number,
    startY: number,
    keepRotationFrom?: Map<string, PieceLayout>
  ) {
    const benchWidth = benchRef.current?.clientWidth ?? 900;
    const leftPad = 60;
    const rightPad = 40;
    const gap = 12;
    const maxX = Math.max(leftPad + 80, benchWidth - rightPad);

    let x = startX;
    let y = startY;
    let rowH = 0;

    setLayout((prev) => {
      let next = prev;
      const maxLayer = prev.layouts.reduce((m, l) => Math.max(m, l.layer), 1);
      let layer = maxLayer + 1;

      for (const id of ids) {
        const b = boardsById.get(id);
        if (!b) continue;

        const visible = getVisibleDims(b);
        const workScale = b.grainOrientation === "END" ? END_GRAIN_WORK_SCALE : 1;
        const wPx =
          b.grainOrientation === "END"
            ? Math.max(END_GRAIN_MIN_PREVIEW, visible.primary * PX_PER_INCH * workScale)
            : Math.max(30, visible.primary * PX_PER_INCH);
        const hPx =
          b.grainOrientation === "END"
            ? Math.max(END_GRAIN_MIN_PREVIEW, visible.secondary * PX_PER_INCH * workScale)
            : Math.max(18, visible.secondary * PX_PER_INCH);

        if (x + wPx > maxX) {
          x = leftPad;
          y += rowH + gap;
          rowH = 0;
        }

        next = upsertLayout(next, {
          id,
          x,
          y,
          rotationDeg: keepRotationFrom?.get(id)?.rotationDeg ?? 0,
          layer,
        });

        x += wPx + gap;
        rowH = Math.max(rowH, hPx);
        layer++;
      }

      return next;
    });
  }

  function autoLineUpSelectedRowWrapped() {
    const ids = selectedPieceIds.slice();
    if (ids.length === 0) return;
    pushUndoSnapshot();
    const boardsById = new Map(allBoards.map((b) => [b.id, b] as const));
    ids.sort((a, b) => (lmap.get(a)?.x ?? 0) - (lmap.get(b)?.x ?? 0));
    placeIdsWrapped(ids, boardsById, 60, 120, lmap);
  }

  function packBench() {
    const ids = boardsOnBench.map((b) => b.id);
    if (ids.length === 0) return;
    pushUndoSnapshot();
    const boardsById = new Map(allBoards.map((b) => [b.id, b] as const));
    placeIdsWrapped(ids, boardsById, 60, 120, lmap);
  }

  function applySpeciesToIds(ids: string[], species: string) {
    if (ids.length === 0) return;
    pushUndoSnapshot();
    const set = new Set(ids);
    const patch = (b: Board3D): Board3D => (set.has(b.id) ? { ...b, species } : b);

    applyProject({
      ...project,
      pieces: project.pieces.map(patch),
      scrap: project.scrap.map(patch),
    });
  }

  function addNewBoard() {
    const len = Number(newLen);
    const wid = Number(newWid);
    const thk = Number(newThk);

    if (!(len > 0 && wid > 0 && thk > 0)) {
      alert("All dimensions must be > 0");
      return;
    }

    pushUndoSnapshot();

    const id = makeId("B");
    const b: Board3D = {
      id,
      lengthY: len,
      widthX: wid,
      thicknessZ: thk,
      grainOrientation: newGrain,
      species: speciesPick,
      isOffcut: false,
    };

    const next: Project = { ...project, pieces: [...project.pieces, b] };
    applyProject(next);

    setLayout((prev) =>
      upsertLayout(prev, {
        id,
        x: 70,
        y: 90,
        rotationDeg: 0,
        layer: prev.layouts.reduce((m, l) => Math.max(m, l.layer), 1) + 1,
      })
    );
    setActiveId(id);
    setSelectedPieceIds([id]);
  }

  function sendSelectedToInventory() {
    const ids = selectedPieceIds.filter((id) => project.pieces.some((p) => p.id === id));
    if (ids.length === 0) return;
    pushUndoSnapshot();
    setInventoryIds((prev) => dedupe([...prev, ...ids]));
  }

  function bringSelectedFromInventoryToBench() {
    if (selectedPieceIds.length === 0) return;
    pushUndoSnapshot();
    setInventoryIds((prev) => prev.filter((id) => !selectedPieceIds.includes(id)));
  }

  function sendSelectedPiecesToScrap() {
    const ids = selectedPieceIds.filter((id) => project.pieces.some((p) => p.id === id));
    if (ids.length === 0) return;

    pushUndoSnapshot();

    const moveSet = new Set(ids);
    const moving = project.pieces.filter((p) => moveSet.has(p.id)).map((p) => ({ ...p, isOffcut: true }));
    const remaining = project.pieces.filter((p) => !moveSet.has(p.id));

    applyProject({
      ...project,
      pieces: remaining,
      scrap: [...project.scrap, ...moving],
    });

    setInventoryIds((prev) => prev.filter((id) => !moveSet.has(id)));
  }

  function reclaimSelectedScrap() {
    const scrapIds = selectedPieceIds.filter((id) => project.scrap.some((s) => s.id === id));
    if (scrapIds.length === 0) return;

    const res = reclaimScrapToPieces(project, scrapIds);
    if (!res.ok) return alert(`${res.code}: ${res.message}`);
    pushUndoSnapshot();
    applyProject(res.value);
  }

  function duplicatePieces(ids: string[], count: number, toInventory: boolean) {
    const srcById = new Map(project.pieces.map((p) => [p.id, p] as const));
    const sources = ids.map((id) => srcById.get(id)).filter(Boolean) as Board3D[];
    if (sources.length === 0) return;

    pushUndoSnapshot();

    const n = Math.max(1, Math.floor(count));
    const clones: Board3D[] = [];
    for (const s of sources) {
      for (let i = 0; i < n; i++) {
        clones.push({
          ...s,
          id: makeId("dup"),
          isOffcut: false,
        });
      }
    }

    const next: Project = { ...project, pieces: [...project.pieces, ...clones] };
    applyProject(next);

    const cloneIds = clones.map((c) => c.id);
    if (toInventory) setInventoryIds((prev) => dedupe([...prev, ...cloneIds]));

    const anchor = lmap.get(sources[0].id);
    const boardsById = new Map([...allBoards, ...clones].map((b) => [b.id, b] as const));
    placeIdsWrapped(cloneIds, boardsById, (anchor?.x ?? 80) + 30, (anchor?.y ?? 120) + 30);

    setSelectedPieceIds(cloneIds);
    setActiveId(cloneIds[0] ?? activeId);
  }

  function duplicateSelectionOrActive() {
    const ids = selectedPieceIds.filter((id) => project.pieces.some((p) => p.id === id));
    if (ids.length > 0) {
      duplicatePieces(ids, dupCount, dupToInventory);
      return;
    }
    if (activeBoard) duplicatePieces([activeBoard.id], dupCount, dupToInventory);
  }

  function handleRipActive() {
    if (!activeBoard) return;
    const prev = project;
    const res = performRipStrips(project, activeBoard.id, safeStripWidth, KERF);
    if (!res.ok) return alert(`${res.code}: ${res.message}`);
    const next = res.value;

    pushUndoSnapshot();
    applyProject(next);

    const newIds = diffNewPieceIds(prev, next);
    const boardsById = new Map([...next.pieces, ...next.scrap].map((b) => [b.id, b] as const));
    const anchor = lmap.get(activeBoard.id);

    setLayout((prevL) => removeLayouts(prevL, [activeBoard.id]));
    placeIdsWrapped(newIds, boardsById, anchor?.x ?? 60, anchor?.y ?? 140);
    setSelectedPieceIds(newIds);
    if (newIds[0]) setActiveId(newIds[0]);
  }

  function handleCrosscutActive() {
    if (!activeBoard) return;
    const prev = project;
    const res = performCrosscutBlocks(project, activeBoard.id, safeBlockLength, KERF);
    if (!res.ok) return alert(`${res.code}: ${res.message}`);
    const next = res.value;

    pushUndoSnapshot();
    applyProject(next);

    const newIds = diffNewPieceIds(prev, next);
    const boardsById = new Map([...next.pieces, ...next.scrap].map((b) => [b.id, b] as const));
    const anchor = lmap.get(activeBoard.id);

    setLayout((prevL) => removeLayouts(prevL, [activeBoard.id]));
    placeIdsWrapped(newIds, boardsById, anchor?.x ?? 60, anchor?.y ?? 140);
    setSelectedPieceIds(newIds);
    if (newIds[0]) setActiveId(newIds[0]);
  }

  function handleCutActive() {
    if (!activeBoard) return;
    const prev = project;
    const res = performCut(project, activeBoard.id, cutDir, safeCutAt, KERF, cutScrapSide);
    if (!res.ok) return alert(`${res.code}: ${res.message}`);
    const next = res.value;

    pushUndoSnapshot();
    applyProject(next);

    const newIds = diffNewPieceIds(prev, next);
    const boardsById = new Map([...next.pieces, ...next.scrap].map((b) => [b.id, b] as const));
    const anchor = lmap.get(activeBoard.id);

    setLayout((prevL) => removeLayouts(prevL, [activeBoard.id]));
    placeIdsWrapped(newIds, boardsById, anchor?.x ?? 60, anchor?.y ?? 140);
    setSelectedPieceIds(newIds);
    if (newIds[0]) setActiveId(newIds[0]);
  }

  function handleProfileCutCorners45Active() {
    if (!activeBoard) return;
  
    const prev = project;
    const res = performProfileCutCorners45(project, activeBoard.id, KERF);
    if (!res.ok) return alert(`${res.code}: ${res.message}`);
  
    const next = res.value;
  
    pushUndoSnapshot();
    applyProject(next);
  
    const newIds = diffNewPieceIds(prev, next);
    const newBoards = next.pieces.filter((p) => newIds.includes(p.id));
  
    const centerIds = newBoards
      .filter((b) => b.profileShape === "CENTER_SQUARE_45")
      .map((b) => b.id);
  
    const triangleIds = newBoards
      .filter((b) => b.profileShape === "TRIANGLE_45")
      .map((b) => b.id);
  
    setInventoryIds((prevIds) => dedupe([...prevIds, ...triangleIds]));
  
    const boardsById = new Map([...next.pieces, ...next.scrap].map((b) => [b.id, b] as const));
    const anchor = lmap.get(activeBoard.id);
  
    setLayout((prevL) => removeLayouts(prevL, [activeBoard.id]));
  
    placeIdsWrapped(centerIds, boardsById, anchor?.x ?? 60, anchor?.y ?? 140);
  
    setSelectedPieceIds(centerIds);
    if (centerIds[0]) setActiveId(centerIds[0]);
  }

  function handleGlueUpSelected() {
    if (orderedSelectedPieceIds.length < 2) return alert("Select at least 2 pieces to glue up.");

    const res = performGlueUp(project, {
      pieceIds: orderedSelectedPieceIds,
      orientation: glueOrientation,
      allowProud,
      resultName: resultName.trim() ? resultName.trim() : undefined,
    });

    if (!res.ok) return alert(`${res.code}: ${res.message}`);

    const next = res.value;
    pushUndoSnapshot();
    applyProject(next);

    const newIds = diffNewPieceIds(project, next);
    if (newIds.length > 0) {
      const boardsById = new Map([...next.pieces, ...next.scrap].map((b) => [b.id, b] as const));
      placeIdsWrapped(newIds, boardsById, 80, 140);
      setSelectedPieceIds(newIds);
      setActiveId(newIds[0]);
    } else {
      setSelectedPieceIds([]);
    }
  }

  function handleFlipActive(axis: FlipAxis) {
    if (!activeBoard) return;
    const res = performFlip(project, activeBoard.id, axis);
    if (!res.ok) return alert(`${res.code}: ${res.message}`);
    pushUndoSnapshot();
    applyProject(res.value);
  }

  function handleFlipSelectedToEnd() {
    const ids = selectedPieceIds.filter((id) => project.pieces.some((p) => p.id === id));
    if (ids.length === 0) return;
    const res = performFlipMany(project, ids, "FLIP_TO_END");
    if (!res.ok) return alert(`${res.code}: ${res.message}`);
    pushUndoSnapshot();
    applyProject(res.value);
  }

  function handleSaveVariant() {
    const name = variantName.trim() || `Variant ${variants.length + 1}`;
    const projectSnapshot = createSnapshot(project, name);

    const nextVariant: VariantSnapshot = {
      id: projectSnapshot.id,
      name,
      createdAt: projectSnapshot.createdAt,
      projectSnapshot,
      layout: cloneDeep(layout),
      selectedPieceIds: [...selectedPieceIds],
      activeId,
      inventoryIds: [...inventoryIds],
    };

    setVariants((prev) => [nextVariant, ...prev]);
    setVariantName("");
  }

  function handleLoadVariant(variant: VariantSnapshot) {
    pushUndoSnapshot();
    const restored = restoreSnapshot(variant.projectSnapshot);
    setProject(restored);
    setLayout(syncLayoutWithBoards(cloneDeep(variant.layout), [...restored.pieces, ...restored.scrap]));
    setSelectedPieceIds([...variant.selectedPieceIds]);
    setActiveId(variant.activeId);
    setInventoryIds([...variant.inventoryIds]);
  }

  function handleDeleteVariant(variantId: string) {
    setVariants((prev) => prev.filter((v) => v.id !== variantId));
  }

  function renderPrimaryButton(label: string, onClick: () => void, disabled = false) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          ...primaryButtonStyle,
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {label}
      </button>
    );
  }

  function renderChip(
    label: string,
    onClick: () => void,
    active = false,
    disabled = false
  ) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          ...compactButtonStyle,
          background: active ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.22)",
          border: active ? "1px solid rgba(255,255,255,0.25)" : "1px solid rgba(255,255,255,0.14)",
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {label}
      </button>
    );
  }

  function renderToolTabs() {
    const tabs: ToolTab[] = ["BENCH", "SAW", "CROSSCUT", "GLUE", "STOCK"];
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 6 }}>
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setToolTab(tab)}
            style={{
              padding: "8px 6px",
              borderRadius: 10,
              border: toolTab === tab ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.12)",
              background: toolTab === tab ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.20)",
              color: "#eee",
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: 0.4,
            }}
          >
            {tab}
          </button>
        ))}
      </div>
    );
  }

  function renderContextStrip() {
    return (
      <div style={{ ...panelStyle, padding: 10 }}>
        <div style={{ display: "grid", gap: 5, fontSize: 12, opacity: 0.9 }}>
          <div>
            <strong>Active:</strong>{" "}
            {activeBoard ? `${displayNameFor(activeBoard)} · ${formatVisibleFaceLabel(activeBoard)}` : "None"}
          </div>
          <div>
            <strong>Selected usable:</strong> {selectedUsableIds.length} · <strong>Selected scrap:</strong> {selectedScrapIds.length}
          </div>
        </div>
      </div>
    );
  }

  function renderBenchPanel() {
    return (
      <div style={{ ...panelStyle, display: "grid", gap: 12 }}>
        <div>
          <div style={sectionTitleStyle}>Rotate on bench</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 6 }}>
            {renderChip("-90", () => rotateMaterialQuarterTurn(selectedUsableIds, -90), false, selectedUsableIds.length === 0)}
            {renderChip("-45", () => rotateIds(selectedPieceIds, -45), false, selectedPieceIds.length === 0)}
            {renderChip("Reset", () => resetRotation(selectedPieceIds), false, selectedPieceIds.length === 0)}
            {renderChip("+45", () => rotateIds(selectedPieceIds, 45), false, selectedPieceIds.length === 0)}
            {renderChip("+90", () => rotateMaterialQuarterTurn(selectedUsableIds, 90), false, selectedUsableIds.length === 0)}
          </div>
        </div>

        <div>
          <div style={sectionTitleStyle}>Arrangement</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {renderPrimaryButton("Line Up", autoLineUpSelectedRowWrapped, selectedPieceIds.length === 0)}
            {renderPrimaryButton("Organize Bench", packBench, boardsOnBench.length === 0)}
          </div>
        </div>

        <div>
          <div style={sectionTitleStyle}>Selection tools</div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 8 }}>
              <input
                type="number"
                min={1}
                step={1}
                value={dupCount}
                onChange={(e) => setDupCount(Number(e.target.value))}
                style={compactInputStyle}
              />
              {renderPrimaryButton("Duplicate", duplicateSelectionOrActive, !activeBoard && selectedUsableIds.length === 0)}
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: 0.9 }}>
              <input type="checkbox" checked={dupToInventory} onChange={(e) => setDupToInventory(e.target.checked)} />
              Send duplicates to inventory
            </label>

            {renderPrimaryButton("Convert Selected to END", handleFlipSelectedToEnd, selectedUsableIds.length === 0)}
            {renderPrimaryButton(
             "Alternate Every Other",
             alternateEveryOtherSelected,
             orderedSelectedPieceIds.length < 2
            )}
          </div>
        </div>

        <div>
          <div style={sectionTitleStyle}>Routing</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {renderPrimaryButton("To Inventory", sendSelectedToInventory, selectedUsableIds.length === 0)}
            {renderPrimaryButton("Bring to Bench", bringSelectedFromInventoryToBench, selectedPieceIds.length === 0)}
            {renderPrimaryButton("To Scrap", sendSelectedPiecesToScrap, selectedUsableIds.length === 0)}
            {renderPrimaryButton("Reclaim Scrap", reclaimSelectedScrap, selectedScrapIds.length === 0)}
          </div>
        </div>
      </div>
    );
  }

  function renderSawPanel() {
    const previewText =
      sawMode === "RIP"
        ? ripPreview && ripPreview.ok
          ? `${ripPreview.value.strips.length} strips + ${formatInches(ripPreview.value.remainder.widthX)} remainder`
          : ripPreview && !ripPreview.ok
            ? ripPreview.message
            : "No active piece"
        : activeBoard
          ? `Cut at ${formatInches(safeCutAt)} on ${cutDir === "ALONG_WIDTH" ? "width" : "length"}`
          : "No active piece";

    return (
      <div style={{ ...panelStyle, display: "grid", gap: 12 }}>
        <div>
          <div style={sectionTitleStyle}>Operation</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {renderChip("Rip", () => setSawMode("RIP"), sawMode === "RIP")}
            {renderChip("Cut", () => setSawMode("CUT"), sawMode === "CUT")}
          </div>
        </div>

        {sawMode === "RIP" ? (
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 12 }}>
              Strip width
              <input
                type="number"
                step={CUT_STEP}
                value={stripWidth}
                onChange={(e) => setStripWidth(Number(e.target.value))}
                style={{ ...compactInputStyle, marginTop: 6 }}
              />
            </label>

            <div style={{ fontSize: 12, opacity: 0.82 }}>{previewText}</div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ripSuggestions.map((s) =>
                renderChip(
                  formatInches(s.stripWidth),
                  () => setStripWidth(s.stripWidth),
                  nearlyEqualish(s.stripWidth, safeStripWidth)
                )
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <div style={{ fontSize: 12, marginBottom: 6 }}>Direction</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {renderChip("Width", () => setCutDir("ALONG_WIDTH"), cutDir === "ALONG_WIDTH")}
                {renderChip("Length", () => setCutDir("ALONG_LENGTH"), cutDir === "ALONG_LENGTH")}
              </div>
            </div>

            <label style={{ fontSize: 12 }}>
              Cut distance
              <input
                type="number"
                step={CUT_STEP}
                value={cutAt}
                onChange={(e) => setCutAt(Number(e.target.value))}
                style={{ ...compactInputStyle, marginTop: 6 }}
              />
            </label>

            <div>
              <div style={{ fontSize: 12, marginBottom: 6 }}>Scrap side</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {renderChip("None", () => setCutScrapSide("NONE"), cutScrapSide === "NONE")}
                {renderChip("Left", () => setCutScrapSide("LEFT"), cutScrapSide === "LEFT")}
                {renderChip("Right", () => setCutScrapSide("RIGHT"), cutScrapSide === "RIGHT")}
              </div>
            </div>

            <div style={{ fontSize: 12, opacity: 0.82 }}>{previewText}</div>
          </div>
        )}

        <div>
          <div style={sectionTitleStyle}>Flip active face</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {renderChip("FACE", () => handleFlipActive("FLIP_TO_FACE"), false, !activeBoard)}
            {renderChip("EDGE", () => handleFlipActive("FLIP_TO_EDGE"), false, !activeBoard)}
            {renderChip("END", () => handleFlipActive("FLIP_TO_END"), false, !activeBoard)}
            <div>
          <div style={sectionTitleStyle}>Profile cut</div>
           {renderPrimaryButton("45° Corner Cut", handleProfileCutCorners45Active, !activeBoard)}
         </div>
          </div>
        </div>

        {renderPrimaryButton(
          sawMode === "RIP" ? "Rip Board" : "Cut Board",
          sawMode === "RIP" ? handleRipActive : handleCutActive,
          !activeBoard
        )}
      </div>
    );
  }
  
  function renderCrosscutPanel() {
    return (
      <div style={{ ...panelStyle, display: "grid", gap: 12 }}>
        <div>
          <div style={sectionTitleStyle}>Crosscut blocks</div>
          <label style={{ fontSize: 12 }}>
            Block length
            <input
              type="number"
              step={CUT_STEP}
              value={blockLength}
              onChange={(e) => setBlockLength(Number(e.target.value))}
              style={{ ...compactInputStyle, marginTop: 6 }}
            />
          </label>
        </div>

        <div style={{ fontSize: 12, opacity: 0.82 }}>
          {crosscutPreview && crosscutPreview.ok
            ? `${crosscutPreview.value.blocks.length} blocks + ${formatInches(crosscutPreview.value.remainder.lengthY)} remainder`
            : crosscutPreview && !crosscutPreview.ok
              ? crosscutPreview.message
              : "No active piece"}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {crosscutSuggestions.map((s) =>
            renderChip(
              formatInches(s.blockLength),
              () => setBlockLength(s.blockLength),
              nearlyEqualish(s.blockLength, safeBlockLength)
            )
          )}
        </div>

        {renderPrimaryButton("Crosscut Board", handleCrosscutActive, !activeBoard)}
      </div>
    );
  }

  function renderGluePanel() {
    return (
      <div style={{ ...panelStyle, display: "grid", gap: 12 }}>
        <div>
          <div style={sectionTitleStyle}>Glue-up</div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>
            Selected usable pieces: {orderedSelectedPieceIds.length}
          </div>
        </div>

        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {renderChip("Stacked", () => setGlueOrientation("FACE_GLUED"), glueOrientation === "FACE_GLUED")}
            {renderChip("Side-by-side", () => setGlueOrientation("EDGE_GLUED"), glueOrientation === "EDGE_GLUED")}
          </div>
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: 0.9 }}>
          <input type="checkbox" checked={allowProud} onChange={(e) => setAllowProud(e.target.checked)} />
          Allow proud glue-up
        </label>

        <label style={{ fontSize: 12 }}>
          Result name
          <input
            value={resultName}
            onChange={(e) => setResultName(e.target.value)}
            placeholder="Optional"
            style={{ ...compactInputStyle, marginTop: 6 }}
          />
        </label>

        <div style={{ fontSize: 12, opacity: 0.82 }}>
          {gluePreview == null
            ? "Select at least 2 usable pieces"
            : gluePreview.ok
              ? `${formatVisibleFaceLabel(gluePreview.value.panel)}`
              : gluePreview.message}
        </div>

        {renderPrimaryButton("Glue Selected", handleGlueUpSelected, orderedSelectedPieceIds.length < 2)}
      </div>
    );
  }

  function renderStockPanel() {
    const recentVariants = variants.slice(0, 4);

    return (
      <div style={{ ...panelStyle, display: "grid", gap: 12 }}>
        <div>
          <div style={sectionTitleStyle}>Add board</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <select value={speciesPick} onChange={(e) => setSpeciesPick(e.target.value)} style={compactInputStyle}>
              {SPECIES_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <select value={newGrain} onChange={(e) => setNewGrain(e.target.value as GrainOrientation)} style={compactInputStyle}>
              <option value="FACE">FACE</option>
              <option value="EDGE">EDGE</option>
              <option value="END">END</option>
            </select>

            <input type="number" step="0.125" value={newLen} onChange={(e) => setNewLen(Number(e.target.value))} style={compactInputStyle} placeholder="Length" />
            <input type="number" step="0.125" value={newWid} onChange={(e) => setNewWid(Number(e.target.value))} style={compactInputStyle} placeholder="Width" />
            <input type="number" step="0.125" value={newThk} onChange={(e) => setNewThk(Number(e.target.value))} style={compactInputStyle} placeholder="Thickness" />
            {renderPrimaryButton("Add", addNewBoard)}
          </div>
        </div>

        <div>
          <div style={sectionTitleStyle}>Apply species to selected</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
            <select value={speciesPick} onChange={(e) => setSpeciesPick(e.target.value)} style={compactInputStyle}>
              {SPECIES_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button
              onClick={() => applySpeciesToIds(selectedUsableIds, speciesPick)}
              style={{ ...compactButtonStyle, minWidth: 84 }}
            >
              Apply
            </button>
          </div>
        </div>

        <div>
          <div style={sectionTitleStyle}>Bench visibility</div>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: 0.9 }}>
              <input type="checkbox" checked={showInventoryOnBench} onChange={(e) => setShowInventoryOnBench(e.target.checked)} />
              Show inventory on bench
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: 0.9 }}>
              <input type="checkbox" checked={showScrapOnBench} onChange={(e) => setShowScrapOnBench(e.target.checked)} />
              Show scrap on bench
            </label>
          </div>
        </div>

        <div>
          <div style={sectionTitleStyle}>Variants</div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
              <input
                value={variantName}
                onChange={(e) => setVariantName(e.target.value)}
                placeholder="Variant name"
                style={compactInputStyle}
              />
              <button onClick={handleSaveVariant} style={{ ...compactButtonStyle, minWidth: 70 }}>
                Save
              </button>
            </div>

            {recentVariants.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.72 }}>No saved variants yet.</div>
            ) : (
              recentVariants.map((variant) => (
                <div
                  key={variant.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 6,
                    alignItems: "center",
                    padding: 8,
                    borderRadius: 10,
                    background: "rgba(0,0,0,0.18)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {variant.name}
                  </div>
                  <button onClick={() => handleLoadVariant(variant)} style={compactButtonStyle}>
                    Load
                  </button>
                  <button onClick={() => handleDeleteVariant(variant.id)} style={compactButtonStyle}>
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderToolPanel() {
    switch (toolTab) {
      case "BENCH":
        return renderBenchPanel();
      case "SAW":
        return renderSawPanel();
      case "CROSSCUT":
        return renderCrosscutPanel();
      case "GLUE":
        return renderGluePanel();
      case "STOCK":
        return renderStockPanel();
      default:
        return null;
    }
  }

  function renderBoardListCard(board: Board3D, isScrap = false) {
    const selected = selectedPieceIds.includes(board.id);
    const isActive = board.id === activeId;
    const isInv = inventorySet.has(board.id);

    return (
      <div
        key={board.id}
        style={{
          padding: 10,
          borderRadius: 14,
          border: selected
            ? isScrap
              ? "2px solid rgba(255,160,160,0.75)"
              : "2px solid rgba(255,255,255,0.75)"
            : isScrap
              ? "1px solid rgba(255,120,120,0.25)"
              : "1px solid rgba(255,255,255,0.10)",
          background: isActive ? "rgba(120,180,255,0.10)" : "rgba(0,0,0,0.20)",
          cursor: "pointer",
          opacity: isScrap ? 0.85 : isInv ? 0.7 : 1,
        }}
        onClick={() => {
          if (!isScrap) setActiveId(board.id);
          toggleSelect(board.id);
        }}
        onDoubleClick={() => {
          if (!isScrap) setActiveId(board.id);
          selectOnly(board.id);
        }}
        title={`Click: toggle select${isScrap ? "" : " and set active"}.
Internal ID: ${board.id}`}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis" }}>{displayNameFor(board)}</div>
          <div style={{ opacity: 0.75, fontSize: 12 }}>
            {isActive ? "ACTIVE" : isInv ? "INVENTORY" : isScrap ? "SCRAP" : ""}
          </div>
        </div>
        <div style={{ opacity: 0.85, fontSize: 12 }}>
          {formatVisibleFaceLabel(board)} • {board.grainOrientation} • {formatSpeciesLabel(board.species)}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100vh",
        overflow: "hidden",
        padding: 14,
        boxSizing: "border-box",
        fontFamily: "system-ui",
        color: "#eee",
        display: "flex",
        flexDirection: "column",
        background: "#111317",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.1 }}>Virtual Woodshop</div>
          <div style={{ opacity: 0.8, marginTop: 4, fontSize: 13 }}>
            Bench-centered layout with machine tabs.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            style={{
              ...compactButtonStyle,
              opacity: undoStack.length === 0 ? 0.45 : 1,
              cursor: undoStack.length === 0 ? "default" : "pointer",
            }}
          >
            Undo
          </button>

          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            style={{
              ...compactButtonStyle,
              opacity: redoStack.length === 0 ? 0.45 : 1,
              cursor: redoStack.length === 0 ? "default" : "pointer",
            }}
          >
            Redo
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 320px) minmax(0, 1fr) minmax(360px, 400px)",
          gap: 12,
          marginTop: 12,
          flex: 1,
          minHeight: 0,
          height: "100%",
        }}
      >
        <div
          style={{
            ...panelStyle,
            minHeight: 0,
            height: "100%",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Pieces (usable): {project.pieces.length}</div>
            <button
              onClick={() => setSelectedPieceIds([])}
              style={compactButtonStyle}
            >
              Clear
            </button>
          </div>

          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {project.pieces.map((b) => renderBoardListCard(b))}
          </div>

          <div style={{ marginTop: 14, fontWeight: 900 }}>Scrap: {project.scrap.length}</div>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {project.scrap.map((b) => renderBoardListCard(b, true))}
          </div>
        </div>

        <div
          ref={benchRef}
          style={{
            position: "relative",
            minHeight: 0,
            height: "100%",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            overflow: "hidden",
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d || d.pointerId !== e.pointerId) return;

            const dx = e.clientX - d.startClientX;
            const dy = e.clientY - d.startClientY;

            if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
              d.moved = true;
            }

            setLayout((prev) => {
              const cur = layoutMap(prev).get(d.id);
              if (!cur) return prev;

              const maxLayer = prev.layouts.reduce((m, l) => Math.max(m, l.layer), 1);
              return upsertLayout(prev, {
                ...cur,
                x: d.originX + dx,
                y: d.originY + dy,
                layer: maxLayer + 1,
              });
            });
          }}
          onPointerUp={(e) => {
            const d = dragRef.current;
            if (!d || d.pointerId !== e.pointerId) return;

            if (d.moved) {
              setUndoStack((prev) => [...prev, cloneDeep(d.before)]);
              setRedoStack([]);
            } else {
              if (project.pieces.some((p) => p.id === d.id)) setActiveId(d.id);
              toggleSelect(d.id);
            }

            dragRef.current = null;
          }}
          onPointerLeave={(e) => {
            const d = dragRef.current;
            if (!d || d.pointerId !== e.pointerId) return;
            dragRef.current = null;
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
              opacity: 0.5,
              pointerEvents: "none",
            }}
          />

          {boardsOnBench.map((b) => {
            const lay = lmap.get(b.id);
            if (!lay) return null;

            return (
              <PieceCard
                key={b.id}
                board={b}
                selected={selectedPieceIds.includes(b.id)}
                layout={lay}
                displayName={displayNameFor(b)}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  if (project.pieces.some((p) => p.id === b.id)) setActiveId(b.id);
                  dragRef.current = {
                    id: b.id,
                    pointerId: e.pointerId,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    originX: lay.x,
                    originY: lay.y,
                    moved: false,
                    before: snapshotCurrent(),
                  };
                }}
              />
            );
          })}
        </div>

        <div
          style={{
            display: "grid",
            gap: 10,
            minHeight: 0,
            height: "100%",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {renderContextStrip()}
          {renderToolTabs()}
          {renderToolPanel()}
        </div>
      </div>
    </div>
  );
}