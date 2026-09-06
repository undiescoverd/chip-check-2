"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Settings } from "@/lib/types";

/**
 * The resolved shop, shared by every screen under `/{slug}` (§21).
 *
 * Public fields only — see the note in `layout.tsx`. Phases 3 and 4 read `shopId` for
 * the `onSnapshot` query, `name` for the headers and `settings` for the digit rule and
 * ready timeout.
 */
export interface ShopContext {
  shopId: string;
  slug: string;
  name: string;
  settings: Settings;
}

const Context = createContext<ShopContext | null>(null);

export function ShopProvider({
  value,
  children,
}: {
  value: ShopContext;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useShop(): ShopContext {
  const shop = useContext(Context);
  // A screen under /{slug} without the layout would be a wiring mistake, not a runtime
  // condition to handle gracefully.
  if (!shop) throw new Error("useShop must be used inside app/[slug]/layout.tsx");
  return shop;
}
