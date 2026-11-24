# 긱스플리터 Frontend 핸드오프 · PRD v1.1 P0

**완료 기준:** 프리셋·캡처·직접 입력 중 하나로 시작해 사용자 확인 → 정산·비교(가능할 때) → 에브리타임 모집글 복사까지 완료한다. 로그인, DB 저장, 모집 상태 관리, 실제 게시·송금은 P0 연동 범위 밖이다.

## 로컬 실행

Node.js 24 이상. 백엔드에는 설치할 npm 의존성이 없다.

```sh
cd backend
npm start
```

기본 주소는 `http://127.0.0.1:3001`이다. 브라우저에서는 `/api/...` 상대 경로를 사용하고 개발 서버에서 같은 경로로 프록시한다. Vite 예: `server: { proxy: { '/api': 'http://127.0.0.1:3001' } }`. 백엔드는 CORS 헤더를 보내지 않는다.

실제 이미지 판독은 서버 환경에 `GEMINI_API_KEY`가 있어야 동작한다. 로컬에서는 `backend/.env`에 설정하고 서버를 재시작한다. 기본 모델은 `gemini-3.8-flash`이며 `GEMINI_MODEL`로 변경할 수 있다. 키를 브라우저에 보내거나 저장소에 넣지 않는다. 프리셋과 직접 입력은 키 없이 동작한다. 아래 `curl` 예시는 Windows PowerShell에서는 `curl.exe`로 실행한다.

## 화면과 요청 순서

| 입력 방식 | 확인 폼을 만드는 방법 |
| --- | --- |
| 프리셋 | `GET /api/presets`의 `{ presets: [{ id, demo, product }] }`에서 고른 `product`로 편집 폼을 채운다. `demo: true`는 시연 가격이며 실시간으로 확인된 판매가가 아니다. |
| 캡처 | 파일 한 장을 미리보기로 보여주고 교체·삭제와 명시적인 판독 동작을 제공한다. `200`과 `422 MANUAL_CORRECTION_REQUIRED` 모두 `extraction`의 유효한 값을 확인 폼에 제안한다. 판독값은 자동으로 확정하거나 분석에 제출하지 않는다. |
| 직접 입력 | 빈 폼에서 상품명·수량·단위와 결제 항목을 입력한다. 비교값은 확인한 경우만 입력한다. |

세 방식 모두 **확인된 값만** `POST /api/analyses`로 보낸다. 상품·인원·장소·마감·신청 방법을 바꾸면 이전 결과와 복사를 비활성화하고 재계산한다. 요청 진행 중에는 로딩을 표시하고 중복 제출을 막는다. 이미지 교체·삭제나 새 요청 후 오래된 응답은 취소하거나 요청 ID로 무시한다. 오래된 성공·실패 응답이 현재 폼과 결과를 바꾸면 안 된다.

## 1. 프리셋으로 시작

```sh
curl -i http://127.0.0.1:3001/api/presets
```

ID는 `toilet-paper`, `bottled-water`, `fabric-softener`다. 아래는 `/api` 프록시가 연결된 브라우저에서 확인한 프리셋을 분석하는 예다. 실제 화면에서는 사용자 확인 후 제출한다.

```js
const list = await fetch('/api/presets');
if (!list.ok) throw new Error(`프리셋 조회 실패: ${list.status}`);
const { presets } = await list.json();
const { product } = presets.find(({ id }) => id === 'bottled-water');
const response = await fetch('/api/analyses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ product, people: 4 }),
});
console.log(response.status, await response.json());
```

생수 예시는 `READY`이며 비교 단위는 100ml, 각 정산 행은 6병·6,480원이다. 시연 출처는 응답의 `comparison.source.label`로 표시한다. 사용자가 기준가나 비교 규격을 바꾸면 기존 `SAMPLE` 출처를 유지하지 않는다. 실제 기준으로 바꿨다면 별도로 확인한 `USER_INPUT` 출처를 보내고, 모르면 비교값을 비운다.

## 2. 캡처 판독 후 확인·보정

`POST /api/products/extract`는 `multipart/form-data`로 **`image` 파일 한 장만** 보낸다. JPG·PNG·WebP, 최대 5 MiB다. 브라우저에서 `FormData.set('image', file)`을 쓰고 `Content-Type`은 브라우저에 맡긴다. 업로드 전에 주문번호·실명·연락처·상세 주소를 가리도록 안내한다. 이미지와 추출 규칙은 Gemini에 전송되지만 인원·장소 등 폼 정보는 보내지 않으며, 백엔드는 이미지를 저장하지 않는다.

```sh
curl -i -F "image=@./capture.png;type=image/png" http://127.0.0.1:3001/api/products/extract
```

- `200 { extraction }`: 검토에 필요한 상품·배분 후보와 상품별 표시가 또는 가격 후보가 있다. `selectedOption`은 화면에서 선택 표시를 읽은 값일 뿐이며, 사용자가 옵션과 가격을 확정해야 한다. 각 `priceCandidates` 요소는 `{ amount, type, option, condition, evidence }`다. `amount`는 원화 정수, `option`·`condition`은 미확인 시 `null`이다. `type`은 `LIST_PRICE`, `SALE_PRICE`, `COUPON_PRICE`, `MEMBER_PRICE`, `DISPLAYED_TOTAL`, `CHECKOUT_TOTAL`, `OTHER` 중 하나다.
- `422 { code: 'MANUAL_CORRECTION_REQUIRED', extraction }`: 판독에 필요한 값이 빠졌거나 판독 결과를 해석할 수 없다. 같은 상품의 유효 후보를 남기고 `unresolvedFields`의 관련 입력란을 표시한다. `null`은 0이 아니다. 배송비·할인이 없다고 확인한 경우에만 각각 0을 입력한다. 사용자 수정값을 덮어쓰지 않고, 보정해 분석할 때 이미지를 다시 보내지 않는다.

부분 판독 응답 예시: 혼합 장바구니에서 상품별 금액을 읽지 못한 경우다. 실제 응답은 이미지에 따라 달라진다.

```json
{
  "code": "MANUAL_CORRECTION_REQUIRED",
  "extraction": {
    "fullTitle": "3겹 롤휴지 30m × 30롤",
    "shortName": "3겹 롤휴지",
    "selectedOption": null,
    "optionCandidates": [],
    "packCount": 1,
    "unitsPerPack": 30,
    "netAmountPerUnit": { "amount": 30, "unit": "m" },
    "unitName": "롤",
    "mixedCart": true,
    "displayedTotalPrice": null,
    "shippingFee": null,
    "discountAmount": null,
    "priceCandidates": [],
    "evidence": ["30m × 30롤"],
    "unresolvedFields": [
      "selectedOption", "optionCandidates", "displayedTotalPrice", "shippingFee", "discountAmount", "priceCandidates"
    ]
  }
}
```

혼합 장바구니 전체 금액으로 정산하지 않는다. 사용자가 상품별 금액을 확인한 뒤 `product.payment`로 입력한다. 포장수와 팩당 배분 수량을 확인해 이 예시에서는 `bulkTotalQty: 30`을 입력한다. `netAmountPerUnit`은 규격 확인에 쓰며 그 자체가 배분량이나 비교 소매가가 아니다. 판독은 비교값이나 프리셋을 연결하지 않는다.

## 3. 확인된 상품 분석

`POST /api/analyses`는 `application/json`이다. 직접 입력이든 캡처를 보정했든 같은 계약을 사용한다. 문자열의 앞뒤 공백과 연속 공백은 서버가 정리한다. 숫자와 불리언은 JSON 문자열이 아니라 각 타입으로 보낸다.

| 키 | 제약과 표시 기준 |
| --- | --- |
| `product.shortName`, `product.fullTitle` | 필수 문자열, 각각 최대 80자·200자 |
| `product.bulkTotalQty`, `product.unitName` | 총 배분량은 양의 안전한 정수. 단위는 `롤`·`병`·`개`·`ml`·`g` 중 하나다. |
| `product.allocationStep`, `product.uniformUnits` | 최소 배분량은 양의 안전한 정수이며 총 배분량을 나누어떨어지게 해야 한다. 개수형 보통 `1`, 용량형 예 `100`ml. `uniformUnits`는 배분 단위들의 규격이 동일하다고 확인했을 때만 `true`로 보낸다. |
| `product.payment` | `productAmount`, `shippingFee`, `discountAmount`: 0 이상 안전한 원화 정수. `includesShipping`, `includesDiscount`: 각 항목이 `productAmount`에 이미 반영됐는지 나타내는 필수 불리언. 총액은 미반영 배송비만 더하고 미반영 할인만 뺀 값이다. `isEstimate`는 생략 시 `true`, 확정 금액이면 `false`. |
| `product.annualPurchaseCount` | 선택 양의 안전한 정수. 생략하거나 `null`이면 연간 절감액을 반환하지 않는다. |
| `product.comparisonSpec`, `product.comparisonBaseline` | 선택. 대용량·비교 기준의 규격, 기준가와 출처다. 누락·불일치는 정산을 막지 않는다. 아래 예시 참조. |
| `people` | 방장 포함 정수 `2`~`4`. 인원 모두에게 최소 배분량을 줄 수 있어야 한다. |
| `location`, `deadline`, `applicationMethod` | 선택 문자열, 각각 최대 100자·100자·150자. 누락·빈값은 장소/마감 `null`(모집글 `미정`), 신청 방법 `댓글 또는 쪽지`. 추천 장소는 사용자가 직접 선택할 때만 입력한다. |

다음은 비교가를 모르는 30롤 상품의 확인된 입력이다. UTF-8 `analysis.json`으로 저장한다.

```json
{
  "product": {
    "shortName": "3겹 롤휴지",
    "fullTitle": "3겹 롤휴지 30m × 30롤",
    "bulkTotalQty": 30,
    "unitName": "롤",
    "allocationStep": 1,
    "uniformUnits": true,
    "payment": {
      "productAmount": 17701,
      "shippingFee": 0,
      "discountAmount": 0,
      "includesShipping": false,
      "includesDiscount": false,
      "isEstimate": true
    }
  },
  "people": 4
}
```

```sh
curl -i -H "Content-Type: application/json" --data-binary "@analysis.json" http://127.0.0.1:3001/api/analyses
```

`200` 응답에서 `product`는 정규화된 요청 상품(이 예시는 `payment.totalAmount: 17701` 추가)이다. 그 외 응답 필드:

```json
{
  "people": 4,
  "location": null,
  "deadline": null,
  "applicationMethod": "댓글 또는 쪽지",
  "comparison": { "status": "PENDING", "reason": "MISSING_BASELINE_PRICE" },
  "settlements": [
    { "member": 1, "role": "ORGANIZER", "quantity": 9, "amount": 5311 },
    { "member": 2, "role": "MEMBER", "quantity": 7, "amount": 4130 },
    { "member": 3, "role": "MEMBER", "quantity": 7, "amount": 4130 },
    { "member": 4, "role": "MEMBER", "quantity": 7, "amount": 4130 }
  ],
  "recruitment": {
    "title": "[공구] 3겹 롤휴지 같이 살 3명 구해요",
    "body": "3겹 롤휴지 30m × 30롤 공동구매할 분을 찾고 있어요!\n모집: 3자리\n방장: 9롤 · 예상 5,311원\n공구원 1명당 7롤 · 예상 4,130원\n수령 장소: 미정\n신청 마감: 미정\n신청 방법: 댓글 또는 쪽지"
  }
}
```

### 비교값을 확인한 경우

아래 세 키를 위 JSON의 `product`에 추가하면 음수 절감 예제를 재현할 수 있다. 예제 가격은 동작 설명용이며 시세가 아니다.

```json
{
  "annualPurchaseCount": 6,
  "comparisonSpec": { "compatibilityKey": "동일 폭 3겹 휴지", "unit": "m", "amountPerUnit": 30 },
  "comparisonBaseline": {
    "price": 6000,
    "quantity": 12,
    "unitName": "롤",
    "spec": { "compatibilityKey": "동일 폭 3겹 휴지", "unit": "m", "amountPerUnit": 33 },
    "source": { "kind": "USER_INPUT" }
  }
}
```

- 두 규격은 사용자가 호환을 확인한 `compatibilityKey`(최대 100자)와 같은 물리 단위를 사용한다. `amountPerUnit`은 배분 단위 1개당 양, 비교 기준의 `quantity`는 기준 팩의 배분 단위 수다. 규격 단위는 `L`/`ml`, `kg`/`g`, `m`/`cm`, `개`. 예: `병`은 병당 L나 ml, `롤`은 롤당 m나 cm, 배분 단위가 `ml`·`g`이면 `amountPerUnit: 1`과 같은 기본 단위를 사용한다. 배분 단위와 비교 기준의 총량을 혼동하지 않는다.
- 사용자 출처에는 선택으로 `checkedOn: "YYYY-MM-DD"`와 `reference: { kind: "LINK" | "SCREENSHOT", value }`를 보낼 수 있다. 링크는 `http`·`https`, 스크린샷은 프론트가 가진 텍스트 참조값이다. 분석 JSON에 이미지 파일을 포함하지 않는다.
- `READY`이면 `source`, `displayUnit`, `displayUnitQuantity`, `bulkUnitPrice`, `smallUnitPrice`, `discountPercent`가 있다. 두 단가는 이미 표시 기준량당 가격이다. `settlements` 각 행의 `instantSavings`·`annualSavings`를 개인별로 표시하고, 없는 연간값을 0으로 대체하지 않는다. 위 예제는 **m당 약 29.8% 더 비싼** 경우다. 음수는 할인으로 표현하지 않으며 색만으로 구분하지 않는다.
- `PENDING` 이유는 `MISSING_BASELINE_PRICE`, `UNCONFIRMED_SPEC`, `INCOMPATIBLE_SPEC`, `SAMPLE_MISMATCH`, `UNCONFIRMED_SOURCE` 중 하나다. 단가·절감액 대신 확인이 필요한 이유를 보여주고, 정산표와 모집글은 제공한다. `SAMPLE`은 출처 라벨을 화면에 남기되 모집글에는 절감 문장을 넣지 않는다. `USER_INPUT`의 비교 문장은 유효한 경우만 포함된다.

## 오류 상태와 복구

| 응답 | 프론트 처리 |
| --- | --- |
| `422 MANUAL_CORRECTION_REQUIRED` | `extraction`과 `unresolvedFields`로 확인 폼을 복구한다. 모델 JSON 불량이면 값이 비어 있을 수 있다. |
| `422 INVALID_ANALYSIS_INPUT` | `fields`의 `product.payment.shippingFee` 같은 경로 또는 `people`, `location` 등을 해당 입력란에 연결한다. `product.payment`는 합산 결제액 오류다. `reason: "INSUFFICIENT_ALLOCATION_UNITS"`이면 인원을 줄이거나 확인된 수량·최소 배분량을 수정한다. |
| 업로드 `400 EXPECTED_ONE_IMAGE`, `413 BODY_TOO_LARGE`, `415 UNSUPPORTED_IMAGE` | 각각 파일 한 장, 5 MiB 이하, 허용 형식을 안내하고 파일 재선택을 제공한다. 분석의 `413`은 JSON 본문 16 KiB 제한이다. |
| `400 INVALID_JSON`·`INVALID_MULTIPART`, `415 EXPECTED_JSON`·`EXPECTED_MULTIPART` | 요청 형식 오류로 구분한다. 값은 남기고 같은 잘못된 요청을 반복하지 않는다. |
| `502 GEMINI_UNAVAILABLE`, `503 GEMINI_NOT_CONFIGURED`, `504 GEMINI_TIMEOUT` | `retryable`을 확인해 사용자 재시도 가능 여부를 표시하되, 직접 입력·프리셋은 계속 제공한다. 서버는 일시 실패에서만 최대 한 번 재호출하며 공유 제한은 3.5초다. `503`은 재시도 불가다. |
| 기타 HTTP·네트워크·응답 파싱 오류 | 공통 오류를 표시하고 현재 입력은 유지한다. 이전 결과를 새 입력의 결과로 사용하지 않는다. |

## 인수 체크리스트

1. 키 없이 프리셋과 직접 입력으로 계산·복사한다. 2~4인 수량·원화 총합, 방장/공구원 정산 차이, 예상·미정 문구가 응답과 같은지 확인한다.
2. 캡처의 옵션·가격 후보, 상품별 금액이 빠진 혼합 장바구니, 형식 오류·타임아웃에서 입력을 복구한다. 이미지 교체 후 이전 응답이 폼을 덮지 않아야 한다. 실제 Gemini 판독 정확도는 별도로 확인한다.
3. 비교 보류·가격 역전·연간 횟수 미입력을 확인한다. 서버 모집글을 줄바꿈 그대로 미리 보여주고 복사하며, 성공·실패를 알린다. 권한이 차단되면 텍스트를 선택해 직접 복사할 수 있게 한다.
4. 버튼 클릭부터 화면 렌더링까지 프리셋 1.2초, 이미지 결과 4초, 모집글 포함 핵심 결과 5초는 측정 목표다. 실제 화면 시간·쇼핑몰 가격은 미검증이다.

P1 운영 DB는 아직 적용하지 않는다. ERD와 PRD의 변경 필요 항목은 [백엔드 계획](./plan-backend.md#p1--erd-기반-운영-저장)에 남겨 둔다.
