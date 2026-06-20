// review-submissions.js
//
// Run this locally with Node whenever you want to check for new track
// submissions. It queries the relay for events tagged with our
// submission tag, prints them, and lets you approve into tracks.json
// right from the terminal — no PHP, no server needed.
//
// Usage:
//   npm install nostr-tools
//   node review-submissions.js

import { Relay } from "nostr-tools/relay";
import { readFileSync, writeFileSync, existsSync } from "fs";
import readline from "readline";

const RELAY_URL = "wss://relay.damus.io";
const SUBMISSION_TAG = "dessert-rock-radio-submission";
const TRACKS_PATH = "./tracks.json";
const BLOCKLIST_PATH = "./blocklist.json";

function loadBlocklist() {
  if (!existsSync(BLOCKLIST_PATH)) return [];
  return JSON.parse(readFileSync(BLOCKLIST_PATH, "utf8"));
}

function addToBlocklist(cid) {
  const list = loadBlocklist();
  if (!list.includes(cid)) {
    list.push(cid);
    writeFileSync(BLOCKLIST_PATH, JSON.stringify(list, null, 2));
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log(`Connecting to ${RELAY_URL}...`);
  const relay = await Relay.connect(RELAY_URL);

  const events = await new Promise((resolve) => {
    const found = [];
    const sub = relay.subscribe(
      [{ kinds: [30078], "#t": [SUBMISSION_TAG] }],
      {
        onevent(event) {
          found.push(event);
        },
        oneose() {
          sub.close();
          resolve(found);
        }
      }
    );
    // safety timeout in case the relay never sends EOSE
    setTimeout(() => resolve(found), 8000);
  });

  relay.close();

  if (events.length === 0) {
    console.log("No submissions found.");
    rl.close();
    return;
  }

  const tracks = JSON.parse(readFileSync(TRACKS_PATH, "utf8"));
  const blocklist = loadBlocklist();

  // dedupe by the "d" tag, keep only the newest version of each
  const latestByKey = {};
  for (const ev of events) {
    const dTag = ev.tags.find((t) => t[0] === "d")?.[1];
    if (!dTag) continue;
    if (!latestByKey[dTag] || ev.created_at > latestByKey[dTag].created_at) {
      latestByKey[dTag] = ev;
    }
  }

  for (const ev of Object.values(latestByKey)) {
    const payload = JSON.parse(ev.content);
    const station = payload.station || "desert";

    console.log("\n----------------------------------------");
    console.log(`Title:   ${payload.name}`);
    console.log(`Artist:  ${payload.artist}`);
    console.log(`Genre:   ${payload.genre || "—"}`);
    console.log(`Station: ${station}`);
    console.log(`Wallet:  ${payload.wallet}`);
    console.log(`CID:     ${payload.cid}`);
    console.log(`ENS:     ${payload.eth_user_name || "—"}`);

    if (blocklist.includes(payload.cid)) {
      console.log("(blocklisted, skipping)");
      continue;
    }

    const alreadyApproved = (tracks[station] || []).some(
      (t) => t.folder_cid === payload.cid
    );
    if (alreadyApproved) {
      console.log("(already approved, skipping)");
      continue;
    }

    const answer = await ask("Approve this track? (y/n/reject): ");
    const a = answer.trim().toLowerCase();

    if (a === "y") {
      if (!tracks[station]) tracks[station] = [];
      tracks[station].push({
        name: payload.name,
        artist: payload.artist,
        description: payload.description || "",
        genre: payload.genre || "",
        folder_cid: payload.cid,
        wallet: payload.wallet
      });
      writeFileSync(TRACKS_PATH, JSON.stringify(tracks, null, 2));
      console.log("Approved and saved to tracks.json.");
    } else if (a === "reject") {
      addToBlocklist(payload.cid);
      console.log("Rejected and added to blocklist.json.");
    } else {
      console.log("Skipped.");
    }
  }

  console.log("\nDone. Remember to re-pin the project folder if tracks.json changed.");
  rl.close();
}

main();
