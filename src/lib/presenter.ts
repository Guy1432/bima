import { create } from "zustand";
import { EV, send } from "./events";

export type ToolMode = "none" | "laser" | "spotlight" | "zoom" | "pen";

export interface Stroke {
  color: string;
  width: number; // in normalized units (fraction of stage width × 1000)
  pts: [number, number][]; // normalized 0..1
}

/** Broadcast to the projector (and mirrored on the operator monitor). */
export interface PresenterState {
  mode: ToolMode;
  x: number;
  y: number;
  active: boolean; // pointer is over the stage
  zoom: number;
  zoomLocked: boolean;
  radius: number; // spotlight radius, fraction of width
  color: string;
  strokes: Stroke[];
}

export const PEN_COLORS = ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#ffffff", "#0a0a0a"];

export const initialPresenter: PresenterState = {
  mode: "none",
  x: 0.5,
  y: 0.5,
  active: false,
  zoom: 2,
  zoomLocked: false,
  radius: 0.14,
  color: "#ef4444",
  strokes: [],
};

export const usePresenter = create<PresenterState>(() => ({ ...initialPresenter }));

// One broadcast per animation frame, however fast the mouse moves.
let raf = 0;
export function broadcastPresenter() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    send(EV.presenter, usePresenter.getState());
  });
}

export function setPresenter(p: Partial<PresenterState>) {
  usePresenter.setState(p);
  broadcastPresenter();
}

export function clearInk() {
  setPresenter({ strokes: [] });
}
