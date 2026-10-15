import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Path-routing contract (Brandos-World/PORTS.md, slot 18): base matches the
// gateway prefix, API and socket paths are built on import.meta.env.BASE_URL,
// strictPort so a collision fails loudly. The gateway block is `handle
// /hockey/*` → :3018 (this server), which proxies the API and Socket.IO to the
// FastAPI on :5018. Preview inherits server.proxy, so it is declared once.
const proxy = {
  "/hockey/api": { target: "http://127.0.0.1:5018", changeOrigin: true },
  "/hockey/socket.io": { target: "http://127.0.0.1:5018", changeOrigin: true, ws: true },
};

export default defineConfig({
  base: "/hockey/",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "root-redirect",
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/") {
            res.statusCode = 302;
            res.setHeader("Location", "/hockey/");
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  server: { port: 3018, strictPort: true, proxy },
  preview: { host: true, port: 3018, strictPort: true, proxy },
  build: { outDir: "dist", sourcemap: true },
});
