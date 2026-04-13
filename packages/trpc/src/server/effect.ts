import { Context, Effect, Schema } from "effect";
import type { AgentRequestContext, BaseRequestContext, SessionRequestContext } from "./context";
import { toTrpcError } from "./errors";

export const strictSchema = <S extends Schema.Schema.AnyNoContext>(schema: S) =>
  Schema.standardSchemaV1(schema, { onExcessProperty: "error" });

export class SessionRequestContextTag extends Context.Tag("@abadge/trpc/SessionRequestContext")<
  SessionRequestContextTag,
  SessionRequestContext
>() {}

export class AgentRequestContextTag extends Context.Tag("@abadge/trpc/AgentRequestContext")<
  AgentRequestContextTag,
  AgentRequestContext
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

function withAgentContext<A, E>(
  ctx: AgentRequestContext,
  effect: Effect.Effect<A, E, AgentRequestContextTag>,
): Effect.Effect<A, E, never> {
  return Effect.provideService(effect, AgentRequestContextTag, ctx);
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

export async function runAgentEffect<A, E>(
  ctx: AgentRequestContext,
  effect: Effect.Effect<A, E, AgentRequestContextTag>,
): Promise<A> {
  try {
    return await Effect.runPromise(withAgentContext(ctx, effect));
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

/** Detect Postgres unique-constraint violations (SQLSTATE 23505).
 *  Drizzle v0.45+ wraps the original driver error in `.cause`,
 *  so we check both the error itself and its cause. */
export function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: unknown }).code ?? (e as { cause?: { code?: unknown } }).cause?.code;
  return code === "23505";
}
