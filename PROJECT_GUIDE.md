# AMI_V2 유지보수 단일 가이드

- 기준 시점: 2026-03-07 코드베이스 전체 스캔 결과
- 목적: 다음 수정 요청부터 이 문서 하나만 보고 빠르게 수정 지점을 찾고, 같은 방식으로 검증/반영하기
- 적용 범위: `src/`, `src-tauri/`, 빌드 설정, DB 연결/커맨드, 공통코드/점포/시스템타입 흐름

## 0. 이 문서 사용법 (실전)

1. 요청을 먼저 유형으로 분류한다.  
   - `UI 문구/디자인` / `프론트 로직` / `DB CRUD` / `공통코드` / `라우트/메뉴` / `정산/예약`
2. 아래 **[4. 도메인별 수정 진입점]**에서 해당 도메인 블록을 찾는다.
3. 블록에 적힌 `프론트 파일 + Tauri 커맨드 + DB 테이블`만 먼저 수정한다.
4. **[8. 검증 체크리스트]** 순서대로 확인 후 마무리한다.

## 1. 빠른 실행/검증

### 기본 실행
```bash
npm install
npm run dev
```

### 데스크톱 실행(Tauri)
```bash
npm run tauri dev
```

### 빌드/검증
```bash
npm run build
npm run lint
cd src-tauri && cargo check
```

현재 확인된 상태:
- `npm run build`: 성공 (청크 크기 경고 존재)
- `npm run lint`: 성공
- `cargo check`: 성공

## 2. 구조 요약

### 기술 스택
- 프론트: React 19 + Vite 6 + TypeScript + Tailwind 4
- 데스크톱: Tauri 2 + Rust
- DB: PostgreSQL (`tokio-postgres`)
- 다국어: i18next (`ko/en/zh`)

### 핵심 경로
- 라우트 엔트리: `src/App.tsx`
- 공통 레이아웃: `src/layouts/DashboardLayout.tsx`
- 사이드바 동적 메뉴: `src/components/layout/Sidebar.tsx`
- DB 호출 유틸: `src/lib/dbClient.ts`
- DB 연결 상수: `src/config/dbConfig.ts`
- Tauri 커맨드/DDL: `src-tauri/src/main.rs`
- SQL 참고 스크립트: `src-tauri/sql/*.sql`

## 3. 라우트 맵 + 데이터 소스 현황

| 라우트 | 페이지 파일 | 데이터 소스 | 상태 |
| --- | --- | --- | --- |
| `/products` | `src/pages/Product/ProductManagementPage.tsx` | 로컬 더미 | Mock |
| `/inventory` | `src/pages/Product/StockManagementPage.tsx` | 로컬 더미 | Mock |
| `/inventory/history` | `src/pages/Product/StockHistoryPage.tsx` | 로컬 더미 | Mock |
| `/purchases` | `src/pages/Sales/PurchaseManagementPage.tsx` | 로컬 더미 | Mock |
| `/sales-stats` | `src/pages/Sales/SalesStatisticsPage.tsx` | 로컬 더미/차트 | Mock |
| `/users` | `src/pages/UserManagement/UserManagementPage.tsx` | Tauri DB | Live |
| `/employees` | `src/pages/UserManagement/EmployeeManagementPage.tsx` | Tauri DB | Live |
| `/users/points` | `src/pages/UserManagement/PointRechargePage.tsx` | Tauri DB | Live |
| `/users/reservations` | `src/pages/UserManagement/ReservationCalendarPage.tsx` | Tauri DB | Live |
| `/users/sales` | `src/pages/UserManagement/SalesEntryPage.tsx` | Tauri DB | Live |
| `/system/menu` | `src/pages/System/MenuManagementPage.tsx` | Tauri DB | Live |
| `/system/code` | `src/pages/System/CommonCodePage.tsx` | Tauri DB | Live |
| `/system/service-catalog` | `src/pages/System/ServiceCatalogPage.tsx` | Tauri DB | Live |
| `/system/role` | `src/pages/System/RoleManagementPage.tsx` | Tauri DB | Live |
| `/system/settings` | `src/pages/System/SystemSettingsPage.tsx` | Tauri DB + localStorage | Live |

## 4. 도메인별 수정 진입점

### 4.1 회원 관리(User)
- 프론트: `src/pages/UserManagement/UserManagementPage.tsx`
- 커맨드: `get_user_management_data`, `upsert_user_management`, `delete_user_management`
- 백엔드: `src-tauri/src/main.rs` (`get/upsert/delete_user_management`)
- 테이블: `user_management`

### 4.2 직원 관리(Employee)
- 프론트: `src/pages/UserManagement/EmployeeManagementPage.tsx`
- 커맨드: `get_employee_management_data`, `upsert_employee_management`, `delete_employee_management`
- 의존: 역할 목록 `get_role_management_data`
- 테이블: `employee_management`, `role_management`

### 4.3 공통코드(Common Code)
- 프론트: `src/pages/System/CommonCodePage.tsx`
- 커맨드: `get_common_code_management_data`, `upsert_common_code_group`, `upsert_common_code_detail`, `delete_common_code_group`, `delete_common_code_detail`
- 테이블: `common_code_group`, `common_code_detail`
- 주의: `SALON_SERVICE_CATEGORY` 생성 버튼은 프론트 편의 기능

### 4.4 메뉴 관리(Menu)
- 프론트: `src/pages/System/MenuManagementPage.tsx`
- 사이드바 반영: `src/components/layout/Sidebar.tsx` (`menu-management-updated` 이벤트)
- 커맨드: `get_menu_management_data`, `upsert_menu_management`, `delete_menu_management`
- 테이블: `menu_management`

### 4.5 권한(Role)
- 프론트: `src/pages/System/RoleManagementPage.tsx`
- 커맨드: `get_role_management_data`, `get_role_menu_permissions`, `upsert_role_management`, `delete_role_management`, `upsert_role_menu_permission`
- 테이블: `role_management`, `role_menu_permission`
- 중요 제약: 페이지 내부 메뉴 트리는 메뉴 ID를 하드코딩해 조립하고 있음(동적 트리 아님)

### 4.6 시술 카탈로그(Service Catalog)
- 프론트: `src/pages/System/ServiceCatalogPage.tsx`
- 커맨드: `get_service_catalog_data`, `upsert_service_catalog_item`, `delete_service_catalog_item`
- 카테고리 소스: 공통코드 그룹 `T_CATEGORY`
- 테이블: `service_catalog_management`

### 4.7 예약 캘린더(Reservation)
- 프론트: `src/pages/UserManagement/ReservationCalendarPage.tsx`
- 커맨드: `get_reservation_calendar_data`, `upsert_reservation_calendar_item`, `delete_reservation_calendar_item`
- 조회 의존: `get_common_code_management_data`, `get_service_catalog_data`, `get_user_management_data`, `get_employee_management_data`
- 상태코드: `RESERVATION_STATUS` (없으면 `RESERVED/COMPLETED/CANCELLED` fallback)
- 테이블: `reservation_calendar_management`, `reservation_calendar_service_line`

### 4.8 포인트 충전(Point Recharge)
- 프론트: `src/pages/UserManagement/PointRechargePage.tsx`
- 커맨드: `get_member_point_management_data`, `recharge_member_point`
- 결제수단: 공통코드 그룹 `PAYMENT_METHOD`
- 테이블: `member_point_balance`, `member_coupon_balance`, `member_point_history`, `member_point_usage_history`
- 참고: 백엔드 `use_member_point` 커맨드는 현재 프론트 미연결

### 4.9 매출/정산(Sales Entry)
- 프론트: `src/pages/UserManagement/SalesEntryPage.tsx`
- 커맨드: `get_sales_settlement_data`, `upsert_sales_settlement`, `cancel_sales_settlement`
- 조회 의존: 회원/직원/시술/포인트/예약/공통코드
- 상태: `PROCESSING`, `COMPLETED`, `CANCELLED`
- 테이블: `sales_settlement_management`, `sales_settlement_service_line`, `sales_settlement_payment_line`
- 참고: 백엔드 `delete_sales_settlement`는 현재 UI 미연결

### 4.10 시스템 설정(System Settings)
- 프론트: `src/pages/System/SystemSettingsPage.tsx`
- 기능:
  - 브랜드명/로고 localStorage 저장
  - 활성 점포(`STR_CD`) / 시스템타입(`SYSTEM_TYPE`) 저장
  - DB 연결 테스트 (`test_db_connection`)
  - DB 무결성검사 (`run_db_integrity_check`)

## 5. 핵심 동작 규칙 (중요)

### 5.1 DB DDL 실행 조건
- `main.rs`의 `ensure_*` 함수들은 기본적으로 `is_db_integrity_check_mode()`가 `false`면 즉시 return한다.
- 즉, 일반 CRUD 커맨드 호출만으로는 테이블 생성/보정이 자동 실행되지 않는다.
- 신규 DB/초기 환경에서는 반드시 `run_db_integrity_check`를 먼저 실행해야 한다.

### 5.2 무결성검사 재실행이 안 되는 이유
- 무결성검사/예약 마이그레이션은 로컬 캐시 키로 1회 수행 후 스킵된다.
- 캐시 파일: `%LOCALAPPDATA%/GovDataManagement/migration_cache.json` (Windows)
- 스키마 변경 재검증이 필요하면 캐시 파일 정리 후 다시 검사한다.

### 5.3 store/system type 검증
- 기본값:
  - `store_code`: `HAIR_001`
  - `system_type_code`: `ALL`
- 기본값 외 코드는 공통코드에서 활성(`use_yn='Y'`) 상태여야 통과한다.
  - 점포 그룹: `STR_CD`
  - 시스템 타입 그룹: `SYSTEM_TYPE`

## 6. 요청 유형별 빠른 수정 프로세스

### 6.1 UI 문구/레이블 변경
1. 해당 페이지 TSX 수정
2. i18n 사용 중이면 `src/i18n/locales/{ko,en,zh}.json` 동시 수정
3. `npm run lint` + `npm run build`

### 6.2 기존 CRUD에 필드 1개 추가
1. 프론트 타입/폼/테이블 컬럼 수정
2. 프론트 payload 매핑 수정 (`invokeDbCommand` 전달값)
3. Rust payload/DTO 구조체 수정
4. Rust SQL(`SELECT/INSERT/UPDATE`) 수정
5. 필요 시 `ensure_*` DDL/ALTER 구문 수정
6. `cargo check` + `npm run lint` + `npm run build`

### 6.3 라우트/메뉴 신규 추가
1. 페이지 컴포넌트 생성
2. `src/App.tsx` 라우트 등록
3. 메뉴 DB 방식 유지 시 메뉴관리 데이터에 path 추가
4. 사이드바 아이콘 매핑 필요 시 `getIconByPath` 보강
5. 권한관리 화면 하드코딩 메뉴 트리도 함께 반영 필요 여부 확인

### 6.4 예약 상태/결제수단 추가
- 예약 상태:
  - 공통코드 `RESERVATION_STATUS`에 코드 추가
  - 필요 시 `ReservationCalendarPage.tsx`의 상태 색상 매핑 보강
- 결제수단:
  - 공통코드 `PAYMENT_METHOD` 추가
  - `SalesEntryPage.tsx`, `PointRechargePage.tsx`에서 표시/검증 로직 확인

### 6.5 점포 분기/시스템 타입 분기 수정
1. 시스템설정에서 저장 키(`activeStoreCode`, `activeSystemType`) 확인
2. `dbClient.ts`가 모든 커맨드에 `store_code`를 주입하는 흐름 확인
3. 메뉴/권한/데이터 조회가 점포코드 기준으로 동작하는지 확인

## 7. 증상별 즉시 점검표

### 7.1 "테이블이 없다" / CRUD 즉시 실패
- 원인 가능성: 무결성검사 미실행
- 조치:
  1. 시스템설정 > DB 무결성검사 실행
  2. 이미 완료 메시지인데 스키마 갱신이 안 되면 migration cache 확인

### 7.2 점포코드/시스템타입 오류
- 원인 가능성: 공통코드 미등록 또는 `use_yn='N'`
- 조치: 공통코드 그룹 `STR_CD`, `SYSTEM_TYPE` 활성 코드 확인

### 7.3 예약/정산 상태 저장 실패
- 원인 가능성: 허용 상태/결제수단/쿠폰 제약 위반
- 조치:
  - 예약: `RESERVATION_STATUS` 코드 유효성
  - 정산: `PAYMENT_METHOD`, `COUPON`의 `coupon_service_id`, `PREPAID`/`COUPON`의 회원 선택 조건

### 7.4 메뉴는 추가했는데 권한 화면에서 이상함
- 원인 가능성: 권한 화면 메뉴 트리 하드코딩
- 조치: `RoleManagementPage.tsx`의 메뉴 ID 분류 로직 수정

## 8. 검증 체크리스트 (반드시)

### 최소
```bash
npm run lint
npm run build
cd src-tauri && cargo check
```

### DB 관련 변경 시 추가
1. 시스템설정에서 DB 연결 테스트
2. 무결성검사 1회 실행
3. 해당 화면에서 조회/등록/수정/삭제 수동 확인

### 라우트/메뉴 변경 시 추가
1. 사이드바 노출 여부
2. 권한 화면에서 메뉴 권한 조작 가능 여부
3. 새로고침 후에도 유지되는지

## 9. 현재 리스크/기술부채

1. `src/config/dbConfig.ts`에 DB 접속정보가 하드코딩되어 있음
2. 상품/재고/구매/매출통계 페이지는 아직 Mock 데이터 기반
3. 권한관리 메뉴 트리 하드코딩으로 확장성 낮음
4. `window.location.href` 사용 지점 존재 (`StockManagementPage`)
5. 사용되지 않는 백엔드 커맨드 존재:
   - `sync_menu_management_to_db`
   - `sync_common_code_management_to_db`
   - `use_member_point`
   - `delete_sales_settlement`
6. 사용되지 않는 컴포넌트 파일 존재:
   - `src/components/AssetTable.tsx`
   - `src/components/StatCards.tsx`

## 10. 빠른 검색 명령 모음

```bash
# 전체 라우트 확인
rg -n "Route path" src/App.tsx

# 프론트에서 쓰는 DB 커맨드 찾기
rg -n "get_|upsert_|delete_|cancel_|recharge_" src/pages src/components

# 백엔드 등록 커맨드 목록
rg -n "generate_handler!\\[" src-tauri/src/main.rs

# 특정 도메인 테이블 생성 로직 위치
rg -n "ensure_.*table|CREATE TABLE IF NOT EXISTS" src-tauri/src/main.rs
```

## 11. 작업 요청 템플릿

아래 형식으로 요청받으면 처리 속도가 가장 빠르다.

```md
[요청 유형]
- UI/프론트/CRUD/DB/라우트 중 무엇인지

[대상 화면]
- 예: /users/reservations

[원하는 변경]
- 현재 동작:
- 변경 동작:

[검증 기준]
- 어떤 케이스에서 성공으로 볼지
```

## 12. 작업 로그 템플릿

```md
## YYYY-MM-DD 작업 기록
- 요청:
- 영향 범위:
- 수정 파일:
- 실행 명령:
- 검증 결과:
- 남은 이슈:
```

