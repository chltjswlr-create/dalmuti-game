
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
  const jokers = cards.filter((c) => c.joker);

  // 조커는 단독으로 낼 수 없음
  if (nonJoker.length === 0) return { ok: false, error: "조커는 단독으로 낼 수 없어요. 숫자 카드와 함께 내야 해요" };

  // 같은 숫자 카드만 가능
  if (nonJoker.length > 1 && new Set(nonJoker.map((c) => c.rank)).size > 1)
    return { ok: false, error: "같은 숫자 카드만 낼 수 있어요" };

  const myRank = nonJoker[0].rank;

  if (pile && pile.length > 0) {
    // 장수 체크
    if (cards.length !== pile.length)
      return { ok: false, error: `바닥과 같은 ${pile.length}장을 내야 해요` };

    // 바닥의 실제 숫자 계산 (바닥도 조커 포함일 수 있음)
    const pileNonJoker = pile.filter((c) => !c.joker);
    const pileRank = pileNonJoker[0]?.rank;

    // 바닥이 조커만이면 → 낼 수 없음 (조커만 있는 바닥은 있을 수 없지만 방어)
    if (!pileRank) return { ok: false, error: "바닥 카드를 확인할 수 없어요" };

    // 내 카드가 바닥보다 낮은(강한) 숫자여야 함
    if (myRank >= pileRank)
      return { ok: false, error: `${pileRank}번보다 낮은 숫자를 내야 해요` };
  }

  return { ok: true };
}

// 계급 배정 (5~10명 완전 지원)
function assignRanks(finishedOrder, totalPlayers) {
  const ranks = {};
  const last = finishedOrder.length - 1;
  finishedOrder.forEach((id, i) => {
    if (i === 0) ranks[id] = "dalmuti";
    else if (i === last) ranks[id] = "great_slave";
    else if (totalPlayers >= 6 && i === 1) ranks[id] = "prime";
    else if (totalPlayers >= 6 && i === last - 1) ranks[id] = "slave";
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

// ── 카드 색상 & SVG ─────────────────────────────────────────
const CARD_COLORS = {
  1:  { bg: "#b45309", text: "#fef3c7" },
  2:  { bg: "#7f1d1d", text: "#fecaca" },
  3:  { bg: "#881337", text: "#fce7f3" },
  4:  { bg: "#9a3412", text: "#ffedd5" },
  5:  { bg: "#713f12", text: "#fef9c3" },
  6:  { bg: "#14532d", text: "#dcfce7" },
  7:  { bg: "#064e3b", text: "#d1fae5" },
  8:  { bg: "#164e63", text: "#e0f2fe" },
  9:  { bg: "#1e3a5f", text: "#dbeafe" },
  10: { bg: "#312e81", text: "#e0e7ff" },
  11: { bg: "#4c1180", text: "#f5eeff" },
  12: { bg: "#2d1b4e", text: "#f0e6ff" },
};

const CARD_DATA = {
  1:  { name: "달무티",   emoji: "👑" },
  2:  { name: "대주교",   emoji: "✝" },
  3:  { name: "귀족",     emoji: "🏰" },
  4:  { name: "귀족부인", emoji: "👸" },
  5:  { name: "총리",     emoji: "🤵" },
  6:  { name: "점성술사", emoji: "🔮" },
  7:  { name: "기사",     emoji: "⚔" },
  8:  { name: "재봉사",   emoji: "🧵" },
  9:  { name: "농부",     emoji: "🌾" },
  10: { name: "요리사",   emoji: "🍳" },
  11: { name: "노예",     emoji: "🔗" },
  12: { name: "대노예",   emoji: "⛓" },
};

// ── 카드 ──────────────────────────────────────────────────────
function Card({ card, selected, onClick, disabled, size = "md" }) {
  const isJoker = card.joker;
  const small = size === "sm";
  const sz = small ? "w-10 h-14" : "w-12 h-[72px]";
  const col = isJoker ? { bg: "#4c1d95", text: "#f5d0fe" } : (CARD_COLORS[card.rank] ?? { bg: "#1a1a2e", text: "#e0e7ff" });
  const data = isJoker ? null : CARD_DATA[card.rank];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative ${sz} rounded-xl shadow-lg overflow-hidden select-none transition-all duration-150 flex flex-col
        ${selected ? "ring-2 ring-white scale-110 -translate-y-3 shadow-2xl" : "ring-0"}
        ${disabled ? "cursor-not-allowed opacity-90" : "hover:-translate-y-1 hover:shadow-xl cursor-pointer"}`}
      style={{ background: col.bg }}
    >
      {/* 상단 장식 */}
      <div className="absolute inset-0 opacity-20" style={{
        background: `radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.4) 0%, transparent 60%)`
      }}/>
      {/* 상단 숫자 */}
      {!isJoker && <span className="absolute top-1 left-1.5 text-[9px] font-black" style={{ color: col.text, opacity: 0.8 }}>{card.rank}</span>}
      {/* 중앙 이모지 */}
      <div className="flex-1 flex items-center justify-center">
        <span className={`${small ? "text-lg" : "text-2xl"} leading-none`} style={{ filter: "drop-shadow(0 0 4px rgba(255,255,255,0.8)) brightness(1.3)" }}>
          {isJoker ? "🃏" : data?.emoji}
        </span>
      </div>
      {/* 하단 직업명 */}
      {!small && (
        <div className="pb-0.5 text-center">
          <span className="text-[6px] font-bold" style={{ color: col.text, opacity: 0.85 }}>
            {isJoker ? "어릿광대" : data?.name}
          </span>
        </div>
      )}
      {/* 하단 숫자 (뒤집힘 없이 그대로) */}
      {!isJoker && <span className="absolute bottom-1 right-1.5 text-[9px] font-black" style={{ color: col.text, opacity: 0.8 }}>{card.rank}</span>}
      {selected && (
        <span className="absolute -top-1 -right-1 bg-white text-blue-600 rounded-full w-5 h-5 text-xs flex items-center justify-center font-bold shadow z-10">✓</span>
      )}
    </button>
  );
}


// ── 바닥 카드 ─────────────────────────────────────────────────
function Pile({ pile }) {
  if (!pile || pile.length === 0)
    return (
      <div className="flex items-center justify-center w-44 h-24 rounded-2xl border-2 border-dashed border-white/20 text-white/30 text-sm transition-all">
        바닥 비어있음
      </div>
    );
  const pileRank = pile.find(c => !c.joker)?.rank;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center justify-center gap-2 flex-wrap max-w-xs pile-appear">
        {pile.map((card) => (
          <Card key={card.id} card={card} disabled size="sm" />
        ))}
      </div>
      <div className="text-white/70 text-sm font-semibold slide-in">
        {pile.length}장 · {pileRank ? `${pileRank}번 ${CARD_DATA[pileRank]?.name ?? ""}` : "조커"}
      </div>
    </div>
  );
}

// ── 상대 플레이어 토큰 ────────────────────────────────────────
function PlayerToken({ player, isCurrentTurn }) {
  return (
    <div className={`flex flex-col items-center gap-1 px-2 py-2 rounded-xl transition-all duration-300 min-w-[64px]
      ${isCurrentTurn ? "bg-yellow-400/20 ring-2 ring-yellow-400 scale-105 turn-glow" : "bg-white/5"}`}>
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
  const [showHistory, setShowHistory] = useState(false);
  const [dalmutEffect, setDalmutEffect] = useState(null);
  const [flyAnim, setFlyAnim] = useState(null);
  const [autoClearEffect, setAutoClearEffect] = useState(null); // { winner: string }
  const { players, pile, currentTurn, round, log, ranks } = gs;
  const myHand = gs.myHand || [];
  const isMyTurn = currentTurn === myId;
  const self = players?.find(p => p.id === myId);
  const others = (players || []).filter(p => p.id !== myId);
  const prevLogLen = useRef(0);

  // 턴이 바뀔 때마다 선택 초기화
  useEffect(() => {
    setSelected([]);
  }, [currentTurn]);

  // 로그 감지: 효과음 + 카드 날아가는 애니메이션
  useEffect(() => {
    if (!log || !log.length) return;
    const newLogs = log.slice(prevLogLen.current);
    if (!newLogs.length) return;
    prevLogLen.current = log.length;

    // 새 로그들을 모두 체크 (독립적으로 각각 체크 - else if 제거)
    newLogs.forEach(latest => {
      if (!latest) return;

      if (latest.includes("✨ 1번 카드")) {
        const match = latest.match(/✨ 1번 카드! (.+?)이\(가\)/);
        const nickname = match?.[1] ?? "플레이어";
        setDalmutEffect({ nickname });
        setTimeout(() => setDalmutEffect(null), 3000);
        playSound('dalmuti');
      }

      if (latest.includes("🔄") && latest.includes("아무도 대응 못함")) {
        const match = latest.match(/→ (.+?)이\(가\) 새로 시작/);
        const winner = match?.[1] ?? "플레이어";
        // 카드 날아가는 애니메이션 이후에 표시 (별도 렌더링 사이클)
        setTimeout(() => {
          setAutoClearEffect({ winner, ts: Date.now() });
          setTimeout(() => setAutoClearEffect(null), 2800);
        }, 300);
      }

      if (latest.includes("을 냈습니다") || latest.includes("장을 냈습니다")) {
        const countMatch = latest.match(/(\d+)장을? 냈습니다/) ?? latest.match(/카드 (\d+)장/);
        const count = parseInt(countMatch?.[1] ?? 1);
        const isMyPlay = self?.nickname && latest.startsWith(self.nickname);
        setFlyAnim({ fromBottom: !!isMyPlay, count });
        setTimeout(() => setFlyAnim(null), 700);
        if (!latest.includes("1번 카드")) playSound('card');
      }

      if (latest.includes("패스했습니다")) playSound('pass');
      if (latest.includes("라운드 종료")) playSound('round_end');
      if (latest.includes("혁명을 선언")) playSound('revolution');
      if (latest.includes("세금 완료")) playSound('tax');
    });
  }, [log?.length]);

  // 배경음 루프
  const bgTimer = useRef(null);
  useEffect(() => {
    function playBg() {
      playSound('bg');
      bgTimer.current = setTimeout(playBg, 2700); // 12음 * 0.22s = 2.64s
    }
    const startTimer = setTimeout(playBg, 300);
    return () => { clearTimeout(startTimer); clearTimeout(bgTimer.current); };
  }, []);
  const audioCtx = useRef(null);
  function getAudioCtx() {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx.current;
  }

  function playSound(type) {
    try {
      const ctx = getAudioCtx();
      const now = ctx.currentTime;

      if (type === 'card') {
        // 카드 내기: 삭 내미는 소리 (swoosh)
        const bufferSize = ctx.sampleRate * 0.15;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
        }
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 1000;
        source.buffer = buffer;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        source.start(now);

      } else if (type === 'pass') {
        // 패스: 낮고 짧은 소리
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(250, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now); osc.stop(now + 0.2);

      } else if (type === 'dalmuti') {
        // 1번 카드 팡파레
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + i * 0.12);
          gain.gain.setValueAtTime(0.4, now + i * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);
          osc.start(now + i * 0.12);
          osc.stop(now + i * 0.12 + 0.3);
        });

      } else if (type === 'round_end') {
        // 라운드 종료
        const notes = [784, 659, 523];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(freq, now + i * 0.15);
          gain.gain.setValueAtTime(0.3, now + i * 0.15);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.3);
          osc.start(now + i * 0.15);
          osc.stop(now + i * 0.15 + 0.3);
        });

      } else if (type === 'tax') {
        // 세금 납부: 동전 소리 느낌
        [800, 1000, 800].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.08);
          gain.gain.setValueAtTime(0.25, now + i * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.1);
          osc.start(now + i * 0.08);
          osc.stop(now + i * 0.08 + 0.1);
        });

      } else if (type === 'revolution') {
        // 혁명: 강렬한 소리
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.5);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc.start(now); osc.stop(now + 0.6);

      } else if (type === 'bg') {
        // 배경음: 웅장한 왕궁 오케스트라 느낌
        // 주선율 (높음)
        const melody =  [523, 587, 659, 698, 784, 698, 659, 587, 523, 494, 523, 0];
        // 화음 (중간)
        const harmony = [392, 440, 494, 523, 587, 523, 494, 440, 392, 370, 392, 0];
        // 베이스 (낮음)
        const bass =    [261, 293, 329, 349, 392, 349, 329, 293, 261, 246, 261, 0];
        // 타악기 느낌 (드럼)
        const drums = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0];

        melody.forEach((freq, i) => {
          if (freq > 0) {
            // 주선율
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + i * 0.22);
            gain.gain.setValueAtTime(0, now + i * 0.22);
            gain.gain.linearRampToValueAtTime(0.1, now + i * 0.22 + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.25);
            osc.start(now + i * 0.22);
            osc.stop(now + i * 0.22 + 0.25);

            // 화음
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2); gain2.connect(ctx.destination);
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(harmony[i], now + i * 0.22);
            gain2.gain.setValueAtTime(0, now + i * 0.22);
            gain2.gain.linearRampToValueAtTime(0.07, now + i * 0.22 + 0.04);
            gain2.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.25);
            osc2.start(now + i * 0.22);
            osc2.stop(now + i * 0.22 + 0.25);

            // 베이스
            const osc3 = ctx.createOscillator();
            const gain3 = ctx.createGain();
            osc3.connect(gain3); gain3.connect(ctx.destination);
            osc3.type = 'sawtooth';
            osc3.frequency.setValueAtTime(bass[i], now + i * 0.22);
            gain3.gain.setValueAtTime(0, now + i * 0.22);
            gain3.gain.linearRampToValueAtTime(0.06, now + i * 0.22 + 0.02);
            gain3.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.2);
            osc3.start(now + i * 0.22);
            osc3.stop(now + i * 0.22 + 0.2);
          }

          // 타악기
          if (drums[i]) {
            const bufSize = ctx.sampleRate * 0.08;
            const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
            const d = buf.getChannelData(0);
            for (let j = 0; j < bufSize; j++) d[j] = (Math.random() * 2 - 1) * Math.pow(1 - j/bufSize, 3);
            const src = ctx.createBufferSource();
            const g = ctx.createGain();
            src.buffer = buf;
            src.connect(g); g.connect(ctx.destination);
            g.gain.setValueAtTime(0.15, now + i * 0.22);
            g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.08);
            src.start(now + i * 0.22);
          }
        });
      }
    } catch(e) { /* 오디오 지원 안 하는 환경 무시 */ }
  }

  function toggle(card) {
    setSelected(prev =>
      prev.find(c => c.id === card.id) ? prev.filter(c => c.id !== card.id) : [...prev, card]
    );
  }

  async function handlePlay() {
    const cards = selected;
    const r = await onPlay(cards);
    if (r?.ok) {
      setSelected([]);
      const nj = cards.filter(c => !c.joker);
      if (nj[0]?.rank === 1) {
        playSound('dalmuti');
      } else {
        playSound('card');
      }
    }
  }

  async function handlePass() {
    playSound('pass');
    await onPass();
    setSelected([]);
  }

  const validMsg = (() => {
    if (selected.length === 0) return null;
    const nj = selected.filter(c => !c.joker);
    // 조커만 단독으로 낼 수 없음
    if (nj.length === 0) return "조커는 단독으로 낼 수 없어요";
    if (nj.length > 1 && new Set(nj.map(c => c.rank)).size > 1) return "같은 숫자 카드만 낼 수 있어요";
    if (pile && pile.length > 0) {
      if (selected.length !== pile.length) return `바닥과 같은 ${pile.length}장을 내야 해요`;
      const myRank = nj[0]?.rank;
      const pileNonJoker = pile.filter(c => !c.joker);
      const pileRank = pileNonJoker[0]?.rank;
      if (!pileRank) return "바닥 카드를 확인할 수 없어요";
      if (myRank >= pileRank) return `${pileRank}번보다 낮은 숫자를 내야 해요`;
    }
    return null;
  })();

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-green-900 to-teal-950 flex flex-col">
      <style>{`
        @keyframes flyUp {
          0%   { transform: translateY(0) scale(1) rotate(0deg); opacity: 1; filter: brightness(1.2); }
          30%  { transform: translateY(-15vh) scale(0.85) rotate(-3deg); opacity: 1; }
          70%  { transform: translateY(-32vh) scale(0.5) rotate(-6deg); opacity: 0.6; }
          100% { transform: translateY(-40vh) scale(0.15) rotate(-10deg); opacity: 0; }
        }
        @keyframes flyRight {
          0%   { transform: translateX(-60px) scale(0.4) rotate(-8deg); opacity: 0; }
          40%  { transform: translateX(20px) scale(0.8) rotate(-2deg); opacity: 0.9; }
          70%  { transform: translateX(60px) scale(1) rotate(1deg); opacity: 1; }
          100% { transform: translateX(100px) scale(0.8) rotate(3deg); opacity: 0; }
        }
        @keyframes pileAppear {
          0%   { transform: scale(0.5) rotate(-8deg); opacity: 0; }
          60%  { transform: scale(1.1) rotate(2deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes turnGlow {
          0%, 100% { box-shadow: 0 0 8px rgba(234,179,8,0.4); }
          50%       { box-shadow: 0 0 24px rgba(234,179,8,0.9); }
        }
        @keyframes slideInUp {
          0%   { transform: translateY(20px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes popIn {
          0%   { transform: scale(0.7); opacity: 0; }
          70%  { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .fly-up    { animation: flyUp   0.5s cubic-bezier(0.4,0,1,1) forwards; }
        .fly-right { animation: flyRight 0.55s cubic-bezier(0,0,0.6,1) forwards; }
        .pile-appear { animation: pileAppear 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards; }
        .turn-glow { animation: turnGlow 1.5s ease-in-out infinite; }
        .slide-in  { animation: slideInUp 0.3s ease-out forwards; }
        .pop-in    { animation: popIn 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards; }
        @keyframes handGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(250,204,21,0), inset 0 0 0 0 rgba(250,204,21,0); border-color: rgba(250,204,21,0.2); }
          50% { box-shadow: 0 0 40px 4px rgba(250,204,21,0.3), inset 0 0 20px 0 rgba(250,204,21,0.1); border-color: rgba(250,204,21,0.8); }
        }
        @keyframes bannerPulse {
          0%, 100% { transform: scale(1); background: #eab308; }
          50% { transform: scale(1.08); background: #fbbf24; box-shadow: 0 0 20px rgba(250,204,21,0.8); }
        }
        .hand-glow { animation: handGlow 1.2s ease-in-out infinite; border: 2px solid rgba(250,204,21,0.2); border-radius: 16px; }
        .banner-pulse { animation: bannerPulse 0.9s ease-in-out infinite; }
      `}</style>

      {/* 카드 날아가는 애니메이션 */}
      {flyAnim && (
        <div className={`fixed z-40 pointer-events-none flex gap-1.5 ${
          flyAnim.fromBottom
            ? 'bottom-36 left-1/2 -translate-x-1/2 fly-up'
            : 'left-28 top-1/2 -translate-y-1/2 fly-right'
        }`}>
          {Array.from({ length: Math.min(flyAnim.count, 5) }).map((_, i) => (
            <div key={i} className="w-10 h-14 rounded-lg shadow-2xl"
              style={{
                background: flyAnim.fromBottom
                  ? `linear-gradient(135deg, #10b981, #059669)`
                  : `linear-gradient(135deg, #6366f1, #4f46e5)`,
                border: '1px solid rgba(255,255,255,0.4)',
                transform: `rotate(${(i - (flyAnim.count-1)/2) * 5}deg)`,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }} />
          ))}
        </div>
      )}

      {/* 자동 패스 알림 - 최상위 레이어 */}
      {autoClearEffect && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
          <div className="text-center pop-in">
            <div className="text-5xl mb-2">🔄</div>
            <div className="bg-blue-500/95 text-white font-black text-base px-6 py-3 rounded-2xl shadow-2xl border border-blue-300/30">
              아무도 대응하지 못했습니다!
            </div>
            <div className="text-white font-bold text-sm mt-2 drop-shadow-lg bg-black/50 px-4 py-1.5 rounded-xl">
              ▶ {autoClearEffect.winner}이(가) 새로 시작
            </div>
          </div>
        </div>
      )}
      {dalmutEffect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="text-center animate-bounce">
            <div className="text-8xl mb-2">👑</div>
            <div className="bg-yellow-400/90 text-yellow-900 font-black text-2xl px-6 py-3 rounded-2xl shadow-2xl">
              {dalmutEffect.nickname}
            </div>
            <div className="text-white font-bold text-lg mt-2 drop-shadow-lg">
              달무티 카드 등장!
            </div>
            <div className="text-6xl mt-2">✨🎊✨</div>
          </div>
          {/* 파티클 효과 */}
          {["👑","🎊","✨","🌟","💫"].map((emoji, i) => (
            <div key={i} className="absolute text-3xl animate-ping"
              style={{
                top: `${10 + i * 18}%`,
                left: `${5 + i * 20}%`,
                animationDelay: `${i * 0.2}s`,
                animationDuration: '1s'
              }}>
              {emoji}
            </div>
          ))}
        </div>
      )}
      {/* 히스토리 팝업 */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white text-xl font-bold">📋 게임 히스토리</h2>
              <button onClick={() => setShowHistory(false)} className="text-white/40 hover:text-white text-2xl">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-1">
              {(log || []).slice().reverse().map((l, i) => (
                <div key={i} className={`text-sm px-3 py-2 rounded-xl ${
                  l.includes("🎉") ? "bg-yellow-500/20 text-yellow-300" :
                  l.includes("패스") ? "bg-white/5 text-white/40" :
                  l.includes("✨") || l.includes("모두 패스") ? "bg-emerald-500/20 text-emerald-300" :
                  l.includes("라운드") ? "bg-blue-500/20 text-blue-300" :
                  "bg-white/5 text-white/70"
                }`}>{l}</div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* HUD */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/40 backdrop-blur border-b border-white/5">
        <span className="text-white/60 text-sm">라운드 <span className="text-white font-bold">{round}</span></span>
        <span className="text-white font-black tracking-widest text-lg">달무티</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowHistory(true)} className="text-white/50 hover:text-white text-xs border border-white/20 px-2 py-1 rounded-lg transition-all">📋</button>
          <span className={`text-xs font-bold px-3 py-1 rounded-full transition-all
            ${isMyTurn ? "text-yellow-900 banner-pulse" : "bg-white/10 text-white/50"}`}
            style={isMyTurn ? { background: '#eab308' } : {}}>
            {isMyTurn ? "⚡ 내 차례!" : "대기 중"}
          </span>
        </div>
      </div>

      {/* 메인 게임 영역 - 고정 높이로 레이아웃 보호 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* 왼쪽: 플레이어 목록 - 고정 너비, 독립 스크롤 */}
        <div className="w-28 flex-shrink-0 flex flex-col gap-1 px-1.5 py-2 bg-black/20 border-r border-white/5 overflow-y-auto">
          {(() => {
            const RANK_EMOJI_MAP = {"dalmuti":"👑","prime":"🤵","peasant":"👨","slave":"🔗","great_slave":"⛓️"};
            const allPlayers = [
              { ...self, id: 'me', isSelf: true, cardCount: myHand.length },
              ...others
            ].filter(Boolean);

            const groups = {};
            allPlayers.forEach(p => {
              const key = p.rank ?? 'none';
              if (!groups[key]) groups[key] = [];
              groups[key].push(p);
            });

            const RANK_ORDER = ['dalmuti','prime','peasant','slave','great_slave','none'];

            return RANK_ORDER.filter(k => groups[k]?.length).map(key => {
              const rankPlayers = groups[key];
              const rankLabel = key !== 'none' ? RANK_LABEL[key] : null;
              const rankEmoji = RANK_EMOJI_MAP[key] ?? '👤';

              return (
                <div key={key} className="mb-1 flex-shrink-0">
                  {rankLabel && (
                    <div className="text-[8px] text-white/30 px-1 mb-0.5">{rankEmoji} {rankLabel.replace(/^[^ ]+ /,'')}</div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {rankPlayers.map(p => {
                      const isActive = p.isSelf ? isMyTurn : currentTurn === p.id;
                      return (
                        <div key={p.id ?? 'me'} className={`flex flex-col items-center px-1 py-1.5 rounded-lg transition-all flex-1 min-w-[44px]
                          ${isActive ? 'bg-yellow-400/20 ring-1 ring-yellow-400 turn-glow' : 'bg-white/5'}`}>
                          <span className="text-base leading-none">
                            {key !== 'none' ? rankEmoji : (p.isSelf ? '🙋' : '👤')}
                          </span>
                          <span className="text-white text-[9px] font-bold truncate w-full text-center mt-0.5">
                            {p.isSelf ? (p.nickname ?? '나') : p.nickname}
                          </span>
                          <span className="text-white/40 text-[8px]">🃏{p.cardCount ?? 0}</span>
                          {isActive && <span className="text-[8px] text-yellow-400 animate-pulse font-bold">▶</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {/* 중앙: 바닥 + 로그 - flex-1로 나머지 공간 차지, 내부 스크롤 */}
        <div className="flex-1 min-w-0 flex flex-col gap-2 px-3 py-2 overflow-hidden">
          <div className="bg-black/25 backdrop-blur rounded-2xl px-4 py-3 flex flex-col items-center gap-2 shadow-xl border border-white/5 flex-shrink-0">
            <p className="text-white/30 text-[9px] uppercase tracking-widest">바닥 카드</p>
            <Pile pile={pile} />
            {gs.lastPlayerNick && pile?.length > 0 && (
              <p className="text-white/30 text-[10px]">마지막: {gs.lastPlayerNick}</p>
            )}
          </div>

          {/* 로그 - 고정 높이, 내부 스크롤 */}
          <div className="w-full bg-black/20 rounded-xl px-3 py-2 overflow-y-auto flex-shrink-0" style={{ maxHeight: '96px' }}>
            {(log || []).slice(-8).reverse().map((l, i) => (
              <p key={i} className={`text-[10px] leading-relaxed
                ${i === 0 ? "text-white/70 font-medium" :
                  i === 1 ? "text-white/45" : "text-white/20"}`}>{l}</p>
            ))}
          </div>
        </div>
      </div>

      {/* 내 손패 */}
      <div className={`bg-black/50 backdrop-blur border-t px-4 py-4 transition-all duration-300 ${isMyTurn ? 'hand-glow border-yellow-400/30' : 'border-white/10'}`}>
        {self?.rank && (
          <div className={`inline-flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full bg-gradient-to-r ${RANK_COLOR[self.rank]} text-white mb-2`}>
            {RANK_LABEL[self.rank]}
          </div>
        )}
        {isMyTurn && (
          <div className="text-center text-yellow-400 text-xs font-bold mb-2 animate-pulse">
            ⚡ 카드를 선택하고 내세요!
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
            className={`px-6 py-2 font-bold rounded-xl shadow-lg transition-all active:scale-95
              ${isMyTurn && selected.length > 0 && !validMsg
                ? 'bg-emerald-500 hover:bg-emerald-400 text-white ring-2 ring-emerald-300/50'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}>
            카드 내기 ({selected.length})
          </button>
          <button onClick={handlePass}
            disabled={!isMyTurn || !pile || pile.length === 0}
            className={`px-6 py-2 font-semibold rounded-xl shadow-lg transition-all active:scale-95
              ${isMyTurn && pile?.length > 0
                ? 'bg-slate-500 hover:bg-slate-400 text-white'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}>
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
  const bgTimerRef = useRef(null);
  const audioRef = useRef(null);
  const bgStarted = useRef(false);

  function startBgMusic() {
    if (bgStarted.current) return;
    bgStarted.current = true;
    function getCtx() {
      if (!audioRef.current) audioRef.current = new (window.AudioContext || window.webkitAudioContext)();
      return audioRef.current;
    }
    function playBg() {
      try {
        const ctx = getCtx();
        const now = ctx.currentTime;
        const melody  = [523, 587, 659, 698, 784, 698, 659, 587, 523, 494, 523, 0];
        const harmony = [392, 440, 494, 523, 587, 523, 494, 440, 392, 370, 392, 0];
        const bass    = [261, 293, 329, 349, 392, 349, 329, 293, 261, 246, 261, 0];
        melody.forEach((freq, i) => {
          if (freq > 0) {
            [[freq, 0.08, 'triangle'], [harmony[i], 0.05, 'sine'], [bass[i], 0.05, 'sawtooth']].forEach(([f, vol, type]) => {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain); gain.connect(ctx.destination);
              osc.type = type;
              osc.frequency.setValueAtTime(f, now + i * 0.22);
              gain.gain.setValueAtTime(0, now + i * 0.22);
              gain.gain.linearRampToValueAtTime(vol, now + i * 0.22 + 0.04);
              gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.25);
              osc.start(now + i * 0.22);
              osc.stop(now + i * 0.22 + 0.25);
            });
          }
        });
      } catch(e) {}
      bgTimerRef.current = setTimeout(playBg, 2700);
    }
    playBg();
  }

  useEffect(() => {
    return () => clearTimeout(bgTimerRef.current);
  }, []);

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
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-900 flex flex-col items-center justify-center p-6" onClick={startBgMusic}>
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
        <input value={nickname} onChange={e => { setNickname(e.target.value); setError(""); startBgMusic(); }}
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
        const recv = data.game?.tributeReceived || {};
        setTributeReceived(recv);
        const myRole = data.game?.ranks?.[uid];
        const tributeDone = data.game?.tributeDone || {};
        const returnDone = data.game?.returnDone || {};
        if ((myRole === "great_slave" || myRole === "slave") && !tributeDone[uid])
          setTaxPhase("tribute");
        else if ((myRole === "dalmuti" || myRole === "prime") && tributeDone[uid] && !returnDone[uid])
          setTaxPhase("return_pick");
        else
          setTaxPhase("waiting");

        // ── 봇 세금 자동 처리 ──────────────────────────────────
        const botIds = data.game?.botIds ?? [];
        const ranks = data.game?.ranks ?? {};
        if (botIds.length > 0) {
          // 봇 중 세금 내야 하는 봇 처리
          botIds.forEach(async botId => {
            const botRole = ranks[botId];
            if (!botRole) return;

            if ((botRole === "great_slave" || botRole === "slave") && !tributeDone[botId]) {
              // 봇 손패에서 가장 좋은 카드 바치기
              const botHandSnap = await get(ref(db, `rooms/${roomCode}/hands/${botId}`));
              const botHand = botHandSnap.val() || [];
              const sorted = [...botHand].sort((a, b) => (a.rank || 0) - (b.rank || 0));
              const count = botRole === "great_slave" ? 2 : 1;
              const tribute = sorted.slice(0, count);
              if (tribute.length < count) return;

              const receiverId = botRole === "great_slave"
                ? Object.keys(ranks).find(id => ranks[id] === "dalmuti")
                : Object.keys(ranks).find(id => ranks[id] === "prime");
              if (!receiverId) return;

              const newBotHand = botHand.filter(c => !tribute.find(t => t.id === c.id));
              const existing = data.game?.tributeReceived?.[receiverId] ?? [];
              const updates = {};
              updates[`rooms/${roomCode}/hands/${botId}`] = newBotHand;
              updates[`rooms/${roomCode}/players/${botId}/cardCount`] = newBotHand.length;
              updates[`rooms/${roomCode}/game/tributeDone/${botId}`] = true;
              updates[`rooms/${roomCode}/game/tributeReceived/${receiverId}`] = [...existing, ...tribute];
              await update(ref(db), updates);
            }

            if ((botRole === "dalmuti" || botRole === "prime") && tributeDone[botId] && !returnDone[botId]) {
              // 봇이 달무티/총리면 가장 나쁜 카드 돌려주기
              const botHandSnap = await get(ref(db, `rooms/${roomCode}/hands/${botId}`));
              const botHand = botHandSnap.val() || [];
              const received = data.game?.tributeReceived?.[botId] ?? [];
              const count = botRole === "dalmuti" ? 2 : 1;
              // 받은 카드 제외하고 가장 약한 카드 선택
              const handWithReceived = [...botHand, ...received];
              const sorted = [...handWithReceived].sort((a, b) => (b.rank || 0) - (a.rank || 0));
              const returnCards = sorted.slice(0, count);

              const targetId = botRole === "dalmuti"
                ? Object.keys(ranks).find(id => ranks[id] === "great_slave")
                : Object.keys(ranks).find(id => ranks[id] === "slave");
              if (!targetId) return;

              const targetHandSnap = await get(ref(db, `rooms/${roomCode}/hands/${targetId}`));
              const targetHand = targetHandSnap.val() || [];
              const newBotHand = [...handWithReceived.filter(c => !returnCards.find(r => r.id === c.id))].sort((a, b) => (a.rank || 0) - (b.rank || 0));
              const newTargetHand = [...targetHand.filter(c => !received.find(r => r.id === c.id)), ...returnCards].sort((a, b) => (a.rank || 0) - (b.rank || 0));

              const updates = {};
              updates[`rooms/${roomCode}/hands/${botId}`] = newBotHand;
              updates[`rooms/${roomCode}/players/${botId}/cardCount`] = newBotHand.length;
              updates[`rooms/${roomCode}/hands/${targetId}`] = newTargetHand;
              updates[`rooms/${roomCode}/players/${targetId}/cardCount`] = newTargetHand.length;
              updates[`rooms/${roomCode}/game/returnDone/${botId}`] = true;

              // 모든 세금 완료 체크
              const newReturnDone = { ...returnDone, [botId]: true };
              const requiredReturns = [
                Object.values(ranks).includes("dalmuti") && Object.keys(ranks).find(id => ranks[id] === "dalmuti"),
                Object.values(ranks).includes("prime") && Object.keys(ranks).find(id => ranks[id] === "prime")
              ].filter(Boolean);
              const allDone = requiredReturns.every(id => newReturnDone[id]);

              if (allDone) {
                const dalmutiId = Object.keys(ranks).find(id => ranks[id] === "dalmuti");
                updates[`rooms/${roomCode}/meta/status`] = "playing";
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
          });
        }
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

  // ── 연결 상태 감지 + 나갔을 때 자동 처리 ──────────────────
  useEffect(() => {
    if (!roomCode || !uid) return;
    const connRef = ref(db, '.info/connected');
    const playerConnRef = ref(db, `rooms/${roomCode}/players/${uid}/isConnected`);

    const unsub = onValue(connRef, snap => {
      if (snap.val() === true) {
        // 연결됐을 때: isConnected = true, 끊기면 false로
        update(ref(db, `rooms/${roomCode}/players/${uid}`), { isConnected: true });
        // onDisconnect: 연결 끊기면 자동으로 false 설정
        import('firebase/database').then(({ onDisconnect }) => {
          onDisconnect(playerConnRef).set(false);
        }).catch(() => {
          // fallback
          set(playerConnRef, false);
        });
      }
    });
    return () => off(connRef);
  }, [roomCode, uid]);

  // ── 나간 유저 감지 → result 화면에서 자동 ready 처리 ──────
  useEffect(() => {
    if (!roomCode || !roomData) return;
    if (roomData.meta?.status !== "result") return;

    const players = roomData.players ?? {};
    const readyList = roomData.game?.readyForNext ?? [];
    const allPlayerIds = Object.keys(players);

    // 연결 끊긴 플레이어 자동 ready 처리
    const disconnected = allPlayerIds.filter(id =>
      id !== uid &&
      players[id]?.isConnected === false &&
      !readyList.includes(id)
    );

    if (disconnected.length > 0) {
      const newReadyList = [...new Set([...readyList, ...disconnected])];
      const playerCount = allPlayerIds.length;

      const updates = {};
      updates[`rooms/${roomCode}/game/readyForNext`] = newReadyList;

      if (newReadyList.length >= playerCount) {
        const ranks = roomData.game?.ranks ?? {};
        const hasTax = Object.values(ranks).includes("dalmuti") || Object.values(ranks).includes("prime");
        if (hasTax) {
          updates[`rooms/${roomCode}/meta/status`] = "tax";
          updates[`rooms/${roomCode}/game/tributeDone`] = {};
          updates[`rooms/${roomCode}/game/returnDone`] = {};
          updates[`rooms/${roomCode}/game/tributeReceived`] = {};
        }
        update(ref(db), updates).then(() => {
          if (!hasTax) startGame();
        });
      } else {
        update(ref(db), updates);
      }
    }
  }, [roomData?.game?.readyForNext, roomData?.players, roomData?.meta?.status]);

  // ── 개발 모드 체크 (?dev=true) ────────────────────────────
  // (App 컴포넌트 최상단에서 처리하므로 여기선 제거)

  // ── 봇 AI: 봇 차례일 때 자동 플레이 ──────────────────────
  const botLock = useRef(''); // 현재 처리 중인 turnKey
  useEffect(() => {
    if (!roomData || !roomCode) return;
    const game = roomData.game;
    if (!game?.isTestMode || !game?.botIds) return;
    if (roomData.meta?.status !== "playing") return;

    const currentTurn = game.currentTurn;
    const botIds = game.botIds;
    if (!botIds.includes(currentTurn)) return;

    // 같은 턴+상황을 중복 처리하지 않음
    // pile이 비어있고 currentTurn이 같아도 logHash로 구분 (아무도 못 낸 후 재선 상황)
    const logHash = (game.log ?? []).length;
    const turnKey = `${currentTurn}-${game.passCount ?? 0}-${(game.pile ?? []).length}-${logHash}`;
    if (botLock.current === turnKey) return;
    botLock.current = turnKey;

    const delay = 1000 + Math.random() * 800;
    const timer = setTimeout(async () => {
      // Firebase에서 최신 currentTurn 확인 (딜레이 중 변경됐을 수 있음)
      const freshSnap = await get(ref(db, `rooms/${roomCode}/game/currentTurn`));
      if (freshSnap.val() !== currentTurn) {
        botLock.current = false;
        return;
      }
      // 봇 손패 가져오기
      const handSnap = await get(ref(db, `rooms/${roomCode}/hands/${currentTurn}`));
      const botHand = handSnap.val() || [];
      if (!botHand.length) {
        // 패가 없는 봇이 currentTurn이 됐다면 다음 활성 플레이어로 넘기기
        const allHandsSnap = await get(ref(db, `rooms/${roomCode}/hands`));
        const allHands = allHandsSnap.val() || {};
        const activePlayers = playerIds.filter(id => (allHands[id]?.length ?? 0) > 0);
        if (activePlayers.length > 0) {
          const idx = playerIds.indexOf(currentTurn);
          let nextId = playerIds[(idx + 1) % playerIds.length];
          let tries = 0;
          while ((allHands[nextId]?.length ?? 0) === 0 && tries < playerIds.length) {
            nextId = playerIds[(playerIds.indexOf(nextId) + 1) % playerIds.length];
            tries++;
          }
          if ((allHands[nextId]?.length ?? 0) > 0) {
            await update(ref(db), { [`rooms/${roomCode}/game/currentTurn`]: nextId });
          }
        }
        botLock.current = false;
        return;
      }

      const pile = game.pile ?? [];
      const playerIds = Object.keys(roomData.players ?? {});

      // 낼 수 있는 카드 찾기
      function findBestPlay(hand, pile) {
        const nonJokerHand = hand.filter(c => !c.joker);
        const jokers = hand.filter(c => c.joker);

        // 숫자별 그룹화
        const groups = {};
        nonJokerHand.forEach(c => {
          if (!groups[c.rank]) groups[c.rank] = [];
          groups[c.rank].push(c);
        });

        if (!pile.length) {
          // 바닥이 비어있으면 가장 약한(높은 숫자) 카드부터 냄 (원래 전략)
          const sorted = Object.entries(groups).sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
          return sorted[0]?.[1] || null;
        }

        const pileCount = pile.length;
        const pileNonJoker = pile.filter(c => !c.joker);
        const pileRank = pileNonJoker[0]?.rank;
        if (!pileRank) return null;

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
          // 조커만으로는 낼 수 없으므로 제거
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
          let lastId = game.lastPlayerId;
          // lastPlayerId가 패가 없으면 다음 활성 플레이어로
          if (!lastId || (allHands[lastId]?.length ?? 0) === 0) {
            lastId = activePlayers.find(id => id !== currentTurn) ?? activePlayers[0];
          }
          newLog.push(`모두 패스! ${roomData.players?.[lastId]?.nickname}이(가) 새로 시작합니다`);
          updates[`rooms/${roomCode}/game/pile`] = [];
          updates[`rooms/${roomCode}/game/passCount`] = 0;
          updates[`rooms/${roomCode}/game/currentTurn`] = lastId;
          updates[`rooms/${roomCode}/game/lastPlayerId`] = null;
        } else {
          updates[`rooms/${roomCode}/game/passCount`] = newPassCount;
          updates[`rooms/${roomCode}/game/currentTurn`] = nextId;
        }
        updates[`rooms/${roomCode}/game/log`] = newLog.slice(-30);
        await update(ref(db), updates);
      } else {
        // 카드 내기
        const newBotHand = botHand.filter(c => !cardsToPlay.find(s => s.id === c.id));
        const allHandsSnap = await get(ref(db, `rooms/${roomCode}/hands`));
        const allHands = { ...(allHandsSnap.val() || {}), [currentTurn]: newBotHand };
        const botNick = roomData.players?.[currentTurn]?.nickname;
        const newFinished = [...(game.finished ?? [])];
        const nonJokerBot = cardsToPlay.filter(c => !c.joker);
        const botCardDesc = nonJokerBot.length > 0 ? `${nonJokerBot[0].rank}번 카드 ${cardsToPlay.length}장` : `조커 ${cardsToPlay.length}장`;
        const newLog = [...(game.log ?? []), `${botNick}이(가) ${botCardDesc}을 냈습니다`];

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

        // 1번 카드면 즉시 바닥 초기화
        const botPlayedRankOne = nonJokerBot.length > 0 && nonJokerBot[0].rank === 1;

        // allHands에 봇의 새 손패 반영 (nextId 계산에 활용)
        allHands[currentTurn] = newBotHand;

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
        updates[`rooms/${roomCode}/game/finished`] = newFinished;

        if (isOver) {
          const ranks = assignRanks(newFinished, playerIds.length);
          updates[`rooms/${roomCode}/game/ranks`] = ranks;
          updates[`rooms/${roomCode}/meta/status`] = "result";
          updates[`rooms/${roomCode}/game/readyForNext`] = [];
          updates[`rooms/${roomCode}/game/pile`] = cardsToPlay;
          updates[`rooms/${roomCode}/game/lastPlayerId`] = currentTurn;
          newFinished.forEach(id => { updates[`rooms/${roomCode}/players/${id}/rank`] = ranks[id]; });
        } else if (botPlayedRankOne) {
          newLog.push(`✨ 1번 카드! ${botNick}이(가) 새로 시작합니다`);
          updates[`rooms/${roomCode}/game/pile`] = [];
          updates[`rooms/${roomCode}/game/passCount`] = 0;
          updates[`rooms/${roomCode}/game/lastPlayerId`] = null;
          if (newBotHand.length > 0) {
            updates[`rooms/${roomCode}/game/currentTurn`] = currentTurn;
          } else {
            updates[`rooms/${roomCode}/game/currentTurn`] = nextId;
          }
        } else {
          // 자동 패스 체크: 남은 플레이어 중 아무도 못 내면 바닥 초기화
          const botCardRank = nonJokerBot[0]?.rank;
          const pileCountNeeded = cardsToPlay.length;
          const remainingActive = remaining.filter(id => id !== currentTurn);

          function canPlayerPlay(hand) {
            const nj = hand.filter(c => !c.joker);
            const jk = hand.filter(c => c.joker).length;
            const grps = {};
            nj.forEach(c => {
              if (!grps[c.rank]) grps[c.rank] = [];
              grps[c.rank].push(c);
            });
            return Object.entries(grps).some(([r, arr]) =>
              parseInt(r) < botCardRank &&
              (arr.length >= pileCountNeeded || arr.length + jk >= pileCountNeeded)
            );
          }

          const canAnyone = botCardRank && remainingActive.some(id =>
            canPlayerPlay(allHands[id] || [])
          );

          // 낸 봇 포함 전체 남은 활성 플레이어
          const allRemaining = playerIds.filter(id => (allHands[id]?.length ?? 0) > 0);

          if (!canAnyone && remainingActive.length > 0 && botCardRank) {
            // 2초 딜레이 후 선 넘기기 (애니메이션 볼 시간)
            const leaderKey = turnKey; // 현재 turnKey 캡처
            setTimeout(async () => {
              // 딜레이 중 상황이 바뀌었으면 취소
              const checkSnap = await get(ref(db, `rooms/${roomCode}/game/currentTurn`));
              if (checkSnap.val() !== currentTurn) return;

              let newLeader;
              if (newBotHand.length > 0) {
                newLeader = currentTurn;
              } else {
                const activeOthers = allRemaining.filter(id => id !== currentTurn);
                const curIdx = playerIds.indexOf(currentTurn);
                newLeader = null;
                for (let i = 1; i <= playerIds.length; i++) {
                  const candidate = playerIds[(curIdx + i) % playerIds.length];
                  if (activeOthers.includes(candidate)) { newLeader = candidate; break; }
                }
                newLeader = newLeader ?? activeOthers[0] ?? nextId;
              }
              const leaderNick = roomData.players?.[newLeader]?.nickname ?? "다음 플레이어";
              const delayedLog = [...newLog, `🔄 ${botNick}이(가) 낸 ${botCardDesc}에 아무도 대응 못함! → ${leaderNick}이(가) 새로 시작`];
              const delayedUpdates = {
                [`rooms/${roomCode}/game/pile`]: [],
                [`rooms/${roomCode}/game/passCount`]: 0,
                [`rooms/${roomCode}/game/lastPlayerId`]: null,
                [`rooms/${roomCode}/game/currentTurn`]: newLeader,
                [`rooms/${roomCode}/game/log`]: delayedLog.slice(-30),
              };
              await update(ref(db), delayedUpdates);
              botLock.current = '';
            }, 2000);
            // 일단 카드는 바닥에 올려놓기
            updates[`rooms/${roomCode}/game/pile`] = cardsToPlay;
            updates[`rooms/${roomCode}/game/lastPlayerId`] = currentTurn;
            updates[`rooms/${roomCode}/game/passCount`] = 0;
            updates[`rooms/${roomCode}/game/log`] = newLog.slice(-30);
            await update(ref(db), updates);
            return; // 딜레이 setTimeout에서 처리하므로 여기서 종료
          } else {
            updates[`rooms/${roomCode}/game/pile`] = cardsToPlay;
            updates[`rooms/${roomCode}/game/lastPlayerId`] = currentTurn;
            updates[`rooms/${roomCode}/game/passCount`] = 0;
            // nextId가 패 없으면 다음 활성 플레이어
            updates[`rooms/${roomCode}/game/currentTurn`] = (allHands[nextId]?.length ?? 0) > 0 ? nextId : (allRemaining.find(id => id !== currentTurn) ?? nextId);
          }
        }
        // 로그는 모든 newLog.push 완료 후 마지막에 저장
        updates[`rooms/${roomCode}/game/log`] = newLog.slice(-30);
        await update(ref(db), updates);
        botLock.current = ''; // 락 해제
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [roomData?.game?.currentTurn, roomData?.game?.passCount, roomData?.game?.pile?.length, roomData?.game?.log?.length, roomCode]);

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

    // 상세 로그
    const nonJoker = cards.filter(c => !c.joker);
    const cardRank = nonJoker[0]?.rank;
    const cardDesc = cards.every(c => c.joker) ? `조커 ${cards.length}장` : `${cardRank}번 카드 ${cards.length}장`;
    const newLog = [...(game?.log ?? []), `${playerNick}이(가) ${cardDesc}을 냈습니다`];

    if (newHand.length === 0 && !newFinished.includes(playerId)) {
      newFinished.push(playerId);
      newLog.push(`🎉 ${playerNick}이(가) 패를 다 냈습니다!`);
    }

    // 다음 플레이어 계산 (패가 없는 사람 건너뜀)
    const playerIds = Object.keys(roomData?.players ?? {});
    const handSnap = await get(ref(db, `rooms/${roomCode}/hands`));
    const allHands = handSnap.val() || {};
    allHands[playerId] = newHand;

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
    updates[`rooms/${roomCode}/game/finished`] = newFinished;

    // 1번 카드(달무티) 내면 즉시 바닥 초기화, 본인이 새 선
    const playedRankOne = nonJoker.length > 0 && nonJoker[0].rank === 1;

    if (playedRankOne && !isRoundOver) {
      newLog.push(`✨ 1번 카드! ${playerNick}이(가) 새로 시작합니다`);
      updates[`rooms/${roomCode}/game/pile`] = [];
      updates[`rooms/${roomCode}/game/passCount`] = 0;
      updates[`rooms/${roomCode}/game/lastPlayerId`] = null;
      if (newHand.length > 0) {
        updates[`rooms/${roomCode}/game/currentTurn`] = playerId;
      } else {
        let nextId = playerIds[(playerIds.indexOf(playerId) + 1) % playerIds.length];
        let tries = 0;
        while ((allHands[nextId]?.length ?? 0) === 0 && tries < playerIds.length) {
          nextId = playerIds[(playerIds.indexOf(nextId) + 1) % playerIds.length];
          tries++;
        }
        updates[`rooms/${roomCode}/game/currentTurn`] = nextId;
      }
    } else if (isRoundOver) {
      const ranks = assignRanks(newFinished, playerIds.length);
      updates[`rooms/${roomCode}/game/ranks`] = ranks;
      updates[`rooms/${roomCode}/meta/status`] = "result";
      updates[`rooms/${roomCode}/game/readyForNext`] = [];
      updates[`rooms/${roomCode}/game/pile`] = cards;
      updates[`rooms/${roomCode}/game/lastPlayerId`] = playerId;
      newFinished.forEach(id => {
        updates[`rooms/${roomCode}/players/${id}/rank`] = ranks[id];
      });
    } else {
      updates[`rooms/${roomCode}/game/pile`] = cards;
      updates[`rooms/${roomCode}/game/lastPlayerId`] = playerId;
      updates[`rooms/${roomCode}/game/passCount`] = 0;

      let nextId = playerIds[(playerIds.indexOf(playerId) + 1) % playerIds.length];
      let tries = 0;
      while ((allHands[nextId]?.length ?? 0) === 0 && tries < playerIds.length) {
        nextId = playerIds[(playerIds.indexOf(nextId) + 1) % playerIds.length];
        tries++;
      }

      const pileCountNeeded = cards.length;
      function canPlayerPlayCards(hand) {
        const nj = hand.filter(c => !c.joker);
        const jk = hand.filter(c => c.joker).length;
        const grps = {};
        nj.forEach(c => { if (!grps[c.rank]) grps[c.rank] = []; grps[c.rank].push(c); });
        return Object.entries(grps).some(([r, arr]) =>
          parseInt(r) < cardRank &&
          (arr.length >= pileCountNeeded || arr.length + jk >= pileCountNeeded)
        );
      }
      const canAnyone = cardRank && remaining.filter(id => id !== playerId).some(id =>
        canPlayerPlayCards(allHands[id] || [])
      );

      if (!canAnyone && remaining.filter(id => id !== playerId).length > 0) {
        const activeOthers = remaining.filter(id => id !== playerId);
        const curIdx = playerIds.indexOf(playerId);
        let newLeader = null;
        for (let i = 1; i <= playerIds.length; i++) {
          const candidate = playerIds[(curIdx + i) % playerIds.length];
          if (activeOthers.includes(candidate)) { newLeader = candidate; break; }
        }
        newLeader = newLeader ?? activeOthers[0] ?? nextId;
        const actualLeader = newHand.length > 0 ? playerId : newLeader;
        const leaderNick = roomData?.players?.[actualLeader]?.nickname ?? playerNick;
        const autoClearLog = `🔄 ${playerNick}이(가) 낸 ${cardDesc}에 아무도 대응 못함! → ${leaderNick}이(가) 새로 시작`;

        // 일단 카드 바닥에 올려놓기
        updates[`rooms/${roomCode}/game/pile`] = cards;
        updates[`rooms/${roomCode}/game/lastPlayerId`] = playerId;
        updates[`rooms/${roomCode}/game/passCount`] = 0;
        updates[`rooms/${roomCode}/game/log`] = newLog.slice(-30);
        await update(ref(db), updates);

        // 2초 후 선 넘기기
        setTimeout(async () => {
          const checkSnap = await get(ref(db, `rooms/${roomCode}/game/currentTurn`));
          if (checkSnap.val() !== nextId && checkSnap.val() !== playerId) return;
          const delayedLog = [...newLog, autoClearLog];
          await update(ref(db), {
            [`rooms/${roomCode}/game/pile`]: [],
            [`rooms/${roomCode}/game/passCount`]: 0,
            [`rooms/${roomCode}/game/lastPlayerId`]: null,
            [`rooms/${roomCode}/game/currentTurn`]: actualLeader,
            [`rooms/${roomCode}/game/log`]: delayedLog.slice(-30),
          });
        }, 2000);
        return { ok: true };
      } else {
        updates[`rooms/${roomCode}/game/currentTurn`] = nextId;
      }
    }

    // 로그는 모든 push 완료 후 마지막에 저장
    updates[`rooms/${roomCode}/game/log`] = newLog.slice(-30);
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
      let lastId = game?.lastPlayerId;
      // lastPlayerId가 패가 없으면 다음 활성 플레이어로
      if (!lastId || (allHands[lastId]?.length ?? 0) === 0) {
        lastId = activePlayers.find(id => id !== uid) ?? activePlayers[0];
      }
      newLog.push(`모두 패스! ${roomData?.players?.[lastId]?.nickname}이(가) 새로 시작합니다`);
      updates[`rooms/${roomCode}/game/pile`] = [];
      updates[`rooms/${roomCode}/game/passCount`] = 0;
      updates[`rooms/${roomCode}/game/currentTurn`] = lastId;
      updates[`rooms/${roomCode}/game/lastPlayerId`] = null;
    } else {
      updates[`rooms/${roomCode}/game/passCount`] = newPassCount;
      updates[`rooms/${roomCode}/game/currentTurn`] = nextId;
    }
    updates[`rooms/${roomCode}/game/log`] = newLog.slice(-30);
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

    const botIds = roomData?.game?.botIds ?? [];
    // 봇들도 자동으로 준비 완료
    const newList = [...new Set([...readyList, uid, ...botIds])];
    const playerCount = Object.keys(roomData?.players ?? {}).length;

    const updates = {};
    updates[`rooms/${roomCode}/game/readyForNext`] = newList;

    if (newList.length >= playerCount) {
      const ranks = roomData?.game?.ranks ?? {};
      const hasDalmuti = Object.values(ranks).includes("dalmuti");
      const hasPrime = Object.values(ranks).includes("prime");
      if (hasDalmuti || hasPrime) {
        updates[`rooms/${roomCode}/meta/status`] = "tax";
        updates[`rooms/${roomCode}/game/tributeDone`] = {};
        updates[`rooms/${roomCode}/game/returnDone`] = {};
        updates[`rooms/${roomCode}/game/tributeReceived`] = {};
      } else {
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
