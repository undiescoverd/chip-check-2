"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Card,
  HelpText,
  InlineError,
  NumberInput,
  Page,
  PageTitle,
  PrimaryButton,
  SecondaryLink,
  SectionLabel,
  TextInput,
  Toggle,
} from "@/components/owner/primitives";
import type { Shop } from "@/lib/types";

/**
 * `/app/{slug}` (§22.4): links, settings, PIN rotation, and the kiosk pointer.
 *
 * The plan card (§18) is deliberately absent — it only appears when billing is on, and
 * billing is Phase 5.
 */
export function ShopSettings({ shop, siteUrl }: { shop: Shop; siteUrl: string }) {
  const displayUrl = `${siteUrl}/${shop.slug}/display`;

  const [name, setName] = useState(shop.name);
  const [minDigits, setMinDigits] = useState(shop.settings.ticketMinDigits);
  const [maxDigits, setMaxDigits] = useState(shop.settings.ticketMaxDigits);
  const [readyTimeout, setReadyTimeout] = useState(shop.settings.readyTimeoutSeconds);
  const [soundEnabled, setSoundEnabled] = useState(shop.settings.soundEnabled);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinSaved, setPinSaved] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const digitsValid = maxDigits >= minDigits;
  const pinValid = /^\d{4,8}$/.test(pin);
  const pinsMatch = pin === confirmPin;

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    setSettingsError(null);
    setSaved(false);
    setSaving(true);

    try {
      const res = await fetch(`/api/shops/${shop.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          settings: {
            ticketMinDigits: minDigits,
            ticketMaxDigits: maxDigits,
            readyTimeoutSeconds: readyTimeout,
            soundEnabled,
          },
        }),
      });

      if (!res.ok) {
        setSettingsError("Something went wrong");
      } else {
        setSaved(true);
      }
    } catch {
      setSettingsError("Couldn't reach the server");
    } finally {
      setSaving(false);
    }
  }

  async function changePin(event: React.FormEvent) {
    event.preventDefault();
    setPinError(null);
    setPinSaved(false);
    setPinSaving(true);

    try {
      const res = await fetch(`/api/shops/${shop.id}/pin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      if (!res.ok) {
        setPinError("Something went wrong");
      } else {
        setPinSaved(true);
        setPin("");
        setConfirmPin("");
      }
    } catch {
      setPinError("Couldn't reach the server");
    } finally {
      setPinSaving(false);
    }
  }

  return (
    <Page>
      <PageTitle>{shop.name}</PageTitle>

      <Card>
        <SectionLabel>Links</SectionLabel>
        <SecondaryLink href={`/${shop.slug}/display`} external>
          Open Display
        </SecondaryLink>
        <SecondaryLink href={`/${shop.slug}/staff`} external>
          Open Staff
        </SecondaryLink>
        <SecondaryLink href={`/${shop.slug}/qr`} external>
          Print QR
        </SecondaryLink>
        <HelpText>{displayUrl}</HelpText>
      </Card>

      <form onSubmit={saveSettings}>
        <Card>
          <SectionLabel>Shop name</SectionLabel>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
          />

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

          <PrimaryButton type="submit" disabled={saving || !digitsValid}>
            {saved ? "Saved" : "Save"}
          </PrimaryButton>
          <InlineError>{settingsError}</InlineError>
        </Card>
      </form>

      <form onSubmit={changePin}>
        <Card>
          <SectionLabel>Staff PIN</SectionLabel>
          <TextInput
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="4–8 digits"
            maxLength={8}
          />
          <SectionLabel>Confirm PIN</SectionLabel>
          <TextInput
            type="password"
            inputMode="numeric"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            maxLength={8}
          />
          {pin && !pinValid ? <InlineError>PIN must be 4–8 digits</InlineError> : null}
          {confirmPin && !pinsMatch ? <InlineError>PINs don&apos;t match</InlineError> : null}

          <PrimaryButton type="submit" disabled={pinSaving || !pinValid || !pinsMatch}>
            {pinSaved ? "Saved" : "Change PIN"}
          </PrimaryButton>
          <HelpText>
            Staff who are already unlocked stay unlocked for up to 12 hours.
          </HelpText>
          <InlineError>{pinError}</InlineError>
        </Card>
      </form>

      <Card>
        <SectionLabel>Set up your screens</SectionLabel>
        <HelpText>
          Put the display on the TV and leave it open. On the tablet, open the staff
          console and enter the PIN — it stays unlocked for 12 hours, so staff re-enter it
          once each morning. Print the QR so customers can watch on their phones.
        </HelpText>
      </Card>

      <Link
        href="/app"
        className="font-display text-xs font-extrabold uppercase tracking-wider text-muted-gray text-center"
      >
        ← Your shops
      </Link>
    </Page>
  );
}
