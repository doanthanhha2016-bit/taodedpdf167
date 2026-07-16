// src/components/PDFExamRoom.tsx
// Phòng thi dạng PDF: Đã thêm chức năng Tự luận, Lời giải hiển thị Full PDF & Kiểm tra quyền xem lời giải
// Auto-routing: nếu exam.overlayMode === true → dùng PDFOverlayExamRoom

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Room, Exam, StudentInfo, Submission, QuestionSolutionRange } from '../types';
import {
  ensureSignedIn,
  createSubmission,
  submitExam,
  subscribeToRoom,
} from '../services/firebaseService';
import { getTabDetectionService } from '../services/tabDetectionService';
import { useExamSession, generateSessionId } from '../services/sessionService';
import EssayQuestionInput from './EssayQuestionInput';
import PDFOverlayExamRoom from './PDFOverlayExamRoom';

// ─── Types ────────────────────────────────────────────────────────────────────

type MCAnswers = { [n: number]: string };
type TFAnswers = { [n: number]: string[] };
type SAAnswers = { [n: number]: string };
type WritingAnswers = { [n: number]: string };

function mergeAnswers(mc: MCAnswers, tf: TFAnswers, sa: SAAnswers, writing: WritingAnswers): { [n: number]: string } {
  const all: { [n: number]: string } = {};
  Object.entries(mc).forEach(([k, v]) => { if (v) all[Number(k)] = v; });
  Object.entries(tf).forEach(([k, v]) => {
    const hasAny = (v || []).some(x => x === 'Đ' || x === 'S');
    if (hasAny) {
      const obj: Record<string, boolean> = {};
      ['a', 'b', 'c', 'd'].forEach((lbl, i) => { obj[lbl] = v[i] === 'Đ'; });
      all[Number(k)] = JSON.stringify(obj);
    }
  });
  Object.entries(sa).forEach(([k, v]) => { if (v?.trim()) all[Number(k)] = v.trim(); });
  Object.entries(writing).forEach(([k, v]) => { if (v?.trim()) all[Number(k)] = v; });
  return all;
}

function formatTimer(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function optionBg(letter: string, selected: boolean) {
  if (!selected) return 'bg-gray-100 text-gray-700 hover:bg-gray-200';
  const map: Record<string, string> = {
    A: 'bg-pink-500 text-white',
    B: 'bg-sky-500 text-white',
    C: 'bg-green-500 text-white',
    D: 'bg-orange-500 text-white',
  };
  return map[letter] || 'bg-gray-400 text-white';
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PDFExamRoomProps {
  room: Room;
  exam: Exam;
  student: StudentInfo;
  existingSubmissionId?: string;
  onSubmitted: (submission: Submission) => void;
  onExit: () => void;
}

// ─── Draggable Divider ────────────────────────────────────────────────────────

function useHorizontalSplit(defaultPercent = 62) {
  const [splitPct, setSplitPct] = useState(defaultPercent);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const clamp = (v: number) => Math.min(80, Math.max(30, v));

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setSplitPct(clamp(pct));
  }, []);

  const onPointerUp = useCallback(() => { dragging.current = false; }, []);
  const snapTo = useCallback((pct: number) => setSplitPct(clamp(pct)), []);
  const dragHandleProps = { onPointerDown, onPointerMove, onPointerUp };

  return { splitPct, dragHandleProps, containerRef, snapTo };
}

// ─── SolutionViewer ───────────────────────────────────────────────────────────
// Hiển thị ở panel trái sau khi học sinh nộp bài

interface SolutionViewerProps {
  solutionFileId: string;
  questionSolutions?: { [qNum: number]: QuestionSolutionRange };
}

const SolutionViewer: React.FC<SolutionViewerProps> = ({ solutionFileId, questionSolutions }) => {
  const hasRanges = questionSolutions && Object.keys(questionSolutions).length > 0;
  const sortedQNums = hasRanges ? Object.keys(questionSolutions).map(Number).sort((a, b) => a - b) : [];
  const [activeQ, setActiveQ] = useState<number | null>(sortedQNums[0] ?? null);
  const [iframeKey, setIframeKey] = useState(0);

  const buildSrc = (qNum: number | null): string => {
    const base = `https://drive.google.com/file/d/${solutionFileId}/preview`;
    // Nếu có range thì dẫn tới trang cụ thể, nếu mode 'full' thì hiển thị gốc
    if (hasRanges && qNum && questionSolutions?.[qNum]) {
      return `${base}#page=${questionSolutions[qNum].pageStart}`;
    }
    return base;
  };

  const [iframeSrc, setIframeSrc] = useState(() => buildSrc(sortedQNums[0] ?? null));

  const goTo = (qNum: number) => {
    setActiveQ(qNum);
    setIframeSrc(buildSrc(qNum));
    setIframeKey(k => k + 1); // force iframe reload để navigate đúng trang
  };

  const range = activeQ && hasRanges && questionSolutions ? questionSolutions[activeQ] : null;

  return (
    <div className="h-full flex flex-col bg-gray-900">

      {/* Header */}
      <div className="bg-purple-700 text-white px-3 py-2 flex items-center gap-2 shrink-0">
        <span className="text-base">📚</span>
        <span className="font-bold text-sm">Lời giải</span>
        {range && activeQ && (
          <span className="ml-auto text-xs text-purple-200 bg-purple-800 px-2 py-0.5 rounded-full">
            Câu {activeQ} · trang {range.pageStart}
            {range.pageEnd > range.pageStart ? `–${range.pageEnd}` : ''}
          </span>
        )}
      </div>

      {/* Question tabs (chỉ hiển thị nếu có range - Mode Split) */}
      {hasRanges && (
        <div className="shrink-0 bg-gray-800 px-2 py-2 flex flex-wrap gap-1 overflow-y-auto"
          style={{ maxHeight: '72px' }}>
          {sortedQNums.map(qn => (
            <button
              key={qn}
              onClick={() => goTo(qn)}
              title={questionSolutions?.[qn] ? `Câu ${qn}: trang ${questionSolutions[qn].pageStart}–${questionSolutions[qn].pageEnd}` : ''}
              className={`px-2 py-0.5 rounded text-xs font-bold transition
                ${activeQ === qn
                  ? 'bg-purple-500 text-white shadow'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              C{qn}
            </button>
          ))}
          {sortedQNums.length === 0 && (
            <span className="text-gray-500 text-xs py-1 px-2">Chưa có dữ liệu câu</span>
          )}
        </div>
      )}

      {/* Drive PDF iframe */}
      <iframe
        key={iframeKey}
        src={iframeSrc}
        className="flex-1 w-full border-0"
        title="Lời giải PDF"
        allow="autoplay"
      />

      {/* Hint footer */}
      {range && activeQ && (
        <div className="shrink-0 bg-gray-800 px-3 py-1.5 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            📄 Câu {activeQ} — trang {range.pageStart}
            {range.pageEnd > range.pageStart ? ` đến ${range.pageEnd}` : ''}
          </span>
          <div className="flex gap-1">
            {sortedQNums.indexOf(activeQ) > 0 && (
              <button
                onClick={() => goTo(sortedQNums[sortedQNums.indexOf(activeQ) - 1])}
                className="text-xs text-gray-400 hover:text-white px-2 py-0.5 rounded hover:bg-gray-700 transition"
              >
                ← Câu trước
              </button>
            )}
            {sortedQNums.indexOf(activeQ) < sortedQNums.length - 1 && (
              <button
                onClick={() => goTo(sortedQNums[sortedQNums.indexOf(activeQ) + 1])}
                className="text-xs text-gray-400 hover:text-white px-2 py-0.5 rounded hover:bg-gray-700 transition"
              >
                Câu sau →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Component chính ──────────────────────────────────────────────────────────

const PDFExamRoom: React.FC<PDFExamRoomProps> = ({
  room, exam, student, existingSubmissionId, onSubmitted, onExit,
}) => {
  // ── Auto-routing: dùng Overlay khi có Drive file VÀ không bị tắt tường minh ──
  // overlayMode === false  → dùng panel cũ (giáo viên chọn "Panel bên phải")
  // overlayMode === true   → overlay
  // overlayMode undefined  → overlay nếu có pdfDriveFileId (exam cũ tạo trước khi có toggle)
  const hasDriveFile = !!(exam as any).pdfDriveFileId;
  const useOverlay   = (exam as any).overlayMode !== false && hasDriveFile;

  if (useOverlay) {
    return (
      <PDFOverlayExamRoom
        room={room} exam={exam} student={student}
        existingSubmissionId={existingSubmissionId}
        onSubmitted={onSubmitted} onExit={onExit}
      />
    );
  }

  const mcQuestions = exam.questions.filter(q => q.type === 'multiple_choice');
  const tfQuestions = exam.questions.filter(q => q.type === 'true_false');
  const saQuestions = exam.questions.filter(q => q.type === 'short_answer');
  const writingQuestions = exam.questions.filter(q => q.type === 'writing');

  const [mcAnswers, setMcAnswers] = useState<MCAnswers>({});
  const [tfAnswers, setTfAnswers] = useState<TFAnswers>({});
  const [saAnswers, setSaAnswers] = useState<SAAnswers>({});
  const [writingAnswers, setWritingAnswers] = useState<WritingAnswers>({});

  const [submissionId, setSubmissionId] = useState<string | undefined>(existingSubmissionId);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [tabWarnings, setTabWarnings] = useState<Date[]>([]);
  const [showTabWarning, setShowTabWarning] = useState(false);

  const [timeLeft, setTimeLeft] = useState(room.timeLimit * 60);
  const timerRed = timeLeft <= 5 * 60;

  const [leftPanel, setLeftPanel] = useState<'exam' | 'solution'>('exam');

  const { splitPct, dragHandleProps, containerRef, snapTo } = useHorizontalSplit(62);
  const sessionIdRef = useRef(generateSessionId());

  // Nguồn PDF đề thi
  const drivePdfUrl = (exam as any).pdfDriveUrl as string | undefined;
  const driveFileId = (exam as any).pdfDriveFileId as string | undefined;
  const pdfBase64   = (exam as any).pdfBase64 as string | undefined;
  const drivePreviewUrl = driveFileId
    ? `https://drive.google.com/file/d/${driveFileId}/preview`
    : drivePdfUrl?.replace('/view', '/preview');

  // Nguồn PDF lời giải
  const solutionFileId      = (exam as any).solutionPdfDriveFileId as string | undefined;
  const questionSolutions   = (exam as any).questionSolutions as { [qNum: number]: QuestionSolutionRange } | undefined;
  
  // ✅ FIX: Chỉ hiện tùy chọn Lời giải nếu có File ID VÀ giáo viên cho phép (showExplanations)
  const canShowExplanations = room.settings?.showExplanations ?? true;
  const hasSolution         = !!solutionFileId && canShowExplanations;

  const totalQ        = mcQuestions.length + tfQuestions.length + saQuestions.length + writingQuestions.length;
  const answeredMC    = Object.values(mcAnswers).filter(Boolean).length;
  const answeredTF    = Object.values(tfAnswers).filter(v => (v || []).some(x => x === 'Đ' || x === 'S')).length;
  const answeredSA    = Object.values(saAnswers).filter(v => v?.trim()).length;
  const answeredWR    = Object.values(writingAnswers).filter(v => v?.trim()).length;
  const totalAnswered = answeredMC + answeredTF + answeredSA + answeredWR;
  const progress      = totalQ > 0 ? Math.round((totalAnswered / totalQ) * 100) : 0;

  // Giám sát realtime
  const { reportTabSwitch, updateProgress, submitSession } = useExamSession({
    roomId: room.id,
    studentId: student.id,
    studentName: student.name,
    sessionId: sessionIdRef.current,
    className: student.className,
    totalQuestions: totalQ,
    onKicked: (deviceInfo) => {
      alert(`⚠️ Tài khoản đăng nhập trên thiết bị khác!\nThiết bị: ${deviceInfo}\n\nBạn sẽ bị đưa ra khỏi phòng thi.`);
      onExit();
    },
  });

  // Tạo submission
  useEffect(() => {
    if (existingSubmissionId) return;
    const init = async () => {
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
    };
    init().catch(console.error);
  }, []);

  // Timer
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

  // Sync progress
  useEffect(() => {
    if (!isSubmitted) updateProgress(totalAnswered, timeLeft);
  }, [totalAnswered, timeLeft, isSubmitted, updateProgress]);

  // Tab detection
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

  // Answer handlers
  const setMC = (qNum: number, letter: string) => setMcAnswers(p => ({ ...p, [qNum]: p[qNum] === letter ? '' : letter }));
  const setTF = (qNum: number, idx: number, val: string) => setTfAnswers(p => { const cur = p[qNum] || ['', '', '', '']; const next = [...cur]; next[idx] = next[idx] === val ? '' : val; return { ...p, [qNum]: next }; });
  const setSA = (qNum: number, val: string) => setSaAnswers(p => ({ ...p, [qNum]: val }));
  const setWR = (qNum: number, val: string) => setWritingAnswers(p => ({ ...p, [qNum]: val }));

  // Submit
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
      if (submission) {
        setIsSubmitted(true);
        // Tự động mở lời giải nếu có & được quyền xem
        if (hasSolution) setLeftPanel('solution');
        onSubmitted(submission);
      }
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
      <div className="bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-2 shrink-0 z-10 shadow-sm">
        <button onClick={onExit}
          className="text-gray-500 hover:text-gray-700 text-xs px-2 py-1 border border-gray-200 rounded-lg shrink-0">
          ✕
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800 text-sm truncate">{exam.title}</p>
          <p className="text-xs text-gray-500 truncate">
            {student.name}{student.className ? ` · ${student.className}` : ''}
          </p>
        </div>

        {/* ✅ Toggle Đề thi / Lời giải (chỉ hiện sau khi nộp & có lời giải & cho phép xem) */}
        {isSubmitted && hasSolution && (
          <div className="hidden sm:flex items-center gap-1 shrink-0 bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setLeftPanel('exam')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition
                ${leftPanel === 'exam' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
            >
              📄 Đề thi
            </button>
            <button
              onClick={() => setLeftPanel('solution')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition
                ${leftPanel === 'solution' ? 'bg-purple-600 shadow text-white' : 'text-gray-500 hover:text-gray-700'}`}
            >
              📚 Lời giải
            </button>
          </div>
        )}

        {/* Link Drive đề thi */}
        {drivePdfUrl && leftPanel === 'exam' && (
          <a href={drivePdfUrl} target="_blank" rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1 shrink-0 text-xs text-blue-600 border border-blue-200
              px-2 py-1 rounded-lg hover:bg-blue-50 transition" title="Mở đề thi full tab">
            🔗 Mở Drive
          </a>
        )}

        {/* Progress */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <div className="w-28 bg-gray-200 rounded-full h-2">
            <div className="bg-teal-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-gray-600">{totalAnswered}/{totalQ}</span>
        </div>

        {/* Timer */}
        <div className={`font-mono font-bold px-2.5 py-1.5 rounded-lg text-sm shrink-0
          ${timerRed ? 'bg-red-100 text-red-700 animate-pulse' : 'bg-teal-100 text-teal-800'}`}>
          ⏱ {isSubmitted ? '✅' : formatTimer(timeLeft)}
        </div>

        {/* Nộp */}
        <button onClick={() => setShowConfirm(true)} disabled={isSubmitting || isSubmitted}
          className="shrink-0 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm font-semibold
            disabled:opacity-50 hover:bg-teal-700 transition">
          {isSubmitting ? '⏳' : isSubmitted ? 'Đã nộp' : '📤 Nộp'}
        </button>
      </div>

      {/* ══ Mobile toggle (sau khi nộp) ══ */}
      {isSubmitted && hasSolution && (
        <div className="sm:hidden flex bg-white border-b border-gray-200 shrink-0">
          <button onClick={() => setLeftPanel('exam')}
            className={`flex-1 py-2 text-xs font-semibold transition border-b-2
              ${leftPanel === 'exam' ? 'border-teal-500 text-teal-700' : 'border-transparent text-gray-500'}`}>
            📄 Đề thi
          </button>
          <button onClick={() => setLeftPanel('solution')}
            className={`flex-1 py-2 text-xs font-semibold transition border-b-2
              ${leftPanel === 'solution' ? 'border-purple-500 text-purple-700' : 'border-transparent text-gray-500'}`}>
            📚 Lời giải
          </button>
        </div>
      )}

      {/* ══ Layout chính ══ */}
      <div ref={containerRef} className="flex-1 flex flex-row overflow-hidden"
        onPointerMove={dragHandleProps.onPointerMove}
        onPointerUp={dragHandleProps.onPointerUp}>

        {/* ── Panel trái: Đề thi hoặc Lời giải ── */}
        <div className="overflow-hidden shrink-0 flex flex-col" style={{ width: `${splitPct}%` }}>

          {/* Lời giải (sau khi nộp) */}
          {isSubmitted && leftPanel === 'solution' && hasSolution ? (
            <SolutionViewer
              solutionFileId={solutionFileId!}
              questionSolutions={questionSolutions}
            />
          ) : (
            // Đề thi
            drivePreviewUrl ? (
              <iframe src={drivePreviewUrl} className="w-full h-full border-0" title="Đề thi PDF" allow="autoplay" />
            ) : pdfBase64 ? (
              <embed src={`data:application/pdf;base64,${pdfBase64}`} type="application/pdf" className="w-full h-full" title="Đề thi PDF" />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 bg-gray-800">
                <span className="text-5xl">📄</span>
                <p className="text-sm">Không tìm thấy file PDF</p>
                {drivePdfUrl && (
                  <a href={drivePdfUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline text-sm">Mở Drive →</a>
                )}
              </div>
            )
          )}
        </div>

        {/* ── Drag handle ── */}
        <div className="shrink-0 relative select-none touch-none z-20 flex flex-col" style={{ width: '24px' }}
          onPointerDown={dragHandleProps.onPointerDown}
          onPointerMove={dragHandleProps.onPointerMove}
          onPointerUp={dragHandleProps.onPointerUp}>
          <div className="absolute inset-0 bg-gray-200 cursor-col-resize flex items-center justify-center">
            <div className="flex flex-col gap-1">
              {[...Array(5)].map((_, i) => <div key={i} className="w-1 h-1 rounded-full bg-gray-400" />)}
            </div>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none">
            {[{ pct: 78, label: '◀' }, { pct: 62, label: '●' }, { pct: 45, label: '▶' }].map(({ pct, label }) => (
              <button key={pct}
                onPointerDown={e => e.stopPropagation()}
                onClick={() => snapTo(pct)}
                className="pointer-events-auto w-5 h-5 bg-white border border-gray-300 rounded text-gray-500 flex items-center justify-center shadow-sm active:bg-gray-100"
                style={{ fontSize: '8px' }}
              >{label}</button>
            ))}
          </div>
        </div>

        {/* ── Panel phải: Bài làm ── */}
        <div className="flex-1 overflow-y-auto bg-white min-w-0">
          <AnswerPanel
            mcQuestions={mcQuestions}
            tfQuestions={tfQuestions}
            saQuestions={saQuestions}
            writingQuestions={writingQuestions}
            mcAnswers={mcAnswers}
            tfAnswers={tfAnswers}
            saAnswers={saAnswers}
            writingAnswers={writingAnswers}
            answeredMC={answeredMC}
            answeredTF={answeredTF}
            answeredSA={answeredSA}
            answeredWR={answeredWR}
            isSubmitted={isSubmitted}
            isSubmitting={isSubmitting}
            pdfDriveUrl={drivePdfUrl}
            hasSolution={hasSolution}
            onShowSolution={() => setLeftPanel('solution')}
            onMC={setMC} onTF={setTF} onSA={setSA} onWR={setWR}
            onSubmit={() => setShowConfirm(true)}
          />
        </div>
      </div>

      {/* Tab warning */}
      {showTabWarning && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-semibold">
          ⚠️ Cảnh báo: Chuyển tab bị phát hiện ({tabSwitchCount} lần)!
        </div>
      )}

      {/* Confirm dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-gray-800 mb-2">📤 Xác nhận nộp bài</h3>
            <div className="text-sm text-gray-600 space-y-1 mb-4">
              <p>Bạn đã trả lời: <strong>{totalAnswered}/{totalQ}</strong> câu</p>
              {totalAnswered < totalQ && <p className="text-orange-600">⚠ Còn {totalQ - totalAnswered} câu chưa làm</p>}
              <p>Thời gian còn lại: <strong>{formatTimer(timeLeft)}</strong></p>
              {hasSolution && <p className="text-purple-700 text-xs">📚 Sẽ xem được lời giải sau khi nộp</p>}
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

// ─── AnswerPanel ──────────────────────────────────────────────────────────────

interface AnswerPanelProps {
  mcQuestions: any[];
  tfQuestions: any[];
  saQuestions: any[];
  writingQuestions: any[];
  mcAnswers: MCAnswers;
  tfAnswers: TFAnswers;
  saAnswers: SAAnswers;
  writingAnswers: WritingAnswers;
  answeredMC: number;
  answeredTF: number;
  answeredSA: number;
  answeredWR: number;
  isSubmitted: boolean;
  isSubmitting: boolean;
  pdfDriveUrl?: string;
  hasSolution?: boolean;
  onShowSolution?: () => void;
  onMC: (qNum: number, letter: string) => void;
  onTF: (qNum: number, idx: number, val: string) => void;
  onSA: (qNum: number, val: string) => void;
  onWR: (qNum: number, val: string) => void;
  onSubmit: () => void;
}

const AnswerPanel: React.FC<AnswerPanelProps> = ({
  mcQuestions, tfQuestions, saQuestions, writingQuestions,
  mcAnswers, tfAnswers, saAnswers, writingAnswers,
  answeredMC, answeredTF, answeredSA, answeredWR,
  isSubmitted, isSubmitting,
  pdfDriveUrl, hasSolution, onShowSolution,
  onMC, onTF, onSA, onWR, onSubmit,
}) => (
  <div className="p-4 space-y-8">

    {/* ✅ Banner sau khi nộp bài */}
    {isSubmitted && (
      <div className="space-y-2">
        {/* Link đề thi */}
        {pdfDriveUrl && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-3">
            <span className="text-xl">📎</span>
            <div>
              <p className="text-sm font-semibold text-blue-800">Xem lại đề thi</p>
              <a href={pdfDriveUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 underline break-all hover:text-blue-800">
                {pdfDriveUrl}
              </a>
            </div>
          </div>
        )}
        {/* ✅ Nút xem lời giải */}
        {hasSolution && onShowSolution && (
          <button onClick={onShowSolution}
            className="w-full py-2.5 bg-purple-600 text-white rounded-xl font-semibold text-sm
              hover:bg-purple-700 transition flex items-center justify-center gap-2 shadow-md">
            <span>📚</span>
            <span>Xem lời giải</span>
            <span className="text-purple-200 text-xs">← Panel trái</span>
          </button>
        )}
      </div>
    )}

    {/* PHẦN I – MC */}
    {mcQuestions.length > 0 && (
      <section>
        <div className="inline-block bg-teal-600 text-white px-4 py-1.5 rounded-full text-sm font-bold shadow-sm mb-4">
          🔘 PHẦN I — Trắc nghiệm ({answeredMC}/{mcQuestions.length})
        </div>
        <div className="space-y-2">
          {mcQuestions.map(q => (
            <div key={q.number} className="flex items-center gap-3 p-3 bg-cyan-50/50 border border-cyan-100 rounded-2xl">
              <span className="bg-teal-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shrink-0 shadow-sm">
                Câu {q.number}
              </span>
              <div className="flex gap-1.5 flex-wrap">
                {['A', 'B', 'C', 'D'].map(l => (
                  <button key={l} onClick={() => onMC(q.number, l)} disabled={isSubmitted}
                    className={`w-9 h-9 rounded-full text-sm font-bold transition shadow-sm ${optionBg(l, mcAnswers[q.number] === l)}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    )}

    {/* PHẦN II – TF */}
    {tfQuestions.length > 0 && (
      <section>
        <div className="inline-block bg-teal-600 text-white px-4 py-1.5 rounded-full text-sm font-bold shadow-sm mb-4">
          ☑️ PHẦN II — Đúng/Sai ({answeredTF}/{tfQuestions.length})
        </div>
        <div className="space-y-3">
          {tfQuestions.map((q, idx) => {
            const cells = tfAnswers[q.number] || ['', '', '', ''];
            return (
              <div key={q.number} className="bg-cyan-50/50 border border-cyan-100 rounded-2xl p-4">
                <div className="inline-block bg-teal-500 text-white text-xs font-bold px-3 py-1 rounded-full mb-3 shadow-sm">
                  Câu {idx + 1}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {['a', 'b', 'c', 'd'].map((lbl, i) => (
                    <div key={lbl} className="flex flex-col items-center gap-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-gray-700 bg-gray-200 border border-gray-300">{lbl}</div>
                      <div className="flex gap-1">
                        {['Đ', 'S'].map(v => (
                          <button key={v} onClick={() => onTF(q.number, i, v)} disabled={isSubmitted}
                            className={`px-2.5 py-1 rounded text-xs font-bold transition-all shadow-sm
                              ${cells[i] === v
                                ? (v === 'Đ' ? 'bg-green-500 text-white' : 'bg-red-500 text-white')
                                : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    )}

    {/* PHẦN III – SA */}
    {saQuestions.length > 0 && (
      <section>
        <div className="inline-block bg-teal-600 text-white px-4 py-1.5 rounded-full text-sm font-bold shadow-sm mb-4">
          ✍️ PHẦN III — Trả lời ngắn ({answeredSA}/{saQuestions.length})
        </div>
        <div className="space-y-3">
          {saQuestions.map((q, idx) => {
            const currentVal = (saAnswers[q.number] || '').padEnd(4, ' ');
            const charArray = currentVal.split('').slice(0, 4);
            return (
              <div key={q.number} className="flex items-center gap-4 p-3 bg-cyan-50/50 border border-cyan-100 rounded-2xl transition">
                <span className="bg-teal-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shrink-0 shadow-sm min-w-[70px] text-center">
                  Câu {idx + 1}
                </span>
                <div className="flex gap-2">
                  {[0, 1, 2, 3].map(charIdx => (
                    <input key={charIdx} id={`sa-${q.number}-${charIdx}`} type="text" maxLength={1}
                      disabled={isSubmitted}
                      value={charArray[charIdx] === ' ' ? '' : charArray[charIdx]}
                      onChange={(e) => {
                        const val = e.target.value;
                        const newStr = (saAnswers[q.number] || '').padEnd(4, ' ').split('');
                        newStr[charIdx] = val ? val[val.length - 1] : ' ';
                        onSA(q.number, newStr.join('').trimEnd());
                        if (val && charIdx < 3) document.getElementById(`sa-${q.number}-${charIdx + 1}`)?.focus();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Backspace' && !charArray[charIdx]?.trim() && charIdx > 0) {
                          document.getElementById(`sa-${q.number}-${charIdx - 1}`)?.focus();
                        }
                      }}
                      className="w-10 h-10 border-2 border-gray-300 rounded-lg text-center font-bold text-lg
                        focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none bg-white
                        disabled:bg-gray-100 shadow-inner"
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    )}

    {/* PHẦN IV – TỰ LUẬN (MỚI) */}
    {writingQuestions.length > 0 && (
      <section>
        <div className="inline-block bg-teal-600 text-white px-4 py-1.5 rounded-full text-sm font-bold shadow-sm mb-4">
          📝 PHẦN IV — Tự luận ({answeredWR}/{writingQuestions.length})
        </div>
        <div className="space-y-4">
          {writingQuestions.map((q, idx) => (
            <div key={q.number} className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
              <p className="font-bold text-gray-800 mb-2">Câu {q.number}:</p>
              <EssayQuestionInput
                value={writingAnswers[q.number] || ''}
                onChange={(val) => onWR(q.number, val)}
                disabled={isSubmitted}
                placeholder="Nhập câu trả lời hoặc đính kèm ảnh bài làm..."
              />
            </div>
          ))}
        </div>
      </section>
    )}

    {/* Submit button */}
    <button onClick={onSubmit} disabled={isSubmitting || isSubmitted}
      className="w-full py-3 bg-teal-600 text-white rounded-xl font-bold text-sm
        disabled:opacity-50 hover:bg-teal-700 transition">
      {isSubmitted ? '✅ Đã nộp bài' : isSubmitting ? '⏳ Đang nộp...' : '📤 Nộp bài'}
    </button>
  </div>
);

export default PDFExamRoom;
