# KNU UICF 교육사업팀

강원대학교 산학협력단 교육사업팀의 기업 AI 교육 운영을 지원하는 반응형 웹 앱입니다.

## 구현된 MVP 흐름

- 기업 등록 및 홈페이지 자동 조사 진입점
- 기업 조사·경쟁사 분석 리포트
- AI 니즈 질문지 생성, 직접 수정·추가·삭제
- 상담 녹취 업로드와 전사·분석 결과 화면
- 4시간 단위 교육과정 구성 및 강사 배정 상태
- 강사 풀과 프로필 파일 자동 추출 진입점
- 수강생 직접 등록 및 문서 명단 가져오기
- 수업별 맞춤 만족도 설문 검토·예약 발송
- 데스크톱/태블릿/모바일 반응형 UI

## Gemini 모델 역할

- `gemini-3.5-flash-lite`: 수강생 명단·강사 프로필 등 반복적인 구조화 추출
- `gemini-3.6-flash`: 기업 조사, 질문지, 만족도, 강사 추천, 녹취 전사
- `gemini-3.1-pro-preview`: 상담 심층 분석과 최종 교육과정 설계

모든 기능은 `lib/ai/models.ts`의 역할 설정을 통해 모델을 선택합니다. 환경변수로 모델을 교체할 수 있으며 기능 코드는 변경할 필요가 없습니다.

## 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

키가 없을 때는 제품 흐름을 검토할 수 있도록 샘플 데이터로 동작합니다.

## Supabase 연결

1. `supabase/schema.sql`을 KNU-UICF 프로젝트 SQL Editor에서 실행합니다.
2. `.env.example`을 `.env.local`로 복사하고 프로젝트 URL과 publishable key를 입력합니다.
3. service role key와 Gemini key는 서버 전용 변수에 입력합니다.
4. `company-files`, `consultation-audio`, `instructor-profiles`, `learner-imports` private Storage bucket을 생성합니다.

스키마는 향후 복수 조직과 역할 분리를 지원하도록 조직, 구성원, RLS 경계를 포함합니다.

## 배포

Vercel에서 GitHub 저장소를 가져오고 동일한 환경변수를 Project Settings에 등록합니다.
