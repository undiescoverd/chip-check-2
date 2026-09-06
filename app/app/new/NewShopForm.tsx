"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Card,
  HelpText,
  InlineError,
  NumberInput,
  Page,
  PageTitle,
  PrimaryButton,
  SectionLabel,
  TextInput,
  Toggle,
} from "@/components/owner/primitives";
import { slugifyName } from "@/lib/slugs";

/**
 * `/app/new` (§22.4, §8).
 *
 * The slug field checks availability against `GET /api/slugs/{slug}`, debounced 400 ms
 * as §22.4 specifies. That check is advisory: the authoritative answer comes from the
 * creation transaction, which claims `slugs/{slug}` atomically — between typing and
 * submitting, someone else can take it, and only the transaction can settle that.
 */

type Availability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "unavailable"; reason: "taken" | "reserved" | "invalid" };

const REASON_COPY: Record<"taken" | "reserved" | "invalid", string> = {
  taken: "Taken",
  reserved: "Reserved",
  // §23 has no copy for a malformed slug; the field rules are stated in the help text.
  invalid: "Use lowercase letters, numbers and single hyphens",
};

const ERROR_COPY: Record<string, string> = {
  slug_taken: "Taken",
  slug_reserved: "Reserved",
  invalid_body: "Something went wrong",
  invalid_json: "Something went wrong",
  unauthorized: "Please sign in again",
};

export function NewShopForm({ siteUrl }: { siteUrl: string }) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Once the owner edits the slug we stop overwriting it from the name (§5: "Owner can
  // edit before submitting").
  const [slugEdited, setSlugEdited] = useState(false);
  const [minDigits, setMinDigits] = useState(1);
  const [maxDigits, setMaxDigits] = useState(4);
  const [readyTimeout, setReadyTimeout] = useState(300);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const [availability, setAvailability] = useState<Availability>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSlug = slugEdited ? slug : slugifyName(name);

  // Guards against a slow earlier response landing after a faster later one.
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!effectiveSlug) {
      setAvailability({ state: "idle" });
      return;
    }

    setAvailability({ state: "checking" });
    const seq = ++requestSeq.current;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/slugs/${encodeURIComponent(effectiveSlug)}`);
        const body = await res.json();
        if (seq !== requestSeq.current) return;

        setAvailability(
          body.available
            ? { state: "available" }
            : { state: "unavailable", reason: body.reason ?? "invalid" },
        );
      } catch {
        if (seq === requestSeq.current) setAvailability({ state: "idle" });
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [effectiveSlug]);

  const pinsMatch = pin === confirmPin;
  const pinValid = /^\d{4,8}$/.test(pin);
  const digitsValid = maxDigits >= minDigits;

  const canSubmit =
    name.trim().length > 0 &&
    effectiveSlug.length > 0 &&
    availability.state === "available" &&
    pinValid &&
    pinsMatch &&
    digitsValid &&
    !submitting;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/shops", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: effectiveSlug,
          settings: {
            ticketMinDigits: minDigits,
            ticketMaxDigits: maxDigits,
            readyTimeoutSeconds: readyTimeout,
            soundEnabled,
            // §8: the browser knows its own zone; it is only used for a clock label.
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London",
          },
          pin,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(ERROR_COPY[body.error] ?? "Something went wrong");
        setSubmitting(false);
        return;
      }

      const { shop } = await res.json();
      router.replace(`/app/${shop.slug}`);
      router.refresh();
    } catch {
      setError("Couldn't reach the server");
      setSubmitting(false);
    }
  }

  return (
    <Page>
      <PageTitle>New shop</PageTitle>

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <Card>
          <SectionLabel>Shop name</SectionLabel>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Two Little Fish"
            maxLength={60}
            autoFocus
            required
          />

          <SectionLabel>URL</SectionLabel>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-gray whitespace-nowrap">{siteUrl}/</span>
            <TextInput
              value={effectiveSlug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value.toLowerCase());
              }}
              placeholder="two-little-fish"
              maxLength={40}
            />
          </div>
          {availability.state === "available" ? (
            <p className="font-display text-sm font-bold text-ready">Available</p>
          ) : availability.state === "unavailable" ? (
            <InlineError>{REASON_COPY[availability.reason]}</InlineError>
          ) : null}
        </Card>

        <Card>
          <SectionLabel>Ticket numbers</SectionLabel>
          <div className="flex gap-4">
            <label className="flex-1 flex flex-col gap-2">
              <span className="text-sm text-muted-gray">Shortest</span>
              <NumberInput
                type="number"
                min={1}
                max={6}
                value={minDigits}
                onChange={(e) => setMinDigits(Number(e.target.value))}
              />
            </label>
            <label className="flex-1 flex flex-col gap-2">
              <span className="text-sm text-muted-gray">Longest</span>
              <NumberInput
                type="number"
                min={1}
                max={6}
                value={maxDigits}
                onChange={(e) => setMaxDigits(Number(e.target.value))}
              />
            </label>
          </div>
          <HelpText>Most shops use 1–4 digits. Pager numbers are usually 1–3.</HelpText>
          {!digitsValid ? <InlineError>Longest must be at least Shortest</InlineError> : null}

          <SectionLabel>Ready timeout (seconds)</SectionLabel>
          <NumberInput
            type="number"
            min={30}
            max={3600}
            value={readyTimeout}
            onChange={(e) => setReadyTimeout(Number(e.target.value))}
          />
          <HelpText>How long a ready number stays on the TV.</HelpText>

          <Toggle
            checked={soundEnabled}
            onChange={setSoundEnabled}
            label="Play a sound when an order is ready"
          />
        </Card>

        <Card>
          <SectionLabel>Staff PIN</SectionLabel>
          <TextInput
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="4–8 digits"
            maxLength={8}
            required
          />
          <SectionLabel>Confirm PIN</SectionLabel>
          <TextInput
            type="password"
            inputMode="numeric"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            maxLength={8}
            required
          />
          {pin && !pinValid ? <InlineError>PIN must be 4–8 digits</InlineError> : null}
          {confirmPin && !pinsMatch ? <InlineError>PINs don&apos;t match</InlineError> : null}
        </Card>

        <PrimaryButton type="submit" disabled={!canSubmit}>
          Create shop
        </PrimaryButton>
        <InlineError>{error}</InlineError>
      </form>
    </Page>
  );
}
