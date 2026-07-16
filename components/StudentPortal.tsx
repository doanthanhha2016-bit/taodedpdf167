// src/components/StudentPortal.tsx
// ✅ Cập nhật: Thêm đăng nhập bằng tài khoản học sinh (username/password)

import React, { useState, useEffect, useCallback } from 'react';
import { User, Role, Room, StudentInfo } from '../types';
import {
  auth,
  signInStudentWithGoogle,
  signOutUser,
  getRoomByCode,
  getRoomsForStudent,
  getStudentSubmission,
  getCurrentUser,
  getClass,
  ensureSignedIn,
} from '../services/firebaseService';
import {
  loginWithStudentAccount,
  getStudentAccountByUsername,
} from '../services/studentAccountService';
import StudentHistory from './StudentHistory';

interface StudentPortalProps {
  onJoinRoom: (room: Room, student: StudentInfo, submissionId?: string) => void;
  onBack?: () => void;
}

// Thêm 'credential' vào các mode đăng nhập
type LoginMode = 'select' | 'google' | 'anonymous' | 'credential';
type ActiveTab  = 'join' | 'history';

const StudentPortal: React.FC<StudentPortalProps> = ({ onJoinRoom, onBack }) => {
  const [loginMode, setLoginMode]   = useState<LoginMode>('select');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading]   = useState(true);
  const [activeTab, setActiveTab]   = useState<ActiveTab>('join');

  // Available rooms
  const [availableRooms, setAvailableRooms]   = useState<Room[]>([]);
  const [isLoadingRooms, setIsLoadingRooms]   = useState(false);

  // Room code input
  const [roomCode, setRoomCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  // Anonymous mode
  const [studentName, setStudentName] = useState('');
  const [className, setClassName]     = useState('');

  // ── Credential login state ──
  const [credUsername, setCredUsername] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [credError, setCredError]       = useState('');
  const [isCredLoading, setIsCredLoading] = useState(false);
  const [showCredPassword, setShowCredPassword] = useState(false);

  // Class names resolved from IDs
  const [userClassNames, setUserClassNames] = useState<string[]>([]);

  // ── Helpers ──
  const resolveClassNames = useCallback(async (user: User) => {
    if (!user.classIds || user.classIds.length === 0) return;
    const names: string[] = [];
    for (const classId of user.classIds) {
      const cls = await getClass(classId);
      if (cls) names.push(cls.name);
    }
    setUserClassNames(names);
  }, []);

  const fetchAvailableRooms = useCallback(async (user: User) => {
    if (!user.classIds || user.classIds.length === 0) return;
    setIsLoadingRooms(true);
    try {
      const rooms = await getRoomsForStudent(user.classIds);
      setAvailableRooms(rooms);
    } catch (err) {
      console.error('fetchAvailableRooms error:', err);
    } finally {
      setIsLoadingRooms(false);
    }
  }, []);

  // ── Auth listener (chỉ cho Google auth) ──
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser && !firebaseUser.isAnonymous) {
        try {
          const user = await getCurrentUser();
          if (user && user.role === Role.STUDENT) {
            setCurrentUser(user);
            await resolveClassNames(user);
            if (user.isApproved) await fetchAvailableRooms(user);
            setLoginMode('google');
          }
        } catch (err) {
          console.error('Auth state error:', err);
        }
      }
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, [resolveClassNames, fetchAvailableRooms]);

  const handleBackToSelect = () => {
    setLoginMode('select');
    setRoomCode('');
    setStudentName('');
    setClassName('');
    setCredUsername('');
    setCredPassword('');
    setCredError('');
  };

  const handleGoogleLogin = async () => {
    try {
      const user = await signInStudentWithGoogle();
      if (user) {
        setCurrentUser(user);
        await resolveClassNames(user);
        if (user.isApproved) await fetchAvailableRooms(user);
        setLoginMode('google');
      }
    } catch (err) {
      console.error('Login error:', err);
      alert('Đăng nhập thất bại. Vui lòng thử lại.');
    }
  };

  // ── Credential login ──────────────────────────────────────
  const handleCredentialLogin = async () => {
    setCredError('');
    if (!credUsername.trim()) { setCredError('Vui lòng nhập tên đăng nhập.'); return; }
    if (!credPassword) { setCredError('Vui lòng nhập mật khẩu.'); return; }

    setIsCredLoading(true);
    try {
      const user = await loginWithStudentAccount(credUsername.trim(), credPassword);
      if (!user) {
        setCredError('Tên đăng nhập hoặc mật khẩu không đúng.');
        return;
      }

      // Lấy thêm thông tin classNames từ account
      const account = await getStudentAccountByUsername(credUsername.trim());
      if (account?.className) {
        setUserClassNames([account.className]);
      }

      // ✅ Lưu username vào studentId — dùng làm stable ID để dedup submissions
      // (anonymous UID thay đổi mỗi phiên, nhưng username thì không đổi)
      const userWithStableId = {
        ...user,
        studentId: user.id, // user.id = "student_username" — ổn định qua các phiên
      };
      setCurrentUser(userWithStableId);

      // Lấy phòng thi nếu có classId
      if (user.classIds && user.classIds.length > 0) {
        fetchAvailableRooms(user);
      }
    } catch (err: any) {
      setCredError(err.message || 'Có lỗi xảy ra. Vui lòng thử lại.');
    } finally {
      setIsCredLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      // Chỉ sign out Firebase nếu đang dùng Google auth
      if (loginMode === 'google') {
        await signOutUser();
      }
      setCurrentUser(null);
      setUserClassNames([]);
      setAvailableRooms([]);
      setLoginMode('select');
      setRoomCode('');
      setCredUsername('');
      setCredPassword('');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // ── Join room direct (from list) ──────────────────────────
  const handleJoinRoomDirect = async (room: Room) => {
    if (!currentUser) return;
    if (room.status !== 'active') {
      alert('⏳ Phòng thi chưa được bắt đầu!\n\nVui lòng chờ giáo viên mở phòng thi.');
      return;
    }
    setIsJoining(true);
    try {
      await ensureSignedIn();
      const firebaseUid = auth.currentUser?.uid;

      let studentClassName: string | undefined = userClassNames[0];
      if (room.classId && currentUser.classIds) {
        const idx = currentUser.classIds.indexOf(room.classId);
        if (idx >= 0 && idx < userClassNames.length) studentClassName = userClassNames[idx];
      }

      // ✅ FIX: thêm studentId (stable username) để ExamRoom lưu submission với ID ổn định
      // và dùng auth.uid làm id (nhất quán với handleJoinRoomWithAccount)
      const studentInfo: StudentInfo = {
        id: firebaseUid || currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        avatar: currentUser.avatar,
        className: studentClassName,
        studentId: currentUser.studentId || currentUser.id, // stable username
      };

      // Lookup bằng stable ID + name fallback (tìm được cả submissions cũ)
      const lookupId = currentUser.studentId || currentUser.id;
      const existing = await getStudentSubmission(room.id, lookupId, currentUser.name);
      if (existing?.status === 'submitted') {
        const maxAttempts = room.settings?.maxAttempts ?? (room as any).maxAttempts ?? 1;
        if (maxAttempts !== 0) {
          alert('✅ Bạn đã nộp bài rồi!\n\nGiáo viên không cho phép làm lại.');
          return;
        }
        // maxAttempts = 0 → cho thi lại
        onJoinRoom(room, studentInfo);
        return;
      }
      onJoinRoom(room, studentInfo, existing?.id);
    } catch (err) {
      console.error('Join room direct error:', err);
      alert('❌ Có lỗi xảy ra. Vui lòng thử lại!');
    } finally {
      setIsJoining(false);
    }
  };

  // ── Join room via code (Google or Credential mode) ─────────
  const handleJoinRoomWithAccount = async () => {
    if (!roomCode.trim()) { alert('⚠️ Vui lòng nhập mã phòng!'); return; }
    if (!currentUser)     { alert('⚠️ Vui lòng đăng nhập trước!'); return; }

    if (!currentUser.isApproved) {
      alert('⚠️ Tài khoản chưa được duyệt!\n\nLiên hệ giáo viên để được kích hoạt.');
      return;
    }

    setIsJoining(true);
    try {
      // Đảm bảo có Firebase anonymous auth để Firestore security rules hoạt động
      await ensureSignedIn();

      const room = await getRoomByCode(roomCode.trim().toUpperCase());
      if (!room)                                             { alert('❌ Không tìm thấy phòng thi với mã này!'); return; }
      if (room.status === 'closed')  { alert('❌ Phòng thi đã đóng!'); return; }
      if (room.status !== 'active')   { alert('⏳ Phòng thi chưa được bắt đầu!\n\nVui lòng chờ giáo viên mở phòng thi.'); return; }

      const now = Date.now();
      if (room.opensAt && now < new Date(room.opensAt).getTime()) {
        alert(`⏳ Phòng thi chưa mở!\nSẽ mở lúc: ${new Date(room.opensAt).toLocaleString('vi-VN')}`);
        return;
      }
      if (room.closesAt && now >= new Date(room.closesAt).getTime()) {
        alert(`⛔ Phòng thi đã hết giờ!\nĐã đóng lúc: ${new Date(room.closesAt).toLocaleString('vi-VN')}`);
        return;
      }

      // Với credential user, bỏ qua kiểm tra classId vì GV đã assign
      if (loginMode === 'google' && room.classId && !currentUser.classIds?.includes(room.classId)) {
        alert(`❌ Bạn không thuộc lớp "${room.className || 'này'}"!\n\nPhòng thi này chỉ dành cho học sinh trong lớp.`);
        return;
      }

      let studentClassName: string | undefined = userClassNames[0];
      if (room.classId && currentUser.classIds) {
        const classIndex = currentUser.classIds.indexOf(room.classId);
        if (classIndex >= 0 && classIndex < userClassNames.length) {
          studentClassName = userClassNames[classIndex];
        }
      }

      const firebaseUid = auth.currentUser?.uid;
      const effectiveId = firebaseUid || currentUser.id;

      const studentInfo: StudentInfo = {
        id: effectiveId,
        name: currentUser.name,
        email: currentUser.email,
        avatar: currentUser.avatar,
        className: studentClassName || userClassNames[0],
        // ✅ studentId = stable username ("student_xxx") — dùng để dedup qua các phiên
        // firebaseService.getStudentSubmission sẽ fallback query theo field này
        studentId: currentUser.studentId || currentUser.id,
      };

      // Query bằng stable username trước (credential) hoặc firebase UID (google/anon)
      const stableId = currentUser.studentId || effectiveId;
      // ✅ Pass tên học sinh để fallback tìm submissions cũ (trước khi có stable ID fix)
      const existingSubmission = await getStudentSubmission(room.id, stableId, currentUser.name);
      if (existingSubmission?.status === 'submitted') {
        const maxAttempts = room.settings?.maxAttempts ?? room.maxAttempts ?? 1;
        if (maxAttempts !== 0) {
          alert('✅ Bạn đã nộp bài rồi!\n\nGiáo viên không cho phép làm lại.');
          return;
        }
        onJoinRoom(room, studentInfo);
        return;
      }
      onJoinRoom(room, studentInfo, existingSubmission?.id);
    } catch (err) {
      console.error('Join room error:', err);
      alert('❌ Có lỗi xảy ra. Vui lòng thử lại!');
    } finally {
      setIsJoining(false);
    }
  };

  // ── Join room (Anonymous) ──────────────────────────────────
  const handleJoinRoomAnonymous = async () => {
    if (!roomCode.trim())    { alert('⚠️ Vui lòng nhập mã phòng!'); return; }
    if (!studentName.trim()) { alert('⚠️ Vui lòng nhập họ tên!'); return; }

    setIsJoining(true);
    try {
      await ensureSignedIn();
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('Anonymous auth failed');

      const room = await getRoomByCode(roomCode.trim().toUpperCase());
      if (!room) { alert('❌ Không tìm thấy phòng thi với mã này!'); return; }

      if (!room.allowAnonymous) {
        alert('⚠️ Phòng này yêu cầu đăng nhập!\n\nVui lòng quay lại và chọn "Tài khoản học sinh" hoặc "Đăng nhập Google".');
        return;
      }

      if (room.status === 'closed')  { alert('❌ Phòng thi đã đóng!'); return; }
      if (room.status !== 'active')   { alert('⏳ Phòng thi chưa được bắt đầu!\n\nVui lòng chờ giáo viên mở phòng thi.'); return; }

      const now = Date.now();
      if (room.opensAt && now < new Date(room.opensAt).getTime()) {
        alert(`⏳ Phòng thi chưa mở!\nSẽ mở lúc: ${new Date(room.opensAt).toLocaleString('vi-VN')}`);
        return;
      }
      if (room.closesAt && now >= new Date(room.closesAt).getTime()) {
        alert(`⛔ Phòng thi đã hết giờ!\nĐã đóng lúc: ${new Date(room.closesAt).toLocaleString('vi-VN')}`);
        return;
      }

      const anonymousStudent: StudentInfo = {
        id: uid,
        name: studentName.trim(),
        className: className.trim() || undefined,
      };

      onJoinRoom(room, anonymousStudent);
    } catch (err) {
      console.error('Join room error:', err);
      alert('❌ Có lỗi xảy ra. Vui lòng thử lại!\n\n' + (err as Error)?.message);
    } finally {
      setIsJoining(false);
    }
  };

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-teal-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-teal-500 border-t-transparent mx-auto mb-4" />
          <p className="text-teal-700">Đang kiểm tra...</p>
        </div>
      </div>
    );
  }

  // ── CHỌN PHƯƠNG THỨC ĐĂNG NHẬP ──────────────────────────
  if (loginMode === 'select' && !currentUser) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 50%, #99f6e4 100%)' }}
      >
        <div className="max-w-lg w-full">
          {onBack && (
            <button
              onClick={onBack}
              className="mb-6 flex items-center gap-2 text-teal-700 hover:text-teal-900 font-medium transition"
            >
              ← Trang chủ
            </button>
          )}

          <div className="text-center mb-8">
            <div className="text-7xl mb-4">🎓</div>
            <h1 className="text-4xl font-bold text-teal-900 mb-2">Cổng Học Sinh</h1>
            <p className="text-teal-600">Chọn cách vào phòng thi</p>
          </div>

          <div className="space-y-3">
            {/* ✅ MỚI: Tài khoản học sinh */}
            <button
              onClick={() => setLoginMode('credential')}
              className="w-full bg-white rounded-2xl p-5 shadow-xl hover:shadow-2xl transition transform hover:scale-[1.02] text-left flex items-center gap-4 border-2 border-teal-200"
            >
              <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 bg-gradient-to-br from-teal-500 to-teal-700">
                🔑
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-gray-900">Tài khoản học sinh</h2>
                <p className="text-gray-500 text-sm">Đăng nhập bằng user & mật khẩu do GV cấp</p>
              </div>
              <div className="bg-teal-100 text-teal-700 text-xs font-bold px-2 py-1 rounded-full">⭐ Mới</div>
            </button>

            {/* Google */}
            <button
              onClick={() => setLoginMode('google')}
              className="w-full bg-white rounded-2xl p-5 shadow-xl hover:shadow-2xl transition transform hover:scale-[1.02] text-left flex items-center gap-4"
            >
              <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #4285F4, #34A853, #FBBC05, #EA4335)' }}>
                🔐
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-gray-900">Đăng nhập Google</h2>
                <p className="text-gray-500 text-sm">Dùng tài khoản Gmail • Lưu kết quả lâu dài</p>
              </div>
              <div className="text-teal-500 text-xl">→</div>
            </button>

            {/* Anonymous */}
            <button
              onClick={() => setLoginMode('anonymous')}
              className="w-full bg-white rounded-2xl p-5 shadow-xl hover:shadow-2xl transition transform hover:scale-[1.02] text-left flex items-center gap-4"
            >
              <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)' }}>
                ✍️
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-gray-900">Thi tự do</h2>
                <p className="text-gray-500 text-sm">Chỉ cần nhập tên • Không cần tài khoản</p>
              </div>
              <div className="text-orange-500 text-xl">→</div>
            </button>
          </div>

          <p className="text-center text-teal-600 mt-6 text-xs">
            💡 "Thi tự do" chỉ khả dụng nếu giáo viên bật tính năng này
          </p>
        </div>
      </div>
    );
  }

  // ── ĐĂNG NHẬP BẰNG TÀI KHOẢN HỌC SINH ──────────────────
  if (loginMode === 'credential' && !currentUser) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 50%, #99f6e4 100%)' }}
      >
        <div className="max-w-md w-full">
          <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-6 text-center" style={{ background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)' }}>
              <div className="text-5xl mb-2">🔑</div>
              <h1 className="text-2xl font-bold text-white">Đăng nhập Học sinh</h1>
              <p className="text-teal-200 text-sm mt-1">Dùng tài khoản do giáo viên cấp</p>
            </div>

            <div className="p-6 space-y-4">
              {credError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-2">
                  <span>❌</span> {credError}
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Tên đăng nhập
                </label>
                <input
                  type="text"
                  value={credUsername}
                  onChange={e => { setCredUsername(e.target.value.toLowerCase()); setCredError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleCredentialLogin()}
                  placeholder="Ví dụ: nguyenvanan"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none font-mono text-lg"
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={isCredLoading}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Mật khẩu
                </label>
                <div className="relative">
                  <input
                    type={showCredPassword ? 'text' : 'password'}
                    value={credPassword}
                    onChange={e => { setCredPassword(e.target.value); setCredError(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleCredentialLogin()}
                    placeholder="Nhập mật khẩu"
                    className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none text-lg"
                    disabled={isCredLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCredPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showCredPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <button
                onClick={handleCredentialLogin}
                disabled={isCredLoading || !credUsername.trim() || !credPassword}
                className="w-full py-3.5 rounded-xl font-bold text-white text-lg transition disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)' }}
              >
                {isCredLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                    Đang đăng nhập...
                  </span>
                ) : '🚀 Đăng nhập'}
              </button>

              <button
                onClick={handleBackToSelect}
                disabled={isCredLoading}
                className="w-full py-3 rounded-xl font-semibold border-2 border-gray-200 hover:bg-gray-50 transition text-gray-600 disabled:opacity-50"
              >
                ← Quay lại
              </button>

              <div className="p-3 bg-teal-50 rounded-xl border border-teal-100 text-xs text-teal-700 text-center">
                💬 Liên hệ giáo viên nếu bạn chưa có tài khoản hoặc quên mật khẩu
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── THI TỰ DO ────────────────────────────────────────────
  if (loginMode === 'anonymous') {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 50%, #fed7aa 100%)' }}
      >
        <div className="max-w-md w-full">
          <div className="bg-white rounded-3xl shadow-2xl p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-3">✍️</div>
              <h1 className="text-2xl font-bold text-gray-900">Thi tự do</h1>
              <p className="text-gray-500 mt-1 text-sm">Nhập thông tin để vào thi</p>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Mã phòng thi <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={roomCode}
                  onChange={e => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="VD: ABC123"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-orange-500 focus:outline-none font-mono text-xl text-center tracking-widest uppercase"
                  maxLength={6}
                  disabled={isJoining}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Họ và tên <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={studentName}
                  onChange={e => setStudentName(e.target.value)}
                  placeholder="Nguyễn Văn A"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-orange-500 focus:outline-none"
                  disabled={isJoining}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Lớp <span className="text-gray-400 font-normal">(không bắt buộc)</span>
                </label>
                <input
                  type="text"
                  value={className}
                  onChange={e => setClassName(e.target.value)}
                  placeholder="VD: 10A1, 11B2..."
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-orange-500 focus:outline-none"
                  disabled={isJoining}
                />
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleJoinRoomAnonymous}
                disabled={isJoining || !roomCode.trim() || !studentName.trim()}
                className="w-full py-4 rounded-xl font-bold text-white text-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background:
                    isJoining || !roomCode.trim() || !studentName.trim()
                      ? '#94a3b8'
                      : 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)'
                }}
              >
                {isJoining ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                    Đang xử lý...
                  </span>
                ) : '🚀 Vào thi'}
              </button>

              <button
                onClick={handleBackToSelect}
                disabled={isJoining}
                className="w-full py-3 rounded-xl font-semibold border-2 border-gray-300 hover:bg-gray-50 transition disabled:opacity-50"
              >
                ← Quay lại
              </button>
            </div>

            <div className="mt-5 p-3 bg-yellow-50 border-l-4 border-yellow-400 rounded-lg text-sm text-yellow-800">
              ⚠️ <strong>Lưu ý:</strong> Chế độ thi tự do không lưu tài khoản.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── GOOGLE CHƯA ĐĂNG NHẬP ─────────────────────────────────
  if (loginMode === 'google' && !currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-teal-50 to-green-50 p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="text-7xl mb-4">🎓</div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Cổng Học Sinh</h1>
            <p className="text-gray-600">Đăng nhập Google để vào thi</p>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-lg font-bold text-gray-800 mb-4">📋 Quy trình tham gia</h2>
            <div className="space-y-3 mb-6">
              {[
                'Đăng nhập bằng tài khoản Google',
                'Chờ Admin duyệt tài khoản',
                'Giáo viên thêm bạn vào lớp',
                'Vào thi trực tiếp từ danh sách phòng',
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-3 text-sm text-gray-600">
                  <span className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                  {step}
                </div>
              ))}
            </div>

            <button
              onClick={handleGoogleLogin}
              className="w-full text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition transform hover:scale-105 flex items-center justify-center gap-3 mb-3"
              style={{ background: 'linear-gradient(135deg, #4285F4 0%, #34A853 100%)' }}
            >
              <GoogleIcon />
              Đăng nhập với Google
            </button>

            <button
              onClick={handleBackToSelect}
              className="w-full py-3 rounded-xl font-semibold border-2 border-gray-300 hover:bg-gray-50 transition"
            >
              ← Quay lại
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── CHƯA ĐƯỢC DUYỆT ──────────────────────────────────────
  if (currentUser && !currentUser.isApproved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 to-orange-50 p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
            <div className="text-7xl mb-4">⏳</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Chờ duyệt tài khoản</h2>
            <p className="text-gray-600 mb-2">Xin chào <strong>{currentUser.name}</strong>!</p>
            <p className="text-gray-500 text-sm mb-8">
              Tài khoản của bạn đang chờ Admin phê duyệt.
            </p>
            <button onClick={handleLogout}
              className="w-full py-3 border-2 border-gray-300 rounded-xl font-semibold text-gray-700 hover:bg-gray-50 transition">
              Đăng xuất
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── ĐÃ ĐĂNG NHẬP — GIAO DIỆN CHÍNH ──────────────────────
  if (currentUser && currentUser.isApproved) {
    const hasClass = userClassNames.length > 0 || (currentUser.classIds && currentUser.classIds.length > 0);

    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-blue-50 to-purple-50 p-4">
        <div className="max-w-2xl mx-auto pt-8">

          {/* User card */}
          <div className="bg-white rounded-2xl shadow-xl p-5 mb-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {currentUser.avatar ? (
                  <img src={currentUser.avatar} alt="" className="w-14 h-14 rounded-full border-2 border-teal-300" />
                ) : (
                  <div className="w-14 h-14 bg-gradient-to-br from-teal-400 to-teal-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                    {currentUser.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-bold text-gray-800">{currentUser.name}</h2>
                  {userClassNames.length > 0
                    ? <p className="text-sm text-teal-600 mt-0.5">📚 {userClassNames.join(' • ')}</p>
                    : <p className="text-sm text-gray-400">{currentUser.email || 'Tài khoản học sinh'}</p>
                  }
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">✓ Đã đăng nhập</span>
                    {loginMode === 'credential' && (
                      <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-medium">🔑 Tài khoản trường</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition"
              >
                Đăng xuất
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex bg-white rounded-2xl shadow-lg p-1.5 mb-5 gap-1.5">
            <button
              onClick={() => setActiveTab('join')}
              className={`flex-1 py-3 rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2 ${
                activeTab === 'join'
                  ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              🏠 Vào thi
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-3 rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2 ${
                activeTab === 'history'
                  ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              📋 Lịch sử bài làm
            </button>
          </div>

          {/* ── Tab: Vào thi ── */}
          {activeTab === 'join' && (
            <div className="space-y-4">
              {/* Danh sách phòng thi */}
              {hasClass && (
                <div className="bg-white rounded-2xl shadow-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-bold text-gray-800">📌 Phòng thi của bạn</h2>
                    <button
                      onClick={() => currentUser && fetchAvailableRooms(currentUser)}
                      disabled={isLoadingRooms}
                      className="text-xs text-teal-600 hover:text-teal-800 flex items-center gap-1 disabled:opacity-40"
                    >
                      {isLoadingRooms ? <span className="animate-spin inline-block">↻</span> : '↻'} Làm mới
                    </button>
                  </div>
                  {isLoadingRooms ? (
                    <div className="py-8 text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-4 border-teal-500 border-t-transparent mx-auto mb-2" />
                      <p className="text-sm text-gray-400">Đang tải...</p>
                    </div>
                  ) : availableRooms.length === 0 ? (
                    <div className="py-8 text-center text-gray-400">
                      <div className="text-4xl mb-2">🔍</div>
                      <p className="text-sm">Không có phòng thi nào đang mở</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {availableRooms.map(room => (
                        <RoomCard
                          key={room.id}
                          room={room}
                          onJoin={() => handleJoinRoomDirect(room)}
                          disabled={isJoining}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Nhập mã thủ công */}
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h2 className="font-bold text-gray-800 mb-4">🔑 Nhập mã phòng</h2>
                <div className="mb-4">
                  <input
                    type="text"
                    value={roomCode}
                    onChange={e => setRoomCode(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === 'Enter' && handleJoinRoomWithAccount()}
                    placeholder="ABC123"
                    maxLength={6}
                    className="w-full px-4 py-4 text-3xl text-center font-mono font-bold border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none uppercase tracking-[0.3em]"
                    disabled={isJoining}
                  />
                </div>
                <button
                  onClick={handleJoinRoomWithAccount}
                  disabled={isJoining || !roomCode.trim()}
                  className="w-full py-3 rounded-xl font-bold text-white transition disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)' }}
                >
                  {isJoining ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                      Đang kiểm tra...
                    </span>
                  ) : '🚀 Vào Phòng Thi'}
                </button>
              </div>
            </div>
          )}

          {/* ── Tab: Lịch sử ── */}
          {activeTab === 'history' && (
            <StudentHistory student={{
              ...currentUser,
              // Dùng stable studentId (username) để query lịch sử qua mọi phiên
              // firebaseService.getSubmissionsByStudent có fallback query theo student.studentId
              id: currentUser.studentId || currentUser.id,
            }} />
          )}
        </div>
      </div>
    );
  }

  return null;
};

// ── RoomCard ──────────────────────────────────────────────
const RoomCard: React.FC<{
  room: Room;
  onJoin: () => void;
  disabled?: boolean;
}> = ({ room, onJoin, disabled }) => {
  const statusBadge =
    room.status === 'active'
      ? { label: '🟢 Đang thi', cls: 'bg-green-100 text-green-700' }
      : { label: '🟡 Chờ mở', cls: 'bg-yellow-100 text-yellow-700' };

  const closesAt = room.closesAt ? new Date(room.closesAt) : null;

  return (
    <div className="border-2 border-gray-100 rounded-xl p-4 hover:border-teal-300 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-bold text-gray-800 truncate">{room.examTitle}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
            <span>🔑 {room.code}</span>
            <span>⏱ {room.timeLimit} phút</span>
            {room.className && <span>🏫 {room.className}</span>}
            {closesAt && (
              <span>🕐 Đóng lúc {closesAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
        </div>
        <button
          onClick={onJoin}
          disabled={disabled}
          className="flex-shrink-0 px-4 py-2 rounded-xl font-bold text-white text-sm transition transform hover:scale-105 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)' }}
        >
          Vào thi →
        </button>
      </div>
    </div>
  );
};

// ── Google SVG icon ───────────────────────────────────────
const GoogleIcon: React.FC = () => (
  <svg className="w-6 h-6" viewBox="0 0 24 24">
    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

export default StudentPortal;
