import type { MetadataRoute } from "next";

/**
 * PWA manifest (§24). Lets the display and staff pages be added to a TV browser's or a
 * tablet's home screen — there is no offline requirement (Firestore handles transient
 * loss, §11), so no service worker.
 *
 * Icons are a flat amber placeholder (`scripts` history: hand-encoded PNGs, see
 * `public/icon-192.png` / `public/icon-512.png`) until the real logo lands — tracked in
 * PROGRESS.md rather than blocking this phase on branding.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chip Check",
    short_name: "Chip Check",
    start_url: "/",
    display: "standalone",
    background_color: "#0d1117",
    theme_color: "#0d1117",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
