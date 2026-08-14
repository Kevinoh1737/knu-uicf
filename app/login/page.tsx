import Image from "next/image";
import { safeNextPath } from "@/lib/auth/session";
import LoginForm from "./login-form";

export const metadata = { title: "로그인 · KNU UICF 교육사업팀" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <main className="login-shell">
    <section className="login-card">
      <div className="login-brand">
        <Image className="official-logo" src="/knu-uicf-logo.png" width={96} height={103} priority alt="강원대학교 산학협력단 UICF" />
        <h1>교육사업팀</h1>
      </div>
      <LoginForm next={safeNextPath(next)} />
    </section>
  </main>;
}
