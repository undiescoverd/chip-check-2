/**
 * The keypad's press rules (§22.2), kept out of the component for the same reason as
 * every other rule in this directory: a `.tsx` file cannot be imported by the unit
 * suite (Next needs `jsx: "preserve"`), and the digit cap is per shop, so it is worth a
 * test of its own rather than a Playwright assertion at the far end of a browser.
 */

export const KEYS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "clear",
  "0",
  "back",
] as const;

export type KeypadKey = (typeof KEYS)[number];

export function pressKey(value: string, key: KeypadKey, maxDigits: number): string {
  if (key === "back") return value.slice(0, -1);
  if (key === "clear") return "";
  return (value + key).slice(0, maxDigits);
}
