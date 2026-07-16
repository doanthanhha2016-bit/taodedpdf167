// src/components/SubmissionDetailView.tsx
import React from 'react';
import { Submission, Exam, Question, QuestionOption, Room } from '../types';
import { formatScore, getGrade, parseTFCorrectAnswer, parseTFUserAnswer } from '../services/scoringService';
import MathText from './MathText';

interface SubmissionDetailViewProps {
  submission: Submission;
  exam: Exam;
  room?: Room; // Optional - để hiển thị settings
  onClose: () => void;
}

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

const SubmissionDetailView: React.FC<SubmissionDetailViewProps> = ({
  submission,
  exam,
  room,
  onClose
}) => {
  const gradeInfo = getGrade(submission.totalScore);
  const sb = submission.scoreBreakdown;

  // Lấy settings để hiển thị cho giáo viên biết
  const studentCanSeeAnswers = room?.settings?.showCorrectAnswers ?? true;
  const studentCanSeeExplanations = room?.settings?.showExplanations ?? true;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-teal-600 to-teal-700 text-white p-6 rounded-t-2xl z-10 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">📋 Chi tiết bài làm</h2>
              <p className="text-teal-100 mt-1">
                {submission.student.name} • {submission.student.className || 'Không có lớp'}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition text-xl font-bold">
              ✕
            </button>
          </div>

          {/* Hiển thị settings cho giáo viên */}
          {room && (
            <div className="mt-3 flex gap-2">
              <span className="text-xs bg-white/20 px-3 py-1 rounded-full shadow-sm">
                Học sinh {studentCanSeeAnswers ? '✅ Được' : '❌ Không được'} xem đáp án
              </span>
              <span className="text-xs bg-white/20 px-3 py-1 rounded-full shadow-sm">
                Học sinh {studentCanSeeExplanations ? '✅ Được' : '❌ Không được'} xem lời giải
              </span>
            </div>
          )}
        </div>

        {/* Score Summary */}
        <div className="p-6 bg-gradient-to-br from-gray-50 to-white border-b">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {/* Tổng điểm */}
            <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-teal-500">
              <div className="text-sm text-gray-600 mb-1">Tổng điểm</div>
              <div className="text-3xl font-bold text-teal-600">
                {formatScore(submission.totalScore)}/10
              </div>
              <div className={`text-xs mt-1 px-2 py-1 rounded-full inline-block ${gradeInfo.bg} ${gradeInfo.color} font-semibold`}>
                {gradeInfo.grade} - {gradeInfo.label}
              </div>
            </div>

            {/* Phần trăm */}
            <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-blue-500">
              <div className="text-sm text-gray-600 mb-1">Phần trăm</div>
              <div className="text-3xl font-bold text-blue-600">{submission.percentage}%</div>
            </div>

            {/* Câu đúng (Auto) */}
            <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-green-500">
              <div className="text-sm text-gray-600 mb-1">Số câu đúng (Auto)</div>
              <div className="text-3xl font-bold text-green-600">{submission.correctCount}</div>
              <div className="text-xs text-gray-500 mt-1">/ {submission.totalQuestions} câu</div>
            </div>

            {/* Thời gian */}
            <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-orange-500">
              <div className="text-sm text-gray-600 mb-1">Thời gian</div>
              <div className="text-2xl font-bold text-orange-600">
                {Math.floor(submission.duration / 60)}:{(submission.duration % 60).toString().padStart(2, '0')}
              </div>
            </div>
          </div>

          {/* Điểm chi tiết từng phần */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Trắc nghiệm */}
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">🔘</span>
                <div className="font-bold text-blue-900">Trắc nghiệm</div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Số câu:</span>
                  <span className="font-semibold">{sb.multipleChoice.total}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Đúng:</span>
                  <span className="font-semibold text-green-600">{sb.multipleChoice.correct}</span>
                </div>
                <div className="flex justify-between border-t border-blue-200 pt-2">
                  <span className="text-gray-600">Điểm:</span>
                  <span className="font-bold text-blue-600">{formatScore(sb.multipleChoice.points)}</span>
                </div>
              </div>
            </div>

            {/* Đúng sai */}
            <div className="bg-green-50 rounded-xl p-4 border border-green-200">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">✅</span>
                <div className="font-bold text-green-900">Đúng sai</div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Số câu:</span>
                  <span className="font-semibold">{sb.trueFalse.total}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Đúng hoàn toàn:</span>
                  <span className="font-semibold text-green-600">{sb.trueFalse.correct}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Đúng một phần:</span>
                  <span className="font-semibold text-yellow-600">{sb.trueFalse.partial}</span>
                </div>
                <div className="flex justify-between border-t border-green-200 pt-2">
                  <span className="text-gray-600">Điểm:</span>
                  <span className="font-bold text-green-600">{formatScore(sb.trueFalse.points)}</span>
                </div>
              </div>
            </div>

            {/* Trả lời ngắn */}
            <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">✏️</span>
                <div className="font-bold text-orange-900">Trả lời ngắn</div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Số câu:</span>
                  <span className="font-semibold">{sb.shortAnswer.total}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Đúng:</span>
                  <span className="font-semibold text-green-600">{sb.shortAnswer.correct}</span>
                </div>
                <div className="flex justify-between border-t border-orange-200 pt-2">
                  <span className="text-gray-600">Điểm:</span>
                  <span className="font-bold text-orange-600">{formatScore(sb.shortAnswer.points)}</span>
                </div>
              </div>
            </div>

            {/* ✅ Tự luận (MỚI) */}
            {(sb as any).writing?.total > 0 && (
              <div className="bg-violet-50 rounded-xl p-4 border border-violet-200">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">📝</span>
                  <div className="font-bold text-violet-900">Tự luận</div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Số câu:</span>
                    <span className="font-semibold">{(sb as any).writing?.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Đã chấm:</span>
                    <span className="font-semibold text-violet-600">
                      {Object.keys((sb as any).writing?.details || {}).length}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-violet-200 pt-2">
                    <span className="text-gray-600">Điểm:</span>
                    <span className="font-bold text-violet-600">{formatScore((sb as any).writing?.points || 0)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Cảnh báo gian lận */}
          {submission.tabSwitchCount > 0 && (
            <div className="mt-4 bg-red-50 border-l-4 border-red-500 p-4 rounded-lg">
              <div className="flex items-center gap-2 text-red-800">
                <span className="text-xl">⚠️</span>
                <div>
                  <div className="font-bold">Cảnh báo chuyển tab</div>
                  <div className="text-sm">
                    Học sinh đã chuyển tab {submission.tabSwitchCount} lần
                    {submission.autoSubmitted && ' (Tự động nộp bài)'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chi tiết từng câu */}
        <div className="p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">📝 Chi tiết từng câu</h3>

          {/* Thông báo cho giáo viên */}
          {room && (!studentCanSeeAnswers || !studentCanSeeExplanations) && (
            <div className="mb-4 p-4 bg-yellow-50 border-l-4 border-yellow-500 rounded">
              <div className="flex items-start gap-2">
                <span className="text-xl">ℹ️</span>
                <div className="flex-1 text-sm">
                  <p className="font-semibold text-yellow-800">Lưu ý:</p>
                  <p className="text-yellow-700 mt-1">
                    Bạn đang xem toàn bộ đáp án và lời giải (quyền giáo viên).{' '}
                    {!studentCanSeeAnswers && 'Học sinh KHÔNG được xem đáp án. '}
                    {!studentCanSeeExplanations && 'Học sinh KHÔNG được xem lời giải.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {exam.questions.map((question) => {
              const userAnswer = submission.answers[question.number];

              // ✅ FIX LỖI Ở ĐÂY: Phân loại đúng type của câu hỏi
              if (question.type === 'multiple_choice' || (!question.type && Math.floor(question.number / 100) === 1)) {
                return <MultipleChoiceDetail key={question.number} question={question} userAnswer={userAnswer} />;
              } 
              else if (question.type === 'true_false' || (!question.type && Math.floor(question.number / 100) === 2)) {
                return (
                  <TrueFalseDetail
                    key={question.number}
                    question={question}
                    userAnswer={userAnswer}
                    breakdown={sb.trueFalse.details[question.number]}
                  />
                );
              } 
              else if (question.type === 'writing' || (!question.type && Math.floor(question.number / 100) === 4)) {
                const sectionConfig = exam.pointsConfig?.sections.find(s => s.sectionId === question.part || s.questionType === 'writing');
                const maxPts = sectionConfig?.pointsPerQuestion || 0;
                return (
                  <WritingDetail 
                    key={question.number} 
                    question={question} 
                    userAnswer={userAnswer} 
                    breakdown={(sb as any).writing?.details?.[question.number]}
                    maxPoints={maxPts}
                  />
                );
              } 
              else {
                return <ShortAnswerDetail key={question.number} question={question} userAnswer={userAnswer} />;
              }
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// ✅ MỚI: Tự luận Detail (Giáo viên xem)
// ============================================================================
const WritingDetail: React.FC<{
  question: Question;
  userAnswer?: string;
  breakdown?: { points: number; feedback?: string };
  maxPoints: number;
}> = ({ question, userAnswer, breakdown, maxPoints }) => {
  const ansData = parseWritingAnswer(userAnswer);
  const hasAnswer = ansData.text.trim() !== '' || ansData.images.length > 0;
  const isGraded = !!breakdown;

  return (
    <div className="border-2 border-violet-200 bg-violet-50/50 rounded-xl p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white bg-violet-500 shadow-sm shrink-0">
          {question.number % 100}
        </div>
        <div className="flex-1 min-w-0">
          <MathText html={question.text} block className="text-gray-800 font-medium" />
          <div className="mt-2 flex items-center gap-2">
            <span className="px-2 py-1 bg-violet-100 text-violet-700 rounded text-xs font-medium">
              Tự luận • Tối đa {maxPoints}đ
            </span>
            {isGraded ? (
              <span className="text-green-600 font-bold text-sm">Đã chấm: {formatScore(breakdown.points)}đ</span>
            ) : (
              <span className="text-orange-500 font-bold text-sm">Chưa chấm</span>
            )}
          </div>
        </div>
      </div>

      <div className="ml-13 space-y-3">
        {/* Bài làm của học sinh */}
        <div className="p-4 rounded-xl bg-white border border-gray-200 shadow-sm">
          <div className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">Học sinh làm bài:</div>
          {!hasAnswer ? (
            <div className="text-red-500 italic text-sm">Không nộp bài làm</div>
          ) : (
            <div>
              {ansData.text && (
                <div className="text-gray-800 text-sm mb-2">
                  <MathText html={ansData.text} block />
                </div>
              )}
              {ansData.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
                  {ansData.images.map((img: any, i: number) => (
                    <img
                      key={i}
                      src={`data:${img.type};base64,${img.data}`}
                      alt={`Hình ảnh bài làm ${i + 1}`}
                      className="max-h-48 rounded-lg border border-gray-200 shadow-sm cursor-pointer hover:opacity-90"
                      onClick={() => window.open(`data:${img.type};base64,${img.data}`, '_blank')}
                      title="Nhấn để xem ảnh lớn"
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* AI / Teacher Feedback */}
        {isGraded && breakdown?.feedback && (
          <div className="p-3 bg-violet-100 border border-violet-300 rounded-xl">
            <div className="text-xs font-bold text-violet-800 mb-1 flex items-center gap-1">
              <span>🤖</span> Nhận xét chấm bài:
            </div>
            <div className="text-sm text-violet-900 italic">
              {breakdown.feedback}
            </div>
          </div>
        )}

        {/* Lời giải tham khảo */}
        {question.solution && (
          <div className="p-3 bg-blue-50 border-l-4 border-blue-500 rounded-lg mt-2">
            <div className="text-blue-600 font-bold text-sm mb-1">💡 Đáp án tham khảo:</div>
            <div className="text-sm text-gray-700 bg-white p-2 rounded border border-blue-100">
              <MathText html={question.solution} block />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ===== Multiple Choice Detail =====
const MultipleChoiceDetail: React.FC<{
  question: Question;
  userAnswer?: string;
}> = ({ question, userAnswer }) => {
  const isCorrect = userAnswer?.toUpperCase() === question.correctAnswer?.toUpperCase();

  return (
    <div
      className={`border-2 rounded-xl p-4 ${
        isCorrect
          ? 'border-green-300 bg-green-50'
          : userAnswer
          ? 'border-red-300 bg-red-50'
          : 'border-gray-300 bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shrink-0 ${
            isCorrect ? 'bg-green-500' : userAnswer ? 'bg-red-500' : 'bg-gray-400'
          }`}
        >
          {question.number % 100}
        </div>
        <div className="flex-1">
          <MathText html={question.text} block className="text-gray-800 font-medium" />
          <div className="mt-2 flex items-center gap-2">
            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
              Trắc nghiệm
            </span>
            {isCorrect && <span className="text-green-600 font-bold text-sm">✓ Đúng</span>}
            {!isCorrect && userAnswer && <span className="text-red-600 font-bold text-sm">✗ Sai</span>}
            {!userAnswer && <span className="text-gray-500 text-sm">⊘ Không trả lời</span>}
          </div>
        </div>
      </div>

      {question.options && (
        <div className="ml-13 grid grid-cols-2 gap-2">
          {question.options.map((opt) => {
            const isUserAnswer = userAnswer?.toUpperCase() === opt.letter.toUpperCase();
            const isCorrectOpt = question.correctAnswer?.toUpperCase() === opt.letter.toUpperCase();

            return (
              <div
                key={opt.letter}
                className={`flex items-center gap-2 p-2 rounded-lg border ${
                  isCorrectOpt
                    ? 'border-green-500 bg-green-100'
                    : isUserAnswer
                    ? 'border-red-500 bg-red-100'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                    isCorrectOpt
                      ? 'bg-green-500 text-white'
                      : isUserAnswer
                      ? 'bg-red-500 text-white'
                      : 'bg-gray-200'
                  }`}
                >
                  {opt.letter}
                </span>
                <MathText html={opt.text} className="flex-1 text-sm" />
                {isCorrectOpt && <span className="text-green-600">✓</span>}
                {isUserAnswer && !isCorrect && <span className="text-red-600">✗</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Lời giải chi tiết */}
      {question.solution && (
        <div className="ml-13 mt-3 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
          <div className="flex items-start gap-2">
            <span className="text-blue-600 font-bold text-sm">💡 Lời giải:</span>
            <div className="flex-1 text-sm text-gray-700">
              <MathText html={question.solution} block />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ===== True/False Detail =====
const TrueFalseDetail: React.FC<{
  question: Question;
  userAnswer?: string;
  breakdown?: { correctCount: number; points: number };
}> = ({ question, userAnswer, breakdown }) => {
  // ── Parse đáp án đúng: hỗ trợ đa định dạng ("a,c" | "Đ,S,Đ,S" | "1,0,1,0" | JSON)
  const correctMap = parseTFCorrectAnswer(question.correctAnswer || '');

  // ── Parse câu trả lời học sinh: null = chưa chọn, true = Đúng, false = Sai
  const userMap = parseTFUserAnswer(
    !userAnswer || userAnswer.trim() === '' || userAnswer === 'null' || userAnswer === '{}'
      ? '{}'
      : userAnswer
  );

  const correctCount = breakdown?.correctCount || 0;
  const points = breakdown?.points || 0;

  return (
    <div className="border-2 border-green-300 bg-green-50 rounded-xl p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white bg-green-500 shrink-0">
          {question.number % 100}
        </div>
        <div className="flex-1">
          <MathText html={question.text} block className="text-gray-800 font-medium" />
          <div className="mt-2 flex items-center gap-2">
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
              Đúng sai • {formatScore(points)}đ
            </span>
            <span className="text-sm text-gray-600 font-medium">{correctCount}/4 ý đúng</span>
          </div>
        </div>
      </div>

      {/* Render a/b/c/d — dùng options nếu có text, fallback sang placeholder khi options=[] */}
      {(() => {
        const LABELS = ['a', 'b', 'c', 'd'];
        const rows = (question.options && question.options.length > 0)
          ? question.options
          : LABELS.map(l => ({ letter: l, text: '' }));

        return (
          <div className="ml-13 space-y-2">
            {rows.map((opt) => {
              const key = opt.letter.toLowerCase();
              const shouldBeTrue = correctMap[key] ?? false;
              const userChoice = userMap[key]; // null | true | false
              const userSaidTrue = userChoice === true;
              // null = chưa trả lời → luôn hiển thị ✗, không tính là đúng dù ĐÁ là S
              const isCorrect = userChoice !== null && (shouldBeTrue === userSaidTrue);

              // Nhãn và màu hiển thị cho học sinh
              const hsLabel = userChoice === null ? '?' : userChoice ? 'Đ' : 'S';
              const hsBg    = userChoice === null
                ? 'bg-gray-400 text-white'
                : userChoice
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-300 text-gray-800';

              return (
                <div
                  key={opt.letter}
                  className={`flex items-center gap-2 p-2 rounded-lg border ${
                    isCorrect ? 'border-green-300 bg-green-100' : 'border-red-300 bg-red-100'
                  }`}
                >
                  <span className="w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    {opt.letter.toLowerCase()}
                  </span>
                  <span className="flex-1 text-sm">
                    {opt.text
                      ? <MathText html={opt.text} />
                      : <span className="text-gray-400 italic text-xs">Xem nội dung trong đề thi</span>}
                  </span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`px-2 py-1 rounded font-bold ${hsBg}`}>
                      HS: {hsLabel}
                    </span>
                    <span className={`px-2 py-1 rounded font-bold ${shouldBeTrue ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                      ĐÁ: {shouldBeTrue ? 'Đ' : 'S'}
                    </span>
                    {isCorrect
                      ? <span className="text-green-600 text-base font-bold">✓</span>
                      : <span className="text-red-600 text-base font-bold">✗</span>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {question.solution && (
        <div className="ml-13 mt-3 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
          <div className="flex items-start gap-2">
            <span className="text-blue-600 font-bold text-sm">💡 Lời giải:</span>
            <div className="flex-1 text-sm text-gray-700">
              <MathText html={question.solution} block />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ===== Short Answer Detail =====
const ShortAnswerDetail: React.FC<{
  question: Question;
  userAnswer?: string;
}> = ({ question, userAnswer }) => {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/,/g, '.').trim();
  const isCorrect = userAnswer && question.correctAnswer ? normalize(userAnswer) === normalize(question.correctAnswer) : false;

  return (
    <div
      className={`border-2 rounded-xl p-4 ${
        isCorrect ? 'border-green-300 bg-green-50' : userAnswer ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shrink-0 ${
            isCorrect ? 'bg-green-500' : userAnswer ? 'bg-red-500' : 'bg-gray-400'
          }`}
        >
          {question.number % 100}
        </div>
        <div className="flex-1">
          <MathText html={question.text} block className="text-gray-800 font-medium" />
          <div className="mt-2 flex items-center gap-2">
            <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-medium">
              Trả lời ngắn
            </span>
            {isCorrect && <span className="text-green-600 font-bold text-sm">✓ Đúng</span>}
            {!isCorrect && userAnswer && <span className="text-red-600 font-bold text-sm">✗ Sai</span>}
            {!userAnswer && <span className="text-gray-500 text-sm">⊘ Không trả lời</span>}
          </div>
        </div>
      </div>

      <div className="ml-13 space-y-2">
        <div className={`p-3 rounded-lg border ${isCorrect ? 'bg-green-100 border-green-200' : userAnswer ? 'bg-red-100 border-red-200' : 'bg-gray-100 border-gray-200'}`}>
          <div className="text-xs text-gray-600 mb-1 font-semibold uppercase">Học sinh trả lời:</div>
          <div className="font-medium text-gray-900">{userAnswer ? <MathText html={userAnswer} /> : '(Bỏ trống)'}</div>
        </div>

        {!isCorrect && (
          <div className="p-3 rounded-lg bg-green-100 border border-green-200">
            <div className="text-xs text-green-800 mb-1 font-semibold uppercase">Đáp án đúng:</div>
            <div className="font-medium text-green-800">
              <MathText html={question.correctAnswer || ''} />
            </div>
          </div>
        )}
      </div>

      {question.solution && (
        <div className="ml-13 mt-3 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
          <div className="flex items-start gap-2">
            <span className="text-blue-600 font-bold text-sm">💡 Lời giải:</span>
            <div className="flex-1 text-sm text-gray-700">
              <MathText html={question.solution} block />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubmissionDetailView;
