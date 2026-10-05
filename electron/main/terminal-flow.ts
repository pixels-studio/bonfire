/**
 * How much output the window may have yet to show before the program is paused, and how
 * little before it carries on. A program can write far faster than a terminal can draw;
 * without a limit the output piles up in the window, which falls behind and stutters.
 *
 * The program carries on while the window still has most of a batch to draw, so the next
 * output arrives as it finishes. Waiting for the window to empty left it idle on each
 * pause, and drawing a flood of colored output took 17% longer.
 */
export const HIGH_WATER_CHARS = 512 * 1024;
export const LOW_WATER_CHARS = 384 * 1024;
/** How long a paused program waits for the window before it is let go. */
export const ACK_TIMEOUT_MS = 2000;

/**
 * Paces one terminal's program to what the window shows, as VS Code does. Only once the
 * window has said what it has shown: a terminal nobody looks at runs freely. A window that
 * stops answering, as when the pane closes or the page reloads, lets the program go.
 */
export class OutputFlow {
  private unacked = 0;
  private watched = false;
  private paused = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly program: { pause(): void; resume(): void },
    private readonly timeoutMs = ACK_TIMEOUT_MS,
  ) {}

  get isPaused() {
    return this.paused;
  }

  /** Notes output sent to the window. */
  sent(chars: number) {
    this.unacked += chars;
    if (!this.watched || this.paused || this.unacked <= HIGH_WATER_CHARS)
      return;
    this.paused = true;
    this.program.pause();
    this.wait();
  }

  /** Notes output the window has shown. */
  acked(chars: number) {
    this.watched = true;
    this.unacked = Math.max(0, this.unacked - chars);
    if (!this.paused) return;
    if (this.unacked < LOW_WATER_CHARS) this.resume();
    else this.wait();
  }

  /** A new view starts from a snapshot, so only what is sent after it counts. */
  restart() {
    this.unacked = 0;
    this.watched = false;
    if (this.paused) this.resume();
  }

  close() {
    clearTimeout(this.timer);
  }

  private wait() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.restart(), this.timeoutMs);
  }

  private resume() {
    clearTimeout(this.timer);
    this.paused = false;
    this.program.resume();
  }
}
