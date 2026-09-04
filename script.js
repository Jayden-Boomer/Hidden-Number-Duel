const DEFAULT_MAX_NUMBER = 50;
const MAX_ENDPOINT = 1000;
const MAX_NICKNAME_LENGTH = 24;
const LOBBY_COOKIE = "hidden-number-duel-lobby";
const LOBBY_COOKIE_MAX_AGE = 120;
const NICKNAME_COOKIE = "hidden-number-duel-nickname";
const NICKNAME_COOKIE_MAX_AGE = 315360000;

const game = {
    role: null,
    peer: null,
    connection: null,
    hostCode: null,
    nickname: "",
    secrets: [null, null],
    names: [null, null],
    currentPlayer: 0,
    maxNumber: DEFAULT_MAX_NUMBER,
    history: [],
    pendingQuestion: null,
    questionDraft: "",
    phase: "lobby",
    winner: null,
    winningGuess: null,
    reconnecting: false,
    reconnectTimer: null
};

const gameCard = document.getElementById("gameCard");
const rulesDialog = document.getElementById("rulesDialog");
const handoffDialog = document.getElementById("handoffDialog");
const numberWords = new Set([
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "first", "second",
    "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "half",
    "quarter", "double", "triple"
]);

function cloneTemplate(id) { return document.getElementById(id).content.cloneNode(true); }
function playerName(index) { return game.names[index] || "this player"; }
function opponentOf(index) { return index === 0 ? 1 : 0; }
function localPlayer() { return game.role === "host" ? 0 : 1; }
function updateRangeDisplay() {
    document.getElementById("rangeDisplay").textContent = `1–${game.maxNumber}`;
    document.getElementById("rangeRule").textContent = `Each player secretly chooses a number from 1 to ${game.maxNumber}.`;
}
function setStatus(message, isError = false) {
    const status = document.querySelector(".lobby-status");
    if (status) { status.textContent = message; status.classList.toggle("error", isError); }
}
function setNicknameCookie(nickname) {
    if (nickname) document.cookie = `${NICKNAME_COOKIE}=${encodeURIComponent(nickname)}; Max-Age=${NICKNAME_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
}
function getNicknameCookie() {
    const cookie = document.cookie.split("; ").find(value => value.startsWith(`${NICKNAME_COOKIE}=`));
    if (!cookie) return "";
    try {
        return decodeURIComponent(cookie.slice(NICKNAME_COOKIE.length + 1)).slice(0, MAX_NICKNAME_LENGTH);
    } catch { return ""; }
}
function showHandoffDialog(copy) {
    handoffDialog.querySelector(".handoff-copy").textContent = copy;
    if (!handoffDialog.open) handoffDialog.showModal();
}
function setLobbyCookie(lobbyCode, nickname = game.nickname, secret = game.secrets[localPlayer()]) {
    if (lobbyCode && nickname) {
        const saved = { nickname, lobbyCode };
        if (Number.isInteger(secret)) saved.secret = secret;
        if (game.rejoinName) saved.rejoinName = game.rejoinName;
        const value = encodeURIComponent(JSON.stringify(saved));
        document.cookie = `${LOBBY_COOKIE}=${value}; Max-Age=${LOBBY_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
    }
}
function getLobbyCookie() {
    const cookie = document.cookie.split("; ").find(value => value.startsWith(`${LOBBY_COOKIE}=`));
    if (!cookie) return null;
    try {
        const saved = JSON.parse(decodeURIComponent(cookie.slice(LOBBY_COOKIE.length + 1)));
        if (typeof saved.nickname !== "string" || typeof saved.lobbyCode !== "string" || !saved.nickname || !saved.lobbyCode) return null;
        return {
            nickname: saved.nickname,
            lobbyCode: saved.lobbyCode,
            secret: Number.isInteger(saved.secret) ? saved.secret : null,
            rejoinName: typeof saved.rejoinName === "string" ? saved.rejoinName : null
        };
    } catch { return null; }
}
function clearLobbyCookie() { document.cookie = `${LOBBY_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`; }
function send(message) {
    setLobbyCookie(game.hostCode || (game.peer && game.peer.id));
    if (game.connection && game.connection.open) game.connection.send(message);
}
function publicState() {
    return {
        type: "state", names: game.names, maxNumber: game.maxNumber, currentPlayer: game.currentPlayer,
        history: game.history, pendingQuestion: game.pendingQuestion, phase: game.phase,
        winner: game.winner, winningGuess: game.winningGuess
    };
}
function broadcastState() { send(publicState()); }
function watchPeerConnection() {
    const peer = game.peer;
    peer.on("disconnected", () => {
        if (peer !== game.peer) return;
        setStatus("PeerJS connection lost. Reconnecting...", true);
        if (game.role === "guest") {
            promoteGuestToHost();
        } else game.peer.reconnect();
    });
}
function promoteGuestToHost() {
    if (game.role !== "guest" || game.reconnecting) return;
    game.reconnecting = true;
    const previousHostCode = game.hostCode;
    const oldConnection = game.connection;
    const oldPeer = game.peer;
    game.connection = null;
    game.peer = null;
    game.secrets.reverse();
    game.names.reverse();
    game.currentPlayer = opponentOf(game.currentPlayer);
    if (game.pendingQuestion) {
        game.pendingQuestion = {
            ...game.pendingQuestion,
            asker: opponentOf(game.pendingQuestion.asker),
            answerer: opponentOf(game.pendingQuestion.answerer)
        };
    }
    game.history = game.history.map(item => item.type === "question"
        ? { ...item, asker: opponentOf(item.asker), answerer: opponentOf(item.answerer) }
        : { ...item, player: opponentOf(item.player) });
    if (game.winner !== null) game.winner = opponentOf(game.winner);
    game.role = "host";
    game.hostCode = previousHostCode;
    if (oldConnection) oldConnection.close();
    if (oldPeer && !oldPeer.destroyed) oldPeer.destroy();
    startHosting(true, previousHostCode);
    showHandoffDialog("The host disconnected, so you are now the host. The match will resume when your opponent rejoins.");
}
function scheduleGuestReconnect() {
    if (game.reconnectTimer || game.role !== "guest") return;
    const savedLobby = getLobbyCookie();
    if (!savedLobby) return;
    game.reconnecting = true;
    game.reconnectTimer = setTimeout(() => {
        game.reconnectTimer = null;
        startJoining(savedLobby.lobbyCode, { textContent: "" });
    }, 1000);
}

function renderStart() {
    document.querySelector(".range-pill").classList.add("hidden");
    gameCard.innerHTML = `<div class="screen">
        <div class="step-badge">Start a duel</div>
        <h2 class="screen-title">Enter the arena</h2>
        <p class="screen-copy">Choose a nickname, then host a new lobby or join a duel already waiting for you.</p>
        <form class="secret-form start-form">
            <label for="startNickname">Your nickname</label>
            <input id="startNickname" type="text" maxlength="${MAX_NICKNAME_LENGTH}" autocomplete="nickname" required />
            <span class="lobby-mode-label">Lobby mode</span>
            <div class="lobby-mode-buttons" role="group" aria-label="Lobby mode">
                <button type="button" class="lobby-mode-btn active" data-mode="host" aria-pressed="true">Host lobby</button>
                <button type="button" class="lobby-mode-btn" data-mode="join" aria-pressed="false">Join lobby</button>
            </div>
            <div class="join-code-field hidden"><label for="hostCode">Host lobby code</label><input id="hostCode" type="text" maxlength="64" autocomplete="off" placeholder="Paste the host code" /></div>
            <p class="error" role="alert"></p><button type="submit" class="primary-btn wide-btn">Continue</button>
        </form>
    </div>`;
    const form = gameCard.querySelector(".start-form");
    const modeButtons = [...gameCard.querySelectorAll(".lobby-mode-btn")];
    const joinField = gameCard.querySelector(".join-code-field");
    const nickname = gameCard.querySelector("#startNickname");
    const error = gameCard.querySelector(".error");
    nickname.value = getNicknameCookie();
    const savedLobby = getLobbyCookie();
    if (savedLobby) {
        const rejoinButton = document.createElement("button");
        rejoinButton.type = "button";
        rejoinButton.className = "ghost-btn wide-btn rejoin-btn";
        rejoinButton.textContent = `Rejoin ${savedLobby.rejoinName || savedLobby.nickname}'s lobby`;
        joinField.after(rejoinButton);
        rejoinButton.addEventListener("click", () => {
            nickname.value = savedLobby.nickname;
            game.nickname = savedLobby.nickname;
            modeButtons.find(button => button.dataset.mode === "join").click();
            gameCard.querySelector("#hostCode").value = savedLobby.lobbyCode;
            startJoining(savedLobby.lobbyCode, error);
        });
    }
    let selectedMode = "host";
    modeButtons.forEach(button => button.addEventListener("click", () => {
        selectedMode = button.dataset.mode;
        modeButtons.forEach(modeButton => {
            const isActive = modeButton === button;
            modeButton.classList.toggle("active", isActive);
            modeButton.setAttribute("aria-pressed", String(isActive));
        });
        joinField.classList.toggle("hidden", selectedMode !== "join");
    }));
    form.addEventListener("submit", event => {
        event.preventDefault();
        game.nickname = nickname.value.trim().slice(0, MAX_NICKNAME_LENGTH);
        if (!game.nickname) { error.textContent = "Enter a nickname first."; nickname.focus(); return; }
        setNicknameCookie(game.nickname);
        if (selectedMode === "host") startHosting();
        else startJoining(gameCard.querySelector("#hostCode").value.trim(), error);
    });
    const sharedLobbyCode = new URLSearchParams(window.location.search).get("lobby");
    if (sharedLobbyCode) {
        const joinButton = modeButtons.find(button => button.dataset.mode === "join");
        joinButton.click();
        gameCard.querySelector("#hostCode").value = sharedLobbyCode;
    }
    setTimeout(() => nickname.focus(), 0);
}

function renderLobby(role, errorMessage = "") {
    document.querySelector(".range-pill").classList.add("hidden");
    gameCard.innerHTML = "";
    const view = cloneTemplate("lobbyTemplate");
    const badge = view.querySelector(".lobby-badge");
    const title = view.querySelector(".lobby-title");
    const copy = view.querySelector(".lobby-copy");
    const code = view.querySelector(".lobby-code");
    const copyCodeButton = view.querySelector(".copy-code-btn");
    const shareLinkButton = view.querySelector(".share-link-btn");
    const form = view.querySelector(".lobby-form");
    const input = view.querySelector("#lobbyInput");
    const range = view.querySelector(".lobby-range");
    const rangeInput = view.querySelector("#lobbyRangeInput");
    const label = view.querySelector(".lobby-input-label");
    const submit = view.querySelector(".lobby-submit");
    const errorText = view.querySelector(".error");
    if (role === "host") {
        badge.textContent = "Host lobby"; title.textContent = "Your lobby is ready";
        copy.textContent = "Share this code with your opponent. When they arrive, choose the range and start the duel.";
        code.textContent = game.peer ? game.peer.id : "Connecting..."; code.classList.remove("hidden");
        copyCodeButton.classList.remove("hidden");
        shareLinkButton.classList.remove("hidden");
        copyCodeButton.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(code.textContent);
                copyCodeButton.setAttribute("aria-label", "Lobby code copied");
                copyCodeButton.title = "Lobby code copied";
                setTimeout(() => {
                    copyCodeButton.setAttribute("aria-label", "Copy lobby code");
                    copyCodeButton.title = "Copy lobby code";
                }, 1600);
            } catch {
                setStatus("Copy failed. Select the lobby code and copy it manually.", true);
            }
        });
        shareLinkButton.addEventListener("click", async () => {
            const inviteUrl = new URL(window.location.href);
            inviteUrl.search = "";
            inviteUrl.searchParams.set("lobby", code.textContent);
            try {
                if (navigator.share) await navigator.share({ title: "Hidden Number Duel", text: "Join my duel", url: inviteUrl.href });
                else {
                    await navigator.clipboard.writeText(inviteUrl.href);
                    setStatus("Share link copied to your clipboard.");
                }
            } catch (error) {
                if (error.name !== "AbortError") setStatus("Could not share the lobby link.", true);
            }
        });
        label.textContent = "Lobby status"; input.classList.add("hidden"); input.removeAttribute("required");
        range.classList.remove("hidden");
        const opponentConnected = Boolean(game.connection && game.connection.open && game.names[1]);
        submit.textContent = opponentConnected ? "Start duel" : "Waiting for opponent";
        submit.disabled = !opponentConnected;
        setStatus(opponentConnected ? `${playerName(1)} joined. Set the range when you are ready.` : "Waiting for an opponent to join...");
        if (errorMessage) errorText.textContent = errorMessage;
        form.addEventListener("submit", event => {
            event.preventDefault();
            const maxNumber = Number(rangeInput.value);
            if (!Number.isInteger(maxNumber) || maxNumber < 2 || maxNumber > MAX_ENDPOINT) { errorText.textContent = `Choose a whole-number endpoint from 2 to ${MAX_ENDPOINT}.`; return; }
            game.maxNumber = maxNumber; game.phase = "setup"; updateRangeDisplay();
            setLobbyCookie(game.peer && game.peer.id, game.nickname);
            send({ type: "game-start", maxNumber, names: game.names }); renderSecretSetup();
        });
    } else if (role === "connecting" || role === "connected") {
        badge.textContent = "Join lobby";
        title.textContent = role === "connected" ? "Lobby joined" : "Joining lobby";
        copy.textContent = role === "connected"
            ? `You are connected to ${playerName(0)}. Wait for the host to choose the range and start the duel.`
            : "Your lobby code was submitted. We are connecting you to the host now.";
        label.textContent = "Connection status";
        input.classList.add("hidden");
        input.removeAttribute("required");
        submit.classList.add("hidden");
        errorText.textContent = errorMessage;
        view.querySelector(".lobby-status").textContent = role === "connected"
            ? "Connected. Waiting for the host to start..."
            : "Connecting to the host...";
    } else {
        badge.textContent = "Join lobby"; title.textContent = "Connect to your opponent";
        copy.textContent = "Enter the host code exactly as it appears on their screen.";
        label.textContent = "Host lobby code"; input.placeholder = "Paste the host code"; input.value = game.hostCode || "";
        submit.textContent = game.hostCode ? "Rejoin lobby" : "Join lobby";
        if (errorMessage) errorText.textContent = errorMessage;
        form.addEventListener("submit", event => { event.preventDefault(); startJoining(input.value.trim(), errorText); });
    }
    gameCard.appendChild(view);
}

function startHosting(resumingMatch = false, lobbyCode = null) {
    if (typeof Peer === "undefined") { renderLobby("host", "PeerJS could not load. Check your internet connection and try again."); return; }
    if (game.reconnectTimer) { clearTimeout(game.reconnectTimer); game.reconnectTimer = null; }
    game.role = "host";
    if (!resumingMatch) game.names = [game.nickname, null];
    game.takeoverHost = resumingMatch;
    game.peer = lobbyCode ? new Peer(lobbyCode) : new Peer(); renderLobby("host");
    game.reconnecting = false;
    watchPeerConnection();
    game.peer.on("open", () => {
        setLobbyCookie(game.peer.id);
        const code = document.querySelector(".lobby-code");
        if (code) code.textContent = game.peer.id;
        if (resumingMatch && game.phase !== "lobby") renderNetworkState();
    });
    game.peer.on("connection", connection => {
        if (game.connection && game.connection !== connection) game.connection.close();
        game.connection = connection;
        connection.on("open", () => {
            if (game.phase === "lobby") send({ type: "lobby-info", name: game.nickname });
            else send(publicState());
        });
        connection.on("data", handleHostMessage);
        connection.on("close", () => {
            if (game.connection !== connection) return;
            game.connection = null;
            if (game.role === "host") setStatus("Your opponent disconnected.", true);
        });
        connection.on("error", () => setStatus("The connection was interrupted.", true));
    });
    game.peer.on("error", error => setStatus(error.type === "peer-unavailable" ? "That lobby was not found." : "PeerJS could not connect.", true));
}

function startJoining(hostCode, errorElement) {
    if (!hostCode) { errorElement.textContent = "Enter the host lobby code."; return; }
    if (typeof Peer === "undefined") { errorElement.textContent = "PeerJS could not load. Check your internet connection and try again."; return; }
    if (game.reconnectTimer) { clearTimeout(game.reconnectTimer); game.reconnectTimer = null; }
    const savedLobby = getLobbyCookie();
    game.role = "guest"; game.hostCode = hostCode;
    setLobbyCookie(hostCode, game.nickname, savedLobby && savedLobby.lobbyCode === hostCode ? savedLobby.secret : null);
    if (savedLobby && Number.isInteger(savedLobby.secret)) game.secrets[1] = savedLobby.secret;
    if (game.peer && !game.peer.destroyed) game.peer.destroy();
    game.connection = null; game.peer = new Peer(); renderLobby("connecting");
    watchPeerConnection();
    game.peer.on("open", () => {
        const connection = game.peer.connect(hostCode);
        game.connection = connection;
        connection.on("open", () => { game.reconnecting = false; send({ type: "join", name: game.nickname }); });
        connection.on("data", handleGuestMessage);
        connection.on("error", () => setStatus("The connection was interrupted.", true));
        connection.on("close", () => {
            if (game.connection !== connection) return;
            game.connection = null;
            if (game.role === "guest") promoteGuestToHost();
            else renderLobby("join", "The host connection was lost. Rejoin when ready.");
        });
    });
    game.peer.on("error", () => {
        if (game.role === "guest") scheduleGuestReconnect();
        else setStatus("That lobby could not be reached.", true);
    });
}

function handleHostMessage(message) {
    if (message.type === "lobby-info" || message.type === "join") {
        game.names[1] = String(message.name || "Opponent").trim().slice(0, MAX_NICKNAME_LENGTH);
        game.rejoinName = game.names[1];
        setLobbyCookie(game.hostCode || (game.peer && game.peer.id));
        const submit = document.querySelector(".lobby-submit");
        if (submit) { submit.disabled = false; submit.textContent = "Start duel"; }
        setStatus(`${playerName(1)} joined. Set the range when you are ready.`);
        if (message.type === "join" && game.takeoverHost && handoffDialog.open) handoffDialog.close();
        if (message.type === "join" && game.phase !== "lobby") {
            send(publicState());
            send({ type: "secret-request" });
            if (game.takeoverHost) send({ type: "host-takeover", name: game.names[0] });
        }
    } else if (message.type === "secret-set") { game.secrets[1] = message.secret; maybeStartGame(); }
    else if (message.type === "recovery-secret") {
        if (Number.isInteger(message.secret)) game.secrets[1] = message.secret;
        if (game.phase === "setup" && game.secrets[0] !== null && game.secrets[1] !== null) {
            game.phase = "turn";
            broadcastState();
            renderNetworkState();
        }
    }
    else if (message.type === "rematch-request") resetForRematch();
    else if (message.type === "action") processAction(message.action, 1);
}
function handleGuestMessage(message) {
    if (message.type === "host-takeover") {
        showHandoffDialog(`The previous host disconnected. ${message.name || "This player"} is now the host of this lobby.`);
    } else if (message.type === "lobby-info") {
        game.names[0] = String(message.name || "Host").trim().slice(0, MAX_NICKNAME_LENGTH);
        const title = document.querySelector(".lobby-title");
        const copy = document.querySelector(".lobby-copy");
        if (title) title.textContent = "Lobby joined";
        if (copy) copy.textContent = `You are connected to ${playerName(0)}. Wait for the host to choose the range and start the duel.`;
        setStatus("Connected. Waiting for the host to start...");
    } else if (message.type === "host-secret-ready") {
        const copy = document.querySelector(".screen-copy");
        if (copy && game.phase === "setup") copy.textContent = `The host has locked their number. Choose your secret number from 1 to ${game.maxNumber}.`;
    } else if (message.type === "secret-request") {
        if (Number.isInteger(game.secrets[1])) send({ type: "recovery-secret", secret: game.secrets[1] });
    } else if (message.type === "game-start") {
        game.names = message.names; game.maxNumber = message.maxNumber; game.phase = "setup"; setLobbyCookie(game.hostCode, game.nickname); updateRangeDisplay(); renderSecretSetup();
    } else if (message.type === "state") {
        Object.assign(game, message); updateRangeDisplay(); renderNetworkState();
    } else if (message.type === "rematch") {
        resetGuestForRematch();
    }
}

function renderSecretSetup() {
    document.querySelector(".range-pill").classList.remove("hidden"); gameCard.innerHTML = "";
    const view = cloneTemplate("setupTemplate");
    view.querySelector(".step-badge").textContent = "Secret number";
    view.querySelector(".screen-title").textContent = "Choose your secret number";
    view.querySelector(".screen-copy").textContent = `Pick any whole number from 1 to ${game.maxNumber}. Your opponent will never receive it.`;
    view.querySelector("#setupNickname").textContent = game.nickname;
    const form = view.querySelector(".secret-form");
    const input = view.querySelector("#secretInput"); const error = view.querySelector(".error"); input.max = game.maxNumber;
    form.addEventListener("submit", event => {
        event.preventDefault(); const value = Number(input.value);
        if (!Number.isInteger(value) || value < 1 || value > game.maxNumber) { error.textContent = `Enter a whole number from 1 to ${game.maxNumber}.`; return; }
        const index = localPlayer(); game.secrets[index] = value;
        if (game.role === "host") {
            send({ type: "host-secret-ready" });
            maybeStartGame();
        }
        else { send({ type: "secret-set", secret: value }); renderWaiting("Secret number locked", "Waiting for the host to start the first turn."); }
    });
    const savedLobby = getLobbyCookie();
    const savedSecret = savedLobby && savedLobby.lobbyCode === (game.hostCode || (game.peer && game.peer.id))
        ? savedLobby.secret
        : null;
    if (Number.isInteger(savedSecret) && savedSecret >= 1 && savedSecret <= game.maxNumber) {
        input.value = savedSecret;
        game.secrets[localPlayer()] = savedSecret;
    }
    gameCard.appendChild(view); setTimeout(() => input.focus(), 0);
}
function maybeStartGame() {
    if (game.secrets[0] === null || game.secrets[1] === null) {
        renderWaiting("Secret number locked", `Waiting for ${game.secrets[0] === null ? playerName(0) : playerName(1)} to choose a number.`); return;
    }
    game.phase = "turn"; game.currentPlayer = 0; broadcastState(); renderNetworkState();
}
function renderWaiting(title, copy) {
    gameCard.innerHTML = ""; const view = cloneTemplate("handoffTemplate");
    view.querySelector(".screen-title").textContent = title; view.querySelector(".screen-copy").textContent = copy;
    gameCard.appendChild(view);
}
function renderNetworkState() {
    if (game.phase === "setup") return renderSecretSetup();
    if (game.phase === "finished") return renderWinner(game.winner, game.winningGuess);
    if (game.pendingQuestion) {
        if (game.pendingQuestion.answerer === localPlayer()) renderAnswer();
        else renderWaiting("Question sent", `Waiting for ${playerName(game.pendingQuestion.answerer)} to answer.`);
        return;
    }
    if (game.currentPlayer === localPlayer()) renderTurn();
    else {
        const latestAnswer = [...game.history].reverse().find(item => item.type === "question");
        if (latestAnswer && latestAnswer.answerer === game.currentPlayer) {
            renderWaiting(
                `You asked: “${latestAnswer.question}”`,
                `${playerName(latestAnswer.answerer)} answered: “${latestAnswer.answer}.”\nWaiting for ${playerName(latestAnswer.answerer)}'s next question.`
            );
        } else {
            renderWaiting("Opponent's turn", `${playerName(game.currentPlayer)} is deciding whether to ask a question or make a guess.`);
        }
    }
}
function containsForbiddenNumber(text) {
    if (/\d/.test(text)) return true;
    const words = text.toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean);
    return words.some(word => numberWords.has(word));
}
function saveQuestionDraft() {
    const questionInput = document.querySelector("#questionInput");
    if (questionInput) game.questionDraft = questionInput.value;
}
function submitAction(action) { if (game.role === "host") processAction(action, 0); else send({ type: "action", action }); }
function processAction(action, player) {
    const isAnswer = action.type === "answer" && game.pendingQuestion && game.pendingQuestion.answerer === player;
    if (game.phase !== "turn" || (game.currentPlayer !== player && !isAnswer)) return;
    if (action.type === "question") game.pendingQuestion = { asker: player, answerer: opponentOf(player), question: action.question };
    else if (action.type === "answer" && game.pendingQuestion && game.pendingQuestion.answerer === player) {
        game.history.push({ type: "question", ...game.pendingQuestion, answer: action.answer }); game.currentPlayer = player; game.pendingQuestion = null;
    } else if (action.type === "guess") {
        const correct = action.guess === game.secrets[opponentOf(player)];
        game.history.push({ type: "guess", player, guess: action.guess, correct });
        if (correct) { game.phase = "finished"; game.winner = player; game.winningGuess = action.guess; } else game.currentPlayer = opponentOf(player);
    } else return;
    broadcastState(); renderNetworkState();
}

function renderTurn() {
    saveQuestionDraft();
    gameCard.innerHTML = ""; const view = cloneTemplate("turnTemplate");
    view.querySelector(".turn-label").textContent = `${playerName(game.currentPlayer)}'s turn • trying to find ${playerName(opponentOf(game.currentPlayer))}'s number`;
    const tabs = [...view.querySelectorAll(".mode-tab")]; const questionPanel = view.querySelector(".question-panel"); const guessPanel = view.querySelector(".guess-panel");
    tabs.forEach(tab => tab.addEventListener("click", () => { tabs.forEach(item => item.classList.toggle("active", item === tab)); const isQuestion = tab.dataset.mode === "question"; questionPanel.classList.toggle("hidden", !isQuestion); guessPanel.classList.toggle("hidden", isQuestion); }));
    const questionInput = view.querySelector("#questionInput"); const questionError = view.querySelector(".question-error");
    questionInput.value = game.questionDraft;
    view.querySelector(".char-count").textContent = `${questionInput.value.length} / 180`;
    questionInput.addEventListener("input", () => {
        game.questionDraft = questionInput.value;
        view.querySelector(".char-count").textContent = `${questionInput.value.length} / 180`;
        questionError.textContent = "";
    });
    view.querySelector(".question-form").addEventListener("submit", event => {
        event.preventDefault(); const question = questionInput.value.trim();
        if (!question) questionError.textContent = "Enter a question first.";
        else if (containsForbiddenNumber(question)) questionError.textContent = "Questions cannot contain digits or number words. Rephrase it without numbers.";
        else { game.questionDraft = ""; submitAction({ type: "question", question }); }
    });
    const guessInput = view.querySelector("#guessInput"); const guessValue = view.querySelector("#guessValue"); const guessError = view.querySelector(".guess-error"); guessInput.max = game.maxNumber; guessValue.max = game.maxNumber;
    guessInput.addEventListener("input", () => { guessValue.value = guessInput.value; });
    guessValue.addEventListener("input", () => {
        let value = Number(guessValue.value);
        if (value > game.maxNumber) { value = game.maxNumber; guessValue.value = value; }
        if (Number.isInteger(value) && value >= 1 && value <= game.maxNumber) guessInput.value = value;
    });
    view.querySelector(".guess-form").addEventListener("submit", event => { event.preventDefault(); const guess = Number(guessValue.value); if (!Number.isInteger(guess) || guess < 1 || guess > game.maxNumber) guessError.textContent = `Enter a whole number from 1 to ${game.maxNumber}.`; else { guessInput.value = guess; submitAction({ type: "guess", guess }); } });
    view.querySelector(".rules-btn").addEventListener("click", () => rulesDialog.showModal()); renderHistoryInto(view); gameCard.appendChild(view); setTimeout(() => questionInput.focus(), 0);
}
function renderAnswer() {
    gameCard.innerHTML = ""; const view = cloneTemplate("answerTemplate"); const pending = game.pendingQuestion;
    view.querySelector(".answer-label").textContent = `${playerName(pending.answerer)} • answer about your secret number`; view.querySelector(".asked-question").textContent = pending.question;
    view.querySelector(".own-secret-number").textContent = game.secrets[localPlayer()] ?? "hidden";
    const input = view.querySelector("#answerInput");
    view.querySelector(".answer-form").addEventListener("submit", event => { event.preventDefault(); const answer = input.value.trim(); if (!answer) view.querySelector(".answer-error").textContent = "Enter an answer first."; else submitAction({ type: "answer", answer }); });
    input.addEventListener("input", () => view.querySelector(".answer-char-count").textContent = `${input.value.length} / 220`); gameCard.appendChild(view); setTimeout(() => input.focus(), 0);
}
function renderHistoryInto(view) {
    const list = view.querySelector(".history-list"); view.querySelector(".history-count").textContent = `${game.history.length} turn${game.history.length === 1 ? "" : "s"} recorded`;
    if (!game.history.length) { list.innerHTML = `<div class="history-empty">No questions or guesses yet.</div>`; return; }
    [...game.history].reverse().forEach(item => {
        const entry = document.createElement("div"); entry.className = "history-item";
        if (item.type === "question") { entry.innerHTML = `<div class="history-meta">${playerName(item.asker)} asked</div><p></p><p class="answer"></p>`; entry.querySelector("p").textContent = `“${item.question}”`; entry.querySelector(".answer").textContent = `${playerName(item.answerer)}: ${item.answer}`; }
        else { entry.innerHTML = `<div class="history-meta">${playerName(item.player)} guessed</div><p></p>`; entry.querySelector("p").textContent = `${item.guess} — ${item.correct ? "correct" : "incorrect"}`; }
        list.appendChild(entry);
    });
}
function renderWinner(winner, winningGuess) {
    gameCard.innerHTML = ""; const view = cloneTemplate("resultTemplate");
    view.querySelector(".winner-title").textContent = `${playerName(winner)} wins!`; view.querySelector(".winner-copy").textContent = `${winningGuess} was the correct guess.`;
    view.querySelector(".reveal-box").textContent = `Final numbers\n${playerName(0)} chose ${game.secrets[0] ?? "hidden"}\n${playerName(1)} chose ${game.secrets[1] ?? "hidden"}`;
    view.querySelector(".play-again-btn").addEventListener("click", startRematch);
    view.querySelector(".exit-lobby-btn").addEventListener("click", resetGame);
    gameCard.appendChild(view);
}
function resetForRematch() {
    const opponentName = game.names[1];
    game.secrets = [null, null]; game.names = [game.nickname, opponentName]; game.currentPlayer = 0;
    game.maxNumber = DEFAULT_MAX_NUMBER; game.history = []; game.pendingQuestion = null;
    game.questionDraft = ""; game.phase = "lobby"; game.winner = null; game.winningGuess = null;
    send({ type: "rematch" }); renderLobby("host");
}
function resetGuestForRematch() {
    game.secrets = [null, null]; game.names[1] = game.nickname; game.currentPlayer = 0;
    game.maxNumber = DEFAULT_MAX_NUMBER; game.history = []; game.pendingQuestion = null;
    game.questionDraft = ""; game.phase = "lobby"; game.winner = null; game.winningGuess = null;
    renderLobby("connected"); send({ type: "join", name: game.nickname });
}
function startRematch() {
    if (game.role === "host") resetForRematch();
    else { send({ type: "rematch-request" }); renderWaiting("Rematch requested", "Waiting for the host to open a new game."); }
}
function resetGame() {
    if (game.connection) game.connection.close(); if (game.peer) game.peer.destroy();
    if (game.reconnectTimer) clearTimeout(game.reconnectTimer);
    clearLobbyCookie();
    game.role = null; game.peer = null; game.connection = null; game.hostCode = null; game.nickname = ""; game.secrets = [null, null]; game.names = [null, null]; game.currentPlayer = 0; game.maxNumber = DEFAULT_MAX_NUMBER; game.history = []; game.pendingQuestion = null; game.questionDraft = ""; game.phase = "lobby"; game.winner = null; game.winningGuess = null; game.reconnecting = false; game.reconnectTimer = null; renderStart();
}
document.querySelector(".close-dialog").addEventListener("click", () => rulesDialog.close());
rulesDialog.addEventListener("click", event => { if (event.target === rulesDialog) rulesDialog.close(); });
document.querySelector(".close-handoff-dialog").addEventListener("click", () => handoffDialog.close());
handoffDialog.addEventListener("click", event => { if (event.target === handoffDialog) handoffDialog.close(); });
renderStart();
