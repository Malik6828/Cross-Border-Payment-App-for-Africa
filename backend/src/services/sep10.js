/**
 * SEP-10 web-auth challenge/response.
 *
 * home_domain matching rule (see BE-014):
 * The challenge transaction's manage_data operation name MUST be exactly
 * `${HOME_DOMAIN} auth` — an EXACT, CASE-SENSITIVE string comparison against
 * the server's configured home domain. No substring, prefix, or suffix match
 * is permitted, and the domain is never normalized (no case-folding, no
 * trailing-dot stripping) before comparison, because doing so would let a
 * client authenticate a transaction whose operation name reads e.g.
 * `afripay.app.attacker.com auth`, `AfriPay.App auth`, or `afripay.app. auth`
 * as if it were `afripay.app auth`. Any deviation is rejected.
 */
const StellarSDK = require('@stellar/stellar-sdk');
const crypto = require('crypto');
const db = require('../db');

const SERVER_KEYPAIR = StellarSDK.Keypair.random();
const CHALLENGE_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const HOME_DOMAIN = process.env.SEP10_HOME_DOMAIN || 'afripay.app';

function generateChallenge(clientPublicKey) {
  const server = StellarSDK.Keypair.fromPublicKey(SERVER_KEYPAIR.publicKey());
  const client = StellarSDK.Keypair.fromPublicKey(clientPublicKey);

  const transaction = new StellarSDK.TransactionBuilder(
    new StellarSDK.Account(server.publicKey(), '0'),
    {
      fee: StellarSDK.BASE_FEE,
      networkPassphrase: process.env.STELLAR_NETWORK === 'mainnet'
        ? StellarSDK.Networks.PUBLIC_NETWORK_PASSPHRASE
        : StellarSDK.Networks.TESTNET_NETWORK_PASSPHRASE
    }
  )
    .addOperation(
      StellarSDK.Operation.manageData({
        name: `${HOME_DOMAIN} auth`,
        value: crypto.randomBytes(32).toString('hex')
      })
    )
    .setTimeout(CHALLENGE_TIMEOUT / 1000)
    .build();

  transaction.sign(server);
  return transaction.toEnvelope().toXDR('base64');
}

function verifyChallenge(clientPublicKey, signedXDR) {
  try {
    const transaction = StellarSDK.TransactionEnvelope.fromXDR(
      signedXDR,
      process.env.STELLAR_NETWORK === 'mainnet'
        ? StellarSDK.Networks.PUBLIC_NETWORK_PASSPHRASE
        : StellarSDK.Networks.TESTNET_NETWORK_PASSPHRASE
    );

    const tx = transaction.transaction();

    // Exact, case-sensitive match on the manage_data operation name against
    // the configured home domain. Reject anything that merely contains,
    // starts with, or ends with the expected value (sub-domain spoofing,
    // trailing-dot spoofing, case-mismatch spoofing).
    const expectedName = `${HOME_DOMAIN} auth`;
    const manageDataOp = (tx.operations || []).find(op => op.type === 'manageData');
    if (!manageDataOp || manageDataOp.name !== expectedName) return false;

    // Verify server signed it
    const serverSigned = transaction.signatures.some(sig => {
      try {
        StellarSDK.Keypair.fromPublicKey(SERVER_KEYPAIR.publicKey()).verify(
          tx.hash(),
          sig.signature()
        );
        return true;
      } catch {
        return false;
      }
    });

    if (!serverSigned) return false;

    // Verify client signed it
    const clientSigned = transaction.signatures.some(sig => {
      try {
        StellarSDK.Keypair.fromPublicKey(clientPublicKey).verify(
          tx.hash(),
          sig.signature()
        );
        return true;
      } catch {
        return false;
      }
    });

    return clientSigned;
  } catch (err) {
    return false;
  }
}

module.exports = {
  generateChallenge,
  verifyChallenge,
  SERVER_KEYPAIR,
  HOME_DOMAIN
};
