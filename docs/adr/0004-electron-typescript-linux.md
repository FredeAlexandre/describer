# Electron, TypeScript, Vite, and Vitest on Linux first

The first platform is Linux on a machine with Node and no Rust toolchain. The desktop shell is Electron; the Describer core is a TypeScript module that both the window and the tests import. Vite builds the renderer; Vitest drives the core tests. The Library lives under XDG (`$XDG_DATA_HOME/describer/library`, default `~/.local/share/describer/library`).

**Considered options:** Electron + TypeScript + Vite + Vitest (chosen); Tauri (needs a Rust toolchain this machine does not have); GTK or Flutter (weaker fit for a TypeScript core and an HTML media player later).
