import type { Metadata } from "next";
import "./globals.css";
import { Telemetry } from "./telemetry-client";

export const metadata: Metadata = {
  title: "KNU UICF 교육사업팀",
  description: "기업 조사부터 교육 설계, 강사 배정과 만족도 분석까지 연결하는 강원대학교 산학협력단 교육사업팀 운영 시스템",
  icons: {
    icon: "/knu-uicf-logo.png",
    shortcut: "/knu-uicf-logo.png",
  },
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
