"use client";

import { useState } from "react";
import { SCALE_LABELS, SurveyAnswers, SurveyQuestion } from "@/lib/surveys";

/**
 * 수강생이 답하는 화면. 교육 직후 휴대폰에서 여는 경우가 대부분이라, 척도는 버튼으로 크게
 * 두고 한 문항이 한 화면 안에 들어오게 한다. 저장 버튼은 맨 아래 하나뿐이다.
 */
export function SurveyForm({ token, questions }: { token: string; questions: SurveyQuestion[] }) {
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const set = (id: string, value: number | string) => {
    setAnswers((current) => ({ ...current, [id]: value }));
    setMissing((current) => current.filter((item) => item !== id));
  };

  const submit = async () => {
    // 서버도 같은 검사를 하지만, 여기서 먼저 막아야 어디가 비었는지 그 자리에서 보인다.
    const blanks = questions.filter((question) => question.required && answers[question.id] === undefined);
    if (blanks.length) {
      setMissing(blanks.map((question) => question.id));
      setError("답하지 않은 문항이 있습니다.");
      document.getElementById(`q-${blanks[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/survey/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const result = await response.json() as { error?: string; submitted?: boolean };
      if (!response.ok) throw new Error(result.error || "제출하지 못했습니다.");
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "제출하지 못했습니다.");
    } finally { setBusy(false); }
  };

  if (done) {
    return <div className="survey-done">
      <h2>제출되었습니다</h2>
      <p className="survey-note">응답해 주셔서 감사합니다. 남겨 주신 의견은 다음 교육 설계에 반영됩니다.</p>
    </div>;
  }

  return <div className="survey-form">
    {questions.map((question, index) => <fieldset key={question.id} id={`q-${question.id}`}
      className={missing.includes(question.id) ? "survey-question missing" : "survey-question"}>
      <legend>
        <span className="survey-number">{String(index + 1).padStart(2, "0")}</span>
        {question.text}
        {!question.required && <em>선택</em>}
      </legend>

      {question.type === "scale" && <div className="survey-scale" role="radiogroup" aria-label={question.text}>
        {SCALE_LABELS.map((label, position) => {
          const score = position + 1;
          return <button type="button" key={label} role="radio" aria-checked={answers[question.id] === score}
            className={answers[question.id] === score ? "picked" : ""}
            onClick={() => set(question.id, score)} disabled={busy}>
            <b>{score}</b><small>{label}</small>
          </button>;
        })}
      </div>}

      {question.type === "choice" && <div className="survey-choices" role="radiogroup" aria-label={question.text}>
        {question.options.map((option) => <button type="button" key={option} role="radio"
          aria-checked={answers[question.id] === option}
          className={answers[question.id] === option ? "picked" : ""}
          onClick={() => set(question.id, option)} disabled={busy}>{option}</button>)}
      </div>}

      {question.type === "text" && <textarea rows={4} disabled={busy}
        value={String(answers[question.id] ?? "")} maxLength={2000}
        placeholder="자유롭게 적어 주세요"
        onChange={(event) => set(question.id, event.target.value)} />}
    </fieldset>)}

    {error && <p className="survey-error" role="alert">{error}</p>}

    <button type="button" className="survey-submit" onClick={() => void submit()} disabled={busy}>
      {busy ? "제출 중" : "제출하기"}
    </button>
    <p className="survey-note small">제출 후에는 수정할 수 없습니다.</p>
  </div>;
}
