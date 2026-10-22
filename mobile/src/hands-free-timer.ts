export type HandsFreeTimerDriver = {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
};

const runtimeDriver: HandsFreeTimerDriver = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

/** A single foreground timer, independent of recorder-status React renders. */
export class HandsFreeTurnTimer {
  private handle: unknown | null = null;
  private active = false;

  constructor(private readonly driver: HandsFreeTimerDriver = runtimeDriver) {}

  get running() {
    return this.active;
  }

  start(callback: () => void, intervalMs: number) {
    this.stop();
    this.active = true;
    const tick = () => {
      if (this.active) callback();
    };
    this.handle = this.driver.setInterval(tick, intervalMs);
    tick();
  }

  stop() {
    if (this.handle !== null) this.driver.clearInterval(this.handle);
    this.handle = null;
    this.active = false;
  }
}
