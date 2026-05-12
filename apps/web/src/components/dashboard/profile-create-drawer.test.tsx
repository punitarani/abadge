/**
 * Unit tests for ProfileCreateDrawer. We mock ResponsiveOverlay so that when
 * open=true the children render directly (no Radix portals), and mock the
 * tRPC/query-client dependencies so the form itself is testable in isolation.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type * as React from "react";

// --- module mocks -----------------------------------------------------------

// Mock ResponsiveOverlay: render children when open, nothing when closed.
mock.module("@/components/dashboard/responsive-overlay", () => ({
  ResponsiveOverlay: ({
    open,
    children,
    footer,
  }: {
    open: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => {
    if (!open) return null;
    return (
      <div>
        {children}
        {footer}
      </div>
    );
  },
}));

// Mock profile-bootstrap so no crypto or network calls happen.
mock.module("@/lib/profile-bootstrap", () => ({
  bootstrapZkProfile: mock(async () => undefined),
  resolveOrCreateProfile: mock(async () => "p_test"),
}));

// Mock trpc-browser to prevent module resolution errors at import time.
mock.module("@/lib/trpc-browser", () => ({
  browserTrpcClient: {
    profiles: {
      delete: { mutate: mock(async () => ({})) },
    },
  },
  getClientErrorMessage: mock((_err: unknown, fallback: string) => fallback),
}));

// Mock sonner toast.
mock.module("sonner", () => ({
  toast: {
    success: mock(() => {}),
    error: mock(() => {}),
  },
}));

// --- helpers ----------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderDrawer(props: {
  open: boolean;
  onOpenChange?: (v: boolean) => void;
  orgId?: string;
}): void {
  const { ProfileCreateDrawer } = require("./profile-create-drawer") as {
    ProfileCreateDrawer: React.ComponentType<{
      open: boolean;
      onOpenChange: (v: boolean) => void;
      orgId: string;
    }>;
  };

  const qc = makeQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ProfileCreateDrawer
        open={props.open}
        onOpenChange={props.onOpenChange ?? (() => {})}
        orgId={props.orgId ?? "org_1"}
      />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

describe("ProfileCreateDrawer — rendering (§REVAMP-PR5)", () => {
  test("renders nothing when open=false", () => {
    renderDrawer({ open: false });
    expect(screen.queryByLabelText(/profile name/i)).toBeNull();
  });

  test("renders profile name input when open=true", () => {
    renderDrawer({ open: true });
    expect(screen.getByLabelText(/profile name/i)).toBeTruthy();
  });

  test("renders optional External ID input when open=true", () => {
    renderDrawer({ open: true });
    expect(screen.getByLabelText(/external id/i)).toBeTruthy();
  });

  test("ZK is OFF by default — server-managed is the default storage mode", () => {
    renderDrawer({ open: true });
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(screen.queryByLabelText(/^profile password/i)).toBeNull();
    expect(screen.queryByLabelText(/confirm password/i)).toBeNull();
  });

  test("toggling ZK on reveals the password inputs and warning block", () => {
    renderDrawer({ open: true });
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(screen.getByLabelText(/^profile password/i)).toBeTruthy();
    expect(screen.getByLabelText(/confirm password/i)).toBeTruthy();
    expect(screen.getByText(/the server will never see this password/i)).toBeTruthy();
  });

  test("toggling ZK off again hides the password inputs and warning block", () => {
    renderDrawer({ open: true });
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(screen.queryByLabelText(/^profile password/i)).toBeNull();
    expect(screen.queryByText(/the server will never see this password/i)).toBeNull();
  });
});
