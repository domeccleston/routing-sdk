import { fileURLToPath } from "node:url";

/** Read-only local dashboard assets. The host supplies GET /admin/api/submissions. */
export function dashboardAsset(pathname: string): string | null {
  const files: Record<string, string> = {
    "/admin": "index.html",
    "/admin/": "index.html",
    "/admin/dashboard.css": "dashboard.css",
    "/admin/dashboard.js": "dashboard.js",
  };
  const filename = files[pathname];
  return filename ? fileURLToPath(new URL(`../public/${filename}`, import.meta.url)) : null;
}
