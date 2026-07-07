const UBNET_API = "https://my.eth-ub.net";
let ubnetClient = null;
function getUBNetClient() {
  if (!ubnetClient) ubnetClient = window.UBNet.createClient({ apiBase: UBNET_API });
  return ubnetClient;
}

const PRIMARY_GATEWAY = "https://jade-faithful-wolf-918.mypinata.cloud/ipfs/";
const FALLBACK_GATEWAY = "https://ipfs.io/ipfs/";
const ADS = [
  "https://dbloops.com/radio2/ads/ad1.mp3",
  "https://dbloops.com/radio2/ads/ad2.mp3"
];

function randomAdInterval() {
  return Math.floor(Math.random() * 4) + 2;
}

let adQueue = [];
function getNextAd() {
  if (adQueue.length === 0) adQueue = shuffle([...ADS]);
  return adQueue.pop();
}

const player = document.getElementById("player");

let stations = {};
let currentStation = "desert";
let queue = [];
let queueIndex = 0;

let songCount = 0;
let adThreshold = randomAdInterval();
let isPlayingAd = false;

let walletAddress = null;
let likedTracks = JSON.parse(localStorage.getItem("srr-likes") || "{}");

// --- IPFS ---

function resolveUrl(folderCid, filename) {
  return PRIMARY_GATEWAY + folderCid + "/" + encodeURIComponent(filename);
}

// --- Stations ---

async function loadStations() {
  const res = await fetch("https://dbloops.com/radio2/tracks.json");
  stations = await res.json();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleAvoid(arr, avoid) {
  const a = shuffle(arr);
  if (avoid && a.length > 1 && a[0].folder_cid === avoid.folder_cid) {
    const i = Math.floor(Math.random() * (a.length - 1)) + 1;
    [a[0], a[i]] = [a[i], a[0]];
  }
  return a;
}

function switchStation(key) {
  isPlayingAd = false;
  songCount = 0;
  adThreshold = randomAdInterval();
  document.getElementById("likeBtn").disabled = false;
  document.getElementById("nextStationBtn").disabled = false;
  document.querySelector(".now-playing-label").innerHTML = "&#9654; NOW PLAYING";

  currentStation = key;
  queue = shuffle(stations[key] || []);
  queueIndex = 0;

  document.querySelectorAll(".station").forEach((el) => {
    el.classList.toggle("active", el.dataset.station === key);
  });

  playCurrent();
}

function playAd() {
  isPlayingAd = true;
  const ad = getNextAd();

  document.getElementById("artLoader").style.display = "none";
  document.getElementById("title").innerText = "Commercial Break";
  document.getElementById("artist").innerText = "Stoner Rock Radio";
  document.getElementById("description").innerText = "";
  document.getElementById("art").src = "assets/ad-break.png";
  document.getElementById("upNextTitle").innerText = "—";
  document.getElementById("upNextArtist").innerText = "—";
  document.querySelector(".now-playing-label").innerHTML = "&#128277; COMMERCIAL BREAK";
  document.getElementById("likeBtn").disabled = true;
  document.getElementById("nextStationBtn").disabled = true;

  player.src = ad;
  player.play().catch(() => {});
}

function playCurrent() {
  document.getElementById("artLoader").style.display = "none";
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
  document.getElementById("artist").innerText = track.author || "Unknown Artist";
  document.getElementById("description").innerText = track.description || "";

  const artEl = document.getElementById("art");
  artEl.onerror = function () {
    this.onerror = null;
    this.src = "assets/desert-bg.png";
  };
  artEl.src = resolveUrl(track.folder_cid, track.image);

  player.src = resolveUrl(track.folder_cid, track.audio);
  player.play().catch(() => {});

  pushRecentlyPlayed(track);
  updateUpNext();
  updateLikeUI(track);
  fetchLikeCount(track);
}

function loadNext() {
  if (queue.length === 0) return;
  songCount++;
  if (songCount >= adThreshold) {
    songCount = 0;
    adThreshold = randomAdInterval();
    playAd();
    return;
  }
  const lastTrack = queue[queueIndex];
  queueIndex++;
  if (queueIndex >= queue.length) {
    queue = shuffleAvoid(queue, lastTrack);
    queueIndex = 0;
  }
  playCurrent();
}

function nextStation() {
  const keys = Object.keys(stations);
  const current = keys.indexOf(currentStation);
  const next = keys[(current + 1) % keys.length];
  switchStation(next);
}

// --- Recently Played ---

const recentBoxes = document.querySelectorAll(".recent-song");
let recentTitles = [];

function pushRecentlyPlayed(track) {
  recentTitles.unshift(`${track.name} — ${track.author}`);
  recentTitles = recentTitles.slice(0, 3);
  recentTitles.forEach((t, i) => {
    if (recentBoxes[i]) recentBoxes[i].innerText = t;
  });
}

// --- Up Next ---

function updateUpNext() {
  if (queue.length <= 1) {
    document.getElementById("upNextTitle").innerText = "—";
    document.getElementById("upNextArtist").innerText = "—";
    return;
  }
  const next = queue[(queueIndex + 1) % queue.length];
  document.getElementById("upNextTitle").innerText = next ? (next.name || "Untitled") : "—";
  document.getElementById("upNextArtist").innerText = next ? (next.author || "Unknown") : "—";
}

// --- Wallet ---

async function connectWallet() {
  if (!window.ethereum) {
    alert("No wallet found — install MetaMask.");
    return;
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  walletAddress = accounts[0];
  updateWalletUI();
}

function updateWalletUI() {
  const btn = document.getElementById("connectWalletBtn");
  const addrEl = document.getElementById("walletAddr");
  btn.innerText = "Connected";
  btn.disabled = true;
  addrEl.innerText = walletAddress.slice(0, 6) + "..." + walletAddress.slice(-4);
}

// --- Likes (UBNet) ---

async function fetchLikeCount(track) {
  if (!track.ubnet_post_id) {
    document.getElementById("likeCount").innerText = "0";
    return;
  }
  try {
    const client = getUBNetClient();
    const post = await client.posts.get(track.ubnet_post_id);
    const count = post?.reactions?.like ?? post?.likeCount ?? post?.stats?.likes ?? 0;
    document.getElementById("likeCount").innerText = count;
  } catch (e) {
    console.warn("Could not fetch like count:", e);
  }
}

function updateLikeUI(track) {
  const btn = document.getElementById("likeBtn");
  btn.classList.toggle("liked", !!likedTracks[track.folder_cid]);
  document.getElementById("likeCount").innerText = "0";
}

async function handleLike() {
  const track = queue[queueIndex];
  if (!track || !track.ubnet_post_id) return;
  if (likedTracks[track.folder_cid]) return;

  if (!walletAddress) {
    await connectWallet();
    if (!walletAddress) return;
  }

  try {
    const client = getUBNetClient();
    await client.posts.react(walletAddress, track.ubnet_post_id, "like");
    likedTracks[track.folder_cid] = true;
    localStorage.setItem("srr-likes", JSON.stringify(likedTracks));
    updateLikeUI(track);
    await fetchLikeCount(track);
  } catch (e) {
    console.error("Like failed:", e);
    alert("Like failed: " + e.message);
  }
}

// --- Audio events ---

player.addEventListener("error", () => {
  if (isPlayingAd) {
    isPlayingAd = false;
    document.getElementById("likeBtn").disabled = false;
    document.getElementById("nextStationBtn").disabled = false;
    document.querySelector(".now-playing-label").innerHTML = "&#9654; NOW PLAYING";
    const lastTrack = queue[queueIndex];
    queueIndex++;
    if (queueIndex >= queue.length) {
      queue = shuffleAvoid(queue, lastTrack);
      queueIndex = 0;
    }
    playCurrent();
    return;
  }
  const track = queue[queueIndex];
  if (!track) return;
  if (!player.src.includes(FALLBACK_GATEWAY)) {
    player.src = FALLBACK_GATEWAY + track.folder_cid + "/" + encodeURIComponent(track.audio);
    player.play().catch(() => {});
  }
});

player.addEventListener("ended", () => {
  if (isPlayingAd) {
    isPlayingAd = false;
    document.getElementById("likeBtn").disabled = false;
    document.getElementById("nextStationBtn").disabled = false;
    document.querySelector(".now-playing-label").innerHTML = "&#9654; NOW PLAYING";
    const lastTrack = queue[queueIndex];
    queueIndex++;
    if (queueIndex >= queue.length) {
      queue = shuffleAvoid(queue, lastTrack);
      queueIndex = 0;
    }
    playCurrent();
    return;
  }
  loadNext();
});

// --- UI events ---

document.querySelectorAll(".station").forEach((el) => {
  el.addEventListener("click", () => switchStation(el.dataset.station));
});

document.getElementById("nextStationBtn").addEventListener("click", nextStation);
document.getElementById("likeBtn").addEventListener("click", handleLike);
document.getElementById("connectWalletBtn").addEventListener("click", connectWallet);

// --- Listener count simulation ---

function startListenerSim() {
  let count = Math.floor(Math.random() * 12) + 4;
  document.getElementById("listeners").innerText = count;
  setInterval(() => {
    const delta = Math.floor(Math.random() * 3) - 1;
    count = Math.max(1, count + delta);
    document.getElementById("listeners").innerText = count;
  }, 25000);
}

// --- Init ---

async function init() {
  await loadStations();
  switchStation(currentStation);
  startListenerSim();
}

init();
