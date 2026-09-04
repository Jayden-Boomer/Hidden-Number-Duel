const DEFAULT_MAX_NUMBER = 50;
const MAX_ENDPOINT = 1000;
const MAX_NICKNAME_LENGTH = 24;

const game = {
    role: null,
    peer: null,
    connection: null,
    nickname: "",
    secrets: [null, null],
    names: [null, null],
    currentPlayer: 0,
    maxNumber: DEFAULT_MAX_NUMBER,
    history: [],
    pendingQuestion: null,
    phase: "lobby",
    winner: null,
    winningGuess: null
};

const gameCard = document.getElementById("gameCard");
const rulesDialog = document.getElementById("rulesDialog");
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
function send(message) { if (game.connection && game.connection.open) game.connection.send(message); }
function publicState() {
    return {
        type: "state", names: game.names, maxNumber: game.maxNumber, currentPlayer: game.currentPlayer,
        history: game.history, pendingQuestion: game.pendingQuestion, phase: game.phase,
        winner: game.winner, winningGuess: game.winningGuess
    };
}
function broadcastState() { send(publicState()); }

function renderStart() {
    document.querySelector(".range-pill").classList.add("hidden");
    gameCard.innerHTML = `<div class="screen">
        <div class="step-badge">Start a duel</div>
        <h2 class="screen-title">Enter the arena</h2>
        <p class="screen-copy">Choose a nickname, then host a new lobby or join a duel already waiting for you.</p>
        <form class="secret-form start-form">
            <label for="startNickname">Your nickname</label>
            <input id="startNickname" type="text" maxlength="${MAX_NICKNAME_LENGTH}" autocomplete="nickname" required />
            <label for="lobbyChoice">Lobby mode</label>
            <select id="lobbyChoice" required><option value="host">Host lobby</option><option value="join">Join lobby</option></select>
            <div class="join-code-field hidden"><label for="hostCode">Host lobby code</label><input id="hostCode" type="text" maxlength="64" autocomplete="off" placeholder="Paste the host code" /></div>
            <p class="error" role="alert"></p><button type="submit" class="primary-btn wide-btn">Continue</button>
        </form>
    </div>`;
    const form = gameCard.querySelector(".start-form");
    const choice = gameCard.querySelector("#lobbyChoice");
    const joinField = gameCard.querySelector(".join-code-field");
    const nickname = gameCard.querySelector("#startNickname");
    const error = gameCard.querySelector(".error");
    choice.addEventListener("change", () => joinField.classList.toggle("hidden", choice.value !== "join"));
    form.addEventListener("submit", event => {
        event.preventDefault();
        game.nickname = nickname.value.trim().slice(0, MAX_NICKNAME_LENGTH);
        if (!game.nickname) { error.textContent = "Enter a nickname first."; nickname.focus(); return; }
        if (choice.value === "host") startHosting();
        else startJoining(gameCard.querySelector("#hostCode").value.trim(), error);
    });
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
        label.textContent = "Lobby status"; input.classList.add("hidden"); input.removeAttribute("required");
        range.classList.remove("hidden"); submit.textContent = "Waiting for opponent"; submit.disabled = true;
        setStatus("Waiting for an opponent to join...");
        if (errorMessage) errorText.textContent = errorMessage;
        form.addEventListener("submit", event => {
            event.preventDefault();
            const maxNumber = Number(rangeInput.value);
            if (!Number.isInteger(maxNumber) || maxNumber < 2 || maxNumber > MAX_ENDPOINT) { errorText.textContent = `Choose a whole-number endpoint from 2 to ${MAX_ENDPOINT}.`; return; }
            game.maxNumber = maxNumber; game.phase = "setup";
            send({ type: "game-start", maxNumber, names: game.names }); renderSecretSetup();
        });
    } else if (role === "connecting") {
        badge.textContent = "Join lobby";
        title.textContent = "Joining lobby";
        copy.textContent = "Your lobby code was submitted. We are connecting you to the host now.";
        label.textContent = "Connection status";
        input.classList.add("hidden");
        input.removeAttribute("required");
        submit.classList.add("hidden");
        errorText.textContent = errorMessage;
        view.querySelector(".lobby-status").textContent = "Connecting to the host...";
    } else {
        badge.textContent = "Join lobby"; title.textContent = "Connect to your opponent";
        copy.textContent = "Enter the host code exactly as it appears on their screen.";
        label.textContent = "Host lobby code"; input.placeholder = "Paste the host code"; submit.textContent = "Join lobby";
        if (errorMessage) errorText.textContent = errorMessage;
        form.addEventListener("submit", event => { event.preventDefault(); startJoining(input.value.trim(), errorText); });
    }
    gameCard.appendChild(view);
}

function startHosting() {
    if (typeof Peer === "undefined") { renderLobby("host", "PeerJS could not load. Check your internet connection and try again."); return; }
    game.role = "host"; game.names = [game.nickname, null]; game.peer = new Peer(); renderLobby("host");
    game.peer.on("open", () => { const code = document.querySelector(".lobby-code"); if (code) code.textContent = game.peer.id; });
    game.peer.on("connection", connection => {
        if (game.connection) { connection.close(); return; }
        game.connection = connection;
        connection.on("open", () => send({ type: "lobby-info", name: game.nickname }));
        connection.on("data", handleHostMessage);
        connection.on("close", () => setStatus("Your opponent disconnected.", true));
        connection.on("error", () => setStatus("The connection was interrupted.", true));
    });
    game.peer.on("error", error => setStatus(error.type === "peer-unavailable" ? "That lobby was not found." : "PeerJS could not connect.", true));
}

function startJoining(hostCode, errorElement) {
    if (!hostCode) { errorElement.textContent = "Enter the host lobby code."; return; }
    if (typeof Peer === "undefined") { errorElement.textContent = "PeerJS could not load. Check your internet connection and try again."; return; }
    game.role = "guest"; game.peer = new Peer(); renderLobby("connecting");
    game.peer.on("open", () => {
        game.connection = game.peer.connect(hostCode);
        game.connection.on("open", () => send({ type: "join", name: game.nickname }));
        game.connection.on("data", handleGuestMessage);
        game.connection.on("error", () => setStatus("The connection was interrupted.", true));
        game.connection.on("close", () => setStatus("The host disconnected.", true));
    });
    game.peer.on("error", () => setStatus("That lobby could not be reached.", true));
}

function handleHostMessage(message) {
    if (message.type === "lobby-info" || message.type === "join") {
        game.names[1] = String(message.name || "Opponent").trim().slice(0, MAX_NICKNAME_LENGTH);
        const submit = document.querySelector(".lobby-submit");
        if (submit) { submit.disabled = false; submit.textContent = "Start duel"; }
        setStatus(`${playerName(1)} joined. Set the range when you are ready.`);
    } else if (message.type === "secret-set") { game.secrets[1] = message.secret; maybeStartGame(); }
    else if (message.type === "action") processAction(message.action, 1);
}
function handleGuestMessage(message) {
    if (message.type === "lobby-info") {
        game.names[0] = String(message.name || "Host").trim().slice(0, MAX_NICKNAME_LENGTH);
        const title = document.querySelector(".lobby-title");
        const copy = document.querySelector(".lobby-copy");
        if (title) title.textContent = "Lobby joined";
        if (copy) copy.textContent = `You are connected to ${playerName(0)}. Wait for the host to choose the range and start the duel.`;
        setStatus("Connected. Waiting for the host to start...");
    } else if (message.type === "host-secret-ready") {
        const copy = document.querySelector(".screen-copy");
        if (copy && game.phase === "setup") copy.textContent = `The host has locked their number. Choose your secret number from 1 to ${game.maxNumber}.`;
    } else if (message.type === "game-start") {
        game.names = message.names; game.maxNumber = message.maxNumber; game.phase = "setup"; updateRangeDisplay(); renderSecretSetup();
    } else if (message.type === "state") {
        Object.assign(game, message); updateRangeDisplay(); renderNetworkState();
    }
}

function renderSecretSetup() {
    document.querySelector(".range-pill").classList.remove("hidden"); gameCard.innerHTML = "";
    const view = cloneTemplate("setupTemplate");
    view.querySelector(".step-badge").textContent = "Secret number";
    view.querySelector(".screen-title").textContent = "Choose your secret number";
    view.querySelector(".screen-copy").textContent = `Pick any whole number from 1 to ${game.maxNumber}. Your opponent will never receive it.`;
    const form = view.querySelector(".secret-form"); const nicknameInput = view.querySelector("#nicknameInput");
    nicknameInput.value = game.nickname; nicknameInput.readOnly = true;
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
    view.querySelector(".continue-btn").classList.add("hidden"); gameCard.appendChild(view);
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
    else renderWaiting("Opponent's turn", `${playerName(game.currentPlayer)} is deciding whether to ask a question or make a guess.`);
}
function containsForbiddenNumber(text) {
    if (/\d/.test(text)) return true;
    const words = text.toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean);
    return words.some(word => numberWords.has(word));
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
    gameCard.innerHTML = ""; const view = cloneTemplate("turnTemplate");
    view.querySelector(".turn-label").textContent = `${playerName(game.currentPlayer)}'s turn • trying to find ${playerName(opponentOf(game.currentPlayer))}'s number`;
    const tabs = [...view.querySelectorAll(".mode-tab")]; const questionPanel = view.querySelector(".question-panel"); const guessPanel = view.querySelector(".guess-panel");
    tabs.forEach(tab => tab.addEventListener("click", () => { tabs.forEach(item => item.classList.toggle("active", item === tab)); const isQuestion = tab.dataset.mode === "question"; questionPanel.classList.toggle("hidden", !isQuestion); guessPanel.classList.toggle("hidden", isQuestion); }));
    const questionInput = view.querySelector("#questionInput"); const questionError = view.querySelector(".question-error");
    questionInput.addEventListener("input", () => { view.querySelector(".char-count").textContent = `${questionInput.value.length} / 180`; questionError.textContent = ""; });
    view.querySelector(".question-form").addEventListener("submit", event => {
        event.preventDefault(); const question = questionInput.value.trim();
        if (!question) questionError.textContent = "Enter a question first.";
        else if (containsForbiddenNumber(question)) questionError.textContent = "Questions cannot contain digits or number words. Rephrase it without numbers.";
        else submitAction({ type: "question", question });
    });
    const guessInput = view.querySelector("#guessInput"); const guessError = view.querySelector(".guess-error"); guessInput.max = game.maxNumber;
    view.querySelector(".guess-form").addEventListener("submit", event => { event.preventDefault(); const guess = Number(guessInput.value); if (!Number.isInteger(guess) || guess < 1 || guess > game.maxNumber) guessError.textContent = `Enter a whole number from 1 to ${game.maxNumber}.`; else submitAction({ type: "guess", guess }); });
    view.querySelector(".rules-btn").addEventListener("click", () => rulesDialog.showModal()); renderHistoryInto(view); gameCard.appendChild(view); setTimeout(() => questionInput.focus(), 0);
}
function renderAnswer() {
    gameCard.innerHTML = ""; const view = cloneTemplate("answerTemplate"); const pending = game.pendingQuestion;
    view.querySelector(".answer-label").textContent = `${playerName(pending.answerer)} • answer about your secret number`; view.querySelector(".asked-question").textContent = pending.question;
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
    view.querySelector(".restart-btn").addEventListener("click", resetGame); gameCard.appendChild(view);
}
function resetGame() {
    if (game.connection) game.connection.close(); if (game.peer) game.peer.destroy();
    game.role = null; game.peer = null; game.connection = null; game.nickname = ""; game.secrets = [null, null]; game.names = [null, null]; game.currentPlayer = 0; game.maxNumber = DEFAULT_MAX_NUMBER; game.history = []; game.pendingQuestion = null; game.phase = "lobby"; game.winner = null; game.winningGuess = null; renderStart();
}
document.querySelector(".close-dialog").addEventListener("click", () => rulesDialog.close());
rulesDialog.addEventListener("click", event => { if (event.target === rulesDialog) rulesDialog.close(); });
renderStart();
