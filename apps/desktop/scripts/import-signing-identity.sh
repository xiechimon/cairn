#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <p12> <p12 password file> <expected certificate pem>" >&2
  exit 2
fi
p12=$1
password_file=$2
expected_cert=$3
: "${RUNNER_TEMP:?RUNNER_TEMP is not set}"
: "${GITHUB_ENV:?GITHUB_ENV is not set}"

identity=$(openssl x509 -in "$expected_cert" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d ':')
keychain="$RUNNER_TEMP/cairn-signing.keychain-db"
keychain_password=$(openssl rand -hex 24)

security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$p12" -k "$keychain" -f pkcs12 -P "$(cat "$password_file")" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
existing=$(security list-keychains -d user | tr -d '"' | xargs)
security list-keychains -d user -s "$keychain" $existing

if ! security find-certificate -a -Z "$keychain" | grep -qi "SHA-1 hash: $identity"; then
  echo "the imported p12 does not hold the certificate in $expected_cert" >&2
  security delete-keychain "$keychain"
  exit 1
fi

echo "CAIRN_MAC_SIGN_IDENTITY=$identity" >> "$GITHUB_ENV"
echo "CAIRN_MAC_SIGN_KEYCHAIN=$keychain" >> "$GITHUB_ENV"
echo "imported signing identity $identity"
