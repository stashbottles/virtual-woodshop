import React, { useEffect, useMemo, useState } from "react";

/** -------------------- Types (Data Foundation) -------------------- */

export type GrainMode = "face" | "edge" | "end";
export type Inches = number; // internal math = decimal inches

export interface Dim3 {
  /** X = width */
  x: Inches;
  /** Y = length */
  y: Inches;
  /** Z = thickness */
  z: Inches;
}

export interface Piece {
  id: string;
  name?: string;

  dims: Dim3;

  /**
   * What grain is currently visible on the "top" face in the workbench view:
   * - face: wide face
   * - edge: narrow edge
   * - end: cross-section
   */
  grainMode: GrainMode;

  species?: "walnut" | "maple" | "cherry" | "oak" | "other";
}

/** Global kerf (material lost per cut), inches */
export const GLOBAL_KERF_IN: Inches = 0.125;

/** -------------------- Helpers: Inches -> Fractions -------------------- */

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function formatInchesAsFraction(value: Inches, denom = 64): string {
  if (!Number.isFinite(value)) return "—";

  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  // Snap near-integers to avoid 11.999999 -> 11 63/64
  const eps = 1e-6;
  const roundedToDenom = Math.round(abs * denom) / denom;
  const snapped =
    Math.abs(roundedToDenom - Math.round(roundedToDenom)) < eps
      ? Math.round(roundedToDenom)
      : roundedToDenom;

  const whole = Math.floor(snapped);
  const frac = snapped - whole;

  const numRaw = Math.round(frac * denom);

  if (numRaw === 0) return `${sign}${whole}"`;
  if (numRaw === denom) return `${sign}${whole + 1}"`;

  const d = gcd(numRaw, denom);
  const num = numRaw / d;
  const den = denom / d;

  const mixed = whole > 0 ? `${whole} ${num}/${den}` : `${num}/${den}`;
  return `${sign}${mixed}"`;
}

function clampDim(n: number): number {
  // Physical sanity: no zero/negative
  const min = 0.01;
  if (!Number.isFinite(n)) return min;
  return Math.max(min, n);
}

/** -------------------- Orientation Logic: 90° Flip -------------------- */

/**
 * Flip a board on its side (roll 90°):
 * - swaps width (X) and thickness (Z)
 * - toggles visible grain face <-> edge
 * - end stays end (end-grain needs a different rotation mode later)
 */
export function flipPiece90(piece: Piece): Piece {
  const nextGrain: GrainMode =
    piece.grainMode === "face"
      ? "edge"
      : piece.grainMode === "edge"
      ? "face"
      : "end";

  return {
    ...piece,
    dims: { x: piece.dims.z, y: piece.dims.y, z: piece.dims.x },
    grainMode: nextGrain,
  };
}

/** -------------------- Visual Material Hint (swap to textures later) -------------------- */

function woodSurfaceStyle(
  grainMode: GrainMode,
  species?: Piece["species"]
): React.CSSProperties {
  const base =
    species === "walnut"
      ? "#6b4f3a"
      : species === "maple"
      ? "#d8c7a2"
      : species === "cherry"
      ? "#a55a3a"
      : "#b08a64";

  if (grainMode === "end") {
    return {
      backgroundColor: base,
      backgroundImage:
        "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.14) 0 2px, transparent 2px 7px), " +
        "radial-gradient(circle at 70% 60%, rgba(0,0,0,0.14) 0 2px, transparent 2px 8px)",
      backgroundSize: "18px 18px",
    };
  }

  if (grainMode === "edge") {
    return {
      backgroundColor: base,
      backgroundImage:
        "repeating-linear-gradient(90deg, rgba(0,0,0,0.18) 0 2px, rgba(255,255,255,0.06) 2px 6px)",
      backgroundSize: "10px 10px",
    };
  }

  // face
  return {
    backgroundColor: base,
    backgroundImage:
      "repeating-linear-gradient(0deg, rgba(0,0,0,0.14) 0 1px, rgba(255,255,255,0.06) 1px 5px)",
    backgroundSize: "14px 14px",
  };
}

/** -------------------- Piece Component -------------------- */

export type PieceProps = {
  piece: Piece;
  isSelected: boolean;
  onSelect: (pieceId: string) => void;
  onChange: (next: Piece) => void;

  /** Visual scale for the workbench: pixels per inch */
  pxPerInch?: number;
};

export function PieceComponent({
  piece,
  isSelected,
  onSelect,
  onChange,
  pxPerInch = 18,
}: PieceProps) {
  const [xStr, setXStr] = useState(String(piece.dims.x));
  const [yStr, setYStr] = useState(String(piece.dims.y));
  const [zStr, setZStr] = useState(String(piece.dims.z));

  // keep inputs synced with parent updates
  useEffect(() => {
    setXStr(String(piece.dims.x));
    setYStr(String(piece.dims.y));
    setZStr(String(piece.dims.z));
  }, [piece.id, piece.dims.x, piece.dims.y, piece.dims.z]);

  const label = useMemo(() => {
    const L = formatInchesAsFraction(piece.dims.y);
    const W = formatInchesAsFraction(piece.dims.x);
    const T = formatInchesAsFraction(piece.dims.z);
    return `${L} × ${W} × ${T}`;
  }, [piece.dims.x, piece.dims.y, piece.dims.z]);

  const boardStyle: React.CSSProperties = {
    // length (Y) runs left-to-right on the bench
    width: Math.max(120, piece.dims.y * pxPerInch),
    // width (X) is the “front edge” thickness on screen
    height: Math.max(24, piece.dims.x * pxPerInch),
    ...woodSurfaceStyle(piece.grainMode, piece.species),
  };

  function commitDim(axis: "x" | "y" | "z", raw: string) {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return; // allow partial typing like "0."
    onChange({
      ...piece,
      dims: { ...piece.dims, [axis]: clampDim(n) },
    });
  }

  return (
    <div style={{ userSelect: "none" }}>
      <div
        style={{
          position: "relative",
          borderRadius: 16,
          border: isSelected ? "2px solid rgba(0,0,0,0.7)" : "1px solid rgba(0,0,0,0.15)",
          boxShadow: "0 1px 6px rgba(0,0,0,0.12)",
          cursor: "pointer",
          overflow: "visible",
          ...boardStyle,
        }}
        onClick={() => onSelect(piece.id)}
        role="button"
        aria-label="piece"
        title={piece.name ?? piece.id}
      >
        <div
          style={{
            position: "absolute",
            left: 8,
            top: 8,
            borderRadius: 12,
            background: "rgba(0,0,0,0.55)",
            padding: "6px 10px",
            color: "white",
            fontSize: 12,
            backdropFilter: "blur(6px)",
          }}
        >
          <div style={{ fontWeight: 700, lineHeight: 1.2 }}>
            {piece.name ?? "Piece"}
          </div>
          <div style={{ opacity: 0.9, lineHeight: 1.2 }}>{label}</div>
          <div style={{ marginTop: 4, opacity: 0.8 }}>
            {piece.grainMode.toUpperCase()}
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(piece.id);
            onChange(flipPiece90(piece));
          }}
          style={{
            position: "absolute",
            right: 8,
            top: 8,
            borderRadius: 12,
            background: "rgba(255,255,255,0.85)",
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 700,
            border: "1px solid rgba(0,0,0,0.15)",
            cursor: "pointer",
          }}
          title="Flip 90° (swap width/thickness)"
        >
          Flip 90°
        </button>
      </div>

      {isSelected && (
        <div
          style={{
            marginTop: 10,
            borderRadius: 16,
            border: "1px solid rgba(0,0,0,0.10)",
            background: "white",
            padding: 12,
            boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              Inspector{" "}
              <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.7 }}>
                (type decimal inches; display uses fractions)
              </span>
            </div>
            <button
              type="button"
              onClick={() => onChange(flipPiece90(piece))}
              style={{
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.15)",
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                background: "white",
              }}
            >
              Flip 90°
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
            <label style={{ fontSize: 12 }}>
              <div style={{ marginBottom: 6, fontWeight: 700, opacity: 0.8 }}>
                Length (Y)
              </div>
              <input
                value={yStr}
                onChange={(e) => {
                  const v = e.target.value;
                  setYStr(v);
                  commitDim("y", v);
                }}
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.15)",
                  padding: "10px 12px",
                  fontSize: 14,
                }}
                inputMode="decimal"
              />
            </label>

            <label style={{ fontSize: 12 }}>
              <div style={{ marginBottom: 6, fontWeight: 700, opacity: 0.8 }}>
                Width (X)
              </div>
              <input
                value={xStr}
                onChange={(e) => {
                  const v = e.target.value;
                  setXStr(v);
                  commitDim("x", v);
                }}
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.15)",
                  padding: "10px 12px",
                  fontSize: 14,
                }}
                inputMode="decimal"
              />
            </label>

            <label style={{ fontSize: 12 }}>
              <div style={{ marginBottom: 6, fontWeight: 700, opacity: 0.8 }}>
                Thickness (Z)
              </div>
              <input
                value={zStr}
                onChange={(e) => {
                  const v = e.target.value;
                  setZStr(v);
                  commitDim("z", v);
                }}
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.15)",
                  padding: "10px 12px",
                  fontSize: 14,
                }}
                inputMode="decimal"
              />
            </label>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            Live label: <span style={{ fontWeight: 700, opacity: 1 }}>{label}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** -------------------- Demo Parent -------------------- */

export function WorkbenchDemo() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [piece, setPiece] = useState<Piece>({
    id: "p1",
    name: "Walnut board",
    dims: { x: 1.5, y: 12, z: 0.75 },
    grainMode: "face",
    species: "walnut",
  });

  return (
    <div style={{ padding: 24 }}>
      <PieceComponent
        piece={piece}
        isSelected={selectedId === piece.id}
        onSelect={setSelectedId}
        onChange={setPiece}
        pxPerInch={20}
      />
    </div>
  );
}