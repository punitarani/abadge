/**
 * Render tests for the EditItemPanel container. ResponsiveOverlay is mocked to
 * render children inline; the crypto/vault/trpc dependencies are mocked so the
 * submit wiring (payload shape + optimistic-concurrency contentVersion) is
 * asserted in isolation.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ItemDetail, ItemPayload } from "@abadge/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type * as React from "react";

const updateMutate = mock(async (_input: { itemId: string; data: unknown }) => ({
  ok: true,
  contentVersion: 3,
}));
const encryptMock = mock(() => ({ encryptedItemKey: "EIK", ciphertext: "CT" }));

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

mock.module("@/lib/trpc-browser", () => ({
  browserTrpcClient: { items: { update: { mutate: updateMutate } } },
  getClientErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

mock.module("@/lib/crypto-client", () => ({
  encryptItemForProfile: encryptMock,
  decryptItemFromProfile: mock(() => ({ v: 1, kind: "opaque", fields: {} })),
}));

mock.module("@/lib/vault-context", () => ({
  useVault: () => ({ requestUnlock: mock(async () => new Uint8Array(32)) }),
}));

mock.module("@/stores/org-store", () => ({
  useOrgStore: () => ({ activeOrgId: "org_1" }),
}));

// Load the component under test lazily INSIDE the helper (not via a static
// import). Static ES imports are hoisted above the mock.module calls, so on a
// runtime that doesn't retroactively apply module mocks (CI's bun 1.3.0) a
// top-level import would evaluate the real crypto/vault/trpc modules before the
// mocks register. require() defers evaluation until after the mocks are set —
// the same pattern profile-create-drawer.test.tsx uses.
function renderPanel(item: ItemDetail, payload: ItemPayload): HTMLElement {
  const { EditItemPanel } = require("./edit-item-panel") as {
    EditItemPanel: (props: {
      item: ItemDetail;
      payload: ItemPayload;
      open: boolean;
      onClose: () => void;
    }) => React.ReactElement;
  };
  const client = new QueryClient();
  const { container } = render(
    <QueryClientProvider client={client}>
      <EditItemPanel item={item} payload={payload} open onClose={() => {}} />
    </QueryClientProvider>,
  );
  return container;
}

const PAYLOAD: ItemPayload = {
  v: 1,
  label: "gh-key",
  kind: "api_key",
  tags: ["ci"],
  fields: { api_key: "sk-old" },
} as ItemPayload;

afterEach(() => {
  cleanup();
  updateMutate.mockClear();
  encryptMock.mockClear();
});

describe("EditItemPanel submit wiring", () => {
  test("server-managed update sends the payload with the current contentVersion", async () => {
    const item = {
      id: "item_1",
      label: "gh-key",
      storageMode: "server_managed",
      contentVersion: 2,
      profileId: "prof_1",
      cryptoVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as ItemDetail;

    const container = renderPanel(item, PAYLOAD);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const arg = updateMutate.mock.calls[0]?.[0] as unknown as {
      itemId: string;
      data: { storageMode: string; contentVersion: number; payload: ItemPayload };
    };
    expect(arg.itemId).toBe("item_1");
    expect(arg.data.storageMode).toBe("server_managed");
    // CAS uses the CURRENT version; preserved tags survive the edit.
    expect(arg.data.contentVersion).toBe(2);
    expect(arg.data.payload.tags).toEqual(["ci"]);
    expect(arg.data.payload.fields).toEqual({ api_key: "sk-old" });
  });

  test("zero-knowledge update re-encrypts at version+1 and sends current version for CAS", async () => {
    const item = {
      id: "item_zk",
      label: "gh-key",
      storageMode: "zero_knowledge",
      contentVersion: 4,
      profileId: "prof_zk",
      cryptoVersion: 1,
      encryptedItemKey: "old",
      ciphertext: "old",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as ItemDetail;

    const container = renderPanel(item, PAYLOAD);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    // AAD binds to the NEXT contentVersion (5) the server will persist.
    expect(encryptMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ itemId: "item_zk", profileId: "prof_zk", contentVersion: 5 }),
    );
    const arg = updateMutate.mock.calls[0]?.[0] as unknown as {
      data: { storageMode: string; contentVersion: number; encryptedItemKey: string };
    };
    expect(arg.data.storageMode).toBe("zero_knowledge");
    expect(arg.data.contentVersion).toBe(4);
    expect(arg.data.encryptedItemKey).toBe("EIK");
  });
});
