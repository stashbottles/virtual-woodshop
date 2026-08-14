// src/shopEngine.ts
// Pure dimensional + visual-pattern logic only. No React.

export type GrainOrientation = "FACE" | "EDGE" | "END";
export type CutDirection = "ALONG_LENGTH" | "ALONG_WIDTH";
export type FlipAxis = "FLIP_TO_FACE" | "FLIP_TO_EDGE" | "FLIP_TO_END";
export type GlueOrientation = "EDGE_GLUED" | "FACE_GLUED";
export type ProfileShape = "RECTANGLE" | "CENTER_SQUARE_45" | "TRIANGLE_45";
export type TriangleCorner45 = "TOP_LEFT" | "TOP_RIGHT" | "BOTTOM_RIGHT" | "BOTTOM_LEFT";
export type PatternAxis = "LENGTH_Y" | "WIDTH_X" | "THICKNESS_Z";

export type VisualPatternChild = {
  node: VisualPatternNode;
  size: number;
  visualRotationDeg?: number;
};

export type VisualPatternNode =
  | { kind: "SOLID"; species: string }
  | {
      kind: "EDGE_GLUED";
      bands: VisualPatternChild[];

      // Board-local axis. EDGE_GLUED usually starts on WIDTH_X,
      // but flips and real visible-plane rotations can move it.
      axis?: PatternAxis;
    }
  | {
      kind: "FACE_GLUED";
      layers: VisualPatternChild[];

      // Board-local axis. FACE_GLUED usually starts on THICKNESS_Z,
      // but flips can make those layers visible.
      axis?: PatternAxis;
    };

    export type RenderPatternChild = {
      node: RenderPatternNode;
      size: number;
      visualRotationDeg?: number;
    };

export type RenderPatternNode =
  | { kind: "leaf"; species: string }
  | { kind: "split"; direction: "row" | "column"; children: RenderPatternChild[] };

export interface Board3D {
  id: string;
  lengthY: number;
  widthX: number;
  thicknessZ: number;
  grainOrientation: GrainOrientation;
  species: string;
  isOffcut: boolean;

  // Legacy summary only. Do not use as the source of visual truth.
  gluePattern?: {
    mode: GlueOrientation;
    speciesBands: string[];
  };

  // Canonical visual truth.
  visualPattern?: VisualPatternNode;

  // Tracks real visible-plane quarter turns. This is not just CSS now.
  facePatternRotationDeg?: number;
  profileShape?: ProfileShape;
  triangleCorner45?: TriangleCorner45;
}

export const KERF = 0.125;

export interface CutResult {
  left: Board3D;
  right: Board3D;
}

export interface RipStripsResult {
  strips: Board3D[];
  remainder: Board3D;
}

export interface CrosscutBlocksResult {
  blocks: Board3D[];
  remainder: Board3D;
}

export interface ProfileCutCorners45Result {
  center: Board3D;
  triangles: Board3D[];
}

export interface GlueUpInput {
  boards: Board3D[];
  orientation: GlueOrientation;
  allowProud: boolean;
}

export interface GlueUpResult {
  panel: Board3D;
  constituentBoards: Board3D[];
}

export type ShopErrorCode =
  | "INVALID_CUT"
  | "NEGATIVE_DIMENSION"
  | "MISMATCHED_LENGTH_FOR_GLUEUP"
  | "MISMATCHED_THICKNESS_FOR_NON_PROUD_GLUEUP"
  | "INVALID_GRAIN_FOR_OPERATION"
  | "PLANE_TARGET_TOO_THIN"
  | "NON_SQUARE_FACE_FOR_PROFILE_CUT";

export interface ShopError {
  ok: false;
  code: ShopErrorCode;
  message: string;
}

export interface ShopOk<T> {
  ok: true;
  value: T;
}

export type ShopResult<T> = ShopOk<T> | ShopError;

type PhysicalAxis = "PHYSICAL_LENGTH" | "PHYSICAL_WIDTH" | "PHYSICAL_THICKNESS";

const DEFAULT_TOL = 1e-4;
const ROTATION_TOL = 1e-6;

function ok<T>(value: T): ShopOk<T> {
  return { ok: true, value };
}

function err(code: ShopErrorCode, message: string): ShopError {
  return { ok: false, code, message };
}

function isFinitePos(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

function validateBoardDims(board: Board3D): ShopResult<true> {
  if (!isFinitePos(board.lengthY) || !isFinitePos(board.widthX) || !isFinitePos(board.thicknessZ)) {
    return err(
      "NEGATIVE_DIMENSION",
      `Board "${board.id}" has invalid dimensions. lengthY=${board.lengthY}, widthX=${board.widthX}, thicknessZ=${board.thicknessZ}.`
    );
  }

  return ok(true);
}

function nearlyEqual(a: number, b: number, tol: number = DEFAULT_TOL): boolean {
  return Math.abs(a - b) <= tol;
}

function maxOf(nums: number[]): number {
  return nums.reduce((m, n) => (n > m ? n : m), nums[0] ?? 0);
}

function sumOf(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0);
}

function mixedSpeciesLabel(boards: Board3D[]): string {
  const uniq = Array.from(new Set(boards.map((b) => b.species.trim()).filter(Boolean)));
  return uniq.length <= 1 ? (uniq[0] ?? "Wood") : uniq.join("+");
}

function normalizePatternSpecies(value: string): string {
  const parts = value
    .split(/[+,/&|]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 0) return parts[0];

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Wood";
}

function solidPattern(species: string): VisualPatternNode {
  return { kind: "SOLID", species: normalizePatternSpecies(species) };
}

function localAxisToPhysicalAxis(orientation: GrainOrientation, axis: PatternAxis): PhysicalAxis {
  if (orientation === "FACE") {
    if (axis === "LENGTH_Y") return "PHYSICAL_LENGTH";
    if (axis === "WIDTH_X") return "PHYSICAL_WIDTH";
    return "PHYSICAL_THICKNESS";
  }

  if (orientation === "EDGE") {
    if (axis === "LENGTH_Y") return "PHYSICAL_LENGTH";
    if (axis === "WIDTH_X") return "PHYSICAL_THICKNESS";
    return "PHYSICAL_WIDTH";
  }

  if (axis === "LENGTH_Y") return "PHYSICAL_WIDTH";
  if (axis === "WIDTH_X") return "PHYSICAL_THICKNESS";
  return "PHYSICAL_LENGTH";
}

function physicalAxisToLocalAxis(orientation: GrainOrientation, axis: PhysicalAxis): PatternAxis {
  if (orientation === "FACE") {
    if (axis === "PHYSICAL_LENGTH") return "LENGTH_Y";
    if (axis === "PHYSICAL_WIDTH") return "WIDTH_X";
    return "THICKNESS_Z";
  }

  if (orientation === "EDGE") {
    if (axis === "PHYSICAL_LENGTH") return "LENGTH_Y";
    if (axis === "PHYSICAL_WIDTH") return "THICKNESS_Z";
    return "WIDTH_X";
  }

  if (axis === "PHYSICAL_LENGTH") return "THICKNESS_Z";
  if (axis === "PHYSICAL_WIDTH") return "LENGTH_Y";
  return "WIDTH_X";
}

function mapLocalAxisBetweenOrientations(
  axis: PatternAxis,
  from: GrainOrientation,
  to: GrainOrientation
): PatternAxis {
  return physicalAxisToLocalAxis(to, localAxisToPhysicalAxis(from, axis));
}

function defaultEdgeGluedAxisForOrientation(orientation: GrainOrientation): PatternAxis {
  return physicalAxisToLocalAxis(orientation, "PHYSICAL_WIDTH");
}

function defaultFaceGluedAxisForOrientation(orientation: GrainOrientation): PatternAxis {
  return physicalAxisToLocalAxis(orientation, "PHYSICAL_THICKNESS");
}

function patternAxisSpan(board: Board3D, axis: PatternAxis): number {
  if (axis === "LENGTH_Y") return board.lengthY;
  if (axis === "WIDTH_X") return board.widthX;
  return board.thicknessZ;
}

function legacyGluePatternToVisual(
  pattern: Board3D["gluePattern"] | undefined,
  orientation: GrainOrientation
): VisualPatternNode | undefined {
  if (!pattern || pattern.speciesBands.length === 0) return undefined;

  if (pattern.mode === "EDGE_GLUED") {
    return {
      kind: "EDGE_GLUED",
      axis: defaultEdgeGluedAxisForOrientation(orientation),
      bands: pattern.speciesBands.map((s) => ({
        node: solidPattern(s),
        size: 1,
      })),
    };
  }

  return {
    kind: "FACE_GLUED",
    axis: defaultFaceGluedAxisForOrientation(orientation),
    layers: pattern.speciesBands.map((s) => ({
      node: solidPattern(s),
      size: 1,
    })),
  };
}

function patternWithDefaultAxesForOrientation(
  node: VisualPatternNode,
  orientation: GrainOrientation
): VisualPatternNode {
  switch (node.kind) {
    case "SOLID":
      return { ...node, species: normalizePatternSpecies(node.species) };

    case "EDGE_GLUED":
      return {
        kind: "EDGE_GLUED",
        axis: node.axis ?? defaultEdgeGluedAxisForOrientation(orientation),
        bands: node.bands.map((child) => ({
          size: child.size,
          visualRotationDeg: child.visualRotationDeg,
          node: patternWithDefaultAxesForOrientation(child.node, orientation),
        })),
      };

    case "FACE_GLUED":
      return {
        kind: "FACE_GLUED",
        axis: node.axis ?? defaultFaceGluedAxisForOrientation(orientation),
        layers: node.layers.map((child) => ({
          size: child.size,
          visualRotationDeg: child.visualRotationDeg,
          node: patternWithDefaultAxesForOrientation(child.node, orientation),
        })),
      };
  }
}

function getBoardVisualPattern(board: Board3D): VisualPatternNode {
  const pattern = board.visualPattern ?? legacyGluePatternToVisual(board.gluePattern, board.grainOrientation);

  if (pattern) {
    return patternWithDefaultAxesForOrientation(pattern, board.grainOrientation);
  }

  return solidPattern(board.species);
}

function clonePattern(node: VisualPatternNode): VisualPatternNode {
  switch (node.kind) {
    case "SOLID":
      return { kind: "SOLID", species: normalizePatternSpecies(node.species) };

    case "EDGE_GLUED":
      return {
        kind: "EDGE_GLUED",
        axis: node.axis,
        bands: node.bands.map((child) => ({
          size: child.size,
          visualRotationDeg: child.visualRotationDeg,
          node: clonePattern(child.node),
        })),
      };

    case "FACE_GLUED":
      return {
        kind: "FACE_GLUED",
        axis: node.axis,
        layers: node.layers.map((child) => ({
          size: child.size,
          visualRotationDeg: child.visualRotationDeg,
          node: clonePattern(child.node),
        })),
      };
  }
}

function transformPatternAxes(
  node: VisualPatternNode,
  from: GrainOrientation,
  to: GrainOrientation
): VisualPatternNode {
  switch (node.kind) {
    case "SOLID":
      return clonePattern(node);

    case "EDGE_GLUED": {
      const sourceAxis = node.axis ?? defaultEdgeGluedAxisForOrientation(from);

      return {
        kind: "EDGE_GLUED",
        axis: mapLocalAxisBetweenOrientations(sourceAxis, from, to),
        bands: node.bands.map((child) => ({
          size: child.size,
          visualRotationDeg: child.visualRotationDeg,
          node: transformPatternAxes(child.node, from, to),
        })),
      };
    }

    case "FACE_GLUED": {
      const sourceAxis = node.axis ?? defaultFaceGluedAxisForOrientation(from);

      return {
        kind: "FACE_GLUED",
        axis: mapLocalAxisBetweenOrientations(sourceAxis, from, to),
        layers: node.layers.map((child) => ({
          size: child.size,
          visualRotationDeg: child.visualRotationDeg,
          node: transformPatternAxes(child.node, from, to),
        })),
      };
    }
  }
}

function firstSpeciesFromPattern(node: VisualPatternNode): string {
  switch (node.kind) {
    case "SOLID":
      return normalizePatternSpecies(node.species);

    case "EDGE_GLUED":
      return node.bands.length > 0 ? firstSpeciesFromPattern(node.bands[0].node) : "Wood";

    case "FACE_GLUED":
      return node.layers.length > 0 ? firstSpeciesFromPattern(node.layers[0].node) : "Wood";
  }
}

function summarizePatternChildren(children: VisualPatternChild[]): string[] {
  return children.map((child) => firstSpeciesFromPattern(child.node));
}

function getSplitAxis(node: VisualPatternNode): PatternAxis | undefined {
  if (node.kind === "EDGE_GLUED") return node.axis ?? "WIDTH_X";
  if (node.kind === "FACE_GLUED") return node.axis ?? "THICKNESS_Z";
  return undefined;
}

function getSplitChildren(node: VisualPatternNode): VisualPatternChild[] {
  if (node.kind === "EDGE_GLUED") return node.bands;
  if (node.kind === "FACE_GLUED") return node.layers;
  return [];
}

function makeSplitLike(node: VisualPatternNode, children: VisualPatternChild[]): VisualPatternNode {
  const cleanChildren = children.filter((child) => child.size > DEFAULT_TOL);

  if (cleanChildren.length === 0) return clonePattern(node);
  if (cleanChildren.length === 1) return clonePattern(cleanChildren[0].node);

  if (node.kind === "EDGE_GLUED") {
    return {
      kind: "EDGE_GLUED",
      axis: node.axis ?? "WIDTH_X",
      bands: cleanChildren,
    };
  }

  if (node.kind === "FACE_GLUED") {
    return {
      kind: "FACE_GLUED",
      axis: node.axis ?? "THICKNESS_Z",
      layers: cleanChildren,
    };
  }

  return clonePattern(node);
}

function rescaleChildrenToSpan(children: VisualPatternChild[], spanHint: number | undefined): VisualPatternChild[] {
  if (typeof spanHint !== "number" || !isFinitePos(spanHint)) {
    return children.map((child) => ({
      size: child.size,
      node: child.node,
    }));
  }

  const total = sumOf(children.map((child) => child.size));

  if (!isFinitePos(total) || nearlyEqual(total, spanHint)) {
    return children.map((child) => ({
      size: child.size,
      node: child.node,
    }));
  }

  const scale = spanHint / total;

  return children.map((child) => ({
    size: child.size * scale,
    node: child.node,
  }));
}

function slicePatternAlongAxis(
  node: VisualPatternNode,
  axis: PatternAxis,
  start: number,
  end: number,
  spanHint?: number
): VisualPatternNode {
  if (node.kind === "SOLID") {
    return clonePattern(node);
  }

  const splitAxis = getSplitAxis(node);
  const children = getSplitChildren(node);

  if (children.length === 0) {
    return clonePattern(node);
  }

  if (splitAxis !== axis) {
    return makeSplitLike(
      node,
      children.map((child) => ({
        size: child.size,
        node: slicePatternAlongAxis(child.node, axis, start, end, spanHint),
      }))
    );
  }

  const scaledChildren = rescaleChildrenToSpan(children, spanHint);
  const result: VisualPatternChild[] = [];
  let cursor = 0;

  for (const child of scaledChildren) {
    const childStart = cursor;
    const childEnd = cursor + child.size;
    cursor = childEnd;

    const overlapStart = Math.max(start, childStart);
    const overlapEnd = Math.min(end, childEnd);
    const overlap = overlapEnd - overlapStart;

    if (overlap > DEFAULT_TOL) {
      const localStart = overlapStart - childStart;
      const localEnd = overlapEnd - childStart;

      result.push({
        size: overlap,
        node: slicePatternAlongAxis(child.node, axis, localStart, localEnd, child.size),
      });
    }
  }

  return makeSplitLike(node, result);
}

function sliceBoardPatternAlongAxis(
  board: Board3D,
  axis: PatternAxis,
  start: number,
  end: number
): VisualPatternNode {
  return slicePatternAlongAxis(getBoardVisualPattern(board), axis, start, end, patternAxisSpan(board, axis));
}

// Which physical face App.tsx is currently drawing a piece from.
// FACE: the normal top-down board view (lengthY = CSS width, widthX = CSS height).
// CROSS_SECTION: the end-on view of a profile-cut rod (widthX = CSS width,
// thicknessZ = CSS height) — used for CENTER_SQUARE_45 / TRIANGLE_45 pieces,
// whose interesting face is their cut cross-section, not their length.
export type PatternViewMode = "FACE" | "CROSS_SECTION";

function renderDirectionForAxis(axis: PatternAxis, viewMode: PatternViewMode): "row" | "column" | undefined {
  if (viewMode === "CROSS_SECTION") {
    // App.tsx renders board.widthX as CSS width and board.thicknessZ as CSS height
    // for cross-section pieces. LENGTH_Y is depth here and isn't visible.
    if (axis === "WIDTH_X") return "row";
    if (axis === "THICKNESS_Z") return "column";
    return undefined;
  }

  // App.tsx renders board.lengthY as CSS width and board.widthX as CSS height.
  // So LENGTH_Y must split left/right, and WIDTH_X must split top/bottom.
  if (axis === "LENGTH_Y") return "row";
  if (axis === "WIDTH_X") return "column";
  return undefined;
}

function renderPatternNode(node: VisualPatternNode, viewMode: PatternViewMode): RenderPatternNode {
  switch (node.kind) {
    case "SOLID":
      return { kind: "leaf", species: normalizePatternSpecies(node.species) };

    case "EDGE_GLUED": {
      const axis = node.axis ?? "WIDTH_X";
      const direction = renderDirectionForAxis(axis, viewMode);

      if (direction) {
        return {
          kind: "split",
          direction,
          children: node.bands.map((child) => ({
            size: child.size,
            visualRotationDeg: child.visualRotationDeg,
            node: renderPatternNode(child.node, viewMode),
          })),
        };
      }

      return node.bands.length > 0 ? renderPatternNode(node.bands[0].node, viewMode) : { kind: "leaf", species: "Wood" };
    }

    case "FACE_GLUED": {
      const axis = node.axis ?? "THICKNESS_Z";
      const direction = renderDirectionForAxis(axis, viewMode);

      if (direction) {
        return {
          kind: "split",
          direction,
          children: node.layers.map((child) => ({
            size: child.size,
            visualRotationDeg: child.visualRotationDeg,
            node: renderPatternNode(child.node, viewMode),
          })),
        };
      }

      return node.layers.length > 0 ? renderPatternNode(node.layers[0].node, viewMode) : { kind: "leaf", species: "Wood" };
    }
  }
}

export function getRenderablePattern(board: Board3D, viewMode: PatternViewMode = "FACE"): RenderPatternNode {
  return renderPatternNode(getBoardVisualPattern(board), viewMode);
}

function boardWithPattern(board: Board3D, visualPattern: VisualPatternNode): Board3D {
  return {
    ...board,
    visualPattern,
  };
}

export function cutBoard(
  board: Board3D,
  direction: CutDirection,
  cutDistanceFromZero: number,
  kerf: number = KERF
): ShopResult<CutResult> {
  const valid = validateBoardDims(board);
  if (!valid.ok) return valid;

  if (!Number.isFinite(cutDistanceFromZero) || !Number.isFinite(kerf) || kerf <= 0) {
    return err("INVALID_CUT", `Invalid cut inputs. cutDistanceFromZero=${cutDistanceFromZero}, kerf=${kerf}`);
  }

  if (direction === "ALONG_LENGTH") {
    if (!(cutDistanceFromZero > 0 && cutDistanceFromZero + kerf < board.lengthY)) {
      return err(
        "INVALID_CUT",
        `ALONG_LENGTH cut invalid. Need 0 < cutDistanceFromZero and cutDistanceFromZero + kerf < lengthY.`
      );
    }

    const leftLength = cutDistanceFromZero;
    const rightLength = board.lengthY - cutDistanceFromZero - kerf;

    const left: Board3D = boardWithPattern(
      { ...board, id: `${board.id}:L`, lengthY: leftLength },
      sliceBoardPatternAlongAxis(board, "LENGTH_Y", 0, leftLength)
    );

    const right: Board3D = boardWithPattern(
      { ...board, id: `${board.id}:R`, lengthY: rightLength },
      sliceBoardPatternAlongAxis(board, "LENGTH_Y", cutDistanceFromZero + kerf, board.lengthY)
    );

    return ok({ left, right });
  }

  if (!(cutDistanceFromZero > 0 && cutDistanceFromZero + kerf < board.widthX)) {
    return err(
      "INVALID_CUT",
      `ALONG_WIDTH cut invalid. Need 0 < cutDistanceFromZero and cutDistanceFromZero + kerf < widthX.`
    );
  }

  const leftWidth = cutDistanceFromZero;
  const rightWidth = board.widthX - cutDistanceFromZero - kerf;

  const left: Board3D = boardWithPattern(
    { ...board, id: `${board.id}:L`, widthX: leftWidth },
    sliceBoardPatternAlongAxis(board, "WIDTH_X", 0, leftWidth)
  );

  const right: Board3D = boardWithPattern(
    { ...board, id: `${board.id}:R`, widthX: rightWidth },
    sliceBoardPatternAlongAxis(board, "WIDTH_X", cutDistanceFromZero + kerf, board.widthX)
  );

  return ok({ left, right });
}

function getPhysicalDims(board: Board3D): {
  physicalLength: number;
  physicalWidth: number;
  physicalThickness: number;
} {
  switch (board.grainOrientation) {
    case "FACE":
      return {
        physicalLength: board.lengthY,
        physicalWidth: board.widthX,
        physicalThickness: board.thicknessZ,
      };

    case "EDGE":
      return {
        physicalLength: board.lengthY,
        physicalWidth: board.thicknessZ,
        physicalThickness: board.widthX,
      };

    case "END":
      return {
        physicalLength: board.thicknessZ,
        physicalWidth: board.lengthY,
        physicalThickness: board.widthX,
      };
  }
}

function flipTargetFromAxis(axis: FlipAxis): GrainOrientation {
  if (axis === "FLIP_TO_FACE") return "FACE";
  if (axis === "FLIP_TO_EDGE") return "EDGE";
  return "END";
}

export function flipBoard(board: Board3D, axis: FlipAxis): ShopResult<Board3D> {
  const valid = validateBoardDims(board);
  if (!valid.ok) return valid;

  const { physicalLength, physicalWidth, physicalThickness } = getPhysicalDims(board);
  const targetOrientation = flipTargetFromAxis(axis);
  const visualPattern = transformPatternAxes(getBoardVisualPattern(board), board.grainOrientation, targetOrientation);

  if (targetOrientation === "FACE") {
    return ok({
      ...board,
      grainOrientation: "FACE",
      lengthY: physicalLength,
      widthX: physicalWidth,
      thicknessZ: physicalThickness,
      visualPattern,
    });
  }

  if (targetOrientation === "EDGE") {
    return ok({
      ...board,
      grainOrientation: "EDGE",
      lengthY: physicalLength,
      widthX: physicalThickness,
      thicknessZ: physicalWidth,
      visualPattern,
    });
  }

  return ok({
    ...board,
    grainOrientation: "END",
    lengthY: physicalWidth,
    widthX: physicalThickness,
    thicknessZ: physicalLength,
    visualPattern,
  });
}

export function normalizeFacePatternRotationDeg(deg: number): number {
  const normalized = deg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function quarterTurnsFromDelta(deltaDeg: number): ShopResult<number> {
  const normalized = normalizeFacePatternRotationDeg(deltaDeg);
  const turnsFloat = normalized / 90;
  const turns = Math.round(turnsFloat);

  if (Math.abs(turnsFloat - turns) > ROTATION_TOL) {
    return err(
      "INVALID_CUT",
      `Only 90-degree visible-plane rotations are supported by the pattern engine right now. Received ${deltaDeg}.`
    );
  }

  return ok(turns % 4);
}

function rotateAxisInVisiblePlane(axis: PatternAxis, quarterTurns: number): PatternAxis {
  const turns = ((quarterTurns % 4) + 4) % 4;

  if (axis === "THICKNESS_Z") return axis;
  if (turns % 2 === 0) return axis;

  return axis === "LENGTH_Y" ? "WIDTH_X" : "LENGTH_Y";
}

function rotatePatternInVisiblePlane(node: VisualPatternNode, quarterTurns: number): VisualPatternNode {
  switch (node.kind) {
    case "SOLID":
      return clonePattern(node);

    case "EDGE_GLUED":
      return {
        kind: "EDGE_GLUED",
        axis: rotateAxisInVisiblePlane(node.axis ?? "WIDTH_X", quarterTurns),
        bands: node.bands.map((child) => ({
          size: child.size,
          visualRotationDeg: child.visualRotationDeg,
          node: rotatePatternInVisiblePlane(child.node, quarterTurns),
        })),
      };

    case "FACE_GLUED":
      return {
        kind: "FACE_GLUED",
        axis: rotateAxisInVisiblePlane(node.axis ?? "THICKNESS_Z", quarterTurns),
        layers: node.layers.map((child) => ({
          size: child.size,
          visualRotationDeg: child.visualRotationDeg,
          node: rotatePatternInVisiblePlane(child.node, quarterTurns),
        })),
      };
  }
}

export function rotateFacePattern(board: Board3D, deltaDeg: number): ShopResult<Board3D> {
  const valid = validateBoardDims(board);
  if (!valid.ok) return valid;

  if (!Number.isFinite(deltaDeg)) {
    return err("INVALID_CUT", `Invalid face pattern rotation delta: ${deltaDeg}`);
  }

  const turnsResult = quarterTurnsFromDelta(deltaDeg);
  if (!turnsResult.ok) return turnsResult;

  const quarterTurns = turnsResult.value;
  const shouldSwapVisibleDims = quarterTurns % 2 === 1;
  const visualPattern = rotatePatternInVisiblePlane(getBoardVisualPattern(board), quarterTurns);

  return ok({
    ...board,
    lengthY: shouldSwapVisibleDims ? board.widthX : board.lengthY,
    widthX: shouldSwapVisibleDims ? board.lengthY : board.widthX,
    thicknessZ: board.thicknessZ,
    facePatternRotationDeg: normalizeFacePatternRotationDeg((board.facePatternRotationDeg ?? 0) + deltaDeg),
    visualPattern,
  });
}

export function setFacePatternRotation(board: Board3D, rotationDeg: number): ShopResult<Board3D> {
  const valid = validateBoardDims(board);
  if (!valid.ok) return valid;

  if (!Number.isFinite(rotationDeg)) {
    return err("INVALID_CUT", `Invalid face pattern rotation: ${rotationDeg}`);
  }

  const current = normalizeFacePatternRotationDeg(board.facePatternRotationDeg ?? 0);
  const target = normalizeFacePatternRotationDeg(rotationDeg);
  const delta = target - current;

  return rotateFacePattern(board, delta);
}

function glueChildRotationForBoard(board: Board3D): number | undefined {
  return board.profileShape === "CENTER_SQUARE_45" ? 45 : undefined;
}

export function glueUpBoards(input: GlueUpInput): ShopResult<GlueUpResult> {
  const boards = input.boards.slice();

  if (boards.length < 2) {
    return err("INVALID_CUT", "Glue-up requires at least 2 boards.");
  }

  for (const b of boards) {
    const valid = validateBoardDims(b);
    if (!valid.ok) return valid;
  }

  const base = boards[0];

  if (input.orientation === "EDGE_GLUED") {
    for (const b of boards) {
      if (!nearlyEqual(b.lengthY, base.lengthY)) {
        return err(
          "MISMATCHED_LENGTH_FOR_GLUEUP",
          `EDGE_GLUED requires matching lengths. "${b.id}" lengthY=${b.lengthY} does not match base lengthY=${base.lengthY}.`
        );
      }
    }

    if (!input.allowProud) {
      for (const b of boards) {
        if (!nearlyEqual(b.thicknessZ, base.thicknessZ)) {
          return err(
            "MISMATCHED_THICKNESS_FOR_NON_PROUD_GLUEUP",
            `EDGE_GLUED without proud requires matching thicknesses. "${b.id}" thicknessZ=${b.thicknessZ} does not match base thicknessZ=${base.thicknessZ}.`
          );
        }
      }
    }

    const panelThickness = input.allowProud ? maxOf(boards.map((b) => b.thicknessZ)) : base.thicknessZ;

    const bandPatterns: VisualPatternChild[] = boards.map((b) => ({
      node: clonePattern(getBoardVisualPattern(b)),
      size: b.widthX,
      visualRotationDeg: glueChildRotationForBoard(b),
    }));

    const visualPattern: VisualPatternNode = {
      kind: "EDGE_GLUED",
      axis: "WIDTH_X",
      bands: bandPatterns,
    };

    const panel: Board3D = {
      id: `panel:${boards.map((b) => b.id).join("+")}`,
      lengthY: base.lengthY,
      widthX: sumOf(boards.map((b) => b.widthX)),
      thicknessZ: panelThickness,
      grainOrientation: base.grainOrientation,
      species: mixedSpeciesLabel(boards),
      isOffcut: false,
      gluePattern: {
        mode: "EDGE_GLUED",
        speciesBands: summarizePatternChildren(bandPatterns),
      },
      visualPattern,
      facePatternRotationDeg: 0,
    };

    return ok({ panel, constituentBoards: boards.slice() });
  }

  for (const b of boards) {
    if (b.grainOrientation === "END") {
      return err("INVALID_GRAIN_FOR_OPERATION", `FACE_GLUED does not allow END-grain inputs. "${b.id}" is END.`);
    }

    if (!nearlyEqual(b.lengthY, base.lengthY)) {
      return err(
        "MISMATCHED_LENGTH_FOR_GLUEUP",
        `FACE_GLUED requires matching lengths. "${b.id}" lengthY=${b.lengthY} does not match base lengthY=${base.lengthY}.`
      );
    }

    if (!nearlyEqual(b.widthX, base.widthX)) {
      return err(
        "INVALID_CUT",
        `FACE_GLUED requires matching widths. "${b.id}" widthX=${b.widthX} does not match base widthX=${base.widthX}.`
      );
    }
  }

  const layerPatterns: VisualPatternChild[] = boards.map((b) => ({
    node: clonePattern(getBoardVisualPattern(b)),
    size: b.thicknessZ,
    visualRotationDeg: glueChildRotationForBoard(b),
  }));

  const visualPattern: VisualPatternNode = {
    kind: "FACE_GLUED",
    axis: "THICKNESS_Z",
    layers: layerPatterns,
  };

  const panel: Board3D = {
    id: `panel:${boards.map((b) => b.id).join("+")}`,
    lengthY: base.lengthY,
    widthX: base.widthX,
    thicknessZ: sumOf(boards.map((b) => b.thicknessZ)),
    grainOrientation: base.grainOrientation,
    species: mixedSpeciesLabel(boards),
    isOffcut: false,
    gluePattern: {
      mode: "FACE_GLUED",
      speciesBands: summarizePatternChildren(layerPatterns),
    },
    visualPattern,
    facePatternRotationDeg: 0,
  };

  return ok({ panel, constituentBoards: boards.slice() });
}

export function planePanel(
  board: Board3D,
  targetThickness: number,
  minSourceThickness: number
): ShopResult<Board3D> {
  const valid = validateBoardDims(board);
  if (!valid.ok) return valid;

  if (!isFinitePos(targetThickness) || !isFinitePos(minSourceThickness)) {
    return err(
      "PLANE_TARGET_TOO_THIN",
      `Invalid planing inputs. targetThickness=${targetThickness}, minSourceThickness=${minSourceThickness}.`
    );
  }

  if (targetThickness < minSourceThickness - DEFAULT_TOL) {
    return err(
      "PLANE_TARGET_TOO_THIN",
      `Target thickness ${targetThickness} is below min source thickness ${minSourceThickness}.`
    );
  }

  if (targetThickness > board.thicknessZ + DEFAULT_TOL) {
    return err("INVALID_CUT", `Cannot plane board "${board.id}" thicker than current thickness ${board.thicknessZ}.`);
  }

  return ok({
    ...board,
    thicknessZ: targetThickness,
    visualPattern: clonePattern(getBoardVisualPattern(board)),
  });
}

export function ripBoardIntoStrips(
  board: Board3D,
  stripWidth: number,
  kerf: number = KERF
): ShopResult<RipStripsResult> {
  const valid = validateBoardDims(board);
  if (!valid.ok) return valid;

  if (!isFinitePos(stripWidth) || !isFinitePos(kerf)) {
    return err("INVALID_CUT", `Invalid rip inputs. stripWidth=${stripWidth}, kerf=${kerf}`);
  }

  if (!(stripWidth + kerf < board.widthX)) {
    return err(
      "INVALID_CUT",
      `Rip strip width ${stripWidth} is too large for board width ${board.widthX} with kerf ${kerf}.`
    );
  }

  const strips: Board3D[] = [];
  let consumed = 0;
  let remainingWidth = board.widthX;
  let index = 1;

  while (remainingWidth - stripWidth - kerf > DEFAULT_TOL) {
    const start = consumed;
    const end = start + stripWidth;

    strips.push(
      boardWithPattern(
        {
          ...board,
          id: `${board.id}:strip${index}`,
          widthX: stripWidth,
        },
        sliceBoardPatternAlongAxis(board, "WIDTH_X", start, end)
      )
    );

    consumed += stripWidth + kerf;
    remainingWidth -= stripWidth + kerf;
    index += 1;
  }

  const remainderStart = consumed;
  const remainderEnd = board.widthX;

  const remainder: Board3D = boardWithPattern(
    {
      ...board,
      id: `${board.id}:remainder`,
      widthX: remainingWidth,
      isOffcut: true,
    },
    sliceBoardPatternAlongAxis(board, "WIDTH_X", remainderStart, remainderEnd)
  );

  if (strips.length === 0 || remainder.widthX <= DEFAULT_TOL) {
    return err("INVALID_CUT", "Rip operation could not produce valid strips and remainder.");
  }

  return ok({ strips, remainder });
}

export function crosscutBoardIntoBlocks(
  board: Board3D,
  blockLength: number,
  kerf: number = KERF
): ShopResult<CrosscutBlocksResult> {
  const valid = validateBoardDims(board);
  if (!valid.ok) return valid;

  if (!isFinitePos(blockLength) || !isFinitePos(kerf)) {
    return err("INVALID_CUT", `Invalid crosscut inputs. blockLength=${blockLength}, kerf=${kerf}`);
  }

  if (!(blockLength + kerf < board.lengthY)) {
    return err(
      "INVALID_CUT",
      `Crosscut block length ${blockLength} is too large for board length ${board.lengthY} with kerf ${kerf}.`
    );
  }

  const blocks: Board3D[] = [];
  let consumed = 0;
  let remainingLength = board.lengthY;
  let index = 1;

  while (remainingLength - blockLength - kerf > DEFAULT_TOL) {
    const start = consumed;
    const end = start + blockLength;

    blocks.push(
      boardWithPattern(
        {
          ...board,
          id: `${board.id}:block${index}`,
          lengthY: blockLength,
        },
        sliceBoardPatternAlongAxis(board, "LENGTH_Y", start, end)
      )
    );

    consumed += blockLength + kerf;
    remainingLength -= blockLength + kerf;
    index += 1;
  }

  const remainderStart = consumed;
  const remainderEnd = board.lengthY;

  const remainder: Board3D = boardWithPattern(
    {
      ...board,
      id: `${board.id}:remainder`,
      lengthY: remainingLength,
      isOffcut: true,
    },
    sliceBoardPatternAlongAxis(board, "LENGTH_Y", remainderStart, remainderEnd)
  );

  if (blocks.length === 0 || remainder.lengthY <= DEFAULT_TOL) {
    return err("INVALID_CUT", "Crosscut operation could not produce valid blocks and remainder.");
  }

  return ok({ blocks, remainder });
}
export function profileCutCorners45(
  board: Board3D,
  kerf: number = KERF
): ShopResult<ProfileCutCorners45Result> {
  const valid = validateBoardDims(board);
  if (!valid.ok) return valid;

  if (!Number.isFinite(kerf) || kerf <= 0) {
    return err("INVALID_CUT", `Invalid 45° corner cut kerf: ${kerf}`);
  }

  if (!nearlyEqual(board.widthX, board.thicknessZ)) {
    return err(
      "NON_SQUARE_FACE_FOR_PROFILE_CUT",
      `45° corner cut version 1 requires a square beam face. "${board.id}" has widthX=${board.widthX} and thicknessZ=${board.thicknessZ}.`
    );
  }

  const originalSide = board.widthX;
  const centerSide = originalSide / Math.SQRT2;
  const triangleLeg = originalSide / 2 - kerf;

  if (triangleLeg <= DEFAULT_TOL) {
    return err(
      "INVALID_CUT",
      `45° corner cut cannot produce usable triangle beams. originalSide=${originalSide}, kerf=${kerf}.`
    );
  }

  const centerPattern = clonePattern(getBoardVisualPattern(board));

  const leftTrianglePattern = sliceBoardPatternAlongAxis(
    board,
    "WIDTH_X",
    0,
    triangleLeg
  );

  const rightTrianglePattern = sliceBoardPatternAlongAxis(
    board,
    "WIDTH_X",
    originalSide - triangleLeg,
    originalSide
  );

  const center: Board3D = {
    ...board,
    id: `${board.id}:center45`,
    widthX: centerSide,
    thicknessZ: centerSide,
    isOffcut: false,
    profileShape: "CENTER_SQUARE_45",
    triangleCorner45: undefined,
    visualPattern: centerPattern,
    facePatternRotationDeg: 0,
  };

  const triangles: Board3D[] = [
    {
      ...board,
      id: `${board.id}:tri45:1`,
      widthX: triangleLeg,
      thicknessZ: triangleLeg,
      isOffcut: false,
      profileShape: "TRIANGLE_45",
      triangleCorner45: "TOP_LEFT",
      visualPattern: clonePattern(leftTrianglePattern),
      facePatternRotationDeg: 0,
    },
    {
      ...board,
      id: `${board.id}:tri45:2`,
      widthX: triangleLeg,
      thicknessZ: triangleLeg,
      isOffcut: false,
      profileShape: "TRIANGLE_45",
      triangleCorner45: "TOP_RIGHT",
      visualPattern: clonePattern(rightTrianglePattern),
      facePatternRotationDeg: 0,
    },
    {
      ...board,
      id: `${board.id}:tri45:3`,
      widthX: triangleLeg,
      thicknessZ: triangleLeg,
      isOffcut: false,
      profileShape: "TRIANGLE_45",
      triangleCorner45: "BOTTOM_RIGHT",
      visualPattern: clonePattern(rightTrianglePattern),
      facePatternRotationDeg: 0,
    },
    {
      ...board,
      id: `${board.id}:tri45:4`,
      widthX: triangleLeg,
      thicknessZ: triangleLeg,
      isOffcut: false,
      profileShape: "TRIANGLE_45",
      triangleCorner45: "BOTTOM_LEFT",
      visualPattern: clonePattern(leftTrianglePattern),
      facePatternRotationDeg: 0,
    },
  ];

  return ok({
    center,
    triangles,
  });
}