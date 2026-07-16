// ============================================================
// studentAccountService.ts
// Quản lý tài khoản học sinh do giáo viên tạo (username/password)
// Đặt file này tại: src/services/studentAccountService.ts
// ============================================================

import {
  db,
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  query,
  where,
  writeBatch,
  serverTimestamp,
  ensureSignedIn,           // anonymous auth trước khi đọc Firestore
  addStudentToClass,        // ✅ cập nhật classes.studentIds + users.classIds
  removeStudentFromClass,   // ✅ dùng khi xóa tài khoản
} from './firebaseService';
import { Role, User, StudentAccount, CreateStudentAccountInput, BulkImportStudentRow, BulkImportResult } from '../types';

// ── Local aliases cho tương thích với code bên dưới ──
type CreateStudentInput = CreateStudentAccountInput;
type BulkImportRow      = BulkImportStudentRow;

// ============ HELPERS ============

/**
 * Hash password bằng Web Crypto API (SHA-256)
 */
export const hashPassword = async (password: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Kiểm tra username có hợp lệ không (chỉ chữ cái, số, dấu gạch dưới, tối thiểu 3 ký tự)
 */
export const isValidUsername = (username: string): boolean => {
  return /^[a-zA-Z0-9_]{3,30}$/.test(username);
};

// ============ CRUD ============

/**
 * Tạo một tài khoản học sinh
 */
export const createStudentAccount = async (input: CreateStudentInput): Promise<StudentAccount> => {
  const username = input.username.trim().toLowerCase();

  if (!isValidUsername(username)) {
    throw new Error(`Tên đăng nhập "${username}" không hợp lệ. Chỉ dùng chữ cái, số, dấu _, độ dài 3-30 ký tự.`);
  }

  if (!input.password || input.password.length < 4) {
    throw new Error('Mật khẩu phải có ít nhất 4 ký tự.');
  }

  // Kiểm tra username đã tồn tại chưa
  const docRef = doc(db, 'studentAccounts', username);
  const existing = await getDoc(docRef);
  if (existing.exists()) {
    throw new Error(`Tên đăng nhập "${username}" đã tồn tại.`);
  }

  const passwordHash = await hashPassword(input.password);

  const account: StudentAccount = {
    id: username,
    username,
    passwordHash,
    name: input.name.trim(),
    classId: input.classId,
    className: input.className,
    teacherId: input.teacherId,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // ── Lưu vào studentAccounts ──────────────────────────────────────
  await setDoc(docRef, account);

  // ── Tạo document trong users/ để class management nhìn thấy ──────
  // ID = "student_" + username (nhất quán với loginWithStudentAccount)
  const userId = `student_${username}`;
  await setDoc(doc(db, 'users', userId), {
    id: userId,
    name: input.name.trim(),
    role: Role.STUDENT,
    isApproved: true,
    classIds: input.classId ? [input.classId] : [],
    createdAt: serverTimestamp(),
  });

  // ── Thêm vào lớp nếu có classId ───────────────────────────────────
  if (input.classId) {
    await addStudentToClass(input.classId, userId);
  }

  return account;
};

/**
 * Đăng nhập bằng username + password
 * Trả về User object nếu thành công, null nếu sai
 */
export const loginWithStudentAccount = async (
  username: string,
  password: string
): Promise<User | null> => {
  // ✅ Phải có Firebase Auth (anonymous) trước khi đọc Firestore
  // Firestore rules: allow read if request.auth != null
  await ensureSignedIn();

  const uname = username.trim().toLowerCase();
  const docRef = doc(db, 'studentAccounts', uname);
  const snap = await getDoc(docRef);

  if (!snap.exists()) return null;

  const account = snap.data() as StudentAccount;
  if (!account.isActive) {
    throw new Error('Tài khoản đã bị vô hiệu hóa. Liên hệ giáo viên.');
  }

  const inputHash = await hashPassword(password);
  if (inputHash !== account.passwordHash) return null;

  // Trả về User object tương thích với hệ thống
  const user: User = {
    id: `student_${uname}`,   // prefix để phân biệt với Firebase Auth UID
    name: account.name,
    role: Role.STUDENT,
    isApproved: true,
    classIds: account.classId ? [account.classId] : [],
  };

  return user;
};

/**
 * Lấy thông tin đầy đủ của một student account (dùng trong StudentPortal)
 */
export const getStudentAccountByUsername = async (
  username: string
): Promise<StudentAccount | null> => {
  const uname = username.trim().toLowerCase();
  const docRef = doc(db, 'studentAccounts', uname);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return snap.data() as StudentAccount;
};

/**
 * Lấy danh sách tài khoản học sinh của một giáo viên
 */
export const getStudentAccountsByTeacher = async (
  teacherId: string
): Promise<StudentAccount[]> => {
  const q = query(
    collection(db, 'studentAccounts'),
    where('teacherId', '==', teacherId)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as StudentAccount);
};

/**
 * Xóa tài khoản học sinh
 * Đồng thời xóa document trong users/ và gỡ khỏi lớp
 */
export const deleteStudentAccount = async (username: string): Promise<void> => {
  const userId = `student_${username}`;

  // Lấy thông tin classId trước khi xóa
  const snap = await getDoc(doc(db, 'studentAccounts', username));
  if (snap.exists()) {
    const account = snap.data() as StudentAccount;
    if (account.classId) {
      await removeStudentFromClass(account.classId, userId);
    }
  }

  // Xóa khỏi users/
  await deleteDoc(doc(db, 'users', userId));

  // Xóa khỏi studentAccounts/
  await deleteDoc(doc(db, 'studentAccounts', username));
};

/**
 * Đặt lại mật khẩu học sinh
 */
export const resetStudentPassword = async (
  username: string,
  newPassword: string
): Promise<void> => {
  if (!newPassword || newPassword.length < 4) {
    throw new Error('Mật khẩu phải có ít nhất 4 ký tự.');
  }
  const passwordHash = await hashPassword(newPassword);
  await updateDoc(doc(db, 'studentAccounts', username), {
    passwordHash,
    updatedAt: serverTimestamp(),
  });
};

/**
 * Bật/tắt tài khoản học sinh
 */
export const toggleStudentAccountStatus = async (
  username: string,
  isActive: boolean
): Promise<void> => {
  await updateDoc(doc(db, 'studentAccounts', username), {
    isActive,
    updatedAt: serverTimestamp(),
  });
};

/**
 * Bulk import từ danh sách rows (parse từ Excel)
 *
 * @param rows             Danh sách học sinh đọc từ Excel
 * @param teacherId        ID giáo viên thực hiện import
 * @param availableClasses Danh sách lớp đã tồn tại (để validate tên lớp trong Excel)
 * @param defaultClassId   classId mặc định khi cột "lop" trống
 */
export const bulkCreateStudentAccounts = async (
  rows: BulkImportRow[],
  teacherId: string,
  availableClasses: { id: string; name: string }[],
  defaultClassId?: string,
): Promise<BulkImportResult> => {
  const result: BulkImportResult = { success: 0, failed: 0, errors: [] };
  const batch = writeBatch(db);
  const processed: string[] = [];

  // Map: tên lớp lowercase → { id, name }
  const classMap = new Map<string, { id: string; name: string }>();
  for (const cls of availableClasses) {
    classMap.set(cls.name.trim().toLowerCase(), cls);
  }
  const defaultClass = availableClasses.find(c => c.id === defaultClassId);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNum = i + 2;

    try {
      if (!row.name?.trim())     throw new Error(`Dòng ${lineNum}: Thiếu họ tên`);
      if (!row.username?.trim()) throw new Error(`Dòng ${lineNum}: Thiếu tên đăng nhập`);
      if (!row.password?.trim()) throw new Error(`Dòng ${lineNum}: Thiếu mật khẩu`);

      const username = String(row.username).trim().toLowerCase();
      if (!isValidUsername(username))
        throw new Error(`Dòng ${lineNum}: Tên đăng nhập "${username}" không hợp lệ`);

      if (processed.includes(username))
        throw new Error(`Dòng ${lineNum}: Tên đăng nhập "${username}" bị trùng trong file`);

      const existing = await getDoc(doc(db, 'studentAccounts', username));
      if (existing.exists())
        throw new Error(`Dòng ${lineNum}: "${username}" đã tồn tại trong hệ thống`);

      // ── Xác định lớp ──────────────────────────────────────────────────
      let resolvedClassId: string | undefined;
      let resolvedClassName: string | undefined;

      const rowClassName = row.className?.trim();
      if (rowClassName) {
        // Có tên lớp trong Excel → PHẢI tồn tại trong hệ thống
        const found = classMap.get(rowClassName.toLowerCase());
        if (!found) {
          throw new Error(
            `Dòng ${lineNum}: Lớp "${rowClassName}" chưa tồn tại — hãy tạo lớp này trước rồi mới import`
          );
        }
        resolvedClassId   = found.id;
        resolvedClassName = found.name;
      } else if (defaultClass) {
        // Cột lớp trống → dùng lớp mặc định được chọn trên UI
        resolvedClassId   = defaultClass.id;
        resolvedClassName = defaultClass.name;
      }
      // Cả 2 trống → tạo tài khoản không có lớp (vẫn hợp lệ)
      // ──────────────────────────────────────────────────────────────────

      const passwordHash = await hashPassword(String(row.password).trim());

      const account: StudentAccount = {
        id: username,
        username,
        passwordHash,
        name: row.name.trim(),
        classId:   resolvedClassId,
        className: resolvedClassName,
        teacherId,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const userId = `student_${username}`;

      // Lưu vào studentAccounts
      batch.set(doc(db, 'studentAccounts', username), account);

      // Lưu vào users/ (để getStudentsInClass tìm thấy)
      batch.set(doc(db, 'users', userId), {
        id: userId,
        name: row.name.trim(),
        role: Role.STUDENT,
        isApproved: true,
        classIds: resolvedClassId ? [resolvedClassId] : [],
        createdAt: serverTimestamp(),
      });

      processed.push(username);
      result.success++;
    } catch (err: any) {
      result.failed++;
      result.errors.push(err.message);
    }
  }

  if (result.success > 0) {
    await batch.commit();

    // ── Sau khi commit, cập nhật classes.studentIds ─────────────────
    // Group theo classId để gọi addStudentToClass hiệu quả
    const classStudentMap = new Map<string, string[]>();
    for (const row of rows) {
      const username = String(row.username).trim().toLowerCase();
      if (!processed.includes(username)) continue; // bỏ qua các row lỗi

      const rowClassName = row.className?.trim();
      let cId: string | undefined;

      if (rowClassName) {
        cId = classMap.get(rowClassName.toLowerCase())?.id;
      } else if (defaultClass) {
        cId = defaultClass.id;
      }

      if (cId) {
        if (!classStudentMap.has(cId)) classStudentMap.set(cId, []);
        classStudentMap.get(cId)!.push(`student_${username}`);
      }
    }

    // Gọi addStudentToClass cho từng học sinh
    for (const [cId, studentIds] of classStudentMap.entries()) {
      for (const studentId of studentIds) {
        try {
          await addStudentToClass(cId, studentId);
        } catch {
          // ignore nếu đã tồn tại
        }
      }
    }
  }

  return result;
};
