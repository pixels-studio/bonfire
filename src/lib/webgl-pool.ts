/**
 * How many terminals may draw with WebGL at once. Chromium keeps about 16 WebGL contexts per
 * page and silently drops the oldest past that, so one is left for anything else; terminals
 * past the limit draw with xterm's DOM renderer until a context is free.
 */
export const WEBGL_LIMIT = 15;

/** A terminal that would like to draw with WebGL. */
export type WebglClaim = {
  /** Called once WebGL is the terminal's to use. */
  grant(): void;
  /** Called when the terminal must give WebGL up, as for one in view. */
  revoke(): void;
};

/**
 * Hands out WebGL to busy terminals in view, up to the limit. Terminals out of view or gone
 * quiet give theirs back, and the longest-waiting one gets it next.
 */
export class WebglPool {
  private readonly holding = new Set<WebglClaim>();
  private readonly waiting = new Set<WebglClaim>();
  /** Set once WebGL failed to start, so no terminal tries again this session. */
  private unavailable = false;

  constructor(private readonly limit = WEBGL_LIMIT) {}

  /** The terminal is in view and would draw with WebGL; it is granted now or once one is free. */
  want(claim: WebglClaim) {
    if (this.unavailable || this.holding.has(claim)) return;
    if (this.holding.size < this.limit) {
      this.holding.add(claim);
      claim.grant();
    } else this.waiting.add(claim);
  }

  /** The terminal is out of view or gone: it gives WebGL back, or stops waiting for it. */
  release(claim: WebglClaim) {
    this.waiting.delete(claim);
    if (!this.holding.delete(claim)) return;
    claim.revoke();
    this.grantNext();
  }

  /** The terminal lost its context, as when the GPU resets; it may ask again later. */
  lost(claim: WebglClaim) {
    if (this.holding.delete(claim)) this.grantNext();
  }

  /** WebGL can't start on this computer; every terminal draws with the DOM renderer. */
  disable() {
    this.unavailable = true;
    for (const claim of this.holding) claim.revoke();
    this.holding.clear();
    this.waiting.clear();
  }

  get size() {
    return this.holding.size;
  }

  private grantNext() {
    const [next] = this.waiting;
    if (!next) return;
    this.waiting.delete(next);
    this.want(next);
  }
}

export const webglPool = new WebglPool();

/** How much output in a second makes a terminal busy enough to be worth drawing with WebGL. */
export const BUSY_CHARS_PER_SECOND = 64 * 1024;
/** How long a busy terminal keeps WebGL after its last busy second. */
export const IDLE_AFTER_MS = 10_000;

/**
 * Whether a terminal is busy drawing output. WebGL only pays while output pours in, and each
 * context holds tens of megabytes of GPU memory, so a terminal takes one while busy and gives
 * it back once quiet; a quiet terminal costs nothing to draw either way.
 */
export class OutputActivity {
  private windowStart = -Infinity;
  private chars = 0;
  private busy = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly changed: (busy: boolean) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get isBusy() {
    return this.busy;
  }

  /** Notes output drawn, which in a busy second keeps the terminal busy. */
  output(chars: number) {
    const now = this.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.chars = 0;
    }
    this.chars += chars;
    if (this.chars < BUSY_CHARS_PER_SECOND) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.busy = false;
      this.changed(false);
    }, IDLE_AFTER_MS);
    if (this.busy) return;
    this.busy = true;
    this.changed(true);
  }

  close() {
    clearTimeout(this.timer);
  }
}
