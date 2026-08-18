/**
 * 화면에 적는 회사 이름.
 *
 * 법인 형태 표기(주식회사·㈜)는 등기부에나 필요한 것이고, 담당자가 화면에서 찾는 이름은
 * "신티아"다. 저장은 공시·계약서에 쓰는 정식 상호 그대로 두고, 보여 줄 때만 걷어낸다 —
 * 계약서와 세금계산서는 정식 상호를 써야 하므로 원본을 지우면 안 된다.
 */
export function displayCompanyName(value: string) {
  const name = String(value || "")
    .replace(/주식회사|㈜|\(\s*주\s*\)|（\s*주\s*）/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return name || String(value || "").trim();
}
