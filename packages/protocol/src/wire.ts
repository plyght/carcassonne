// Client <-> server WebSocket messages. JSON objects with a `t` discriminator.
import type { EngineEvent, GameView, Move, PlayerIndex } from "./engine";

export type ClientMessage =
  | { t: "hello"; gameId: string; lastPly: number }
  | { t: "intent"; gameId: string; ply: number; move: Move }
  | { t: "react"; gameId: string; emoji: string }
  | { t: "ping" };

export interface PresenceEntry {
  player: PlayerIndex;
  userId: string | null;
  name: string;
  connected: boolean;
}

export type ServerMessage =
  | { t: "welcome"; gameId: string; view: GameView; ply: number; seat: PlayerIndex | null }
  | { t: "events"; gameId: string; fromPly: number; toPly: number; events: EngineEvent[] }
  | { t: "rejected"; gameId: string; ply: number; error: string }
  | { t: "reaction"; gameId: string; player: PlayerIndex | null; emoji: string }
  | { t: "presence"; gameId: string; players: PresenceEntry[] }
  | { t: "clock"; gameId: string; ply: number; deadline: number | null }
  | { t: "pong" };

/** Curated emoji set for reactions (PRD §6.8). */
export const REACTIONS = [
  "👍", "👏", "😂", "😮", "😱", "😭", "😡", "🤔", "😎", "🙏", "🔥", "💀",
  "🎉", "❤️", "👀", "🤝", "😴", "🫡", "🏰", "🐑", "🛣️", "⛪", "🌾", "💰",
] as const;
