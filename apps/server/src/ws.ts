// Bun WebSocket glue → GameHub. On Vercel the `drain` handler is never invoked and `send()` does not
// report backpressure (https://vercel.com/docs/functions/websockets#bun), so we rely on neither.
import type { ServerWebSocket, WebSocketHandler } from "bun";

import type { Identity } from "@carcassonne/api/identity";
import type { Conn } from "@carcassonne/api/realtime/hub";

import type { Services } from "./services";

export interface WsData {
  connId: string;
  identity: Identity | null;
  conn: Conn | null;
}

function connOf(ws: ServerWebSocket<WsData>): Conn {
  ws.data.conn ??= {
    id: ws.data.connId,
    send: (data) => void ws.send(data),
    close: (code, reason) => ws.close(code, reason),
  };
  return ws.data.conn;
}

export function createWebSocketHandler(services: Services): WebSocketHandler<WsData> {
  return {
    // Clients ping every ~20 s; Vercel closes the socket at the function max duration (300 s on
    // Hobby), and clients open a new one with `hello{lastPly}` at ~280 s.
    idleTimeout: 120,
    maxPayloadLength: 16 * 1024,
    open(ws) {
      services.hub().open(connOf(ws), ws.data.identity);
    },
    message(ws, message) {
      void services.hub().message(connOf(ws), message);
    },
    close(ws) {
      void services.hub().close(connOf(ws));
    },
  };
}
