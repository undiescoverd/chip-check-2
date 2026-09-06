"use client";

import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@nextui-org/react";
import { useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import type { Order } from "@/lib/types";

/**
 * The console's four modals (§22.2), at stock NextUI dark-theme values — §20 says not to
 * restyle them, and an admin-panel-looking dialog is the one place this product is
 * allowed to look like every other product.
 *
 * `disableAnimation` under `prefers-reduced-motion` (§24): NextUI animates its modals
 * with framer-motion, which does not consult the media query on its own, so a reduced-
 * motion user would still get the scale-in without this.
 */

function StaffModal({
  isOpen,
  onClose,
  header,
  body,
  footer,
}: {
  isOpen: boolean;
  onClose: () => void;
  header: string;
  body: ReactNode;
  footer: ReactNode;
}) {
  const reduced = useReducedMotion();

  return (
    <Modal isOpen={isOpen} onClose={onClose} disableAnimation={reduced ?? false}>
      <ModalContent>
        <ModalHeader>{header}</ModalHeader>
        <ModalBody>{body}</ModalBody>
        <ModalFooter>{footer}</ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * The `add` collided with a live number (§13's 409). The existing order comes from the
 * server's response, so the modal can name its status rather than telling staff to go
 * and look.
 */
export function DuplicateModal({
  order,
  onClose,
}: {
  order: Order | null;
  onClose: () => void;
}) {
  return (
    <StaffModal
      isOpen={order !== null}
      onClose={onClose}
      header="Order already active"
      body={
        order
          ? `Order #${order.orderNumber} is already active (${order.status}). Clear it first, or use a different number.`
          : ""
      }
      footer={
        <Button color="primary" onPress={onClose}>
          OK
        </Button>
      }
    />
  );
}

/**
 * Clear All, and the shed nudge's scoped version of it. One component because they are
 * the same destructive confirmation with different copy and a different filter — and
 * because a second, near-identical modal is how the two would drift apart.
 */
export function ClearAllModal({
  isOpen,
  count,
  scope,
  clearing,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  count: number;
  scope: "all" | "shed";
  clearing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const shed = scope === "shed";

  return (
    <StaffModal
      isOpen={isOpen}
      onClose={clearing ? () => {} : onCancel}
      header={shed ? `Clear ${count} ready orders?` : "Clear all orders?"}
      body={
        shed
          ? "These have already dropped off the customer display. This can't be undone."
          : `This will clear all ${count} active orders from the board. This can't be undone.`
      }
      footer={
        <>
          <Button variant="light" isDisabled={clearing} onPress={onCancel}>
            Cancel
          </Button>
          <Button color="danger" isLoading={clearing} onPress={onConfirm}>
            Clear All
          </Button>
        </>
      }
    />
  );
}

/**
 * Wired now, unreachable until Phase 5: `add` only returns 402 when the billing flag is
 * on (§15, §17). Building it here means the flag flip is a flag flip rather than a
 * deploy — and the copy is already in §23.
 */
export function SubscriptionModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <StaffModal
      isOpen={isOpen}
      onClose={onClose}
      header="Subscription needed"
      body="This shop's subscription has ended, so new orders can't be added. Existing orders still work. Ask the owner to visit Settings."
      footer={
        <Button color="primary" onPress={onClose}>
          OK
        </Button>
      }
    />
  );
}
