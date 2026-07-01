
// ================================================================
//  달무티 (The Great Dalmuti) — 완성본
//  ✅ Firebase Realtime Database 실시간 멀티플레이
//  ✅ 세금 시스템 (달무티↔위대한노예 2장, 총리↔노예 1장)
//  ✅ 혁명 선언 (노예가 조커 2장 보유 시)
//  ✅ 계급별 자리 재배치
//
//  📦 필요한 패키지:
//     npm install firebase
//
//  🔥 Firebase 설정 방법:
//     1. https://console.firebase.google.com 에서 프로젝트 생성
//     2. Realtime Database 활성화 (테스트 모드로 시작)
//     3. 아래 FIREBASE_CONFIG 값을 본인 프로젝트 값으로 교체
//
//  🔒 Firebase Security Rules (Realtime Database):
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

// ── 🔥 Firebase 설정 (본인 프로젝트 값으로 교체) ──────────────
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
//  1. 게임 유틸리티
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
  if (!cards || cards.length === 0) return { ok: false, error: "카드를 선택하세요" };
  const nonJoker = cards.filter((c) => !c.joker);
  if (nonJoker.length > 1 && new Set(nonJoker.map((c) => c.rank)).size > 1)
    return { ok: false, error: "같은 숫자 카드만 낼 수 있어요" };
  if (pile && pile.length > 0) {
    if (cards.length !== pile.length)
      return { ok: false, error: `바닥과 같은 ${pile.length}장을 내야 해요` };
    const myRank = nonJoker[0]?.rank;
    const pileRank = pile.find((c) => !c.joker)?.rank ?? pile[0]?.rank;
    if (myRank && pileRank && myRank >= pileRank)
      return { ok: false, error: "더 낮은(강한) 숫자여야 해요" };
  }
  return { ok: true };
}

// 계급 배정 (완료 순서 기반)
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

// 세금: 어떤 카드를 바쳐야 하는지 계산
function computeTax(hands, ranks) {
  // 위대한 노예 → 달무티: 가장 좋은 카드(rank 낮은) 2장
  // 노예 → 총리: 가장 좋은 카드 1장
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

// 달무티/총리가 돌려줄 최악의 카드
function computeReturn(hands, ranks, tributeCount) {
  // tributeCount: { dalmutiId: 2, primeId: 1 }
  const result = {};
  Object.entries(tributeCount).forEach(([receiverId, count]) => {
    const sorted = [...(hands[receiverId] || [])].sort((a, b) => b.rank - a.rank); // 높은(약한) 순
    result[receiverId] = sorted.slice(0, count);
  });
  return result;
}

// ================================================================
//  2. 상수
// ================================================================

const RANK_LABEL = {
  dalmuti: "👑 달무티",
  prime: "🤵 총리",
  peasant: "👨 평민",
  slave: "🔗 노예",
  great_slave: "⛓️ 위대한 노예",
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
//  3. UI 컴포넌트
// ================================================================

// ── 카드 ──────────────────────────────────────────────────────
function Card({ card, selected, onClick, disabled, size = "md" }) {
  const isJoker = card.joker;
  const label = isJoker ? "🃏" : card.rank;
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
        <span className="absolute -top-2 -right-2 bg-white text-blue-600 rounded-full w-5 h-5 text-xs flex items-center justify-center font-bold">✓</span>
      )}
    </button>
  );
}

// ── 바닥 카드 ─────────────────────────────────────────────────
function Pile({ pile }) {
  if (!pile || pile.length === 0)
    return (
      <div className="flex items-center justify-center w-44 h-24 rounded-2xl border-2 border-dashed border-white/20 text-white/30 text-sm">
        바닥 비어있음
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
        {pile.length}장 · {pile.find(c=>!c.joker)?.rank ?? "조커"}번
      </div>
    </div>
  );
}

// ── 상대 플레이어 토큰 ────────────────────────────────────────
function PlayerToken({ player, isCurrentTurn }) {
  return (
    <div className={`flex flex-col items-center gap-1 px-2 py-2 rounded-xl transition-all min-w-[64px]
      ${isCurrentTurn ? "bg-yellow-400/20 ring-2 ring-yellow-400 scale-105" : "bg-white/5"}`}>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white
        ${player.rank ? `bg-gradient-to-br ${RANK_COLOR[player.rank]}` : "bg-slate-600"}`}>
        {player.nickname[0]}
      </div>
      <span className="text-white text-[11px] font-medium truncate max-w-[56px]">{player.nickname}</span>
      <span className="text-white/40 text-[10px]">🃏 {player.cardCount}</span>
      {player.rank && <span className="text-[9px] text-yellow-300">{RANK_LABEL[player.rank]}</span>}
      {isCurrentTurn && <span className="text-[10px] text-yellow-400 animate-pulse font-bold">▶ 차례</span>}
    </div>
  );
}

// ── 오버레이 모달 ─────────────────────────────────────────────
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
//  4. 세금 화면 (TaxScreen)
// ================================================================
// phase: "tribute" (바치기) | "return_pick" (달무티/총리가 돌려줄 카드 선택) | "done"
function TaxScreen({ myId, myHand, ranks, tributeMap, onTributeDone, onReturnDone, taxPhase }) {
  const [selected, setSelected] = useState([]);
  const myRole = ranks[myId];
  const isGreatSlave = myRole === "great_slave";
  const isSlave = myRole === "slave";
  const isDalmuti = myRole === "dalmuti";
  const isPrime = myRole === "prime";

  // 혁명 체크 (위대한 노예가 조커 2장 보유)
  const myJokers = (myHand || []).filter(c => c.joker);
  const canRevolution = isGreatSlave && myJokers.length >= 2;

  // 내가 바쳐야 할 카드 수
  const requiredCount = isGreatSlave ? 2 : isSlave ? 1 : 0;

  // 달무티/총리가 돌려줄 카드 수 (받은 만큼)
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
          {isGreatSlave ? "⛓️ 위대한 노예" : "🔗 노예"} — 세금 납부
        </h2>
        <p className="text-white/50 text-sm mb-4">
          가장 좋은 카드 {requiredCount}장을 {isGreatSlave ? "달무티" : "총리"}에게 바쳐야 합니다.
        </p>
        {canRevolution && (
          <div className="bg-red-500/20 border border-red-500/40 rounded-xl p-3 mb-4">
            <p className="text-red-400 text-sm font-bold">🔥 혁명 가능!</p>
            <p className="text-red-300/70 text-xs mt-1">조커 2장을 모두 보유하고 있어 혁명을 선언할 수 있습니다.</p>
            <button
              onClick={() => onTributeDone({ type: "revolution" })}
              className="mt-2 w-full py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white font-bold text-sm transition-all"
            >
              🔥 혁명 선언! (세금 면제 + 계급 유지)
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
          {selected.length}/{requiredCount}장 선택 → 바치기
        </button>
      </Modal>
    );
  }

  if (taxPhase === "return_pick" && (isDalmuti || isPrime)) {
    const received = tributeMap?.[myId] || [];
    return (
      <Modal>
        <h2 className="text-white text-xl font-bold mb-1">
          {isDalmuti ? "👑 달무티" : "🤵 총리"} — 답례 카드 선택
        </h2>
        <p className="text-white/50 text-sm mb-2">
          세금으로 받은 카드: {received.map(c => c.joker ? "조커" : `${c.rank}번`).join(", ")}
        </p>
        <p className="text-white/50 text-sm mb-4">
          돌려줄 카드 {returnCount}장을 선택하세요. (약한 카드 권장)
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
          {selected.length}/{returnCount}장 선택 → 돌려주기
        </button>
      </Modal>
    );
  }

  // 평민이거나 세금 처리 중 다른 사람 기다리는 화면
  return (
    <Modal>
      <div className="text-center py-6">
        <div className="text-4xl mb-3 animate-spin">⏳</div>
        <p className="text-white font-bold">세금 처리 중...</p>
        <p className="text-white/40 text-sm mt-2">다른 플레이어의 세금 처리를 기다립니다.</p>
      </div>
    </Modal>
  );
}

// ================================================================
//  5. 게임 테이블 (GameTable)
// ================================================================
function GameTable({ gs, myId, onPlay, onPass }) {
  const [selected, setSelected] = useState([]);
  const { players, pile, currentTurn, round, log, ranks } = gs;
  const myHand = gs.myHand || [];
  const isMyTurn = currentTurn === myId;
  const self = players?.find(p => p.id === myId);
  const others = (players || []).filter(p => p.id !== myId);

  // 턴이 바뀔 때마다 선택 초기화
  useEffect(() => {
    setSelected([]);
  }, [currentTurn]);

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
    if (nj.length > 1 && new Set(nj.map(c => c.rank)).size > 1) return "같은 숫자 카드만 낼 수 있어요";
    if (pile && pile.length > 0) {
      if (selected.length !== pile.length) return `바닥과 같은 ${pile.length}장을 내야 해요`;
      const myRank = nj[0]?.rank;
      const pileRank = pile.find(c => !c.joker)?.rank;
      if (myRank && pileRank && myRank >= pileRank) return "더 낮은(강한) 숫자여야 해요";
    }
    return null;
  })();

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-green-900 to-teal-950 flex flex-col">
      {/* HUD */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/40 backdrop-blur border-b border-white/5">
        <span className="text-white/60 text-sm">라운드 <span className="text-white font-bold">{round}</span></span>
        <span className="text-white font-black tracking-widest text-lg">달무티</span>
        <span className={`text-xs font-bold px-3 py-1 rounded-full transition-all
          ${isMyTurn ? "bg-yellow-400 text-yellow-900 animate-pulse" : "bg-white/10 text-white/50"}`}>
          {isMyTurn ? "⚡ 내 차례!" : "대기 중"}
        </span>
      </div>

      {/* 상대방 */}
      <div className="flex flex-wrap gap-2 justify-center px-3 pt-3 pb-1">
        {others.map(p => (
          <PlayerToken key={p.id} player={p} isCurrentTurn={currentTurn === p.id} />
        ))}
      </div>

      {/* 중앙 바닥 */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
        <div className="bg-black/25 backdrop-blur rounded-3xl px-6 py-5 flex flex-col items-center gap-3 shadow-xl border border-white/5 w-full max-w-sm">
          <p className="text-white/30 text-[10px] uppercase tracking-widest">바닥 카드</p>
          <Pile pile={pile} />
          {gs.lastPlayerNick && pile?.length > 0 && (
            <p className="text-white/30 text-xs">마지막: {gs.lastPlayerNick}</p>
          )}
        </div>

        {/* 로그 */}
        <div className="w-full max-w-sm bg-black/20 rounded-2xl px-4 py-2 max-h-16 overflow-y-auto">
          {(log || []).slice(-5).reverse().map((l, i) => (
            <p key={i} className={`text-xs truncate ${i === 0 ? "text-white/60" : "text-white/25"}`}>{l}</p>
          ))}
        </div>
      </div>

      {/* 내 손패 */}
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
            <p className="text-white/20 text-sm self-center">패가 없습니다 🎉</p>
          )}
        </div>
        {validMsg && <p className="text-center text-red-400 text-xs mb-2">⚠ {validMsg}</p>}
        <div className="flex gap-3 justify-center">
          <button onClick={handlePlay}
            disabled={!isMyTurn || selected.length === 0 || !!validMsg}
            className="px-6 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95">
            카드 내기 ({selected.length})
          </button>
          <button onClick={() => { onPass(); setSelected([]); }}
            disabled={!isMyTurn || !pile || pile.length === 0}
            className="px-6 py-2 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-semibold rounded-xl shadow-lg transition-all active:scale-95">
            패스
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================================================
//  6. 라운드 결과 화면
// ================================================================
function RoundResult({ finished, players, round, isRevolution, onReady, selfId, readyIds }) {
  const isReady = readyIds?.includes(selfId);
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-emerald-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl">
        {isRevolution && (
          <div className="bg-red-500/20 border border-red-500/40 rounded-2xl p-3 mb-4 text-center">
            <p className="text-red-400 font-black text-lg">🔥 혁명 발생!</p>
            <p className="text-red-300/70 text-sm">세금이 면제됩니다. 계급은 그대로 유지됩니다.</p>
          </div>
        )}
        <h2 className="text-white text-2xl font-bold text-center mb-1">라운드 {round} 종료</h2>
        <p className="text-white/40 text-sm text-center mb-5">다음 라운드 계급</p>
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
          {isReady ? `✅ 준비 완료 (${readyIds?.length ?? 0}/${players?.length ?? 0})` : "다음 라운드 준비!"}
        </button>
      </div>
    </div>
  );
}

// ================================================================
//  7. 대기실 (Lobby)
// ================================================================
function Lobby({ roomCode, players, selfId, isHost, onStart, onCopy }) {
  const canStart = players.length >= 5 && players.length <= 10;
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-emerald-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl">
        <h2 className="text-white text-2xl font-bold text-center mb-1">게임 대기실</h2>
        <p className="text-white/40 text-sm text-center mb-6">5~10명이 모이면 시작 가능해요</p>

        <div className="flex items-center gap-2 bg-black/30 rounded-xl px-4 py-3 mb-6">
          <span className="text-white/40 text-xs uppercase tracking-widest">방 코드</span>
          <span className="text-yellow-400 font-mono font-bold text-2xl tracking-widest flex-1">{roomCode}</span>
          <button onClick={onCopy}
            className="text-xs bg-yellow-400 text-yellow-900 font-bold px-3 py-1 rounded-lg hover:bg-yellow-300 transition-colors active:scale-95">
            복사
          </button>
        </div>

        <div className="space-y-2 mb-6">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-3">참가자 ({players.length}/10)</p>
          {players.map(p => (
            <div key={p.id} className={`flex items-center gap-3 px-4 py-2 rounded-xl
              ${p.id === selfId ? "bg-emerald-500/20 border border-emerald-500/30" : "bg-white/5"}`}>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-bold text-sm">
                {p.nickname[0]}
              </div>
              <span className="text-white text-sm flex-1">{p.nickname}</span>
              {p.id === selfId && <span className="text-emerald-400 text-xs">나</span>}
              {p.isHost && <span className="text-yellow-400 text-xs">👑 방장</span>}
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
          ))}
          {Array.from({ length: Math.max(0, 5 - players.length) }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/5 border border-dashed border-white/10">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-500">?</div>
              <span className="text-white/20 text-sm">대기 중...</span>
            </div>
          ))}
        </div>

        {isHost ? (
          <button onClick={onStart} disabled={!canStart}
            className="w-full py-3 rounded-2xl font-bold text-base transition-all
              bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg hover:from-emerald-400 hover:to-teal-400
              disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed">
            {canStart ? "🎮 게임 시작!" : `${5 - players.length}명 더 필요해요`}
          </button>
        ) : (
          <p className="text-center text-white/30 text-sm py-3">방장이 게임을 시작할 때까지 기다려주세요</p>
        )}
      </div>
    </div>
  );
}

// ================================================================
//  8. 게임 규칙 팝업
// ================================================================
function RulesPopup({ onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-xl font-bold">👑 달무티 게임 규칙</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-2xl">✕</button>
        </div>
        <div className="space-y-4 text-white/70 text-sm leading-relaxed">
          <div>
            <p className="text-yellow-400 font-bold mb-1">🃏 카드 구성 (총 80장)</p>
            <p>1번 1장 ~ 12번 12장 + 조커(어수룩한 사람) 2장. 숫자가 낮을수록 강한 카드예요.</p>
          </div>
          <div>
            <p className="text-yellow-400 font-bold mb-1">🎮 기본 진행</p>
            <p>선 플레이어가 같은 숫자 카드 N장을 냅니다. 다음 플레이어는 같은 장수이면서 더 낮은 숫자를 내거나 패스해야 해요. 모두 패스하면 마지막에 낸 사람이 새 선이 됩니다.</p>
          </div>
          <div>
            <p className="text-yellow-400 font-bold mb-1">👑 계급 (2라운드부터)</p>
            <ul className="space-y-1 mt-1">
              <li>🥇 <span className="text-yellow-300">달무티</span> — 1등</li>
              <li>🥈 <span className="text-blue-300">총리</span> — 2등 (6인 이상)</li>
              <li>👨 <span className="text-green-300">평민</span> — 중간</li>
              <li>🔗 <span className="text-orange-300">노예</span> — 꼴찌에서 2등 (6인 이상)</li>
              <li>⛓️ <span className="text-red-300">위대한 노예</span> — 꼴찌</li>
            </ul>
          </div>
          <div>
            <p className="text-yellow-400 font-bold mb-1">💰 세금 시스템</p>
            <p>위대한 노예 → 달무티에게 가장 좋은 카드 2장 헌납. 노예 → 총리에게 1장 헌납. 달무티/총리는 안 좋은 카드로 돌려줘요.</p>
          </div>
          <div>
            <p className="text-yellow-400 font-bold mb-1">🔥 혁명!</p>
            <p>위대한 노예가 조커 2장을 모두 가지고 있으면 혁명을 선언할 수 있어요. 세금이 면제됩니다!</p>
          </div>
          <div>
            <p className="text-yellow-400 font-bold mb-1">👥 인원</p>
            <p>5명 ~ 10명. 방장이 5명 이상 모이면 게임을 시작할 수 있어요.</p>
          </div>
        </div>
        <button onClick={onClose}
          className="w-full mt-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold">
          확인!
        </button>
      </div>
    </div>
  );
}

// ================================================================
//  9. 메인 화면
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
        <div className="text-6xl mb-3 animate-bounce">👑</div>
        <h1 className="text-5xl font-black text-white tracking-tight">달무티</h1>
        <p className="text-emerald-400 text-xs mt-2 tracking-[0.3em] uppercase">The Great Dalmuti</p>
        <p className="text-white/20 text-xs mt-3">5~10인 실시간 카드 게임</p>
        <button onClick={() => setShowRules(true)}
          className="mt-3 text-xs text-emerald-400/70 border border-emerald-400/30 px-3 py-1 rounded-full hover:bg-emerald-400/10 transition-all">
          📖 게임 규칙 보기
        </button>
      </div>

      <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl">
        <label className="block text-white/40 text-xs uppercase tracking-widest mb-2">닉네임</label>
        <input value={nickname} onChange={e => { setNickname(e.target.value); setError(""); }}
          placeholder="예: 김달무티" maxLength={10}
          className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm mb-4 focus:outline-none focus:border-emerald-400 transition-colors" />

        {mode === "join" && (
          <>
            <label className="block text-white/40 text-xs uppercase tracking-widest mb-2">방 코드</label>
            <input value={roomCode} onChange={e => { setRoomCode(e.target.value.toUpperCase()); setError(""); }}
              placeholder="예: A3K9" maxLength={6}
              className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm mb-4 font-mono tracking-widest focus:outline-none focus:border-emerald-400 transition-colors" />
          </>
        )}

        {error && <p className="text-red-400 text-xs mb-3">⚠ {error}</p>}

        {loading ? (
          <div className="text-center py-3 text-white/50 text-sm animate-pulse">연결 중...</div>
        ) : mode === null ? (
          <div className="flex flex-col gap-3">
            <button onClick={() => { if (!nickname.trim()) { setError("닉네임을 입력해주세요"); return; } onCreateRoom(nickname.trim()); }}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold hover:from-emerald-400 hover:to-teal-400 transition-all shadow-lg active:scale-95">
              새 방 만들기
            </button>
            <button onClick={() => setMode("join")}
              className="w-full py-3 rounded-2xl bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all active:scale-95">
              방 참여하기
            </button>
            <button onClick={() => { if (!nickname.trim()) { setError("닉네임을 입력해주세요"); return; } onTestMode(nickname.trim()); }}
                className="w-full py-3 rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold transition-all shadow-lg active:scale-95">
                🤖 혼자 테스트하기 (봇 4명)
              </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button onClick={async () => {
              if (!nickname.trim()) { setError("닉네임을 입력해주세요"); return; }
              if (!roomCode.trim()) { setError("방 코드를 입력해주세요"); return; }
              const r = await onJoinRoom(nickname.trim(), roomCode.trim());
              if (!r.ok) setError(r.error);
            }}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold hover:from-emerald-400 hover:to-teal-400 transition-all shadow-lg active:scale-95">
              입장하기
            </button>
            <button onClick={() => { setMode(null); setRoomCode(""); setError(""); }}
              className="w-full py-3 rounded-2xl bg-white/5 text-white/40 text-sm hover:bg-white/10 transition-all">
              ← 뒤로
            </button>
          </div>
        )}
      </div>

      <div className="mt-8 w-full max-w-sm grid grid-cols-3 gap-2 text-center">
        {["🃏 80장 덱", "👑 계급 시스템", "🔥 혁명 선언"].map(t => (
          <div key={t} className="bg-white/5 rounded-xl py-3 text-white/30 text-xs">{t}</div>
        ))}
      </div>
      {/* 비밀 탭 영역: 왕관 5번 탭하면 개발모드 활성화 */}
      <div onClick={handleSecretTap} className="mt-4 w-8 h-8 opacity-0 cursor-default" />
    </div>
  );
}

// ================================================================
//  9. Firebase 훅 (useFirebaseGame)
// ================================================================
function useFirebaseGame() {
  const [uid, setUid] = useState(null);
  const [screen, setScreen] = useState("main"); // main|lobby|tax|game|result
  const [roomCode, setRoomCode] = useState(null);
  const [roomData, setRoomData] = useState(null);  // 전체 room 스냅샷
  const [myHand, setMyHand] = useState([]);
  const [loading, setLoading] = useState(true);
  const [taxPhase, setTaxPhase] = useState(null); // tribute|return_pick|null
  const [tributeReceived, setTributeReceived] = useState({}); // { receiverId: cards[] }
  const listeners = useRef([]);

  // 익명 로그인
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

  // 방 데이터 실시간 구독
  useEffect(() => {
    if (!roomCode || !uid) return;
    const roomRef = ref(db, `rooms/${roomCode}`);
    const unsub = onValue(roomRef, snap => {
      const data = snap.val();
      if (!data) return;
      setRoomData(data);

      // 화면 전환 로직
      const status = data.meta?.status;
      if (status === "waiting") setScreen("lobby");
      else if (status === "tax") {
        setScreen("tax");
        // 내가 받은 세금 카드 추적
        const recv = data.game?.tributeReceived || {};
        setTributeReceived(recv);
        // taxPhase 결정
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

  // 내 손패 실시간 구독
  useEffect(() => {
    if (!roomCode || !uid) return;
    const handRef = ref(db, `rooms/${roomCode}/hands/${uid}`);
    const unsub = onValue(handRef, snap => {
      setMyHand(snap.val() || []);
    });
    return () => off(handRef);
  }, [roomCode, uid]);

  // ── 개발 모드 체크 (?dev=true) ────────────────────────────
  // (App 컴포넌트 최상단에서 처리하므로 여기선 제거)

  // ── 봇 AI: 봇 차례일 때 자동 플레이 ──────────────────────
  useEffect(() => {
    if (!roomData || !roomCode) return;
    const game = roomData.game;
    if (!game?.isTestMode || !game?.botIds) return;
    if (roomData.meta?.status !== "playing") return;

    const currentTurn = game.currentTurn;
    const botIds = game.botIds;
    if (!botIds.includes(currentTurn)) return; // 봇 차례가 아님

    // 1~2초 딜레이 후 봇 플레이
    const delay = 1000 + Math.random() * 1000;
    const timer = setTimeout(async () => {
      // 봇 손패 가져오기
      const handSnap = await get(ref(db, `rooms/${roomCode}/hands/${currentTurn}`));
      const botHand = handSnap.val() || [];
      if (!botHand.length) return;

      const pile = game.pile ?? [];
      const playerIds = Object.keys(roomData.players ?? {});

      // 낼 수 있는 카드 찾기
      function findBestPlay(hand, pile) {
        if (!pile.length) {
          // 바닥이 비어있으면 가장 약한 카드(숫자 높은) 중 같은 숫자로 가장 많이 낼 수 있는 것
          const groups = {};
          hand.forEach(c => {
            const key = c.joker ? 'joker' : c.rank;
            if (!groups[key]) groups[key] = [];
            groups[key].push(c);
          });
          // 가장 높은 숫자(약한) 그룹 선택
          const sorted = Object.entries(groups).sort((a, b) => {
            const ra = a[0] === 'joker' ? 0 : parseInt(a[0]);
            const rb = b[0] === 'joker' ? 0 : parseInt(b[0]);
            return rb - ra; // 높은 숫자(약한 카드) 먼저
          });
          return sorted[0]?.[1] || null;
        }

        const pileCount = pile.length;
        const pileRank = pile.find(c => !c.joker)?.rank ?? 0;

        // 바닥과 같은 장수이면서 더 낮은 숫자 찾기
        const groups = {};
        hand.forEach(c => {
          if (c.joker) return;
          if (!groups[c.rank]) groups[c.rank] = [];
          groups[c.rank].push(c);
        });

        const jokers = hand.filter(c => c.joker);
        const candidates = [];

        // 순수 카드로 낼 수 있는지
        Object.entries(groups).forEach(([rank, cards]) => {
          if (parseInt(rank) < pileRank && cards.length >= pileCount) {
            candidates.push(cards.slice(0, pileCount));
          }
        });

        // 조커 포함해서 낼 수 있는지
        if (jokers.length > 0) {
          Object.entries(groups).forEach(([rank, cards]) => {
            if (parseInt(rank) < pileRank) {
              const needed = pileCount - cards.length;
              if (needed > 0 && needed <= jokers.length) {
                candidates.push([...cards, ...jokers.slice(0, needed)]);
              }
            }
          });
          // 조커만으로
          if (jokers.length >= pileCount && pileRank > 0) {
            candidates.push(jokers.slice(0, pileCount));
          }
        }

        if (!candidates.length) return null;
        // 가장 약한(높은 숫자) 카드로 내기
        candidates.sort((a, b) => {
          const ra = a.find(c => !c.joker)?.rank ?? 0;
          const rb = b.find(c => !c.joker)?.rank ?? 0;
          return rb - ra;
        });
        return candidates[0];
      }

      const cardsToPlay = findBestPlay(botHand, pile);

      if (!cardsToPlay) {
        // 패스
        const allHandsSnap = await get(ref(db, `rooms/${roomCode}/hands`));
        const allHands = allHandsSnap.val() || {};
        const activePlayers = playerIds.filter(id => (allHands[id]?.length ?? 0) > 0);
        const newPassCount = (game.passCount ?? 0) + 1;
        const botNick = roomData.players?.[currentTurn]?.nickname;
        const newLog = [...(game.log ?? []), `${botNick}이(가) 패스했습니다`];

        const idx = playerIds.indexOf(currentTurn);
        let nextId = playerIds[(idx + 1) % playerIds.length];
        let tries = 0;
        while ((allHands[nextId]?.length ?? 0) === 0 && tries < playerIds.length) {
          const ni = playerIds.indexOf(nextId);
          nextId = playerIds[(ni + 1) % playerIds.length];
          tries++;
        }

        const updates = {};
        if (newPassCount >= activePlayers.length - 1) {
          const lastId = game.lastPlayerId;
          newLog.push(`모두 패스! ${roomData.players?.[lastId]?.nickname}이(가) 새로 시작합니다`);
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
      } else {
        // 카드 내기
        const newBotHand = botHand.filter(c => !cardsToPlay.find(s => s.id === c.id));
        const allHandsSnap = await get(ref(db, `rooms/${roomCode}/hands`));
        const allHands = { ...(allHandsSnap.val() || {}), [currentTurn]: newBotHand };
        const botNick = roomData.players?.[currentTurn]?.nickname;
        const newFinished = [...(game.finished ?? [])];
        const newLog = [...(game.log ?? []), `${botNick}이(가) ${cardsToPlay.length}장을 냈습니다`];

        if (!newBotHand.length && !newFinished.includes(currentTurn)) {
          newFinished.push(currentTurn);
          newLog.push(`🎉 ${botNick}이(가) 패를 다 냈습니다!`);
        }

        const remaining = playerIds.filter(id => (allHands[id]?.length ?? 0) > 0);
        const isOver = remaining.length <= 1;
        if (isOver && remaining.length === 1) {
          newFinished.push(remaining[0]);
          newLog.push("라운드 종료!");
        }

        const idx = playerIds.indexOf(currentTurn);
        let nextId = playerIds[(idx + 1) % playerIds.length];
        let tries = 0;
        while ((allHands[nextId]?.length ?? 0) === 0 && tries < playerIds.length) {
          const ni = playerIds.indexOf(nextId);
          nextId = playerIds[(ni + 1) % playerIds.length];
          tries++;
        }

        const updates = {};
        updates[`rooms/${roomCode}/hands/${currentTurn}`] = newBotHand;
        updates[`rooms/${roomCode}/players/${currentTurn}/cardCount`] = newBotHand.length;
        updates[`rooms/${roomCode}/game/pile`] = cardsToPlay;
        updates[`rooms/${roomCode}/game/lastPlayerId`] = currentTurn;
        updates[`rooms/${roomCode}/game/passCount`] = 0;
        updates[`rooms/${roomCode}/game/finished`] = newFinished;
        updates[`rooms/${roomCode}/game/log`] = newLog.slice(-20);

        if (isOver) {
          const ranks = assignRanks(newFinished, playerIds.length);
          updates[`rooms/${roomCode}/game/ranks`] = ranks;
          updates[`rooms/${roomCode}/meta/status`] = "result";
          updates[`rooms/${roomCode}/game/readyForNext`] = [];
          newFinished.forEach(id => { updates[`rooms/${roomCode}/players/${id}/rank`] = ranks[id]; });
        } else {
          updates[`rooms/${roomCode}/game/currentTurn`] = nextId;
        }
        await update(ref(db), updates);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [roomData?.game?.currentTurn, roomData?.game?.passCount, roomData?.game?.pile?.length, roomCode]);

  // ── 테스트 모드: 봇 4명과 함께 방 만들기 ──────────────────
  async function startTestGame(nickname) {
    const code = generateRoomCode();
    const botNames = ["봇-철수", "봇-영희", "봇-민준", "봇-지수"];
    const botIds = botNames.map((_, i) => `bot-${i}-${Date.now()}`);
    const allPlayers = { [uid]: { nickname, isHost: true, joinedAt: Date.now(), cardCount: 0, rank: null, isConnected: true, isBot: false } };
    botIds.forEach((id, i) => {
      allPlayers[id] = { nickname: botNames[i], isHost: false, joinedAt: Date.now(), cardCount: 0, rank: null, isConnected: true, isBot: true };
    });
    await set(ref(db, `rooms/${code}`), {
      meta: { hostId: uid, status: "waiting", createdAt: Date.now() },
      players: allPlayers,
      game: { round: 0, finished: [], log: ["[테스트 모드] 봇 4명과 함께 시작합니다!"] }
    });
    setRoomCode(code);
    // 바로 게임 시작
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
    updates[`rooms/${code}/game/log`] = ["[테스트 모드] 게임 시작! 봇들은 자동으로 플레이해요."];
    playerIds.forEach(id => {
      updates[`rooms/${code}/hands/${id}`] = hands[id];
      updates[`rooms/${code}/players/${id}/cardCount`] = hands[id].length;
    });
    // 봇 손패를 game/botHands에 저장 (봇 AI용)
    updates[`rooms/${code}/game/botIds`] = botIds;
    updates[`rooms/${code}/game/isTestMode`] = true;
    await update(ref(db), updates);
  }

  // ── 방 만들기 ──────────────────────────────────────────────
  async function createRoom(nickname) {
    const code = generateRoomCode();
    const roomRef = ref(db, `rooms/${code}`);
    await set(roomRef, {
      meta: { hostId: uid, status: "waiting", createdAt: Date.now() },
      players: {
        [uid]: { nickname, isHost: true, joinedAt: Date.now(), cardCount: 0, rank: null, isConnected: true }
      },
      game: { round: 0, finished: [], log: ["방이 생성되었습니다"] }
    });
    setRoomCode(code);
  }

  // ── 방 참여 ────────────────────────────────────────────────
  async function joinRoom(nickname, code) {
    const roomRef = ref(db, `rooms/${code}`);
    const snap = await get(roomRef);
    if (!snap.exists()) return { ok: false, error: "존재하지 않는 방 코드예요" };
    const data = snap.val();
    if (data.meta?.status !== "waiting") return { ok: false, error: "이미 시작된 게임이에요" };
    const playerCount = Object.keys(data.players || {}).length;
    if (playerCount >= 10) return { ok: false, error: "방이 가득 찼어요 (최대 10명)" };

    await update(ref(db, `rooms/${code}/players/${uid}`), {
      nickname, isHost: false, joinedAt: Date.now(), cardCount: 0, rank: null, isConnected: true
    });
    setRoomCode(code);
    return { ok: true };
  }

  // ── 게임 시작 (방장만) ────────────────────────────────────
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
    updates[`rooms/${roomCode}/game/log`] = ["게임 시작! 첫 번째 플레이어부터 시작하세요."];
    playerIds.forEach(id => {
      updates[`rooms/${roomCode}/hands/${id}`] = hands[id];
      updates[`rooms/${roomCode}/players/${id}/cardCount`] = hands[id].length;
    });
    await update(ref(db), updates);
  }

  // ── 카드 내기 ─────────────────────────────────────────────
  async function playCards(cards) {
    const game = roomData?.game;
    const pile = game?.pile ?? [];
    const v = validatePlay(cards, pile);
    if (!v.ok) return v;

    const playerId = uid;
    const playerNick = roomData?.players?.[uid]?.nickname;
    const newHand = myHand.filter(c => !cards.find(s => s.id === c.id));
    const newFinished = [...(game?.finished ?? [])];
    const newLog = [...(game?.log ?? []), `${playerNick}이(가) ${cards.length}장을 냈습니다`];

    if (newHand.length === 0 && !newFinished.includes(playerId)) {
      newFinished.push(playerId);
      newLog.push(`🎉 ${playerNick}이(가) 패를 다 냈습니다!`);
    }

    // 다음 플레이어 계산
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

    // 라운드 종료 체크
    const remaining = playerIds.filter(id => (allHands[id]?.length ?? 0) > 0);
    const isRoundOver = remaining.length <= 1;
    if (isRoundOver && remaining.length === 1) {
      newFinished.push(remaining[0]);
      newLog.push(`라운드 종료! 계급이 결정됩니다.`);
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

  // ── 패스 ─────────────────────────────────────────────────
  async function pass() {
    const game = roomData?.game;
    const playerIds = Object.keys(roomData?.players ?? {});
    const handSnap = await get(ref(db, `rooms/${roomCode}/hands`));
    const allHands = handSnap.val() || {};
    const activePlayers = playerIds.filter(id => (allHands[id]?.length ?? 0) > 0);
    const newPassCount = (game?.passCount ?? 0) + 1;
    const playerNick = roomData?.players?.[uid]?.nickname;
    const newLog = [...(game?.log ?? []), `${playerNick}이(가) 패스했습니다`];

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
      newLog.push(`모두 패스! ${roomData?.players?.[lastId]?.nickname}이(가) 새로 시작합니다`);
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

  // ── 세금: 바치기 ──────────────────────────────────────────
  async function tributeCards(result) {
    if (result.type === "revolution") {
      // 혁명: 세금 면제, 계급 유지, 다음 라운드로
      const updates = {};
      updates[`rooms/${roomCode}/game/revolution`] = true;
      updates[`rooms/${roomCode}/game/log`] = [
        ...(roomData?.game?.log ?? []),
        `🔥 ${roomData?.players?.[uid]?.nickname}이(가) 혁명을 선언했습니다!`
      ];
      updates[`rooms/${roomCode}/meta/status`] = "playing";
      // 다음 라운드 딜
      await update(ref(db), updates);
      await startGame();
      return;
    }

    // 일반 세금
    const { cards } = result;
    const myRole = roomData?.game?.ranks?.[uid];
    const receiverId = myRole === "great_slave"
      ? Object.keys(roomData?.game?.ranks ?? {}).find(id => roomData.game.ranks[id] === "dalmuti")
      : Object.keys(roomData?.game?.ranks ?? {}).find(id => roomData.game.ranks[id] === "prime");

    // 내 손패에서 제거
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

  // ── 세금: 돌려주기 ────────────────────────────────────────
  async function returnCards(cards) {
    const myRole = roomData?.game?.ranks?.[uid];
    const targetId = myRole === "dalmuti"
      ? Object.keys(roomData?.game?.ranks ?? {}).find(id => roomData.game.ranks[id] === "great_slave")
      : Object.keys(roomData?.game?.ranks ?? {}).find(id => roomData.game.ranks[id] === "slave");

    // 받은 세금 카드를 손패에 추가, 돌려줄 카드 제거
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

    // 모든 세금이 완료됐는지 체크
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
      // 세금 완료 → 게임 시작
      updates[`rooms/${roomCode}/meta/status`] = "playing";
      const playerIds = Object.keys(roomData?.players ?? {});
      // 달무티가 첫 번째 선
      const dalmutiId = Object.keys(ranks).find(id => ranks[id] === "dalmuti");
      updates[`rooms/${roomCode}/game/currentTurn`] = dalmutiId;
      updates[`rooms/${roomCode}/game/pile`] = [];
      updates[`rooms/${roomCode}/game/passCount`] = 0;
      updates[`rooms/${roomCode}/game/lastPlayerId`] = null;
      updates[`rooms/${roomCode}/game/finished`] = [];
      updates[`rooms/${roomCode}/game/log`] = ["세금 완료! 달무티부터 시작합니다."];
      updates[`rooms/${roomCode}/game/tributeDone`] = {};
      updates[`rooms/${roomCode}/game/returnDone`] = {};
      updates[`rooms/${roomCode}/game/tributeReceived`] = {};
    }

    await update(ref(db), updates);
  }

  // ── 다음 라운드 준비 ──────────────────────────────────────
  async function readyForNext() {
    const snap = await get(ref(db, `rooms/${roomCode}/game/readyForNext`));
    const readyList = snap.val() || [];
    if (readyList.includes(uid)) return;
    const newList = [...readyList, uid];
    const playerCount = Object.keys(roomData?.players ?? {}).length;

    const updates = {};
    updates[`rooms/${roomCode}/game/readyForNext`] = newList;

    if (newList.length >= playerCount) {
      // 모두 준비 → 세금 단계로
      const ranks = roomData?.game?.ranks ?? {};
      const hasDalmuti = Object.values(ranks).includes("dalmuti");
      const hasPrime = Object.values(ranks).includes("prime");
      if (hasDalmuti || hasPrime) {
        updates[`rooms/${roomCode}/meta/status`] = "tax";
        updates[`rooms/${roomCode}/game/tributeDone`] = {};
        updates[`rooms/${roomCode}/game/returnDone`] = {};
        updates[`rooms/${roomCode}/game/tributeReceived`] = {};
      } else {
        // 1라운드라 계급 없음 → 바로 딜
        await update(ref(db), updates);
        await startGame();
        return;
      }
    }
    await update(ref(db), updates);
  }

  // ── 파생 데이터 조립 ──────────────────────────────────────
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
//  10. 루트 앱
// ================================================================

// 앱 로드 시점 개발모드 (탭 5번으로 활성화)
const IS_DEV_MODE = false; // 아래 MainScreen에서 탭으로 활성화

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
          <div className="text-5xl animate-bounce mb-4">👑</div>
          <p className="text-white/50 text-sm animate-pulse">Firebase 연결 중...</p>
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
      <p className="text-white/30 text-sm">로딩 중...</p>
    </div>
  );
}
