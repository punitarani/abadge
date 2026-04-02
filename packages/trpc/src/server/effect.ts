import { Context, Effect, Schema } from "effect";
import type { BaseRequestContext, PrincipalRequestContext, SessionRequestContext } from "./context";
import { toTrpcError } from "./errors";

export const strictSchema = <S extends Schema.Schema.AnyNoContext>(schema: S) =>
  Schema.standardSchemaV1(schema, { onExcessProperty: "error" });

export class SessionRequestContextTag extends Context.Tag("@abadge/trpc/SessionRequestContext")<
  SessionRequestContextTag,
  SessionRequestContext
>() {}

export class PrincipalRequestContextTag extends Context.Tag("@abadge/trpc/PrincipalRequestContext")<
  PrincipalRequestContextTag,
  PrincipalRequestContext
>() {}

export class BaseRequestContextTag extends Context.Tag("@abadge/trpc/BaseRequestContext")<
  BaseRequestContextTag,
  BaseRequestContext
>() {}

function withBaseContext<A, E>(
  ctx: BaseRequestContext,
  effect: Effect.Effect<A, E, BaseRequestContextTag>,
): Effect.Effect<A, E, never> {
  return Effect.provideService(effect, BaseRequestContextTag, ctx);
}

function withSessionContext<A, E>(
  ctx: SessionRequestContext,
  effect: Effect.Effect<A, E, SessionRequestContextTag>,
): Effect.Effect<A, E, never> {
  return Effect.provideService(effect, SessionRequestContextTag, ctx);
}

function withPrincipalContext<A, E>(
  ctx: PrincipalRequestContext,
  effect: Effect.Effect<A, E, PrincipalRequestContextTag>,
): Effect.Effect<A, E, never> {
  return Effect.provideService(effect, PrincipalRequestContextTag, ctx);
}

export async function runBaseEffect<A, E>(
  ctx: BaseRequestContext,
  effect: Effect.Effect<A, E, BaseRequestContextTag>,
): Promise<A> {
  try {
    return await Effect.runPromise(withBaseContext(ctx, effect));
  } catch (error) {
    throw toTrpcError(error);
  }
}

export async function runSessionEffect<A, E>(
  ctx: SessionRequestContext,
  effect: Effect.Effect<A, E, SessionRequestContextTag>,
): Promise<A> {
  try {
    return await Effect.runPromise(withSessionContext(ctx, effect));
  } catch (error) {
    throw toTrpcError(error);
  }
}

export async function runPrincipalEffect<A, E>(
  ctx: PrincipalRequestContext,
  effect: Effect.Effect<A, E, PrincipalRequestContextTag>,
): Promise<A> {
  try {
    return await Effect.runPromise(withPrincipalContext(ctx, effect));
  } catch (error) {
    throw toTrpcError(error);
  }
}

export function tryAsync<A>(operation: () => Promise<A>): Effect.Effect<A, Error> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });
}
