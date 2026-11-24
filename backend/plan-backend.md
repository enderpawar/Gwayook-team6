# 긱스플리터 백엔드 구현 계획

기준: [PRD v1.0](https://github.com/enderpawar/Gwayook-team6/blob/docs/erd/docs/GigSplitter-PRD-v1.0.pdf) §3~6. 새 ERD는 팀원이 작성 중이다. 기존 택시·배달 합승 ERD의 테이블과 상태 규칙은 가져오지 않는다. P0 분석 기능은 DB 없이 먼저 구현한다.

## P0 구현 순서

| 순서 | 기능 | 백엔드 작업 |
| --- | --- | --- |
| 1 | F-02 프리셋·수동 입력 | 휴지 30롤, 생수 2L×24병, 섬유유연제 4L의 검증된 비교 데이터를 준비한다. 프리셋과 직접 보정한 값은 같은 분석 입력 형식을 쓴다. |
| 2 | F-03~04 단가 비교·정산 | 소용량과 대용량의 단위를 일치시킨 뒤 단가, 절감률, 방장 기준 절약액과 연간 환산액을 계산한다. 방장 포함 2~4명의 수량·금액 배분표를 만든다. |
| 3 | F-05~06 장소·모집 문구 | 상품명, `N−1`자리, 공구원 1명의 부담금·배분량, 절감률, 수령 장소로 에브리타임 제목·본문을 생성한다. 장소를 생략하면 PRD의 기본값인 `행복기숙사 1동 로비`를 사용한다. |
| 4 | F-01 이미지 판독 | JPG/PNG/WEBP를 Gemini Structured Output(`application/json`)으로 분석한다. 쿠폰이 포함된 화면에서는 최종 결제 예정가를 추출한다. 단가와 정산액은 Gemini가 아니라 백엔드 계산기로 구한다. |

프론트는 이미지 선택·미리보기, 장소 추천 칩, 수정 폼, 결과 표시, 클립보드 복사를 담당한다. 백엔드는 모집글을 생성하지만 에브리타임에 직접 게시하지 않는다.

## 프론트 연동 API

아래는 현재 구현된 계약이다. 로컬 서버는 기본 `http://127.0.0.1:3001`에서 동작한다. 프론트 개발 서버에서 `/api`를 이 주소로 프록시한다.

| API | 요청 | 응답 |
| --- | --- | --- |
| `GET /api/presets` | 없음 | `{ presets: [{ id, product, sources }] }`. `sources`에 대용량·비교용 소포장 판매처가 포함된다. |
| `POST /api/products/extract` | `multipart/form-data`: `image` 한 장(JPG/PNG/WEBP, 최대 5 MiB), `people`(`2`~`4`), `location`(선택) | `200 { product, comparisonSource }` 또는 `422 { code: 'MANUAL_CORRECTION_REQUIRED', product, fields, comparisonSource }`. `422`의 `product`에는 유효한 부분 판독값이 남는다. |
| `POST /api/analyses` | `application/json`: `{ product, people, location? }` | `200 { product, people, location, comparison, settlements, recruitment }` 또는 `422 { code: 'INVALID_ANALYSIS_INPUT', fields }` |

`product`는 PRD §5의 `shortName`, `fullTitle`, `bulkTotalPrice`, `bulkTotalQty`, `unitName`, `smallPackQty`, `smallPackPrice`를 사용한다. `annualPurchaseCount` 기본값은 12회, `whyGood`은 선택이다. 프리셋·이미지 판독·수동 입력은 모두 같은 분석 API를 호출한다. 예: 프리셋에서 받은 `product`를 `{ product, people: 4, location: '정문 편의점' }`으로 보낸다.

`comparison`에는 `displayUnitQuantity`, `bulkUnitPrice`, `smallUnitPrice`, `discountPercent`, `instantSavings`, `annualSavings`가 들어간다. `settlements`는 `{ member, role, quantity, amount }` 배열이며 첫 행이 `ORGANIZER`, 나머지는 `MEMBER`다. `recruitment`는 `{ title, body }`다.

이미지 비교값은 캡처에 표시된 값(`comparisonSource.kind: 'SCREENSHOT'`) 또는 규격이 일치하는 프리셋의 비교값(`'PRESET'`, `id`·`label`·`url` 포함)만 사용한다. 값이 없으면 `fields`에 나열된 항목을 보정해 `/api/analyses`로 보낸다. 키 미설정(`503`), 공급자 오류(`502`), 3.5초 판독 타임아웃(`504`)에서도 수동 입력과 프리셋은 이용할 수 있다.

PRD의 `gemini-2.5-flash`는 신규 접근이 제한되어 [Google의 권장 대체 모델](https://ai.google.dev/gemini-api/docs/deprecations) `gemini-3.5-flash-lite`를 기본값으로 사용한다. 서버의 `GEMINI_MODEL`로 변경할 수 있다. 키와 캡처는 저장하지 않으며, 판독 시 캡처는 Gemini에 전송된다.

## 계산 계약

- 수량은 `롤`, `병`, `개`, `ml`, `g` 중 공통 단위의 양의 정수로 정규화한다. 예를 들어 섬유유연제 4L는 `4000 ml`로 계산하고, 화면에 100ml당 단가를 표시하더라도 정산 단위는 `ml`로 유지한다.
- `bulkTotalQty`가 인원수보다 작으면 공구원에게 0을 나누는 대신 입력 오류를 반환한다. `ml`·`g` 품목의 두 단가는 100단위 기준으로 반환한다.
- 대용량·소용량 단가 = 각 결제액 ÷ 각 총수량. 절감률 = `(소용량 단가 − 대용량 단가) ÷ 소용량 단가 × 100`.
- 수량과 원화 결제액을 각각 `N`으로 정수 나눗셈한다. 몫은 모두에게 배정하고, 두 나머지는 전부 방장에게 더한다. 총 배분량은 원래 수량과 같고 총 정산액은 결제액과 1원 오차 없이 일치해야 한다.
- 즉시 절약액은 PRD식대로 `방장 배분량 × 소용량 단가 − 방장 정산액`이다. 연간 절약액은 이 금액에 `annualPurchaseCount`를 곱한다. 중간 단가를 표시용으로 반올림한 뒤 다시 계산에 사용하지 않는다.
- API는 계산값을 표시용으로 반올림하지 않는다. 생성 문구의 절감률만 소수 한 자리까지 표시하며, 음수면 할인 대신 단가가 높다고 안내한다.

## 검증 기준

- 2·3·4명 각각에서 총 배분량과 총 정산액이 원본과 일치한다. 예: 30롤·17,701원·4명 → 방장 9롤·4,426원, 나머지 3명 각 7롤·4,425원.
- 프리셋과 수동 입력에 같은 상품·조건을 넣으면 같은 계산과 문구가 나온다. 인원 범위 밖의 값, 0인 분모, 비교 불가능한 단위는 정상 결과로 처리하지 않는다.
- 저해상도·쿠폰 혼재 이미지에서 결과를 확인하고, 판독 불가 응답의 수동 보정으로 분석을 끝낼 수 있어야 한다. 프리셋은 Gemini 없이 동작해야 한다.
- PRD의 결과 화면 목표는 프리셋 1.2초 이내, 이미지 분석 4초 이내다. 백엔드 로그의 Gemini 호출 시간과 별도로 프론트에서 결과 화면까지의 시간을 확인한다.

## P0 이후

- **P1 F-07:** 같은 배분표로 카카오톡 정산 공지 문구를 생성한다. 실제 송금은 하지 않는다.
- **P1 F-08:** 분석 건당 한 번만 절약액을 기록한다. 서버 저장이 필요하면 새 ERD에 맞춰 저장과 중복 방지를 설계한다.
- **P1 F-09:** API 일시 장애에는 지수 백오프 재시도, 완전 오프라인에는 확보된 입력으로 프론트 로컬 계산을 적용한다. 서버에서만 폴백해서는 완전 오프라인을 지원할 수 없다.
- **P2 F-10:** 교내 이메일 인증, 캠퍼스 실시간 매칭, 에스크로, 분할 영수증은 이번 MVP에서 제외한다.

미결 사항과 착수 체크리스트는 [handoff.md](./handoff.md)에 있다.
