"use client";

import { useEffect, useRef, useState } from "react";

export default function LoginForm({ next }: { next: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => inputRef.current?.focus(), []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "로그인하지 못했습니다.");
      window.location.replace(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인하지 못했습니다.");
      setAccessCode("");
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return <form className="login-form" onSubmit={submit} aria-busy={loading}>
    <label htmlFor="access-code">접근 코드</label>
    <input
      id="access-code"
      ref={inputRef}
      type="password"
      value={accessCode}
      onChange={(event) => setAccessCode(event.target.value)}
      autoComplete="current-password"
      required
      disabled={loading}
    />
    {error && <p className="login-error" role="alert">{error}</p>}
    <button type="submit" disabled={loading || !accessCode.trim()}>{loading ? "확인 중" : "로그인"}</button>
  </form>;
}
