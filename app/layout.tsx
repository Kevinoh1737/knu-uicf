import type { Metadata } from "next";
import "./globals.css";
import { Telemetry } from "./telemetry-client";

const TITLE = "KNU UICF 교육사업팀";
const DESCRIPTION =
  "기업 조사부터 교육 설계, 강사 배정과 만족도 분석까지 연결하는 강원대학교 산학협력단 교육사업팀 운영 시스템";

/**
 * 공유 카드가 이 주소를 기준으로 그림 주소를 만든다. 없으면 상대 경로가 절대 주소로
 * 펴지지 않아 `og:image` 가 통째로 무시된다 — 카톡에서는 '이미지 없는 카드'로 보인다.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://knu-uicf-edu.synthya.ai";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  /**
   * 카카오톡·슬랙 같은 곳은 `<meta name="description">` 이 아니라 **`og:description` 을
   * 본다.** 그것이 없으면 카톡은 제 기본 문구("여기를 눌러 링크를 확인하세요")를 붙이고,
   * `og:image` 가 없으면 화면에서 이미지를 아무거나 긁는다. 둘 다 실제로 그렇게 나왔다
   * (2026-08-21 대표 제보). 그래서 여기서 전부 못박는다.
   */
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "강원대학교 산학협력단",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  // 아이콘은 app/icon.tsx 가 만든다. 여기서 icons 를 적으면 그쪽이 무시된다.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body style={{ wordBreak: "keep-all", overflowWrap: "break-word" }}>
        {children}
        {/* 베타 사용 기록. 아무것도 그리지 않고, 실패해도 화면을 방해하지 않는다. */}
        <Telemetry />
      </body>
    </html>
  );
}
