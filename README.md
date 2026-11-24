https://gigsplitter.vercel.app/

# 긱스플리터 (GigSplitter)

대용량 생필품 공동구매를 위한 캡처 판독·소분 정산·모집글 생성 서비스입니다.

| 폴더 | 내용 |
| --- | --- |
| `frontend/` | React + Vite 모바일 웹 앱 ([README](./frontend/README.md)) |
| `backend/` | Node.js 24 API 서버, 외부 npm 의존성 없음 ([연동 문서](./backend/handoff.md)) |
| `docs/` | [기능정의서 v1.1](./docs/GigSplitter-PRD-v1.1.md), [ERD](./docs/ERD.md) |

## 로컬에서 프론트와 백엔드 함께 실행

터미널 두 개에서 각각 실행합니다.

```bash
cd backend
npm start            # http://127.0.0.1:3001
```

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

- 프론트 개발 서버가 `/api` 요청을 백엔드(`127.0.0.1:3001`)로 넘깁니다(`frontend/vite.config.ts`). 백엔드는 CORS를 열지 않으므로 브라우저는 항상 같은 출처의 `/api`를 호출합니다.
- 캡처 판독(`POST /api/products/extract`)에는 `backend/.env`의 `GEMINI_API_KEY`가 필요합니다. 기본 모델은 `gemini-3.8-flash`입니다. 키가 없으면 화면에 "지금은 캡처 분석을 쓸 수 없어요"가 뜨고, 프리셋과 직접 입력은 그대로 쓸 수 있습니다.
- 키는 `.env`에만 두고 저장소에 올리지 않습니다. 프론트의 `VITE_` 변수에도 넣지 않습니다.
- 백엔드 없이 화면만 볼 때는 `npm run dev:mock`을 씁니다. 모의 응답도 실제 백엔드와 같은 `{ extraction }` 형식입니다.

## 테스트

```bash
cd backend && npm test
```

```bash
cd frontend && npm test && npm run build
```

## 배포 시 주의

현재 https://gigsplitter.vercel.app/ 은 프론트 정적 파일만 배포되어 있어 `/api` 요청이 404입니다. 그래서 배포본에서는 캡처 판독이 동작하지 않습니다. 백엔드를 배포하고 같은 도메인의 `/api`로 연결하기 전까지는 프리셋과 직접 입력으로 시연합니다. 외부에 판독 API를 열기 전에 `backend/handoff.md`의 "판독 요청 제한과 배포 경계"를 확인하세요.
