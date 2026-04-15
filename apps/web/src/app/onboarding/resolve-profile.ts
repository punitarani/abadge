/**
 * Pure helper for the onboarding "create internal profile" step. Extracted so
 * the conflict-resolution branches can be unit-tested without React/network.
 *
 * Why "resolve or create": if a user creates an org but closes the tab before
 * bootstrapping the auto-created default profile, the next attempt to call
 * `profiles.create` for the same `(orgId, name)` rejects with
 * PROFILE_ALREADY_EXISTS. That is the *correct* server response in steady
 * state, but during onboarding we want to adopt the orphan rather than force
 * the user to invent a new name. The adoption is gated on the existing profile
 * being unbootstrapped — clobbering a real profile with random `wrappedRootKey`
 * data is a destructive operation we never want here.
 */

import type { Profile } from "@abadge/core";
import { normalizeTrpcError } from "@abadge/trpc/client";
import { isProfileBootstrapped } from "./onboarding-triage";

/**
 * Subset of the tRPC client surface this helper needs. Keeping the shape
 * narrow makes the test stub trivial and decouples the unit test from the
 * full router type tree.
 */
export interface ProfileResolverClient {
  profiles: {
    create: {
      mutate: (input: {
        orgId: string;
        name: string;
        storageMode: "zero_knowledge" | "server_managed";
      }) => Promise<{ profile: { id: string } }>;
    };
    list: {
      query: (input: { orgId: string }) => Promise<{ profiles: Profile[] }>;
    };
  };
}

export interface ResolveProfileInput {
  orgId: string;
  name: string;
  storageMode: "zero_knowledge" | "server_managed";
}

/**
 * Returns the id of the (newly created or adopted) profile.
 * Rethrows the original create error in two cases:
 *  - the create failed for any reason other than PROFILE_ALREADY_EXISTS
 *  - the conflicting profile is already bootstrapped (we never clobber)
 */
export async function resolveOrCreateProfile(
  client: ProfileResolverClient,
  input: ResolveProfileInput,
): Promise<string> {
  try {
    const result = await client.profiles.create.mutate(input);
    return result.profile.id;
  } catch (err) {
    const normalized = normalizeTrpcError(err);
    if (normalized.code !== "PROFILE_ALREADY_EXISTS") {
      throw err;
    }
    const { profiles } = await client.profiles.list.query({ orgId: input.orgId });
    const existing = profiles.find((p) => p.name === input.name);
    if (!existing || isProfileBootstrapped(existing)) {
      throw err;
    }
    return existing.id;
  }
}
