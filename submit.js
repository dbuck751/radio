
// Submission flow using Nostr instead of a PHP backend.
// Submitters connect their wallet, we derive a deterministic Nostr keypair
// from a wallet signature (same pattern as the rest of UBNet), then publish
// a signed Nostr event containing the CID + metadata to a relay.
//
// Approval becomes: query the relay for events tagged with our submission
// tag, review them, and copy approved ones into tracks.json by hand (or
// with a small script later).

import { generateSecretKey, getPublicKey, finalizeEvent } from "https://esm.sh/nostr-tools@2.10.4/pure";
import { Relay } from "https://esm.sh/nostr-tools@2.10.4/relay";
import { sha256 } from "https://esm.sh/@noble/hashes@1.5.0/sha256";
import { utf8ToBytes } from "https://esm.sh/@noble/hashes@1.5.0/utils";

const GATEWAY = "https://jade-faithful-wolf-918.mypinata.cloud/ipfs/";
const FALLBACK_GATEWAY = "https://ipfs.io/ipfs/";
const RELAY_URL = "wss://relay.damus.io"; // swap for your actual UBNet relay
const SUBMISSION_TAG = "dessert-rock-radio-submission";

let userWallet = null;
let signer = null;
let loadedMetadata = null;
let loadedCid = null;
let nostrSecretKey = null;
let nostrPublicKey = null;

const folderCidInput = document.getElementById("folderCid");
const previewBtn = document.getElementById("previewBtn");
const previewBox = document.getElementById("previewBox");
const connectBtn = document.getElementById("connectBtn");
const submitBtn = document.getElementById("submitBtn");
const walletStatus = document.getElementById("walletStatus");
const statusMsg = document.getElementById("statusMsg");

previewBtn.addEventListener("click", previewMetadata);
connectBtn.addEventListener("click", connectWallet);
submitBtn.addEventListener("click", submitTrack);

async function fetchJsonWithFallback(path) {
  try {
    const res = await fetch(GATEWAY + path);
    if (!res.ok) throw new Error("primary gateway failed");
    return await res.json();
  } catch {
    const res = await fetch(FALLBACK_GATEWAY + path);
    if (!res.ok) throw new Error("fallback gateway also failed");
    return await res.json();
  }
}

async function previewMetadata() {
  const cid = folderCidInput.value.trim();
  if (!cid) {
    statusMsg.innerText = "Paste a CID first.";
    return;
  }

  statusMsg.innerText = "Fetching metadata...";
  previewBox.style.display = "none";
  submitBtn.disabled = true;

  try {
    const metadata = await fetchJsonWithFallback(`${cid}/metadata.json`);

    if (!metadata.name || !metadata.artist) {
      statusMsg.innerText = "metadata.json is missing required fields (name, artist).";
      return;
    }

    loadedMetadata = metadata;
    loadedCid = cid;

    document.getElementById("previewTitle").innerText = metadata.name;
    document.getElementById("previewArtist").innerText = metadata.artist;
    document.getElementById("previewStation").innerText =
      "Genre: " + (metadata.genre || "unspecified");

    const artImg = document.getElementById("previewArt");
    artImg.onerror = function () {
      if (this.src.includes("artwork.png")) {
        this.onerror = function () { this.onerror = null; this.src = ""; };
        this.src = GATEWAY + cid + "/artwork.jpg";
      } else {
        this.onerror = null;
        this.src = "";
      }
    };
    artImg.src = GATEWAY + cid + "/artwork.png";

    previewBox.style.display = "block";
    statusMsg.innerText = "Looks good — connect your wallet to submit.";

    if (userWallet) submitBtn.disabled = false;
  } catch (err) {
    console.error(err);
    statusMsg.innerText =
      "Couldn't load metadata.json from that CID. Check the CID and that the folder contains metadata.json.";
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    walletStatus.innerText = "No wallet found — install MetaMask.";
    return;
  }

  const provider = new ethers.BrowserProvider(window.ethereum);
  const accounts = await provider.send("eth_requestAccounts", []);
  userWallet = accounts[0];
  signer = await provider.getSigner();

  // Derive a deterministic Nostr keypair from a wallet signature.
  // Signing the same message always produces the same signature for a
  // given wallet, so we hash that signature into a 32-byte secret key.
  // This matches the "wallet-derived keypair" pattern used elsewhere in
  // UBNet's Nostr integration.
  statusMsg.innerText = "Deriving signing key from wallet...";
  const derivationMessage = "UBNet Nostr key derivation v1";
  const sig = await signer.signMessage(derivationMessage);
  const hash = sha256(utf8ToBytes(sig));
  nostrSecretKey = hash; // Uint8Array, 32 bytes — valid as a Nostr secret key
  nostrPublicKey = getPublicKey(nostrSecretKey);

  walletStatus.innerText = `Connected: ${userWallet}`;
  connectBtn.innerText = "Wallet Connected";
  connectBtn.disabled = true;

  if (loadedMetadata) submitBtn.disabled = false;
  statusMsg.innerText = "Ready to submit.";
}

async function submitTrack() {
  if (!loadedMetadata || !loadedCid || !userWallet || !nostrSecretKey) {
    statusMsg.innerText = "Preview a CID and connect your wallet first.";
    return;
  }

  const station = document.getElementById("stationPick").value;

  submitBtn.disabled = true;
  statusMsg.innerText = "Publishing submission...";

  try {
    const payload = {
      ...loadedMetadata,
      cid: loadedCid,
      station,
      wallet: userWallet
    };

    const event = {
      kind: 30078, // application-specific data, per NIP-78 convention
      created_at: Math.floor(Date.now() / 1000),
      pubkey: nostrPublicKey,
      tags: [
        ["t", SUBMISSION_TAG],
        ["d", `${SUBMISSION_TAG}:${loadedCid}`], // dedupe key for replaceable events
        ["station", station],
        ["cid", loadedCid],
        ["wallet", userWallet]
      ],
      content: JSON.stringify(payload)
    };

    const signedEvent = finalizeEvent(event, nostrSecretKey);

    const relay = await Relay.connect(RELAY_URL);
    await relay.publish(signedEvent);
    relay.close();

    statusMsg.innerText = "Submitted! Your track is pending approval.";
  } catch (err) {
    console.error(err);
    statusMsg.innerText = "Submission failed. Check console for details.";
    submitBtn.disabled = false;
  }
}
