// src/projectEngine.ts
import type {
  Board3D,
  CutDirection,
  GlueOrientation,
  FlipAxis,
  ShopErrorCode,
  ShopResult,
} from "./shopEngine";
import {
  cutBoard,
  flipBoard,
  glueUpBoards,
  planePanel,
  ripBoardIntoStrips,
  crosscutBoardIntoBlocks,
  rotateFacePattern,
  setFacePatternRotation,
  profileCutCorners45,
  KERF,
} from "./shopEngine";

export interface Project {
  id: string;
  name: string;
  pieces: Board3D[];
  scrap: Board3D[];
  operations: ShopOperation[];
}

export type ShopOperationType =
  | "CUT"
  | "RIP_STRIPS"
  | "CROSSCUT_BLOCKS"
  | "GLUE_UP"
  | "PLANE"
  | "FLIP"
  | "FLIP_BATCH"
  | "ROTATE_FACE_PATTERN_BATCH"
  | "SET_FACE_PATTERN_ROTATION_BATCH"
  | "DUPLICATE_PIECES"
  | "CUSTOM_NOTE"
  | "PROFILE_CUT_CORNERS_45";

export interface ShopOperationBase {
  id: string;
  type: ShopOperationType;
  timestamp: number;
}

export interface CutOperation extends ShopOperationBase {
  type: "CUT";
  sourceId: string;
  direction: CutDirection;
  cutAt: number;
  kerf: number;
  leftId: string;
  rightId: string;
  scrapSide: "LEFT" | "RIGHT" | "NONE";
}

export interface RipStripsOperation extends ShopOperationBase {
  type: "RIP_STRIPS";
  sourceId: string;
  stripWidth: number;
  kerf: number;
  stripIds: string[];
  remainderId: string;
  remainderIsOffcut: boolean;
}

export interface ProfileCutCorners45Operation extends ShopOperationBase {
  type: "PROFILE_CUT_CORNERS_45";
  sourceId: string;
  kerf: number;
  centerId: string;
  triangleIds: string[];
}

export interface CrosscutBlocksOperation extends ShopOperationBase {
  type: "CROSSCUT_BLOCKS";
  sourceId: string;
  blockLength: number;
  kerf: number;
  blockIds: string[];
  remainderId: string;
  remainderIsOffcut: boolean;
}

export interface GlueUpOperation extends ShopOperationBase {
  type: "GLUE_UP";
  inputIds: string[];
  outputId: string;
  orientation: GlueOrientation;
  allowProud: boolean;
  resultName?: string;
}

export interface FlipOperation extends ShopOperationBase {
  type: "FLIP";
  sourceId: string;
  axis: FlipAxis;
  outputId: string;
}

export interface FlipBatchOperation extends ShopOperationBase {
  type: "FLIP_BATCH";
  inputIds: string[];
  axis: FlipAxis;
  outputIds: string[];
}

export interface RotateFacePatternBatchOperation extends ShopOperationBase {
  type: "ROTATE_FACE_PATTERN_BATCH";
  inputIds: string[];
  deltaDeg: number;
  outputIds: string[];
}

export interface SetFacePatternRotationBatchOperation extends ShopOperationBase {
  type: "SET_FACE_PATTERN_ROTATION_BATCH";
  inputIds: string[];
  rotationDeg: number;
  outputIds: string[];
}

export interface PlaneOperation extends ShopOperationBase {
  type: "PLANE";
  sourceId: string;
  targetThickness: number;
  minSourceThickness: number;
  outputId: string;
}

export interface DuplicatePiecesOperation extends ShopOperationBase {
  type: "DUPLICATE_PIECES";
  sourceIds: string[];
  outputIds: string[];
}

export interface CustomNoteOperation extends ShopOperationBase {
  type: "CUSTOM_NOTE";
  note: string;
}

export type ShopOperation =
  | CutOperation
  | RipStripsOperation
  | CrosscutBlocksOperation
  | GlueUpOperation
  | FlipOperation
  | FlipBatchOperation
  | RotateFacePatternBatchOperation
  | SetFacePatternRotationBatchOperation
  | PlaneOperation
  | DuplicatePiecesOperation
  | CustomNoteOperation
  | ProfileCutCorners45Operation;

function nowMs() {
  return Date.now();
}

function newId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}:${uuid}` : `${prefix}:${nowMs()}:${Math.random().toString(16).slice(2)}`;
}

function ok<T>(value: T): ShopResult<T> {
  return { ok: true, value };
}

function err(code: ShopErrorCode, message: string): ShopResult<never> {
  return { ok: false, code, message };
}

export function createProject(name: string, initialPieces: Board3D[]): Project {
  return {
    id: newId("project"),
    name,
    pieces: initialPieces.slice(),
    scrap: [],
    operations: [],
  };
}

function findPiece(project: Project, id: string): Board3D | undefined {
  return project.pieces.find((p) => p.id === id);
}

export interface GlueUpRequest {
  pieceIds: string[];
  orientation: GlueOrientation;
  allowProud: boolean;
  resultName?: string;
}

export function performGlueUp(project: Project, request: GlueUpRequest): ShopResult<Project> {
  const ids = request.pieceIds.filter(Boolean);
  if (ids.length < 2) return err("INVALID_CUT", "Glue-up requires at least 2 selected pieces.");

  const boards: Board3D[] = [];
  for (const id of ids) {
    const b = findPiece(project, id);
    if (!b) return err("INVALID_CUT", `Glue-up failed: piece "${id}" not found in project.pieces.`);
    boards.push(b);
  }

  const glued = glueUpBoards({
    boards,
    orientation: request.orientation,
    allowProud: request.allowProud,
  });
  if (!glued.ok) return glued;

  const outputId = newId("panel");
  const panel: Board3D = { ...glued.value.panel, id: outputId, isOffcut: false };

  const remainingPieces = project.pieces.filter((p) => !ids.includes(p.id));
  const op: GlueUpOperation = {
    id: newId("op"),
    type: "GLUE_UP",
    timestamp: nowMs(),
    inputIds: ids.slice(),
    outputId,
    orientation: request.orientation,
    allowProud: request.allowProud,
    resultName: request.resultName,
  };

  return ok({
    ...project,
    pieces: [...remainingPieces, panel],
    operations: [...project.operations, op],
  });
}

export function performFlip(project: Project, pieceId: string, axis: FlipAxis): ShopResult<Project> {
  const src = findPiece(project, pieceId);
  if (!src) return err("INVALID_CUT", `Flip failed: piece "${pieceId}" not found.`);

  const flipped = flipBoard(src, axis);
  if (!flipped.ok) return flipped;

  const nextPieces = project.pieces.map((p) => (p.id === pieceId ? { ...flipped.value, id: pieceId } : p));
  const op: FlipOperation = {
    id: newId("op"),
    type: "FLIP",
    timestamp: nowMs(),
    sourceId: pieceId,
    axis,
    outputId: pieceId,
  };

  return ok({ ...project, pieces: nextPieces, operations: [...project.operations, op] });
}

/** Atomic batch flip (all-or-nothing) */
export function performFlipMany(project: Project, pieceIds: string[], axis: FlipAxis): ShopResult<Project> {
  const ids = Array.from(new Set(pieceIds.filter(Boolean)));
  if (ids.length === 0) return ok(project);

  const flippedMap = new Map<string, Board3D>();
  for (const id of ids) {
    const src = findPiece(project, id);
    if (!src) return err("INVALID_CUT", `Flip batch failed: piece "${id}" not found in project.pieces.`);
    const flipped = flipBoard(src, axis);
    if (!flipped.ok) return flipped;
    flippedMap.set(id, { ...flipped.value, id });
  }

  const nextPieces = project.pieces.map((p) => (flippedMap.has(p.id) ? flippedMap.get(p.id)! : p));
  const op: FlipBatchOperation = {
    id: newId("op"),
    type: "FLIP_BATCH",
    timestamp: nowMs(),
    inputIds: ids,
    axis,
    outputIds: ids,
  };

  return ok({ ...project, pieces: nextPieces, operations: [...project.operations, op] });
}

export function performRotateFacePatternMany(
  project: Project,
  pieceIds: string[],
  deltaDeg: number
): ShopResult<Project> {
  const ids = Array.from(new Set(pieceIds.filter(Boolean)));
  if (ids.length === 0) return ok(project);

  const rotatedMap = new Map<string, Board3D>();
  for (const id of ids) {
    const src = findPiece(project, id);
    if (!src) return err("INVALID_CUT", `Pattern rotate failed: piece "${id}" not found in project.pieces.`);
    const rotated = rotateFacePattern(src, deltaDeg);
    if (!rotated.ok) return rotated;
    rotatedMap.set(id, { ...rotated.value, id });
  }

  const nextPieces = project.pieces.map((p) => (rotatedMap.has(p.id) ? rotatedMap.get(p.id)! : p));
  const op: RotateFacePatternBatchOperation = {
    id: newId("op"),
    type: "ROTATE_FACE_PATTERN_BATCH",
    timestamp: nowMs(),
    inputIds: ids,
    deltaDeg,
    outputIds: ids,
  };

  return ok({
    ...project,
    pieces: nextPieces,
    operations: [...project.operations, op],
  });
}

export function performSetFacePatternRotationMany(
  project: Project,
  pieceIds: string[],
  rotationDeg: number
): ShopResult<Project> {
  const ids = Array.from(new Set(pieceIds.filter(Boolean)));
  if (ids.length === 0) return ok(project);

  const rotatedMap = new Map<string, Board3D>();
  for (const id of ids) {
    const src = findPiece(project, id);
    if (!src) return err("INVALID_CUT", `Pattern set failed: piece "${id}" not found in project.pieces.`);
    const rotated = setFacePatternRotation(src, rotationDeg);
    if (!rotated.ok) return rotated;
    rotatedMap.set(id, { ...rotated.value, id });
  }

  const nextPieces = project.pieces.map((p) => (rotatedMap.has(p.id) ? rotatedMap.get(p.id)! : p));
  const op: SetFacePatternRotationBatchOperation = {
    id: newId("op"),
    type: "SET_FACE_PATTERN_ROTATION_BATCH",
    timestamp: nowMs(),
    inputIds: ids,
    rotationDeg,
    outputIds: ids,
  };

  return ok({
    ...project,
    pieces: nextPieces,
    operations: [...project.operations, op],
  });
}

export function performPlane(
  project: Project,
  pieceId: string,
  targetThickness: number,
  minSourceThickness: number
): ShopResult<Project> {
  const src = findPiece(project, pieceId);
  if (!src) return err("INVALID_CUT", `Plane failed: piece "${pieceId}" not found.`);

  const planed = planePanel(src, targetThickness, minSourceThickness);
  if (!planed.ok) return planed;

  const nextPieces = project.pieces.map((p) => (p.id === pieceId ? { ...planed.value, id: pieceId } : p));
  const op: PlaneOperation = {
    id: newId("op"),
    type: "PLANE",
    timestamp: nowMs(),
    sourceId: pieceId,
    targetThickness,
    minSourceThickness,
    outputId: pieceId,
  };

  return ok({ ...project, pieces: nextPieces, operations: [...project.operations, op] });
}

export function performCut(
  project: Project,
  sourceId: string,
  direction: CutDirection,
  cutAt: number,
  kerf: number = KERF,
  scrapSide: "LEFT" | "RIGHT" | "NONE" = "NONE"
): ShopResult<Project> {
  const src = findPiece(project, sourceId);
  if (!src) return err("INVALID_CUT", `Cut failed: piece "${sourceId}" not found.`);

  const res = cutBoard(src, direction, cutAt, kerf);
  if (!res.ok) return res;

  const leftId = newId("piece");
  const rightId = newId("piece");

  const left: Board3D = { ...res.value.left, id: leftId, isOffcut: scrapSide === "LEFT" };
  const right: Board3D = { ...res.value.right, id: rightId, isOffcut: scrapSide === "RIGHT" };

  const remainingPieces = project.pieces.filter((p) => p.id !== sourceId);
  const nextPieces: Board3D[] = [];
  const nextScrap: Board3D[] = project.scrap.slice();

  if (scrapSide === "LEFT") nextScrap.push(left);
  else nextPieces.push(left);

  if (scrapSide === "RIGHT") nextScrap.push(right);
  else nextPieces.push(right);

  const op: CutOperation = {
    id: newId("op"),
    type: "CUT",
    timestamp: nowMs(),
    sourceId,
    direction,
    cutAt,
    kerf,
    leftId,
    rightId,
    scrapSide,
  };

  return ok({
    ...project,
    pieces: [...remainingPieces, ...nextPieces],
    scrap: nextScrap,
    operations: [...project.operations, op],
  });
}

export function performRipStrips(
  project: Project,
  sourceId: string,
  stripWidth: number,
  kerf: number = KERF
): ShopResult<Project> {
  const src = findPiece(project, sourceId);
  if (!src) return err("INVALID_CUT", `Rip failed: piece "${sourceId}" not found.`);

  const res = ripBoardIntoStrips(src, stripWidth, kerf);
  if (!res.ok) return res;

  const remainingPieces = project.pieces.filter((p) => p.id !== sourceId);

  const stripIds: string[] = [];
  const strips: Board3D[] = res.value.strips.map((s) => {
    const id = newId("strip");
    stripIds.push(id);
    return { ...s, id, isOffcut: false };
  });

  const remainderId = newId("rem");
  const remainderIsOffcut = res.value.remainder.widthX < stripWidth;
  const remainder: Board3D = { ...res.value.remainder, id: remainderId, isOffcut: remainderIsOffcut };

  const nextScrap = project.scrap.slice();
  const nextPieces = [...remainingPieces, ...strips];

  if (remainderIsOffcut) nextScrap.push(remainder);
  else nextPieces.push(remainder);

  const op: RipStripsOperation = {
    id: newId("op"),
    type: "RIP_STRIPS",
    timestamp: nowMs(),
    sourceId,
    stripWidth,
    kerf,
    stripIds,
    remainderId,
    remainderIsOffcut,
  };

  return ok({
    ...project,
    pieces: nextPieces,
    scrap: nextScrap,
    operations: [...project.operations, op],
  });
}

export function performCrosscutBlocks(
  project: Project,
  sourceId: string,
  blockLength: number,
  kerf: number = KERF
): ShopResult<Project> {
  const src = findPiece(project, sourceId);
  if (!src) return err("INVALID_CUT", `Crosscut failed: piece "${sourceId}" not found.`);

  const res = crosscutBoardIntoBlocks(src, blockLength, kerf);
  if (!res.ok) return res;

  const remainingPieces = project.pieces.filter((p) => p.id !== sourceId);

  const blockIds: string[] = [];
  const blocks: Board3D[] = res.value.blocks.map((b) => {
    const id = newId("block");
    blockIds.push(id);
    return { ...b, id, isOffcut: false };
  });

  const remainderId = newId("xcRem");
  const remainderIsOffcut = res.value.remainder.lengthY < blockLength;
  const remainder: Board3D = { ...res.value.remainder, id: remainderId, isOffcut: remainderIsOffcut };

  const nextScrap = project.scrap.slice();
  const nextPieces = [...remainingPieces, ...blocks];

  if (remainderIsOffcut) nextScrap.push(remainder);
  else nextPieces.push(remainder);

  const op: CrosscutBlocksOperation = {
    id: newId("op"),
    type: "CROSSCUT_BLOCKS",
    timestamp: nowMs(),
    sourceId,
    blockLength,
    kerf,
    blockIds,
    remainderId,
    remainderIsOffcut,
  };

  return ok({
    ...project,
    pieces: nextPieces,
    scrap: nextScrap,
    operations: [...project.operations, op],
  });
}

export function performDuplicatePieces(project: Project, pieceIds: string[]): ShopResult<Project> {
  const ids = Array.from(new Set(pieceIds.filter(Boolean)));
  if (ids.length === 0) return ok(project);

  const copies: Board3D[] = [];
  const outputIds: string[] = [];

  for (const id of ids) {
    const src = findPiece(project, id);
    if (!src) return err("INVALID_CUT", `Duplicate failed: piece "${id}" not found.`);

    const outputId = newId("piece");
    outputIds.push(outputId);

    copies.push({
      ...src,
      id: outputId,
      isOffcut: false,
    });
  }

  const op: DuplicatePiecesOperation = {
    id: newId("op"),
    type: "DUPLICATE_PIECES",
    timestamp: nowMs(),
    sourceIds: ids,
    outputIds,
  };

  return ok({
    ...project,
    pieces: [...project.pieces, ...copies],
    operations: [...project.operations, op],
  });
}

export function reclaimScrapToPieces(project: Project, scrapIds: string[]): ShopResult<Project> {
  const ids = scrapIds.filter(Boolean);
  if (ids.length === 0) return ok(project);

  const reclaimed: Board3D[] = [];
  const remainingScrap: Board3D[] = [];

  for (const s of project.scrap) {
    if (ids.includes(s.id)) reclaimed.push({ ...s, isOffcut: false });
    else remainingScrap.push(s);
  }

  return ok({
    ...project,
    pieces: [...project.pieces, ...reclaimed],
    scrap: remainingScrap,
  });
}
export function performProfileCutCorners45(
  project: Project,
  sourceId: string,
  kerf: number = KERF
): ShopResult<Project> {
  const src = findPiece(project, sourceId);
  if (!src) return err("INVALID_CUT", `45° corner cut failed: piece "${sourceId}" not found.`);

  const res = profileCutCorners45(src, kerf);
  if (!res.ok) return res;

  const centerId = newId("center45");
  const center: Board3D = {
    ...res.value.center,
    id: centerId,
    isOffcut: false,
  };

  const triangleIds: string[] = [];
  const triangles: Board3D[] = res.value.triangles.map((triangle) => {
    const id = newId("tri45");
    triangleIds.push(id);

    return {
      ...triangle,
      id,
      isOffcut: false,
    };
  });

  const remainingPieces = project.pieces.filter((p) => p.id !== sourceId);

  const op: ProfileCutCorners45Operation = {
    id: newId("op"),
    type: "PROFILE_CUT_CORNERS_45",
    timestamp: nowMs(),
    sourceId,
    kerf,
    centerId,
    triangleIds,
  };

  return ok({
    ...project,
    pieces: [...remainingPieces, center, ...triangles],
    operations: [...project.operations, op],
  });
}