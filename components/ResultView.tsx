// src/components/ResultView.tsx
import React from 'react';
import { Submission, Room, Exam, Question, QuestionOption } from '../types';
import MathText from './MathText';
import { formatScore, parseTFCorrectAnswer, parseTFUserAnswer } from '../services/scoringService';

interface ResultViewProps {
  submission: Submission;
  room: Room;
  exam?: Exam;
  showAnswers?: boolean; // ⚠️ DEPRECATED
  onExit: () => void;
  onRetry?: () => void;
}

const escapeHtml = (s: string) =>
  (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Helper parse JSON của câu Tự luận
const parseWritingAnswer = (raw?: string) => {
  if (!raw) return { text: '', images: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed.text !== undefined || parsed.images !== undefined) {
      return { text: parsed.text || '', images: parsed.images || [] };
    }
  } catch (e) {
    // Fallback
  }
  return { text: raw, images: [] };
};

const ResultView: React.FC<ResultViewProps> = ({
  submission,
  room,
  exam,
  showAnswers = true, // deprecated
  onExit,
  onRetry
}) => {
  // Lấy settings từ room
  const canShowCorrectAnswers = room.settings?.showCorrectAnswers ?? true;
  const canShowExplanations = room.settings?.showExplanations ?? true;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins} phút ${secs} giây`;
  };

  const getGrade = (percentage: number) => {
    if (percentage >= 90) return { grade: 'A+', color: 'text-green-600', bg: 'bg-green-100', emoji: '🏆', label: 'Xuất sắc' };
    if (percentage >= 80) return { grade: 'A', color: 'text-green-600', bg: 'bg-green-100', emoji: '🌟', label: 'Giỏi' };
    if (percentage >= 70) return { grade: 'B+', color: 'text-blue-600', bg: 'bg-blue-100', emoji: '👍', label: 'Khá' };
    if (percentage >= 60) return { grade: 'B', color: 'text-blue-600', bg: 'bg-blue-100', emoji: '📚', label: 'Trung bình khá' };
    if (percentage >= 50) return { grade: 'C', color: 'text-yellow-600', bg: 'bg-yellow-100', emoji: '💪', label: 'Trung bình' };
    if (percentage >= 40) return { grade: 'D', color: 'text-orange-600', bg: 'bg-orange-100', emoji: '📖', label: 'Yếu' };
    return { grade: 'F', color: 'text-red-600', bg: 'bg-red-100', emoji: '😞', label: 'Kém' };
  };

  const gradeInfo = getGrade(submission.percentage);
  const maxScore = exam?.pointsConfig?.maxScore || 10;

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%)' }}>
      {/* Confetti for high scores */}
      {submission.percentage >= 80 && (
        <style>{`
          @keyframes confetti {
            0% { transform: translateY(0) rotate(0deg); opacity: 1; }
            100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
          }
          .confetti {
            position: fixed;
            top: -10px;
            animation: confetti 3s ease-in-out forwards;
          }
        `}</style>
      )}
      {submission.percentage >= 80 && (
        <>
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="confetti text-2xl"
              style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`
              }}
            >
              {['🎉', '⭐', '🌟', '✨', '🎊'][Math.floor(Math.random() * 5)]}
            </div>
          ))}
        </>
      )}

      {/* Header */}
      <div
        className="text-white p-6"
        style={{ background: 'linear-gradient(135deg, #0d9488 0%, #115e59 100%)' }}
      >
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-3xl font-bold mb-2">🎉 Đã nộp bài thành công!</h1>
          <p className="text-teal-100">{room.examTitle}</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        {/* Score Card */}
        <div className="bg-white rounded-3xl shadow-2xl p-8 mb-8">
          {/* Grade Badge */}
          <div className="text-center mb-6">
            <div className={`w-32 h-32 ${gradeInfo.bg} rounded-full flex items-center justify-center mx-auto mb-4`}>
              <div>
                <div className="text-4xl mb-1">{gradeInfo.emoji}</div>
                <div className={`text-3xl font-bold ${gradeInfo.color}`}>{gradeInfo.grade}</div>
              </div>
            </div>
            <div className={`inline-block px-4 py-2 rounded-full ${gradeInfo.bg} ${gradeInfo.color} font-semibold`}>
              {gradeInfo.label}
            </div>
          </div>

          {/* Main Score */}
          <div className="text-center mb-8">
            <div className="text-6xl font-bold mb-2">
              <span className="text-teal-600">{formatScore(submission.totalScore)}</span>
              <span className="text-gray-400">/{maxScore}</span>
            </div>
            <div className="text-3xl font-bold text-gray-500">
              {submission.percentage}%
            </div>
          </div>

          {/* Score Breakdown by Section */}
          {submission.scoreBreakdown && (
            <div className="mb-8">
              <h3 className="text-center text-lg font-bold text-gray-700 mb-4">📊 Chi tiết điểm từng phần</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                
                {/* Multiple Choice */}
                {submission.scoreBreakdown.multipleChoice.total > 0 && (
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border-2 border-blue-300">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">🔘</span>
                      <span className="font-bold text-blue-900 text-sm">Trắc nghiệm</span>
                    </div>
                    <div className="text-2xl font-bold text-blue-600 mb-1">
                      {formatScore(submission.scoreBreakdown.multipleChoice.points)}
                    </div>
                    <div className="text-sm text-blue-700 mb-1">
                      Đúng {submission.scoreBreakdown.multipleChoice.correct}/{submission.scoreBreakdown.multipleChoice.total}
                    </div>
                  </div>
                )}

                {/* True/False */}
                {submission.scoreBreakdown.trueFalse.total > 0 && (
                  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border-2 border-green-300">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">✅</span>
                      <span className="font-bold text-green-900 text-sm">Đúng/Sai</span>
                    </div>
                    <div className="text-2xl font-bold text-green-600 mb-1">
                      {formatScore(submission.scoreBreakdown.trueFalse.points)}
                    </div>
                    <div className="text-sm text-green-700 mb-1">
                      Đúng {submission.scoreBreakdown.trueFalse.correct}/{submission.scoreBreakdown.trueFalse.total}
                    </div>
                  </div>
                )}

                {/* Short Answer */}
                {submission.scoreBreakdown.shortAnswer.total > 0 && (
                  <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4 border-2 border-orange-300">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">✏️</span>
                      <span className="font-bold text-orange-900 text-sm">Trả lời ngắn</span>
                    </div>
                    <div className="text-2xl font-bold text-orange-600 mb-1">
                      {formatScore(submission.scoreBreakdown.shortAnswer.points)}
                    </div>
                    <div className="text-sm text-orange-700 mb-1">
                      Đúng {submission.scoreBreakdown.shortAnswer.correct}/{submission.scoreBreakdown.shortAnswer.total}
                    </div>
                  </div>
                )}

                {/* Thống kê Điểm Tự Luận */}
                {(submission.scoreBreakdown as any).writing?.total > 0 && (
                  <div className="bg-gradient-to-br from-violet-50 to-violet-100 rounded-xl p-4 border-2 border-violet-300">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">📝</span>
                      <span className="font-bold text-violet-900 text-sm">Tự luận</span>
                    </div>
                    <div className="text-2xl font-bold text-violet-600 mb-1">
                      {formatScore((submission.scoreBreakdown as any).writing.points)}
                    </div>
                    <div className="text-sm text-violet-700 mb-1">
                      {Object.keys((submission.scoreBreakdown as any).writing.details || {}).length} câu đã chấm
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Overall Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-green-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{submission.correctCount}</div>
              <div className="text-sm text-green-700">Câu đúng (Auto)</div>
            </div>
            <div className="bg-red-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-red-600">{submission.wrongCount}</div>
              <div className="text-sm text-red-700">Câu sai (Auto)</div>
            </div>
            <div className="bg-blue-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-blue-600">
                {formatDuration(submission.duration).split(' ')[0]}
              </div>
              <div className="text-sm text-blue-700">Phút làm bài</div>
            </div>
          </div>

          {/* Student Info */}
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Họ tên:</span>
                <span className="font-semibold ml-2">{submission.student.name}</span>
              </div>
              {submission.student.className && (
                <div>
                  <span className="text-gray-500">Lớp:</span>
                  <span className="font-semibold ml-2">{submission.student.className}</span>
                </div>
              )}
              <div>
                <span className="text-gray-500">Mã phòng:</span>
                <span className="font-mono font-semibold ml-2">{submission.roomCode}</span>
              </div>
              <div>
                <span className="text-gray-500">Thời gian:</span>
                <span className="font-semibold ml-2">{formatDuration(submission.duration)}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-4 justify-center">
            <button
              onClick={onExit}
              className="px-8 py-3 rounded-xl font-semibold text-teal-600 border-2 border-teal-300 hover:bg-teal-50 transition"
            >
              ← Về trang chủ
            </button>
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-8 py-3 rounded-xl font-bold text-white transition"
                style={{ background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)' }}
              >
                🔄 Làm lại
              </button>
            )}
          </div>
        </div>

        {/* Kiểm tra quyền xem đáp án */}
        {exam && (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            
            {/* ✅ MỚI: Thanh Header tích hợp nút xem PDF Đề thi và PDF Lời giải */}
            <div
              className="p-4 text-white font-bold flex flex-wrap gap-3 items-center justify-between"
              style={{ background: 'linear-gradient(135deg, #f97316 0%, #c2410c 100%)' }}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">📋</span>
                <span>Xem lại bài làm</span>
              </div>

              <div className="flex gap-2">
                {/* Nút xem file Đề thi gốc */}
                {exam.pdfDriveUrl && (
                  <a
                    href={exam.pdfDriveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold transition flex items-center gap-1"
                  >
                    <span>📄</span> Đề thi
                  </a>
                )}

                {/* Nút xem file PDF Lời giải (Chỉ hiện nếu có link và được phép xem) */}
                {exam.solutionPdfDriveUrl && canShowExplanations && (
                  <a
                    href={exam.solutionPdfDriveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-white text-orange-600 rounded-lg text-sm font-bold shadow-sm hover:bg-orange-50 transition flex items-center gap-1"
                  >
                    <span>📚</span> Lời giải PDF
                  </a>
                )}
              </div>
            </div>

            {/* Thông báo nếu không được phép xem đáp án */}
            {!canShowCorrectAnswers && !canShowExplanations && (
              <div className="p-8 text-center">
                <div className="text-6xl mb-4">🔒</div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">Không thể xem đáp án</h3>
                <p className="text-gray-600">
                  Giáo viên chưa cho phép xem đáp án và lời giải cho bài thi này.
                </p>
              </div>
            )}

            {/* Hiển thị bài làm với các quyền tương ứng */}
            {(canShowCorrectAnswers || canShowExplanations) && (
              <div className="divide-y divide-gray-100">
                {/* Thông báo giới hạn quyền */}
                {(!canShowCorrectAnswers || !canShowExplanations) && (
                  <div className="p-4 bg-yellow-50 border-l-4 border-yellow-500">
                    <div className="flex items-start gap-2">
                      <span className="text-2xl">ℹ️</span>
                      <div className="flex-1">
                        <p className="font-semibold text-yellow-800">Thông báo:</p>
                        <ul className="text-sm text-yellow-700 mt-1 list-disc list-inside">
                          {!canShowCorrectAnswers && <li>Không được phép xem đáp án đúng</li>}
                          {!canShowExplanations && <li>Không được phép xem lời giải chi tiết</li>}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {exam.questions.map((q: Question) => {
                  const userAnswer = submission.answers[q.number];
                  const correctAnswer = q.correctAnswer || '';

                  if (q.type === 'true_false') {
                    return (
                      <TrueFalseReview
                        key={q.number}
                        question={q}
                        userAnswer={userAnswer}
                        correctAnswer={correctAnswer}
                        showCorrectAnswers={canShowCorrectAnswers}
                        showExplanations={canShowExplanations}
                        breakdown={submission.scoreBreakdown?.trueFalse?.details?.[q.number]}
                      />
                    );
                  } else if (q.type === 'short_answer') {
                    return (
                      <ShortAnswerReview
                        key={q.number}
                        question={q}
                        userAnswer={userAnswer}
                        correctAnswer={correctAnswer}
                        showCorrectAnswers={canShowCorrectAnswers}
                        showExplanations={canShowExplanations}
                      />
                    );
                  } else if (q.type === 'writing') {
                    const sectionConfig = exam.pointsConfig?.sections.find(s => s.sectionId === q.part || s.questionType === 'writing');
                    const maxPts = sectionConfig?.pointsPerQuestion || 0;
                    return (
                      <WritingReview
                        key={q.number}
                        question={q}
                        userAnswer={userAnswer}
                        showExplanations={canShowExplanations}
                        breakdown={(submission.scoreBreakdown as any).writing?.details?.[q.number]}
                        maxPoints={maxPts}
                      />
                    );
                  } else {
                    return (
                      <MultipleChoiceReview
                        key={q.number}
                        question={q}
                        userAnswer={userAnswer}
                        correctAnswer={correctAnswer}
                        showCorrectAnswers={canShowCorrectAnswers}
                        showExplanations={canShowExplanations}
                      />
                    );
                  }
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Review Tự Luận (Render MathText và Hình ảnh đẹp mắt)
// ============================================================================
const WritingReview: React.FC<{
  question: Question;
  userAnswer?: string;
  showExplanations: boolean;
  breakdown?: { points: number; feedback?: string };
  maxPoints: number;
}> = ({ question, userAnswer, showExplanations, breakdown, maxPoints }) => {
  const ansData = parseWritingAnswer(userAnswer);
  const hasAnswer = ansData.text.trim() !== '' || ansData.images.length > 0;
  const isGraded = !!breakdown;

  return (
    <div className="p-4 bg-gray-50">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-violet-500 text-white flex items-center justify-center font-bold text-sm">
          {question.number % 100}
        </div>
        <div className="flex-1">
          {/* Câu hỏi */}
          <div className="text-gray-800 mb-3">
            <MathText html={question.text || ''} block />
            <span className="ml-2 px-2 py-0.5 bg-violet-100 text-violet-700 text-xs rounded-full">Tự luận</span>
          </div>

          {/* Điểm AI / Giáo viên chấm */}
          {isGraded && (
            <div className="mb-4 p-3 bg-violet-50 border border-violet-200 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">🤖</span>
                <span className="font-bold text-violet-800">
                  Điểm: {formatScore(breakdown.points)} / {maxPoints}
                </span>
              </div>
              {breakdown.feedback && (
                <div className="text-sm text-violet-700 mt-2 bg-white/60 p-2 rounded italic border border-violet-100">
                  💬 Nhận xét: {breakdown.feedback}
                </div>
              )}
            </div>
          )}

          {/* Bài làm của học sinh */}
          <div className="mb-4">
            <p className="text-sm font-semibold text-gray-600 mb-2">Bài làm của bạn:</p>
            {!hasAnswer ? (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 italic">
                (Không có bài nộp)
              </div>
            ) : (
              <div className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
                {ansData.text && (
                  <div className="text-sm text-gray-800">
                    <MathText html={ansData.text} block />
                  </div>
                )}
                {ansData.images.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                    {ansData.images.map((img: any, i: number) => (
                      <img
                        key={i}
                        src={`data:${img.type};base64,${img.data}`}
                        alt={`Bài làm ${i + 1}`}
                        className="max-h-40 rounded-lg border border-gray-200 shadow-sm"
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Đáp án tham khảo */}
          {showExplanations && question.solution && (
            <div className="mt-3 p-3 bg-blue-50 border-l-4 border-blue-500 rounded-lg">
              <span className="text-blue-600 font-bold text-sm">💡 Đáp án tham khảo:</span>
              <div className="mt-2 text-sm text-gray-700 bg-white p-2 rounded border border-blue-100">
                <MathText html={question.solution} block />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Review: Multiple choice
// ============================================================================
const MultipleChoiceReview: React.FC<{
  question: Question;
  userAnswer?: string;
  correctAnswer: string;
  showCorrectAnswers: boolean;
  showExplanations: boolean;
}> = ({ question, userAnswer, correctAnswer, showCorrectAnswers, showExplanations }) => {
  const isCorrect = userAnswer?.toUpperCase() === correctAnswer?.toUpperCase();

  return (
    <div className={`p-4 ${showCorrectAnswers ? (isCorrect ? 'bg-green-50' : 'bg-red-50') : 'bg-gray-50'}`}>
      <div className="flex items-start gap-3">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
            showCorrectAnswers
              ? isCorrect
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white'
              : 'bg-gray-400 text-white'
          }`}
        >
          {question.number % 100}
        </div>
        <div className="flex-1">
          <div className="text-gray-800 mb-2">
            <MathText html={question.text || ''} block />
          </div>

          {question.images && question.images.length > 0 && (
            <div className="my-2 flex flex-wrap justify-center gap-2">
              {question.images.map((img, idx) => (
                <img
                  key={idx}
                  src={img.base64 ? `data:${img.contentType || 'image/png'};base64,${img.base64}` : ''}
                  alt={`Hình ${idx + 1}`}
                  className="block mx-auto max-h-32 rounded border"
                />
              ))}
            </div>
          )}

          {question.options && (
            <div className="grid grid-cols-2 gap-2">
              {question.options.map((opt: QuestionOption) => {
                const isUserAnswer = userAnswer?.toUpperCase() === opt.letter.toUpperCase();
                const isCorrectOpt = correctAnswer?.toUpperCase() === opt.letter.toUpperCase();

                let optClass = 'bg-white border-gray-200';
                
                if (showCorrectAnswers) {
                  if (isCorrectOpt) optClass = 'bg-green-100 border-green-500';
                  else if (isUserAnswer) optClass = 'bg-red-100 border-red-500';
                } else {
                  if (isUserAnswer) optClass = 'bg-blue-100 border-blue-500';
                }

                return (
                  <div key={opt.letter} className={`flex items-center gap-2 p-2 rounded-lg border-2 text-sm ${optClass}`}>
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        showCorrectAnswers
                          ? isCorrectOpt
                            ? 'bg-green-500 text-white'
                            : isUserAnswer
                            ? 'bg-red-500 text-white'
                            : 'bg-gray-200'
                          : isUserAnswer
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-200'
                      }`}
                    >
                      {opt.letter}
                    </span>
                    <span className="flex-1">
                      <MathText html={opt.text || ''} />
                    </span>
                    {showCorrectAnswers && isCorrectOpt && <span className="text-green-600">✔</span>}
                    {showCorrectAnswers && isUserAnswer && !isCorrect && <span className="text-red-600">✖</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Hiển thị đáp án của bạn */}
          <div className="mt-3 p-2 bg-blue-50 rounded">
            <span className="text-sm text-blue-700">
              <strong>Bạn chọn:</strong> {userAnswer || '(Chưa chọn)'}
            </span>
          </div>

          {/* Hiển thị đáp án đúng */}
          {showCorrectAnswers && (
            <div className={`mt-2 p-2 rounded ${isCorrect ? 'bg-green-100' : 'bg-red-100'}`}>
              <span className={`text-sm font-semibold ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                {isCorrect ? '✅ Chính xác!' : `❌ Sai. Đáp án đúng: ${correctAnswer}`}
              </span>
            </div>
          )}

          {/* Lời giải chi tiết */}
          {showExplanations && question.solution && (
            <div className="mt-3 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
              <div className="flex items-start gap-2">
                <span className="text-blue-600 font-bold text-sm">💡 Lời giải:</span>
                <div className="flex-1 text-sm text-gray-700">
                  <MathText html={question.solution} block />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Review: True/False
// ============================================================================
const TrueFalseReview: React.FC<{
  question: Question;
  userAnswer?: string;
  correctAnswer: string;
  showCorrectAnswers: boolean;
  showExplanations: boolean;
  breakdown?: { correctCount: number; points: number };
}> = ({ question, userAnswer, correctAnswer, showCorrectAnswers, showExplanations, breakdown }) => {
  // ── Parse đáp án đúng: hỗ trợ đa định dạng ("a,c" | "Đ,S,Đ,S" | "1,0,1,0" | JSON)
  const correctMap = parseTFCorrectAnswer(correctAnswer || '');

  // ── Parse câu trả lời học sinh: null = chưa chọn, true = Đúng, false = Sai
  const userMap = parseTFUserAnswer(
    !userAnswer || userAnswer.trim() === '' || userAnswer === 'null' || userAnswer === '{}'
      ? '{}'
      : userAnswer
  );

  // ── Tính allCorrect để hiển thị màu tổng câu (khớp với scoringService)
  // Dùng LABELS fallback khi options=[] (đề PDF không lưu nội dung ý)
  const LABELS_TF = ['a', 'b', 'c', 'd'];
  const optKeys = (question.options && question.options.length > 0)
    ? question.options.map(o => o.letter.toLowerCase())
    : LABELS_TF;

  let allCorrect = true;
  for (const k of optKeys) {
    const shouldBeTrue = correctMap[k] ?? false;
    const userChoice_k = userMap[k];
    // null = chưa trả lời → không đúng
    const isOk = userChoice_k !== null && (correctMap[k] ?? false) === (userChoice_k === true);
    if (!isOk) { allCorrect = false; break; }
  }

  return (
    <div className={`p-4 ${showCorrectAnswers ? (allCorrect ? 'bg-green-50' : 'bg-red-50') : 'bg-gray-50'}`}>
      <div className="flex items-start gap-3">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
            showCorrectAnswers
              ? allCorrect
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white'
              : 'bg-gray-400 text-white'
          }`}
        >
          {question.number % 100}
        </div>
        <div className="flex-1">
          <div className="text-gray-800 mb-2">
            <MathText html={question.text || ''} block />
            <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">Đ/S</span>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
              Đúng sai • {formatScore(breakdown?.points ?? 0)}đ
            </span>
            <span className="text-xs text-gray-500">
              {breakdown?.correctCount ?? 0}/4 ý đúng
            </span>
          </div>

          {question.images && question.images.length > 0 && (
            <div className="my-2 flex flex-wrap justify-center gap-2">
              {question.images.map((img, idx) => (
                <img
                  key={idx}
                  src={img.base64 ? `data:${img.contentType || 'image/png'};base64,${img.base64}` : ''}
                  alt={`Hình ${idx + 1}`}
                  className="block mx-auto max-h-32 rounded border"
                />
              ))}
            </div>
          )}

          {/* Render a/b/c/d — dùng options nếu có text, fallback sang placeholder khi options=[] */}
          {(() => {
            const LABELS = ['a', 'b', 'c', 'd'];
            const rows = (question.options && question.options.length > 0)
              ? question.options
              : LABELS.map(l => ({ letter: l, text: '' }));

            return (
              <div className="space-y-2">
                {rows.map((opt) => {
                  const key = opt.letter.toLowerCase();
                  const shouldBeTrue = correctMap[key] ?? false;
                  const userChoice = userMap[key]; // null | true | false
                  const userSaidTrue = userChoice === true;
                  // null = chưa trả lời → luôn hiển thị ✗, không tính là đúng dù ĐÁ là S
                  const isCorrectStatement = userChoice !== null && (shouldBeTrue === userSaidTrue);

                  // Nhãn hiển thị cho học sinh
                  const userLabel = userChoice === null ? '?' : userChoice ? 'Đ' : 'S';
                  const userBg   = userChoice === null
                    ? 'bg-gray-400 text-white'
                    : userChoice
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-500 text-white';

                  return (
                    <div
                      key={opt.letter}
                      className={`flex items-center gap-2 p-2 rounded-lg border-2 text-sm ${
                        showCorrectAnswers
                          ? isCorrectStatement
                            ? 'bg-green-100 border-green-300'
                            : 'bg-red-100 border-red-300'
                          : 'bg-gray-100 border-gray-300'
                      }`}
                    >
                      <span className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                        {opt.letter.toLowerCase()}
                      </span>
                      <span className="flex-1 text-gray-500 italic text-xs">
                        {opt.text ? <MathText html={opt.text} /> : '(Xem nội dung trong đề thi)'}
                      </span>
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`px-2 py-0.5 rounded font-bold ${userBg}`}>
                          Bạn: {userLabel}
                        </span>
                        {showCorrectAnswers && (
                          <>
                            <span className={`px-2 py-0.5 rounded font-bold ${shouldBeTrue ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                              ĐA: {shouldBeTrue ? 'Đ' : 'S'}
                            </span>
                            {isCorrectStatement
                              ? <span className="text-green-600 font-bold">✔</span>
                              : <span className="text-red-600 font-bold">✖</span>}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {showExplanations && question.solution && (
            <div className="mt-3 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
              <div className="flex items-start gap-2">
                <span className="text-blue-600 font-bold text-sm">💡 Lời giải:</span>
                <div className="flex-1 text-sm text-gray-700">
                  <MathText html={question.solution} block />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Review: Short answer
// ============================================================================
const ShortAnswerReview: React.FC<{
  question: Question;
  userAnswer?: string;
  correctAnswer: string;
  showCorrectAnswers: boolean;
  showExplanations: boolean;
}> = ({ question, userAnswer, correctAnswer, showCorrectAnswers, showExplanations }) => {
  const normalizeAnswer = (ans: string): string =>
    ans.toLowerCase().replace(/\s+/g, '').replace(/,/g, '.').trim();

  const isCorrect = normalizeAnswer(userAnswer || '') === normalizeAnswer(correctAnswer);

  const safeUser = escapeHtml(userAnswer || '');
  const safeCorrect = escapeHtml(correctAnswer || '');

  return (
    <div className={`p-4 ${showCorrectAnswers ? (isCorrect ? 'bg-green-50' : 'bg-red-50') : 'bg-gray-50'}`}>
      <div className="flex items-start gap-3">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
            showCorrectAnswers
              ? isCorrect
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white'
              : 'bg-gray-400 text-white'
          }`}
        >
          {question.number % 100}
        </div>
        <div className="flex-1">
          <div className="text-gray-800 mb-2">
            <MathText html={question.text || ''} block />
            <span className="ml-2 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full">TLN</span>
          </div>

          {question.images && question.images.length > 0 && (
            <div className="my-2 flex flex-wrap justify-center gap-2">
              {question.images.map((img, idx) => (
                <img
                  key={idx}
                  src={img.base64 ? `data:${img.contentType || 'image/png'};base64,${img.base64}` : ''}
                  alt={`Hình ${idx + 1}`}
                  className="block mx-auto max-h-32 rounded border"
                />
              ))}
            </div>
          )}

          <div className="text-sm space-y-1">
            <div className={`p-2 rounded ${showCorrectAnswers ? (isCorrect ? 'bg-green-100' : 'bg-red-100') : 'bg-blue-100'}`}>
              <span className="text-gray-600">Bạn trả lời: </span>
              <span className="font-medium">{userAnswer ? <MathText html={safeUser} /> : '(Bỏ trống)'}</span>
              {showCorrectAnswers && (isCorrect ? <span className="ml-2 text-green-600">✔</span> : <span className="ml-2 text-red-600">✖</span>)}
            </div>

            {showCorrectAnswers && !isCorrect && (
              <div className="p-2 rounded bg-green-100">
                <span className="text-gray-600">Đáp án đúng: </span>
                <span className="font-medium text-green-700">
                  <MathText html={safeCorrect} />
                </span>
              </div>
            )}
          </div>

          {showExplanations && question.solution && (
            <div className="mt-3 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
              <div className="flex items-start gap-2">
                <span className="text-blue-600 font-bold text-sm">💡 Lời giải:</span>
                <div className="flex-1 text-sm text-gray-700">
                  <MathText html={question.solution} block />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResultView;
