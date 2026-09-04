# Hidden-Number-Duel

The game uses [PeerJS](https://peerjs.com/) through its browser CDN to create a direct two-player connection. When a direct path is unavailable, WebRTC automatically uses the configured TURN relay.

## Playing online

1. Serve this folder from a local web server or open the deployed site over HTTPS.
2. One player enters a nickname and chooses **Host lobby**, then shares the displayed lobby code.
3. The other player enters a nickname, chooses **Join lobby**, and enters that code.
4. The host selects the range endpoint. Both players then choose their secret number privately.

PeerJS's public cloud signaling service is used by default. The game host keeps both secrets and validates guesses; secret numbers are never sent in ordinary synchronization messages. If the host disconnects, the guest creates a replacement lobby and becomes its owner. When the former host rejoins that lobby, their locally stored secret is exchanged once to restore validation for the resumed match.

## TURN relay setup

The browser cannot run a TURN server itself. This repository includes [`turnserver.conf.example`](turnserver.conf.example) for [coturn](https://github.com/coturn/coturn), which must run on a server with a public IP address. Copy it to `turnserver.conf`, set the public IP, realm, and a long random shared secret, then start coturn with that file.

Create `turn-config.js` from [`turn-config.example.js`](turn-config.example.js) during deployment. Set `iceServers` to the coturn `turn:` and `turns:` URLs and provide short-lived credentials from your TURN credential service. Do not commit real TURN credentials. If `turn-config.js` is absent or has no servers, the game still works where direct WebRTC connectivity is possible.

Rules implemented:

- The first player chooses the range endpoint, from 2 to 1000.
- Each player secretly chooses a whole number from 1 to the selected endpoint.
- Each player chooses a nickname shown throughout the game.
- The first player goes first.
- On each turn, the player can ask a question or make a guess.
- Questions cannot contain digits or common number words.
- Answers can be open-ended.
- After an answer, the answering player becomes the next asker.
- An incorrect guess ends the player's turn.
- A correct guess wins the game.
