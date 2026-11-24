# 긱스플리터 프론트엔드

기능정의서 [v1.1](../docs/GigSplitter-PRD-v1.1.md)의 P0와 P1을 구현한 모바일 우선 웹 앱입니다.

## 실행

```bash
npm install
npm run dev        # 실제 백엔드에 연결
npm run dev:mock   # 모의 분석 응답으로 실행
npm test
npm run build
```

`dev:mock`에서는 올린 파일 이름으로 상황을 고릅니다. `multi`는 가격·옵션 후보 여러 개, `bad`는 잘못된 JSON, `503`은 서버 오류, `timeout`은 시간 초과입니다.

## 구조

- `src/domain` 정산, 단가 비교, 모집글, 공구 운영 규칙. React에 의존하지 않습니다.
- `src/data` 공구 저장소
- `src/pages` 내 공구, 방장 관리, 참여자 초대, 저금통
- `src/api` 이미지 검사와 추출 요청
- `src/features` 단계별 화면과 상태
- `src/components` 공통 UI
- `mock` 개발용 모의 응답

## 백엔드 연결

`npm run dev`는 `/api`를 `http://127.0.0.1:3001`(`backend/`, `npm start`)로 보냅니다. 다른 주소는 `VITE_API_BASE_URL`로 바꿉니다.

- 캡처 분석: `POST /api/products/extract` (`image`, `people`). 백엔드는 `200 { extraction }`을 돌려주고, `src/api/extraction.ts`가 확인 폼 초안으로 바꿉니다(`mm`·`cm`는 `m`로 환산). 이전 응답 형식도 계속 읽습니다. 필드와 오류 코드는 [백엔드 연동 문서](../backend/handoff.md)를 따릅니다.
- 422 `MANUAL_CORRECTION_REQUIRED { extraction }`은 읽은 값을 남기고 나머지를 미확인으로 표시합니다.
- 502·503·504와 네트워크 오류는 한 번 재시도하고, `GEMINI_NOT_CONFIGURED`는 바로 직접 입력으로 안내합니다. 전체 제한 시간은 15초, 이미지는 5MB 이하입니다.
- 서버가 찾은 비교 값은 사용자가 규격을 확인하기 전까지 절감률에 쓰지 않습니다.
- 옵션 후보는 백엔드의 `optionCandidates`를 받아 고를 수 있습니다.
- 정산과 모집글은 PRD v1.1 4장에 따라 화면에서 계산합니다. `POST /api/analyses`는 균등 분할이라 쓰지 않습니다.

## 공구 운영 (P1)

`src/domain/gig`에 상태 전환, 승인 정원, 정산 버전, 송금·환불, 저금통 규칙이 있습니다. 저장은 `src/data/store.ts`의 `GigStore` 인터페이스를 거칩니다.

**지금은 브라우저 저장소(`localStore.ts`)로만 동작합니다.** 다른 기기와 공유되지 않고, 권한 검사도 브라우저 안에서 이루어져 실제 보안이 되지 않습니다. 운영 전에는 같은 규칙을 서버에서 검사하고 인증을 붙인 뒤 `GigStore` 구현을 교체해야 합니다.

## ERD와 다른 점

`src/domain/erd.ts`가 화면의 값을 [ERD](../docs/ERD.md) 컬럼으로 바꿉니다. 아직 저장 API가 없어 화면에서 호출하지는 않습니다. 팀에서 정해야 할 차이는 다음과 같습니다.

| 항목 | ERD | 기능정의서 v1.1 (현재 구현) |
| --- | --- | --- |
| 부담금 | 인원수로 균등, 나머지는 방장 | 받은 수량에 비례, 남는 원은 소수 잔여 순 |
| 소용량 가격·수량, 연간 횟수 | 필수 | 미입력 허용 |
| 수령 장소 | 기본값 있음, 필수 | 미정 허용 |
| 비교 규격(ml, g, m) | 컬럼 없음 | 분할 단위와 따로 보관 |
