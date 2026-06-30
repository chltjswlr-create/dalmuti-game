
// ================================================================
//  ë¬ë¬´í° (The Great Dalmuti) â ìì±ë³¸
//  â Firebase Realtime Database ì¤ìê° ë©í°íë ì´
//  â ì¸ê¸ ìì¤í (ë¬ë¬´í°âìëíë¸ì 2ì¥, ì´ë¦¬âë¸ì 1ì¥)
//  â íëª ì ì¸ (ë¸ìê° ì¡°ì»¤ 2ì¥ ë³´ì  ì)
//  â ê³ê¸ë³ ìë¦¬ ì¬ë°°ì¹
//
//  ð¦ íìí í¨í¤ì§:
//     npm install firebase
//
//  ð¥ Firebase ì¤ì  ë°©ë²:
//     1. https://console.firebase.google.com ìì íë¡ì í¸ ìì±
//     2. Realtime Database íì±í (íì¤í¸ ëª¨ëë¡ ìì)
//     3. ìë FIREBASE_CONFIG ê°ì ë³¸ì¸ íë¡ì í¸ ê°ì¼ë¡ êµì²´
//
//  ð Firebase Security Rules (Realtime Database):
//  {
//    "rules": {
//      "rooms": {
//        "$roomCode": {
//          ".read": "auth != null",
//          "meta": { ".write": "auth != null" },
//          "players": {
//            "$uid": { ".write": "$uid === auth.uid" }
//          },
//          "game": { ".write": "auth != null" },
//          "hands": {
//            "$uid": {
//              ".read": "$uid === auth.uid",
//              ".write": "auth != null"
//            }
//          }
//        }
//      }
//    }
//  }
// ================================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
  push,
  serverTimestamp,
  remove,
  off,
} from "firebase/database";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "firebase/auth";

// ââ ð¥ Firebase ì¤ì  (ë³¸ì¸ íë¡ì í¸ ê°ì¼ë¡ êµì²´) ââââââââââââââ
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD_bm4Kq0DWxGmQJbIG4wsxFvweCUhH68w",
  authDomain: "dalmuti-game-8ac6b.firebaseapp.com",
  databaseURL: "https://dalmuti-game-8ac6b-default-rtdb.firebaseio.com",
  projectId: "dalmuti-game-8ac6b",
  storageBucket: "dalmuti-game-8ac6b.firebasestorage.app",
  messagingSenderId: "783129522690",
  appId: "1:783129522690:web:172aabc84ea9b1bc37ed1b",
};

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const db = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);

// ================================================================
//  1. ê²ì ì í¸ë¦¬í°
// ================================================================

function buildDeck() {
  const deck = [];
  for (let rank = 1; rank <= 12; rank++)
    for (let i = 0; i < rank; i++) deck.push({ rank, id: `${rank}-${i}` });
  deck.push({ rank: 0, id: "joker-0", joker: true });
  deck.push({ rank: 0, id: "joker-1", joker: true });
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealCards(playerIds) {
  const deck = shuffle(buildDeck());
  const hands = {};
  playerIds.forEach((id) => (hands[id] = []));
  deck.forEach((card, i) => hands[playerIds[i % playerIds.length]].push(card));
  Object.keys(hands).forEach((id) =>
    hands[id].sort((a, b) => a.rank - b.rank)
  );
  return hands;
}

function validatePlay(cards, pile) {
  if (!cards || cards.length === 0) return { ok: false, error: "ì¹´ëë¥¼ ì ííì¸ì" };
  const nonJoker = cards.filter((c) => !c.joker);
  if (nonJoker.length > 1 && new Set(nonJoker.map((c) => c.rank)).size > 1)
    return { ok: false, error: "ê°ì ì«ì ì¹´ëë§ ë¼ ì ìì´ì" };
  if (pile && pile.length > 0) {
    if (cards.length !== pile.length)
      return { ok: false, error: `ë°ë¥ê³¼ ê°ì ${pile.length}ì¥ì ë´ì¼ í´ì` };
    const myRank = nonJoker[0]?.rank;
    const pileRank = pile.find((c) => !c.joker)?.rank ?? pile[0]?.rank;
    if (myRank && pileRank && myRank >= pileRank)
      return { ok: false, error: "ë ë®ì(ê°í) ì«ìì¬ì¼ í´ì" };
  }
  return { ok: true };
}

// ê³ê¸ ë°°ì  (ìë£ ìì ê¸°ë°)
const RANK_KEYS = ["dalmuti", "prime", "peasant", "slave", "great_slave"];
function assignRanks(finishedOrder, totalPlayers) {
  const ranks = {};
  finishedOrder.forEach((id, i) => {
    if (i === 0) ranks[id] = "dalmuti";
    else if (i === 1 && totalPlayers >= 6) ranks[id] = "prime";
    else if (i === finishedOrder.length - 1) ranks[id] = "great_slave";
    else if (i === finishedOrder.length - 2 && totalPlayers >= 6) ranks[id] = "slave";
    else ranks[id] = "peasant";
  });
  return ranks;
}

// ì¸ê¸: ì´ë¤ ì¹´ëë¥¼ ë°ì³ì¼ íëì§ ê³ì°
function computeTax(hands, ranks) {
  // ìëí ë¸ì â ë¬ë¬´í°: ê°ì¥ ì¢ì ì¹´ë(rank ë®ì) 2ì¥
  // ë¸ì â ì´ë¦¬: ê°ì¥ ì¢ì ì¹´ë 1ì¥
  const greatSlaveId = Object.keys(ranks).find((id) => ranks[id] === "great_slave");
  const dalmutiId = Object.keys(ranks).find((id) => ranks[id] === "dalmuti");
  const slaveId = Object.keys(ranks).find((id) => ranks[id] === "slave");
  const primeId = Object.keys(ranks).find((id) => ranks[id] === "prime");

  const tributeCards = {}; // { fromId: { toId, cards } }

  if (greatSlaveId && dalmutiId) {
    const sorted = [...(hands[greatSlaveId] || [])].sort((a, b) => a.rank - b.rank);
    tributeCards[greatSlaveId] = { toId: dalmutiId, cards: sorted.slice(0, 2) };
  }
  if (slaveId && primeId) {
    const sorted = [...(hands[slaveId] || [])].sort((a, b) => a.rank - b.rank);
    tributeCards[slaveId] = { toId: primeId, cards: sorted.slice(0, 1) };
  }
  return tributeCards;
}

// ë¬ë¬´í°/ì´ë¦¬ê° ëë ¤ì¤ ìµìì ì¹´ë
function computeReturn(hands, ranks, tributeCount) {
  // tributeCount: { dalmutiId: 2, primeId: 1 }
  const result = {};
  Object.entries(tributeCount).forEach(([receiverId, count]) => {
    const sorted = [...(hands[receiverId] || [])].sort((a, b) => b.rank - a.rank); // ëì(ì½í) ì
    result[receiverId] = sorted.slice(0, count);
  });
  return result;
}

// ================================================================
//  2. ìì
// ================================================================

const RANK_LABEL = {
  dalmuti: "ð ë¬ë¬´í°",
  prime: "ð¤µ ì´ë¦¬",
  peasant: "ð¨ íë¯¼",
  slave: "ð ë¸ì",
  great_slave: "âï¸ ìëí ë¸ì",
};
const RANK_COLOR = {
  dalmuti: "from-yellow-400 to-amber-600",
  prime: "from-blue-400 to-blue-600",
  peasant: "from-green-500 to-green-700",
  slave: "from-orange-400 to-orange-600",
  great_slave: "from-red-500 to-red-700",
};
const RANK_BG = {
  dalmuti: "bg-yellow-500/20 border-yellow-500/40",
  prime: "bg-blue-500/20 border-blue-500/40",
  peasant: "bg-green-500/20 border-green-500/40",
  slave: "bg-orange-500/20 border-orange-500/40",
  great_slave: "bg-red-500/20 border-red-500/40",
};

function generateRoomCode() {
  return Math.random().toString(36).substr(2, 4).toUpperCase();
}

// ================================================================
//  3. UI ì»´í¬ëí¸
// ================================================================

// ââ ì¹´ë ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function Card({ card, selected, onClick, disabled, size = "md" }) {
  const isJoker = card.joker;
  const label = isJoker ? "ð" : card.rank;
  const color = isJoker
    ? "bg-gradient-to-br from-purple-500 to-pink-500 text-white"
    : card.rank <= 3
    ? "bg-gradient-to-br from-red-400 to-red-600 text-white"
    : card.rank <= 7
    ? "bg-gradient-to-br from-amber-300 to-amber-500 text-gray-900"
    : "bg-gradient-to-br from-slate-200 to-slate-400 text-gray-800";
  const sz = size === "sm" ? "w-10 h-14 text-base" : "w-14 h-20 text-xl";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative ${sz} rounded-xl shadow-lg border-2 flex flex-col items-center justify-center
        font-bold select-none transition-all duration-150 ${color}
        ${selected ? "border-white scale-110 -translate-y-3 shadow-2xl" : "border-transparent"}
        ${disabled ? "opacity-60 cursor-not-allowed" : "hover:-translate-y-1 hover:shadow-xl cursor-pointer"}`}
    >
      <span>{label}</span>
      {selected && (
        <span className="absolute -top-2 -right-2 bg-white text-blue-600 rounded-full w-5 h-5 text-xs flex items-center justify-center font-bold">â</span>
      )}
    </button>
  );
}

// ââ ë°ë¥ ì¹´ë âââââââââââââââââââââââââââââââââââââââââââââââââ
function Pile({ pile }) {
  if (!pile || pile.length === 0)
    return (
      <div className="flex items-center justify-center w-44 h-24 rounded-2xl border-2 border-dashed border-white/20 text-white/30 text-sm">
        ë°ë¥ ë¹ì´ìì
      </div>
    );
  return (
    <div className="flex items-center justify-center gap-1">
      {pile.map((card, i) => (
        <div key={card.id} style={{ marginLeft: i > 0 ? -24 : 0, zIndex: i }} className="relative">
          <Card card={card} disabled size="sm" />
        </div>
      ))}
      <div className="ml-2 text-white/70 text-sm font-semibold">
        {pile.length}ì¥ Â· {pile.find(c=>!c.joker)?.rank ?? "ì¡°ì»¤"}ë²
      </div>
    </div>
  );
}

// ââ ìë íë ì´ì´ í í° ââââââââââââââââââââââââââââââââââââââââ
function PlayerToken({ player, isCurrentTurn }) {
  return (
    <div className={`flex flex-col items-center gap-1 px-2 py-2 rounded-xl transition-all min-w-[64px]
      ${isCurrentTurn ? "bg-yellow-400/20 ring-2 ring-yellow-400 scale-105" : "bg-white/5"}`}>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white
        ${player.rank ? `bg-gradient-to-br ${RANK_COLOR[player.rank]}` : "bg-slate-600"}`}>
        {player.nickname[0]}
      </div>
      <span className="text-white text-[11px] font-medium truncate max-w-[56px]">{player.nickname}</span>
      <span className="text-white/40 text-[10px]">ð {player.cardCount}</span>
      {player.rank && <span className="text-[9px] text-yellow-300">{RANK_LABEL[player.rank]}</span>}
      {isCurrentTurn && <span className="text-[10px] text-yellow-400 animate-pulse font-bold">â¶ ì°¨ë¡</span>}
    </div>
  );
}

// ââ ì¤ë²ë ì´ ëª¨ë¬ âââââââââââââââââââââââââââââââââââââââââââââ
function Modal({ children }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl">
        {children}
      </div>
    </div>
  );
}

// ================================================================
//  4. ì¸ê¸ íë©´ (TaxScreen)
// ================================================================
// phase: "tribute" (ë°ì¹ê¸°) | "return_pick" (ë¬ë¬´í°/ì´ë¦¬ê° ëë ¤ì¤ ì¹´ë ì í) | "done"
function TaxScreen({ myId, myHand, ranks, tributeMap, onTributeDone, onReturnDone, taxPhase }) {
  const [selected, setSelected] = useState([]);
  const myRole = ranks[myId];
  const isGreatSlave = myRole === "great_slave";
  const isSlave = myRole === "slave";
  const isDalmuti = myRole === "dalmuti";
  const isPrime = myRole === "prime";

  // íëª ì²´í¬ (ìëí ë¸ìê° ì¡°ì»¤ 2ì¥ ë³´ì )
  const myJokers = (myHand || []).filter(c => c.joker);
  const canRevolution = isGreatSlave && myJokers.length >= 2;

  // ë´ê° ë°ì³ì¼ í  ì¹´ë ì
  const requiredCount = isGreatSlave ? 2 : isSlave ? 1 : 0;

  // ë¬ë¬´í°/ì´ë¦¬ê° ëë ¤ì¤ ì¹´ë ì (ë°ì ë§í¼)
  const returnCount = isDalmuti ? 2 : isPrime ? 1 : 0;

  function toggle(card) {
    setSelected(prev =>
      prev.find(c => c.id === card.id)
        ? prev.filter(c => c.id !== card.id)
        : prev.length < (taxPhase === "tribute" ? requiredCount : returnCount)
          ? [...prev, card]
          : prev
    );
  }

  if (taxPhase === "tribute" && (isGreatSlave || isSlave)) {
    return (
      <Modal>
        <h2 className="text-white text-xl font-bold mb-1">
          {isGreatSlave ? "âï¸ ìëí ë¸ì" : "ð ë¸ì"} â ì¸ê¸ ë©ë¶
        </h2>
        <p className="text-white/50 text-sm mb-4">
          ê°ì¥ ì¢ì ì¹´ë {requiredCount}ì¥ì {isGreatSlave ? "ë¬ë¬´í°" : "ì´ë¦¬"}ìê² ë°ì³ì¼ í©ëë¤.
        </p>
        {canRevolution && (
          <div className="bg-red-500/20 border border-red-500/40 rounded-xl p-3 mb-4">
            <p className="text-red-400 text-sm font-bold">ð¥ íëª ê°ë¥!</p>
            <p className="text-red-300/70 text-xs mt-1">ì¡°ì»¤ 2ì¥ì ëª¨ë ë³´ì íê³  ìì´ íëªì ì ì¸í  ì ììµëë¤.</p>
            <button
              onClick={() => onTributeDone({ type: "revolution" })}
              className="mt-2 w-full py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white font-bold text-sm transition-all"
            >
              ð¥ íëª ì ì¸! (ì¸ê¸ ë©´ì  + ê³ê¸ ì ì§)
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-center mb-4">
          {(myHand || []).map(card => (
            <Card key={card.id} card={card}
              selected={!!selected.find(c => c.id === card.id)}
              onClick={() => toggle(card)} />
          ))}
        </div>
        <button
          onClick={() => { if (selected.length === requiredCount) onTributeDone({ type: "tribute", cards: selected }); }}
          disabled={selected.length !== requiredCount}
          className="w-full py-3 rounded-2xl bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold transition-all"
        >
          {selected.length}/{requiredCount}ì¥ ì í â ë°ì¹ê¸°
        </button>
      </Modal>
    );
  }

  if (taxPhase === "return_pick" && (isDalmuti || isPrime)) {
    const received = tributeMap?.[myId] || [];
    return (
      <Modal>
        <h2 className="text-white text-xl font-bold mb-1">
          {isDalmuti ? "ð ë¬ë¬´í°" : "ð¤µ ì´ë¦¬"} â ëµë¡ ì¹´ë ì í
        </h2>
        <p className="text-white/50 text-sm mb-2">
          ì¸ê¸ì¼ë¡ ë°ì ì¹´ë: {received.map(c => c.joker ? "ì¡°ì»¤" : `${c.rank}ë²`).join(", ")}
        </p>
        <p className="text-white/50 text-sm mb-4">
          ëë ¤ì¤ ì¹´ë {returnCount}ì¥ì ì ííì¸ì. (ì½í ì¹´ë ê¶ì¥)
        </p>
        <div className="flex flex-wrap gap-2 justify-center mb-4">
          {(myHand || []).map(card => (
            <Card key={card.id} card={card}
              selected={!!selected.find(c => c.id === card.id)}
              onClick={() => toggle(card)} />
          ))}
        </div>
        <button
          onClick={() => { if (selected.length === returnCount) onReturnDone(selected); }}
          disabled={selected.length !== returnCount}
          className="w-full py-3 rounded-2xl bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold transition-all"
        >
          {selected.length}/{returnCount}ì¥ ì í â ëë ¤ì£¼ê¸°
        </button>
      </Modal>
    );
  }

  // íë¯¼ì´ê±°ë ì¸ê¸ ì²ë¦¬ ì¤ ë¤ë¥¸ ì¬ë ê¸°ë¤ë¦¬ë íë©´
  return (
    <Modal>
      <div className="text-center py-6">
        <div className="text-4xl mb-3 animate-spin">â³</div>
        <p className="text-white font-bold">ì¸ê¸ ì²ë¦¬ ì¤...</p>
        <p className="text-white/40 text-sm mt-2">ë¤ë¥¸ íë ì´ì´ì ì¸ê¸ ì²ë¦¬ë¥¼ ê¸°ë¤ë¦½ëë¤.</p>
      </div>
    </Modal>
  );
}

// ================================================================
//  5. ê²ì íì´ë¸ (GameTable)
// ================================================================
function GameTable({ gs, myId, onPlay, onPass }) {
  const [selected, setSelected] = useState([]);
  const { players, pile, currentTurn, round, log, ranks } = gs;
  const myHand = gs.myHand || [];
  const isMyTurn = currentTurn === myId;
  const self = players?.find(p => p.id === myId);
  const others = (players || []).filter(p => p.id !== myId);

  function toggle(card) {
    setSelected(prev =>
      prev.find(c => c.id === card.id) ? prev.filter(c => c.id !== card.id) : [...prev, card]
    );
  }

  function handlePlay() {
    const r = onPlay(selected);
    if (r?.ok) setSelected([]);
  }

  const validMsg = (() => {
    if (selected.length === 0) return null;
    const nj = selected.filter(c => !c.joker);
    if (nj.length > 1 && new Set(nj.map(c => c.rank)).size > 1) return "ê°ì ì«ì ì¹´ëë§ ë¼ ì ìì´ì";
    if (pile && pile.length > 0) {
      if (selected.length !== pile.length) return `ë°ë¥ê³¼ ê°ì ${pile.length}ì¥ì ë´ì¼ í´ì`;
      const myRank = nj[0]?.rank;
      const pileRank = pile.find(c => !c.joker)?.rank;
      if (myRank && pileRank && myRank >= pileRank) return "ë ë®ì(ê°í) ì«ìì¬ì¼ í´ì";
    }
    return null;
  })();

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-green-900 to-teal-950 flex flex-col">
      {/* HUD */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/40 backdrop-blur border-b border-white/5">
        <span className="text-white/60 text-sm">ë¼ì´ë <span className="text-white font-bold">{round}</span></span>
        <span className="text-white font-black tracking-widest text-lg">ë¬ë¬´í°</span>
        <span className={`text-xs font-bold px-3 py-1 rounded-full transition-all
          ${isMyTurn ? "bg-yellow-400 text-yellow-900 animate-pulse" : "bg-white/10 text-white/50"}`}>
          {isMyTurn ? "â¡ ë´ ì°¨ë¡!" : "ëê¸° ì¤"}
        </span>
      </div>

      {/* ìëë°© */}
      <div className="flex flex-wrap gap-2 justify-center px-3 pt-3 pb-1">
        {others.map(p => (
          <PlayerToken key={p.id} player={p} isCurrentTurn={currentTurn === p.id} />
        ))}
      </div>

      {/* ì¤ì ë°ë¥ */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
        <div className="bg-black/25 backdrop-blur rounded-3xl px-6 py-5 flex flex-col items-center gap-3 shadow-xl border border-white/5 w-full max-w-sm">
          <p className="text-white/30 text-[10px] uppercase tracking-widest">ë°ë¥ ì¹´ë</p>
          <Pile pile={pile} />
          {gs.lastPlayerNick && pile?.length > 0 && (
            <p className="text-white/30 text-xs">ë§ì§ë§: {gs.lastPlayerNick}</p>
          )}
        </div>

        {/* ë¡ê·¸ */}
        <div className="w-full max-w-sm bg-black/20 rounded-2xl px-4 py-2 max-h-16 overflow-y-auto">
          {(log || []).slice(-5).reverse().map((l, i) => (
            <p key={i} className={`text-xs truncate ${i === 0 ? "text-white/60" : "text-white/25"}`}>{l}</p>
          ))}
        </div>
      </div>

      {/* ë´ ìí¨ */}
      <div className="bg-black/50 backdrop-blur border-t border-white/10 px-4 py-4">
        {self?.rank && (
          <div className={`inline-flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full bg-gradient-to-r ${RANK_COLOR[self.rank]} text-white mb-2`}>
            {RANK_LABEL[self.rank]}
          </div>
        )}
        <div className="flex flex-wrap gap-1 justify-center mb-3 min-h-[88px] items-end">
          {myHand.map(card => (
            <Card key={card.id} card={card}
              selected={!!selected.find(c => c.id === card.id)}
              onClick={() => isMyTurn && toggle(card)}
              disabled={!isMyTurn} />
          ))}
          {myHand.length === 0 && (
            <p className="text-white/20 text-sm self-center">í¨ê° ììµëë¤ ð</p>
          )}
        </div>
        {validMsg && <p className="text-center text-red-400 text-xs mb-2">â  {validMsg}</p>}
        <div className="flex gap-3 justify-center">
          <button onClick={handlePlay}
            disabled={!isMyTurn || selected.length === 0 || !!validMsg}
            className="px-6 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95">
            ì¹´ë ë´ê¸° ({selected.length})
          </button>
          <button onClick={() => { onPass(); setSelected([]); }}
            disabled={!isMyTurn || !pile || pile.length === 0}
            className="px-6 py-2 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-semibold rounded-xl shadow-lg transition-all active:scale-95">
            í¨ì¤
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================================================
//  6. ë¼ì´ë ê²°ê³¼ íë©´
// ================================================================
function RoundResult({ finished, players, round, isRevolution, onReady, selfId, readyIds }) {
  const isReady = readyIds?.includes(selfId);
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-emerald-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl">
        {isRevolution && (
          <div className="bg-red-500/20 border border-red-500/40 rounded-2xl p-3 mb-4 text-center">
            <p className="text-red-400 font-black text-lg">ð¥ íëª ë°ì!</p>
            <p className="text-red-300/70 text-sm">ì¸ê¸ì´ ë©´ì ë©ëë¤. ê³ê¸ì ê·¸ëë¡ ì ì§ë©ëë¤.</p>
          </div>
        )}
        <h2 className="text-white text-2xl font-bold text-center mb-1">ë¼ì´ë {round} ì¢ë£</h2>
        <p className="text-white/40 text-sm text-center mb-5">ë¤ì ë¼ì´ë ê³ê¸</p>
        <div className="space-y-2 mb-6">
          {finished.map((id, i) => {
            const p = players?.find(pl => pl.id === id);
            const rankKeys = ["dalmuti", "prime", "peasant", "slave", "great_slave"];
            const rIdx = i === 0 ? 0 : i === 1 && finished.length >= 6 ? 1
              : i === finished.length - 1 ? 4
              : i === finished.length - 2 && finished.length >= 6 ? 3 : 2;
            const rank = rankKeys[rIdx];
            return (
              <div key={id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${RANK_BG[rank]}`}>
                <span className="text-white font-bold w-5 text-center">{i + 1}</span>
                <span className="flex-1 text-white font-semibold">{p?.nickname ?? id}</span>
                <span className="text-sm">{RANK_LABEL[rank]}</span>
              </div>
            );
          })}
        </div>
        <button onClick={onReady} disabled={isReady}
          className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-bold transition-all shadow-lg">
          {isReady ? `â ì¤ë¹ ìë£ (${readyIds?.length ?? 0}/${players?.length ?? 0})` : "ë¤ì ë¼ì´ë ì¤ë¹!"}
        </button>
      </div>
    </div>
  );
}

// ================================================================
//  7. ëê¸°ì¤ (Lobby)
// ================================================================
function Lobby({ roomCode, players, selfId, isHost, onStart, onCopy }) {
  const canStart = players.length >= 5 && players.length <= 10;
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-emerald-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl">
        <h2 className="text-white text-2xl font-bold text-center mb-1">ê²ì ëê¸°ì¤</h2>
        <p className="text-white/40 text-sm text-center mb-6">5~10ëªì´ ëª¨ì´ë©´ ìì ê°ë¥í´ì</p>

        <div className="flex items-center gap-2 bg-black/30 rounded-xl px-4 py-3 mb-6">
          <span className="text-white/40 text-xs uppercase tracking-widest">ë°© ì½ë</span>
          <span className="text-yellow-400 font-mono font-bold text-2xl tracking-widest flex-1">{roomCode}</span>
          <button onClick={onCopy}
            className="text-xs bg-yellow-400 text-yellow-900 font-bold px-3 py-1 rounded-lg hover:bg-yellow-300 transition-colors active:scale-95">
            ë³µì¬
          </button>
        </div>

        <div className="space-y-2 mb-6">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-3">ì°¸ê°ì ({players.length}/10)</p>
          {players.map(p => (
            <div key={p.id} className={`flex items-center gap-3 px-4 py-2 rounded-xl
              ${p.id === selfId ? "bg-emerald-500/20 border border-emerald-500/30" : "bg-white/5"}`}>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-bold text-sm">
                {p.nickname[0]}
              </div>
              <span className="text-white text-sm flex-1">{p.nickname}</span>
              {p.id === selfId && <span className="text-emerald-400 text-xs">ë</span>}
              {p.isHost && <span className="text-yellow-400 text-xs">ð ë°©ì¥</span>}
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
          ))}
          {Array.from({ length: Math.max(0, 5 - players.length) }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/5 border border-dashed border-white/10">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-500">?</div>
              <span className="text-white/20 text-sm">ëê¸° ì¤...</span>
            </div>
          ))}
        </div>

        {isHost ? (
          <button onClick={onStart} disabled={!canStart}
            className="w-full py-3 rounded-2xl font-bold text-base transition-all
              bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg hover:from-emerald-400 hover:to-teal-400
              disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed">
            {canStart ? "ð® ê²ì ìì!" : `${5 - players.length}ëª ë íìí´ì`}
          </button>
        ) : (
          <p className="text-center text-white/30 text-sm py-3">ë°©ì¥ì´ ê²ìì ììí  ëê¹ì§ ê¸°ë¤ë ¤ì£¼ì¸ì</p>
        )}
      </div>
    </div>
  );
}

// ================================================================
//  8. ê²ì ê·ì¹ íì
// ================================================================
function RulesPopup({ onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-xl font-bold">ð ë¬ë¬´í° ê²ì ê·ì¹</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-2xl">â</button>
        </div>
        <div className="space-y-4 text-white/70 text-sm leading-relaxed">
          <div>
            <p className="text-yellow-400 font-bold mb-1">ð ì¹´ë êµ¬ì± (ì´ 80ì¥)</p>
            <p>1ë² 1ì¥ ~ 12ë² 12ì¥ + ì¡°ì»¤(ì´ìë£©í ì¬ë) 2ì¥. ì«ìê° ë®ììë¡ ê°í ì¹´ëìì.</p>
          </div>
          <div>
            <p className="text-yellow-400 font-bold mb-1">ð® ê¸°ë³¸ ì§í</p>
            <p>ì  íë ì´ì´ê° ê°ì ì«ì ì¹´ë Nì¥ì ëëë¤. ë¤ì íë ì´ì´ë ê°ì ì¥ìì´ë©´ì ë ë®ì ì«ìë¥¼ ë´ê±°ë í¨ì¤í´ì¼ í´ì. ëª¨ë í¨ì¤íë©´ ë§ì§ë§ì ë¸ ì¬ëì´ ì ì ì´ ë©ëë¤.</p>
          </div>
          <div>
            <p className="text-yellow-400 font-bold mb-1">ð ê³ê¸ (2ë¼ì´ëë¶í°)</p>
            <ul className="space-y-1 mt-1">
              <li>ð¥ <span className="text-yellow-300">ë¬ë¬´í°</span> â 1ë±</li>
              <li>ð¥ <span className="text-blue-300">ì´ë¦¬</span> â 2ë± (6ì¸ ì´ì)</li>
              <li>ð¨ <span className="text-green-300">íë¯¼</span> â ì¤ê°</li>
              <li>ð <span className="text-orange-300">ë¸ì</span> â ê¼´ì°ìì 2ë± (6ì¸ ì´ì)</li>
              <li>âï¸ <span className="text-red-300">ìëí ë¸ì</span> â ê¼´ì°</li>
            </ul>
          </div>
          <div>
            <p className="text-yellow-400 font-bold mb-1">ð° ì¸ê¸ ìì¤í</p>
            <p>ìëí ë¸ì â ë¬ë¬´í°ìê² ê°ì¥ ì¢ì ì¹´ë 2ì¥ íë©. ë¸ì â ì´ë¦¬ìê² 1ì¥ íë©. ë¬ë¬´í°/ì´ë¦¬ë ì ì¢ì ì¹´ëë¡ ëë ¤ì¤ì.</p>
          </div>
          <div>
            <p className="text-yellow-400 font-bold mb-1">ð¥ íëª!</p>
            <p>ìëí ë¸ìê° ì¡°ì»¤ 2ì¥ì ëª¨ë ê°ì§ê³  ìì¼ë©´ íëªì ì ì¸í  ì ìì´ì. ì¸ê¸ì´ ë©´ì ë©ëë¤!</p>
          </div>
          <div>
            <p className="text-yellow-400 font-bold mb-1">ð¥ ì¸ì</p>
            <p>5ëª ~ 10ëª. ë°©ì¥ì´ 5ëª ì´ì ëª¨ì´ë©´ ê²ìì ììí  ì ìì´ì.</p>
          </div>
        </div>
        <button onClick={onClose}
          className="w-full mt-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold">
          íì¸!
        </button>
      </div>
    </div>
  );
}

// ================================================================
//  9. ë©ì¸ íë©´
// ================================================================
function MainScreen({ onCreateRoom, onJoinRoom, loading, isDevMode, onTestMode }) {
  const [nickname, setNickname] = useState("");
  const [mode, setMode] = useState(null);
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [devTapCount, setDevTapCount] = useState(0);
  const [devUnlocked, setDevUnlocked] = useState(false);

  function handleSecretTap() {
    const next = devTapCount + 1;
    setDevTapCount(next);
    if (next >= 5) {
      setDevUnlocked(true);
      setDevTapCount(0);
    }
  }

  const showDevButton = isDevMode || devUnlocked;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-900 flex flex-col items-center justify-center p-6">
      {showRules && <RulesPopup onClose={() => setShowRules(false)} />}
      <div className="text-center mb-10">
        <div className="text-6xl mb-3 animate-bounce">ð</div>
        <h1 className="text-5xl font-black text-white tracking-tight">ë¬ë¬´í°</h1>
        <p className="text-emerald-400 text-xs mt-2 tracking-[0.3em] uppercase">The Great Dalmuti</p>
        <p className="text-white/20 text-xs mt-3">5~10ì¸ ì¤ìê° ì¹´ë ê²ì</p>
        <button onClick={() => setShowRules(true)}
          className="mt-3 text-xs text-emerald-400/70 border border-emerald-400/30 px-3 py-1 rounded-full hover:bg-emerald-400/10 transition-all">
          ð ê²ì ê·ì¹ ë³´ê¸°
        </button>
      </div>

      <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl">
        <label className="block text-white/40 text-xs uppercase tracking-widest mb-2">ëë¤ì</label>
        <input value={nickname} onChange={e => { setNickname(e.target.value); setError(""); }}
          placeholder="ì: ê¹ë¬ë¬´í°" maxLength={10}
          className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm mb-4 focus:outline-none focus:border-emerald-400 transition-colors" />

        {mode === "join" && (
          <>
            <label className="block text-white/40 text-xs uppercase tracking-widest mb-2">ë°© ì½ë</label>
            <input value={roomCode} onChange={e => { setRoomCode(e.target.value.toUpperCase()); setError(""); }}
              placeholder="ì: A3K9" maxLength={6}
              className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm mb-4 font-mono tracking-widest focus:outline-none focus:border-emerald-400 transition-colors" />
          </>
        )}

        {error && <p className="text-red-400 text-xs mb-3">â  {error}</p>}

        {loading ? (
          <div className="text-center py-3 text-white/50 text-sm animate-pulse">ì°ê²° ì¤...</div>
        ) : mode === null ? (
          <div className="flex flex-col gap-3">
            <button onClick={() => { if (!nickname.trim()) { setError("ëë¤ìì ìë ¥í´ì£¼ì¸ì"); return; } onCreateRoom(nickname.trim()); }}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold hover:from-emerald-400 hover:to-teal-400 transition-all shadow-lg active:scale-95">
              ì ë°© ë§ë¤ê¸°
            </button>
            <button onClick={() => setMode("join")}
              className="w-full py-3 rounded-2xl bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all active:scale-95">
              ë°© ì°¸ì¬íê¸°
            </button>
            {showDevButton && (
              <button onClick={() => { if (!nickname.trim()) { setError("ëë¤ìì ìë ¥í´ì£¼ì¸ì"); return; } onTestMode(nickname.trim()); }}
                className="w-full py-3 rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold transition-all shadow-lg active:scale-95">
                ð¤ í¼ì íì¤í¸íê¸° (ë´ 4ëª)
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button onClick={async () => {
              if (!nickname.trim()) { setError("ëë¤ìì ìë ¥í´ì£¼ì¸ì"); return; }
              if (!roomCode.trim()) { setError("ë°© ì½ëë¥¼ ìë ¥í´ì£¼ì¸ì"); return; }
              const r = await onJoinRoom(nickname.trim(), roomCode.trim());
              if (!r.ok) setError(r.error);
            }}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold hover:from-emerald-400 hover:to-teal-400 transition-all shadow-lg active:scale-95">
              ìì¥íê¸°
            </button>
            <button onClick={() => { setMode(null); setRoomCode(""); setError(""); }}
              className="w-full py-3 rounded-2xl bg-white/5 text-white/40 text-sm hover:bg-white/10 transition-all">
              â ë¤ë¡
            </button>
          </div>
        )}
      </div>

      <div className="mt-8 w-full max-w-sm grid grid-cols-3 gap-2 text-center">
        {["ð 80ì¥ ë±", "ð ê³ê¸ ìì¤í", "ð¥ íëª ì ì¸"].map(t => (
          <div key={t} className="bg-white/5 rounded-xl py-3 text-white/30 text-xs">{t}</div>
        ))}
      </div>
      {/* ë¹ë° í­ ìì­: ìê´ 5ë² í­íë©´ ê°ë°ëª¨ë íì±í */}
      <div onClick={handleSecretTap} className="mt-4 w-8 h-8 opacity-0 cursor-default" />
    </div>
  );
}

// ================================================================
//  9. Firebase í (useFirebaseGame)
// ================================================================
function useFirebaseGame() {
  const [uid, setUid] = useState(null);
  const [screen, setScreen] = useState("main"); // main|lobby|tax|game|result
  const [roomCode, setRoomCode] = useState(null);
  const [roomData, setRoomData] = useState(null);  // ì ì²´ room ì¤ëì·
  const [myHand, setMyHand] = useState([]);
  const [loading, setLoading] = useState(true);
  const [taxPhase, setTaxPhase] = useState(null); // tribute|return_pick|null
  const [tributeReceived, setTributeReceived] = useState({}); // { receiverId: cards[] }
  const listeners = useRef([]);

  // ìµëª ë¡ê·¸ì¸
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) { setUid(user.uid); setLoading(false); }
      else {
        try { await signInAnonymously(auth); }
        catch (e) { console.error("Auth error", e); setLoading(false); }
      }
    });
    return unsub;
  }, []);

  // ë°© ë°ì´í° ì¤ìê° êµ¬ë
  useEffect(() => {
    if (!roomCode || !uid) return;
    const roomRef = ref(db, `rooms/${roomCode}`);
    const unsub = onValue(roomRef, snap => {
      const data = snap.val();
      if (!data) return;
      setRoomData(data);

      // íë©´ ì í ë¡ì§
      const status = data.meta?.status;
      if (status === "waiting") setScreen("lobby");
      else if (status === "tax") {
        setScreen("tax");
        // ë´ê° ë°ì ì¸ê¸ ì¹´ë ì¶ì 
        const recv = data.game?.tributeReceived || {};
        setTributeReceived(recv);
        // taxPhase ê²°ì 
        const myRole = data.game?.ranks?.[uid];
        const tributeDone = data.game?.tributeDone || {};
        const returnDone = data.game?.returnDone || {};
        if ((myRole === "great_slave" || myRole === "slave") && !tributeDone[uid])
          setTaxPhase("tribute");
        else if ((myRole === "dalmuti" || myRole === "prime") && tributeDone[uid] && !returnDone[uid])
          setTaxPhase("return_pick");
        else
          setTaxPhase("waiting");
      }
      else if (status === "playing") setScreen("game");
      else if (status === "result") setScreen("result");
    });
    listeners.current.push(() => off(roomRef));
    return () => off(roomRef);
  }, [roomCode, uid]);

  // ë´ ìí¨ ì¤ìê° êµ¬ë
  useEffect(() => {
    if (!roomCode || !uid) return;
    const handRef = ref(db, `rooms/${roomCode}/hands/${uid}`);
    const unsub = onValue(handRef, snap => {
      setMyHand(snap.val() || []);
    });
    return () => off(handRef);
  }, [roomCode, uid]);

  // ââ ê°ë° ëª¨ë ì²´í¬ (?dev=true) ââââââââââââââââââââââââââââ
  // (App ì»´í¬ëí¸ ìµìë¨ìì ì²ë¦¬íë¯ë¡ ì¬ê¸°ì  ì ê±°)

  // ââ íì¤í¸ ëª¨ë: ë´ 4ëªê³¼ í¨ê» ë°© ë§ë¤ê¸° ââââââââââââââââââ
  async function startTestGame(nickname) {
    const code = generateRoomCode();
    const botNames = ["ë´-ì² ì", "ë´-ìí¬", "ë´-ë¯¼ì¤", "ë´-ì§ì"];
    const botIds = botNames.map((_, i) => `bot-${i}-${Date.now()}`);
    const allPlayers = { [uid]: { nickname, isHost: true, joinedAt: Date.now(), cardCount: 0, rank: null, isConnected: true, isBot: false } };
    botIds.forEach((id, i) => {
      allPlayers[id] = { nickname: botNames[i], isHost: false, joinedAt: Date.now(), cardCount: 0, rank: null, isConnected: true, isBot: true };
    });
    await set(ref(db, `rooms/${code}`), {
      meta: { hostId: uid, status: "waiting", createdAt: Date.now() },
      players: allPlayers,
      game: { round: 0, finished: [], log: ["[íì¤í¸ ëª¨ë] ë´ 4ëªê³¼ í¨ê» ììí©ëë¤!"] }
    });
    setRoomCode(code);
    // ë°ë¡ ê²ì ìì
    const playerIds = [uid, ...botIds];
    const hands = dealCards(playerIds);
    const updates = {};
    updates[`rooms/${code}/meta/status`] = "playing";
    updates[`rooms/${code}/game/pile`] = [];
    updates[`rooms/${code}/game/currentTurn`] = uid;
    updates[`rooms/${code}/game/passCount`] = 0;
    updates[`rooms/${code}/game/lastPlayerId`] = null;
    updates[`rooms/${code}/game/finished`] = [];
    updates[`rooms/${code}/game/round`] = 1;
    updates[`rooms/${code}/game/log`] = ["[íì¤í¸ ëª¨ë] ê²ì ìì! ë´ë¤ì ìëì¼ë¡ íë ì´í´ì."];
    playerIds.forEach(id => {
      updates[`rooms/${code}/hands/${id}`] = hands[id];
      updates[`rooms/${code}/players/${id}/cardCount`] = hands[id].length;
    });
    // ë´ ìí¨ë¥¼ game/botHandsì ì ì¥ (ë´ AIì©)
    updates[`rooms/${code}/game/botIds`] = botIds;
    updates[`rooms/${code}/game/isTestMode`] = true;
    await update(ref(db), updates);
  }

  // ââ ë°© ë§ë¤ê¸° ââââââââââââââââââââââââââââââââââââââââââââââ
  async function createRoom(nickname) {
    const code = generateRoomCode();
    const roomRef = ref(db, `rooms/${code}`);
    await set(roomRef, {
      meta: { hostId: uid, status: "waiting", createdAt: Date.now() },
      players: {
        [uid]: { nickname, isHost: true, joinedAt: Date.now(), cardCount: 0, rank: null, isConnected: true }
      },
      game: { round: 0, finished: [], log: ["ë°©ì´ ìì±ëììµëë¤"] }
    });
    setRoomCode(code);
  }

  // ââ ë°© ì°¸ì¬ ââââââââââââââââââââââââââââââââââââââââââââââââ
  async function joinRoom(nickname, code) {
    const roomRef = ref(db, `rooms/${code}`);
    const snap = await get(roomRef);
    if (!snap.exists()) return { ok: false, error: "ì¡´ì¬íì§ ìë ë°© ì½ëìì" };
    const data = snap.val();
    if (data.meta?.status !== "waiting") return { ok: false, error: "ì´ë¯¸ ììë ê²ìì´ìì" };
    const playerCount = Object.keys(data.players || {}).length;
    if (playerCount >= 10) return { ok: false, error: "ë°©ì´ ê°ë ì°¼ì´ì (ìµë 10ëª)" };

    await update(ref(db, `rooms/${code}/players/${uid}`), {
      nickname, isHost: false, joinedAt: Date.now(), cardCount: 0, rank: null, isConnected: true
    });
    setRoomCode(code);
    return { ok: true };
  }

  // ââ ê²ì ìì (ë°©ì¥ë§) ââââââââââââââââââââââââââââââââââââ
  async function startGame() {
    const snap = await get(ref(db, `rooms/${roomCode}/players`));
    const players = snap.val();
    const playerIds = Object.keys(players);
    const hands = dealCards(playerIds);

    const updates = {};
    updates[`rooms/${roomCode}/meta/status`] = "playing";
    updates[`rooms/${roomCode}/game/pile`] = [];
    updates[`rooms/${roomCode}/game/currentTurn`] = playerIds[0];
    updates[`rooms/${roomCode}/game/passCount`] = 0;
    updates[`rooms/${roomCode}/game/lastPlayerId`] = null;
    updates[`rooms/${roomCode}/game/finished`] = [];
    updates[`rooms/${roomCode}/game/round`] = (roomData?.game?.round ?? 0) + 1;
    updates[`rooms/${roomCode}/game/log`] = ["ê²ì ìì! ì²« ë²ì§¸ íë ì´ì´ë¶í° ììíì¸ì."];
    playerIds.forEach(id => {
      updates[`rooms/${roomCode}/hands/${id}`] = hands[id];
      updates[`rooms/${roomCode}/players/${id}/cardCount`] = hands[id].length;
    });
    await update(ref(db), updates);
  }

  // ââ ì¹´ë ë´ê¸° âââââââââââââââââââââââââââââââââââââââââââââ
  async function playCards(cards) {
    const game = roomData?.game;
    const pile = game?.pile ?? [];
    const v = validatePlay(cards, pile);
    if (!v.ok) return v;

    const playerId = uid;
    const playerNick = roomData?.players?.[uid]?.nickname;
    const newHand = myHand.filter(c => !cards.find(s => s.id === c.id));
    const newFinished = [...(game?.finished ?? [])];
    const newLog = [...(game?.log ?? []), `${playerNick}ì´(ê°) ${cards.length}ì¥ì ëìµëë¤`];

    if (newHand.length === 0 && !newFinished.includes(playerId)) {
      newFinished.push(playerId);
      newLog.push(`ð ${playerNick}ì´(ê°) í¨ë¥¼ ë¤ ëìµëë¤!`);
    }

    // ë¤ì íë ì´ì´ ê³ì°
    const playerIds = Object.keys(roomData?.players ?? {});
    const idx = playerIds.indexOf(playerId);
    let nextId = playerIds[(idx + 1) % playerIds.length];
    const handSnap = await get(ref(db, `rooms/${roomCode}/hands`));
    const allHands = handSnap.val() || {};
    allHands[playerId] = newHand;
    let tries = 0;
    while ((allHands[nextId]?.length ?? 0) === 0 && tries < playerIds.length) {
      const ni = playerIds.indexOf(nextId);
      nextId = playerIds[(ni + 1) % playerIds.length];
      tries++;
    }

    // ë¼ì´ë ì¢ë£ ì²´í¬
    const remaining = playerIds.filter(id => (allHands[id]?.length ?? 0) > 0);
    const isRoundOver = remaining.length <= 1;
    if (isRoundOver && remaining.length === 1) {
      newFinished.push(remaining[0]);
      newLog.push(`ë¼ì´ë ì¢ë£! ê³ê¸ì´ ê²°ì ë©ëë¤.`);
    }

    const updates = {};
    updates[`rooms/${roomCode}/hands/${playerId}`] = newHand;
    updates[`rooms/${roomCode}/players/${playerId}/cardCount`] = newHand.length;
    updates[`rooms/${roomCode}/game/pile`] = cards;
    updates[`rooms/${roomCode}/game/lastPlayerId`] = playerId;
    updates[`rooms/${roomCode}/game/passCount`] = 0;
    updates[`rooms/${roomCode}/game/finished`] = newFinished;
    updates[`rooms/${roomCode}/game/log`] = newLog.slice(-20);

    if (isRoundOver) {
      const ranks = assignRanks(newFinished, playerIds.length);
      updates[`rooms/${roomCode}/game/ranks`] = ranks;
      updates[`rooms/${roomCode}/meta/status`] = "result";
      updates[`rooms/${roomCode}/game/readyForNext`] = [];
      newFinished.forEach(id => {
        updates[`rooms/${roomCode}/players/${id}/rank`] = ranks[id];
      });
    } else {
      updates[`rooms/${roomCode}/game/currentTurn`] = nextId;
    }

    await update(ref(db), updates);
    return { ok: true };
  }

  // ââ í¨ì¤ âââââââââââââââââââââââââââââââââââââââââââââââââ
  async function pass() {
    const game = roomData?.game;
    const playerIds = Object.keys(roomData?.players ?? {});
    const handSnap = await get(ref(db, `rooms/${roomCode}/hands`));
    const allHands = handSnap.val() || {};
    const activePlayers = playerIds.filter(id => (allHands[id]?.length ?? 0) > 0);
    const newPassCount = (game?.passCount ?? 0) + 1;
    const playerNick = roomData?.players?.[uid]?.nickname;
    const newLog = [...(game?.log ?? []), `${playerNick}ì´(ê°) í¨ì¤íìµëë¤`];

    const idx = playerIds.indexOf(uid);
    let nextId = playerIds[(idx + 1) % playerIds.length];
    let tries = 0;
    while ((allHands[nextId]?.length ?? 0) === 0 && tries < playerIds.length) {
      const ni = playerIds.indexOf(nextId);
      nextId = playerIds[(ni + 1) % playerIds.length];
      tries++;
    }

    const updates = {};
    if (newPassCount >= activePlayers.length - 1) {
      const lastId = game?.lastPlayerId;
      newLog.push(`ëª¨ë í¨ì¤! ${roomData?.players?.[lastId]?.nickname}ì´(ê°) ìë¡ ììí©ëë¤`);
      updates[`rooms/${roomCode}/game/pile`] = [];
      updates[`rooms/${roomCode}/game/passCount`] = 0;
      updates[`rooms/${roomCode}/game/currentTurn`] = lastId;
      updates[`rooms/${roomCode}/game/lastPlayerId`] = null;
    } else {
      updates[`rooms/${roomCode}/game/passCount`] = newPassCount;
      updates[`rooms/${roomCode}/game/currentTurn`] = nextId;
    }
    updates[`rooms/${roomCode}/game/log`] = newLog.slice(-20);
    await update(ref(db), updates);
  }

  // ââ ì¸ê¸: ë°ì¹ê¸° ââââââââââââââââââââââââââââââââââââââââââ
  async function tributeCards(result) {
    if (result.type === "revolution") {
      // íëª: ì¸ê¸ ë©´ì , ê³ê¸ ì ì§, ë¤ì ë¼ì´ëë¡
      const updates = {};
      updates[`rooms/${roomCode}/game/revolution`] = true;
      updates[`rooms/${roomCode}/game/log`] = [
        ...(roomData?.game?.log ?? []),
        `ð¥ ${roomData?.players?.[uid]?.nickname}ì´(ê°) íëªì ì ì¸íìµëë¤!`
      ];
      updates[`rooms/${roomCode}/meta/status`] = "playing";
      // ë¤ì ë¼ì´ë ë
      await update(ref(db), updates);
      await startGame();
      return;
    }

    // ì¼ë° ì¸ê¸
    const { cards } = result;
    const myRole = roomData?.game?.ranks?.[uid];
    const receiverId = myRole === "great_slave"
      ? Object.keys(roomData?.game?.ranks ?? {}).find(id => roomData.game.ranks[id] === "dalmuti")
      : Object.keys(roomData?.game?.ranks ?? {}).find(id => roomData.game.ranks[id] === "prime");

    // ë´ ìí¨ìì ì ê±°
    const newHand = myHand.filter(c => !cards.find(s => s.id === c.id));

    const updates = {};
    updates[`rooms/${roomCode}/hands/${uid}`] = newHand;
    updates[`rooms/${roomCode}/players/${uid}/cardCount`] = newHand.length;
    updates[`rooms/${roomCode}/game/tributeDone/${uid}`] = true;
    updates[`rooms/${roomCode}/game/tributeReceived/${receiverId}`] = [
      ...(roomData?.game?.tributeReceived?.[receiverId] ?? []),
      ...cards
    ];

    await update(ref(db), updates);
  }

  // ââ ì¸ê¸: ëë ¤ì£¼ê¸° ââââââââââââââââââââââââââââââââââââââââ
  async function returnCards(cards) {
    const myRole = roomData?.game?.ranks?.[uid];
    const targetId = myRole === "dalmuti"
      ? Object.keys(roomData?.game?.ranks ?? {}).find(id => roomData.game.ranks[id] === "great_slave")
      : Object.keys(roomData?.game?.ranks ?? {}).find(id => roomData.game.ranks[id] === "slave");

    // ë°ì ì¸ê¸ ì¹´ëë¥¼ ìí¨ì ì¶ê°, ëë ¤ì¤ ì¹´ë ì ê±°
    const received = roomData?.game?.tributeReceived?.[uid] ?? [];
    const newHand = [
      ...myHand.filter(c => !cards.find(s => s.id === c.id)),
      ...received
    ].sort((a, b) => a.rank - b.rank);

    const targetSnap = await get(ref(db, `rooms/${roomCode}/hands/${targetId}`));
    const targetHand = [
      ...(targetSnap.val() ?? []).filter(c => !received.find(r => r.id === c.id)),
      ...cards
    ].sort((a, b) => a.rank - b.rank);

    const updates = {};
    updates[`rooms/${roomCode}/hands/${uid}`] = newHand;
    updates[`rooms/${roomCode}/players/${uid}/cardCount`] = newHand.length;
    updates[`rooms/${roomCode}/hands/${targetId}`] = targetHand;
    updates[`rooms/${roomCode}/players/${targetId}/cardCount`] = targetHand.length;
    updates[`rooms/${roomCode}/game/returnDone/${uid}`] = true;

    // ëª¨ë  ì¸ê¸ì´ ìë£ëëì§ ì²´í¬
    const ranks = roomData?.game?.ranks ?? {};
    const hasDalmuti = Object.values(ranks).includes("dalmuti");
    const hasPrime = Object.values(ranks).includes("prime");
    const returnDone = { ...(roomData?.game?.returnDone ?? {}), [uid]: true };
    const requiredReturns = [
      hasDalmuti && Object.keys(ranks).find(id => ranks[id] === "dalmuti"),
      hasPrime && Object.keys(ranks).find(id => ranks[id] === "prime")
    ].filter(Boolean);
    const allDone = requiredReturns.every(id => returnDone[id]);

    if (allDone) {
      // ì¸ê¸ ìë£ â ê²ì ìì
      updates[`rooms/${roomCode}/meta/status`] = "playing";
      const playerIds = Object.keys(roomData?.players ?? {});
      // ë¬ë¬´í°ê° ì²« ë²ì§¸ ì 
      const dalmutiId = Object.keys(ranks).find(id => ranks[id] === "dalmuti");
      updates[`rooms/${roomCode}/game/currentTurn`] = dalmutiId;
      updates[`rooms/${roomCode}/game/pile`] = [];
      updates[`rooms/${roomCode}/game/passCount`] = 0;
      updates[`rooms/${roomCode}/game/lastPlayerId`] = null;
      updates[`rooms/${roomCode}/game/finished`] = [];
      updates[`rooms/${roomCode}/game/log`] = ["ì¸ê¸ ìë£! ë¬ë¬´í°ë¶í° ììí©ëë¤."];
      updates[`rooms/${roomCode}/game/tributeDone`] = {};
      updates[`rooms/${roomCode}/game/returnDone`] = {};
      updates[`rooms/${roomCode}/game/tributeReceived`] = {};
    }

    await update(ref(db), updates);
  }

  // ââ ë¤ì ë¼ì´ë ì¤ë¹ ââââââââââââââââââââââââââââââââââââââ
  async function readyForNext() {
    const snap = await get(ref(db, `rooms/${roomCode}/game/readyForNext`));
    const readyList = snap.val() || [];
    if (readyList.includes(uid)) return;
    const newList = [...readyList, uid];
    const playerCount = Object.keys(roomData?.players ?? {}).length;

    const updates = {};
    updates[`rooms/${roomCode}/game/readyForNext`] = newList;

    if (newList.length >= playerCount) {
      // ëª¨ë ì¤ë¹ â ì¸ê¸ ë¨ê³ë¡
      const ranks = roomData?.game?.ranks ?? {};
      const hasDalmuti = Object.values(ranks).includes("dalmuti");
      const hasPrime = Object.values(ranks).includes("prime");
      if (hasDalmuti || hasPrime) {
        updates[`rooms/${roomCode}/meta/status`] = "tax";
        updates[`rooms/${roomCode}/game/tributeDone`] = {};
        updates[`rooms/${roomCode}/game/returnDone`] = {};
        updates[`rooms/${roomCode}/game/tributeReceived`] = {};
      } else {
        // 1ë¼ì´ëë¼ ê³ê¸ ìì â ë°ë¡ ë
        await update(ref(db), updates);
        await startGame();
        return;
      }
    }
    await update(ref(db), updates);
  }

  // ââ íì ë°ì´í° ì¡°ë¦½ ââââââââââââââââââââââââââââââââââââââ
  const players = Object.entries(roomData?.players ?? {}).map(([id, p]) => ({
    id, ...p, rank: roomData?.game?.ranks?.[id] ?? p.rank
  }));

  const gs = roomData ? {
    players,
    myHand,
    pile: roomData.game?.pile ?? [],
    currentTurn: roomData.game?.currentTurn,
    lastPlayerNick: roomData?.players?.[roomData.game?.lastPlayerId]?.nickname,
    round: roomData.game?.round ?? 1,
    log: roomData.game?.log ?? [],
    ranks: roomData.game?.ranks ?? {},
    finished: roomData.game?.finished ?? [],
    readyForNext: roomData.game?.readyForNext ?? [],
    revolution: roomData.game?.revolution ?? false,
  } : null;

  return {
    uid, screen, loading, roomCode, gs, players,
    taxPhase, tributeReceived,
    createRoom, joinRoom, startGame, playCards, pass,
    tributeCards, returnCards, readyForNext, startTestGame,
  };
}

// ================================================================
//  10. ë£¨í¸ ì±
// ================================================================

// ì± ë¡ë ìì  ê°ë°ëª¨ë (í­ 5ë²ì¼ë¡ íì±í)
const IS_DEV_MODE = false; // ìë MainScreenìì í­ì¼ë¡ íì±í

export default function App() {
  const {
    uid, screen, loading, roomCode, gs, players,
    taxPhase, tributeReceived,
    createRoom, joinRoom, startGame, playCards, pass,
    tributeCards, returnCards, readyForNext, startTestGame,
  } = useFirebaseGame();

  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard?.writeText(roomCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isHost = !!gs?.players?.find(p => p.id === uid)?.isHost
    || players.find(p => p.id === uid)?.isHost;

  if (loading)
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-bounce mb-4">ð</div>
          <p className="text-white/50 text-sm animate-pulse">Firebase ì°ê²° ì¤...</p>
        </div>
      </div>
    );

  if (screen === "main")
    return <MainScreen onCreateRoom={createRoom} onJoinRoom={joinRoom} loading={loading} isDevMode={IS_DEV_MODE} onTestMode={startTestGame} />;

  if (screen === "lobby")
    return (
      <Lobby
        roomCode={roomCode}
        players={players}
        selfId={uid}
        isHost={isHost}
        onStart={startGame}
        onCopy={handleCopy}
      />
    );

  if (screen === "tax" && gs)
    return (
      <TaxScreen
        myId={uid}
        myHand={gs.myHand}
        ranks={gs.ranks}
        tributeMap={tributeReceived}
        onTributeDone={tributeCards}
        onReturnDone={returnCards}
        taxPhase={taxPhase}
      />
    );

  if (screen === "game" && gs)
    return <GameTable gs={gs} myId={uid} onPlay={playCards} onPass={pass} />;

  if (screen === "result" && gs)
    return (
      <RoundResult
        finished={gs.finished}
        players={gs.players}
        round={gs.round}
        isRevolution={gs.revolution}
        onReady={readyForNext}
        selfId={uid}
        readyIds={gs.readyForNext}
      />
    );

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <p className="text-white/30 text-sm">ë¡ë© ì¤...</p>
    </div>
  );
}
