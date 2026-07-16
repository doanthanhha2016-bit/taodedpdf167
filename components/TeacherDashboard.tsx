// src/components/TeacherDashboard.tsx

import React, { useEffect, useState } from 'react';
import { User, Exam, Room, Submission, Class, ExamData, ExamPointsConfig } from '../types';
import {
  createExam,
  getExamsByTeacher,
  deleteExam,
  createRoom,
  getRoomsByTeacher,
  updateRoomStatus,
  deleteRoom,
  subscribeToSubmissions,
  getSubmissionsByRoom,
  getExam,
  // ✅ Class management
  createClass,
  getClassesByTeacher,
  getStudentsInClass,
  deleteClass,
  removeStudentFromClass,
  updateSubmission // ✅ MỚI: Thêm hàm updateSubmission để cập nhật điểm tự luận
} from '../services/firebaseService';

import { parseWordToExam, validateExamData } from '../services/mathWordParserService';
import SubmissionDetailView from './SubmissionDetailView';
import PointsConfigEditor from './PointsConfigEditor';
import PDFExamCreator from './PDFExamCreator';
import StudentAccountManager from './StudentAccountManager';
// ✅ TÍCH HỢP: Import LiveMonitoringPanel
import LiveMonitoringPanel from './LiveMonitoringPanel';
import EssayGraderPanel from './EssayGraderPanel'; // ✅ MỚI: Import UI chấm Tự luận
import { formatScore, createDefaultPointsConfig } from '../services/scoringService';
import { exportSubmissionsToExcel } from '../services/excelExportService';


// ─── RoomCreatedModal — hiển thị mã/link phòng thi sau khi tạo ───────────────

interface RoomCreatedModalProps {
  roomCode: string;
  examTitle: string;
  timeLimit: number;
  className?: string;
  onClose: () => void;
  appBaseUrl?: string;
}

const RoomCreatedModal: React.FC<RoomCreatedModalProps> = ({
  roomCode,
  examTitle,
  timeLimit,
  className,
  onClose,
  appBaseUrl,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const base = appBaseUrl || window.location.origin;
  const examLink = `${base}?code=${roomCode}`;

  const copyText = async (text: string, which: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }

    if (which === 'code') {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-br from-teal-500 to-teal-700 px-6 pt-8 pb-10 text-white text-center relative">
          <div className="text-5xl mb-3">🎉</div>
          <h2 className="text-2xl font-black mb-1">Phòng thi đã tạo!</h2>
          <p className="text-teal-100 text-sm truncate max-w-xs mx-auto">{examTitle}</p>
          {className && (
            <span className="mt-2 inline-block text-xs bg-white/20 px-3 py-1 rounded-full">
              👥 {className}
            </span>
          )}
          <p className="mt-1 text-xs text-teal-200">⏱ {timeLimit} phút</p>

          <div className="mt-5 bg-white/15 backdrop-blur-sm rounded-2xl px-6 py-4 mx-auto max-w-xs">
            <p className="text-xs text-teal-200 mb-1 font-medium uppercase tracking-widest">Mã phòng</p>
            <div className="text-5xl font-black tracking-[0.2em] text-white">{roomCode}</div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-3">
          <button
            onClick={() => copyText(roomCode, 'code')}
            className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border-2 font-semibold transition ${
              copiedCode
                ? 'border-teal-500 bg-teal-50 text-teal-700'
                : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-teal-400 hover:bg-teal-50'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">{copiedCode ? '✅' : '📋'}</span>
              <div className="text-left">
                <p className="text-sm font-bold">{copiedCode ? 'Đã copy!' : 'Copy mã phòng'}</p>
                <p className="text-xs text-gray-400 font-mono font-normal">{roomCode}</p>
              </div>
            </div>
            <span className="text-xs text-gray-400">{copiedCode ? '' : '→'}</span>
          </button>

          <button
            onClick={() => copyText(examLink, 'link')}
            className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border-2 font-semibold transition ${
              copiedLink
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-blue-400 hover:bg-blue-50'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xl">{copiedLink ? '✅' : '🔗'}</span>
              <div className="text-left min-w-0">
                <p className="text-sm font-bold">{copiedLink ? 'Đã copy link!' : 'Copy link thi'}</p>
                <p className="text-xs text-gray-400 font-normal truncate max-w-[250px]">{examLink}</p>
              </div>
            </div>
            <span className="text-xs text-gray-400">{copiedLink ? '' : '→'}</span>
          </button>

          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-amber-700">
            <span>💡</span>
            <span>Chia sẻ <strong>mã phòng</strong> hoặc <strong>link</strong> trên để học sinh vào thi.</span>
          </div>
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={onClose}
            className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-2xl font-bold transition text-sm"
          >
            Xong ✓
          </button>
        </div>
      </div>
    </div>
  );
};

interface TeacherDashboardProps {
  user: User;
  onLogout: () => void;
}

type Tab = 'exams' | 'rooms' | 'results' | 'classes' | 'accounts';

type PendingUploadMeta = {
  title: string;
  timeLimit: number;
  total: number;
  mc: number;
  tf: number;
  sa: number;
  img: number;
};

const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState<Tab>('exams');
  const [exams, setExams] = useState<Exam[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  // ✅ CÁCH A: Upload -> Parse -> Open PointsConfigEditor -> Save -> createExam(pointsConfig)
  const [showPointsConfig, setShowPointsConfig] = useState(false);
  const [pendingExamData, setPendingExamData] = useState<ExamData | null>(null);
  const [pendingPointsConfig, setPendingPointsConfig] = useState<ExamPointsConfig | null>(null);
  const [pendingMeta, setPendingMeta] = useState<PendingUploadMeta | null>(null);

  // ✅ MỚI: PDF Exam Creator
  const [showPDFCreator, setShowPDFCreator] = useState(false);

  // Room creation modal
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [createdRoomInfo, setCreatedRoomInfo] = useState<{
    code: string;
    examTitle: string;
    timeLimit: number;
    className?: string;
  } | null>(null);
  const [selectedExamForRoom, setSelectedExamForRoom] = useState<Exam | null>(null);
  const [roomTimeLimit, setRoomTimeLimit] = useState(45);
  const [selectedClassForRoom, setSelectedClassForRoom] = useState<string>('');
  const [allowAnonymous, setAllowAnonymous] = useState(false);
  const [allowRetake, setAllowRetake] = useState(false);

  // ✅ Schedule open/close
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [roomOpensAt, setRoomOpensAt] = useState<string>('');
  const [roomClosesAt, setRoomClosesAt] = useState<string>('');

  // ✅ Cấu hình xem đáp án và lời giải
  const [showCorrectAnswers, setShowCorrectAnswers] = useState(true);
  const [showExplanations, setShowExplanations] = useState(true);

  // ✅ TÍCH HỢP: State cho LiveMonitoringPanel
  const [monitoringRoom, setMonitoringRoom] = useState<Room | null>(null);

  // Class management
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassGrade, setNewClassGrade] = useState('');
  const [selectedClass, setSelectedClass] = useState<Class | null>(null);
  const [classStudents, setClassStudents] = useState<User[]>([]);

  // Results view
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [currentExam, setCurrentExam] = useState<Exam | null>(null);

  // ✅ MỚI: Modal chấm Tự luận AI
  const [showEssayGrader, setShowEssayGrader] = useState(false);

  // Load data
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  // Subscribe to submissions when a room is selected
  useEffect(() => {
    if (!selectedRoom) return;

    const unsubscribe = subscribeToSubmissions(selectedRoom.id, (subs) => {
      setSubmissions(subs);
      setRooms(prev => prev.map(r =>
        r.id === selectedRoom.id
          ? { ...r, submittedCount: subs.length }
          : r
      ));
    });

    loadExamForRoom(selectedRoom.examId);

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoom?.id]);

  // Load students when class is selected
  useEffect(() => {
    if (!selectedClass) return;
    loadClassStudents(selectedClass.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClass?.id]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [examsList, roomsList, classesList] = await Promise.all([
        getExamsByTeacher(user.id),
        getRoomsByTeacher(user.id),
        getClassesByTeacher(user.id)
      ]);
      setExams(examsList);
      setClasses(classesList);

      const roomsWithRealCount = await Promise.all(
        roomsList.map(async (room) => {
          try {
            const subs = await getSubmissionsByRoom(room.id);
            return { ...room, submittedCount: subs.length };
          } catch {
            return room;
          }
        })
      );
      setRooms(roomsWithRealCount);
    } catch (err) {
      console.error('Load data error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadExamForRoom = async (examId: string) => {
    try {
      const exam = await getExam(examId);
      setCurrentExam(exam);
    } catch (err) {
      console.error('Load exam error:', err);
    }
  };

  const loadClassStudents = async (classId: string) => {
    try {
      const students = await getStudentsInClass(classId);
      setClassStudents(students);
    } catch (err) {
      console.error('Load students error:', err);
    }
  };

  const resetPendingUpload = () => {
    setShowPointsConfig(false);
    setPendingExamData(null);
    setPendingPointsConfig(null);
    setPendingMeta(null);
  };

  const resetRoomModal = () => {
    setShowCreateRoom(false);
    setSelectedExamForRoom(null);
    setSelectedClassForRoom('');
    setAllowAnonymous(false);
    setAllowRetake(false);
    setScheduleEnabled(false);
    setRoomOpensAt('');
    setRoomClosesAt('');
    setShowCorrectAnswers(true);
    setShowExplanations(true);
  };

  const finalizeCreateExam = async (config: ExamPointsConfig) => {
    if (!pendingExamData || !pendingMeta) return;

    setIsUploading(true);
    try {
      await createExam({
        title: pendingMeta.title,
        description: `${pendingMeta.total} câu hỏi • Môn Toán`,
        timeLimit: pendingMeta.timeLimit || 90,
        questions: pendingExamData.questions,
        sections: pendingExamData.sections,
        answers: pendingExamData.answers,
        createdBy: user.id,
        images: pendingExamData.images || [],
        pointsConfig: config
      });

      alert(
        `✅ Đã tải lên đề thi thành công!\n\n` +
          `📊 Thống kê:\n` +
          `• Tổng: ${pendingMeta.total} câu hỏi\n` +
          `• Trắc nghiệm: ${pendingMeta.mc} câu\n` +
          `• Đúng/Sai: ${pendingMeta.tf} câu\n` +
          `• Trả lời ngắn: ${pendingMeta.sa} câu\n` +
          `• Hình ảnh: ${pendingMeta.img} ảnh\n\n` +
          `⚙️ Cấu hình điểm:\n` +
          config.sections
            .map((s) => `• ${s.sectionName}: ${s.totalPoints} điểm (${s.pointsPerQuestion}/câu)`)
            .join('\n')
      );

      resetPendingUpload();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await loadData();
    } catch (err) {
      console.error('Create exam (with pointsConfig) error:', err);
      alert('❌ Lỗi khi tạo đề thi.\n\n' + (err as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith('.docx')) {
      alert('⚠️ Vui lòng chọn file Word (.docx)');
      return;
    }

    setIsUploading(true);
    try {
      const examData = await parseWordToExam(file);
      const validation = validateExamData(examData);

      if (!validation.valid && examData.questions.length === 0) {
        alert('❌ File không hợp lệ:\n' + validation.errors.join('\n'));
        return;
      }

      if (validation.errors.length > 0) {
        console.warn('⚠️ Warnings:', validation.errors);
      }

      const mcCount = examData.questions.filter((q) => q.type === 'multiple_choice').length;
      const tfCount = examData.questions.filter((q) => q.type === 'true_false').length;
      const saCount = examData.questions.filter((q) => q.type === 'short_answer').length;
      const imgCount = examData.images?.length || 0;

      const defaultConfig = createDefaultPointsConfig(examData.questions);

      setPendingExamData(examData);
      setPendingPointsConfig(defaultConfig);
      setPendingMeta({
        title: file.name.replace('.docx', ''),
        timeLimit: examData.timeLimit || 90,
        total: examData.questions.length,
        mc: mcCount,
        tf: tfCount,
        sa: saCount,
        img: imgCount
      });

      setShowPointsConfig(true);
    } catch (err) {
      console.error('Upload error:', err);
      alert('❌ Lỗi khi tải lên. Vui lòng thử lại.\n\n' + (err as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCreateClass = async () => {
    if (!newClassName.trim()) {
      alert('⚠️ Vui lòng nhập tên lớp!');
      return;
    }

    try {
      await createClass({
        name: newClassName,
        grade: newClassGrade,
        subject: 'Toán',
        teacherId: user.id,
        teacherName: user.name
      });

      alert(`✅ Đã tạo lớp "${newClassName}" thành công!`);
      setShowCreateClass(false);
      setNewClassName('');
      setNewClassGrade('');
      loadData();
    } catch (err) {
      console.error('Create class error:', err);
      alert('❌ Lỗi khi tạo lớp');
    }
  };

  const handleDeleteClass = async (classId: string, className: string) => {
    if (!confirm(`Bạn có chắc muốn xóa lớp "${className}"? Tất cả học sinh sẽ bị xóa khỏi lớp.`)) return;

    try {
      await deleteClass(classId);
      alert('✅ Đã xóa lớp!');
      if (selectedClass?.id === classId) {
        setSelectedClass(null);
        setClassStudents([]);
      }
      loadData();
    } catch (err) {
      console.error('Delete class error:', err);
      alert('❌ Lỗi khi xóa lớp');
    }
  };

  const handleCreateRoom = async () => {
    if (!selectedExamForRoom) return;

    try {
      const selectedClassData = selectedClassForRoom
        ? classes.find((c) => c.id === selectedClassForRoom) || null
        : null;

      let opensAtDate: Date | null = null;
      let closesAtDate: Date | null = null;

      if (scheduleEnabled) {
        if (!roomOpensAt) {
          alert('⚠️ Bạn đã bật hẹn giờ nhưng chưa chọn Giờ mở.');
          return;
        }
        opensAtDate = new Date(roomOpensAt);

        if (roomClosesAt) {
          closesAtDate = new Date(roomClosesAt);
        } else {
          closesAtDate = new Date(opensAtDate.getTime() + roomTimeLimit * 60 * 1000);
        }

        if (closesAtDate.getTime() <= opensAtDate.getTime()) {
          alert('⚠️ Giờ đóng phải sau giờ mở.');
          return;
        }
      }

      const newRoom = await createRoom({
        examId: selectedExamForRoom.id,
        examTitle: selectedExamForRoom.title,
        teacherId: user.id,
        teacherName: user.name,
        timeLimit: roomTimeLimit,
        classId: selectedClassData?.id,
        className: selectedClassData?.name,
        opensAt: opensAtDate,
        closesAt: closesAtDate,
        settings: {
          allowLateJoin: true,
          showResultAfterSubmit: true,
          shuffleQuestions: false,
          maxAttempts: allowRetake ? 0 : 1,
          allowAnonymous: allowAnonymous,
          showCorrectAnswers: showCorrectAnswers,
          showExplanations: showExplanations
        }
      });

      setCreatedRoomInfo({
        code: newRoom.code,
        examTitle: selectedExamForRoom.title,
        timeLimit: roomTimeLimit,
        className: selectedClassData?.name,
      });

      resetRoomModal();
      loadData();
    } catch (err) {
      console.error('Create room error:', err);
      alert('❌ Lỗi khi tạo phòng thi');
    }
  };

  const handleDeleteExam = async (examId: string) => {
    if (!confirm('Bạn có chắc muốn xóa đề thi này?')) return;

    try {
      await deleteExam(examId);
      loadData();
    } catch (err) {
      console.error('Delete exam error:', err);
      alert('❌ Lỗi khi xóa đề thi');
    }
  };

  const handleRoomAction = async (roomId: string, action: 'start' | 'close' | 'delete') => {
    try {
      if (action === 'delete') {
        if (!confirm('Bạn có chắc muốn xóa phòng thi này? Tất cả bài làm sẽ bị xóa.')) return;
        await deleteRoom(roomId);

        if (selectedRoom?.id === roomId) {
          setSelectedRoom(null);
          setSubmissions([]);
          setSelectedSubmission(null);
          setCurrentExam(null);
        }
        // ✅ Đóng panel giám sát nếu đang mở phòng bị xóa
        if (monitoringRoom?.id === roomId) {
          setMonitoringRoom(null);
        }
      } else {
        await updateRoomStatus(roomId, action === 'start' ? 'active' : 'closed');
        // ✅ Đóng panel giám sát nếu phòng bị đóng
        if (action === 'close' && monitoringRoom?.id === roomId) {
          setMonitoringRoom(null);
        }
      }
      loadData();
    } catch (err) {
      console.error('Room action error:', err);
      alert('❌ Lỗi thao tác phòng thi');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('✅ Đã copy mã phòng: ' + text);
  };

  const getQuestionTypeCounts = (exam: Exam) => {
    const mc = exam.questions.filter((q) => q.type === 'multiple_choice').length;
    const tf = exam.questions.filter((q) => q.type === 'true_false').length;
    const sa = exam.questions.filter((q) => q.type === 'short_answer').length;
    return { mc, tf, sa };
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div
        className="text-white p-4 shadow-lg"
        style={{ background: 'linear-gradient(135deg, #0d9488 0%, #115e59 100%)' }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-3xl">👨‍🏫</div>
            <div>
              <h1 className="text-xl font-bold">Teacher Dashboard</h1>
              <p className="text-teal-100 text-sm">{user.name}</p>
            </div>
          </div>
          <button onClick={onLogout} className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition">
            Đăng xuất
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {[
            { id: 'exams', label: '📚 Đề thi', count: exams.length },
            { id: 'rooms', label: '🏠 Phòng thi', count: rooms.length },
            { id: 'results', label: '📊 Kết quả', count: rooms.reduce((sum, r) => sum + (r.submittedCount || 0), 0) },
            { id: 'classes', label: '👥 Lớp học', count: classes.length }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as Tab);
                if (tab.id !== 'results') {
                  setSelectedSubmission(null);
                }
              }}
              className={`px-6 py-3 rounded-xl font-semibold transition whitespace-nowrap ${
                activeTab === tab.id ? 'bg-teal-600 text-white shadow-lg' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.label}
              <span className="ml-2 px-2 py-0.5 bg-white/20 rounded-full text-sm">{tab.count}</span>
            </button>
          ))}
          {/* Tab Tài khoản học sinh */}
          <button
            onClick={() => { setActiveTab('accounts'); setSelectedSubmission(null); }}
            className={`px-6 py-3 rounded-xl font-semibold transition whitespace-nowrap ${
              activeTab === 'accounts' ? 'bg-teal-600 text-white shadow-lg' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            🔑 Tài khoản HS
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Đang tải...</p>
          </div>
        ) : (
          <>
            {/* Tab: Exams */}
            {activeTab === 'exams' && (
              <div>
                {/* Upload Button */}
                <div className="bg-white rounded-2xl p-6 shadow-lg mb-6">
                  <h3 className="font-bold text-gray-800 mb-4">📤 Tải lên đề thi mới (Môn Toán)</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Hỗ trợ file Word (.docx) với công thức LaTeX ($...$) và 3 loại câu hỏi: Trắc nghiệm, Đúng/Sai, Trả lời
                    ngắn
                  </p>
                  <input
                    type="file"
                    accept=".docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                      e.currentTarget.value = '';
                    }}
                    className="hidden"
                    id="upload-exam"
                    disabled={isUploading}
                  />
                  <label
                    htmlFor="upload-exam"
                    className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold cursor-pointer transition ${
                      isUploading ? 'bg-gray-300 cursor-not-allowed' : 'bg-teal-600 text-white hover:bg-teal-700'
                    }`}
                  >
                    {isUploading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        Đang xử lý...
                      </>
                    ) : (
                      <>📂 Chọn file Word (.docx)</>
                    )}
                  </label>

                  {/* Tạo đề từ PDF */}
                  <button
                    onClick={() => setShowPDFCreator(true)}
                    disabled={isUploading}
                    className="ml-3 inline-flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600
                      text-white rounded-xl font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    📄 Tạo đề từ PDF
                  </button>
                </div>

                {/* Exams List */}
                <div className="grid gap-4">
                  {exams.length === 0 ? (
                    <div className="bg-white rounded-2xl p-12 text-center">
                      <div className="text-6xl mb-4">📝</div>
                      <p className="text-gray-500">Chưa có đề thi nào. Hãy tải lên đề thi đầu tiên!</p>
                    </div>
                  ) : (
                    exams.map((exam) => {
                      const counts = getQuestionTypeCounts(exam);
                      return (
                        <div key={exam.id} className="bg-white rounded-xl p-5 shadow-md hover:shadow-lg transition">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center text-2xl">
                                {exam.hasPdfSubcollection ? '📑' : '📄'}
                              </div>
                              <div>
                                <h3 className="font-bold text-gray-800">{exam.title}</h3>
                                <p className="text-sm text-gray-500">
                                  {exam.questions.length} câu • {exam.timeLimit} phút
                                  {exam.hasPdfSubcollection && (
                                    <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                                      📄 PDF
                                    </span>
                                  )}
                                </p>
                                <div className="flex gap-2 mt-1">
                                  {counts.mc > 0 && (
                                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                      TN: {counts.mc}
                                    </span>
                                  )}
                                  {counts.tf > 0 && (
                                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                      Đ/S: {counts.tf}
                                    </span>
                                  )}
                                  {counts.sa > 0 && (
                                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                                      TLN: {counts.sa}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setSelectedExamForRoom(exam);
                                  setShowCreateRoom(true);
                                }}
                                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition text-sm font-medium"
                              >
                                🏠 Tạo phòng
                              </button>
                              <button
                                onClick={() => handleDeleteExam(exam.id)}
                                className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition text-sm font-medium"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Tab: Rooms */}
            {activeTab === 'rooms' && (
              <div className="grid gap-4">
                {rooms.length === 0 ? (
                  <div className="bg-white rounded-2xl p-12 text-center">
                    <div className="text-6xl mb-4">🏠</div>
                    <p className="text-gray-500">Chưa có phòng thi nào. Tạo phòng từ đề thi!</p>
                  </div>
                ) : (
                  rooms.map((room) => (
                    <div key={room.id} className="bg-white rounded-xl p-5 shadow-md">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-4">
                          <div
                            className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${
                              room.status === 'active'
                                ? 'bg-green-100'
                                : room.status === 'closed'
                                ? 'bg-gray-100'
                                : 'bg-yellow-100'
                            }`}
                          >
                            {room.status === 'active' ? '🟢' : room.status === 'closed' ? '🔴' : '🟡'}
                          </div>
                          <div>
                            <h3 className="font-bold text-gray-800">{room.examTitle}</h3>
                            <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
                                        <span
              className="font-mono font-bold text-lg text-teal-600 cursor-pointer hover:text-teal-800"
              onClick={() => copyToClipboard(room.code)}
              title="Click để copy mã phòng"
            >
              📋 {room.code}
            </span>
          
            {/* BẮT ĐẦU PHẦN THÊM MỚI: NÚT COPY LINK */}
            <button
              onClick={() => {
                const link = `${window.location.origin}?code=${room.code}`;
                navigator.clipboard.writeText(link);
                alert('✅ Đã copy link thi:\n' + link);
              }}
              className="px-2 py-1 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-100 transition text-xs font-bold flex items-center gap-1"
              title="Click để copy đường dẫn trực tiếp"
            >
              🔗 Copy Link
            </button>
            {/* KẾT THÚC PHẦN THÊM MỚI */}

                              {room.className && (
                                <>
                                  <span>•</span>
                                  <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                                    {room.className}
                                  </span>
                                </>
                              )}

                              <span>•</span>
                              <span>{room.timeLimit} phút</span>

                              <span>•</span>
                              <span>{room.submittedCount} đã nộp</span>

                              {(room.opensAt || room.closesAt) && (
                                <>
                                  <span>•</span>
                                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
                                    ⏰ {room.opensAt ? `Mở: ${room.opensAt.toLocaleString()}` : 'Mở: -'}{' '}
                                    {room.closesAt ? `• Đóng: ${room.closesAt.toLocaleString()}` : ''}
                                  </span>
                                </>
                              )}

                              {room.settings && (
                                <>
                                  <span>•</span>
                                  <div className="flex gap-1">
                                    {room.settings.showCorrectAnswers && (
                                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium" title="Cho xem đáp án">
                                        ✅
                                      </span>
                                    )}
                                    {room.settings.showExplanations && (
                                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium" title="Cho xem lời giải">
                                        📖
                                      </span>
                                    )}
                                    {room.settings.maxAttempts === 0 ? (
                                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium" title="Làm lại không giới hạn">
                                        🔄 Nhiều lần
                                      </span>
                                    ) : (
                                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium" title="Chỉ 1 lần">
                                        1️⃣ 1 lần
                                      </span>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold ${
                              room.status === 'active'
                                ? 'bg-green-100 text-green-700'
                                : room.status === 'closed'
                                ? 'bg-gray-100 text-gray-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            {room.status === 'active' ? 'Đang thi' : room.status === 'closed' ? 'Đã đóng' : 'Chờ bắt đầu'}
                          </span>

                          {room.status === 'waiting' && (
                            <button
                              onClick={() => handleRoomAction(room.id, 'start')}
                              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium"
                            >
                              ▶️ Bắt đầu
                            </button>
                          )}
                          {room.status === 'active' && (
                            <button
                              onClick={() => handleRoomAction(room.id, 'close')}
                              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium"
                            >
                              ⏹️ Đóng phòng
                            </button>
                          )}

                          {/* ✅ TÍCH HỢP: Nút Giám sát — chỉ hiện khi phòng đang active */}
                          {room.status === 'active' && (
                            <button
                              onClick={() => setMonitoringRoom(room)}
                              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-sm font-medium"
                              title="Giám sát học sinh đang thi realtime"
                            >
                              🖥️ Giám sát
                            </button>
                          )}

                          <button
                            onClick={() => {
                              setSelectedRoom(room);
                              setActiveTab('results');
                            }}
                            className="px-4 py-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition text-sm font-medium"
                          >
                            📊 Kết quả
                          </button>
                          <button
                            onClick={() => handleRoomAction(room.id, 'delete')}
                            className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition text-sm font-medium"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab: Results */}
            {activeTab === 'results' && (
              <div>
                {/* Room Selector */}
                <div className="bg-white rounded-xl p-4 mb-6 shadow-md">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Chọn phòng thi:</label>
                  <select
                    value={selectedRoom?.id || ''}
                    onChange={(e) => {
                      const room = rooms.find((r) => r.id === e.target.value) || null;
                      setSelectedRoom(room);
                      setSelectedSubmission(null);
                      if (!room) {
                        setSubmissions([]);
                        setCurrentExam(null);
                      }
                    }}
                    className="w-full p-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
                  >
                    <option value="">-- Chọn phòng --</option>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.code} - {room.examTitle} ({room.submittedCount} bài nộp)
                      </option>
                    ))}
                  </select>
                </div>

                {/* ✅ Nút giám sát trong tab kết quả (nếu phòng đang active) */}
                {selectedRoom && selectedRoom.status === 'active' && (
                  <div className="mb-4">
                    <button
                      onClick={() => setMonitoringRoom(selectedRoom)}
                      className="px-5 py-2.5 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition flex items-center gap-2"
                    >
                      🖥️ Giám sát realtime
                    </button>
                  </div>
                )}

                {/* ✅ Nút xuất Excel & Chấm AI */}
                {selectedRoom && submissions.length > 0 && (
                  <div className="mb-6 flex gap-3 flex-wrap">
                    <button
                      onClick={() => exportSubmissionsToExcel(submissions, selectedRoom)}
                      className="px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition flex items-center gap-2"
                    >
                      📊 Xuất Excel
                    </button>
                    {/* Nút Chấm Tự Luận AI hiển thị khi đề có câu Tự luận */}
                    {currentExam?.questions.some(q => q.type === 'writing') && (
                      <button
                        onClick={() => setShowEssayGrader(true)}
                        className="px-6 py-3 bg-violet-600 text-white rounded-xl font-semibold hover:bg-violet-700 transition flex items-center gap-2"
                      >
                        🤖 Chấm Tự Luận (AI Gemini)
                      </button>
                    )}
                  </div>
                )}

                {/* Results Table */}
                {selectedRoom && (
                  <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                    <div className="p-4 bg-teal-600 text-white">
                      <h3 className="font-bold">📊 Kết quả: {selectedRoom.examTitle}</h3>
                      <p className="text-sm text-teal-100">
                        Mã phòng: {selectedRoom.code} • {submissions.length} bài nộp
                      </p>
                    </div>

                    {submissions.length === 0 ? (
                      <div className="p-12 text-center">
                        <div className="text-5xl mb-4">🔭</div>
                        <p className="text-gray-500">Chưa có học sinh nào nộp bài</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">STT</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Họ tên</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Lớp</th>
                              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Điểm</th>
                              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Phần trăm</th>
                              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Đúng/Tổng</th>
                              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Thời gian</th>
                              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Hành động</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {submissions.map((sub, idx) => (
                              <tr key={sub.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm">{idx + 1}</td>
                                <td className="px-4 py-3 font-medium">
                                  {sub.student.name}
                                  {sub.tabSwitchCount > 0 && (
                                    <span className="ml-2 text-xs text-red-600" title="Có chuyển tab">
                                      ⚠️{sub.tabSwitchCount}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">{sub.student.className || '-'}</td>
                                <td className="px-4 py-3 text-center">
                                  <span
                                    className={`font-bold text-lg ${
                                      sub.totalScore >= 8
                                        ? 'text-green-600'
                                        : sub.totalScore >= 5
                                        ? 'text-yellow-600'
                                        : 'text-red-600'
                                    }`}
                                  >
                                    {formatScore(sub.totalScore)}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center text-sm">
                                  <span className="font-semibold">{sub.percentage}%</span>
                                </td>
                                <td className="px-4 py-3 text-center text-sm">
                                  <span className="text-green-600 font-medium">{sub.correctCount}</span>
                                  <span className="text-gray-400">/{sub.totalQuestions}</span>
                                </td>
                                <td className="px-4 py-3 text-center text-sm text-gray-600">
                                  {Math.floor(sub.duration / 60)}:{(sub.duration % 60).toString().padStart(2, '0')}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <button
                                    onClick={() => setSelectedSubmission(sub)}
                                    className="px-3 py-1 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 text-sm font-medium"
                                  >
                                    👁️ Chi tiết
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Summary Stats */}
                    {submissions.length > 0 && (
                      <div className="p-4 bg-gray-50 border-t">
                        <div className="grid grid-cols-4 gap-4 text-center">
                          <div>
                            <div className="text-2xl font-bold text-teal-600">{submissions.length}</div>
                            <div className="text-sm text-gray-500">Tổng bài nộp</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-green-600">
                              {formatScore(submissions.reduce((acc, s) => acc + s.totalScore, 0) / submissions.length)}
                            </div>
                            <div className="text-sm text-gray-500">Điểm TB</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-blue-600">
                              {formatScore(Math.max(...submissions.map((s) => s.totalScore)))}
                            </div>
                            <div className="text-sm text-gray-500">Cao nhất</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-orange-600">
                              {formatScore(Math.min(...submissions.map((s) => s.totalScore)))}
                            </div>
                            <div className="text-sm text-gray-500">Thấp nhất</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Classes */}
            {activeTab === 'classes' && (
              <div>
                <div className="mb-6">
                  <button
                    onClick={() => setShowCreateClass(true)}
                    className="px-6 py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition"
                  >
                    ➕ Tạo lớp mới
                  </button>
                </div>

                <div className="grid gap-4">
                  {classes.length === 0 ? (
                    <div className="bg-white rounded-2xl p-12 text-center">
                      <div className="text-6xl mb-4">👥</div>
                      <p className="text-gray-500">Chưa có lớp học nào. Hãy tạo lớp đầu tiên!</p>
                    </div>
                  ) : (
                    classes.map((cls) => (
                      <div key={cls.id} className="bg-white rounded-xl p-5 shadow-md hover:shadow-lg transition">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center text-2xl">
                              🎓
                            </div>
                            <div>
                              <h3 className="font-bold text-gray-800 text-lg">{cls.name}</h3>
                              <p className="text-sm text-gray-500">
                                {cls.grade && `Khối ${cls.grade} • `}
                                {cls.totalStudents} học sinh
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setSelectedClass(cls)}
                              className="px-4 py-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition text-sm font-medium"
                            >
                              👥 Xem học sinh
                            </button>
                            <button
                              onClick={() => handleDeleteClass(cls.id, cls.name)}
                              className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition text-sm font-medium"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Tab: Tài khoản Học sinh */}
            {activeTab === 'accounts' && (
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <StudentAccountManager
                  teacher={user}
                  classes={classes}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* MODAL: PointsConfigEditor */}
      {showPointsConfig && pendingPointsConfig && pendingMeta && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-3xl">
            <div className="mb-3 bg-white/90 rounded-xl p-4 border border-orange-200">
              <div className="font-bold text-gray-800">📌 Đề: {pendingMeta.title}</div>
              <div className="text-sm text-gray-600 mt-1">
                Tổng {pendingMeta.total} câu • TN {pendingMeta.mc} • Đ/S {pendingMeta.tf} • TLN {pendingMeta.sa}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Nhập "tổng điểm" cho từng phần (ví dụ TN=3 điểm, Đ/S=7 điểm) → hệ thống tự chia "điểm mỗi câu".
              </div>
            </div>

            <PointsConfigEditor
              config={pendingPointsConfig}
              onChange={async (cfg) => {
                setPendingPointsConfig(cfg);
                await finalizeCreateExam(cfg);
              }}
              onClose={() => {
                if (isUploading) return;
                resetPendingUpload();
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL: PDF Exam Creator */}
      {showPDFCreator && (
        <div className="fixed inset-0 bg-black/60 z-50 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center py-8 px-4">
            <div className="w-full max-w-3xl">
              <PDFExamCreator
                teacherId={user.id}
                teacherName={user.name}
                onSave={async (examData) => {
                  setIsUploading(true);
                  try {
                    await createExam(examData as any);
                    setShowPDFCreator(false);
                    await loadData();
                    alert('✅ Đã lưu đề thi PDF thành công!');
                  } catch (err) {
                    console.error('Create PDF exam error:', err);
                    alert('❌ Lỗi khi lưu đề thi: ' + (err as Error).message);
                  } finally {
                    setIsUploading(false);
                  }
                }}
                onCancel={() => setShowPDFCreator(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Create Room Modal */}
      {showCreateRoom && selectedExamForRoom && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl my-8">
            <h3 className="text-xl font-bold text-gray-900 mb-4">🏠 Tạo phòng thi</h3>

            <div className="bg-teal-50 rounded-xl p-4 mb-4">
              <p className="text-sm text-teal-600">Đề thi:</p>
              <p className="font-bold text-teal-900">{selectedExamForRoom.title}</p>
              <p className="text-sm text-teal-600">{selectedExamForRoom.questions.length} câu hỏi</p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">⏱️ Thời gian làm bài (phút):</label>
              <input
                type="number"
                value={roomTimeLimit}
                onChange={(e) => setRoomTimeLimit(parseInt(e.target.value) || 45)}
                min={5}
                max={180}
                className="w-full p-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">👥 Chọn lớp (tùy chọn):</label>
              <select
                value={selectedClassForRoom}
                onChange={(e) => setSelectedClassForRoom(e.target.value)}
                className="w-full p-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
              >
                <option value="">-- Tất cả học sinh --</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name} ({cls.totalStudents} HS)
                  </option>
                ))}
              </select>
            </div>

            {/* Hẹn giờ mở/đóng */}
            <div className="mb-4">
              <label className="flex items-center gap-3 cursor-pointer p-3 bg-indigo-50 border-2 border-indigo-200 rounded-xl hover:bg-indigo-100 transition">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                  className="w-5 h-5 accent-indigo-500"
                />
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">⏰ Hẹn giờ mở/đóng phòng</div>
                  <div className="text-xs text-gray-600 mt-0.5">Nếu bật, học sinh chỉ thi trong khoảng thời gian này</div>
                </div>
              </label>

              {scheduleEnabled && (
                <div className="mt-3 grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Giờ mở:</label>
                    <input
                      type="datetime-local"
                      value={roomOpensAt}
                      onChange={(e) => setRoomOpensAt(e.target.value)}
                      className="w-full p-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Giờ đóng:</label>
                    <input
                      type="datetime-local"
                      value={roomClosesAt}
                      onChange={(e) => setRoomClosesAt(e.target.value)}
                      className="w-full p-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    Nếu để trống "giờ đóng" → hệ thống tự đóng = giờ mở + {roomTimeLimit} phút.
                  </p>
                </div>
              )}
            </div>

            {/* Cho phép thi tự do */}
            <div className="mb-4">
              <label className="flex items-center gap-3 cursor-pointer p-3 bg-orange-50 border-2 border-orange-200 rounded-xl hover:bg-orange-100 transition">
                <input
                  type="checkbox"
                  checked={allowAnonymous}
                  onChange={(e) => setAllowAnonymous(e.target.checked)}
                  className="w-5 h-5 accent-orange-500"
                />
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">🆓 Cho phép thi tự do</div>
                  <div className="text-xs text-gray-600 mt-0.5">Học sinh có thể thi mà không cần đăng nhập Google</div>
                </div>
              </label>
            </div>

            {/* Cho phép làm lại */}
            <div className="mb-4">
              <label className="flex items-center gap-3 cursor-pointer p-3 bg-purple-50 border-2 border-purple-200 rounded-xl hover:bg-purple-100 transition">
                <input
                  type="checkbox"
                  checked={allowRetake}
                  onChange={(e) => setAllowRetake(e.target.checked)}
                  className="w-5 h-5 accent-purple-500"
                />
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">🔄 Cho phép làm lại</div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    {allowRetake ? 'Học sinh có thể thi nhiều lần không giới hạn' : 'Mỗi học sinh chỉ được thi 1 lần'}
                  </div>
                </div>
              </label>
            </div>

            {/* Cho phép xem đáp án */}
            <div className="mb-4">
              <label className="flex items-center gap-3 cursor-pointer p-3 bg-green-50 border-2 border-green-200 rounded-xl hover:bg-green-100 transition">
                <input
                  type="checkbox"
                  checked={showCorrectAnswers}
                  onChange={(e) => setShowCorrectAnswers(e.target.checked)}
                  className="w-5 h-5 accent-green-500"
                />
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">✅ Cho xem đáp án đúng</div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    Học sinh có thể xem đáp án đúng sau khi nộp bài
                  </div>
                </div>
              </label>
            </div>

            {/* Cho phép xem lời giải */}
            <div className="mb-6">
              <label className="flex items-center gap-3 cursor-pointer p-3 bg-blue-50 border-2 border-blue-200 rounded-xl hover:bg-blue-100 transition">
                <input
                  type="checkbox"
                  checked={showExplanations}
                  onChange={(e) => setShowExplanations(e.target.checked)}
                  className="w-5 h-5 accent-blue-500"
                />
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">📖 Cho xem lời giải</div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    Học sinh có thể xem lời giải chi tiết cho từng câu hỏi
                  </div>
                </div>
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={resetRoomModal}
                className="flex-1 py-3 rounded-xl font-semibold border-2 border-gray-300 hover:bg-gray-50 transition"
              >
                Hủy
              </button>
              <button
                onClick={handleCreateRoom}
                className="flex-1 py-3 rounded-xl font-bold text-white transition"
                style={{ background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)' }}
              >
                ✓ Tạo phòng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Class Modal */}
      {showCreateClass && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-gray-900 mb-4">🎓 Tạo lớp mới</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tên lớp: <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder="VD: 10A1, Toán 11, ..."
                className="w-full p-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Khối (tùy chọn):</label>
              <select
                value={newClassGrade}
                onChange={(e) => setNewClassGrade(e.target.value)}
                className="w-full p-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
              >
                <option value="">-- Chọn khối --</option>
                <option value="10">Khối 10</option>
                <option value="11">Khối 11</option>
                <option value="12">Khối 12</option>
              </select>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateClass(false);
                  setNewClassName('');
                  setNewClassGrade('');
                }}
                className="flex-1 py-3 rounded-xl font-semibold border-2 border-gray-300 hover:bg-gray-50 transition"
              >
                Hủy
              </button>
              <button
                onClick={handleCreateClass}
                className="flex-1 py-3 rounded-xl font-bold text-white transition"
                style={{ background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)' }}
              >
                ✓ Tạo lớp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Class Students Modal */}
      {selectedClass && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-purple-600 text-white p-6 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold">{selectedClass.name}</h3>
                  <p className="text-purple-100 text-sm">{classStudents.length} học sinh</p>
                </div>
                <button
                  onClick={() => {
                    setSelectedClass(null);
                    setClassStudents([]);
                  }}
                  className="p-2 hover:bg-white/20 rounded-lg transition"
                >
                  ✖
                </button>
              </div>
            </div>

            <div className="p-6">
              {classStudents.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-5xl mb-4">👥</div>
                  <p className="text-gray-500">Chưa có học sinh trong lớp</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {classStudents.map((student, idx) => (
                    <div key={student.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 bg-purple-500 text-white rounded-full flex items-center justify-center font-bold">
                          {idx + 1}
                        </span>
                        {student.avatar ? (
                          <img src={student.avatar} alt="" className="w-10 h-10 rounded-full" />
                        ) : (
                          <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center font-bold">
                            {student.name.charAt(0)}
                          </div>
                        )}
                        <div>
                          <p className="font-semibold">{student.name}</p>
                          <p className="text-sm text-gray-500">{student.email}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (confirm(`Xóa ${student.name} khỏi lớp?`)) {
                            removeStudentFromClass(selectedClass.id, student.id).then(() => {
                              loadClassStudents(selectedClass.id);
                              loadData();
                            });
                          }
                        }}
                        className="px-3 py-1 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 text-sm"
                      >
                        Xóa
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Submission Detail View */}
      {selectedSubmission && currentExam && (
        <SubmissionDetailView
          submission={selectedSubmission}
          exam={currentExam}
          onClose={() => setSelectedSubmission(null)}
        />
      )}

      {/* ✅ TÍCH HỢP: LiveMonitoringPanel — render ở cuối, z-index cao nhất */}
      {monitoringRoom && (
        <LiveMonitoringPanel
          roomId={monitoringRoom.id}
          roomCode={monitoringRoom.code}
          examTitle={monitoringRoom.examTitle}
          timeLimit={monitoringRoom.timeLimit}
          onClose={() => setMonitoringRoom(null)}
        />
      )}

      {/* ✅ MỚI: MODAL CHẤM TỰ LUẬN AI */}
      {showEssayGrader && selectedRoom && currentExam && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl p-6 w-full max-w-5xl my-8 shadow-2xl relative">
            <button 
              onClick={() => setShowEssayGrader(false)}
              className="absolute top-4 right-4 w-10 h-10 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-full flex items-center justify-center text-xl font-bold transition"
            >
              ✕
            </button>
            
            <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-4">
              Chấm Tự Luận: {selectedRoom.examTitle}
            </h2>
            
            <div className="max-h-[70vh] overflow-y-auto custom-scrollbar pr-2">
              <EssayGraderPanel
                submissions={submissions}
                questions={currentExam.questions}
                onScoreUpdate={async (submissionId, qNum, score, feedback) => {
                  try {
                    const subToUpdate = submissions.find(s => s.id === submissionId);
                    if (!subToUpdate) return;
                    
                    const newBreakdown = { ...subToUpdate.scoreBreakdown };
                    const writingDetails = (newBreakdown as any).writing?.details || {};
                    const oldQScore = writingDetails[qNum]?.points || 0;
                    
                    writingDetails[qNum] = { points: score, feedback };
                    
                    const newWritingTotal = Object.values(writingDetails).reduce((sum: any, val: any) => sum + (val.points || 0), 0) as number;
                    
                    (newBreakdown as any).writing = {
                      ...((newBreakdown as any).writing || {}),
                      details: writingDetails,
                      points: newWritingTotal
                    };
                    
                    const newTotalScore = newBreakdown.multipleChoice.points + newBreakdown.trueFalse.points + newBreakdown.shortAnswer.points + newWritingTotal;
                    
                    // Cập nhật State React ngay lập tức để giao diện không bị giật lag
                    setSubmissions(prev => prev.map(s => 
                      s.id === submissionId ? { ...s, scoreBreakdown: newBreakdown, totalScore: newTotalScore, score: newTotalScore } : s
                    ));

                    // Lưu dữ liệu cập nhật lên Firebase
                    await updateSubmission(submissionId, { 
                      scoreBreakdown: newBreakdown, 
                      totalScore: newTotalScore,
                      score: newTotalScore 
                    });

                  } catch (error) {
                    console.error("Lỗi cập nhật điểm tự luận:", error);
                    alert("Cập nhật điểm thất bại. Vui lòng thử lại!");
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}


      {createdRoomInfo && (
        <RoomCreatedModal
          roomCode={createdRoomInfo.code}
          examTitle={createdRoomInfo.examTitle}
          timeLimit={createdRoomInfo.timeLimit}
          className={createdRoomInfo.className}
          onClose={() => setCreatedRoomInfo(null)}
        />
      )}

    </div>
  );
};

export default TeacherDashboard;
