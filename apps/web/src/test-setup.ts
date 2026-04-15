// Test setup for Bun's test runner. Registers a happy-dom global environment
// so React Testing Library can render components in `bun test`. This file is
// preloaded via apps/web/bunfig.toml [test].preload.
//
// Pure-function tests (no DOM access) still work — happy-dom installs window,
// document, navigator, etc. on the global, but does not interfere with
// computations that don't touch them.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
