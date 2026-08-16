"use client";

import { useEffect } from "react";

/**
 * 화면 여럿이 공유하는 표시 요소. page.tsx 안에 두면 새 화면이 같은 아이콘을 쓰려다
 * 순환 import 가 되므로 여기로 뺐다.
 */
export type IconName = "home" | "building" | "person" | "survey" | "spark" | "settings" | "search" | "bell" | "plus" | "document" | "audio" | "calendar" | "chart" | "clock" | "upload" | "download" | "trash" | "grip";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10M9 20v-6h6v6"/></>,
    building: <><path d="M4 21V5a2 2 0 0 1 2-2h9v18M15 9h5v12M8 7h3M8 11h3M8 15h3M3 21h19"/></>,
    person: <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
    survey: <><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
    spark: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/><path d="m18 16 .7 2.3L21 19l-2.3.7L18 22l-.7-2.3L15 19l2.3-.7L18 16Z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    document: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></>,
    audio: <><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 14v6h14v-6"/></>,
    download: <><path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M6.5 7l1 14h9l1-14M10 11v6M14 11v6"/></>,
    grip: <><circle cx="9" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/></>,
  };
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

/**
 * 열린 창을 Esc 로 닫는다. 창마다 따로 붙이면 어떤 창은 되고 어떤 창은 안 되는 상태가 되므로
 * 한 곳에 둔다.
 *
 * `active` 에는 '지금 닫아도 되는가'를 넣는다 — 처리 중인 창은 취소 버튼도 잠그고 있으므로
 * Esc 로도 빠져나갈 수 없어야 한다. 올리던 파일이나 저장 중인 입력이 조용히 사라진다.
 */
export function useEscapeClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [active, onClose]);
}

export type FeedbackValue = { message: string; error: boolean } | null;

/**
 * 작업 결과 안내. 처음 몇 번은 다음 할 일을 알려 주지만, 익숙해진 뒤에도 화면에 남아 있으면
 * 그냥 가리는 것이 된다. 그래서 성공은 잠깐 보이고 스스로 사라진다.
 *
 * 실패는 사라지지 않는다 — 읽기 전에 없어지면 무엇이 잘못됐는지 알 방법이 없다. 대신 둘 다
 * 손으로 닫을 수 있다.
 */
export function Feedback({ value, onClose, timeout = 4000 }: {
  value: FeedbackValue;
  onClose: () => void;
  timeout?: number;
}) {
  const message = value?.message;
  const isError = Boolean(value?.error);

  useEffect(() => {
    if (!message || isError) return;
    const timer = window.setTimeout(onClose, timeout);
    // 메시지가 바뀌면 시계도 다시 시작한다. 같은 문구가 연달아 나오면 사라지지 않는 것처럼
    // 보이는데, 그건 새 안내가 앞의 시계를 물려받기 때문이다.
    return () => window.clearTimeout(timer);
  }, [message, isError, timeout, onClose]);

  if (!value) return null;
  return <p className={`feedback${value.error ? " error" : ""}`} role={value.error ? "alert" : "status"}>
    <span>{value.message}</span>
    <button type="button" onClick={onClose} aria-label="안내 닫기">×</button>
  </p>;
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`;
}
