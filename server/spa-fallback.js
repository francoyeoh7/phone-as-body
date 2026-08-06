import path from "node:path";

export function shouldServeSpaShell(request = {}) {
  const requestPath = typeof request.path === "string" ? request.path : "";
  return request.method === "GET"
    && !requestPath.startsWith("/api/")
    && !requestPath.startsWith("/socket.io")
    && path.extname(requestPath) === "";
}
