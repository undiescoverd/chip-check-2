import { z } from "zod";
import { PIN_PATTERN } from "@/lib/server/pin";
import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH, isValidSlug } from "@/lib/slugs";
import { SettingsObject, SettingsSchema } from "@/lib/types";

/**
 * Shop request bodies (§13).
 *
 * The slug is checked here for *shape* only. Being reserved is a separate 400
 * (`slug_reserved`) and being taken is a 409 (`slug_taken`), because the owner needs to
 * tell "you can't have this" apart from "someone already did" — §23 maps them to
 * different copy ("Reserved" vs "Taken").
 */

export const SlugParam = z
  .string()
  .min(SLUG_MIN_LENGTH)
  .max(SLUG_MAX_LENGTH)
  .refine(isValidSlug, { message: "slug must be lowercase letters, digits and single hyphens" });

export const PinField = z.string().regex(PIN_PATTERN, "PIN must be 4–8 digits");

/**
 * `targetPrepSeconds` is absent from §13's body and §22.4's form, though §9 defines it
 * with a default of 480 — a gap the amendment left. `SettingsSchema` supplies the
 * default, so §9 stays authoritative and no UI is invented for it here.
 */
export const CreateShopBody = z.object({
  name: z.string().trim().min(1).max(60),
  slug: SlugParam,
  settings: SettingsSchema,
  pin: PinField,
});

export type CreateShopBody = z.infer<typeof CreateShopBody>;

/** Partial update. The slug is absent by design — it is immutable after creation (§5). */
export const UpdateShopBody = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    // Individual fields are re-validated as a whole against the shop's stored settings
    // in `updateShop`, so a partial patch cannot produce an invalid combination.
    settings: SettingsObject.partial().optional(),
  })
  .refine((b) => b.name !== undefined || b.settings !== undefined, {
    message: "nothing to update",
  });

export type UpdateShopBody = z.infer<typeof UpdateShopBody>;

export const SetPinBody = z.object({ pin: PinField });

export const UnlockBody = z.object({ pin: z.string().min(1).max(64) });
