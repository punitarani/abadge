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

/** Read input without echoing characters (for passwords). */
function promptSilent(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    process.stdout.write(question);
    let input = "";

    const onData = (char: Buffer): void => {
      const next = applySilentInputChar(char.toString("utf-8"), input);
      if (next.interrupt) {
        process.exit(1);
      }
      if (next.done) {
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(next.input);
        return;
      }
      input = next.input;
    };

    stdin.on("data", onData);
  });
}
