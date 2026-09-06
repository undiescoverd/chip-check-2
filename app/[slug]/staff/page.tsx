import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { StaffConsole } from "./StaffConsole";
import { PinGate } from "@/components/staff/PinGate";
import { ApiError } from "@/lib/server/errors";
import { shopForSlug } from "@/lib/server/shopPage";
import { STAFF_COOKIE_NAME, verifyStaffCookie } from "@/lib/server/staffCookie";

export const dynamic = "force-dynamic";

/**
 * `/{slug}/staff` (§22.2). The server decides whether the tablet is unlocked — it reads
 * `cc_staff`, verifies the signature and checks the scope is *this* shop — and renders
 * either the gate or the console.
 *
 * v1 kept "unlocked" in `sessionStorage`, so the gate was a client-side illusion that a
 * devtools line could step past. There is no client-side session check here at all: the
 * cookie is HttpOnly, the signature carries the shop id (§7.2), and the same cookie is
 * what the orders route demands on every write. A tampered cookie renders the gate; a
 * cookie for another shop renders the gate.
 */
export default async function StaffPage({ params }: { params: { slug: string } }) {
  let shop;
  try {
    shop = await shopForSlug(params.slug);
  } catch (err) {
    // The layout has normally already turned this into a 404; this keeps the page honest
    // if it is ever rendered on its own.
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const result = verifyStaffCookie(cookies().get(STAFF_COOKIE_NAME)?.value);
  const unlocked = result.ok && result.payload.shopId === shop.id;

  return unlocked ? <StaffConsole /> : <PinGate slug={shop.slug} />;
}
