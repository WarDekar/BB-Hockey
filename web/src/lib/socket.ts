import { io, type Socket } from "socket.io-client";
import { BASE } from "./api";

let sock: Socket | null = null;
export function socket(): Socket {
  if (!sock) sock = io({ path: `${BASE}socket.io`, transports: ["websocket", "polling"] });
  return sock;
}
