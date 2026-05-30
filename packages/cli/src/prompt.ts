import { createInterface } from "node:readline";

/** Prompt user for input. If `silent` is true, echoing is disabled (for passwords). */
export function prompt(question: string, silent = false): Promise<string> {
  if (silent) {
    return promptSilent(question);
  }

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function applySilentInputChar(
  c: string,
  input: string,
): { readonly input: string; readonly done: boolean; readonly interrupt: boolean } {
  if (c === "\n" || c === "\r") {
    return { input, done: true, interrupt: false };
  }
  if (c === "\u0003") {
    return { input, done: false, interrupt: true };
  }
  if (c === "\u007F" || c === "\b") {
    return { input: input.slice(0, -1), done: false, interrupt: false };
  }
  return { input: input + c, done: false, interrupt: false };
}

export function applySilentInputChunk(
  chunk: string,
  input: string,
): { readonly input: string; readonly done: boolean; readonly interrupt: boolean } {
  let nextInput = input;

  for (const c of chunk) {
    const next = applySilentInputChar(c, nextInput);
    nextInput = next.input;

    if (next.done || next.interrupt) {
      return next;
    }
  }

  return { input: nextInput, done: false, interrupt: false };
}

/** Read input without echoing characters (for passwords). */
function promptSilent(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    // Prompt chrome goes to stderr, never stdout — so `--json` output stays
    // machine-parseable even when a value is read interactively.
    process.stderr.write(question);
    stdin.resume();
    let input = "";

    const onData = (char: Buffer): void => {
      const next = applySilentInputChunk(char.toString("utf-8"), input);
      if (next.interrupt) {
        process.exit(1);
      }
      if (next.done) {
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        stdin.removeListener("data", onData);
        stdin.pause();
        process.stderr.write("\n");
        resolve(next.input);
        return;
      }
      input = next.input;
    };

    stdin.on("data", onData);
  });
}

/**
 * Strip a single trailing newline (`\n` or `\r\n`). `echo 'x'` adds one and
 * `echo -n 'x'` does not — both should store the same value.
 */
export function stripTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, "");
}

/** Read a piped (non-TTY) stream fully to EOF as UTF-8. */
function readStreamToEnd(stream: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf-8");
    stream.on("data", (chunk: string) => {
      data += chunk;
    });
    stream.on("end", () => resolve(data));
    // 'close' fires (without a preceding 'end') when the stream is destroyed
    // abnormally — SIGPIPE, the writer crash-killed, an upstream destroy(). Resolve
    // with whatever was collected so the caller validates/fails fast instead of
    // hanging forever. A normal 'end'-then-'close' just no-ops the second resolve.
    stream.on("close", () => resolve(data));
    stream.on("error", reject);
    stream.resume();
  });
}

/**
 * Read a secret value. On a TTY, prompt interactively without echo. When stdin
 * is piped (CI, `echo -n 'secret' | abadge item add`), read it to EOF as the
 * value and strip one trailing newline — so a value without a trailing newline
 * is never silently dropped for lack of one, and `echo` / `echo -n` agree.
 */
export async function readSecretValue(question: string): Promise<string> {
  if (process.stdin.isTTY) {
    return promptSilent(question);
  }
  return stripTrailingNewline(await readStreamToEnd(process.stdin));
}
