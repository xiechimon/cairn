const { signAsync } = require('@electron/osx-sign');

exports.default = async function signWithCairnCertificate(options) {
  const identity = process.env.CAIRN_MAC_SIGN_IDENTITY;
  if (!identity) return signAsync(options);
  return signAsync({
    ...options,
    identity,
    identityValidation: false,
    keychain: process.env.CAIRN_MAC_SIGN_KEYCHAIN,
  });
};
