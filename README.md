# Fast Browser

Standalone public Chrome extension. A checkout builds using only its public source and dependencies. No external application source or private directory is required.

Run `npm ci`, then:

- `npm run dev`: watch shared/application sources and automatically build a self-contained `dist`. Successful builds reload the extension and content pages; no development server or port is required. Stopping dev keeps the last successful bundle usable. Failed builds leave `dist` unchanged.
- `npm run build`: builds `dist` and a timestamped ZIP in `release`.
- `npm run production`: the public release-package command, using the same build pipeline.

Load `dist` as an unpacked extension. Packaging does not install, upload or restart an extension. Enable only one related extension at a time. Changing the unpacked path can change its ID; keep the old installation until its stored settings have been checked.

## Shared application building

`tools/build-config.js` owns the shared Vite/CRXJS/Vue/archive configuration and manifest. `tools/cli.js` runs that same toolchain with an application's `vite.config.js`. Applications can depend on this package and compose their own entrypoints through the exported `build`, `manifest`, `content`, `background`, and `f` modules. All third-party versions and their lockfile are owned here; applications do not maintain duplicate dependency lists or UI assets.

`registerBackground(install)` supplies message handlers, shared tab state and tab lifecycle observation. Content scripts can add handlers through `registerSocketHandlers`. These APIs use application code bundled with that application's extension.

Generic source is in `src/`; `manifest.config.js` is the common manifest. Existing offscreen checks run with `node tests/offscreen-messaging.mjs`.

## License

MIT; see [LICENSE](LICENSE). Third-party dependencies retain their respective licenses.

## Security

On Windows, extensions installed from an application-approved output connect automatically when Fast is running. No pairing code or port setup is required. The normal popup shows connection status and Pause/Resume; data and website controls remain under Advanced settings. Installation enables the local connection, URL/title/tab metadata, ordinary page-content sharing and existing browser actions; users can pause or limit these controls. Password/OTP/card reads, website-triggered messages and user scripts still require their separate grants. Existing saved settings and deliberate pauses survive builds and live reloads.

Use the matching FastGoTo Host, FastJS runtime and extension. The runtime registers only exact application-approved extension origins through the current user's `com.fastgoto.browser` native host. On every connection the helper asks the Host to verify its actual process/browser identity and issue a one-use bootstrap, bound to the extension, admitted PID and current Node session, expiring within 30 seconds. Registration files contain no keys. Bootstrap keys and tickets stay in memory; upgrades remove legacy `bridgeKey` and `bridgeKeyMode` storage without changing consent or Pause settings. Both peers prove the bootstrap with fresh nonce challenges before any application messages, then use ordered directional AES-256-GCM frames bounded to 2 MiB. Host authorization loss closes existing sessions. Content scripts receive neither keys nor sockets. Legacy/manual keys, plaintext sockets and browser use of native editor routes are rejected. Native setup uses the current user and needs no new network port or administrator prompt.

The popup independently controls URL/title/tab metadata, page-content sharing and browser automation. Password, OTP and sensitive card input reads need an additional website grant. Local files keep Chrome's existing file-access toggle and use an exact-document grant instead of a shared opaque origin. Shift still supplies the existing button-label list after consent. Bundled application rules retain their messages and actions. The DOM `send` event is a separate website-controlled entrypoint: it is denied by default and requires an exact-origin message-type grant. Such a grant trusts that website's scripts to invoke those named local handlers. Disabling page-content sharing also stops these website events.

The `eval_` message remains available for scripts supplied by the user, through Chrome's `userScripts.execute` API rather than extension `eval`. Enable it separately for the current website, grant the optional userScripts/site permissions and enable Chrome's Allow User Scripts switch (Chrome 135+; before 138, Developer mode). The user-script world is separate from the extension's content-script globals. Bundled application handlers do not need this permission.

Development uses the same public build pipeline, with isolated staging output and no release ZIP per save. Assets are copied before entrypoints, and a local build marker is committed last. Old assets remain available for open pages until a clean build. Only the development bundle checks its own marker through the existing offscreen document; the background accepts reload notices only from that exact extension document. Production builds contain no development polling or development-server dependency. Restart the dev command after changing build tooling.
