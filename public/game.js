const socket = io();

// ============================================================
// STATE
// ============================================================
const state = {
  playerIndex: -1,
  roomCode: null,
  gameState: null,
  tackSelection: [],
  switchSelection: [],
  mode: 'lobby',
  turnDeadline: null,
  timerInterval: null,
  lastMove: '',
};

// ============================================================
// CONSTANTS
// ============================================================
const SUIT_SYM = { hearts:'\u2665', diamonds:'\u2666', clubs:'\u2663', spades:'\u2660' };
const SUIT_CLR = { hearts:'red', diamonds:'red', clubs:'black', spades:'black' };

// Pip positions: {x%, y%}  r=rotated 180deg   a=ace (large)
const PIPS = {
  'A': [{x:50,y:50,a:1}],
  '2': [{x:50,y:18},{x:50,y:82,r:1}],
  '3': [{x:50,y:18},{x:50,y:50},{x:50,y:82,r:1}],
  '4': [{x:28,y:18},{x:72,y:18},{x:28,y:82,r:1},{x:72,y:82,r:1}],
  '5': [{x:28,y:18},{x:72,y:18},{x:50,y:50},{x:28,y:82,r:1},{x:72,y:82,r:1}],
  '6': [{x:28,y:18},{x:72,y:18},{x:28,y:50},{x:72,y:50},{x:28,y:82,r:1},{x:72,y:82,r:1}],
  '7': [{x:28,y:18},{x:72,y:18},{x:50,y:34},{x:28,y:50},{x:72,y:50},{x:28,y:82,r:1},{x:72,y:82,r:1}],
  '8': [{x:28,y:18},{x:72,y:18},{x:50,y:34},{x:28,y:50},{x:72,y:50},{x:50,y:66,r:1},{x:28,y:82,r:1},{x:72,y:82,r:1}],
  '9': [{x:28,y:18},{x:72,y:18},{x:28,y:39},{x:72,y:39},{x:50,y:50},{x:28,y:61,r:1},{x:72,y:61,r:1},{x:28,y:82,r:1},{x:72,y:82,r:1}],
  '10':[{x:28,y:18},{x:72,y:18},{x:50,y:28},{x:28,y:39},{x:72,y:39},{x:28,y:61,r:1},{x:72,y:61,r:1},{x:50,y:72,r:1},{x:28,y:82,r:1},{x:72,y:82,r:1}],
};

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ============================================================
// CARD HTML RENDERING
// ============================================================
function cardFaceHTML(suit, rank) {
  const sym = SUIT_SYM[suit], clr = SUIT_CLR[suit];
  const rkCls = rank === '10' ? 'corner-rank ten' : 'corner-rank';
  let body = '';
  if (['J','Q','K'].includes(rank)) {
    body = `<div class="card-figure">
      <div class="fig-half fig-top"><span class="fig-letter">${rank}</span><span class="fig-suit">${sym}</span></div>
      <div class="fig-line"></div>
      <div class="fig-half fig-bot"><span class="fig-letter">${rank}</span><span class="fig-suit">${sym}</span></div>
    </div>`;
  } else {
    const pips = PIPS[rank];
    let ps = '';
    for (const p of pips) {
      const cls = (p.r ? ' pip-r' : '') + (p.a ? ' pip-a' : '');
      ps += `<span class="pip${cls}" style="left:${p.x}%;top:${p.y}%">${sym}</span>`;
    }
    body = `<div class="card-pips">${ps}</div>`;
  }
  return `<div class="card-face ${clr}">
    <span class="card-corner tl"><span class="${rkCls}">${rank}</span><span class="corner-suit">${sym}</span></span>
    ${body}
    <span class="card-corner br"><span class="${rkCls}">${rank}</span><span class="corner-suit">${sym}</span></span>
  </div>`;
}

function cardBackInner() {
  return '<div class="cb-design"><div class="cb-letter">G</div></div>';
}

function makeCardEl(card, small) {
  const el = document.createElement('div');
  const sz = small ? 'card card-sm' : 'card';
  if (card.faceUp) { el.className = sz; el.innerHTML = cardFaceHTML(card.suit, card.rank); }
  else { el.className = sz + ' card-back'; el.innerHTML = cardBackInner(); }
  el.dataset.cardId = card.id;
  return el;
}

// ============================================================
// ANIMATION HELPERS
// ============================================================
let renderDelay = 0;
let pendingGS = null;
let renderTimeout = null;

function scheduleRender(gs) {
  if (state.mode === 'lobby') {
    state.mode = 'game';
    $('#lobby').classList.add('hidden');
    $('#game').classList.remove('hidden');
  }
  if (renderDelay > 0 && !pendingGS) {
    pendingGS = gs;
    renderTimeout = setTimeout(() => {
      state.gameState = pendingGS;
      pendingGS = null;
      renderDelay = 0;
      renderGame();
    }, renderDelay);
  } else if (pendingGS) {
    pendingGS = gs;
  } else {
    state.gameState = gs;
    renderGame();
  }
}

function getRect(sel) {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  return el ? el.getBoundingClientRect() : null;
}
function cardRect(pi, ci) {
  const el = document.querySelector(`[data-player-index="${pi}"][data-card-index="${ci}"]`);
  return el ? el.getBoundingClientRect() : null;
}

function createFlyer(rect, html, extra) {
  const el = document.createElement('div');
  el.className = 'flyer ' + (extra || '');
  el.innerHTML = html;
  Object.assign(el.style, {
    position:'fixed', left:rect.left+'px', top:rect.top+'px',
    width:rect.width+'px', height:rect.height+'px',
    zIndex:500, pointerEvents:'none', borderRadius:'8px',
  });
  document.body.appendChild(el);
  return el;
}

function flyTo(el, dest, dur) {
  dur = dur || 450;
  return new Promise(resolve => {
    el.offsetHeight;
    el.style.transition = `all ${dur}ms cubic-bezier(.4,0,.2,1)`;
    Object.assign(el.style, { left:dest.left+'px', top:dest.top+'px', width:dest.width+'px', height:dest.height+'px' });
    setTimeout(() => { el.remove(); resolve(); }, dur);
  });
}

function createFlipCard(rect, faceHTML) {
  const w = document.createElement('div');
  w.className = 'flip-wrap';
  Object.assign(w.style, {
    position:'fixed', left:rect.left+'px', top:rect.top+'px',
    width:rect.width+'px', height:rect.height+'px', zIndex:500, pointerEvents:'none',
  });
  w.innerHTML = `<div class="flip-inner">
    <div class="flip-front card-back">${cardBackInner()}</div>
    <div class="flip-back">${faceHTML}</div>
  </div>`;
  document.body.appendChild(w);
  return {
    el: w,
    flip(face) { w.querySelector('.flip-inner').classList.toggle('flipped', face); },
    async moveTo(d, dur) {
      dur = dur || 450;
      w.offsetHeight;
      w.style.transition = `left ${dur}ms ease, top ${dur}ms ease, width ${dur}ms ease, height ${dur}ms ease`;
      Object.assign(w.style, { left:d.left+'px', top:d.top+'px', width:d.width+'px', height:d.height+'px' });
      return new Promise(r => setTimeout(r, dur));
    },
    remove() { w.remove(); }
  };
}

// ============================================================
// TOAST & PEEK POPUP
// ============================================================
function showToast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast ' + (type||'info');
  t.textContent = msg;
  $('#toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function showPeekPopup(suit, rank) {
  const p = document.createElement('div');
  p.className = 'peek-popup';
  p.innerHTML = `<div class="peek-popup-inner">
    <div class="peek-popup-label">Memorize this card!</div>
    <div class="card" style="width:90px;height:126px;font-size:15px">${cardFaceHTML(suit, rank)}</div>
    <div class="peek-bar"><div class="peek-bar-fill"></div></div>
  </div>`;
  document.body.appendChild(p);
  setTimeout(() => { p.classList.add('fading'); setTimeout(() => p.remove(), 400); }, 3000);
}

// ============================================================
// TIMER
// ============================================================
function clearTimer() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
  state.turnDeadline = null;
  const el = $('#turn-timer-display');
  if (el) el.classList.add('hidden');
}
function startTimer(deadline) {
  clearTimer();
  state.turnDeadline = deadline;
  const el = $('#turn-timer-display');
  if (!el) return;
  el.classList.remove('hidden');
  function tick() {
    const rem = Math.max(0, Math.ceil((state.turnDeadline - Date.now()) / 1000));
    el.textContent = rem + 's';
    el.className = 'turn-timer-display';
    if (rem <= 5) el.classList.add('urgent');
    else if (rem <= 10) el.classList.add('warning');
    if (rem === 0) { clearInterval(state.timerInterval); state.timerInterval = null; }
  }
  tick();
  state.timerInterval = setInterval(tick, 250);
}
socket.on('turn-timer', ({ deadline }) => startTimer(deadline));
socket.on('timer-setting', ({ duration }) => { const s = $('#timer-select'); if (s) s.value = duration; });

// ============================================================
// LOBBY
// ============================================================
$('#btn-create').addEventListener('click', () => { const n = $('#create-name').value.trim(); if (n) socket.emit('create-room', { playerName: n }); });
$('#btn-join').addEventListener('click', () => { const c = $('#join-code').value.trim().toUpperCase(), n = $('#join-name').value.trim(); if (c && n) socket.emit('join-room', { code: c, playerName: n }); });
$('#btn-start').addEventListener('click', () => socket.emit('start-game'));
['#create-name','#join-code','#join-name'].forEach(s => { $(s).addEventListener('keydown', e => { if (e.key==='Enter') { s==='#create-name' ? $('#btn-create').click() : $('#btn-join').click(); } }); });
$('#timer-select').addEventListener('change', e => socket.emit('set-timer', { duration: parseInt(e.target.value) }));

socket.on('room-created', ({ code, playerIndex }) => {
  state.roomCode = code; state.playerIndex = playerIndex;
  $('#lobby-create').classList.add('hidden'); $('#lobby-room').classList.remove('hidden');
  $('#room-code').textContent = code;
  $('#btn-start').classList.remove('hidden'); $('#timer-setting').classList.remove('hidden');
  $('#lobby-info').textContent = 'Waiting for players (3-7)...';
});
socket.on('room-joined', ({ code, playerIndex }) => {
  state.roomCode = code; state.playerIndex = playerIndex;
  $('#lobby-create').classList.add('hidden'); $('#lobby-room').classList.remove('hidden');
  $('#room-code').textContent = code;
  if (playerIndex === 0) { $('#btn-start').classList.remove('hidden'); $('#timer-setting').classList.remove('hidden'); }
});
socket.on('lobby-update', ({ players }) => {
  $('#player-list').innerHTML = players.map((p, i) =>
    `<div class="player-item"><span class="dot" style="background:${p.connected?'#4caf50':'#757575'}"></span><span>${p.name}</span>${i===0?'<span class="host-badge">Host</span>':''}</div>`
  ).join('');
  if (state.playerIndex === 0) $('#btn-start').disabled = players.length < 3;
});
socket.on('error-msg', ({ message }) => { $('#lobby-error').textContent = message; showToast(message, 'error'); setTimeout(() => $('#lobby-error').textContent = '', 4000); });
socket.on('back-to-lobby', () => {
  state.mode = 'lobby'; state.tackSelection = []; state.switchSelection = []; state.gameState = null; state.lastMove = '';
  clearTimer();
  $('#game').classList.add('hidden'); $('#lobby').classList.remove('hidden');
  $('#lobby-create').classList.add('hidden'); $('#lobby-room').classList.remove('hidden');
  ['#gameover-overlay','#gandalf-banner','#gandalf-overlay'].forEach(s => $(s).classList.add('hidden'));
});

// ============================================================
// GAME STATE
// ============================================================
socket.on('game-state', gs => scheduleRender(gs));

socket.on('initial-peek', ({ cards }) => {
  const overlay = $('#peek-overlay'), container = $('#peek-cards'), labels = $('#peek-labels');
  container.innerHTML = ''; labels.innerHTML = '';
  cards.sort((a,b) => a.index - b.index);
  cards.forEach(c => {
    const el = document.createElement('div');
    el.className = 'card'; el.style.cssText = 'width:90px;height:126px;font-size:15px';
    el.innerHTML = cardFaceHTML(c.suit, c.rank);
    container.appendChild(el);
  });
  labels.innerHTML = '<span class="peek-pos-label">Left Edge</span><span class="peek-pos-label">Right Edge</span>';
  overlay.classList.remove('hidden');
  $('#btn-peek-done').addEventListener('click', () => overlay.classList.add('hidden'), { once: true });
});

socket.on('card-knowledge', ({ cardId, suit, rank }) => showPeekPopup(suit, rank));
socket.on('card-replaced', () => {});
socket.on('cards-switched', ({ p1, c1, p2, c2 }) => {
  // Animate the swap
  renderDelay = 600;
  const r1 = cardRect(p1, c1), r2 = cardRect(p2, c2);
  if (r1 && r2) {
    const f1 = createFlyer(r1, cardBackInner(), 'card-back card-sm');
    const f2 = createFlyer(r2, cardBackInner(), 'card-back card-sm');
    flyTo(f1, r2, 500);
    flyTo(f2, r1, 500);
  }
});

socket.on('peek-animation', ({ playerIndex, cardIndex, peekerIndex }) => {
  renderDelay = 900;
  setTimeout(() => {
    const allCards = $$('.card[data-player-index][data-card-index]');
    allCards.forEach(el => {
      if (parseInt(el.dataset.playerIndex) === playerIndex && parseInt(el.dataset.cardIndex) === cardIndex) {
        el.classList.add('peek-lift');
        setTimeout(() => el.classList.remove('peek-lift'), 850);
      }
    });
  }, 50);
  if (peekerIndex !== state.playerIndex) {
    const gs = state.gameState;
    const pn = gs ? gs.players[peekerIndex].name : 'Someone';
    const tn = gs ? gs.players[playerIndex].name : 'someone';
    showToast(`${pn} peeked at ${tn}'s card #${cardIndex + 1}`, 'info');
  }
});

socket.on('draw-animation', ({ playerIndex }) => {
  renderDelay = 500;
  const deckR = getRect('#deck');
  if (deckR) {
    const f = createFlyer(deckR, cardBackInner(), 'card-back');
    const dest = playerIndex === state.playerIndex
      ? getRect('#drawn-card-area') || { left: deckR.left + 100, top: deckR.top, width: 72, height: 100 }
      : deckR;
    flyTo(f, { left: dest.left, top: dest.top - 30, width: 72, height: 100 }, 400);
  }
});

socket.on('discard-animation', ({ playerIndex, card }) => {
  renderDelay = 500;
  const discR = getRect('#discard-pile');
  const drawnR = getRect('#drawn-card-area');
  const from = drawnR || getRect('#deck');
  if (from && discR) {
    const f = createFlyer(from, cardFaceHTML(card.suit, card.rank));
    flyTo(f, discR, 400);
  }
});

socket.on('tack-reveal', ({ card1, card2, tackerIndex }) => {
  renderDelay = 1200;
  const gs = state.gameState;
  const name = gs ? gs.players[tackerIndex].name : 'Someone';

  // Flash both cards
  setTimeout(() => {
    [card1, card2].forEach(c => {
      const r = cardRect(c.playerIndex, c.cardIndex);
      if (r) {
        const fc = createFlipCard(r, cardFaceHTML(c.suit, c.rank));
        setTimeout(() => fc.flip(true), 100);
        setTimeout(() => {
          if (card1.rank === card2.rank) {
            const disc = getRect('#discard-pile');
            if (disc) fc.moveTo(disc, 400).then(() => fc.remove());
            else fc.remove();
          } else {
            fc.flip(false);
            setTimeout(() => fc.remove(), 400);
          }
        }, 800);
      }
    });
  }, 50);

  if (card1.rank === card2.rank) showToast(`TACK! ${name} matched ${card1.rank}s!`, 'success');
  else showToast(`TACK failed! ${card1.rank} vs ${card2.rank}`, 'error');
});

socket.on('tack-glow', ({ playerIndex, cardIndex }) => {
  setTimeout(() => {
    $$('.card[data-player-index][data-card-index]').forEach(el => {
      if (+el.dataset.playerIndex === playerIndex && +el.dataset.cardIndex === cardIndex) {
        el.classList.add('glow-gold');
      }
    });
  }, 30);
});

socket.on('tack-unglow', ({ playerIndex, cardIndex }) => {
  $$('.card[data-player-index][data-card-index]').forEach(el => {
    if (+el.dataset.playerIndex === playerIndex && +el.dataset.cardIndex === cardIndex) {
      el.classList.remove('glow-gold');
    }
  });
});

socket.on('gandalf-called', ({ callerIndex, callerName }) => {
  $('#gandalf-caller-text').textContent = `${callerName} called Gandalf!`;
  $('#gandalf-overlay').classList.remove('hidden');
  setTimeout(() => $('#gandalf-overlay').classList.add('hidden'), 3500);
  $('#gandalf-banner-text').textContent = `FINAL ROUND \u2014 ${callerName} called Gandalf`;
  $('#gandalf-banner').classList.remove('hidden');
});

socket.on('notification', ({ message, type }) => {
  state.lastMove = message;
  showToast(message, type);
  renderLastMove();
});

socket.on('game-over', ({ scores }) => {
  const gs = state.gameState;
  $('#scoreboard').innerHTML = scores.map((s, i) => {
    let cls = 'score-row'; if (i===0) cls += ' winner'; if (gs && s.index === gs.gandalfCallerIndex) cls += ' gandalf-caller';
    return `<div class="${cls}"><span class="rank-num">#${i+1}</span><span class="name">${s.name}</span><span class="score">${s.score} pts</span></div>`;
  }).join('');
  if (state.playerIndex === 0) $('#btn-play-again').classList.remove('hidden');
  $('#gameover-overlay').classList.remove('hidden');
  $('#gandalf-banner').classList.add('hidden');
});
$('#btn-play-again').addEventListener('click', () => socket.emit('play-again'));

// ============================================================
// RENDER
// ============================================================
function renderLastMove() {
  const el = $('#last-move');
  if (el) el.textContent = state.lastMove || '';
}

function renderGame() {
  const gs = state.gameState; if (!gs) return;
  const my = gs.yourIndex, isMe = gs.currentPlayerIndex === my && gs.phase === 'playing';

  // Header
  $('#room-info').textContent = `GANDALF \u2022 ${state.roomCode}`;
  const curName = gs.players[gs.currentPlayerIndex]?.name || '';
  if (gs.phase === 'ended') $('#turn-info').textContent = 'Game Over';
  else if (gs.gandalfCallerIndex !== null) $('#turn-info').innerHTML = `<span class="gandalf-text">FINAL ROUND</span> \u2022 ${curName}'s turn`;
  else $('#turn-info').textContent = isMe ? 'Your turn!' : `${curName}'s turn`;

  renderOpponents(gs, my);
  $('#deck-count').textContent = gs.deckCount;
  $('#discard-count').textContent = gs.discardCount || 0;
  renderDiscard(gs);
  renderYourCards(gs, my, isMe);
  renderDrawnCard(gs, isMe);
  renderActions(gs, my, isMe);
  renderLastMove();

  if (gs.turnDeadline && gs.turnDeadline > Date.now() && !state.timerInterval) startTimer(gs.turnDeadline);
  else if (!gs.turnDeadline) clearTimer();
}

function renderOpponents(gs, my) {
  const c = $('#opponents'); c.innerHTML = '';
  const n = gs.players.length;
  for (let off = 1; off < n; off++) {
    const pi = (my + off) % n, p = gs.players[pi];
    const div = document.createElement('div');
    div.className = 'opponent';
    if (pi === gs.gandalfCallerIndex) div.classList.add('gandalf-caller');

    const lbl = document.createElement('div');
    lbl.className = 'player-label opp-label';
    if (pi === gs.currentPlayerIndex && gs.phase === 'playing') lbl.classList.add('current-turn');
    lbl.textContent = p.name;
    // Show "viewing" indicator when they've drawn
    if (pi === gs.currentPlayerIndex && gs.turnPhase === 'drawn') {
      lbl.innerHTML += ' <span class="viewing-badge">viewing card</span>';
    }
    div.appendChild(lbl);

    const cd = document.createElement('div'); cd.className = 'opponent-cards';
    p.cards.forEach((card, ci) => {
      const el = makeCardEl(card, true);
      el.dataset.playerIndex = pi; el.dataset.cardIndex = ci;
      if (isCardSelectable(gs, pi, ci, false)) {
        el.classList.add('selectable');
        el.addEventListener('click', () => onCardClick(pi, ci));
      }
      cd.appendChild(el);
    });
    div.appendChild(cd);
    c.appendChild(div);
  }
}

function renderDiscard(gs) {
  const pile = $('#discard-pile');
  pile.innerHTML = gs.topDiscard ? `<div class="card" style="position:absolute;font-size:10px">${cardFaceHTML(gs.topDiscard.suit, gs.topDiscard.rank)}</div>` : '';
}

function renderYourCards(gs, my, isMe) {
  const c = $('#your-cards'), p = gs.players[my]; c.innerHTML = '';
  const lbl = $('#your-label');
  lbl.textContent = p.name + (my === gs.gandalfCallerIndex ? ' (GANDALF)' : '');
  lbl.className = 'player-label you-label';
  if (isMe) lbl.classList.add('current-turn');

  p.cards.forEach((card, ci) => {
    const el = makeCardEl(card, false);
    el.dataset.playerIndex = my; el.dataset.cardIndex = ci;
    if (isCardSelectable(gs, my, ci, true)) {
      el.classList.add('selectable');
      el.addEventListener('click', () => onCardClick(my, ci));
    }
    c.appendChild(el);
  });
}

function isCardSelectable(gs, pi, ci, own) {
  const my = gs.yourIndex, isMe = gs.currentPlayerIndex === my && gs.phase === 'playing';
  if (!isMe) return false;
  if (gs.turnPhase === 'drawn' && gs.drawnCard && own) return true;
  if (gs.turnPhase === 'special-peek-self' && own) return true;
  if (gs.turnPhase === 'special-peek-other' && !own) return true;
  if (gs.turnPhase === 'special-switch') return true;
  return false;
}

function onCardClick(pi, ci) {
  const gs = state.gameState; if (!gs) return;
  const my = gs.yourIndex;

  // Tack mode handled by startTackMode handlers
  // Replace
  if (gs.turnPhase === 'drawn' && gs.drawnCard && pi === my) { socket.emit('replace-card', { cardIndex: ci }); return; }
  // Peek self
  if (gs.turnPhase === 'special-peek-self' && pi === my) { socket.emit('peek-card', { playerIndex: pi, cardIndex: ci }); return; }
  // Peek other
  if (gs.turnPhase === 'special-peek-other' && pi !== my) { socket.emit('peek-card', { playerIndex: pi, cardIndex: ci }); return; }
  // Switch
  if (gs.turnPhase === 'special-switch') {
    state.switchSelection.push({ playerIndex: pi, cardIndex: ci });
    // Highlight
    $$(`[data-player-index="${pi}"][data-card-index="${ci}"]`).forEach(e => e.classList.add('glow-gold'));
    if (state.switchSelection.length === 2) {
      const s = state.switchSelection;
      socket.emit('switch-cards', { p1:s[0].playerIndex, c1:s[0].cardIndex, p2:s[1].playerIndex, c2:s[1].cardIndex });
      state.switchSelection = [];
      $('#switch-overlay').classList.add('hidden');
      $$('.glow-gold').forEach(e => e.classList.remove('glow-gold'));
    }
    return;
  }
}

function renderDrawnCard(gs, isMe) {
  const area = $('#drawn-card-area');
  if (!isMe || !gs.drawnCard || gs.turnPhase !== 'drawn') { area.classList.add('hidden'); return; }
  area.classList.remove('hidden');
  const card = gs.drawnCard;
  $('#drawn-card-display').innerHTML = `<div class="card drawn-lg" style="font-size:15px">${cardFaceHTML(card.suit, card.rank)}</div><div class="drawn-sub">You drew this card</div>`;

  let btns = `<button class="btn btn-outline btn-sm" onclick="doDiscard()">Discard</button>`;
  btns += `<button class="btn btn-gold btn-sm" onclick="doReplace()">Replace</button>`;
  if (['7','8'].includes(card.rank)) btns += `<button class="btn btn-ability btn-sm" onclick="doPeekSelf()">See Own Card</button>`;
  if (['9','10'].includes(card.rank)) btns += `<button class="btn btn-ability btn-sm" onclick="doPeekOther()">See Opponent Card</button>`;
  if (card.rank === 'J') btns += `<button class="btn btn-ability btn-sm" onclick="doSwitch()">Switch Cards</button>`;
  if (card.rank === 'Q') btns += `<button class="btn btn-ability btn-sm" onclick="doSkipNext()">Skip Next Player</button>`;
  if (card.rank === 'K') btns += `<button class="btn btn-ability btn-sm" onclick="doDrawAgain()">Draw Again</button>`;
  $('#drawn-actions').innerHTML = btns;
}

function renderActions(gs, my, isMe) {
  const btns = $('#action-buttons'), msg = $('#action-message');
  btns.innerHTML = ''; msg.textContent = '';
  if (gs.phase === 'ended') { msg.textContent = 'Game over!'; return; }
  if (!isMe) { msg.textContent = `Waiting for ${gs.players[gs.currentPlayerIndex]?.name}...`; return; }

  if (gs.turnPhase === 'choose-action') {
    btns.innerHTML = `
      <button class="btn btn-gold" id="btn-draw">Draw</button>
      <button class="btn btn-outline" id="btn-tack">Tack</button>
      <button class="btn btn-gandalf-btn btn-sm" id="btn-gandalf" ${gs.gandalfCallerIndex !== null ? 'disabled style="opacity:.4"' : ''}>Gandalf</button>`;
    $('#btn-draw').addEventListener('click', () => socket.emit('draw-card'));
    $('#btn-tack').addEventListener('click', () => { state.tackSelection = []; $('#tack-overlay').classList.remove('hidden'); startTackMode(); });
    if (gs.gandalfCallerIndex === null) {
      $('#btn-gandalf').addEventListener('click', () => { if (confirm('Call GANDALF? Everyone gets one more turn!')) socket.emit('call-gandalf'); });
    }
    msg.textContent = 'Your turn!';
  } else if (gs.turnPhase === 'drawn') {
    msg.textContent = 'Choose what to do with the drawn card.';
  } else if (gs.turnPhase === 'special-peek-self') {
    msg.textContent = 'Click one of YOUR cards to peek.';
  } else if (gs.turnPhase === 'special-peek-other') {
    msg.textContent = "Click an OPPONENT's card to peek.";
  } else if (gs.turnPhase === 'special-switch') {
    msg.textContent = `Select two cards to switch. (${state.switchSelection.length}/2)`;
    $('#switch-overlay').classList.remove('hidden');
  }
}

// ============================================================
// TACK MODE — toggle select
// ============================================================
function startTackMode() {
  state.tackSelection = [];
  $$('.glow-gold').forEach(e => e.classList.remove('glow-gold'));
  const allCards = $$('#opponents .card, #your-cards .card');
  allCards.forEach(el => {
    el.classList.add('tack-selectable');
    const pi = +el.dataset.playerIndex, ci = +el.dataset.cardIndex;
    el._tackHandler = () => tackToggle(pi, ci, el);
    el.addEventListener('click', el._tackHandler);
  });
}

function tackToggle(pi, ci, el) {
  const idx = state.tackSelection.findIndex(s => s.playerIndex === pi && s.cardIndex === ci);
  if (idx >= 0) {
    // Deselect
    state.tackSelection.splice(idx, 1);
    el.classList.remove('glow-gold');
    socket.emit('tack-deselect', { playerIndex: pi, cardIndex: ci });
  } else if (state.tackSelection.length < 2) {
    // Select
    state.tackSelection.push({ playerIndex: pi, cardIndex: ci });
    el.classList.add('glow-gold');
    socket.emit('tack-select', { playerIndex: pi, cardIndex: ci });
    if (state.tackSelection.length === 2) {
      setTimeout(() => {
        const s = state.tackSelection;
        socket.emit('tack', { p1:s[0].playerIndex, c1:s[0].cardIndex, p2:s[1].playerIndex, c2:s[1].cardIndex });
        endTackMode();
      }, 500);
    }
  }
}

function endTackMode() {
  state.tackSelection = [];
  $('#tack-overlay').classList.add('hidden');
  $$('.tack-selectable').forEach(el => {
    el.classList.remove('tack-selectable', 'glow-gold');
    if (el._tackHandler) { el.removeEventListener('click', el._tackHandler); el._tackHandler = null; }
  });
}

$('#btn-cancel-tack').addEventListener('click', () => { endTackMode(); renderGame(); });

// ============================================================
// DECK CLICK + TOUCH
// ============================================================
function handleDeckTap() {
  const gs = state.gameState; if (!gs) return;
  if (gs.currentPlayerIndex !== gs.yourIndex) return;
  if (gs.turnPhase !== 'choose-action') return;
  if (gs.phase !== 'playing') return;
  socket.emit('draw-card');
}
$('#deck').addEventListener('click', handleDeckTap);
$('#deck').addEventListener('touchend', e => { e.preventDefault(); handleDeckTap(); });

// ============================================================
// GLOBAL ACTIONS
// ============================================================
window.doDiscard = () => socket.emit('discard-drawn');
window.doReplace = () => { $('#action-message').textContent = 'Click one of your cards to replace.'; };
window.doPeekSelf = () => socket.emit('use-peek-self');
window.doPeekOther = () => socket.emit('use-peek-other');
window.doSwitch = () => { state.switchSelection = []; socket.emit('use-switch'); };
window.doSkipNext = () => socket.emit('use-skip-next');
window.doDrawAgain = () => socket.emit('use-draw-again');
