/**
 * 기업 담당자. 명함 한 장 분량만 담는다 — 주소·생년월일은 교육 운영에 쓰이지 않고,
 * 담지 않으면 지켜야 할 것도 줄어든다.
 */
export type CompanyContact = {
  name: string;
  position: string;
  department: string;
  email: string;
  phone: string;
};

export const EMPTY_CONTACT: CompanyContact = { name: "", position: "", department: "", email: "", phone: "" };

function text(value: unknown, limit = 120) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

/**
 * +82 국제번호를 국내 표기로 되돌리고 구분자를 하이픈으로 통일한다.
 * 명함에는 `+82.10.3606.6474` 처럼 적힌 경우가 흔하다 (floweroneul 에서 가져온 규칙).
 */
export function normalizeKoreanPhone(value: string) {
  let digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+82")) digits = `0${digits.slice(3)}`;
  digits = digits.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) {
    // 02 로 시작하는 서울 번호는 지역번호가 두 자리다.
    if (digits.startsWith("02")) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 9 && digits.startsWith("02")) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  return value.trim();
}

export function sanitizeContact(input: unknown): CompanyContact {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const email = text(value.email, 160).toLowerCase();
  return {
    name: text(value.name, 80),
    position: text(value.position, 80),
    department: text(value.department, 120),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    phone: value.phone ? normalizeKoreanPhone(text(value.phone, 40)) : "",
  };
}

export function hasContact(contact: CompanyContact | null | undefined) {
  return Boolean(contact && Object.values(contact).some(Boolean));
}

/**
 * 리멤버에서 전달받은 명함 텍스트. `이름: 홍길동` 같은 줄 목록이라 AI 없이 읽을 수 있다.
 * floweroneul 의 parseRememberText 를 옮겨 온 것이고, 두 항목 이상 맞아야 인정한다 —
 * 아무 텍스트나 붙여 넣었을 때 엉뚱한 값이 들어가는 것을 막는다.
 */
export function parseRememberText(text: string): CompanyContact | null {
  const result: Record<string, string> = {};
  let matched = 0;

  for (const line of text.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!value) continue;

    if (/^이름$/.test(key)) { result.name = value; matched += 1; }
    else if (/^(직책|직함|직위)$/.test(key)) { result.position = value; matched += 1; }
    else if (/^부서$/.test(key)) { result.department = value; matched += 1; }
    else if (/^(휴대폰|휴대폰번호|핸드폰|핸드폰번호|전화번호|연락처)$/.test(key)) { result.phone = value; matched += 1; }
    else if (/^(유선번호|사무실|회사전화)$/.test(key) && !result.phone) { result.phone = value; matched += 1; }
    else if (/^(이메일|email|e-mail)$/i.test(key)) { result.email = value; matched += 1; }
  }

  return matched >= 2 ? sanitizeContact(result) : null;
}
