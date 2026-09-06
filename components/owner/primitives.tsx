import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Owner-screen primitives (§22.4), verbatim from the spec's class table.
 *
 * Plain Tailwind, deliberately not NextUI — §22.4 says so explicitly, so the owner
 * screens read as the same object as the shop screens rather than as an admin panel
 * bolted on beside them. NextUI is reserved for Alert, Button, Modal and Spinner inside
 * the console and display (§20).
 *
 * Do not "tidy" these classes: Phases 3 and 4 are pixel-compared against v1, and these
 * are the same tokens.
 */

export function Page({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-canvas text-white p-4 md:p-8 flex flex-col items-center">
      <div className="w-full max-w-lg flex flex-col gap-6">{children}</div>
    </main>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-display text-2xl sm:text-3xl font-extrabold uppercase tracking-wide">
      {children}
    </h1>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-display text-xs font-extrabold uppercase tracking-wider text-muted-gray">
      {children}
    </span>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-canvas-elevated p-6 flex flex-col gap-4">{children}</div>;
}

export const inputClasses =
  "h-14 w-full rounded-2xl bg-canvas-elevated px-4 font-display text-lg font-bold text-white " +
  "placeholder:font-sans placeholder:font-normal placeholder:text-muted-gray outline-none " +
  "focus:ring-2 focus:ring-white/20";

/** Same input, centred tabular numerals (§22.4 "Number stepper"). */
export const stepperClasses = `${inputClasses} tabular-nums text-center`;

export function TextInput(props: ComponentProps<"input">) {
  return <input {...props} className={`${inputClasses} ${props.className ?? ""}`} />;
}

export function NumberInput(props: ComponentProps<"input">) {
  return (
    <input
      inputMode="numeric"
      {...props}
      className={`${stepperClasses} ${props.className ?? ""}`}
    />
  );
}

const primaryClasses =
  "h-14 rounded-2xl bg-white text-canvas font-display text-lg font-extrabold uppercase " +
  "tracking-wide disabled:opacity-40 flex items-center justify-center";

const secondaryClasses =
  "h-14 rounded-2xl bg-canvas-elevated text-white font-display text-lg font-extrabold " +
  "uppercase tracking-wide disabled:opacity-40 flex items-center justify-center";

export function PrimaryButton(props: ComponentProps<"button">) {
  return <button {...props} className={`${primaryClasses} ${props.className ?? ""}`} />;
}

export function SecondaryButton(props: ComponentProps<"button">) {
  return <button {...props} className={`${secondaryClasses} ${props.className ?? ""}`} />;
}

export function PrimaryLink({
  href,
  children,
  ...rest
}: { href: string; children: ReactNode } & Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <Link href={href} {...rest} className={primaryClasses}>
      {children}
    </Link>
  );
}

export function SecondaryLink({
  href,
  children,
  external,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
}) {
  // The Display/Staff/QR links open the kiosk screens, which owners usually want in a
  // second tab rather than in place of their settings.
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={secondaryClasses}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={secondaryClasses}>
      {children}
    </Link>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="font-display text-sm font-bold text-preparing-bright">
      {children}
    </p>
  );
}

export function HelpText({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-gray">{children}</p>;
}

/**
 * §22.4: NextUI's `Switch` is explicitly not used. A `button role="switch"` carries the
 * same semantics for assistive tech and keyboards without importing a component whose
 * styling would fight the tokens.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-sm text-white">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`h-8 w-14 rounded-full shrink-0 transition-colors disabled:opacity-40 ${
          checked ? "bg-ready" : "bg-keypad"
        }`}
      >
        <span
          className={`block h-6 w-6 rounded-full bg-white transition-transform ${
            checked ? "translate-x-7" : "translate-x-1"
          }`}
        />
      </button>
    </label>
  );
}
