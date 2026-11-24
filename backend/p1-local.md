# P1 핵심 API 로컬 실행

Node 24, `backend` 디렉터리에서 실행한다. 예: PowerShell.

```powershell
New-Item -ItemType Directory -Force .p1 | Out-Null
$env:P1_DB_PATH = '.p1/gigsplitter.sqlite'
npm start
```

`P1_DB_PATH`가 없으면 P1 경로는 404이고 SQLite는 로드하거나 생성하지 않는다. P0 API는 키 없이 종전과 동일하며 P1 활성화 시에도 P0 요청 자체는 저장되지 않는다. P1은 루프백 전용이다. 프록시·터널로 공개하지 않는다. `.p1/` 및 SQLite 파일은 Git에서 제외하며, 이 파일은 로컬 개발용 데이터다. 재실행 시 같은 파일을 연다. 시작 시 스키마 버전이 맞지 않거나 해당 경로가 기존 비어 있지 않은 미관리 DB라면 중단한다.

## HTTP 계약 (`/api/p1` 아래)

| 메서드·경로 | 인증/본문 |
| --- | --- |
| `POST /auth/register` | `{email,password,displayName}`. 로컬 계정 생성, 비밀번호 12자 이상. |
| `POST /auth/login` | `{email,password}` → `{token,expiresAt,user}`. 이후 `Authorization: Bearer <token>`으로 전달. |
| `POST /auth/logout` | Bearer 토큰 폐기. |
| `GET /groups` | 소유자 기준 목록. |
| `POST /groups` | `{input:{…}}`로 소유자 초안 생성. `input:{}`부터 저장 가능. |
| `GET /groups/:id` | 소유자는 상세, 신청자는 공개 요약과 본인 신청/자리만 조회. |
| `PUT /groups/:id` | 소유자가 `{revision,input:{…}}`로 초안 전체 교체. |
| `DELETE /groups/:id` | 소유자가 `{revision}`으로 미게시 초안만 삭제. |
| `POST /groups/:id/publish` | 소유자가 `{revision}`으로 게시. 응답의 `inviteToken`은 이때 한 번만 반환. |
| `PATCH /groups/:id/recruitment` | 소유자가 `{revision,people?,publicLocation?,applicationDeadline?,pickupCandidates?}`로 주문 전 모집 조건 변경. |
| `POST /groups/:id/close`, `POST /groups/:id/reopen` | 소유자가 `{revision}`으로 수동 마감/재모집. 재모집 시 미래 신청 마감 필요. |
| `POST /groups/:id/invite` | 소유자가 기존 토큰을 폐기하고 새 초대를 발급. |
| `GET /invites/:token` | 토큰 보유자는 익명으로 공개 요약 조회. 캐시 및 리퍼러 차단; URL을 로그나 외부 채널에 불필요하게 복제하지 않는다. |
| `POST /invites/:token/applications` | 토큰과 인증이 모두 필요. 본문 `{alias}`. 사용자당 한 신청이며 현재 로컬 범위에서 철회 후 재신청 불가. |
| `POST /groups/:id/withdraw` | 참여자가 본인 신청/승인을 주문 전에 철회. |
| `POST /groups/:id/applications/:userId/approve`, `POST /groups/:id/applications/:userId/exclude` | 소유자가 승인/제외(승인 전이면 거절). |

JSON 요청은 `Content-Type: application/json`(16 KiB 제한). 시간은 UTC ISO 8601 (`YYYY-MM-DDThh:mm:ss[.sss]Z`). 마감 이후에는 상태가 `OPEN`이어도 신청/승인이 거절되며, `remainingSeats`는 빈 자리 수이고 `acceptingApplications`는 실시간 가능 여부다. 초안 교체·게시·삭제·모집 조건 변경·마감/재모집의 오래된 `revision`은 409. 세션은 12시간, 초대는 7일로 둘 다 DB에는 해시만 저장한다. 이메일 소유 검증은 없고 익명 사용자가 임의 헤더로 계정을 선택할 수 없다.

게시 가능한 `input` 예시 (날짜는 실행 시점 이후로 선택):

```json
{
  "people": 3,
  "publicLocation": "학생회관 로비",
  "applicationDeadline": "2030-05-01T10:00:00Z",
  "pickupCandidates": ["2030-05-02T10:00:00Z"],
  "inputOrigin": "MANUAL",
  "allocationMode": "SEALED_PACKAGE",
  "priceConfirmed": true,
  "product": {
    "shortName": "롤휴지",
    "fullTitle": "3겹 롤휴지 30롤",
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
      "isEstimate": false
    }
  }
}
```

`priceConfirmed`는 방장이 실제로 확인한 상품 가격이라는 명시적 선언이지 주문/결제나 외부 증빙 검증이 아니다. 모든 모집 부담금은 여전히 **예상**으로 표시한다. 단일 용기의 직접 소분은 금지하며 검증된 균일 밀봉 단위(롤/병/개)만 게시한다. 비교 보류는 정상이고 샘플 비교가는 운영 비교에서 제외한다. `CAPTURE`는 사용자 출처 표시일 뿐 판독 증명이 아니다. 저장 대상은 허용된 입력 필드뿐이고 업로드, 모델 응답, 비교 이미지, 연락처/계좌/상세 주소 전용 필드는 없다. `publicLocation`에는 공개 거점만 입력한다.

## 저장·후속 확장 경계

- `db.js`의 `openP1Database(path)`는 `{db: DatabaseSync, transaction(fn,{readOnly=false}?), close()}`를 반환한다. 쓰기는 `BEGIN IMMEDIATE`와 `busy_timeout=5000`, 읽기 스냅샷은 `BEGIN`. 콜백은 동기이고 `db`를 받아 사용하며 중첩 호출하지 않는다. 공구 쓰기는 호출 후 부모 공구를 먼저 확인한다. 다음 스키마는 `db.js` 마이그레이션 배열에 순차 추가한다.
- `group_buy`: `host_id, analysis_id, revision, headcount, public_location, application_deadline, pickup_candidates`, 상태 `DRAFT OPEN CLOSED SETTLING PICKUP COMPLETED CANCELLED` (이번 API는 처음 세 상태만 전이). DB 시각 및 후보 배열은 UTC epoch ms. `group_participation`: `(group_buy_id,user_id), alias,status,approval_seq`. `group_seat`: `(group_buy_id,seat_no), user_id,assigned_at,role`; 0번이 `ORGANIZER`, 나머지는 `MEMBER`. 정산 입력 순서는 좌석 번호가 아니라 방장 → 활성 승인 `approval_seq` 오름차순이다. 방장 별칭은 `users.display_name`.
- `groups.js`의 `getOwnedGroup(db,groupId,userId)`는 원시 부모 행, `getAnalysis(db,analysisId)`는 `product`, `allocationMode`, `inputOrigin`, `presetId`, `comparisonStatus`, `comparisonPendingReason`, `bulkSpecBaseAmount`, `baselineSpecBaseAmount`를 읽는다. `product_json`은 P0 `analyze`의 검증 필드/가격과 승인된 비교 입력만, `*_spec_base_amount`는 mm/ml/g/개 정수다. 정산 확정 버전·송금/수령 장부·절약은 별도 테이블과 쓰기 트랜잭션으로 추가한다.
- `routes.js` 인증된 `/groups/:id` 분기에 후속 HTTP 작업을 연결한다. `auth.js`의 `requireUser(db,request)`가 반환한 사용자 ID와 같은 트랜잭션에서 공구 소유/참여를 검증한다. 링크 공개 필드는 정산에서 별도로 허가한다. 운영 DB·본인확인·보관 정책이나 F-20 품목 승인을 이 로컬 런북으로 확정하지 않는다.
