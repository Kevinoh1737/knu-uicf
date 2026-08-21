/**
 * 링크를 공유했을 때 카드에 실리는 그림.
 *
 * 왜 만들었나: `og:image` 가 없으면 카카오톡은 **화면에서 이미지를 아무거나 긁는다.**
 * 우리 로그인 화면에 있는 이미지는 96×103 짜리 투명 배경 로고 하나뿐이라, 카톡이 그것을
 * 카드 크기로 늘려 흐린 워터마크처럼 보여 줬다(2026-08-21 대표 제보로 확인).
 *
 * 파일로 두지 않고 여기서 그리는 이유는 브랜드 색과 문구가 한곳에 모여 있어야 나중에
 * 바뀔 때 그림과 글이 따로 놀지 않기 때문이다. 빌드 때 한 번 그려져 정적 파일이 된다.
 */
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const alt = "KNU UICF 교육사업팀 — 강원대학교 산학협력단";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// app/globals.css 의 --brand, --nav, 그리고 강조에 쓰는 살구색.
// 살구색은 공식 로고의 마름모에서 온 색이라 남색 위에서 그대로 산다.
const BRAND = "#173452";
const DEEP = "#0e1b28";
const ACCENT = "#e9a06f";

const asset = (...parts: string[]) => path.join(process.cwd(), "public", ...parts);

export default async function OpenGraphImage() {
  const [bold, regular, logo] = await Promise.all([
    readFile(asset("fonts", "Pretendard-Bold.ttf")),
    readFile(asset("fonts", "Pretendard-Regular.ttf")),
    readFile(asset("knu-uicf-logo.png")),
  ]);
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", background: BRAND, position: "relative",
          fontFamily: "Pretendard", color: "#ffffff", padding: "72px 80px",
        }}
      >
        {/* 화면의 focus-banner 와 같은 장식. 큰 원 하나가 단색 배경을 덜 밋밋하게 만든다. */}
        <div
          style={{
            position: "absolute", width: 720, height: 720, borderRadius: 360,
            border: `1px solid rgba(255,255,255,0.07)`, left: -260, top: -300,
          }}
        />
        <div
          style={{
            position: "absolute", width: 420, height: 420, borderRadius: 210,
            background: DEEP, right: -120, bottom: -160,
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* 로고는 투명 배경이라 짙은 색 위에서 오히려 또렷하다. */}
          <img src={logoSrc} width={104} height={111} alt="" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 26, color: "#a9bbb5" }}>강원대학교 산학협력단</div>
            <div style={{ fontSize: 30, color: ACCENT, letterSpacing: 2 }}>UICF</div>
          </div>
        </div>

        {/* 부제를 따로 두지 않는다. 아래 줄이 같은 말을 더 짧게 하고 있어 둘을 다 실으면
            카드 한 장에서 같은 문장을 두 번 읽게 된다. */}
        <div style={{ display: "flex", fontSize: 92, fontWeight: 700, letterSpacing: -3 }}>
          교육사업팀 운영 시스템
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 64, height: 4, background: ACCENT, borderRadius: 2 }} />
          <div style={{ fontSize: 30, color: "#a9bbb5" }}>
            기업 조사 · 상담 · 교육 설계 · 강사 배정 · 만족도
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Pretendard", data: bold, weight: 700, style: "normal" },
        { name: "Pretendard", data: regular, weight: 400, style: "normal" },
      ],
    },
  );
}
