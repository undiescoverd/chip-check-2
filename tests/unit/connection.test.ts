import { describe, expect, it } from "vitest";
import { SERVER_SILENCE_MS, deriveStatus, type StatusInput } from "@/lib/orders/connection";

/**
 * §11's status derivation. The interesting assertions are the ones about *silence*:
 * a tab that is online, un-errored and serving cache looks perfectly healthy, and the
 * whole reason the dot exists is that it isn't.
 */

const NOW = 1_700_000_000_000;

/** A healthy, freshly-contacted, visible tab. Each test perturbs one thing. */
function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    errored: false,
    hasSnapshot: true,
    fromCache: false,
    online: true,
    visible: true,
    lastServerContactAt: NOW,
    nowMs: NOW,
    ...overrides,
  };
}

describe("deriveStatus", () => {
  it("is connecting before the first snapshot", () => {
    expect(deriveStatus(input({ hasSnapshot: false }))).toBe("connecting");
  });

  it("is connected once a server snapshot arrives", () => {
    expect(deriveStatus(input())).toBe("connected");
  });

  it("stays connected on a cache snapshot while online and recently in contact", () => {
    // Firestore serves cache between server pushes; that is not a fault.
    expect(deriveStatus(input({ fromCache: true }))).toBe("connected");
  });

  it("is disconnected when serving cache with no network", () => {
    expect(deriveStatus(input({ fromCache: true, online: false }))).toBe("disconnected");
  });

  it("is disconnected when the error callback has fired", () => {
    expect(deriveStatus(input({ errored: true }))).toBe("disconnected");
  });

  it("reports an error before the first snapshot as disconnected, not connecting", () => {
    // A subscription that failed outright is not still trying. Saying "connecting"
    // forever would be the more comfortable lie.
    expect(deriveStatus(input({ errored: true, hasSnapshot: false }))).toBe("disconnected");
  });

  describe("the silent-staleness rule", () => {
    it("goes disconnected after 60 s without server contact while visible", () => {
      // No error, browser still reports online, snapshots still arriving from cache.
      // Nothing else in the system notices this.
      const stale = input({
        fromCache: true,
        online: true,
        errored: false,
        lastServerContactAt: NOW - SERVER_SILENCE_MS,
      });
      expect(deriveStatus(stale)).toBe("disconnected");
    });

    it("fires exactly at the boundary, not a millisecond before", () => {
      const at = (elapsed: number) =>
        deriveStatus(input({ lastServerContactAt: NOW - elapsed }));

      expect(at(SERVER_SILENCE_MS - 1)).toBe("connected");
      expect(at(SERVER_SILENCE_MS)).toBe("disconnected");
    });

    it("does not fire on a backgrounded tab", () => {
      // A hidden tab legitimately receives nothing. Crying wolf every time someone
      // switches apps would train staff to ignore the dot.
      const hidden = input({ visible: false, lastServerContactAt: NOW - 10 * SERVER_SILENCE_MS });
      expect(deriveStatus(hidden)).toBe("connected");
    });

    it("applies even when the last snapshot came from the server", () => {
      // The rule is about elapsed silence, not about where the newest snapshot came
      // from — an hour-old server snapshot is still an hour of silence.
      const stale = input({
        fromCache: false,
        lastServerContactAt: NOW - 5 * SERVER_SILENCE_MS,
      });
      expect(deriveStatus(stale)).toBe("disconnected");
    });
  });

  it("prefers the error over every other signal", () => {
    const everything = input({
      errored: true,
      hasSnapshot: false,
      fromCache: false,
      online: true,
      visible: true,
    });
    expect(deriveStatus(everything)).toBe("disconnected");
  });

  it("tolerates a lastServerContactAt in the future without going disconnected", () => {
    // Clock skew between the device and our own Date.now() should not read as silence.
    expect(deriveStatus(input({ lastServerContactAt: NOW + 30_000 }))).toBe("connected");
  });
});
