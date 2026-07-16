// src/components/PDFOverlayExamRoom.tsx
// ✅ Phòng thi PDF — vẽ controls trực tiếp lên PDF
//    • PHẦN I  (MC)     → radio button trước mỗi A./B./C./D.
//    • PHẦN II (TF)     → nút [Đ][S] ở lề trái mỗi dòng a)/b)/c)/d)
//    • PHẦN III (SA)    → textbox inline cuối câu hỏi
//    • PHẦN IV (Tự luận)→ textarea inline
//    Nguồn PDF: base64 ưu tiên → GAS proxy (Drive) → fallback iframe

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Room, Exam, StudentInfo, Submission, QuestionSolutionRange } from '../types';
import {
  ensureSignedIn,
  createSubmission,
  submitExam,
} from '../services/firebaseService';
import { getTabDetectionService } from '../services/tabDetectionService';
import { useExamSession, generateSessionId } from '../services/sessionService';
import EssayQuestionInput from './EssayQuestionInput';

// ─── GAS URL (dùng chung với googleDriveService) ──────────────────────────────
const GAS_URL          = 'https://script.google.com/macros/s/AKfycbxUukL2iFWHIOvUumwZfmxM1HTbhv7PQWhnb5JbfnDRnFz9X7rQb6lwMTBHR3Z7M9ZH/exec';
const GAS_SECRET_TOKEN = 'dethipdf2026';

// ─── Types ────────────────────────────────────────────────────────────────────

type MCAnswers      = { [n: number]: string };
type TFAnswers      = { [n: number]: string[] };
type SAAnswers      = { [n: number]: string };
type WritingAnswers = { [n: number]: string };

/** Một text item từ pdf.js với toạ độ PDF gốc */
interface TxtItem {
  str  : string;
  x    : number; y: number; // PDF coords (origin: bottom-left)
  w    : number;            // width in PDF units
  page : number;            // 0-based page index
  pw   : number; ph: number;// page natural width / height at scale=1
}

/** Loại control overlay */
type CtrlKind = 'mc_opt' | 'tf_sub' | 'sa_box' | 'wr_box';

/** Một control được vẽ đè lên trang PDF */
interface OverlayCtrl {
  id     : string;
  kind   : CtrlKind;
  qNum   : number;    // số hiệu câu hỏi trong exam (1-N, 201-N, 301-N, 401-N)
  letter?: string;    // 'A'|'B'|'C'|'D' cho MC, 'a'|'b'|'c'|'d' cho TF
  page   : number;
  xPct   : number;   // left  position as % of page width
  yPct   : number;   // top   position as % of page height
  widthPct?: number; // chiều rộng (% trang) — sa_box/wr_box, do GV resize trong editor
  heightPx?: number; // chiều cao (px)       — sa_box/wr_box, do GV resize trong editor
}

/** Thông tin một trang đã render */
interface RenderedPage {
  src: string; // dataURL
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mergeAnswers(
  mc: MCAnswers, tf: TFAnswers,
  sa: SAAnswers, wr: WritingAnswers,
): { [n: number]: string } {
  const all: { [n: number]: string } = {};
  Object.entries(mc).forEach(([k, v]) => { if (v) all[+k] = v; });
  Object.entries(tf).forEach(([k, v]) => {
    if ((v || []).some(x => x === 'Đ' || x === 'S')) {
      const obj: Record<string, boolean> = {};
      ['a','b','c','d'].forEach((l, i) => { obj[l] = v[i] === 'Đ'; });
      all[+k] = JSON.stringify(obj);
    }
  });
  Object.entries(sa).forEach(([k, v]) => { if (v?.trim()) all[+k] = v.trim(); });
  Object.entries(wr).forEach(([k, v]) => { if (v?.trim()) all[+k] = v; });
  return all;
}

function fmtTimer(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

// ─── PDF loading ─────────────────────────────────────────────────────────────

const loadPdfJs = (): Promise<any> => new Promise((resolve, reject) => {
  const w = window as any;
  if (w.pdfjsLib) { resolve(w.pdfjsLib); return; }
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  s.onload = () => {
    w.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    resolve(w.pdfjsLib);
  };
  s.onerror = () => reject(new Error('Không thể tải pdf.js'));
  document.head.appendChild(s);
});

async function base64ToBytes(b64: string): Promise<Uint8Array> {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** Tải PDF bytes từ base64 hoặc qua GAS proxy (nếu là Drive file) */
async function loadPdfBytes(
  pdfBase64?: string,
  driveFileId?: string,
): Promise<Uint8Array | null> {
  // 1) base64 trực tiếp (lưu trong exam)
  if (pdfBase64) {
    console.log('[PDFOverlay] using embedded base64 PDF');
    return base64ToBytes(pdfBase64);
  }

  // 2) GAS proxy download
  if (driveFileId) {
    console.log('[PDFOverlay] fetching PDF from GAS → fileId:', driveFileId);
    try {
      const res = await fetch(GAS_URL, {
        method : 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body   : JSON.stringify({ action: 'downloadFile', fileId: driveFileId, token: GAS_SECRET_TOKEN }),
        redirect: 'follow',
      });
      console.log('[PDFOverlay] GAS status:', res.status, res.ok);
      if (!res.ok) {
        console.warn('[PDFOverlay] GAS HTTP error:', res.status);
        return null;
      }
      const json = await res.json();
      console.log('[PDFOverlay] GAS json — success:', json.success, '| error:', json.error ?? '-', '| base64 len:', json.base64?.length ?? 0);
      if (json.success && json.base64) {
        console.log('[PDFOverlay] PDF loaded ✅', Math.round(json.base64.length * 0.75 / 1024), 'KB');
        return base64ToBytes(json.base64);
      }
      console.warn('[PDFOverlay] GAS downloadFile failed:', json.error ?? 'no base64 in response');
    } catch (err) {
      console.error('[PDFOverlay] fetch error:', err);
    }
  } else {
    console.warn('[PDFOverlay] no pdfBase64 and no driveFileId — cannot load PDF');
  }

  return null;
}

// ─── Overlay Detection ───────────────────────────────────────────────────────

/**
 * Phân tích danh sách text items của toàn bộ PDF và trả về các OverlayCtrl
 * cần vẽ trên từng trang.
 */
function detectOverlays(
  items  : TxtItem[],
  mcCount: number,
  tfCount: number,
  saCount: number,
  wrCount: number,
): OverlayCtrl[] {
  const ctrls: OverlayCtrl[] = [];

  // Sắp xếp: page tăng dần, y giảm dần (đầu trang trước), x tăng dần
  const sorted = [...items].sort((a, b) =>
    a.page !== b.page ? a.page - b.page :
    Math.abs(a.y - b.y) > 2 ? b.y - a.y :
    a.x - b.x,
  );

  const toPct = (it: TxtItem) => ({
    xPct: (it.x / it.pw) * 100,
    yPct: ((it.ph - it.y) / it.ph) * 100,
  });

  // ── PHẦN I — MC ──────────────────────────────────────────────────────────
  if (mcCount > 0) {
    const mcPool = sorted.filter(it => /^[ABCD]\.\s/.test(it.str) || /^[ABCD]\.$/.test(it.str));
    const aAnchors = mcPool.filter(it => /^A[.\s]/.test(it.str)).slice(0, mcCount);

    aAnchors.forEach((aItem, qi) => {
      const qNum = qi + 1;
      for (const letter of ['A','B','C','D']) {
        let found: TxtItem | undefined;
        if (letter === 'A') {
          found = aItem;
        } else {
          const pat = new RegExp(`^${letter}[.\\s]`);
          // Cùng dòng (|Δy| ≤ 3 PDF units)
          found = mcPool.find(o =>
            pat.test(o.str) && o.page === aItem.page && Math.abs(o.y - aItem.y) <= 3,
          );
          // Dòng kế (y nhỏ hơn, không có A. khác nằm giữa)
          if (!found) {
            found = mcPool.find(o =>
              pat.test(o.str) &&
              o.page === aItem.page &&
              aItem.y - o.y > 0 && aItem.y - o.y <= 55 &&
              !aAnchors.some(a2 =>
                a2 !== aItem && a2.page === aItem.page &&
                a2.y < aItem.y && a2.y >= o.y,
              ),
            );
          }
        }
        if (found) {
          const p = toPct(found);
          ctrls.push({ id: `mc-${qNum}-${letter}`, kind: 'mc_opt', qNum, letter, page: found.page, ...p });
        }
      }
    });
  }

  // ── PHẦN II — TF ─────────────────────────────────────────────────────────
  if (tfCount > 0) {
    const subPats = ['a','b','c','d'].map(s => new RegExp(`^${s}\\)`));
    const aSubAnchors = sorted.filter(it => /^a\)/.test(it.str)).slice(0, tfCount);

    aSubAnchors.forEach((aSub, qi) => {
      const qNum = 201 + qi;
      for (let si = 0; si < 4; si++) {
        const subLetter = 'abcd'[si];
        let found: TxtItem | undefined;

        if (si === 0) {
          found = aSub;
        } else {
          found = sorted.find(o =>
            subPats[si].test(o.str) &&
            (o.page > aSub.page || (o.page === aSub.page && o.y < aSub.y)) &&
            // không vượt qua anchor a) tiếp theo
            !aSubAnchors.some(a2 =>
              a2 !== aSub &&
              (a2.page > aSub.page || (a2.page === aSub.page && a2.y < aSub.y)) &&
              (a2.page < o.page  || (a2.page === o.page  && a2.y > o.y)),
            ),
          );
        }

        if (found) {
          const p = toPct(found);
          // Đặt nút [Đ][S] tại vị trí LEFT của text (nút sẽ dùng transform để dời sang trái)
          ctrls.push({ id: `tf-${qNum}-${subLetter}`, kind: 'tf_sub', qNum, letter: subLetter, page: found.page, ...p });
        }
      }
    });
  }

  // ── PHẦN III — SA ────────────────────────────────────────────────────────
  const detectSectionItems = (sectionRx: RegExp, count: number, startQNum: number, kind: CtrlKind) => {
    if (count === 0) return;
    const header = sorted.find(it => sectionRx.test(it.str));
    if (!header) return;

    const cauPat = /^Câu\s+\d+/;
    const cauItems = sorted.filter(it =>
      cauPat.test(it.str) &&
      (it.page > header.page || (it.page === header.page && it.y < header.y + 2)),
    ).slice(0, count);

    cauItems.forEach((cauItem, i) => {
      const qNum = startQNum + i;
      const nextCau = cauItems[i + 1];

      // Tìm text item thấp nhất (y nhỏ nhất trong PDF = cuối câu hỏi)
      let bottomY    = cauItem.y - 12;
      let bottomPage = cauItem.page;

      for (const it of sorted) {
        const afterStart = it.page > cauItem.page || (it.page === cauItem.page && it.y < cauItem.y);
        const beforeNext = !nextCau ||
          it.page < nextCau.page ||
          (it.page === nextCau.page && it.y > nextCau.y);
        if (afterStart && beforeNext) {
          if (it.page > bottomPage || (it.page === bottomPage && it.y < bottomY)) {
            bottomY    = it.y;
            bottomPage = it.page;
          }
        }
      }

      const refPh = sorted.find(it => it.page === bottomPage)?.ph ?? 842;
      ctrls.push({
        id   : `${kind}-${qNum}`,
        kind,
        qNum,
        page : bottomPage,
        xPct : 7,                                         // lề trái
        yPct : ((refPh - bottomY + 12) / refPh) * 100,   // ngay dưới dòng cuối
      });
    });
  };

  detectSectionItems(/PHẦN\s*III\b/i, saCount, 301, 'sa_box');
  detectSectionItems(/PHẦN\s*IV\b/i,  wrCount, 401, 'wr_box');

  return ctrls;
}

// ─── Màu sắc cho MC ──────────────────────────────────────────────────────────

const MC_COLOR: Record<string, { bg: string; border: string; text: string }> = {
  A: { bg: '#ec4899', border: '#be185d', text: '#fff' },
  B: { bg: '#0ea5e9', border: '#0369a1', text: '#fff' },
  C: { bg: '#22c55e', border: '#15803d', text: '#fff' },
  D: { bg: '#f97316', border: '#c2410c', text: '#fff' },
};
const MC_IDLE = { bg: 'rgba(255,255,255,0.92)', border: '#9ca3af', text: '#6b7280' };

// ─── PDFPage ──────────────────────────────────────────────────────────────────

interface PDFPageProps {
  pageIndex     : number;
  src           : string;
  controls      : OverlayCtrl[];
  mcAnswers     : MCAnswers;
  tfAnswers     : TFAnswers;
  saAnswers     : SAAnswers;
  writingAnswers: WritingAnswers;
  isSubmitted   : boolean;
  onMC : (qNum: number, letter: string) => void;
  onTF : (qNum: number, letter: string, val: string) => void;
  onSA : (qNum: number, val: string) => void;
  onWR : (qNum: number, val: string) => void;
}

const PDFPage: React.FC<PDFPageProps> = ({
  pageIndex, src, controls,
  mcAnswers, tfAnswers, saAnswers, writingAnswers,
  isSubmitted, onMC, onTF, onSA, onWR,
}) => (
  <div style={{ position: 'relative', width: '100%', lineHeight: 0, userSelect: 'none' }}>
    {/* Trang PDF render thành ảnh */}
    <img
      src={src}
      alt={`Trang ${pageIndex + 1}`}
      draggable={false}
      style={{ width: '100%', display: 'block', pointerEvents: 'none' }}
    />

    {/* Overlay — pointer-events: none trên container; chỉ các control con mới bắt sự kiện */}
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>

      {controls.map(ctrl => {
        const base: React.CSSProperties = {
          position     : 'absolute',
          left         : `${ctrl.xPct}%`,
          top          : `${ctrl.yPct}%`,
          pointerEvents: 'auto',
          lineHeight   : 'normal',
          fontFamily   : 'system-ui, sans-serif',
        };

        // ── MC radio button ──
        if (ctrl.kind === 'mc_opt') {
          const selected = mcAnswers[ctrl.qNum] === ctrl.letter;
          const col = selected ? (MC_COLOR[ctrl.letter!] ?? MC_IDLE) : MC_IDLE;
          return (
            <button
              key={ctrl.id}
              title={`Câu ${ctrl.qNum}: chọn ${ctrl.letter}`}
              onClick={() => !isSubmitted && onMC(ctrl.qNum, ctrl.letter!)}
              style={{
                ...base,
                transform   : 'translate(-130%, -50%)',
                width       : '22px',
                height      : '22px',
                borderRadius: '50%',
                border      : selected ? `2.5px solid ${col.border}` : '2px solid #94a3b8',
                background  : col.bg,
                color       : col.text,
                cursor      : isSubmitted ? 'default' : 'pointer',
                fontSize    : '10px',
                fontWeight  : '900',
                display     : 'flex',
                alignItems  : 'center',
                justifyContent: 'center',
                boxShadow   : selected ? `0 0 0 4px ${col.border}40, 0 2px 6px rgba(0,0,0,.2)` : '0 1px 4px rgba(0,0,0,.25)',
                transition  : 'all .15s cubic-bezier(.4,0,.2,1)',
                zIndex      : 10,
              }}
            >
              {selected ? ctrl.letter : ''}
            </button>
          );
        }

        // ── TF [Đ][S] buttons ──
        if (ctrl.kind === 'tf_sub') {
          const idx = 'abcd'.indexOf(ctrl.letter!);
          const cur = tfAnswers[ctrl.qNum]?.[idx] ?? '';
          return (
            <div
              key={ctrl.id}
              style={{
                ...base,
                transform: 'translate(-118%, -50%)',
                display  : 'flex',
                gap      : '3px',
                zIndex   : 10,
              }}
            >
              {(['Đ','S'] as const).map(v => {
                const active = cur === v;
                return (
                  <button
                    key={v}
                    onClick={() => !isSubmitted && onTF(ctrl.qNum, ctrl.letter!, v)}
                    style={{
                      width      : '26px',
                      height     : '20px',
                      fontSize   : '10px',
                      fontWeight : '900',
                      borderRadius: '4px',
                      border     : `2px solid ${active ? (v==='Đ' ? '#15803d' : '#b91c1c') : '#94a3b8'}`,
                      background : active ? (v==='Đ' ? '#22c55e' : '#ef4444') : 'rgba(255,255,255,.95)',
                      color      : active ? '#fff' : '#64748b',
                      cursor     : isSubmitted ? 'default' : 'pointer',
                      transition : 'all .15s cubic-bezier(.4,0,.2,1)',
                      lineHeight : '1',
                      boxShadow  : active ? `0 2px 6px ${v==='Đ' ? '#22c55e' : '#ef4444'}60` : '0 1px 3px rgba(0,0,0,.15)',
                    }}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          );
        }

        // ── SA inline textbox ──
        if (ctrl.kind === 'sa_box') {
          const val = saAnswers[ctrl.qNum] ?? '';
          const displayNum = ctrl.qNum - 300;
          return (
            <div
              key={ctrl.id}
              style={{
                ...base,
                // ✅ FIX: tôn trọng kích thước GV đã resize trong editor (fallback giá trị cũ)
                width      : `${ctrl.widthPct ?? 55}%`,
                background : 'rgba(239,246,255,.97)',
                border     : '1.5px solid #3b82f6',
                borderRadius: '6px',
                padding    : '3px 7px',
                display    : 'flex',
                alignItems : 'center',
                gap        : '5px',
                boxShadow  : '0 1px 6px rgba(59,130,246,.2)',
                zIndex     : 20,
                height     : `${ctrl.heightPx ?? 26}px`,
              }}
            >
              <span style={{ fontSize:'10px', fontWeight:'800', color:'#1d4ed8', whiteSpace:'nowrap' }}>
                ✏️ Câu {displayNum}:
              </span>
              <input
                type="text"
                value={val}
                onChange={e => !isSubmitted && onSA(ctrl.qNum, e.target.value)}
                disabled={isSubmitted}
                placeholder="Nhập đáp án…"
                style={{
                  flex       : 1,
                  border     : 'none',
                  outline    : 'none',
                  background : 'transparent',
                  fontSize   : '12px',
                  color      : '#1e40af',
                  fontWeight : '700',
                }}
              />
              {val && (
                <span style={{ fontSize:'10px', color:'#22c55e', fontWeight:'800' }}>✓</span>
              )}
            </div>
          );
        }

        // ── Writing (Tự luận) textarea ──
        if (ctrl.kind === 'wr_box') {
          const val = writingAnswers[ctrl.qNum] ?? '';
          const displayNum = ctrl.qNum - 400;
          return (
            <div
              key={ctrl.id}
              style={{
                ...base,
                // ✅ FIX: tôn trọng kích thước GV đã resize trong editor (fallback giá trị cũ)
                width      : `${ctrl.widthPct ?? 86}%`,
                ...(ctrl.heightPx ? { minHeight: `${ctrl.heightPx}px` } : {}),
                background : 'rgba(245,243,255,.97)',
                border     : '2px solid #8b5cf6',
                borderRadius: '8px',
                padding    : '6px 8px',
                boxShadow  : '0 2px 10px rgba(139,92,246,.25)',
                zIndex     : 20,
              }}
            >
              <div style={{ fontSize:'10px', fontWeight:'800', color:'#6d28d9', marginBottom:'4px' }}>
                📝 Câu {displayNum} — Tự luận
              </div>
              <textarea
                value={val}
                onChange={e => !isSubmitted && onWR(ctrl.qNum, e.target.value)}
                disabled={isSubmitted}
                placeholder="Nhập bài giải…"
                rows={3}
                style={{
                  width      : '100%',
                  border     : 'none',
                  outline    : 'none',
                  background : 'transparent',
                  fontSize   : '11px',
                  color      : '#4c1d95',
                  resize     : 'vertical',
                  fontFamily : 'inherit',
                }}
              />
            </div>
          );
        }

        return null;
      })}
    </div>
  </div>
);


// ─── MCRepairPanel — bổ sung lựa chọn khi PDF thiếu option ───────────────────

interface MCMissingQuestion {
  qNum: number;
  foundLetters: string[];
  missingLetters: string[];
}

interface MCRepairPanelProps {
  missingQuestions: MCMissingQuestion[];
  mcAnswers: MCAnswers;
  isSubmitted: boolean;
  onMC: (qNum: number, letter: string) => void;
}

const MC_REPAIR_COLORS: Record<string, { active: string; idle: string }> = {
  A: { active: 'bg-pink-500 text-white border-pink-500',     idle: 'bg-white border-gray-300 text-gray-600 hover:border-pink-400 hover:bg-pink-50' },
  B: { active: 'bg-sky-500 text-white border-sky-500',       idle: 'bg-white border-gray-300 text-gray-600 hover:border-sky-400 hover:bg-sky-50' },
  C: { active: 'bg-green-500 text-white border-green-500',   idle: 'bg-white border-gray-300 text-gray-600 hover:border-green-400 hover:bg-green-50' },
  D: { active: 'bg-orange-500 text-white border-orange-500', idle: 'bg-white border-gray-300 text-gray-600 hover:border-orange-400 hover:bg-orange-50' },
};

const MCRepairPanel: React.FC<MCRepairPanelProps> = ({
  missingQuestions,
  mcAnswers,
  isSubmitted,
  onMC,
}) => {
  if (missingQuestions.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t-2 border-amber-300 shadow-2xl">
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-amber-600 text-base">⚠️</span>
          <p className="text-xs font-bold text-amber-700">
            Một số câu trắc nghiệm bị thiếu phương án trên PDF — hãy chọn đáp án tại đây:
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {missingQuestions.map(({ qNum, missingLetters }) => {
            const selected = mcAnswers[qNum];
            return (
              <div
                key={qNum}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition ${
                  selected ? 'border-teal-400 bg-teal-50' : 'border-amber-200 bg-amber-50'
                }`}
              >
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${selected ? 'bg-teal-500 text-white' : 'bg-amber-400 text-white'}`}>
                  Câu {qNum}
                </span>
                <span className="text-xs text-gray-500">Còn thiếu:</span>
                <div className="flex gap-1">
                  {missingLetters.map(letter => {
                    const col = MC_REPAIR_COLORS[letter];
                    const isSelected = selected === letter;
                    return (
                      <button
                        key={letter}
                        onClick={() => !isSubmitted && onMC(qNum, letter)}
                        disabled={isSubmitted}
                        className={`w-8 h-8 rounded-full text-xs font-black border-2 transition ${
                          isSelected ? col.active : col.idle
                        } ${isSubmitted ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
                      >
                        {letter}
                      </button>
                    );
                  })}
                </div>
                {selected && <span className="text-xs text-teal-600 font-bold ml-1">✓ {selected}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function findMissingMCOptions(
  overlayList: Array<{ kind: string; qNum: number; letter?: string }>,
  questions: Array<{ number?: number }>,
): MCMissingQuestion[] {
  const EXPECTED = ['A', 'B', 'C', 'D'];
  const missing: MCMissingQuestion[] = [];

  questions.forEach((q, index) => {
    const qNum = typeof q.number === 'number' ? q.number : index + 1;
    const found = overlayList
      .filter(o => o.kind === 'mc_opt' && o.qNum === qNum && o.letter)
      .map(o => o.letter!);

    const missingLetters = EXPECTED.filter(letter => !found.includes(letter));
    if (missingLetters.length > 0) {
      missing.push({ qNum, foundLetters: found, missingLetters });
    }
  });

  return missing;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PDFOverlayExamRoomProps {
  room                  : Room;
  exam                  : Exam;
  student               : StudentInfo;
  existingSubmissionId? : string;
  onSubmitted           : (submission: Submission) => void;
  onExit                : () => void;
}

// ─── Main Component ───────────────────────────────────────────────────────────

const PDFOverlayExamRoom: React.FC<PDFOverlayExamRoomProps> = ({
  room, exam, student, existingSubmissionId, onSubmitted, onExit,
}) => {
  const mcQuestions = exam.questions.filter(q => q.type === 'multiple_choice');
  const tfQuestions = exam.questions.filter(q => q.type === 'true_false');
  const saQuestions = exam.questions.filter(q => q.type === 'short_answer');
  const wrQuestions = exam.questions.filter(q => q.type === 'writing');

  // ── Answer state ──
  const [mcAnswers, setMcAnswers]           = useState<MCAnswers>({});
  const [tfAnswers, setTfAnswers]           = useState<TFAnswers>({});
  const [saAnswers, setSaAnswers]           = useState<SAAnswers>({});
  const [writingAnswers, setWritingAnswers] = useState<WritingAnswers>({});

  // ── PDF state ──
  type PdfStatus = 'loading' | 'ready' | 'no_pdf' | 'error';
  const [pdfStatus,   setPdfStatus]   = useState<PdfStatus>('loading');
  const [pdfPages,    setPdfPages]    = useState<RenderedPage[]>([]);
  const [overlays,    setOverlays]    = useState<OverlayCtrl[]>([]);
  const [missingMC,   setMissingMC]   = useState<MCMissingQuestion[]>([]);
  const [pdfErrorMsg, setPdfErrorMsg] = useState('');
  // fallback: Drive preview URL khi không tải được bytes
  const fallbackIframeSrc = useRef<string | undefined>(undefined);

  // ── Exam session ──
  const [submissionId, setSubmissionId]   = useState<string | undefined>(existingSubmissionId);
  const [isSubmitted,  setIsSubmitted]    = useState(false);
  const [isSubmitting, setIsSubmitting]   = useState(false);
  const [showConfirm,  setShowConfirm]    = useState(false);

  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [tabWarnings,    setTabWarnings]    = useState<Date[]>([]);
  const [showTabWarning, setShowTabWarning] = useState(false);

  const [timeLeft, setTimeLeft] = useState(room.timeLimit * 60);
  const timerRed = timeLeft <= 5 * 60;
  const sessionIdRef = useRef(generateSessionId());

  // ── Derived ──
  const totalQ        = mcQuestions.length + tfQuestions.length + saQuestions.length + wrQuestions.length;
  const answeredMC    = Object.values(mcAnswers).filter(Boolean).length;
  const answeredTF    = Object.values(tfAnswers).filter(v => (v||[]).some(x => x==='Đ'||x==='S')).length;
  const answeredSA    = Object.values(saAnswers).filter(v => v?.trim()).length;
  const answeredWR    = Object.values(writingAnswers).filter(v => v?.trim()).length;
  const totalAnswered = answeredMC + answeredTF + answeredSA + answeredWR;
  const progress      = totalQ > 0 ? Math.round((totalAnswered / totalQ) * 100) : 0;

  // Tính chiều cao bottom padding khi MCRepairPanel xuất hiện
  const repairPanelVisible = pdfStatus === 'ready' && !isSubmitted && missingMC.length > 0;

  // ── Session monitoring ──
  const { reportTabSwitch, updateProgress, submitSession } = useExamSession({
    roomId        : room.id,
    studentId     : student.id,
    studentName   : student.name,
    sessionId     : sessionIdRef.current,
    className     : student.className,
    totalQuestions: totalQ,
    onKicked: (deviceInfo) => {
      alert(`⚠️ Đăng nhập thiết bị khác!\nThiết bị: ${deviceInfo}\nBạn sẽ bị thoát.`);
      onExit();
    },
  });

  // ── Init submission ──
  useEffect(() => {
    if (existingSubmissionId) return;
    (async () => {
      await ensureSignedIn();
      const id = await createSubmission({
        roomId: room.id, roomCode: room.code, examId: exam.id, student, answers: {},
        scoreBreakdown: {
          multipleChoice: { total: 0, correct: 0, points: 0 },
          trueFalse: { total: 0, correct: 0, partial: 0, points: 0, details: {} },
          shortAnswer: { total: 0, correct: 0, points: 0 },
          writing: { total: 0, correct: 0, points: 0, details: {} } as any,
          totalScore: 0, percentage: 0,
        },
        totalScore: 0, percentage: 0, score: 0, correctCount: 0, wrongCount: 0,
        totalQuestions: totalQ, tabSwitchCount: 0, tabSwitchWarnings: [], autoSubmitted: false,
        duration: 0, status: 'in_progress',
      });
      setSubmissionId(id);
    })().catch(console.error);
  }, []);

  // ── Load & render PDF ──
  useEffect(() => {
    const drivePdfUrl  = (exam as any).pdfDriveUrl   as string | undefined;
    const driveFileId  = (exam as any).pdfDriveFileId as string | undefined;
    const pdfBase64    = (exam as any).pdfBase64      as string | undefined;

    fallbackIframeSrc.current = driveFileId
      ? `https://drive.google.com/file/d/${driveFileId}/preview`
      : drivePdfUrl?.replace('/view', '/preview');

    (async () => {
      try {
        console.log('[PDFOverlay] starting PDF load — driveFileId:', driveFileId ?? 'none', '| has base64:', !!pdfBase64);
        const bytes = await loadPdfBytes(pdfBase64, driveFileId);
        if (!bytes) {
          console.warn('[PDFOverlay] ⚠️ bytes null → falling back to iframe + panel');
          setMissingMC([]);
          setPdfStatus('no_pdf');
          return;
        }
        console.log('[PDFOverlay] bytes ok, starting pdf.js render...');

        const pdfjsLib = await loadPdfJs();
        const doc = await pdfjsLib.getDocument({
          data: bytes,
          // CMap cần thiết để decode font tiếng Việt (TCVN3/VNI) và các encoding đặc biệt
          cMapUrl    : 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
          cMapPacked : true,
          useSystemFonts: true,
        }).promise;

        const pages  : RenderedPage[] = [];
        const txtAll : TxtItem[]      = [];

        for (let i = 0; i < doc.numPages; i++) {
          const page = await doc.getPage(i + 1);
          const vp1  = page.getViewport({ scale: 1 });

          // Render at 2x for crispness
          const SCALE = 2;
          const vp    = page.getViewport({ scale: SCALE });
          const cvs   = document.createElement('canvas');
          cvs.width   = vp.width;
          cvs.height  = vp.height;
          await page.render({ canvasContext: cvs.getContext('2d')!, viewport: vp }).promise;
          pages.push({ src: cvs.toDataURL('image/jpeg', 0.88) });

          // Extract text with PDF coords (scale=1)
          const content = await page.getTextContent({ includeMarkedContent: true });
          if (i === 0) {
            console.log('[PDFOverlay] raw items page 1:', content.items.length);
          }
          for (const raw of content.items) {
            if (!('str' in raw)) continue;
            const r = raw as any;
            if (!r.str.trim()) continue;
            txtAll.push({
              str : r.str.trim(),
              x   : r.transform[4],
              y   : r.transform[5],
              w   : r.width ?? 0,
              page: i,
              pw  : vp1.width,
              ph  : vp1.height,
            });
          }
        }

        // ── DEBUG: log tất cả text items trang 1 để kiểm tra format ──
        const page1Items = txtAll.filter(t => t.page === 0);
        console.log('[PDFOverlay] Page 1 text items (tổng:', page1Items.length, '):');
        page1Items.forEach(t => console.log(
          `  str="${t.str}" | x=${t.x.toFixed(1)} y=${t.y.toFixed(1)} w=${t.w.toFixed(1)} | pw=${t.pw.toFixed(1)} ph=${t.ph.toFixed(1)}`
        ));
        console.log('[PDFOverlay] mcCount:', mcQuestions.length, '| tfCount:', tfQuestions.length, '| saCount:', saQuestions.length);

        // ── Ưu tiên pdfOverlayControls đã lưu (từ PDFExamCreator drag-drop) ──
        const savedControls = (exam as any).pdfOverlayControls as OverlayCtrl[] | undefined;
        const overlayData = (savedControls && savedControls.length > 0)
          ? savedControls
          : detectOverlays(txtAll, mcQuestions.length, tfQuestions.length, saQuestions.length, wrQuestions.length);

        console.log('[PDFOverlay] overlays:', overlayData.length,
          (savedControls?.length) ? '← saved (drag-drop)' : '← auto-detected',
          overlayData.map(d => d.id));

        const missing = overlayData.length > 0 ? findMissingMCOptions(overlayData, mcQuestions) : [];
        setPdfPages(pages);
        setOverlays(overlayData);
        setMissingMC(missing);
        if (missing.length > 0) {
          console.warn('[PDFOverlay] MC thiếu phương án:', missing);
        }
        setPdfStatus('ready');
      } catch (err) {
        console.error('PDF load error:', err);
        setMissingMC([]);
        setPdfErrorMsg(err instanceof Error ? err.message : String(err));
        setPdfStatus('error');
      }
    })();
  }, []);

  // ── Timer ──
  useEffect(() => {
    if (isSubmitted) return;
    const t = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(t); handleAutoSubmit(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [isSubmitted]);

  // ── Sync progress ──
  useEffect(() => {
    if (!isSubmitted) updateProgress(totalAnswered, timeLeft);
  }, [totalAnswered, timeLeft, isSubmitted, updateProgress]);

  // ── Tab detection ──
  useEffect(() => {
    const svc = getTabDetectionService();
    svc.start({
      onTabSwitch: (count, warnings) => {
        setTabSwitchCount(count); setTabWarnings(warnings);
        setShowTabWarning(true);
        setTimeout(() => setShowTabWarning(false), 4000);
        reportTabSwitch();
      },
      onAutoSubmit: () => handleAutoSubmit(),
    });
    return () => svc.stop();
  }, [reportTabSwitch]);

  // ── Answer handlers ──
  const setMC = useCallback((qNum: number, letter: string) =>
    setMcAnswers(p => ({ ...p, [qNum]: p[qNum] === letter ? '' : letter })), []);

  const setTF = useCallback((qNum: number, letter: string, val: string) =>
    setTfAnswers(p => {
      const idx  = 'abcd'.indexOf(letter);
      const cur  = p[qNum] || ['','','',''];
      const next = [...cur];
      next[idx]  = next[idx] === val ? '' : val;
      return { ...p, [qNum]: next };
    }), []);

  const setSA = useCallback((qNum: number, val: string) =>
    setSaAnswers(p => ({ ...p, [qNum]: val })), []);

  const setWR = useCallback((qNum: number, val: string) =>
    setWritingAnswers(p => ({ ...p, [qNum]: val })), []);

  // ── Submit ──
  const handleSubmit = async (auto = false) => {
    if (isSubmitting || isSubmitted) return;
    if (!submissionId) { alert('Lỗi phiên thi. Vui lòng thử lại.'); return; }
    setIsSubmitting(true); setShowConfirm(false);
    submitSession();
    try {
      const merged = mergeAnswers(mcAnswers, tfAnswers, saAnswers, writingAnswers);
      const submission = await submitExam(
        submissionId, merged, exam,
        { tabSwitchCount, tabSwitchWarnings: tabWarnings, autoSubmitted: auto },
      );
      if (submission) { setIsSubmitted(true); onSubmitted(submission); }
    } catch (err) {
      console.error(err);
      alert('Có lỗi khi nộp bài. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAutoSubmit = useCallback(() => handleSubmit(true), []);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">

      {/* ── Top bar ── */}
      <div className="bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-2 shrink-0 shadow-sm z-30">
        <button onClick={onExit}
          className="text-gray-500 hover:text-gray-700 text-xs px-2 py-1 border border-gray-200 rounded-lg shrink-0">
          ✕
        </button>

        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800 text-sm truncate">{exam.title}</p>
          <p className="text-xs text-gray-400 truncate hidden sm:block">{student.name}</p>
        </div>

        {/* Progress bar */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <div className="w-28 bg-gray-200 rounded-full h-2">
            <div className="bg-teal-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-gray-600 font-mono">{totalAnswered}/{totalQ}</span>
        </div>

        {/* Timer */}
        <div className={`font-mono font-bold px-2.5 py-1.5 rounded-lg text-sm shrink-0
          ${timerRed ? 'bg-red-100 text-red-700 animate-pulse' : 'bg-teal-100 text-teal-800'}`}>
          ⏱ {isSubmitted ? '✅' : fmtTimer(timeLeft)}
        </div>

        {/* Nộp bài */}
        <button
          onClick={() => setShowConfirm(true)}
          disabled={isSubmitting || isSubmitted}
          className="shrink-0 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm font-semibold
            disabled:opacity-50 hover:bg-teal-700 transition"
        >
          {isSubmitting ? '⏳' : isSubmitted ? '✅ Đã nộp' : '📤 Nộp'}
        </button>
      </div>

      {/* ── Legend (hướng dẫn nhanh) ── */}
      {pdfStatus === 'ready' && !isSubmitted && overlays.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-100 px-3 py-1.5 flex items-center gap-4 text-xs text-amber-800 shrink-0 overflow-x-auto">
          <span className="shrink-0">💡 Hướng dẫn:</span>
          <span className="shrink-0 flex items-center gap-1">
            <span className="inline-block w-4 h-4 rounded-full border-2 border-pink-400 bg-white" />
            = radio MC (click để chọn)
          </span>
          <span className="shrink-0 flex items-center gap-1">
            <span className="inline-block px-1 py-0 text-xs border rounded bg-green-100 border-green-400 font-bold text-green-700">Đ</span>
            <span className="inline-block px-1 py-0 text-xs border rounded bg-red-100 border-red-400 font-bold text-red-700">S</span>
            = chọn Đúng/Sai
          </span>
          <span className="shrink-0">📝 = ô nhập trả lời ngắn</span>
        </div>
      )}

      {/* ── Main scrollable area ── */}
      {/*
        Khi MCRepairPanel hiện (fixed bottom), thêm padding-bottom để tránh
        nội dung bị che khuất bởi panel bổ sung phương án MC.
      */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: repairPanelVisible ? '88px' : undefined }}
      >

        {/* Loading */}
        {pdfStatus === 'loading' && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-500">
            <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium">Đang tải và phân tích đề thi…</p>
            <p className="text-xs text-gray-400">Có thể mất 5–15 giây</p>
          </div>
        )}

        {/* No PDF bytes → fallback iframe + panel */}
        {(pdfStatus === 'no_pdf' || pdfStatus === 'error') && (
          <div className="flex flex-1 overflow-hidden h-full">
            {fallbackIframeSrc.current ? (
              <iframe
                src={fallbackIframeSrc.current}
                className="flex-1 border-0"
                title="Đề thi"
                allow="autoplay"
              />
            ) : (
              <div className="flex-1 flex items-center justify-center bg-gray-100 text-gray-500 text-sm">
                <div className="text-center p-8">
                  <p className="text-5xl mb-3">📄</p>
                  <p className="font-semibold">Không thể tải PDF</p>
                  <p className="text-xs mt-1 text-gray-400">Dùng bảng trả lời bên phải</p>
                </div>
              </div>
            )}
            <FallbackAnswerPanel
              mcQuestions={mcQuestions}
              tfQuestions={tfQuestions}
              saQuestions={saQuestions}
              mcAnswers={mcAnswers}
              tfAnswers={tfAnswers}
              saAnswers={saAnswers}
              isSubmitted={isSubmitted}
              onMC={setMC} onTF={setTF} onSA={setSA}
            />
          </div>
        )}

        {/* PDF render OK nhưng không detect được text layer
            → split layout đẹp: canvas PDF bên trái + answer panel bên phải */}
        {pdfStatus === 'ready' && overlays.length === 0 && (
          <div className="flex h-full overflow-hidden bg-slate-100">
            {/* ── PDF viewer ── */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="max-w-3xl mx-auto">
                {/* No-overlay notice */}
                <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <span className="text-base">ℹ️</span>
                  <span>PDF không có text layer — dùng <strong>bảng trả lời</strong> bên phải</span>
                </div>
                <div className="shadow-2xl rounded-lg overflow-hidden">
                  {pdfPages.map((page, i) => (
                    <PDFPage key={i} pageIndex={i} src={page.src} controls={[]}
                      mcAnswers={mcAnswers} tfAnswers={tfAnswers}
                      saAnswers={saAnswers} writingAnswers={writingAnswers}
                      isSubmitted={isSubmitted}
                      onMC={setMC} onTF={setTF} onSA={setSA} onWR={setWR}
                    />
                  ))}
                </div>
                {isSubmitted && (
                  <div className="mt-4 bg-teal-600 text-white text-center py-6 px-4 rounded-xl shadow-lg">
                    <p className="text-2xl font-bold mb-1">✅ Đã nộp bài thành công</p>
                    <p className="text-sm text-teal-100">Đã trả lời {totalAnswered}/{totalQ} câu</p>
                  </div>
                )}
              </div>
            </div>
            {/* ── Answer panel ── */}
            <FallbackAnswerPanel
              mcQuestions={mcQuestions} tfQuestions={tfQuestions}
              saQuestions={saQuestions}
              mcAnswers={mcAnswers} tfAnswers={tfAnswers} saAnswers={saAnswers}
              isSubmitted={isSubmitted}
              onMC={setMC} onTF={setTF} onSA={setSA}
            />
          </div>
        )}

        {/* PDF có overlay → render từng trang với controls đè lên */}
        {pdfStatus === 'ready' && overlays.length > 0 && (
          <div className="max-w-4xl mx-auto shadow-2xl">
            {pdfPages.map((page, i) => (
              <PDFPage
                key={i}
                pageIndex={i}
                src={page.src}
                controls={overlays.filter(c => c.page === i)}
                mcAnswers={mcAnswers}
                tfAnswers={tfAnswers}
                saAnswers={saAnswers}
                writingAnswers={writingAnswers}
                isSubmitted={isSubmitted}
                onMC={setMC}
                onTF={setTF}
                onSA={setSA}
                onWR={setWR}
              />
            ))}
            {isSubmitted && (
              <div className="bg-teal-600 text-white text-center py-6 px-4">
                <p className="text-2xl font-bold mb-1">✅ Đã nộp bài thành công</p>
                <p className="text-sm text-teal-100">Đã trả lời {totalAnswered}/{totalQ} câu</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Tab warning ── */}
      {showTabWarning && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-semibold">
          ⚠️ Cảnh báo: Chuyển tab bị phát hiện ({tabSwitchCount} lần)!
        </div>
      )}

      {/* ── MCRepairPanel — bổ sung phương án MC bị thiếu trên PDF ──
           Chỉ hiển thị khi:
             • PDF đã tải xong (ready)
             • Chưa nộp bài
             • Có ít nhất 1 câu MC thiếu phương án
      */}
      {repairPanelVisible && (
        <MCRepairPanel
          missingQuestions={missingMC}
          mcAnswers={mcAnswers}
          isSubmitted={isSubmitted}
          onMC={setMC}
        />
      )}

      {/* ── Confirm dialog ── */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-gray-800 mb-2">📤 Xác nhận nộp bài</h3>
            <div className="text-sm text-gray-600 space-y-1 mb-4">
              <p>Đã trả lời: <strong>{totalAnswered}/{totalQ}</strong> câu</p>
              {totalAnswered < totalQ && (
                <p className="text-orange-600">⚠ Còn {totalQ - totalAnswered} câu chưa làm</p>
              )}
              <p>Thời gian còn lại: <strong>{fmtTimer(timeLeft)}</strong></p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirm(false)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
                Làm tiếp
              </button>
              <button onClick={() => handleSubmit(false)}
                className="flex-1 py-2 bg-teal-600 text-white rounded-lg font-semibold hover:bg-teal-700">
                Nộp bài
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── FallbackAnswerPanel — Beautiful split panel ─────────────────────────────

const MC_OPT_COLORS: Record<string, {idle:string;active:string}> = {
  A: {idle:'border-gray-200 text-gray-600 hover:border-pink-300 hover:bg-pink-50',    active:'bg-pink-500 border-pink-500 text-white shadow-sm shadow-pink-200'},
  B: {idle:'border-gray-200 text-gray-600 hover:border-sky-300 hover:bg-sky-50',      active:'bg-sky-500 border-sky-500 text-white shadow-sm shadow-sky-200'},
  C: {idle:'border-gray-200 text-gray-600 hover:border-green-300 hover:bg-green-50',  active:'bg-green-500 border-green-500 text-white shadow-sm shadow-green-200'},
  D: {idle:'border-gray-200 text-gray-600 hover:border-orange-300 hover:bg-orange-50',active:'bg-orange-500 border-orange-500 text-white shadow-sm shadow-orange-200'},
};

interface FallbackProps {
  mcQuestions : any[];
  tfQuestions : any[];
  saQuestions : any[];
  mcAnswers   : MCAnswers;
  tfAnswers   : TFAnswers;
  saAnswers   : SAAnswers;
  isSubmitted : boolean;
  onMC: (n: number, l: string) => void;
  onTF: (n: number, l: string, v: string) => void;
  onSA: (n: number, v: string) => void;
}

const FallbackAnswerPanel: React.FC<FallbackProps> = ({
  mcQuestions, tfQuestions, saQuestions,
  mcAnswers, tfAnswers, saAnswers,
  isSubmitted, onMC, onTF, onSA,
}) => {
  const totalQ     = mcQuestions.length + tfQuestions.length + saQuestions.length;
  const answeredMC = mcQuestions.filter(q => mcAnswers[q.number]).length;
  const answeredTF = tfQuestions.filter(q => {
    const c = tfAnswers[q.number] || [];
    return c.filter(Boolean).length === 4;
  }).length;
  const answeredSA    = saQuestions.filter(q => saAnswers[q.number]?.trim()).length;
  const totalAnswered = answeredMC + answeredTF + answeredSA;
  const pct = totalQ > 0 ? Math.round((totalAnswered / totalQ) * 100) : 0;

  return (
    <div className="w-[340px] shrink-0 flex flex-col bg-white border-l border-slate-200 shadow-[-4px_0_16px_rgba(0,0,0,.06)] h-full overflow-hidden">

      {/* ── Header ── */}
      <div className="bg-gradient-to-br from-teal-600 to-teal-700 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-white font-bold text-sm">📝 Bảng trả lời</p>
            <p className="text-teal-200 text-xs mt-0.5">
              {isSubmitted ? '✅ Đã nộp bài' : `${totalAnswered}/${totalQ} câu đã trả lời`}
            </p>
          </div>
          <div className="bg-white/20 rounded-full px-3 py-1">
            <span className="text-white text-sm font-black">{pct}%</span>
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-1.5 bg-teal-800/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-white rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">

        {/* PHẦN I — MC */}
        {mcQuestions.length > 0 && (
          <div className="p-3 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="flex-1 text-xs font-bold text-slate-500 uppercase tracking-wider">Phần I — Trắc nghiệm</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${answeredMC===mcQuestions.length?'bg-teal-100 text-teal-700':'bg-gray-100 text-gray-500'}`}>
                {answeredMC}/{mcQuestions.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {mcQuestions.map(q => (
                <div key={q.number} className="flex items-center gap-2">
                  <span className={`text-xs font-semibold w-14 text-center py-0.5 rounded-full shrink-0 transition ${mcAnswers[q.number]?'bg-teal-600 text-white':'bg-slate-100 text-slate-500'}`}>
                    Câu {q.number}
                  </span>
                  <div className="flex gap-1">
                    {['A','B','C','D'].map(l => {
                      const col    = MC_OPT_COLORS[l];
                      const active = mcAnswers[q.number] === l;
                      return (
                        <button key={l} onClick={() => !isSubmitted && onMC(q.number, l)}
                          className={`w-8 h-8 rounded-full text-xs font-bold border-2 transition-all ${active ? col.active : col.idle} ${isSubmitted ? 'cursor-default' : 'cursor-pointer'}`}>
                          {l}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PHẦN II — TF */}
        {tfQuestions.length > 0 && (
          <div className="p-3 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="flex-1 text-xs font-bold text-slate-500 uppercase tracking-wider">Phần II — Đúng / Sai</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${answeredTF===tfQuestions.length?'bg-teal-100 text-teal-700':'bg-gray-100 text-gray-500'}`}>
                {answeredTF}/{tfQuestions.length}
              </span>
            </div>
            <div className="space-y-2">
              {tfQuestions.map((q, qi) => {
                const cells    = tfAnswers[q.number] || ['','','',''];
                const fullDone = cells.filter(Boolean).length === 4;
                return (
                  <div key={q.number} className={`rounded-xl border p-2.5 transition ${fullDone?'border-teal-200 bg-teal-50/40':'border-slate-200 bg-slate-50/50'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${fullDone?'bg-teal-500 text-white':'bg-slate-300 text-slate-700'}`}>
                        Câu {qi + 1}
                      </span>
                      {fullDone && <span className="text-teal-500 text-xs font-bold">✓</span>}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {['a','b','c','d'].map((lbl, i) => {
                        const dotColor = ['bg-pink-400','bg-sky-400','bg-green-500','bg-orange-400'][i];
                        return (
                          <div key={lbl} className="flex flex-col items-center gap-1">
                            <span className={`w-5 h-5 rounded-full ${dotColor} flex items-center justify-center text-white text-[9px] font-black`}>
                              {lbl.toUpperCase()}
                            </span>
                            {['Đ','S'].map(v => {
                              const active = cells[i] === v;
                              return (
                                <button key={v} onClick={() => !isSubmitted && onTF(q.number, lbl, v)}
                                  className={`w-full text-[11px] py-0.5 rounded-md font-black transition border ${
                                    active
                                      ? v==='Đ' ? 'bg-green-500 border-green-500 text-white' : 'bg-red-500 border-red-500 text-white'
                                      : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                                  } ${isSubmitted?'cursor-default':''}`}>
                                  {v}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PHẦN III — SA */}
        {saQuestions.length > 0 && (
          <div className="p-3">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="flex-1 text-xs font-bold text-slate-500 uppercase tracking-wider">Phần III — Trả lời ngắn</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${answeredSA===saQuestions.length?'bg-teal-100 text-teal-700':'bg-gray-100 text-gray-500'}`}>
                {answeredSA}/{saQuestions.length}
              </span>
            </div>
            <div className="space-y-2">
              {saQuestions.map((q, qi) => {
                const val    = saAnswers[q.number] || '';
                const filled = val.trim().length > 0;
                return (
                  <div key={q.number} className={`flex items-center gap-2 p-2 rounded-xl border transition ${filled?'border-blue-200 bg-blue-50/40':'border-slate-200 bg-slate-50/50'}`}>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full shrink-0 transition ${filled?'bg-blue-500 text-white':'bg-slate-200 text-slate-600'}`}>
                      Câu {qi+1}
                    </span>
                    <input
                      type="text"
                      value={val}
                      onChange={e => !isSubmitted && onSA(q.number, e.target.value)}
                      disabled={isSubmitted}
                      maxLength={8}
                      className={`flex-1 border rounded-lg px-2.5 py-1.5 text-sm font-semibold focus:outline-none transition ${
                        filled
                          ? 'border-blue-300 bg-white text-blue-700 focus:ring-2 focus:ring-blue-300'
                          : 'border-slate-200 bg-white text-slate-700 focus:border-teal-400 focus:ring-2 focus:ring-teal-200'
                      } ${isSubmitted ? 'cursor-default' : ''}`}
                      placeholder="Nhập đáp án…"
                    />
                    {filled && <span className="text-blue-400 font-bold text-sm shrink-0">✓</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {totalQ === 0 && (
          <div className="p-8 text-center text-slate-400">
            <p className="text-3xl mb-2">📋</p>
            <p className="text-sm">Chưa có câu hỏi</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PDFOverlayExamRoom;
