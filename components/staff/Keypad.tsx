"use client";

import { Delete } from "lucide-react";
import { KEYS, pressKey } from "@/lib/orders/keypad";

/**
 * The staff keypad (§22.2), a port of v1's `Keypad.tsx`.
 *
 * Classes are verbatim from the spec — this screen is pixel-compared against v1 at four
 * widths, so do not tidy them. The only addition is `motion-reduce:transition-none`
 * (§24): the key's colour transition is the one animation on this screen.
 */

export function Keypad({
  value,
  onChange,
  maxDigits,
}: {
  value: string;
  onChange: (next: string) => void;
  maxDigits: number;
}) {
  return (
    <div className="grid grid-cols-3 grid-rows-4 gap-3 w-full sm:max-w-xs lg:max-w-none lg:flex-1 lg:min-h-0">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-label={key === "back" ? "Backspace" : key === "clear" ? "Clear" : key}
          onClick={() => onChange(pressKey(value, key, maxDigits))}
          className={`h-16 lg:h-auto lg:min-h-[3.5rem] min-w-[44px] rounded-xl font-display text-3xl lg:text-4xl font-bold transition-colors motion-reduce:transition-none active:opacity-80 ${
            key === "clear" ? "bg-preparing-key text-preparing-bright" : "bg-keypad text-white"
          }`}
        >
          {key === "back" ? (
            <Delete size={24} className="mx-auto" />
          ) : key === "clear" ? (
            "C"
          ) : (
            key
          )}
        </button>
      ))}
    </div>
  );
}
