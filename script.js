const MAX_NUMBER = 50;

const game = {
  secrets: [null, null],
  currentPlayer: 0,
  setupPlayer: 0,
  history: [],
  pendingQuestion: null
};

const gameCard = document.getElementById("gameCard");
const rulesDialog = document.getElementById("rulesDialog");

const numberWords = new Set([
  "zero","one","two","three","four","five","six","seven","eight","nine","ten",
  "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen",
  "eighteen","nineteen","twenty","thirty","forty","fifty",
  "first","second","third","fourth","fifth","sixth","seventh","eighth","ninth",
  "tenth","half","quarter","double","triple"
]);

function cloneTemplate(id) {
  return document.getElementById(id).content.cloneNode(true);
}

function playerName(index) {
  return `Player ${index + 1}`;
}

function opponentOf(index) {
  return index === 0 ? 1 : 0;
}

function renderSetup(playerIndex) {
  gameCard.innerHTML = "";
  const view = cloneTemplate("setupTemplate");
  view.querySelector(".step-badge").textContent = `Setup ${playerIndex + 1} of 2`;
  view.querySelector(".screen-title").textContent = `${playerName(playerIndex)}, choose your number`;
  view.querySelector(".screen-copy").textContent =
    `Pick any whole number from 1 to ${MAX_NUMBER}. The next screen will hide it before the other player takes the device.`;

  const form = view.querySelector(".secret-form");
  const input = view.querySelector("#secretInput");
  const error = view.querySelector(".error");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = Number(input.value);

    if (!Number.isInteger(value) || value < 1 || value > MAX_NUMBER) {
      error.textContent = `Enter a whole number from 1 to ${MAX_NUMBER}.`;
      return;
    }

    game.secrets[playerIndex] = value;

    if (playerIndex === 0) {
      renderHandoff(
        "Player 1's number is locked",
        "Pass the device to Player 2. Player 1 should look away while Player 2 chooses a secret number.",
        () => renderSetup(1)
      );
    } else {
      renderHandoff(
        "Both numbers are locked",
        "Pass the device to Player 1. Player 1 gets the first turn.",
        () => {
          game.currentPlayer = 0;
          renderTurn();
        }
      );
    }
  });

  gameCard.appendChild(view);
  setTimeout(() => input.focus(), 0);
}

function renderHandoff(title, copy, onContinue) {
  gameCard.innerHTML = "";
  const view = cloneTemplate("handoffTemplate");
  view.querySelector(".screen-title").textContent = title;
  view.querySelector(".screen-copy").textContent = copy;
  view.querySelector(".continue-btn").addEventListener("click", onContinue);
  gameCard.appendChild(view);
}

function containsForbiddenNumber(text) {
  if (/\d/.test(text)) return true;

  const normalized = text
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .replace(/-/g, " ");

  const words = normalized.split(/\s+/).filter(Boolean);
  return words.some(word => numberWords.has(word));
}

function renderTurn() {
  gameCard.innerHTML = "";
  const view = cloneTemplate("turnTemplate");

  view.querySelector(".turn-label").textContent =
    `${playerName(game.currentPlayer)}'s turn • trying to find ${playerName(opponentOf(game.currentPlayer))}'s number`;

  const tabs = [...view.querySelectorAll(".mode-tab")];
  const questionPanel = view.querySelector(".question-panel");
  const guessPanel = view.querySelector(".guess-panel");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.toggle("active", t === tab));
      const isQuestion = tab.dataset.mode === "question";
      questionPanel.classList.toggle("hidden", !isQuestion);
      guessPanel.classList.toggle("hidden", isQuestion);
    });
  });

  const questionForm = view.querySelector(".question-form");
  const questionInput = view.querySelector("#questionInput");
  const questionError = view.querySelector(".question-error");
  const charCount = view.querySelector(".char-count");

  // Only show the example question during the first round
  // (before either player has completed a question/guess turn).
  if (game.history.length === 0) {
    questionInput.placeholder =
      "Example: Is your number closer to the beginning or the end of the range?";
  } else {
    questionInput.placeholder = "Ask a question about your opponent's number...";
  }

  questionInput.addEventListener("input", () => {
    charCount.textContent = `${questionInput.value.length} / 180`;
    questionError.textContent = "";
  });

  questionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = questionInput.value.trim();

    if (!question) {
      questionError.textContent = "Enter a question first.";
      return;
    }

    if (containsForbiddenNumber(question)) {
      questionError.textContent =
        "Questions cannot contain digits or number words. Rephrase it without numbers.";
      return;
    }

    game.pendingQuestion = {
      asker: game.currentPlayer,
      answerer: opponentOf(game.currentPlayer),
      question
    };

    renderHandoff(
      `${playerName(game.pendingQuestion.answerer)}, your answer is needed`,
      `${playerName(game.pendingQuestion.asker)} has submitted a question. Pass the device over before revealing it.`,
      renderAnswer
    );
  });

  const guessForm = view.querySelector(".guess-form");
  const guessInput = view.querySelector("#guessInput");
  const guessError = view.querySelector(".guess-error");

  guessForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const guess = Number(guessInput.value);

    if (!Number.isInteger(guess) || guess < 1 || guess > MAX_NUMBER) {
      guessError.textContent = `Enter a whole number from 1 to ${MAX_NUMBER}.`;
      return;
    }

    const targetPlayer = opponentOf(game.currentPlayer);
    const isCorrect = guess === game.secrets[targetPlayer];

    game.history.push({
      type: "guess",
      player: game.currentPlayer,
      guess,
      correct: isCorrect
    });

    if (isCorrect) {
      renderWinner(game.currentPlayer, guess);
    } else {
      const previousPlayer = game.currentPlayer;
      game.currentPlayer = targetPlayer;
      renderHandoff(
        "Not quite",
        `${playerName(previousPlayer)} guessed ${guess}, but it was incorrect. Pass the device to ${playerName(game.currentPlayer)}.`,
        renderTurn
      );
    }
  });

  view.querySelector(".rules-btn").addEventListener("click", () => rulesDialog.showModal());

  renderHistoryInto(view);
  gameCard.appendChild(view);
  setTimeout(() => questionInput.focus(), 0);
}

function renderAnswer() {
  gameCard.innerHTML = "";
  const view = cloneTemplate("answerTemplate");
  const pending = game.pendingQuestion;

  view.querySelector(".answer-label").textContent =
    `${playerName(pending.answerer)} • answer about your secret number`;
  view.querySelector(".asked-question").textContent = pending.question;

  const form = view.querySelector(".answer-form");
  const input = view.querySelector("#answerInput");
  const error = view.querySelector(".answer-error");
  const count = view.querySelector(".answer-char-count");

  input.addEventListener("input", () => {
    count.textContent = `${input.value.length} / 220`;
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const answer = input.value.trim();

    if (!answer) {
      error.textContent = "Enter an answer first.";
      return;
    }

    game.history.push({
      type: "question",
      asker: pending.asker,
      answerer: pending.answerer,
      question: pending.question,
      answer
    });

    game.currentPlayer = pending.answerer;
    game.pendingQuestion = null;

    renderHandoff(
      "Answer submitted",
      `Pass the device to ${playerName(game.currentPlayer)}. It is now their turn to ask a question or make a guess.`,
      renderTurn
    );
  });

  gameCard.appendChild(view);
  setTimeout(() => input.focus(), 0);
}

function renderHistoryInto(view) {
  const list = view.querySelector(".history-list");
  const count = view.querySelector(".history-count");

  count.textContent = `${game.history.length} turn${game.history.length === 1 ? "" : "s"} recorded`;

  if (game.history.length === 0) {
    list.innerHTML = `<div class="history-empty">No questions or guesses yet.</div>`;
    return;
  }

  const recent = [...game.history].reverse();

  recent.forEach(item => {
    const entry = document.createElement("div");
    entry.className = "history-item";

    if (item.type === "question") {
      entry.innerHTML = `
        <div class="history-meta">${playerName(item.asker)} asked</div>
        <p></p>
        <p class="answer"></p>
      `;
      entry.querySelector("p").textContent = `“${item.question}”`;
      entry.querySelector(".answer").textContent =
        `${playerName(item.answerer)}: ${item.answer}`;
    } else {
      entry.innerHTML = `
        <div class="history-meta">${playerName(item.player)} guessed</div>
        <p>${item.guess} — ${item.correct ? "correct" : "incorrect"}</p>
      `;
    }

    list.appendChild(entry);
  });
}

function renderWinner(winner, winningGuess) {
  gameCard.innerHTML = "";
  const view = cloneTemplate("resultTemplate");
  const loser = opponentOf(winner);

  view.querySelector(".winner-title").textContent = `${playerName(winner)} wins!`;
  view.querySelector(".winner-copy").textContent =
    `${winningGuess} was the correct guess.`;

  view.querySelector(".reveal-box").innerHTML =
    `<strong>Final numbers</strong><br>
     Player 1 chose ${game.secrets[0]}<br>
     Player 2 chose ${game.secrets[1]}`;

  view.querySelector(".restart-btn").addEventListener("click", resetGame);

  gameCard.appendChild(view);
}

function resetGame() {
  game.secrets = [null, null];
  game.currentPlayer = 0;
  game.setupPlayer = 0;
  game.history = [];
  game.pendingQuestion = null;
  renderSetup(0);
}

document.querySelector(".close-dialog").addEventListener("click", () => rulesDialog.close());
rulesDialog.addEventListener("click", (event) => {
  if (event.target === rulesDialog) rulesDialog.close();
});

renderSetup(0);
