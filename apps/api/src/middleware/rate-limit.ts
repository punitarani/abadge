import { createMiddleware } from "hono/factory";

const counters = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = counters.get(ip);
  if (!entry || now > entry.resetAt) {
    counters.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

export function rateLimitMiddleware(limit: number, windowMs: number) {
  return createMiddleware(async (c, next) => {
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
    if (!checkRateLimit(ip, limit, windowMs)) {
      return c.json({ error: "Too many requests" }, 429);
    }
    await next();
  });
}
