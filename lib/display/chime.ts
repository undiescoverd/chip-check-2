import type { Order } from "@/lib/types";

/**
 * The customer display's chime (§22.1).
 *
 * Split in two on purpose: `nextSeenReady` is pure and unit-tested — it is the actual
 * "which ids are newly ready" judgement, and it is the part that was easy to get wrong
 * (chiming for orders that were already ready when the page loaded). `Chime` is the
 * unavoidably impure half — a real `AudioContext` — kept as small as the spec allows so
 * there is as little here as possible that a test cannot reach.
 */

export interface SeenReadyResult {
  /** Ids that are ready now but were not in `seen` — chime once for each. */
  newlyReadyIds: string[];
  /** Pass this back in as `seen` next time. Bounded to the current ready set, so a
   *  cleared order's id is never carried forward — nothing to evict, nothing to grow. */
  seen: Set<string>;
}

/**
 * `seen` starts as the ids that were *already* ready when the board connected — never
 * from an empty set — so a shop that opens the display mid-service does not chime for
 * every order already on it (§22.1's seeding rule). Call this once per snapshot after
 * that seed, in order; every id in `seen` traces back to that first call.
 */
export function nextSeenReady(seen: ReadonlySet<string>, orders: Order[]): SeenReadyResult {
  const readyIds = orders.filter((o) => o.status === "ready").map((o) => o.id);
  const newlyReadyIds = readyIds.filter((id) => !seen.has(id));
  return { newlyReadyIds, seen: new Set(readyIds) };
}

/** The ready ids to seed `seen` with on first connect — every id already ready, chimed for none. */
export function seedSeenReady(orders: Order[]): Set<string> {
  return new Set(orders.filter((o) => o.status === "ready").map((o) => o.id));
}

/**
 * One `AudioContext` for the page's lifetime — Chrome caps live contexts at roughly six,
 * so a fresh one per chime is a v1 bug this keeps fixed. Created lazily on first use,
 * never at module load, so importing this file never touches the audio subsystem.
 */
export class Chime {
  private ctx: AudioContext | null = null;

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      typeof window === "undefined"
        ? undefined
        : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  get suspended(): boolean {
    return this.ctx?.state === "suspended";
  }

  /**
   * Must run inside the user gesture handler itself (§22.1) — a context created before
   * any gesture starts `suspended`, and constructing/starting an oscillator on it does
   * not change that: `osc.start()` returns normally, nothing plays, and the chime's own
   * `catch` below swallows the silence. That is the mechanism behind a TV that was
   * switched on and left alone staying silent all service with no error anywhere.
   */
  async resume(): Promise<void> {
    const ctx = this.context();
    if (!ctx) return;
    try {
      await ctx.resume();
    } catch {
      // Autoplay policy or an unsupported browser — the "Tap to enable sound" hint just
      // stays visible; there is nothing else to do about it here.
    }
  }

  /** 880 Hz sine, a 20 ms attack and a 0.5 s decay (§22.1). Errors are swallowed — the
   *  autoplay policy is the expected reason this fails, not a bug to surface. */
  play(): void {
    try {
      const ctx = this.context();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      // Swallowed for the same reason `resume()` swallows: the autoplay policy blocking
      // sound is an expected state on this screen, not a failure to report.
    }
  }
}
