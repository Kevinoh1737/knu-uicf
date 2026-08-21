/**
 * 파비콘.
 *
 * 여태 `<link rel="icon">` 이 `/knu-uicf-logo.png` 를 가리켰다. 그 파일은 252×270 짜리
 * **투명 배경** 공식 로고라, 브라우저 탭이나 카카오톡 카드에서 16~20px 로 줄면 아무것도
 * 보이지 않는다. 작은 자리에 쓰려고 만든 그림이 아니다.
 *
 * `public/favicon.svg` 에 이미 제대로 된 정사각 아이콘이 있었으나 아무 데서도 쓰지 않고
 * 있었다. 그 도안을 여기서 PNG 로 굽는다 — SVG 파비콘을 못 읽는 수집기(카카오톡 포함)가
 * 아직 있어서, 작은 자리일수록 PNG 가 안전하다.
 *
 * 색은 app/globals.css 의 --brand 와 강조 살구색 그대로다.
 */
import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

const BRAND = "#173452";
const ACCENT = "#eba37d";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex",
          alignItems: "center", justifyContent: "center",
          background: BRAND, color: ACCENT,
          // 작은 자리에서 획이 뭉개지지 않게 굵고 크게. 세리프는 이 로고의 성격과 맞는다.
          fontSize: 132, fontWeight: 700, fontFamily: "Georgia, serif",
          borderRadius: 48,
        }}
      >
        K
      </div>
    ),
    size,
  );
}
