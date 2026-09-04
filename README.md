# Hidden-Number-Duel

The game uses [PeerJS](https://peerjs.com/) through its browser CDN to create a direct two-player connection.

## Playing online

1. Serve this folder from a local web server or open the deployed site over HTTPS.
2. One player enters a nickname and chooses **Host lobby**, then shares the displayed lobby code.
3. The other player enters a nickname, chooses **Join lobby**, and enters that code.
4. The host selects the range endpoint. Both players then choose their secret number privately.

PeerJS's public cloud signaling service is used by default. The game host keeps both secrets and validates guesses; secret numbers are never sent in ordinary synchronization messages. If the host disconnects, the guest creates a replacement lobby and becomes its owner. When the former host rejoins that lobby, their locally stored secret is exchanged once to restore validation for the resumed match.

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
