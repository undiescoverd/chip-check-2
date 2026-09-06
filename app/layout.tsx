import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Chip Check",
  description: "Real-time order queue display",
};

/**
 * §24: `viewport-fit=cover` lets the kiosk screens paint under a notch and under the
 * home indicator; the `.safe-pad` utilities in `globals.css` are what keep content out
 * from under them. Without the cover setting those insets are always zero and the fix is
 * silently inert, which is why the two ship together.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={archivo.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
