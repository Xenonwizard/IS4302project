/**
 * Sealed envelopes: encrypt a message so that only the holder of one private key can read it,
 * using the recipient's public key published on-chain (SlabVault.encryptionKey).
 *
 *   1. make a one-time X25519 key pair for this message
 *   2. shared secret = X25519(one-time private key, recipient public key)
 *   3. encryption key = HKDF-SHA256(shared secret, salt = one-time public ‖ recipient public)
 *   4. ciphertext = XChaCha20-Poly1305(key, random 24-byte nonce, message)
 *
 *   envelope = 0x01 ‖ one-time public key (32) ‖ nonce (24) ‖ ciphertext + tag
 *
 * The recipient recomputes the same shared secret from its private key and the one-time public
 * key. Poly1305 makes any tampering fail decryption. Libraries: @noble/curves, @noble/ciphers,
 * @noble/hashes (audited, dependency-free). Works in the browser and on the server.
 */
import { x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, concatBytes, hexToBytes, keccak256, type Hex } from "viem";

const VERSION = 1;
const INFO = new TextEncoder().encode("pokechain-envelope-v1");

function deriveKey(shared: Uint8Array, ephemeralPub: Uint8Array, recipientPub: Uint8Array) {
  return hkdf(sha256, shared, concatBytes([ephemeralPub, recipientPub]), INFO, 32);
}

/** A key pair from a 32-byte secret: the private key stays with its owner, the public key goes on-chain. */
export function keyPairFromSecret(secret: Uint8Array) {
  return { privateKey: secret, publicKey: bytesToHex(x25519.getPublicKey(secret)) as Hex };
}

/** Encrypts `message` to `recipientPublicKey` (the bytes32 published on-chain). Returns hex bytes for the transaction. */
export function seal(recipientPublicKey: Hex, message: string): Hex {
  const recipient = hexToBytes(recipientPublicKey);
  const ephemeral = x25519.utils.randomPrivateKey();
  const ephemeralPub = x25519.getPublicKey(ephemeral);
  const key = deriveKey(x25519.getSharedSecret(ephemeral, recipient), ephemeralPub, recipient);
  const nonce = randomBytes(24);
  const sealed = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(message));
  return bytesToHex(concatBytes([new Uint8Array([VERSION]), ephemeralPub, nonce, sealed]));
}

/** Opens an envelope with the recipient's private key. Throws if it was for someone else or was altered. */
export function open(privateKey: Uint8Array, envelope: Hex): string {
  const bytes = hexToBytes(envelope);
  if (bytes[0] !== VERSION) throw new Error(`Unknown envelope version ${bytes[0]}`);
  const ephemeralPub = bytes.slice(1, 33);
  const nonce = bytes.slice(33, 57);
  const sealed = bytes.slice(57);
  const recipientPub = x25519.getPublicKey(privateKey);
  const key = deriveKey(x25519.getSharedSecret(privateKey, ephemeralPub), ephemeralPub, recipientPub);
  return new TextDecoder().decode(xchacha20poly1305(key, nonce).decrypt(sealed));
}

/**
 * The on-chain commitment: keccak256(salt ‖ message), the same formula as
 * SlabVault.verifyForwardCommitment (abi.encodePacked(salt, plaintext)).
 */
export function commit(message: string, salt: Hex): Hex {
  return keccak256(concatBytes([hexToBytes(salt), new TextEncoder().encode(message)]));
}

export const randomSalt = (): Hex => bytesToHex(randomBytes(32));
