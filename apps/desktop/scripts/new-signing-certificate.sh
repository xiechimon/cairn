#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <empty directory> <common name> <days valid>" >&2
  exit 2
fi
dir=$1
name=$2
days=$3

umask 077
mkdir -p "$dir"
if [ -n "$(ls -A "$dir")" ]; then
  echo "$dir is not empty; refusing to overwrite a signing identity" >&2
  exit 1
fi

cat > "$dir/openssl.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $name
[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF

openssl req -x509 -newkey rsa:3072 -nodes -days "$days" -sha256 -config "$dir/openssl.cnf" \
  -keyout "$dir/signing.key.pem" -out "$dir/signing.cert.pem" 2>/dev/null
openssl rand -base64 33 | tr -d '\n' > "$dir/p12-password"
openssl pkcs12 -export -inkey "$dir/signing.key.pem" -in "$dir/signing.cert.pem" -name "$name" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -passout file:"$dir/p12-password" -out "$dir/signing.p12"
openssl x509 -in "$dir/signing.cert.pem" -noout -subject -enddate -fingerprint -sha1
