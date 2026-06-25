# Murl Desktop App Packaging Guide

This guide explains how to package the Murl desktop application into a single, self-contained portable Windows `.exe`.

## Build Environment Requirements

To package Murl, you need:
- **Node.js**: Version 22.x or later (which supports the built-in `node:sqlite` module used by the app's database storage).
- **pnpm**: Version 9.x or later.
- **Windows Build Tools** (for `node-pty` native compilation):
  - On Windows: Visual Studio Build Tools (C++ development workload) and Python. These are automatically invoked by `pnpm install` during the native compilation phase of the native dependency `node-pty`.

---

## Reproducible Build Pipeline

To build a fresh portable `.exe` from a clean repository clone:

1. **Clone the Repository**:
   ```bash
   git clone <repository-url>
   cd murl_2_new
   ```

2. **Install Workspace Dependencies**:
   This command installs all node modules and compiles native dependencies (like `node-pty`):
   ```bash
   pnpm install
   ```

3. **Verify Code Quality**:
   Verify that tests, lints, and types check out successfully:
   ```bash
   pnpm typecheck
   ```

4. **Package the Windows Portable Executable**:
   Execute the unified packaging script from the root of the project:
   ```bash
   pnpm package:win
   ```

   This script automatically:
   - Builds the `@murl/core` workspace package.
   - Builds the main, preload, and renderer packages of the desktop app using `electron-vite`.
   - Runs `electron-builder` to package the compiled code and native libraries.

5. **Locate the Packaged Binary**:
   Once the packaging completes, you can find the self-contained portable executable in the desktop app's output folder:
   ```
   apps/desktop/dist/Murl-Portable-1.0.0.exe
   ```

---

## Packaging Configurations

The configurations are defined in [apps/desktop/electron-builder.json](file:///c:/Content/murl_2_new/apps/desktop/electron-builder.json):

- **Target**: `portable` target produces a single self-contained executable with no setup wizard or registry footprint.
- **File Inclusions**: Only compiled assets (`out/`), runtime images (`resources/`), and `package.json` are packaged inside the ASAR archive. Source files, documentation, lints, and tests are excluded.
- **ASAR & Native Modules**:
  - `asar: true` is enabled for speed and packaging standards.
  - `asarUnpack: ["**/node-pty/**/*"]` is configured because Electron cannot execute native `.node` libraries (from `node-pty`) directly from within the compressed ASAR archive. Electron automatically unpacks these native dependencies to an external `app.asar.unpacked/` folder next to the ASAR at runtime.

---

## macOS Packaging Status (Unverified)

The `mac` targets are pre-configured to build a macOS `.dmg` and a `.zip` archive containing the `.app` package:
- Target icons are set to use the high-resolution app icon.
- **Verification Note**: Due to local development environments being exclusively Windows, these macOS targets have **not been tested or verified** on physical macOS hardware. They are configured correctly per Electron specifications but remain unverified.
- **Signing & Notarization**: Code signing and notarization are currently disabled and deferred. Building and running unsigned binaries on macOS may require the user to clear quarantine flags manually (e.g. `xattr -cr Murl.app`).
