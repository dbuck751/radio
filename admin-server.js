import { createServer } from "http";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { Relay } from "nostr-tools/relay";

const PORT = 3001;
const RELAY_URL = "wss://relay.damus.io";
const SUBMISSION_TAG = "dessert-rock-radio-submission";
const TRACKS_PATH = "./tracks.json";
const BLOCKLIST_PATH = "./blocklist.json";

function loadBlocklist() {
  if (!existsSync(BLOCKLIST_PATH)) return [];
  return JSON.parse(readFileSync(BLOCKLIST_PATH, "utf8"));
}

function saveBlocklist(list) {
  writeFileSync(BLOCKLIST_PATH, JSON.stringify(list, null, 2));
}

async function fetchSubmissions() {
  const relay = await Relay.connect(RELAY_URL);

  const events = await new Promise((resolve) => {
    const found = [];
    const sub = relay.subscribe(
      [{ kinds: [30078], "#t": [SUBMISSION_TAG] }],
      {
        onevent(event) { found.push(event); },
        oneose() { sub.close(); resolve(found); }
      }
    );
    setTimeout(() => resolve(found), 8000);
  });

  relay.close();

  const latestByKey = {};
  for (const ev of events) {
    const dTag = ev.tags.find((t) => t[0] === "d")?.[1];
    if (!dTag) continue;
    if (!latestByKey[dTag] || ev.created_at > latestByKey[dTag].created_at) {
      latestByKey[dTag] = ev;
    }
  }

  const tracks = JSON.parse(readFileSync(TRACKS_PATH, "utf8"));
  const blocklist = loadBlocklist();

  return Object.values(latestByKey)
    .map((ev) => JSON.parse(ev.content))
    .filter((s) => !blocklist.includes(s.cid))
    .filter((s) => !(tracks[s.station || "desert"] || []).some((t) => t.folder_cid === s.cid));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => body += chunk);
    req.on("end", () => resolve(body));
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/admin")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync("./admin.html", "utf8"));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/submissions") {
    try {
      const submissions = await fetchSubmissions();
      json(res, submissions);
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/approve") {
    try {
      const payload = JSON.parse(await readBody(req));
      const tracks = JSON.parse(readFileSync(TRACKS_PATH, "utf8"));
      const station = payload.station || "desert";
      if (!tracks[station]) tracks[station] = [];
      tracks[station].push({
        name: payload.name,
        artist: payload.artist,
        description: payload.description || "",
        genre: payload.genre || "",
        folder_cid: payload.cid,
        wallet: payload.wallet || ""
      });
      writeFileSync(TRACKS_PATH, JSON.stringify(tracks, null, 2));
      console.log(`\n✓ Approved: "${payload.name}" — upload tracks.json to dbloops.com/radio/tracks.json`);
      json(res, { ok: true });
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reject") {
    try {
      const { cid } = JSON.parse(await readBody(req));
      const blocklist = loadBlocklist();
      if (!blocklist.includes(cid)) {
        blocklist.push(cid);
        saveBlocklist(blocklist);
      }
      json(res, { ok: true });
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Admin panel running at http://localhost:${PORT}`);
});
