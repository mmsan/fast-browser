# Fast Browser

Standalone public Chrome extension. A checkout builds using only its public source and dependencies. No external application source or private directory is required.

Run `npm ci`, then:

- `npm run dev`: live development on port 18000, output in `dist/public`.
- `npm run build`: builds `dist/public` and a timestamped ZIP in `release/public`.
- `npm run production`: the public release-package command, using the same build pipeline.

Load `dist/public` as an unpacked extension. Packaging does not install, upload or restart an extension. Enable only one related extension at a time. Changing the unpacked path can change its ID; keep the old installation until its stored settings have been checked.

## Shared application building

`tools/build-config.js` owns the shared Vite/CRXJS/Vue/archive configuration and manifest. `tools/cli.js` runs that same toolchain with an application's `vite.config.js`. Applications can depend on this package and compose their own entrypoints through the exported `build`, `manifest`, `content`, `background`, and `f` modules. All third-party versions and their lockfile are owned here; applications do not maintain duplicate dependency lists or UI assets.

`registerBackground(install)` supplies message handlers, shared tab state and tab lifecycle observation. Content scripts can add handlers through `registerSocketHandlers`. These APIs use application code bundled with that application's extension.

Generic source is in `src/`; `manifest.config.js` is the common manifest. Existing offscreen checks run with `node tests/offscreen-messaging.mjs`.

## License

MIT; see [LICENSE](LICENSE). Third-party dependencies retain their respective licenses.

## Security

The local Fast bridge currently assumes trusted peers and does not authenticate WebSocket senders. The existing `eval_` action remains subject to Chrome Manifest V3's content security policy.
