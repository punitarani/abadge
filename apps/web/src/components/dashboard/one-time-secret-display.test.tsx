// B12: clipboard rejection path. When navigator.clipboard.writeText rejects,
// the component must flip to the "error" copyState and surface a sonner toast.
// This test exercises the React render path end-to-end (happy-dom + RTL),
// proving the apps/web test harness works.
//
// We use fireEvent instead of @testing-library/user-event because user-event's
// `setup()` installs its own navigator.clipboard stub that swallows mocks. The
// component handler only cares about the click event, not pointer/keyboard
// fidelity, so fireEvent is sufficient.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OneTimeSecretDisplay } from "./one-time-secret-display";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.navigator,
  "clipboard",
);

function installRejectingClipboard(): void {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
    configurable: true,
  });
}

function restoreClipboard(): void {
  if (originalClipboardDescriptor) {
    Object.defineProperty(globalThis.navigator, "clipboard", originalClipboardDescriptor);
  } else {
    delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
  }
}

describe("OneTimeSecretDisplay", () => {
  beforeEach(() => {
    installRejectingClipboard();
  });

  afterEach(() => {
    cleanup();
    restoreClipboard();
  });

  test("shows error state when clipboard.writeText rejects", async () => {
    render(
      <OneTimeSecretDisplay
        value="abk_test_value"
        type="api_key"
        onDismiss={() => {
          /* noop */
        }}
      />,
    );

    const copyButton = screen.getByRole("button", { name: /copy to clipboard/i });
    fireEvent.click(copyButton);

    // The button label flips from "Copy" to "Copy failed" and the aria-label
    // changes to "Copy failed — select manually" once the rejection is caught.
    const failedButton = await screen.findByRole("button", {
      name: /copy failed — select manually/i,
    });
    expect(failedButton.textContent).toBe("Copy failed");
  });
});
