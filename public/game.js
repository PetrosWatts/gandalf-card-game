const socket = io();

// --- State ---
const state = {
  playerIndex: -1,
  roomCode: null,
  gameState: null,
  tackSelection: [],
  switchSelection: [],
  mode: 'lobby',
  turnDeadline: null,
  timerInterval: null,
};

const SUIT_SYMBOLS = { hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660' };
const SUIT_COLORS = { hearts: 'red', diamonds: 'red', clubs: 'black', spades: 'black' };

// --- Pip layouts: {x%, y%, rot (upside down)} ---
const PIP_LAYOUTS = {
  'A': [{ x: 50, y: 50, size: 'large' }],
  '2': [{ x: 50, y: 16 }, { x: 50, y: 84, rot: true }],
  '3': [{ x: 50, y: 16 }, { x: 50, y: 50 }, { x: 50, y: 84, rot: true }],
  '4': [{ x: 30, y: 16 }, { x: 70, y: 16 }, { x: 30, y: 84, rot: true }, { x: 70, y: 84, rot: true }],
  '5': [{ x: 30, y: 16 }, { x: 70, y: 16 }, { x: 50, y: 50 }, { x: 30, y: 84, rot: true }, { x: 70, y: 84, rot: true }],
  '6': [{ x: 30, y: 16 }, { x: 70, y: 16 }, { x: 30, y: 50 }, { x: 70, y: 50 }, { x: 30, y: 84, rot: true }, { x: 70, y: 84, rot: true }],
  '7': [{ x: 30, y: 16 }, { x: 70, y: 16 }, { x: 50, y: 33 }, { x: 30, y: 50 }, { x: 70, y: 50 }, { x: 30, y: 84, rot: true }, { x: 70, y: 84, rot: true }],
  '8': [{ x: 30, y: 16 }, { x: 70, y: 16 }, { x: 50, y: 33 }, { x: 30, y: 50 }, { x: 70, y: 50 }, { x: 50, y: 67, rot: true }, { x: 30, y: 84, rot: true }, { x: 70, y: 84, rot: true }],
  '9': [{ x: 30, y: 16 }, { x: 70, y: 16 }, { x: 30, y: 38 }, { x: 70, y: 38 }, { x: 50, y: 50 }, { x: 30, y: 62, rot: true }, { x: 70, y: 62, rot: true }, { x: 30, y: 84, rot: true }, { x: 70, y: 84, rot: true }],
  '10': [{ x: 30, y: 16 }, { x: 70, y: 16 }, { x: 50, y: 27 }, { x: 30, y: 38 }, { x: 70, y: 38 }, { x: 30, y: 62, rot: true }, { x: 70, y: 62, rot: true }, { x: 50, y: 73, rot: true }, { x: 30, y: 84, rot: true }, { x: 70, y: 84, rot: true }],
};

// --- DOM refs ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Card HTML builders ---
function cardFaceHTML(suit, rank, extraClass = '') {
  const sym = SUIT_SYMBOLS[suit];
  const color = SUIT_COLORS[suit];
  const isTen = rank === '10';
  const cornerRankClass = isTen ? 'corner-rank ten' : 'corner-rank';

  let inner = '';
  if (['J', 'Q', 'K'].includes(rank)) {
    // Face card
    const figureSymbols = { J: '\u265E', Q: '\u265B', K: '\u265A' }; // chess knight, queen, king
    inner = `<div class="card-figure">
      <span class="figure-symbol">${figureSymbols[rank]}</span>
      <span class="figure-suit">${sym}</span>
    </div>`;
  } else {
    // Pip card
    const layout = PIP_LAYOUTS[rank];
    let pips = '';
    for (const p of layout) {
      const rotClass = p.rot ? ' pip-rot' : '';
      const sizeClass = p.size === 'large' ? ' pip-ace' : '';
      pips += `<span class="pip${rotClass}${sizeClass}" style="left:${p.x}%;top:${p.y}%">${sym}</span>`;
    }
    inner = `<div class="card-pips">${pips}</div>`;
  }

  return `<div class="card-face ${color} ${extraClass}">
    <span class="card-corner top-left">
      <span class="${cornerRankClass}">${rank}</span>
      <span class="corner-suit">${sym}</span>
    </span>
    ${inner}
    <span class="card-corner bottom-right">
      <span class="${cornerRankClass}">${rank}</span>
      <span class="corner-suit">${sym}</span>
    </span>
  </div>`;
}

function cardBackHTML() {
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
    el.innerHTML = cardBackHTML();
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

// --- Peek Popup ---
function showPeekPopup(suit, rank) {
  const popup = document.createElement('div');
  popup.className = 'peek-popup';
  popup.innerHTML = `
    <div class="peek-popup-inner">
      <div class="peek-popup-label">Memorize this card!</div>
      <div class="card" style="width:90px;height:126px">${cardFaceHTML(suit, rank)}</div>
      <div class="peek-popup-timer-bar"><div class="peek-popup-timer-fill"></div></div>
    </div>
  `;
  document.body.appendChild(popup);
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

socket.on('turn-timer', ({ deadline }) => startTimerDisplay(deadline));
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

$('#btn-start').addEventListener('click', () => socket.emit('start-game'));

['#create-name', '#join-code', '#join-name'].forEach(sel => {
  $(sel).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (sel === '#create-name') $('#btn-create').click();
      else $('#btn-join').click();
    }
  });
});

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
    $('#timer-setting').classList.remove('hidden');
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
  $('#gandalf-banner').classList.add('hidden');
  $('#gandalf-overlay').classList.add('hidden');
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
  const overlay = $('#peek-overlay');
  const container = $('#peek-cards');
  const labels = $('#peek-labels');
  container.innerHTML = '';
  labels.innerHTML = '';

  // Sort by index to ensure left card is on the left
  cards.sort((a, b) => a.index - b.index);

  cards.forEach(c => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = cardFaceHTML(c.suit, c.rank);
    container.appendChild(el);
  });

  // Add position labels
  labels.innerHTML = '<span class="peek-label">Left Edge</span><span class="peek-label">Right Edge</span>';

  overlay.classList.remove('hidden');
  $('#btn-peek-done').addEventListener('click', () => {
    overlay.classList.add('hidden');
  }, { once: true });
});

socket.on('card-knowledge', ({ cardId, suit, rank }) => {
  showPeekPopup(suit, rank);
});

socket.on('card-replaced', ({ playerIndex, cardIndex, discardedCard, newCardId }) => {
  // Visual feedback handled by game-state update
});

socket.on('peek-animation', ({ playerIndex, cardIndex, peekerIndex }) => {
  setTimeout(() => {
    const allCards = $$('.card[data-player-index][data-card-index]');
    allCards.forEach(el => {
      if (parseInt(el.dataset.playerIndex) === playerIndex && parseInt(el.dataset.cardIndex) === cardIndex) {
        el.classList.add('peek-flip');
        setTimeout(() => el.classList.remove('peek-flip'), 900);
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
  // Handled by game-state update
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

socket.on('tack-glow', ({ playerIndex, cardIndex, tackerIndex }) => {
  setTimeout(() => {
    const allCards = $$('.card[data-player-index][data-card-index]');
    allCards.forEach(el => {
      if (parseInt(el.dataset.playerIndex) === playerIndex && parseInt(el.dataset.cardIndex) === cardIndex) {
        el.classList.add('tack-glow-effect');
        setTimeout(() => el.classList.remove('tack-glow-effect'), 2500);
      }
    });
  }, 50);
});

socket.on('gandalf-called', ({ callerIndex, callerName }) => {
  const overlay = $('#gandalf-overlay');
  $('#gandalf-caller-text').textContent = `${callerName} called Gandalf!`;
  overlay.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('hidden'), 3500);
  // Show persistent banner
  const banner = $('#gandalf-banner');
  $('#gandalf-banner-text').textContent = `FINAL ROUND \u2014 ${callerName} called Gandalf`;
  banner.classList.remove('hidden');
});

socket.on('notification', ({ message, type }) => showToast(message, type));

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
      <span class="score">${s.score} pts</span>
    </div>`;
  }).join('');

  if (state.playerIndex === 0) {
    $('#btn-play-again').classList.remove('hidden');
  }
  overlay.classList.remove('hidden');
  $('#gandalf-banner').classList.add('hidden');
});

$('#btn-play-again').addEventListener('click', () => socket.emit('play-again'));

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
    $('#turn-info').innerHTML = `<span class="gandalf-text">FINAL ROUND</span> \u2022 ${currentName}'s turn`;
  } else {
    $('#turn-info').textContent = isMyTurn ? 'Your turn!' : `${currentName}'s turn`;
  }

  // Opponents
  renderOpponents(gs, myIdx);

  // Center (deck + discard)
  $('#deck-count').textContent = gs.deckCount;
  $('#discard-count').textContent = gs.discardCount || 0;
  renderDiscard(gs);

  // Your cards
  renderYourCards(gs, myIdx, isMyTurn);

  // Drawn card
  renderDrawnCard(gs, isMyTurn);

  // Action bar
  renderActions(gs, myIdx, isMyTurn);

  // Timer sync
  if (gs.turnDeadline && gs.turnDeadline > Date.now() && !state.timerInterval) {
    startTimerDisplay(gs.turnDeadline);
  } else if (!gs.turnDeadline) {
    clearTimerDisplay();
  }
}

function renderOpponents(gs, myIdx) {
  const container = $('#opponents');
  container.innerHTML = '';
  const n = gs.players.length;

  for (let offset = 1; offset < n; offset++) {
    const pi = (myIdx + offset) % n;
    const p = gs.players[pi];

    const div = document.createElement('div');
    div.className = 'opponent';
    if (pi === gs.currentPlayerIndex && gs.phase === 'playing') div.classList.add('active-player');
    if (pi === gs.gandalfCallerIndex) div.classList.add('gandalf-caller');

    const label = document.createElement('div');
    label.className = 'player-label opp-label';
    if (pi === gs.currentPlayerIndex && gs.phase === 'playing') label.classList.add('current-turn');
    label.textContent = p.name;
    div.appendChild(label);

    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'opponent-cards';

    p.cards.forEach((card, ci) => {
      const cardEl = makeCardEl(card, false, true);
      cardEl.dataset.playerIndex = pi;
      cardEl.dataset.cardIndex = ci;
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
    pile.innerHTML = `<div class="card" style="position:absolute">${cardFaceHTML(gs.topDiscard.suit, gs.topDiscard.rank)}</div>`;
  } else {
    pile.innerHTML = '';
  }
}

function renderYourCards(gs, myIdx, isMyTurn) {
  const container = $('#your-cards');
  const player = gs.players[myIdx];
  container.innerHTML = '';

  const label = $('#your-label');
  label.textContent = player.name;
  label.className = 'player-label you-label';
  if (isMyTurn) label.classList.add('current-turn');
  if (myIdx === gs.gandalfCallerIndex) label.textContent += ' (GANDALF)';

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
  if (gs.turnPhase === 'drawn' && gs.drawnCard && isOwn) return true;
  if (gs.turnPhase === 'special-peek-self' && isOwn) return true;
  if (gs.turnPhase === 'special-peek-other' && !isOwn) return true;
  if (gs.turnPhase === 'special-switch') return true;
  if (state.tackSelection.length > 0 && state.tackSelection.length < 2) return true;
  return false;
}

function onCardClick(pi, ci) {
  const gs = state.gameState;
  if (!gs) return;
  const myIdx = gs.yourIndex;

  // Tack mode
  if (state.tackSelection.length > 0 && state.tackSelection.length < 2) {
    if (state.tackSelection[0].playerIndex === pi && state.tackSelection[0].cardIndex === ci) return;
    state.tackSelection.push({ playerIndex: pi, cardIndex: ci });
    // Broadcast second card glow
    socket.emit('tack-select', { playerIndex: pi, cardIndex: ci });
    const s = state.tackSelection;
    setTimeout(() => {
      socket.emit('tack', { p1: s[0].playerIndex, c1: s[0].cardIndex, p2: s[1].playerIndex, c2: s[1].cardIndex });
      state.tackSelection = [];
      $('#tack-overlay').classList.add('hidden');
      $$('.card.selectable').forEach(c => c.classList.remove('selectable', 'selected'));
    }, 300);
    return;
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

  $('#drawn-card-display').innerHTML =
    `<div class="card drawn-card-lg">${cardFaceHTML(card.suit, card.rank)}</div>
     <div class="drawn-subtitle">You drew this card</div>`;

  let buttons = '';
  buttons += `<button class="btn btn-outline btn-sm" onclick="doDiscard()">Discard</button>`;
  buttons += `<button class="btn btn-gold btn-sm" onclick="doReplace()">Replace a Card</button>`;

  // Ability button based on rank
  if (['7', '8'].includes(card.rank)) {
    buttons += `<button class="btn btn-ability btn-sm" onclick="doPeekSelf()">See One of Your Cards</button>`;
  }
  if (['9', '10'].includes(card.rank)) {
    buttons += `<button class="btn btn-ability btn-sm" onclick="doPeekOther()">See an Opponent's Card</button>`;
  }
  if (card.rank === 'J') {
    buttons += `<button class="btn btn-ability btn-sm" onclick="doSwitch()">Switch Two Cards</button>`;
  }
  if (card.rank === 'Q') {
    buttons += `<button class="btn btn-ability btn-sm" onclick="doSkipNext()">Skip Next Player</button>`;
  }
  if (card.rank === 'K') {
    buttons += `<button class="btn btn-ability btn-sm" onclick="doDrawAgain()">Draw Again</button>`;
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
      <button class="btn btn-gold" id="btn-draw">Draw</button>
      <button class="btn btn-outline" id="btn-tack">Tack</button>
      <button class="btn btn-gandalf-btn btn-sm" id="btn-gandalf" ${gs.gandalfCallerIndex !== null ? 'disabled style="opacity:0.4"' : ''}>Gandalf</button>
    `;
    $('#btn-draw').addEventListener('click', () => socket.emit('draw-card'));
    $('#btn-tack').addEventListener('click', () => {
      state.tackSelection = [];
      $('#tack-overlay').classList.remove('hidden');
      startTackMode();
    });
    if (gs.gandalfCallerIndex === null) {
      $('#btn-gandalf').addEventListener('click', () => {
        if (confirm('Call GANDALF? Everyone gets one more turn, then the game ends!')) {
          socket.emit('call-gandalf');
        }
      });
    }
    message.textContent = 'Your turn! Choose an action.';
  } else if (gs.turnPhase === 'drawn') {
    message.textContent = 'You drew a card. Choose what to do.';
  } else if (gs.turnPhase === 'special-peek-self') {
    message.textContent = 'Click one of your cards to peek at it.';
  } else if (gs.turnPhase === 'special-peek-other') {
    message.textContent = "Click an opponent's card to peek at it.";
  } else if (gs.turnPhase === 'special-switch') {
    message.textContent = `Click two cards to switch. (${state.switchSelection.length}/2 selected)`;
    $('#switch-overlay').classList.remove('hidden');
  }
}

function startTackMode() {
  state.tackSelection = [];
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
        // Broadcast glow to all players
        socket.emit('tack-select', { playerIndex: pi, cardIndex: ci });
        if (state.tackSelection.length === 2) {
          const s = state.tackSelection;
          setTimeout(() => {
            socket.emit('tack', { p1: s[0].playerIndex, c1: s[0].cardIndex, p2: s[1].playerIndex, c2: s[1].cardIndex });
            state.tackSelection = [];
            $('#tack-overlay').classList.add('hidden');
            $$('.card.selectable').forEach(c => c.classList.remove('selectable', 'selected'));
          }, 400);
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

// Deck click
$('#deck').addEventListener('click', () => {
  const gs = state.gameState;
  if (!gs) return;
  if (gs.currentPlayerIndex !== gs.yourIndex) return;
  if (gs.turnPhase !== 'choose-action') return;
  if (gs.phase !== 'playing') return;
  socket.emit('draw-card');
});

// --- Global action functions ---
window.doDiscard = () => socket.emit('discard-drawn');
window.doReplace = () => {
  $('#action-message').textContent = 'Click one of your cards to replace it.';
};
window.doPeekSelf = () => socket.emit('use-peek-self');
window.doPeekOther = () => socket.emit('use-peek-other');
window.doSwitch = () => {
  state.switchSelection = [];
  socket.emit('use-switch');
};
window.doSkipNext = () => socket.emit('use-skip-next');
window.doDrawAgain = () => socket.emit('use-draw-again');
