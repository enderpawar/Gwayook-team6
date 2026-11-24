# P1 운영 API 로컬 실행

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

## 정산 및 완료 (`/api/p1` 아래)

모든 정산 요청은 Bearer 인증이 필요하다. 정산 경로의 공통 접두사는 `/groups/:id/settlement`다. POST는 JSON 객체를 사용하며 별도 본문이 없는 명령은 `{}`를 보낸다.

| 메서드·접미사 | 사용자와 계약 |
| --- | --- |
| `POST /candidate` | 방장. `{revision, priceConfirmed:true, quantity, payment, orderAt?, pickupAt?, publicHub?, hostAlias?, allocationMode?, reason?, excludeUserIds?}`. 최초 `orderAt`은 실제 주문 시각, `payment`는 위의 할인/배송 포함 플래그를 포함한 **판매처 환불 전** 원천 가격이다. 첫 후보의 예상 대비, 이후 후보의 직전 확정본 대비 가격 차이·조건 변경·재확인 대상과 정산 행을 반환한다. 정정에는 `reason` (`ORDER_ISSUE`, `CORRECTION`, `NO_SHOW`, `RETURN_REQUIRED`)이 필요하다. 확정본이 있으면 주문 시점·품목을 유지하며 수량·금액·수령 안내 및 기존 승인자 제외를 정정할 수 있다. 예약 후보를 교체하면 새 버전 번호를 발급한다. |
| `POST /:version/reconfirm`, `POST /:version/confirm` | 해당 대기 후보의 승인자가 본인 행을 재확인하고, 방장이 필요한 확인을 모두 받은 그 후보만 확정한다. 미확정 후보는 지급 대상이나 카카오톡 공유본이 아니다. |
| `GET /`, `GET /:version` | 접미사 없는 경로는 현재 확정본(없으면 대기 후보), 숫자 경로는 지정 버전. 방장은 스냅샷 및 현재 장부를, 해당 버전 참여자는 본인 행·공개 거점 및 권한 있는 본인 잔액/이력만 본다. 이전 링크는 읽기 전용이며 `latestPath`/`pendingPath`는 응답 사용자가 그 버전에도 권한이 있을 때만 제공한다. 제외된 사용자는 과거 자기 행 및 자기 환불을 볼 수 있지만 최신 링크를 받지 않는다. 버전 URL 자체는 인증 또는 초대 토큰이 아니다. |
| `GET /:version/kakao` | 방장만 해당 확정본의 `{text}` 조회. 총액, 별칭별 수량·부담금, 수령 일시·공개 거점만 포함하며 외부에 직접 보내지 않는다. 복사한 문구는 회수할 수 없다. |
| `POST /events` | `{type,requestKey,versionNo,userId?,amount?,quantity?,unitName?,relatedEventId?,occurredAt?}`. 승인자는 본인 `TRANSFER_REPORTED`만, 방장은 `TRANSFER_CONFIRMED`, `REFUND_CONFIRMED`, `MERCHANT_REFUND_CONFIRMED`, `REVERSAL`, `RECEIVED`, `REVERSED` 기록 가능. 방장 기록에는 당사자 `userId`가 필요하다(판매처 환불은 방장 ID). `occurredAt`은 선택적 UTC ISO 밀리초 시각이며 서버 기록 시각과 별개다. |
| `POST /pickup`, `POST /complete` | 방장. 확정 수령 일시와 공개 거점이 있어야 수령 중으로 전이한다. 완료 시 현재 행의 순입금·실수령, 과거 제외자 잔액/품목, 판매처 환불 반영 및 열린 조치를 모두 확인한다. |
| `POST /action`, `POST /resolve` | 방장. `{kind,userId?}`로 조치를 열고 `{id}`로 해결한다. `NO_SHOW` 및 `RETURN_REQUIRED`에는 현재 참가자 `userId`가 필요하며 `ORDER_ISSUE`·`CORRECTION`은 공구 전체 조치로도 기록할 수 있다. |
| `POST /cancel` | 방장. `{reason}` (`SOLD_OUT`, `ORDER_CANCELLED`, `ORDER_ISSUE`, `NO_SHOW`, `CORRECTION`)으로 게시 후 미완료 공구 취소. 신규 신고·입금 확정은 닫고 기존 이력은 남긴다. 환불·기록 정정은 계속 가능하다. |
| `GET /savings` (정산 접두사 없음) | 본인 `{records,numerator,denominator}`만 조회. 현재 완료 버전의 `USER_INPUT` 기준과 실제 부담금·수령으로 계산한다. 분자·양의 분모는 원화 기약분수의 십진 문자열이며 음수를 보존한다. |

- 후보 작성은 방장과 승인 순 `approval_seq`의 실제 점유 명단만 사용한다. 결원이 있으면 마감 상태에서 먼저 정원을 실제 인원으로 변경한다. 수령 예정 시각이나 거점을 정정할 수 있고 이전 버전의 안내는 바뀌지 않는다. `publicHub`·별칭에는 공유에 동의한 공개 문구만 넣는다. 기본 방장 별칭은 `방장`; 개인 이름·상세 주소·연락처·계좌·은행 증빙 원본용 필드는 없다.
- `requestKey`는 명령마다 발급하는 UUID이며 재시도 때 같은 값을 재사용한다. 같은 당사자의 같은 키와 내용은 이전 사건을 반환하고 내용이 달라지면 `REQUEST_KEY_CONFLICT`(409)다. 신고는 순입금에 포함되지 않는다. 신고를 연결한 실제 확인과 원 사건의 반전은 각각 한 번만 가능하다. 앱은 외부 송금·취소를 실행하지 않으며 서로 다른 키로 기록한 별개의 은행 거래를 자동 대조하지 않는다.
- 실제 수령(`RECEIVED`)은 해당 품목을 보유하는 **관측 총량**과 정산 배분 단위이며 반납 후 `quantity:0`을 기록할 수 있다. 오기는 원 사건 반전(`REVERSED`) 및 새 기록으로 수정한다. `due > 0`은 미입금·부분입금·추가부담, `due < 0`은 미환불이다. 판매처 환불은 확인 후 새 후보의 원래 결제액에 한 번만 적용되며, 참가자 환불은 별도 장부에 기록한다.
- 권한 없는 공구·버전·행은 404, 미인증은 401, 상태/재확인/완료 조건 충돌은 409, 잘못된 입금·환불·수령 입력은 422다. 완료 후 정정이나 장부 반전은 공구를 재개하고 기존 저금통의 집계를 중단한다. 재완료에서 동일 `(공구, 사용자)` 키로 교체하며 기존 비적격 행은 집계하지 않는다.

## 저장·운영 경계

- `openP1Database(path)`는 SQLite 버전 0에서 `001-initial.sql` → `002-settlement.sql`, 버전 1에서는 `002`만 순서대로 적용한다. 쓰기는 `BEGIN IMMEDIATE`와 `busy_timeout=5000`, 읽기 스냅샷은 `BEGIN`이다. 확정 버전·명단·확인·현금/수령 이력은 기존 행을 고치지 않으며 재확인·반전·장부 요청 유일성을 SQLite에서도 보강한다. 운영 서비스 권한, 복구·백업, 접근·보관 정책을 이 로컬 파일로 확정하지 않는다.
- 모집 분석의 비교 기준은 발행 시 확인된 입력이며 정산과 별도다. 정정/재완료는 같은 판매처 주문과 동일 상품의 확인 입력을 기준으로 한다. 사후 참가자 교체, 신규 품목 주문 결합, 이메일 소유 검증, 만료 정산 링크 토큰은 이 로컬 정책에 없다. 모집 초대 토큰은 별도이며 정산 권한을 부여하지 않는다.
- 직접 소분 운영 허용 정책은 승인된 품목이 없어 **모집과 정산 API에서 밀봉만 허용**한다. P0 시연은 승인 권한을 부여하지 않는다. 순수 정산 도메인의 직접 소분은 신뢰된 서버 정책과 실제 단일 용기 표시·계량·용기 확인을 함께 요구하며, 이 로컬 API는 그러한 정책을 클라이언트에서 받지 않는다.

검증: `node --test test/p1-core.test.js test/p1-settlement.test.js` (백엔드 디렉터리). 임시 파일 DB 업그레이드, 루프백 HTTP 권한·과거/현재 링크, 부분입금/반전/환불/수령/취소 및 재완료를 검사한다. 실제 은행·카카오톡·프론트 화면·운영 배포 검증은 아니다.
