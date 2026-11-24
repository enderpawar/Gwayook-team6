# 긱스플리터 프론트엔드

기능정의서 [v1.1](../docs/GigSplitter-PRD-v1.1.md)의 P0(F-01~F-06, F-09, F-11~F-13)를 구현한 모바일 우선 웹 앱입니다.

## 실행

```bash
npm install
npm run dev        # 실제 백엔드에 연결
npm run dev:mock   # 모의 분석 응답으로 실행
npm test
npm run build
```

`dev:mock`에서는 올린 파일 이름으로 상황을 고릅니다. `multi`는 가격 후보 여러 개, `bad`는 잘못된 JSON, `503`은 서버 오류, `timeout`은 시간 초과입니다.

## 구조

- `src/domain` 정산, 단가 비교, 모집글 계산. React에 의존하지 않습니다.
- `src/api` 이미지 검사와 추출 요청
- `src/features` 단계별 화면과 상태
- `src/components` 공통 UI
- `mock` 개발용 모의 응답

## 백엔드 API

판독은 `POST /api/products/extract`, `multipart/form-data`, 필드 `image` 한 장입니다. 백엔드는 `200 { extraction }` 또는 `422 { code: 'MANUAL_CORRECTION_REQUIRED', extraction }`을 돌려주고, `src/api/extraction.ts`의 `parseResponse`가 이를 확인 폼 초안으로 바꿉니다. 필드와 오류 코드는 [백엔드 연동 문서](../backend/handoff.md)를 따릅니다.

- 개발 서버는 `/api`를 `http://127.0.0.1:3001`로 넘깁니다. 다른 주소를 쓰려면 `VITE_API_BASE_URL`을 지정합니다.
- 502·503·504와 네트워크 오류는 한 번 재시도합니다. 전체 제한 시간은 15초입니다. `503 GEMINI_NOT_CONFIGURED`는 재시도하지 않습니다.
- 429는 호출 한도, 400·413·415와 그 밖의 422는 분석할 수 없는 이미지로 안내합니다.
- 정산·단가 비교·모집글은 프론트가 계산합니다(`src/domain`). P0에서는 `/api/analyses`, `/api/presets`를 호출하지 않습니다.

## ERD와 다른 점

`src/domain/erd.ts`가 화면의 값을 [ERD](../docs/ERD.md) 컬럼으로 바꿉니다. 아직 저장 API가 없어 화면에서 호출하지는 않습니다. 팀에서 정해야 할 차이는 다음과 같습니다.

| 항목 | ERD | 기능정의서 v1.1 (현재 구현) |
| --- | --- | --- |
| 부담금 | 인원수로 균등, 나머지는 방장 | 받은 수량에 비례, 남는 원은 소수 잔여 순 |
| 소용량 가격·수량, 연간 횟수 | 필수 | 미입력 허용 |
| 수령 장소 | 기본값 있음, 필수 | 미정 허용 |
| 비교 규격(ml, g, m) | 컬럼 없음 | 분할 단위와 따로 보관 |
