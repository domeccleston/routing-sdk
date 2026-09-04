import { fileURLToPath } from "node:url";

/** Local dashboard assets. The host supplies submission reads and protected workflow actions. */
export function dashboardAsset(pathname: string): string | null {
  const files: Record<string, string> = {
    "/admin": "index.html",
    "/admin/": "index.html",
    "/admin/dashboard.css": "dashboard.css",
    "/admin/dashboard.js": "dashboard.js",
    "/admin/workflow-panel.js": "workflow-panel.js",
    "/admin/pools": "pools.html",
    "/admin/pools/": "pools.html",
    "/admin/pools.js": "pools.js",
    "/admin/analytics": "analytics.html",
    "/admin/analytics/": "analytics.html",
    "/admin/analytics.js": "analytics.js",
  };
  const filename = files[pathname];
  return filename ? fileURLToPath(new URL(`../public/${filename}`, import.meta.url)) : null;
}
