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
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    });
    const muted = rl as typeof rl & {
      stdoutMuted?: boolean;
      _writeToOutput?: (value: string) => void;
    };

    const originalWrite = muted._writeToOutput?.bind(rl);
    muted.stdoutMuted = true;
    muted._writeToOutput = (value: string): void => {
      if (!muted.stdoutMuted) {
        originalWrite?.(value);
      }
    };

    process.stdout.write(question);
    rl.question("", (answer) => {
      muted.stdoutMuted = false;
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}
