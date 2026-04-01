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
      const c = char.toString("utf-8");
      if (c === "\n" || c === "\r") {
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(input);
      } else if (c === "\u0003") {
        process.exit(1);
      } else if (c === "\u007F" || c === "\b") {
        input = input.slice(0, -1);
      } else {
        input += c;
      }
    };

    stdin.on("data", onData);
  });
}
