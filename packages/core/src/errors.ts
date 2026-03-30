import type { ErrorCode } from "./constants";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 404);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 403);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 409);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super("RATE_LIMITED", "Too many requests", 429);
    this.name = "RateLimitError";
  }
}
