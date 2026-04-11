const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

// --- Utility Functions ---

function createDeck() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  let id = 1;
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ id: id++, suit, rank });
    }
  }
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardValue(card) {
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  if (card.rank === 'A') return 1;
  return parseInt(card.rank);
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function drawFromDeck(room) {
  if (room.deck.length === 0) {
    if (room.discardPile.length <= 1) return null;
    const top = room.discardPile.pop();
    room.deck = shuffle(room.discardPile);
    room.discardPile = top ? [top] : [];
    io.to(room.code).emit('notification', { message: 'Deck reshuffled from discard pile!', type: 'info' });
  }
  return room.deck.length > 0 ? room.deck.pop() : null;
}

function getTopDiscard(room) {
  return room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null;
}

function playerView(room, viewerIdx) {
  const viewer = room.players[viewerIdx];
  const players = room.players.map((p, pi) => ({
    name: p.name,
    isHost: pi === 0,
    cards: p.cards.map(c => ({
      id: c.id,
      faceUp: c.faceUp || false,
      suit: c.faceUp ? c.suit : undefined,
      rank: c.faceUp ? c.rank : undefined,
    })),
    cardCount: p.cards.length,
    connected: p.connected,
  }));

  return {
    players,
    topDiscard: getTopDiscard(room),
    deckCount: room.deck.length,
    discardCount: room.discardPile.length,
    currentPlayerIndex: room.currentPlayerIndex,
    phase: room.phase,
    turnPhase: room.turnPhase,
    gandalfCallerIndex: room.gandalfCallerIndex,
    yourIndex: viewerIdx,
    drawnCard: (viewerIdx === room.currentPlayerIndex && room.drawnCard) ? room.drawnCard : null,
    drawnCardRank: (viewerIdx === room.currentPlayerIndex && room.drawnCard) ? room.drawnCard.rank : null,
    message: room.message || '',
    timerDuration: room.timerDuration,
    turnDeadline: room.turnDeadline,
  };
}

function broadcastState(room) {
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.socketId) {
      io.to(p.socketId).emit('game-state', playerView(room, i));
    }
  }
}

function getNextPlayerIndex(room, from) {
  const n = room.players.length;
  let next = (from + 1) % n;
  // Skip players with 0 cards
  let attempts = 0;
  while (room.players[next].cards.length === 0 && attempts < n) {
    next = (next + 1) % n;
    attempts++;
  }
  return next;
}

function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnDeadline = null;
}

function startTurnTimer(room) {
  clearTurnTimer(room);
  if (room.timerDuration <= 0) return;

  room.turnDeadline = Date.now() + room.timerDuration * 1000;
  io.to(room.code).emit('turn-timer', { deadline: room.turnDeadline, duration: room.timerDuration });

  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    room.turnDeadline = null;
    if (room.phase !== 'playing') return;

    const timedOutName = room.players[room.currentPlayerIndex].name;
    io.to(room.code).emit('notification', { message: `${timedOutName} ran out of time!`, type: 'warning' });

    // If they had a drawn card, discard it
    if (room.drawnCard) {
      room.drawnCard.faceUp = true;
      room.discardPile.push(room.drawnCard);
      room.drawnCard = null;
    }

    advanceTurn(room, false);
  }, room.timerDuration * 1000);
}

function advanceTurn(room, skip = false) {
  clearTurnTimer(room);

  let next = getNextPlayerIndex(room, room.currentPlayerIndex);
  if (skip) {
    const skippedName = room.players[next].name;
    next = getNextPlayerIndex(room, next);
    room.message = `${skippedName}'s turn was skipped!`;
    io.to(room.code).emit('notification', { message: room.message, type: 'warning' });
  }

  room.currentPlayerIndex = next;
  room.drawnCard = null;
  room.turnPhase = 'choose-action';
  room.skipNext = false;

  // Check if gandalf round is over
  if (room.gandalfCallerIndex !== null && room.currentPlayerIndex === room.gandalfCallerIndex) {
    endGame(room);
    return;
  }

  // Check if any player has 0 cards
  if (room.players.some(p => p.cards.length === 0)) {
    endGame(room);
    return;
  }

  room.message = `${room.players[next].name}'s turn`;
  broadcastState(room);
  startTurnTimer(room);
}

function endGame(room) {
  clearTurnTimer(room);
  room.phase = 'ended';
  room.turnPhase = null;
  // Reveal all cards
  for (const p of room.players) {
    for (const c of p.cards) c.faceUp = true;
  }
  // Calculate scores
  const scores = room.players.map((p, i) => ({
    name: p.name,
    index: i,
    score: p.cards.reduce((sum, c) => sum + cardValue(c), 0),
    cardCount: p.cards.length,
  }));
  scores.sort((a, b) => a.score - b.score);
  room.scores = scores;
  room.message = 'Game over!';
  broadcastState(room);
  io.to(room.code).emit('game-over', { scores });
}

// --- Socket Handlers ---

io.on('connection', (socket) => {

  socket.on('create-room', ({ playerName }) => {
    let code = generateCode();
    while (rooms.has(code)) code = generateCode();
    const room = {
      code,
      players: [{ id: socket.id, name: playerName, socketId: socket.id, cards: [], connected: true }],
      deck: [],
      discardPile: [],
      currentPlayerIndex: 0,
      phase: 'waiting',
      turnPhase: null,
      gandalfCallerIndex: null,
      drawnCard: null,
      skipNext: false,
      message: '',
      scores: null,
      timerDuration: 0,
      turnTimer: null,
      turnDeadline: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;
    socket.playerIndex = 0;
    socket.emit('room-created', { code, playerIndex: 0 });
    io.to(code).emit('lobby-update', { players: room.players.map(p => ({ name: p.name, connected: p.connected })) });
  });

  socket.on('join-room', ({ code, playerName }) => {
    const room = rooms.get(code);
    if (!room) return socket.emit('error-msg', { message: 'Room not found' });
    if (room.phase !== 'waiting') return socket.emit('error-msg', { message: 'Game already started' });
    if (room.players.length >= 7) return socket.emit('error-msg', { message: 'Room is full (max 7)' });
    if (room.players.some(p => p.name === playerName)) return socket.emit('error-msg', { message: 'Name already taken' });

    const idx = room.players.length;
    room.players.push({ id: socket.id, name: playerName, socketId: socket.id, cards: [], connected: true });
    socket.join(code);
    socket.roomCode = code;
    socket.playerIndex = idx;
    socket.emit('room-joined', { code, playerIndex: idx });
    io.to(code).emit('lobby-update', { players: room.players.map(p => ({ name: p.name, connected: p.connected })) });
  });

  socket.on('set-timer', ({ duration }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    if (socket.playerIndex !== 0) return socket.emit('error-msg', { message: 'Only host can set timer' });
    if (![0, 15, 30, 45, 60].includes(duration)) return;
    room.timerDuration = duration;
    io.to(room.code).emit('timer-setting', { duration });
  });

  socket.on('start-game', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    if (socket.playerIndex !== 0) return socket.emit('error-msg', { message: 'Only host can start' });
    if (room.players.length < 3) return socket.emit('error-msg', { message: 'Need at least 3 players' });

    room.deck = createDeck();
    room.discardPile = [];
    room.phase = 'playing';
    room.currentPlayerIndex = 0;
    room.turnPhase = 'choose-action';
    room.gandalfCallerIndex = null;
    room.drawnCard = null;

    // Deal 4 cards to each player
    for (const p of room.players) {
      p.cards = [];
      for (let i = 0; i < 4; i++) {
        const card = room.deck.pop();
        card.faceUp = false;
        p.cards.push(card);
      }
    }

    // Send initial peek (edge cards: index 0 and 3) to each player
    for (let i = 0; i < room.players.length; i++) {
      const p = room.players[i];
      const peekCards = [];
      if (p.cards[0]) peekCards.push({ index: 0, id: p.cards[0].id, suit: p.cards[0].suit, rank: p.cards[0].rank });
      if (p.cards[3]) peekCards.push({ index: 3, id: p.cards[3].id, suit: p.cards[3].suit, rank: p.cards[3].rank });
      io.to(p.socketId).emit('initial-peek', { cards: peekCards });
    }

    room.message = `${room.players[0].name}'s turn`;
    broadcastState(room);
    // Start timer after a delay to let players memorize initial cards
    if (room.timerDuration > 0) {
      setTimeout(() => {
        if (room.phase === 'playing' && room.currentPlayerIndex === 0) {
          startTurnTimer(room);
        }
      }, 8000);
    }
  });

  socket.on('draw-card', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;
    if (room.turnPhase !== 'choose-action') return;

    const card = drawFromDeck(room);
    if (!card) return socket.emit('error-msg', { message: 'No cards available!' });

    room.drawnCard = card;
    room.turnPhase = 'drawn';
    room.message = `${room.players[socket.playerIndex].name} drew a card`;
    io.to(room.code).emit('draw-animation', { playerIndex: socket.playerIndex });
    broadcastState(room);
  });

  socket.on('replace-card', ({ cardIndex }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;
    if (room.turnPhase !== 'drawn' || !room.drawnCard) return;

    const player = room.players[socket.playerIndex];
    if (cardIndex < 0 || cardIndex >= player.cards.length) return;

    const oldCard = player.cards[cardIndex];
    oldCard.faceUp = true;
    room.discardPile.push(oldCard);

    const newCard = { ...room.drawnCard, faceUp: false };
    player.cards[cardIndex] = newCard;

    // Notify everyone about the replacement
    io.to(room.code).emit('card-replaced', {
      playerIndex: socket.playerIndex,
      cardIndex,
      discardedCard: { suit: oldCard.suit, rank: oldCard.rank },
      newCardId: newCard.id,
    });

    // Privately tell the player what their new card is (they placed it, so they know)
    socket.emit('card-knowledge', { cardId: newCard.id, suit: newCard.suit, rank: newCard.rank });

    room.drawnCard = null;
    room.message = `${player.name} replaced a card`;
    advanceTurn(room, false);
  });

  socket.on('discard-drawn', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;
    if (room.turnPhase !== 'drawn' || !room.drawnCard) return;

    const card = room.drawnCard;
    card.faceUp = true;
    room.discardPile.push(card);

    io.to(room.code).emit('discard-animation', {
      playerIndex: socket.playerIndex,
      card: { suit: card.suit, rank: card.rank },
    });

    io.to(room.code).emit('notification', {
      message: `${room.players[socket.playerIndex].name} discarded ${card.rank} of ${card.suit}`,
      type: 'info',
    });

    room.drawnCard = null;
    advanceTurn(room, false);
  });

  socket.on('use-peek-self', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;
    if (room.turnPhase !== 'drawn' || !room.drawnCard) return;
    if (!['7', '8'].includes(room.drawnCard.rank)) return;

    room.turnPhase = 'special-peek-self';
    room.message = `${room.players[socket.playerIndex].name} is peeking at their own card...`;
    broadcastState(room);
  });

  socket.on('use-peek-other', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;
    if (room.turnPhase !== 'drawn' || !room.drawnCard) return;
    if (!['9', '10'].includes(room.drawnCard.rank)) return;

    room.turnPhase = 'special-peek-other';
    room.message = `${room.players[socket.playerIndex].name} is peeking at someone's card...`;
    broadcastState(room);
  });

  socket.on('use-switch', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;
    if (room.turnPhase !== 'drawn' || !room.drawnCard) return;
    if (room.drawnCard.rank !== 'J') return;

    room.turnPhase = 'special-switch';
    room.message = `${room.players[socket.playerIndex].name} is switching two cards...`;
    broadcastState(room);
  });

  socket.on('peek-card', ({ playerIndex, cardIndex }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;

    const target = room.players[playerIndex];
    if (!target || cardIndex < 0 || cardIndex >= target.cards.length) return;

    const card = target.cards[cardIndex];

    if (room.turnPhase === 'special-peek-self') {
      if (playerIndex !== socket.playerIndex) return socket.emit('error-msg', { message: 'You must peek at your own card!' });
    } else if (room.turnPhase === 'special-peek-other') {
      if (playerIndex === socket.playerIndex) return socket.emit('error-msg', { message: 'You must peek at an opponent\'s card!' });
    } else {
      return;
    }

    // Send card info privately to the peeking player
    socket.emit('card-knowledge', { cardId: card.id, suit: card.suit, rank: card.rank });

    // Tell everyone which card position was peeked (but not the value)
    io.to(room.code).emit('peek-animation', { playerIndex, cardIndex, peekerIndex: socket.playerIndex });

    // Discard the drawn card
    const drawnCard = room.drawnCard;
    drawnCard.faceUp = true;
    room.discardPile.push(drawnCard);

    io.to(room.code).emit('notification', {
      message: `${room.players[socket.playerIndex].name} peeked and discarded ${drawnCard.rank} of ${drawnCard.suit}`,
      type: 'info',
    });

    room.drawnCard = null;
    advanceTurn(room, false);
  });

  socket.on('switch-cards', ({ p1, c1, p2, c2 }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;
    if (room.turnPhase !== 'special-switch') return;

    const player1 = room.players[p1];
    const player2 = room.players[p2];
    if (!player1 || !player2) return;
    if (c1 < 0 || c1 >= player1.cards.length) return;
    if (c2 < 0 || c2 >= player2.cards.length) return;
    if (p1 === p2 && c1 === c2) return;

    // Swap the cards
    const temp = player1.cards[c1];
    player1.cards[c1] = player2.cards[c2];
    player2.cards[c2] = temp;

    io.to(room.code).emit('cards-switched', { p1, c1, p2, c2, switcherIndex: socket.playerIndex });
    io.to(room.code).emit('notification', {
      message: `${room.players[socket.playerIndex].name} switched two cards!`,
      type: 'info',
    });

    // Discard the drawn card (J)
    const drawnCard = room.drawnCard;
    drawnCard.faceUp = true;
    room.discardPile.push(drawnCard);

    room.drawnCard = null;
    advanceTurn(room, false);
  });

  socket.on('tack', ({ p1, c1, p2, c2 }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;
    if (room.turnPhase !== 'choose-action') return;

    const player1 = room.players[p1];
    const player2 = room.players[p2];
    if (!player1 || !player2) return;
    if (c1 < 0 || c1 >= player1.cards.length) return;
    if (c2 < 0 || c2 >= player2.cards.length) return;
    if (p1 === p2 && c1 === c2) return;

    const card1 = player1.cards[c1];
    const card2 = player2.cards[c2];
    const tackerIdx = socket.playerIndex;

    // Reveal both cards to everyone
    io.to(room.code).emit('tack-reveal', {
      card1: { playerIndex: p1, cardIndex: c1, suit: card1.suit, rank: card1.rank, id: card1.id },
      card2: { playerIndex: p2, cardIndex: c2, suit: card2.suit, rank: card2.rank, id: card2.id },
      tackerIndex: tackerIdx,
    });

    if (card1.rank === card2.rank) {
      // TACK SUCCESS
      io.to(room.code).emit('notification', {
        message: `TACK! ${room.players[tackerIdx].name} matched two ${card1.rank}s!`,
        type: 'success',
      });

      // Remove both cards and add to discard
      card1.faceUp = true;
      card2.faceUp = true;
      room.discardPile.push(card1, card2);

      // Determine ownership and handle replacements
      const tackerOwnsC1 = (p1 === tackerIdx);
      const tackerOwnsC2 = (p2 === tackerIdx);

      if (tackerOwnsC1 && tackerOwnsC2) {
        // Both tacker's cards: remove both, deal 1 new
        // Remove in reverse index order if same player
        const indices = [c1, c2].sort((a, b) => b - a);
        indices.forEach(i => player1.cards.splice(i, 1));
        const newCard = drawFromDeck(room);
        if (newCard) {
          newCard.faceUp = false;
          room.players[tackerIdx].cards.push(newCard);
        }
      } else if (!tackerOwnsC1 && !tackerOwnsC2 && p1 === p2) {
        // Both belong to same opponent
        const indices = [c1, c2].sort((a, b) => b - a);
        indices.forEach(i => player1.cards.splice(i, 1));
        for (let i = 0; i < 2; i++) {
          const nc = drawFromDeck(room);
          if (nc) { nc.faceUp = false; player1.cards.push(nc); }
        }
      } else if (!tackerOwnsC1 && !tackerOwnsC2) {
        // Cards belong to two different opponents
        player1.cards.splice(c1, 1);
        // Adjust c2 if same player (shouldn't happen here, but safety)
        player2.cards.splice(c2, 1);
        const nc1 = drawFromDeck(room);
        if (nc1) { nc1.faceUp = false; player1.cards.push(nc1); }
        const nc2 = drawFromDeck(room);
        if (nc2) { nc2.faceUp = false; player2.cards.push(nc2); }
      } else {
        // One tacker's, one opponent's
        const tackerPlayer = tackerOwnsC1 ? player1 : player2;
        const tackerCardIdx = tackerOwnsC1 ? c1 : c2;
        const opponentPlayer = tackerOwnsC1 ? player2 : player1;
        const opponentCardIdx = tackerOwnsC1 ? c2 : c1;

        tackerPlayer.cards.splice(tackerCardIdx, 1);
        opponentPlayer.cards.splice(opponentCardIdx, 1);
        // Opponent gets replacement, tacker doesn't
        const nc = drawFromDeck(room);
        if (nc) { nc.faceUp = false; opponentPlayer.cards.push(nc); }
      }
    } else {
      // TACK FAILED
      io.to(room.code).emit('notification', {
        message: `TACK failed! ${room.players[tackerIdx].name} gets a penalty card`,
        type: 'error',
      });
      const penaltyCard = drawFromDeck(room);
      if (penaltyCard) {
        penaltyCard.faceUp = false;
        room.players[tackerIdx].cards.push(penaltyCard);
      }
    }

    advanceTurn(room, false);
  });

  socket.on('use-skip-next', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;
    if (room.turnPhase !== 'drawn' || !room.drawnCard) return;
    if (room.drawnCard.rank !== 'Q') return;

    const card = room.drawnCard;
    card.faceUp = true;
    room.discardPile.push(card);

    io.to(room.code).emit('notification', {
      message: `${room.players[socket.playerIndex].name} used Q — next player is skipped!`,
      type: 'warning',
    });

    room.drawnCard = null;
    advanceTurn(room, true);
  });

  socket.on('use-draw-again', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;
    if (room.turnPhase !== 'drawn' || !room.drawnCard) return;
    if (room.drawnCard.rank !== 'K') return;

    const oldCard = room.drawnCard;
    oldCard.faceUp = true;
    room.discardPile.push(oldCard);

    io.to(room.code).emit('notification', {
      message: `${room.players[socket.playerIndex].name} used K — drawing again!`,
      type: 'info',
    });

    const newCard = drawFromDeck(room);
    if (!newCard) {
      room.drawnCard = null;
      advanceTurn(room, false);
      return;
    }

    room.drawnCard = newCard;
    room.turnPhase = 'drawn';
    room.message = `${room.players[socket.playerIndex].name} drew again`;
    if (room.timerDuration > 0) startTurnTimer(room);
    broadcastState(room);
  });

  socket.on('tack-select', ({ playerIndex, cardIndex }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;

    io.to(room.code).emit('tack-glow', {
      playerIndex,
      cardIndex,
      tackerIndex: socket.playerIndex,
    });
  });

  socket.on('tack-deselect', ({ playerIndex, cardIndex }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;

    io.to(room.code).emit('tack-unglow', { playerIndex, cardIndex });
  });

  socket.on('call-gandalf', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;
    if (room.currentPlayerIndex !== socket.playerIndex) return;
    if (room.turnPhase !== 'choose-action') return;
    if (room.gandalfCallerIndex !== null) return;

    room.gandalfCallerIndex = socket.playerIndex;
    room.message = `${room.players[socket.playerIndex].name} called GANDALF! Final round!`;

    io.to(room.code).emit('gandalf-called', {
      callerIndex: socket.playerIndex,
      callerName: room.players[socket.playerIndex].name,
    });

    io.to(room.code).emit('notification', {
      message: room.message,
      type: 'gandalf',
    });

    advanceTurn(room, false);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (player) {
      player.connected = false;
      io.to(room.code).emit('lobby-update', { players: room.players.map(p => ({ name: p.name, connected: p.connected })) });
      if (room.phase === 'playing') {
        io.to(room.code).emit('notification', { message: `${player.name} disconnected`, type: 'warning' });
      }
    }
    // Clean up empty rooms
    if (room.players.every(p => !p.connected)) {
      rooms.delete(socket.roomCode);
    }
  });

  socket.on('rejoin-room', ({ code, playerName }) => {
    const room = rooms.get(code);
    if (!room) return socket.emit('error-msg', { message: 'Room not found' });
    const idx = room.players.findIndex(p => p.name === playerName && !p.connected);
    if (idx === -1) return socket.emit('error-msg', { message: 'Cannot rejoin' });

    room.players[idx].socketId = socket.id;
    room.players[idx].connected = true;
    socket.join(code);
    socket.roomCode = code;
    socket.playerIndex = idx;
    socket.emit('room-joined', { code, playerIndex: idx });
    io.to(code).emit('lobby-update', { players: room.players.map(p => ({ name: p.name, connected: p.connected })) });
    if (room.phase === 'playing' || room.phase === 'ended') {
      broadcastState(room);
    }
  });

  socket.on('play-again', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    if (socket.playerIndex !== 0) return;
    room.phase = 'waiting';
    room.scores = null;
    room.gandalfCallerIndex = null;
    room.drawnCard = null;
    room.message = '';
    for (const p of room.players) p.cards = [];
    io.to(room.code).emit('back-to-lobby');
    io.to(room.code).emit('lobby-update', { players: room.players.map(p => ({ name: p.name, connected: p.connected })) });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Gandalf server running on http://localhost:${PORT}`);
});
