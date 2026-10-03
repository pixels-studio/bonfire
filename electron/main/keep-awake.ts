import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AssistantEvent } from '../../shared/contracts';
import { CAFFEINATE_BATTERY_FLOOR } from '../../shared/domain';

const execFileAsync = promisify(execFile);

const BATTERY_CHECK_MS = 60_000;

export type Power = {
  /** Starts blocking system sleep and returns a handle for `stop`. */
  start(): number;
  stop(blocker: number): void;
  /** The battery's charge while running on it; undefined on wall power or when unknown. */
  dischargingLevel(): Promise<number | undefined>;
};

/** Reads the charge from `pmset`; other platforms don't report one, so they are never cut off. */
export async function dischargingLevel(): Promise<number | undefined> {
  if (process.platform !== 'darwin') return undefined;
  const { stdout } = await execFileAsync('pmset', ['-g', 'batt']);
  if (!stdout.includes("'Battery Power'")) return undefined;
  const percent = /(\d+)%/.exec(stdout)?.[1];
  return percent === undefined ? undefined : Number(percent);
}

/** Keeps the system awake while any turn runs, if the user wants that and the battery allows it. */
export class KeepAwake {
  private readonly running = new Set<string>();
  private blocker?: number;
  private batteryTimer?: NodeJS.Timeout;
  private lowBattery = false;

  constructor(
    private readonly enabled: () => boolean,
    private readonly power: Power,
  ) {}

  handle(event: AssistantEvent) {
    if (event.type !== 'status') return;
    if (event.status === 'running') this.running.add(event.paneId);
    else if (event.status === 'idle') this.running.delete(event.paneId);
    else return;
    this.update();
  }

  /** Re-evaluates whether to block sleep, such as after the setting changes. */
  update() {
    const active = this.enabled() && this.running.size > 0;
    if (active && !this.batteryTimer) {
      this.batteryTimer = setInterval(
        () => void this.checkBattery(),
        BATTERY_CHECK_MS,
      );
      void this.checkBattery();
    } else if (!active && this.batteryTimer) {
      clearInterval(this.batteryTimer);
      this.batteryTimer = undefined;
      this.lowBattery = false;
    }
    this.hold(active && !this.lowBattery);
  }

  close() {
    this.running.clear();
    this.update();
  }

  private async checkBattery() {
    const level = await this.power.dischargingLevel().catch(() => undefined);
    this.lowBattery = level !== undefined && level < CAFFEINATE_BATTERY_FLOOR;
    this.update();
  }

  private hold(blocking: boolean) {
    if (blocking && this.blocker === undefined)
      this.blocker = this.power.start();
    else if (!blocking && this.blocker !== undefined) {
      this.power.stop(this.blocker);
      this.blocker = undefined;
    }
  }
}
