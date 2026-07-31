import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
const server = createServer(app);
const port = Number(process.env.PORT) || 4173;

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(root, "dist", "index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({ root, server: { middlewareMode: true } });
  app.use(vite.middlewares);
}

server.listen(port, "0.0.0.0", () => {
  console.log(`Corridor 617 is running at http://localhost:${port}`);
});
