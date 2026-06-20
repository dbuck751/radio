# Dessert Rock Radio — IPFS + Nostr Build

Static, fully serverless radio station. Tracks are submitted as
self-pinned IPFS folders, submissions are published as Nostr events
(no PHP, no backend), and you approve them by running a local script
that writes into `tracks.json`.

## Files

- `index.html` — the radio player (static, no backend needed)
- `style.css` — basic stoner-rock styling
- `player.js` — station switching, IPFS gateway resolution, fallback gateway, recently played
- `tracks.json` — your live station playlists (what `index.html` actually plays from)
- `assets/desert-bg.png` — placeholder art
- `submit.html` + `submit.js` — submission form, publishes to Nostr
- `review-submissions.js` — run locally with Node to review/approve submissions

## Metadata schema

Each track's `metadata.json` (inside the artist's pinned folder):

```json
{
  "name": "Dark Forest Hypothesis",
  "description": "The universe is silent because advanced civilizations hide to avoid annihilation.",
  "author": "Don Buck",
  "genre": "Alt Rock",
  "bpm": "99",
  "price": "0.0014",
  "audio": "Dark Forest hypothesis.mp3",
  "image": "dfh.jpeg",
  "spasm_post": "",
  "eth_user_name": "donbuck.eth"
}
```

- `audio`/`image` are filenames inside the pinned folder — must match exactly
- `genre` is free text for display, separate from `station` (the fixed set)
- `price`/`spasm_post` are carried through, reserved for future use

## How submission works now (no PHP)

1. Artist pins their own folder to IPFS — three files: audio, image, `metadata.json`
2. Opens `submit.html`, pastes their CID, clicks "Preview Metadata"
3. Picks which station to assign it to
4. Connects wallet (MetaMask)
5. We derive a **deterministic Nostr keypair** from a wallet signature
   (same wallet always produces the same Nostr key — matches the
   pattern used elsewhere in UBNet)
6. Submits — this **publishes a signed Nostr event** to a relay, tagged
   `dessert-rock-radio-submission`. No server of yours involved.

### Approving submissions

Run this locally whenever you want to check for new tracks:

```bash
npm install nostr-tools
node review-submissions.js
```

It connects to the relay, lists every pending submission, and asks
`Approve this track? (y/n/skip)` for each one. Approving writes it
straight into `tracks.json`.

### Important: pick a real relay

`submit.js` and `review-submissions.js` both currently point at
`wss://relay.damus.io` as a placeholder. **Swap this for your actual
UBNet relay URL** in both files — search for `RELAY_URL` in each.
Using a public relay for testing is fine, but production submissions
should go to a relay you actually run or trust.

## Architecture

- **Static, pinned to IPFS:** `index.html`, `style.css`, `player.js`,
  `tracks.json`, `assets/`, `submit.html`, `submit.js` — the *entire*
  site can be pinned now, since nothing requires a server to run
- **Local, run on your machine:** `review-submissions.js` — this is
  the only piece that isn't part of the public site; it's just a tool
  you run yourself

After approving, re-pin the project folder (since `tracks.json`
changed) to get a new site CID, or host `tracks.json` somewhere
fetchable and point `player.js` at that instead so the static site CID
never has to change.

## How playback resolves files

For a track with `folder_cid: "bafybeigdyrzt..."` and
`audio: "Dark Forest hypothesis.mp3"`:

```
https://jade-faithful-wolf-918.mypinata.cloud/ipfs/bafybeigdyrzt.../Dark%20Forest%20hypothesis.mp3
```

with `https://ipfs.io/ipfs/...` as fallback.

## Testing locally

```bash
cd radio-project
python -m http.server 8080
```

Open `http://localhost:8080`.

To test submission: open `http://localhost:8080/submit.html`, paste a
real CID, connect wallet, submit. Then run `node review-submissions.js`
in a separate terminal to see it show up.

## Known limitations

- "Current Listeners" is a static placeholder
- No play-tracking/scrobbling
- No verification that the wallet signing matches `eth_user_name` in
  the metadata
- Approval is manual/local — not yet automated or web-based
- `price`/`spasm_post` not yet used by the player
