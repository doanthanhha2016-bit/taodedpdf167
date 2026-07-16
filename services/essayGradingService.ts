// src/services/essayGradingService.ts

export interface EssayGradeResult {
  score: number;
  maxScore: number;
  steps: { text: string; ok: boolean }[];
  comment: string;
  feedback: string;
  error?: string;
}

export interface EssayImage {
  type: string;
  data: string;
}

export interface ParsedEssayAnswer {
  text: string;
  images: EssayImage[];
}

// 1. Quản lý API Key trong LocalStorage
export const getGeminiApiKey = (): string => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('gemini_api_key') || '';
  }
  return '';
};

export const setGeminiApiKey = (key: string): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('gemini_api_key', key);
  }
};

// 2. Phân tích chuỗi bài làm (JSON có chứa text và mảng ảnh base64)
export const parseEssayAnswer = (raw: string): ParsedEssayAnswer => {
  if (!raw) return { text: '', images: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed.text !== undefined || parsed.images !== undefined) {
      return {
        text: parsed.text || '',
        images: parsed.images || []
      };
    }
  } catch (e) {
    // Nếu không phải JSON, trả về nguyên text
  }
  return { text: raw, images: [] };
};

// 3. Đóng gói bài làm (text + ảnh) thành JSON string để lưu vào DB
export const serializeEssayAnswer = (data: ParsedEssayAnswer): string => {
  return JSON.stringify(data);
};

// 4. Chấm bài bằng Gemini 1.5 Flash (hỗ trợ cả text và ảnh)
export const gradeEssayWithGemini = async (
  questionText: string,
  studentAnswerRaw: string,
  maxScore: number,
  solutionText?: string,
  apiKey?: string
): Promise<EssayGradeResult> => {
  const key = apiKey || getGeminiApiKey();
  if (!key) throw new Error('Vui lòng cấu hình API Key của Gemini');

  const ansData = parseEssayAnswer(studentAnswerRaw);

  if (!ansData.text.trim() && ansData.images.length === 0) {
    return {
      score: 0,
      maxScore,
      steps: [{ text: 'Học sinh không nộp bài', ok: false }],
      comment: 'Bài làm trống.',
      feedback: 'Bài làm trống.'
    };
  }

  const prompt = `Bạn là một giáo viên chấm thi tự luận cẩn thận và công tâm.
Nhiệm vụ: Chấm điểm bài làm của học sinh.
- Điểm tối đa cho câu này: ${maxScore}
- Câu hỏi: ${questionText}
- Đáp án tham khảo (nếu có): ${solutionText || 'Không có. Hãy tự đánh giá dựa trên kiến thức chuẩn xác'}
- Bài làm của học sinh (text): ${ansData.text || 'Học sinh chỉ nộp ảnh (xem ảnh kèm theo)'}

Hãy trả về ĐÚNG định dạng JSON sau (không chứa markdown giải thích):
{
  "score": [Điểm số, là số thập phân từ 0 đến ${maxScore}],
  "steps": [
    { "text": "[Chi tiết bước 1 đúng/sai thế nào]", "ok": true },
    { "text": "[Chi tiết bước 2 đúng/sai thế nào]", "ok": false }
  ],
  "comment": "[Nhận xét tổng quan, lý do trừ điểm, và lời khuyên]"
}`;

  // Chuẩn bị payload (bao gồm text và mảng ảnh base64)
  const parts: any[] = [{ text: prompt }];

  ansData.images.forEach(img => {
    parts.push({
      inline_data: {
        mime_type: img.type || 'image/jpeg',
        data: img.data
      }
    });
  });

  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.2, // Nhiệt độ thấp để AI chấm chính xác, không lan man
      response_mime_type: "application/json",
    }
  };

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errRes = await response.json();
      throw new Error(errRes.error?.message || 'Lỗi từ Gemini API');
    }

    const data = await response.json();
    const textRes = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textRes) throw new Error('Không nhận được phản hồi từ AI');

    // Dùng \`{3} thay vì gõ trực tiếp 3 dấu backtick để tránh lỗi UI copy-paste
    const cleanJson = textRes.replace(/`{3}json/g, '').replace(/`{3}/g, '').trim();
    const parsedRes = JSON.parse(cleanJson);

    return {
      score: Math.min(Math.max(Number(parsedRes.score) || 0, 0), maxScore),
      maxScore,
      steps: parsedRes.steps || [],
      comment: parsedRes.comment || '',
      feedback: parsedRes.comment || ''
    };
  } catch (error: any) {
    throw new Error('Lỗi chấm AI: ' + error.message);
  }
};
