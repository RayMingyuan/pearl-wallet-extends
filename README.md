# Pearla

English | [中文](README.zh.md)

Pearla is a community-edition Pearl wallet extension for Chrome. Secure, open source, simple, and free.

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/pearla/malecdccgdfbifciokeicccacfjbodcn).

## What it does

- Create a 12-word or 24-word wallet, or import an English recovery phrase or a hexadecimal seed
- Keep one vault per installation, with multiple derived accounts that can be renamed
- Add watch-only addresses to view a balance without holding the keys
- Show a receive address and its QR code
- Send on Pearl mainnet or testnet. Signing requires the password. A broadcast whose result is unknown is not sent again automatically
- Show recent activity, and open a transaction in the public block explorer for that network
- Show a US dollar value from a public price quote
- In Settings, change the language, auto-lock time, network, and indexer, and view the recovery phrase or change the password

## Install from source

Node.js 22 or later, and Chrome 113 or later, are required.

```sh
npm ci
npm run build
```

`npm run build` writes a loadable `dist/`. In Chrome, open `chrome://extensions`, turn on Developer mode, choose "Load unpacked", and select `dist/`. Load `dist/`, not `src/`. `src/manifest.json` is only a build input.

The release archive takes a version:

```sh
npm run pack -- 1.0.0
```

The output is `artifacts/pearla-release-v1.0.0.zip`. `manifest.json` is at the root of the archive. Submit that zip to the Chrome Web Store, or unpack it and load it as above.

## Development

Run the full test suite:

```sh
npm test
```

The command builds the release package and the local simnet package, then runs the tests. Tests use public fixtures and simulated responses. They do not sign or broadcast with user funds.

Local simnet is for development only and is not part of the store package. Provide your own `pearld`:

```sh
npm run dev:simnet -- /absolute/path/to/pearld
```

`npm run pack:simnet` builds a local verification package. Do not upload it to the Chrome Web Store.

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 RayMingyuan.
