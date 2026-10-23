// Plain-assertion test for the sealed envelope (node --test tests/unit/envelope.test.mts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, concatBytes, hexToBytes } from "viem";
import { commit, keyPairFromSecret, open, randomSalt, seal } from "../../src/lib/sealed/envelope.ts";

const collectorCrypt = keyPairFromSecret(hexToBytes(keccak256(new TextEncoder().encode("test cc secret"))));
const stranger = keyPairFromSecret(hexToBytes(keccak256(new TextEncoder().encode("someone else"))));
const message = JSON.stringify({ submissionId: "1", carrier: "SingPost", trackingNumber: "RR123456789SG" });

test("only the recipient can open it", () => {
  const envelope = seal(collectorCrypt.publicKey, message);
  assert.equal(open(collectorCrypt.privateKey, envelope), message);
  assert.throws(() => open(stranger.privateKey, envelope));
  assert.ok(!envelope.includes(Buffer.from("RR123456789SG").toString("hex")), "plaintext must not appear in the envelope");
});

test("tampering breaks it", () => {
  const envelope = seal(collectorCrypt.publicKey, message);
  const flipped = (envelope.slice(0, -2) + (envelope.endsWith("00") ? "01" : "00")) as `0x${string}`;
  assert.throws(() => open(collectorCrypt.privateKey, flipped));
});

test("commitment matches SlabVault.verifyForwardCommitment's formula", () => {
  const salt = randomSalt();
  const expected = keccak256(concatBytes([hexToBytes(salt), new TextEncoder().encode(message)]));
  assert.equal(commit(message, salt), expected);
  assert.notEqual(commit(message.replace("RR123", "RR999"), salt), expected);
});
