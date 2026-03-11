# GovDataManagement 프로젝트 개선 TODO

기준: 현재 코드베이스 점검 결과  
범위: **코드 수정 없이 분석한 개선 과제 정리**  
목표: 기능 추가 전에 **안정성 / 보안 / 유지보수성 / 확장성** 확보

---

# 1. 전체 요약

현재 프로젝트는 다음 특징을 가짐:

- Tauri + React + TypeScript + PostgreSQL 기반 업무용 데스크톱 앱
- 회원/직원/예약/포인트/정산/메뉴/권한/공통코드 등 주요 기능 구현 진행
- 일부 화면은 실제 DB 연동, 일부는 Mock 기반
- 빌드와 Rust 체크는 성공
- 다만 보안, 구조, 유지보수성 측면의 기술부채가 큼

---

# 2. 최우선 개선 항목 (P0)

## P0-1. DB 접속정보 하드코딩 제거
### 현재 문제
- `src/config/dbConfig.ts`에 DB host / port / username / password / schema가 하드코딩됨
- 프론트 코드에서 직접 DB 접속정보를 알고 있음

### 리스크
- 민감정보 유출 위험
- 환경(dev/staging/prod) 분리 어려움
- 운영 시 접속정보 변경이 번거로움

### 개선 목표
- DB 접속정보를 코드에서 제거
- Tauri 백엔드 또는 안전한 환경설정 방식으로 이전
- 최소한 `.env` 또는 OS 보안 저장소 기반 관리

### TODO
- [ ] `src/config/dbConfig.ts` 하드코딩 제거
- [ ] 프론트에서 직접 password를 들고 있지 않도록 구조 변경
- [ ] 환경별 설정 전략 정의
- [ ] 운영/개발 설정 분리

---

## P0-2. TypeScript 검사 경로 정리
### 현재 문제
- `npm run lint` 실행 시 `src-tauri/target/...` 생성 파일까지 TS가 읽어서 오류 발생
- 문서상 lint 성공이라고 되어 있으나 실제 상태와 불일치

### 리스크
- CI 실패 가능
- 팀원 혼란
- 실제 타입 에러와 환경 잡음 구분 어려움

### 개선 목표
- TS 검사 대상을 명확히 제한
- lint / build / cargo check 상태를 실제와 일치시킴

### TODO
- [ ] `tsconfig.json`에 `exclude` 추가
  - [ ] `src-tauri/target`
  - [ ] `dist`
  - [ ] `node_modules`
- [ ] 필요 시 `include` 명시
- [ ] `PROJECT_GUIDE.md`의 실행/검증 상태 최신화

---

# 3. 구조 개선 항목 (P1)

## P1-1. 대형 페이지 컴포넌트 분리
### 현재 문제
다음 페이지 파일이 너무 큼:
- `ReservationCalendarPage.tsx`
- `SalesEntryPage.tsx`
- `RoleManagementPage.tsx`

### 리스크
- 수정 시 영향 범위 파악 어려움
- 테스트 어려움
- 재사용 불가
- 버그 가능성 증가

### 개선 목표
- 화면 / 상태 / 유틸 / 타입 / 하위 컴포넌트 분리

### TODO
#### ReservationCalendarPage
- [ ] `ReservationCalendarGrid`
- [ ] `ReservationListView`
- [ ] `ReservationModal`
- [ ] `reservation.types.ts`
- [ ] `reservation.utils.ts`
- [ ] `useReservationData.ts`

#### SalesEntryPage
- [ ] `SalesSettlementModal`
- [ ] `PaymentSection`
- [ ] `ReservationSelector`
- [ ] `sales.types.ts`
- [ ] `sales.utils.ts`
- [ ] `useSalesData.ts`

#### RoleManagementPage
- [ ] `RoleListPanel`
- [ ] `PermissionTree`
- [ ] `RoleEditModal`
- [ ] `role.types.ts`
- [ ] `role.utils.ts`

---

## P1-2. Rust `main.rs` 분리
### 현재 문제
- `src-tauri/src/main.rs`에 command, DTO, DB 로직, migration 로직이 집중됨

### 리스크
- 파일 탐색 어려움
- 변경 충돌 증가
- 유지보수성 저하
- 테스트 곤란

### 개선 목표
- 도메인별 모듈 분리
- command / db / model / migration 책임 분리

### TODO
- [ ] `commands/menu.rs`
- [ ] `commands/common_code.rs`
- [ ] `commands/user.rs`
- [ ] `commands/employee.rs`
- [ ] `commands/reservation.rs`
- [ ] `commands/sales.rs`
- [ ] `db/connection.rs`
- [ ] `db/migrations.rs`
- [ ] `models/*.rs`
- [ ] `main.rs`는 앱 초기화 + command 등록만 담당하도록 축소

---

# 4. 확장성 개선 항목 (P1~P2)

## P1-3. 프론트/도메인 결합도 낮추기
### 현재 문제
- 프론트에서 DB 코드값, fallback 상태, 그룹 ID 등을 직접 많이 알고 있음

### 리스크
- 스키마 변경 시 프론트 영향 큼
- 규칙이 여기저기 흩어짐
- 유지보수 어려움

### 개선 목표
- 프론트는 화면 DTO 중심
- 도메인 규칙은 Rust/Tauri 백엔드 쪽에 집중

### TODO
- [ ] 공통코드 그룹명 상수 정리
- [ ] 상태 변환 로직 공통화
- [ ] 프론트 내부 fallback 코드 최소화
- [ ] 화면 모델 DTO와 DB 모델 분리

---

## P1-4. fallback 하드코딩 정리
### 현재 문제
- 예약 상태, 결제수단, 카테고리, 메뉴 등 여러 곳에 fallback 상수 존재

### 리스크
- 설정 누락을 UI가 숨김
- 운영 이슈 발견 늦어짐
- 데이터 품질 저하

### 개선 목표
- 운영 모드에서는 fallback 의존 줄이기
- 누락 시 경고/에러를 더 명확히

### TODO
- [ ] 공통코드 누락 시 경고 메시지 기준 정의
- [ ] 개발 모드 fallback / 운영 모드 strict 처리 검토
- [ ] 시스템 설정에 코드 상태 점검 기능 검토

---

# 5. 성능 개선 항목 (P2)

## P2-1. 라우트 코드 스플리팅
### 현재 문제
- 번들 크기 큼 (`index.js` 약 1.3MB 이상)
- 모든 페이지가 초기 로딩에 포함될 가능성 큼

### 리스크
- 초기 로딩 느림
- 메모리 사용량 증가
- 유지보수 시 번들 증가 지속

### 개선 목표
- 페이지 단위 lazy loading 적용
- 관리 화면 지연 로딩

### TODO
- [ ] `React.lazy()` 적용
- [ ] `Suspense` 기반 라우트 구성
- [ ] 자주 안 쓰는 시스템 관리 화면 분리
- [ ] 차트 페이지 분리 로딩 검토

---

## P2-2. 큰 화면 렌더링 최적화
### 현재 문제
- 예약/정산 화면은 상태와 계산 로직이 많아 렌더 비용이 클 가능성 있음

### 개선 목표
- 계산 memoization
- 하위 컴포넌트 분리
- 필요 시 virtualization 검토

### TODO
- [ ] 불필요한 재렌더 지점 점검
- [ ] 파생값 `useMemo` 정리
- [ ] 이벤트 핸들러 `useCallback` 점검
- [ ] 대형 리스트 최적화 검토

---

# 6. 일관성 개선 항목 (P2)

## P2-3. 라우트 명명 규칙 통일
### 현재 문제
- 같은 페이지가 여러 경로 형식으로 존재
  - `/hair_sales-stats`
  - `/Hair_sales-stats`
  - `/hair-sales-stats`

### 리스크
- 경로 관리 혼란
- 메뉴/권한/링크 불일치 가능성
- 유지보수 비용 증가

### 개선 목표
- canonical route 1개만 유지
- 나머지는 redirect 처리

### TODO
- [ ] 라우트 네이밍 규칙 정의 (`kebab-case` 권장)
- [ ] 중복 경로 정리
- [ ] 메뉴 path 값과 라우트 기준 일치화

---

## P2-4. Mock / Live 기능 경계 명확화
### 현재 문제
- 일부 화면은 Mock, 일부는 Live인데 사용자/개발자 입장에서 혼동 가능

### 개선 목표
- 기능 완성도 상태를 명확히
- 연동 우선순위 정리

### TODO
- [ ] Mock 화면 목록 명확화
- [ ] Live 전환 우선순위 정의
- [ ] 필요 시 화면 내 배지/개발 플래그 표시 검토

---

# 7. 문서 개선 항목 (P2)

## P2-5. `PROJECT_GUIDE.md` 최신화
### 현재 문제
- 일부 검증 상태가 실제와 다름
- 현재 구조와 가이드가 일부 어긋날 수 있음

### 개선 목표
- 문서와 실제 프로젝트 상태 일치

### TODO
- [ ] lint/build/check 결과 최신화
- [ ] 실제 리스크 항목 갱신
- [ ] Mock/Live 상태 재점검
- [ ] 신규 리팩터링 구조 반영

---

# 8. 추천 실행 순서

## 1단계: 안정화
- [ ] DB 접속정보 하드코딩 제거
- [ ] tsconfig 정리
- [ ] lint/build/check 기준 정상화
- [ ] 문서 최신화

## 2단계: 구조 개선
- [ ] 큰 페이지 컴포넌트 분리
- [ ] Rust `main.rs` 모듈화

## 3단계: 확장성 개선
- [ ] fallback 정리
- [ ] 공통 DTO/타입 구조 정비
- [ ] 라우트 일관화

## 4단계: 성능 개선
- [ ] 라우트 lazy loading
- [ ] 큰 화면 렌더링 최적화

---

# 9. 바로 작업하면 좋은 체크리스트

## 보안
- [ ] DB password 제거
- [ ] 환경설정 분리
- [ ] 민감정보 저장 방식 검토

## 품질
- [ ] TS 검사 정상화
- [ ] build/lint/check 결과 일치화
- [ ] 문서 최신화

## 구조
- [ ] 페이지 분리
- [ ] Rust 모듈 분리

## 성능
- [ ] lazy import
- [ ] chunk 분리
- [ ] 무거운 리스트/차트 최적화

---

# 10. 결론
이 프로젝트는 기능 기반은 꽤 잘 잡혀 있지만,  
지금부터는 **기능 추가보다 구조 정리**가 더 중요합니다.

특히 핵심은 아래 5개예요:

1. **DB 접속정보 하드코딩 제거**
2. **tsconfig 정리로 lint 정상화**
3. **거대 페이지 분리**
4. **Rust main.rs 분리**
5. **fallback / 라우트 일관성 정리**

이 다섯 개만 정리해도 프로젝트의 안정성과 확장성이 확 올라갈 거예요.
