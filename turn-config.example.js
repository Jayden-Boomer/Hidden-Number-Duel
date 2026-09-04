// Replace this file at deployment time with credentials issued by your TURN service.
window.HIDDEN_NUMBER_DUEL_TURN = {
    iceServers: [
        {
            urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349?transport=tcp"],
            username: "temporary-username",
            credential: "temporary-credential"
        }
    ]
};