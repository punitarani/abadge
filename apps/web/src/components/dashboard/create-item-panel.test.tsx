/**
 * Wiring tests for CreateItemPanel (the container). These prove the layer the
 * profile selector added: fetch the org's profiles, derive the selection, and
 * on submit send the *selected* profile's id to `items.create` — and, for a
 * zero-knowledge selection, unlock and encrypt under that same profile's key.
 *
 * The discriminating case is an org with two ZK profiles: the row could land in
 * the right profile on the server yet be encrypted under the wrong profile's key
 * if the client unlocked/encrypted with a stale id. Asserting requestUnlock,
 * encryptItemForProfile, and items.create.mutate all carry the *selected* id is
 * what catches that.
 *
 * SearchableSelect (Radix Popover + cmdk) is portal/pointer-driven and brittle
 * in happy-dom, so we mock it as a native <select> — the combobox UI is its own
 * unit; here we only exercise the container's data flow.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type * as React from "react";

// --- captured call args ------------------------------------------------------
// Stable singletons: useVault() runs on every render, so the spies must NOT be
// re-created inside the factory (a post-submit re-render would swap in a fresh,
// uncalled mock and lose the recorded calls).

type CreateBody = { storageMode: string; profileId: string; id?: string };
type EncryptOpts = { profileId: string; itemId: string };

const createMutate = mock(async (_body: CreateBody) => ({ id: "item_1" }));
const requestUnlock = mock(async (_profileId: string) => new Uint8Array(32));
const encryptSpy = mock((_payload: unknown, _key: Uint8Array, _opts: EncryptOpts) => ({
  encryptedItemKey: "ek_test",
  ciphertext: "ct_test",
}));

const SM_DEFAULT = {
  id: "p_sm",
  name: "default",
  storageMode: "server_managed",
  externalId: "default",
};
const ZK_A = { id: "p_zk_a", name: "zk-a", storageMode: "zero_knowledge", externalId: null };
const ZK_B = { id: "p_zk_b", name: "zk-b", storageMode: "zero_knowledge", externalId: null };
const PROFILES = [SM_DEFAULT, ZK_A, ZK_B];

// --- module mocks ------------------------------------------------------------

mock.module("@/components/dashboard/responsive-overlay", () => ({
  ResponsiveOverlay: ({
    open,
    children,
    footer,
  }: {
    open: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    open ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null,
}));

// Native-select stand-in for the portal-based combobox.
mock.module("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({
    options,
    value,
    onValueChange,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <select
      data-testid="profile-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

mock.module("@/lib/trpc-browser", () => ({
  browserTrpcClient: {
    profiles: { list: { query: mock(async () => ({ profiles: PROFILES })) } },
    items: { create: { mutate: createMutate } },
  },
  getClientErrorMessage: mock((_e: unknown, fallback: string) => fallback),
}));

mock.module("@/lib/vault-context", () => ({
  useVault: () => ({ requestUnlock }),
}));

mock.module("@/lib/crypto-client", () => ({
  encryptItemForProfile: encryptSpy,
}));

mock.module("@/stores/org-store", () => ({
  useOrgStore: () => ({ activeOrgId: "org_1" }),
}));

mock.module("sonner", () => ({
  toast: { success: mock(() => {}), error: mock(() => {}) },
}));

// --- helpers -----------------------------------------------------------------

function renderPanel(): { container: HTMLElement } {
  const { CreateItemPanel } = require("./create-item-panel") as {
    CreateItemPanel: React.ComponentType<{ open: boolean; onClose: () => void }>;
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreateItemPanel open onClose={() => {}} />
    </QueryClientProvider>,
  );
}

function submit(container: HTMLElement): void {
  const form = container.querySelector("form");
  if (!form) throw new Error("form not rendered");
  fireEvent.submit(form);
}

afterEach(() => {
  cleanup();
  createMutate.mockClear();
  requestUnlock.mockClear();
  encryptSpy.mockClear();
});

// ---------------------------------------------------------------------------

describe("CreateItemPanel — profile wiring", () => {
  test("defaults to the externalId='default' profile and creates server-managed there", async () => {
    const { container } = renderPanel();

    // Wait for the profiles query → default profile selected.
    const select = (await screen.findByTestId("profile-select")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(SM_DEFAULT.id));

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "my-token" } });
    submit(container);

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const body = createMutate.mock.calls[0]?.[0];
    expect(body?.storageMode).toBe("server_managed");
    expect(body?.profileId).toBe(SM_DEFAULT.id);
    // Server-managed never touches the client vault.
    expect(requestUnlock).not.toHaveBeenCalled();
  });

  test("selecting the second ZK profile unlocks, encrypts, and creates under THAT profile", async () => {
    const { container } = renderPanel();

    const select = (await screen.findByTestId("profile-select")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(SM_DEFAULT.id));

    // Pick the *second* ZK profile — the discriminating case.
    fireEvent.change(select, { target: { value: ZK_B.id } });
    await waitFor(() => expect(select.value).toBe(ZK_B.id));

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "zk-secret" } });
    submit(container);

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));

    // The key is unlocked for the selected profile...
    expect(requestUnlock).toHaveBeenCalledTimes(1);
    expect(requestUnlock.mock.calls[0]?.[0]).toBe(ZK_B.id);
    // ...the payload is encrypted with the selected profile's AAD...
    expect(encryptSpy).toHaveBeenCalledTimes(1);
    const encOpts = encryptSpy.mock.calls[0]?.[2];
    expect(encOpts?.profileId).toBe(ZK_B.id);
    // ...and the row is created in the selected profile, ids consistent for AAD.
    const body = createMutate.mock.calls[0]?.[0];
    expect(body?.storageMode).toBe("zero_knowledge");
    expect(body?.profileId).toBe(ZK_B.id);
    expect(body?.id).toBe(encOpts?.itemId);
  });
});
