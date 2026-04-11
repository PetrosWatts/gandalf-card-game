const socket = io();

// --- State ---
const state = {
  playerIndex: -1,
  roomCode: null,
  gameState: null,
  tackSelection: [],    // [{playerIndex, cardIndex}]
  switchSelection: [],
  mode: 'lobby',        // lobby | game
  turnDeadline: null,
  timerInterval: null,
};

const SUIT_SYMBOLS = { hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660' };
const SUIT_COLORS = { hearts: 'red', diamonds: 'red', clubs: 'black', spades: 'black' };

// --- DOM refs ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Card HTML builders ---
function cardFaceHTML(suit, rank, extraClass = '') {
  const sym = SUIT_SYMBOLS[suit];
  const color = SUIT_COLORS[suit];
  return `<div class="card-face ${color} ${extraClass}">
    <span class="card-rank">${rank}</span>
    <span class="card-suit-top">${sym}</span>
    <span class="card-suit-center">${sym}</span>
    <span class="card-rank-bottom">${rank}</span>
  </div>`;
}

function cardBackHTML(small = false) {
  return `<div class="card-back-design"><div class="card-back-inner">G</div></div>`;
}

function makeCardEl(card, isOwn, small = false) {
  const el = document.createElement('div');
  const sizeClass = small ? 'card card-sm' : 'card';

  if (card.faceUp) {
    el.className = sizeClass;
    el.innerHTML = cardFaceHTML(card.suit, card.rank);
  } else {
    el.className = `${sizeClass} card-back`;
    el.innerHTML = cardBackHTML(small);
  }
  el.dataset.cardId = card.id;
  return el;
}

// --- Toast notifications ---
function showToast(message, type = 'info') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// --- Peek Popup (temporary card reveal) ---
function showPeekPopup(suit, rank) {
  const popup = document.createElement('div');
  popup.className = 'peek-popup';
  popup.innerHTML = `
    <div class="peek-popup-inner">
      <div class="peek-popup-label">Memorize this card!</div>
      <div class="card" style="width:90px;height:125px">${cardFaceHTML(suit, rank)}</div>
      <div class="peek-popup-timer-bar"><div class="peek-popup-timer-fill"></div></div>
    </div>
  `;
  document.body.appendChild(popup);

  // Auto-dismiss after 3 seconds
  setTimeout(() => {
    popup.classList.add('fading');
    setTimeout(() => popup.remove(), 400);
  }, 3000);
}

// --- Turn Timer ---
function clearTimerDisplay() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.turnDeadline = null;
  const el = $('#turn-timer-display');
  if (el) el.classList.add('hidden');
}

function startTimerDisplay(deadline) {
  clearTimerDisplay();
  state.turnDeadline = deadline;
  const el = $('#turn-timer-display');
  if (!el) return;
  el.classList.remove('hidden');

  function tick() {
    const remaining = Math.max(0, Math.ceil((state.turnDeadline - Date.now()) / 1000));
    el.textContent = remaining + 's';
    el.className = 'turn-timer-display';
    if (remaining <= 5) el.classList.add('urgent');
    else if (remaining <= 10) el.classList.add('warning');
    if (remaining === 0) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }
  tick();
  state.timerInterval = setInterval(tick, 250);
}

socket.on('turn-timer', ({ deadline }) => {
  startTimerDisplay(deadline);
});

socket.on('timer-setting', ({ duration }) => {
  const sel = $('#timer-select');
  if (sel) sel.value = duration;
});

// --- Lobby ---
$('#btn-create').addEventListener('click', () => {
  const name = $('#create-name').value.trim();
  if (!name) return;
  socket.emit('create-room', { playerName: name });
});

$('#btn-join').addEventListener('click', () => {
  const code = $('#join-code').value.trim().toUpperCase();
  const name = $('#join-name').value.trim();
  if (!code || !name) return;
  socket.emit('join-room', { code, playerName: name });
});

$('#btn-start').addEventListener('click', () => {
  socket.emit('start-game');
});

// Enter key support
['#create-name', '#join-code', '#join-name'].forEach(sel => {
  $(sel).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (sel === '#create-name') $('#btn-create').click();
      else $('#btn-join').click();
    }
  });
});

// Timer setting
$('#timer-select').addEventListener('change', (e) => {
  socket.emit('set-timer', { duration: parseInt(e.target.value) });
});

socket.on('room-created', ({ code, playerIndex }) => {
  state.roomCode = code;
  state.playerIndex = playerIndex;
  $('#lobby-create').classList.add('hidden');
  $('#lobby-room').classList.remove('hidden');
  $('#room-code').textContent = code;
  $('#btn-start').classList.remove('hidden');
  $('#timer-setting').classList.remove('hidden');
  $('#lobby-info').textContent = 'Waiting for players (3-7)...';
});

socket.on('room-joined', ({ code, playerIndex }) => {
  state.roomCode = code;
  state.playerIndex = playerIndex;
  $('#lobby-create').classList.add('hidden');
  $('#lobby-room').classList.remove('hidden');
  $('#room-code').textContent = code;
  if (playerIndex === 0) {
    $('#btn-start').classList.remove('hidden');
    $('#lobby-info').textContent = 'Waiting for players (3-7)...';
  }
});

socket.on('lobby-update', ({ players }) => {
  const list = $('#player-list');
  list.innerHTML = players.map((p, i) =>
    `<div class="player-item">
      <span class="dot" style="background:${p.connected ? '#4caf50' : '#757575'}"></span>
      <span>${p.name}</span>
      ${i === 0 ? '<span class="host-badge">Host</span>' : ''}
    </div>`
  ).join('');
  if (state.playerIndex === 0) {
    $('#btn-start').disabled = players.length < 3;
  }
});

socket.on('error-msg', ({ message }) => {
  $('#lobby-error').textContent = message;
  showToast(message, 'error');
  setTimeout(() => $('#lobby-error').textContent = '', 4000);
});

socket.on('back-to-lobby', () => {
  state.mode = 'lobby';
  state.tackSelection = [];
  state.switchSelection = [];
  state.gameState = null;
  clearTimerDisplay();
  $('#game').classList.add('hidden');
  $('#lobby').classList.remove('hidden');
  $('#lobby-create').classList.add('hidden');
  $('#lobby-room').classList.remove('hidden');
  $('#gameover-overlay').classList.add('hidden');
});

// --- Game State ---
socket.on('game-state', (gs) => {
  state.gameState = gs;
  if (state.mode === 'lobby') {
    state.mode = 'game';
    $('#lobby').classList.add('hidden');
    $('#game').classList.remove('hidden');
  }
  renderGame();
});

socket.on('initial-peek', ({ cards }) => {
  // Show peek overlay
  const overlay = $('#peek-overlay');
  const container = $('#peek-cards');
  container.innerHTML = '';

  cards.forEach(c => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = cardFaceHTML(c.suit, c.rank);
    container.appendChild(el);
  });

  overlay.classList.remove('hidden');
  $('#btn-peek-done').addEventListener('click', () => {
    overlay.classList.add('hidden');
  }, { once: true });
});

socket.on('card-knowledge', ({ cardId, suit, rank }) => {
  // Show a brief peek popup - player must memorize the card
  showPeekPopup(suit, rank);
});

socket.on('card-replaced', ({ playerIndex, cardIndex, discardedCard, newCardId }) => {
  // Card replacement is visible via discard; new card identity is sent via card-knowledge
});

socket.on('peek-animation', ({ playerIndex, cardIndex, peekerIndex }) => {
  // Flash the peeked card position
  setTimeout(() => {
    const allCards = $$('.card[data-player-index][data-card-index]');
    allCards.forEach(el => {
      if (parseInt(el.dataset.playerIndex) === playerIndex && parseInt(el.dataset.cardIndex) === cardIndex) {
        el.classList.add('peek-highlight');
        setTimeout(() => el.classList.remove('peek-highlight'), 700);
      }
    });
  }, 100);

  if (peekerIndex !== state.playerIndex) {
    const gs = state.gameState;
    const peekerName = gs ? gs.players[peekerIndex].name : 'Someone';
    const targetName = gs ? gs.players[playerIndex].name : 'someone';
    showToast(`${peekerName} peeked at ${targetName}'s card #${cardIndex + 1}`, 'info');
  }
});

socket.on('cards-switched', ({ p1, c1, p2, c2, switcherIndex }) => {
  // Cards were switched - players must remember where cards went
});

socket.on('tack-reveal', ({ card1, card2, tackerIndex }) => {
  const gs = state.gameState;
  const tackerName = gs ? gs.players[tackerIndex].name : 'Someone';

  if (card1.rank === card2.rank) {
    showToast(`TACK! ${tackerName} matched ${card1.rank}s!`, 'success');
  } else {
    showToast(`TACK failed! ${card1.rank} vs ${card2.rank}`, 'error');
  }
});

socket.on('notification', ({ message, type }) => {
  showToast(message, type);
});

socket.on('game-over', ({ scores }) => {
  const overlay = $('#gameover-overlay');
  const gs = state.gameState;
  const board = $('#scoreboard');
  board.innerHTML = scores.map((s, i) => {
    let cls = 'score-row';
    if (i === 0) cls += ' winner';
    if (gs && s.index === gs.gandalfCallerIndex) cls += ' gandalf-caller';
    return `<div class="${cls}">
      <span class="rank-num">#${i + 1}</span>
      <span class="name">${s.name}</span>
      <span class="score">${s.score}</span>
    </div>`;
  }).join('');

  if (state.playerIndex === 0) {
    $('#btn-play-again').classList.remove('hidden');
  }
  overlay.classList.remove('hidden');
});

$('#btn-play-again').addEventListener('click', () => {
  socket.emit('play-again');
});

// --- Render ---
function renderGame() {
  const gs = state.gameState;
  if (!gs) return;

  const myIdx = gs.yourIndex;
  const isMyTurn = gs.currentPlayerIndex === myIdx && gs.phase === 'playing';

  // Header
  $('#room-info').textContent = `GANDALF \u2022 ${state.roomCode}`;
  const currentName = gs.players[gs.currentPlayerIndex]?.name || '';
  if (gs.phase === 'ended') {
    $('#turn-info').textContent = 'Game Over';
  } else if (gs.gandalfCallerIndex !== null) {
    $('#turn-info').innerHTML = `<span style="color:#ce93d8">GANDALF called!</span> \u2022 ${currentName}'s turn`;
  } else {
    $('#turn-info').textContent = isMyTurn ? 'Your turn!' : `${currentName}'s turn`;
  }

  // Opponents
  renderOpponents(gs, myIdx);

  // Center (deck + discard)
  $('#deck-count').textContent = gs.deckCount;
  renderDiscard(gs);

  // Your cards
  renderYourCards(gs, myIdx, isMyTurn);

  // Drawn card
  renderDrawnCard(gs, isMyTurn);

  // Action bar
  renderActions(gs, myIdx, isMyTurn);

  // Timer - sync from game state if we missed the event
  if (gs.turnDeadline && gs.turnDeadline > Date.now() && !state.timerInterval) {
    startTimerDisplay(gs.turnDeadline);
  } else if (!gs.turnDeadline) {
    clearTimerDisplay();
  }
}

function renderOpponents(gs, myIdx) {
  const container = $('#opponents');
  container.innerHTML = '';

  // Order players: starting from myIdx+1 going clockwise
  const n = gs.players.length;
  for (let offset = 1; offset < n; offset++) {
    const pi = (myIdx + offset) % n;
    const p = gs.players[pi];

    const div = document.createElement('div');
    div.className = 'opponent';
    if (pi === gs.currentPlayerIndex && gs.phase === 'playing') div.classList.add('active');
    if (pi === gs.gandalfCallerIndex) div.classList.add('gandalf-caller');

    const label = document.createElement('div');
    label.className = 'player-label';
    label.textContent = p.name;
    div.appendChild(label);

    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'opponent-cards';

    p.cards.forEach((card, ci) => {
      const cardEl = makeCardEl(card, false, true);
      cardEl.dataset.playerIndex = pi;
      cardEl.dataset.cardIndex = ci;

      // Make selectable in tack/switch/peek modes
      if (isCardSelectable(gs, pi, ci, false)) {
        cardEl.classList.add('selectable');
        cardEl.addEventListener('click', () => onCardClick(pi, ci));
      }

      cardsDiv.appendChild(cardEl);
    });

    div.appendChild(cardsDiv);
    container.appendChild(div);
  }
}

function renderDiscard(gs) {
  const pile = $('#discard-pile');
  if (gs.topDiscard) {
    pile.innerHTML = `<div class="card" style="position:absolute">${cardFaceHTML(gs.topDiscard.suit, gs.topDiscard.rank)}</div>
      <span class="area-label" style="position:absolute;bottom:-22px">Discard</span>`;
  } else {
    pile.innerHTML = '<span class="area-label">Discard</span>';
  }
}

function renderYourCards(gs, myIdx, isMyTurn) {
  const container = $('#your-cards');
  const player = gs.players[myIdx];
  container.innerHTML = '';

  const label = $('#your-label');
  label.textContent = player.name + (myIdx === gs.gandalfCallerIndex ? ' (GANDALF)' : '');
  label.className = 'player-label you-label';
  if (isMyTurn) label.classList.add('active-turn');

  player.cards.forEach((card, ci) => {
    const cardEl = makeCardEl(card, true, false);
    cardEl.dataset.playerIndex = myIdx;
    cardEl.dataset.cardIndex = ci;

    if (isCardSelectable(gs, myIdx, ci, true)) {
      cardEl.classList.add('selectable');
      cardEl.addEventListener('click', () => onCardClick(myIdx, ci));
    }

    container.appendChild(cardEl);
  });
}

function isCardSelectable(gs, pi, ci, isOwn) {
  const myIdx = gs.yourIndex;
  const isMyTurn = gs.currentPlayerIndex === myIdx && gs.phase === 'playing';
  if (!isMyTurn) return false;

  // Replace mode: can click own cards
  if (gs.turnPhase === 'drawn' && gs.drawnCard && isOwn) return true;

  // Peek self: own cards only
  if (gs.turnPhase === 'special-peek-self' && isOwn) return true;

  // Peek other: opponent cards only
  if (gs.turnPhase === 'special-peek-other' && !isOwn) return true;

  // Switch: any card
  if (gs.turnPhase === 'special-switch') return true;

  // Tack selection: any card (handled via tack overlay)
  if (state.tackSelection.length > 0 && state.tackSelection.length < 2) return true;

  return false;
}

function onCardClick(pi, ci) {
  const gs = state.gameState;
  if (!gs) return;

  const myIdx = gs.yourIndex;

  // Tack mode
  if (state.tackSelection.length > 0 || gs.turnPhase === 'choose-action') {
    if (state.tackSelection.length > 0 && state.tackSelection.length < 2) {
      // Don't allow selecting the same card twice
      if (state.tackSelection[0].playerIndex === pi && state.tackSelection[0].cardIndex === ci) return;

      state.tackSelection.push({ playerIndex: pi, cardIndex: ci });
      const s = state.tackSelection;
      socket.emit('tack', { p1: s[0].playerIndex, c1: s[0].cardIndex, p2: s[1].playerIndex, c2: s[1].cardIndex });
      state.tackSelection = [];
      $('#tack-overlay').classList.add('hidden');
      return;
    }
  }

  // Replace card with drawn card
  if (gs.turnPhase === 'drawn' && gs.drawnCard && pi === myIdx) {
    socket.emit('replace-card', { cardIndex: ci });
    return;
  }

  // Peek self
  if (gs.turnPhase === 'special-peek-self' && pi === myIdx) {
    socket.emit('peek-card', { playerIndex: pi, cardIndex: ci });
    return;
  }

  // Peek other
  if (gs.turnPhase === 'special-peek-other' && pi !== myIdx) {
    socket.emit('peek-card', { playerIndex: pi, cardIndex: ci });
    return;
  }

  // Switch
  if (gs.turnPhase === 'special-switch') {
    state.switchSelection.push({ playerIndex: pi, cardIndex: ci });
    if (state.switchSelection.length === 2) {
      const s = state.switchSelection;
      socket.emit('switch-cards', { p1: s[0].playerIndex, c1: s[0].cardIndex, p2: s[1].playerIndex, c2: s[1].cardIndex });
      state.switchSelection = [];
      $('#switch-overlay').classList.add('hidden');
    } else {
      // Highlight selected card
      renderGame();
    }
    return;
  }
}

function renderDrawnCard(gs, isMyTurn) {
  const area = $('#drawn-card-area');
  if (!isMyTurn || !gs.drawnCard || gs.turnPhase !== 'drawn') {
    area.classList.add('hidden');
    return;
  }

  area.classList.remove('hidden');
  const card = gs.drawnCard;
  const sym = SUIT_SYMBOLS[card.suit];
  const color = SUIT_COLORS[card.suit];

  $('#drawn-card-display').innerHTML =
    `<div class="card">${cardFaceHTML(card.suit, card.rank)}</div>
     <div style="font-size:0.8rem;color:rgba(250,248,240,0.5);margin-top:4px">You drew this card</div>`;

  // Action buttons based on card rank
  let buttons = `<button class="btn btn-outline btn-sm" onclick="doDiscard()">Discard</button>`;
  buttons += `<button class="btn btn-gold btn-sm" onclick="doReplace()">Replace a Card</button>`;

  if (['7', '8'].includes(card.rank)) {
    buttons += `<button class="btn btn-outline btn-sm" onclick="doPeekSelf()">Peek at Own Card</button>`;
  }
  if (['9', '10'].includes(card.rank)) {
    buttons += `<button class="btn btn-outline btn-sm" onclick="doPeekOther()">Peek at Opponent's Card</button>`;
  }
  if (card.rank === 'J') {
    buttons += `<button class="btn btn-outline btn-sm" onclick="doSwitch()">Switch Two Cards</button>`;
  }

  $('#drawn-actions').innerHTML = buttons;
}

function renderActions(gs, myIdx, isMyTurn) {
  const buttons = $('#action-buttons');
  const message = $('#action-message');
  buttons.innerHTML = '';
  message.textContent = '';

  if (gs.phase === 'ended') {
    message.textContent = 'Game over! Check the scoreboard.';
    return;
  }

  if (!isMyTurn) {
    const currentName = gs.players[gs.currentPlayerIndex]?.name || '';
    message.textContent = `Waiting for ${currentName}...`;
    return;
  }

  if (gs.turnPhase === 'choose-action') {
    buttons.innerHTML = `
      <button class="btn btn-gold" id="btn-draw">Draw Card</button>
      <button class="btn btn-outline" id="btn-tack">TACK</button>
      <button class="btn btn-danger btn-sm" id="btn-gandalf" ${gs.gandalfCallerIndex !== null ? 'disabled style="opacity:0.4"' : ''}>GANDALF</button>
    `;
    $('#btn-draw').addEventListener('click', () => {
      socket.emit('draw-card');
    });
    $('#btn-tack').addEventListener('click', () => {
      state.tackSelection = []; // Reset
      // Wait for first card click - show overlay
      $('#tack-overlay').classList.remove('hidden');
      // Make all cards selectable
      startTackMode();
    });
    if (gs.gandalfCallerIndex === null) {
      $('#btn-gandalf').addEventListener('click', () => {
        if (confirm('Are you sure you want to call GANDALF? One more round and the game ends!')) {
          socket.emit('call-gandalf');
        }
      });
    }
    message.textContent = 'Your turn! Choose an action.';
  } else if (gs.turnPhase === 'drawn') {
    message.textContent = 'You drew a card. Choose what to do with it.';
  } else if (gs.turnPhase === 'special-peek-self') {
    message.textContent = 'Click one of your cards to peek at it.';
  } else if (gs.turnPhase === 'special-peek-other') {
    message.textContent = "Click an opponent's card to peek at it.";
  } else if (gs.turnPhase === 'special-switch') {
    message.textContent = `Click two cards to switch them. (${state.switchSelection.length}/2 selected)`;
    $('#switch-overlay').classList.remove('hidden');
  }
}

function startTackMode() {
  state.tackSelection = [{length: 0}]; // Placeholder to trigger selectable rendering
  state.tackSelection = []; // Reset properly
  // We need to make cards selectable - trigger re-render with tack state
  // Actually we handle this by checking tackSelection in isCardSelectable
  // For now just manually add selectable class to all cards
  const allCards = $$('#opponents .card, #your-cards .card');
  allCards.forEach(el => {
    el.classList.add('selectable');
    const pi = parseInt(el.dataset.playerIndex);
    const ci = parseInt(el.dataset.cardIndex);
    el.addEventListener('click', function handler() {
      if (state.tackSelection.length < 2) {
        state.tackSelection.push({ playerIndex: pi, cardIndex: ci });
        el.classList.add('selected');
        el.removeEventListener('click', handler);

        if (state.tackSelection.length === 2) {
          const s = state.tackSelection;
          socket.emit('tack', { p1: s[0].playerIndex, c1: s[0].cardIndex, p2: s[1].playerIndex, c2: s[1].cardIndex });
          state.tackSelection = [];
          $('#tack-overlay').classList.add('hidden');
          // Remove selectable from all
          $$('.card.selectable').forEach(c => c.classList.remove('selectable', 'selected'));
        }
      }
    });
  });
}

$('#btn-cancel-tack').addEventListener('click', () => {
  state.tackSelection = [];
  $('#tack-overlay').classList.add('hidden');
  $$('.card.selectable').forEach(c => c.classList.remove('selectable', 'selected'));
  renderGame();
});

// --- Deck click handler ---
$('#deck').addEventListener('click', () => {
  const gs = state.gameState;
  if (!gs) return;
  if (gs.currentPlayerIndex !== gs.yourIndex) return;
  if (gs.turnPhase !== 'choose-action') return;
  if (gs.phase !== 'playing') return;
  socket.emit('draw-card');
});

// --- Global action functions (called from rendered buttons) ---
window.doDiscard = () => socket.emit('discard-drawn');
window.doReplace = () => {
  // Just inform user to click a card
  $('#action-message').textContent = 'Click one of your cards to replace it.';
};
window.doPeekSelf = () => socket.emit('use-peek-self');
window.doPeekOther = () => socket.emit('use-peek-other');
window.doSwitch = () => {
  state.switchSelection = [];
  socket.emit('use-switch');
};
