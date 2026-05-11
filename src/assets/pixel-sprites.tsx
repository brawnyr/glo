import { CSSProperties } from "react";

const crisp: CSSProperties = {
  imageRendering: "pixelated",
  shapeRendering: "crispEdges",
};

type SpriteProps = {
  size?: number;
  className?: string;
};

export function MugSprite({ size = 32, className }: SpriteProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      style={crisp}
    >
      {/* steam */}
      <g className="steam">
        <rect x="5" y="2" width="1" height="2" fill="#e8d4b0" />
      </g>
      <g className="steam s2">
        <rect x="7" y="1" width="1" height="2" fill="#e8d4b0" />
      </g>
      <g className="steam s3">
        <rect x="9" y="3" width="1" height="2" fill="#e8d4b0" />
      </g>
      {/* mug */}
      <rect x="3" y="6" width="9" height="8" fill="#f4e8d0" />
      <rect x="3" y="6" width="9" height="1" fill="#3a2a1c" />
      <rect x="3" y="7" width="9" height="1" fill="#241a14" />
      <rect x="4" y="8" width="7" height="1" fill="#d97f3c" />
      <rect x="3" y="13" width="9" height="1" fill="#c5a26a" />
      {/* handle */}
      <rect x="12" y="8" width="2" height="4" fill="#f4e8d0" />
      <rect x="13" y="9" width="1" height="2" fill="#1a1410" />
      {/* saucer */}
      <rect x="2" y="14" width="11" height="1" fill="#c5a26a" />
      <rect x="2" y="15" width="11" height="1" fill="#8a4a1f" />
    </svg>
  );
}

export function VinylSprite({ size = 64, className, spinning = false }: SpriteProps & { spinning?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      style={crisp}
    >
      <g className={spinning ? "vinyl-spin" : undefined} style={{ transformOrigin: "50% 50%" }}>
        {/* outer */}
        <rect x="3" y="1" width="10" height="1" fill="#0f0a07" />
        <rect x="2" y="2" width="12" height="1" fill="#0f0a07" />
        <rect x="1" y="3" width="14" height="10" fill="#0f0a07" />
        <rect x="2" y="13" width="12" height="1" fill="#0f0a07" />
        <rect x="3" y="14" width="10" height="1" fill="#0f0a07" />
        {/* grooves */}
        <rect x="2" y="5" width="12" height="1" fill="#241a14" opacity="0.6" />
        <rect x="2" y="10" width="12" height="1" fill="#241a14" opacity="0.6" />
        <rect x="1" y="7" width="14" height="1" fill="#241a14" opacity="0.4" />
        {/* label */}
        <rect x="6" y="6" width="4" height="4" fill="#d97f3c" />
        <rect x="7" y="7" width="2" height="2" fill="#0f0a07" />
        {/* highlight */}
        <rect x="4" y="3" width="2" height="1" fill="#3a2a1c" />
        <rect x="3" y="4" width="1" height="2" fill="#3a2a1c" />
      </g>
    </svg>
  );
}

export function SignalSprite({ size = 16, level = 3, className }: SpriteProps & { level?: 0 | 1 | 2 | 3 | 4 }) {
  const colors = ["#3a2a1c", "#3a2a1c", "#3a2a1c", "#3a2a1c"];
  for (let i = 0; i < level; i++) colors[i] = "#7fb069";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} style={crisp}>
      <rect x="2" y="11" width="2" height="3" fill={colors[0]} />
      <rect x="6" y="8" width="2" height="6" fill={colors[1]} />
      <rect x="10" y="5" width="2" height="9" fill={colors[2]} />
      <rect x="14" y="2" width="2" height="12" fill={colors[3]} />
    </svg>
  );
}

export function CassetteSprite({ size = 32, className }: SpriteProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} style={crisp}>
      <rect x="1" y="4" width="14" height="9" fill="#2e2218" />
      <rect x="1" y="4" width="14" height="1" fill="#3a2a1c" />
      <rect x="1" y="12" width="14" height="1" fill="#0f0a07" />
      <rect x="2" y="6" width="12" height="3" fill="#f4e8d0" />
      <rect x="2" y="6" width="12" height="1" fill="#c5a26a" />
      <rect x="4" y="10" width="3" height="2" fill="#0f0a07" />
      <rect x="9" y="10" width="3" height="2" fill="#0f0a07" />
      <rect x="5" y="10" width="1" height="2" fill="#d97f3c" />
      <rect x="10" y="10" width="1" height="2" fill="#d97f3c" />
    </svg>
  );
}

export function PlaySprite({ size = 24, className }: SpriteProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} style={crisp}>
      <rect x="4" y="3" width="2" height="10" fill="currentColor" />
      <rect x="6" y="5" width="2" height="6" fill="currentColor" />
      <rect x="8" y="6" width="2" height="4" fill="currentColor" />
      <rect x="10" y="7" width="2" height="2" fill="currentColor" />
    </svg>
  );
}

export function PauseSprite({ size = 24, className }: SpriteProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} style={crisp}>
      <rect x="4" y="3" width="3" height="10" fill="currentColor" />
      <rect x="9" y="3" width="3" height="10" fill="currentColor" />
    </svg>
  );
}

export function TrashSprite({ size = 18, className }: SpriteProps) {
  const c = "#e89556";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} style={crisp}>
      {/* lid */}
      <rect x="4" y="2" width="8" height="1" fill={c} />
      <rect x="2" y="3" width="12" height="2" fill={c} />
      {/* body */}
      <rect x="3" y="5" width="10" height="9" fill={c} />
      <rect x="3" y="14" width="10" height="1" fill="#8a4a1f" />
      {/* vertical stripes (cutouts) */}
      <rect x="5" y="7" width="1" height="6" fill="#1a1410" />
      <rect x="8" y="7" width="1" height="6" fill="#1a1410" />
      <rect x="11" y="7" width="1" height="6" fill="#1a1410" />
    </svg>
  );
}

export function HeartSprite({ size = 16, filled = false, className }: SpriteProps & { filled?: boolean }) {
  const c = filled ? "#d97f3c" : "#c5a26a";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} style={crisp}>
      <rect x="3" y="4" width="2" height="2" fill={c} />
      <rect x="5" y="3" width="2" height="2" fill={c} />
      <rect x="9" y="3" width="2" height="2" fill={c} />
      <rect x="11" y="4" width="2" height="2" fill={c} />
      <rect x="2" y="5" width="12" height="2" fill={c} />
      <rect x="3" y="7" width="10" height="2" fill={c} />
      <rect x="4" y="9" width="8" height="1" fill={c} />
      <rect x="5" y="10" width="6" height="1" fill={c} />
      <rect x="6" y="11" width="4" height="1" fill={c} />
      <rect x="7" y="12" width="2" height="1" fill={c} />
    </svg>
  );
}
