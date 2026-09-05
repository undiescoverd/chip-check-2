import type { Config } from "tailwindcss";
import { nextui } from "@nextui-org/react";

// Design tokens are the code-verified values from chipcheck_v2.md §20.
// Do not "tidy" these — Phases 3 and 4 are pixel-compared against v1.
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@nextui-org/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        canvas: "#0d1117",
        "canvas-elevated": "#161b22",
        keypad: "#21262d",
        "muted-gray": "#9aa4b2",
        "empty-muted": "#3a434f",
        preparing: "#ea9602",
        "preparing-text": "#1a1205",
        "preparing-key": "#2d2410",
        "preparing-bright": "#faab3f",
        // declared but unused in v1 — kept declared deliberately (§20)
        "preparing-muted": "#7b530c",
        ready: "#35c26d",
        "ready-text": "#06210f",
        // declared but unused in v1 — kept declared deliberately (§20)
        "ready-muted": "#216942",
      },
      fontFamily: {
        display: ["var(--font-archivo)", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  darkMode: "class",
  plugins: [nextui()],
};
export default config;
