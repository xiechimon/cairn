import { KeyObject, randomBytes, webcrypto } from 'node:crypto';
import {
  BasicConstraintsExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from '@peculiar/x509';

export async function certificates(name) {
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const rootKeys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const leafKeys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const validity = {
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 3_600_000),
    signingAlgorithm: algorithm,
  };
  const root = await X509CertificateGenerator.createSelfSigned(
    {
      ...validity,
      serialNumber: randomBytes(16).toString('hex'),
      name: `CN=${name} prototype root`,
      keys: rootKeys,
      extensions: [
        new BasicConstraintsExtension(true, 0, true),
        new KeyUsagesExtension(KeyUsageFlags.keyCertSign, true),
      ],
    },
    webcrypto,
  );
  const leaf = await X509CertificateGenerator.create(
    {
      ...validity,
      serialNumber: randomBytes(16).toString('hex'),
      subject: `CN=${name}`,
      issuer: root.subject,
      publicKey: leafKeys.publicKey,
      signingKey: rootKeys.privateKey,
      extensions: [
        new BasicConstraintsExtension(false, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new SubjectAlternativeNameExtension([{ type: 'dns', value: name }]),
      ],
    },
    webcrypto,
  );
  return {
    ca: root.toString('pem'),
    cert: leaf.toString('pem'),
    key: KeyObject.from(leafKeys.privateKey).export({ type: 'pkcs8', format: 'pem' }),
  };
}
