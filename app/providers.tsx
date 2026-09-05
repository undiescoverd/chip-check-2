"use client";

import { NextUIProvider } from "@nextui-org/react";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <NextUIProvider>{children}</NextUIProvider>;
}
