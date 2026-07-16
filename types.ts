// ============ ENUMS ============

export enum Role {
  STUDENT = 'student',
  TEACHER = 'teacher',
  ADMIN = 'admin',
  MEMBER = 'member',
  DEPUTY = 'deputy',
  LEADER = 'leader'
}

// ============ QUESTION TYPES ============

export type QuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'short_answer'
  | 'writing'
  | 'unknown';

// ============ IMAGE DATA ============

export interface ImageData {
  id: string;
  filename: string;
  base64: string;
  contentType: string;
  rId?: string;
}

// ============ USER ============

export interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  role: Role;
  status?: 'online' | 'offline' | 'busy';
  isApproved?: boolean;
  createdAt?: Date;
  classIds?: string[];
  studentId?: string;
}

// ============ CLASS ============

export interface Class {
  id: string;
  name: string;
  grade?: string;
  subject?: string;
  teacherId: string;
  teacherName: string;
  studentIds: string[];
  totalStudents: number;
  createdAt?: Date;
  updatedAt?: Date;
}

// ============ STUDENT INFO ============

export interface StudentInfo {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  className?: string;
  classId?: string;
  studentId?: string;
}

// ============ QUESTION & OPTIONS ============

export interface QuestionOption {
  letter: string;
  text: string;
  textWithUnderline?: string;
  isCorrect?: boolean;
}

export interface SectionInfo {
  letter: string;
  name: string;
  points: string;
}

export interface Question {
  number: number;
  text: string;
  type: QuestionType;
  options: QuestionOption[];
  correctAnswer: string | null;
  section?: SectionInfo;
  part?: string;
  passage?: string;
  solution?: string;
  images?: ImageData[];
  tfStatements?: { [key: string]: string };
}

// ============ EXAM SECTION ============

export interface ExamSection {
  name: string;
  description: string;
  points: string;
  readingPassage?: string;
  questions: Question[];
  sectionType?: QuestionType;
}

// ============ EXAM DATA ============

export interface ExamData {
  title: string;
  subject?: 'math' | 'english' | 'other';
  timeLimit?: number;
  sections: ExamSection[];
  questions: Question[];
  answers: { [key: number]: string };
  images?: ImageData[];
}

// ============ FLEXIBLE SCORING SYSTEM ============

export type TrueFalseMode = 'equal' | 'stepped';

// Sửa interface SectionPointsConfig thành như sau:
export interface SectionPointsConfig {
  sectionId: string;
  sectionName: string;
  // ✅ MỚI: Thêm 'writing' vào danh sách
  questionType: 'multiple_choice' | 'true_false' | 'short_answer' | 'writing';
  totalQuestions: number;
  totalPoints: number;
  pointsPerQuestion: number;
  trueFalseMode?: TrueFalseMode;
}

export interface ExamPointsConfig {
  maxScore: number;
  sections: SectionPointsConfig[];
  autoBalance?: boolean;
}

// ============ QUESTION SOLUTION RANGE ============
// Lưu vị trí trang của lời giải từng câu trong PDF lời giải

export interface QuestionSolutionRange {
  pageStart: number; // trang bắt đầu (1-based)
  pageEnd: number;   // trang kết thúc (1-based, inclusive)
}

// ============ ROOM SETTINGS ============

export interface RoomSettings {
  allowLateJoin: boolean;
  showResultAfterSubmit: boolean;
  shuffleQuestions: boolean;
  maxAttempts: number;
  allowAnonymous: boolean;
  showCorrectAnswers: boolean;
  showExplanations: boolean;
  showAnswersAfterClose?: boolean;
  allowReview?: boolean;
}

// ============ ROOM ============

export interface Room {
  id: string;
  code: string;
  examId: string;
  examTitle: string;
  teacherId: string;
  teacherName: string;
  classId?: string;
  className?: string;
  status: 'waiting' | 'active' | 'closed';
  startTime?: Date;
  endTime?: Date;
  timeLimit: number;
  settings: RoomSettings;
  allowLateJoin?: boolean;
  showResultAfterSubmit?: boolean;
  shuffleQuestions?: boolean;
  maxAttempts?: number;
  allowAnonymous?: boolean;
  totalStudents: number;
  submittedCount: number;
  createdAt?: Date;
  updatedAt?: Date;
  opensAt?: Date;
  closesAt?: Date;
}

// ============ PDF OVERLAY ============
// Vị trí các control vẽ đè lên PDF (radio MC, nút Đ/S, ô trả lời ngắn, ô tự luận)
// được giáo viên kéo thả trong PDFExamCreator (Bước 5)

export interface PdfOverlayControl {
  id: string;
  kind: 'mc_opt' | 'tf_sub' | 'sa_box' | 'wr_box';
  qNum: number;        // 1-N (MC), 201+ (TF), 301+ (SA), 401+ (Tự luận)
  letter?: string;     // 'A'-'D' cho MC, 'a'-'d' cho TF
  page: number;        // 0-based page index
  xPct: number;        // left  (% chiều rộng trang)
  yPct: number;        // top   (% chiều cao trang)
  widthPct?: number;   // chiều rộng (% trang) — chỉ sa_box / wr_box
  heightPx?: number;   // chiều cao (px)       — chỉ sa_box / wr_box
}

// ============ EXAM ============

export interface Exam {
  id: string;
  title: string;
  description?: string;
  subject?: string;
  timeLimit: number;
  questions: Question[];
  sections: ExamSection[];
  answers: { [key: number]: string };
  images?: ImageData[];
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
  pointsConfig?: ExamPointsConfig;

  // ✅ PDF đề thi (không lời giải) — lưu trên Google Drive
  pdfDriveUrl?: string;
  pdfDriveFileId?: string;

  // ✅ PDF lời giải — lưu trên Google Drive (học sinh xem sau khi nộp)
  solutionPdfDriveUrl?: string;
  solutionPdfDriveFileId?: string;

  // ✅ Map câu → page range trong PDF lời giải
  // VD: { 1: {pageStart:1, pageEnd:2}, 2: {pageStart:3, pageEnd:4} }
  questionSolutions?: { [questionNumber: number]: QuestionSolutionRange };

  // ✅ Overlay mode — vẽ controls trực tiếp lên PDF
  // overlayMode: bật/tắt chế độ overlay (mặc định true nếu có pdfDriveFileId)
  // pdfOverlayControls: vị trí controls do giáo viên kéo thả trong PDFExamCreator
  overlayMode?: boolean;
  pdfOverlayControls?: PdfOverlayControl[];

  // Backward compat — PDF base64 cũ lưu theo chunks trong subcollection
  hasPdfSubcollection?: boolean;
  pdfBase64?: string; // runtime only, không lưu Firestore
}

// ============ SCORE BREAKDOWN ============

// Tìm đến interface ScoreBreakdown và sửa thành như sau:
export interface ScoreBreakdown {
  multipleChoice: {
    total: number;
    correct: number;
    points: number;
    pointsPerQuestion?: number;
  };
  trueFalse: {
    total: number;
    correct: number;
    partial: number;
    points: number;
    pointsPerQuestion?: number;
    details: {
      [questionNumber: number]: {
        correctCount: number;
        points: number;
      };
    };
  };
  shortAnswer: {
    total: number;
    correct: number;
    points: number;
    pointsPerQuestion?: number;
  };
  // ✅ MỚI: Thêm phần Tự luận vào ScoreBreakdown
  writing?: {
    total: number;
    correct: number;
    points: number;
    pointsPerQuestion?: number;
    details?: {
      [questionNumber: number]: {
        points: number;
        feedback?: string;
      };
    };
  };
  totalScore: number;
  percentage: number;
}

// ============ SUBMISSION ============

export interface Submission {
  id: string;
  roomId: string;
  roomCode: string;
  examId: string;
  student: StudentInfo;
  answers: { [questionNumber: number]: string };
  scoreBreakdown: ScoreBreakdown;
  totalScore: number;
  percentage: number;
  score: number;
  correctCount: number;
  wrongCount: number;
  totalQuestions: number;
  tabSwitchCount: number;
  tabSwitchWarnings: Date[];
  autoSubmitted: boolean;
  startedAt?: Date;
  submittedAt?: Date;
  duration: number;
  status: 'in_progress' | 'submitted' | 'graded';
}

// ============ ROOM WITH EXAM ============

export interface RoomWithExam extends Room {
  exam: Exam;
}

// ============ LEADERBOARD ============

export interface LeaderboardEntry {
  rank: number;
  student: StudentInfo;
  score: number;
  percentage: number;
  duration: number;
  submittedAt?: Date;
  scoreBreakdown?: ScoreBreakdown;
}

// ============ STUDENT ACCOUNT ============

export interface StudentAccount {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  classId?: string;
  className?: string;
  teacherId: string;
  isActive: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface CreateStudentAccountInput {
  username: string;
  password: string;
  name: string;
  classId?: string;
  className?: string;
  teacherId: string;
}

export interface BulkImportStudentRow {
  name: string;
  username: string;
  password: string;
  className?: string;
}

export interface BulkImportResult {
  success: number;
  failed: number;
  errors: string[];
}

// ============ CLASS JOIN REQUEST ============

export interface ClassJoinRequest {
  id: string;
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
  studentEmail?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt?: Date;
  processedAt?: Date;
  processedBy?: string;
}

// ============ EXAM SESSION ============

export interface SessionViolation {
  type: 'tab_switch' | 'focus_loss' | 'multi_device' | 'auto_submit';
  timestamp: string;
  detail?: string;
}

export interface ExamSession {
  sessionId: string;
  roomId: string;
  studentId: string;
  studentName: string;
  className?: string;
  deviceInfo?: string;
  startedAt: Date | any;
  lastHeartbeat: Date | any | null;
  tabSwitches: number;
  violations: SessionViolation[];
  answeredCount: number;
  totalQuestions: number;
  timeRemaining: number;
  status: 'active' | 'submitted';
}
