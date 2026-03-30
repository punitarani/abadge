import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Promisified execFile for shelling out to CLI tools (op, aws, etc.). */
export const execFileAsync = promisify(execFile);
