// Score pop-ups drawn to a canvas texture, in the style's own idiom: a gold
// coin (tabletop), a comic burst (cartoon) or a soft bubble (diorama).
import * as THREE from "three/webgpu";
import type { StylePopups } from "./styles";

function burst(ctx: CanvasRenderingContext2D, cx: number, cy: number, r0: number, r1: number, n: number): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? r1 : r0;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function popupTexture(style: StylePopups, points: number, playerColor: string | null): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const S = 256;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const c = S / 2;
  ctx.lineJoin = "round";
  if (style.kind === "comic") {
    burst(ctx, c, c, S * 0.3, S * 0.47, 11);
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = style.stroke;
    ctx.stroke();
  } else if (style.kind === "coin") {
    ctx.beginPath();
    ctx.arc(c, c, S * 0.4, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(c - 30, c - 30, 10, c, c, S * 0.42);
    g.addColorStop(0, "#fff3b8");
    g.addColorStop(1, style.fill);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = style.stroke;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c, S * 0.32, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(c, c, S * 0.44, S * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = style.fill;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 5;
    ctx.strokeStyle = style.stroke;
    ctx.stroke();
  }
  if (playerColor) {
    ctx.beginPath();
    ctx.arc(c, S * 0.85, 13, 0, Math.PI * 2);
    ctx.fillStyle = playerColor;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = style.stroke;
    ctx.stroke();
  }
  ctx.font = style.font.replace(/\d+px/, `${points >= 100 ? 64 : 84}px`);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const txt = `+${points}`;
  if (style.kind === "comic") {
    ctx.lineWidth = 12;
    ctx.strokeStyle = style.stroke;
    ctx.strokeText(txt, c, c + 4);
  }
  ctx.fillStyle = style.text;
  ctx.fillText(txt, c, c + 4);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
