# Mac app signing certificate

Every Mac release is signed with one self-signed code-signing certificate that Cairn owns. It is not an Apple certificate: there is no Developer ID, no notarization and no hardened runtime, so Gatekeeper still asks before the first launch. Its purpose is a stable designated requirement, `identifier "io.github.xiechimon.cairn" and certificate leaf = H"<fingerprint>"` (macOS may write `root` for a self-signed certificate). macOS ties Accessibility and Screen Recording grants to that requirement, so they survive updates. An ad-hoc signature's requirement is the build's cdhash, so every update drops them.

| Item | Value |
|---|---|
| Subject | `CN=Cairn Mac Self-Signed, O=xiechimon` |
| SHA-1 fingerprint | `19AA592374DC19928A4C5494BCAC5A984182EA8A` |
| Key | RSA 3072 |
| Valid until | 2046-11-11 |
| Created | 2026-11-16 on omarchy, by the same steps as `apps/desktop/scripts/new-signing-certificate.sh` |

## Where it lives

| Copy | Location | Who can read it |
|---|---|---|
| Public certificate | `apps/desktop/signing/cairn-mac-self-signed.crt` in this repository | anyone; it holds no key |
| Private key, certificate, PKCS#12 and its password | `~/.config/cairn/desktop-signing/` on omarchy: the directory is mode 0700, every file 0600 (`signing.key.pem`, `signing.cert.pem`, `signing.p12`, `p12-password`, `openssl.cnf`) | the `ian` account on omarchy |
| CI | GitHub environment `desktop-release`, secrets `MAC_SIGNING_P12_BASE64` (the base64 PKCS#12) and `MAC_SIGNING_P12_PASSWORD`. The environment admits deployments from `main` only, and only the `release` job of `desktop-release.yml` names it | release runs on `main`; GitHub secrets cannot be read back |

The repository ignores `*.pem` and `*.key`, which is why the public certificate is committed as `.crt`. Never commit anything from `~/.config/cairn/desktop-signing/`.

Pull requests never see the key. `desktop-mac.yml` creates a throwaway certificate on the runner, signs with it and runs the same check. `desktop-release.yml` imports the release PKCS#12 into a temporary keychain (`apps/desktop/scripts/import-signing-identity.sh`), signs through `apps/desktop/scripts/sign-mac.cjs`, checks both update zips with `apps/desktop/scripts/check-signature.mjs` before publishing, and deletes the keychain at the end.

## Backup

GitHub is not a backup, because its secrets cannot be read back. The only readable copy is the one on omarchy, so keep one encrypted copy away from that disk:

```bash
tar -C ~/.config/cairn -c desktop-signing \
  | gpg --symmetric --cipher-algo AES256 -o ~/backups/desktop-signing-$(date -u +%Y%m%d).tar.gpg
```

Copy the `.tar.gpg` file to the off-host backup destination used for the server backups (`CAIRN_BACKUP_REMOTE`). Keep the gpg passphrase in the owner's password manager, never next to the file. To restore it:

```bash
install -d -m 700 ~/.config/cairn
gpg -d desktop-signing-<date>.tar.gpg | tar -C ~/.config/cairn -x
```

## Losing it or leaking it

- **Lost key, no backup:** make a new certificate and rotate (below). Installed apps keep updating, because the updater checks only the zip's SHA-256. After that update, each user grants Accessibility and Screen Recording again, once.
- **Leaked key:** anyone holding it can sign a binary that macOS treats as Cairn for those grants. Rotate at once and delete the two old secrets; users grant again once.

## Rotating

1. `apps/desktop/scripts/new-signing-certificate.sh ~/.config/cairn/desktop-signing-<date> "Cairn Mac Self-Signed" 7300`.
2. Store the new PKCS#12 and its password in the environment. The values go through stdin, so they never appear in the shell history or on a command line:
   ```bash
   base64 -w0 signing.p12 | gh secret set MAC_SIGNING_P12_BASE64 --repo xiechimon/cairn --env desktop-release
   gh secret set MAC_SIGNING_P12_PASSWORD --repo xiechimon/cairn --env desktop-release < p12-password
   ```
3. In one PR, replace `apps/desktop/signing/cairn-mac-self-signed.crt` and the fingerprint in `apps/desktop/scripts/check-signature.test.mjs` and in this file. Releases fail their signature check until the secrets and the committed certificate match.
4. Make a new backup and move the old directory out of the way.

## Checking an installed app

```bash
codesign -d -r- /Applications/Cairn.app
```

The `designated =>` line must name `io.github.xiechimon.cairn` and the fingerprint above.
