import { describe, expect, it, vi } from "vitest";
import { openSubscription } from "./subscribe";

describe("openSubscription", () => {
  it("drops a listener that resolves after the subscription was replaced", async () => {
    const releases: Array<(stop: () => void) => void> = [];
    const listen = () =>
      new Promise<() => void>((resolve) => {
        releases.push(resolve);
      });
    const stopFirst = vi.fn();
    const stopSecond = vi.fn();

    const closeFirst = openSubscription(listen);
    closeFirst();
    const closeSecond = openSubscription(listen);
    releases[0](stopFirst);
    releases[1](stopSecond);
    await Promise.resolve();

    expect(stopFirst).toHaveBeenCalledOnce();
    expect(stopSecond).not.toHaveBeenCalled();

    closeSecond();
    await Promise.resolve();
    expect(stopSecond).toHaveBeenCalledOnce();
  });
});
