import { getPublicKey, finalizeEvent } from "https://esm.sh/nostr-tools@2.10.4/pure";
import { Relay } from "https://esm.sh/nostr-tools@2.10.4/relay";
import { sha256 } from "https://esm.sh/@noble/hashes@1.5.0/sha256";
import { utf8ToBytes } from "https://esm.sh/@noble/hashes@1.5.0/utils";

const PRIMARY_GATEWAY = "https://jade-faithful-wolf-918.mypinata.cloud/ipfs/";
const FALLBACK_GATEWAY = "https://ipfs.io/ipfs/";
const RELAY_URL = "wss://relay.damus.io";

const player = document.getElementById("player");

let stations = {};
let currentStation = "desert";
let queue = [];
let queueIndex = 0;

let relay = null;
let likeSub = null;
let nostrSecretKey = null;
let nostrPublicKey = null;
let walletAddress = null;
let likedTracks = JSON.parse(localStorage.getItem("srr-likes") || "{}");

// --- IPFS ---

function resolveUrl(folderCid, filename) {
  return PRIMARY_GATEWAY + folderCid + "/" + encodeURIComponent(filename);
}

// --- Stations ---

async function loadStations() {
  const res = await fetch("https://dbloops.com/radio/tracks.json");
  stations = await res.json();
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function switchStation(key) {
  currentStation = key;
  queue = shuffle(stations[key] || []);
  queueIndex = 0;

  document.querySelectorAll(".station").forEach((el) => {
    el.classList.toggle("active", el.dataset.station === key);
  });

  playCurrent();
}

function playCurrent() {
  const track = queue[queueIndex];
  if (!track) {
    document.getElementById("title").innerText = "No tracks yet";
    document.getElementById("artist").innerText = "Be the first to submit one!";
    document.getElementById("description").innerText = "";
    document.getElementById("upNextTitle").innerText = "—";
    document.getElementById("upNextArtist").innerText = "—";
    return;
  }

  document.getElementById("title").innerText = track.name || "Untitled";
  document.getElementById("artist").innerText = track.artist || track.author || "Unknown Artist";
  document.getElementById("description").innerText = track.description || "";

  const artEl = document.getElementById("art");
  const imageFile = track.image || "artwork.png";
  artEl.onerror = function () {
    if (!track.image && imageFile === "artwork.png") {
      this.onerror = function () { this.onerror = null; this.src = "assets/desert-bg.png"; };
      this.src = resolveUrl(track.folder_cid, "artwork.jpg");
    } else {
      this.onerror = null;
      this.src = "assets/desert-bg.png";
    }
  };
  artEl.src = resolveUrl(track.folder_cid, imageFile);

  player.src = resolveUrl(track.folder_cid, track.audio || "song.mp3");
  player.play().catch(() => {});

  pushRecentlyPlayed(track);
  updateUpNext();
  updateLikeUI(track);
  if (relay) subscribeToLikes(track);
}

function loadNext() {
  if (queue.length === 0) return;
  queueIndex = (queueIndex + 1) % queue.length;
  playCurrent();
}

// --- Recently Played ---

const recentBoxes = document.querySelectorAll(".recent-song");
let recentTitles = [];

function pushRecentlyPlayed(track) {
  recentTitles.unshift(`${track.name} — ${track.artist || track.author}`);
  recentTitles = recentTitles.slice(0, 3);
  recentTitles.forEach((t, i) => {
    if (recentBoxes[i]) recentBoxes[i].innerText = t;
  });
}

// --- Up Next ---

function updateUpNext() {
  const next = queue[(queueIndex + 1) % queue.length];
  document.getElementById("upNextTitle").innerText = next ? (next.name || "Untitled") : "—";
  document.getElementById("upNextArtist").innerText = next ? (next.artist || next.author || "Unknown") : "—";
}

// --- Wallet ---

async function connectWallet() {
  if (!window.ethereum) {
    alert("No wallet found — install MetaMask.");
    return;
  }

  const { BrowserProvider } = await import("https://esm.sh/ethers@6.13.2");
  const provider = new BrowserProvider(window.ethereum);
  const accounts = await provider.send("eth_requestAccounts", []);
  walletAddress = accounts[0];
  const signer = await provider.getSigner();

  const sig = await signer.signMessage("UBNet Nostr key derivation v1");
  const hash = sha256(utf8ToBytes(sig));
  nostrSecretKey = hash;
  nostrPublicKey = getPublicKey(nostrSecretKey);

  updateWalletUI();
}

function updateWalletUI() {
  const btn = document.getElementById("connectWalletBtn");
  const addrEl = document.getElementById("walletAddr");
  btn.innerText = "Connected";
  btn.disabled = true;
  addrEl.innerText = walletAddress.slice(0, 6) + "..." + walletAddress.slice(-4);
}

// --- Likes ---

function likeTag(track) {
  return `srr-${track.folder_cid}`;
}

function subscribeToLikes(track) {
  if (likeSub) { likeSub.close(); likeSub = null; }
  let count = 0;
  likeSub = relay.subscribe([{ kinds: [7], "#t": [likeTag(track)] }], {
    onevent() {
      count++;
      document.getElementById("likeCount").innerText = count;
    },
    oneose() {}
  });
}

function updateLikeUI(track) {
  const btn = document.getElementById("likeBtn");
  btn.classList.toggle("liked", !!likedTracks[track.folder_cid]);
  document.getElementById("likeCount").innerText = "0";
}

async function handleLike() {
  const track = queue[queueIndex];
  if (!track) return;

  if (!nostrSecretKey) {
    await connectWallet();
    if (!nostrSecretKey) return;
  }

  if (likedTracks[track.folder_cid]) return;

  const event = finalizeEvent({
    kind: 7,
    content: "+",
    created_at: Math.floor(Date.now() / 1000),
    tags: [["t", likeTag(track)]]
  }, nostrSecretKey);

  await relay.publish(event);

  likedTracks[track.folder_cid] = true;
  localStorage.setItem("srr-likes", JSON.stringify(likedTracks));
  updateLikeUI(track);
}

// --- Audio events ---

player.addEventListener("error", () => {
  const track = queue[queueIndex];
  if (!track) return;
  if (!player.src.includes(FALLBACK_GATEWAY)) {
    player.src = FALLBACK_GATEWAY + track.folder_cid + "/" + encodeURIComponent(track.audio);
    player.play().catch(() => {});
  }
});

player.addEventListener("ended", loadNext);

// --- UI events ---

document.querySelectorAll(".station").forEach((el) => {
  el.addEventListener("click", () => switchStation(el.dataset.station));
});

document.getElementById("skipBtn").addEventListener("click", loadNext);
document.getElementById("likeBtn").addEventListener("click", handleLike);
document.getElementById("connectWalletBtn").addEventListener("click", connectWallet);

// --- Init ---

async function init() {
  await loadStations();
  try {
    relay = await Relay.connect(RELAY_URL);
  } catch (e) {
    console.warn("Relay connection failed, likes unavailable:", e);
  }
  switchStation(currentStation);
}

init();
