// src/workflowEngine.ts
import type {
    Board3D,
    CrosscutBlocksResult,
    GlueUpResult,
    RipStripsResult,
    ShopResult,
  } from "./shopEngine";
  import {
    crosscutBoardIntoBlocks,
    glueUpBoards,
    KERF,
    ripBoardIntoStrips,
  } from "./shopEngine";
  import type { GlueUpRequest, Project } from "./projectEngine";
  
  export type WorkspaceStage = "EXPLORE" | "REFINE" | "EXECUTE";
  
  export interface ProjectSnapshot {
    id: string;
    name: string;
    createdAt: number;
    project: Project;
  }
  
  export interface RipOptionSuggestion {
    stripWidth: number;
    stripCount: number;
    effectivePieceCount: number;
    remainderWidth: number;
    remainderMatchesStripWidth: boolean;
  }
  
  export interface CrosscutOptionSuggestion {
    blockLength: number;
    blockCount: number;
    effectivePieceCount: number;
    remainderLength: number;
    remainderMatchesBlockLength: boolean;
  }
  
  function ok<T>(value: T): ShopResult<T> {
    return { ok: true, value };
  }
  
  function err<T = never>(message: string): ShopResult<T> {
    return { ok: false, code: "INVALID_CUT", message };
  }
  
  function newId(prefix: string) {
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid ? `${prefix}:${uuid}` : `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  }
  
  function nearlyEqual(a: number, b: number, tol: number = 1e-4): boolean {
    return Math.abs(a - b) <= tol;
  }
  
  function findPiece(project: Project, id: string): Board3D | undefined {
    return project.pieces.find((p) => p.id === id);
  }
  
  function deepCloneProject(project: Project): Project {
    return JSON.parse(JSON.stringify(project)) as Project;
  }
  
  export function previewGlueUp(project: Project, request: GlueUpRequest): ShopResult<GlueUpResult> {
    const ids = Array.from(new Set(request.pieceIds.filter(Boolean)));
    if (ids.length < 2) {
      return err("Preview glue-up requires at least 2 selected pieces.");
    }
  
    const boards: Board3D[] = [];
    for (const id of ids) {
      const piece = findPiece(project, id);
      if (!piece) {
        return err(`Preview glue-up failed: piece "${id}" not found in project.pieces.`);
      }
      boards.push(piece);
    }
  
    return glueUpBoards({
      boards,
      orientation: request.orientation,
      allowProud: request.allowProud,
    });
  }
  
  export function previewRipStrips(
    project: Project,
    sourceId: string,
    stripWidth: number,
    kerf: number = KERF
  ): ShopResult<RipStripsResult> {
    const piece = findPiece(project, sourceId);
    if (!piece) {
      return err(`Preview rip failed: piece "${sourceId}" not found in project.pieces.`);
    }
  
    return ripBoardIntoStrips(piece, stripWidth, kerf);
  }
  
  export function previewCrosscutBlocks(
    project: Project,
    sourceId: string,
    blockLength: number,
    kerf: number = KERF
  ): ShopResult<CrosscutBlocksResult> {
    const piece = findPiece(project, sourceId);
    if (!piece) {
      return err(`Preview crosscut failed: piece "${sourceId}" not found in project.pieces.`);
    }
  
    return crosscutBoardIntoBlocks(piece, blockLength, kerf);
  }
  
  export function getRipSuggestions(
    project: Project,
    sourceId: string,
    candidateWidths: number[],
    kerf: number = KERF
  ): RipOptionSuggestion[] {
    const uniqueWidths = Array.from(
      new Set(candidateWidths.filter((n) => Number.isFinite(n) && n > 0))
    ).sort((a, b) => a - b);
  
    const suggestions: RipOptionSuggestion[] = [];
  
    for (const stripWidth of uniqueWidths) {
      const preview = previewRipStrips(project, sourceId, stripWidth, kerf);
      if (!preview.ok) continue;
  
      const remainderMatchesStripWidth = nearlyEqual(preview.value.remainder.widthX, stripWidth);
  
      suggestions.push({
        stripWidth,
        stripCount: preview.value.strips.length,
        effectivePieceCount: preview.value.strips.length + (remainderMatchesStripWidth ? 1 : 0),
        remainderWidth: preview.value.remainder.widthX,
        remainderMatchesStripWidth,
      });
    }
  
    return suggestions.sort((a, b) => {
      if (a.remainderWidth !== b.remainderWidth) return a.remainderWidth - b.remainderWidth;
      if (a.effectivePieceCount !== b.effectivePieceCount) return b.effectivePieceCount - a.effectivePieceCount;
      return a.stripWidth - b.stripWidth;
    });
  }
  
  export function getCrosscutSuggestions(
    project: Project,
    sourceId: string,
    candidateLengths: number[],
    kerf: number = KERF
  ): CrosscutOptionSuggestion[] {
    const uniqueLengths = Array.from(
      new Set(candidateLengths.filter((n) => Number.isFinite(n) && n > 0))
    ).sort((a, b) => a - b);
  
    const suggestions: CrosscutOptionSuggestion[] = [];
  
    for (const blockLength of uniqueLengths) {
      const preview = previewCrosscutBlocks(project, sourceId, blockLength, kerf);
      if (!preview.ok) continue;
  
      const remainderMatchesBlockLength = nearlyEqual(preview.value.remainder.lengthY, blockLength);
  
      suggestions.push({
        blockLength,
        blockCount: preview.value.blocks.length,
        effectivePieceCount: preview.value.blocks.length + (remainderMatchesBlockLength ? 1 : 0),
        remainderLength: preview.value.remainder.lengthY,
        remainderMatchesBlockLength,
      });
    }
  
    return suggestions.sort((a, b) => {
      if (a.remainderLength !== b.remainderLength) return a.remainderLength - b.remainderLength;
      if (a.effectivePieceCount !== b.effectivePieceCount) return b.effectivePieceCount - a.effectivePieceCount;
      return a.blockLength - b.blockLength;
    });
  }
  
  export function createSnapshot(project: Project, name: string): ProjectSnapshot {
    return {
      id: newId("snapshot"),
      name,
      createdAt: Date.now(),
      project: deepCloneProject(project),
    };
  }
  
  export function restoreSnapshot(snapshot: ProjectSnapshot): Project {
    return deepCloneProject(snapshot.project);
  }