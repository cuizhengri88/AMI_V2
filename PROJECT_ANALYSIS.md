# GovDataManagement 프로젝트 분석 문서

- 작성일: 2026-03-05
- 분석 범위: `src/`, `src-tauri/`, 빌드/타입체크 설정, i18n 리소스, 실행 스크립트

## 1. 프로젝트 요약

본 프로젝트는 **Tauri + React + Vite + TypeScript** 기반의 데스크톱 앱 형태이며, 현재는 백엔드 연동 없이 **프론트엔드 중심의 관리 콘솔 프로토타입**에 가깝다.

- 주요 도메인: 상품/재고, 주문, 회원/직원, 시스템(메뉴/코드/권한/설정)
- UI 특성: 모달/애니메이션 중심, 더미 데이터 기반 CRUD 체험형 화면
- i18n: `ko/en/zh` 리소스 존재, 일부 화면만 번역 완전 적용

## 2. 기술 스택 및 구성

### 프론트엔드

- React 19, React Router 7
- Vite 6
- Tailwind CSS 4
- i18next + react-i18next
- Recharts (매출 통계 차트)
- Lucide 아이콘, Motion 애니메이션

### 데스크톱 쉘(Tauri)

- Rust(Tauri 2) 기본 부트스트랩 상태
- `src-tauri/src/main.rs`는 기본 `Builder::default().run(...)`만 존재
- 커스텀 커맨드/IPC/API 브릿지 미구현

## 3. 디렉토리 관찰

- `src/`: 라우팅, 레이아웃, 페이지 컴포넌트(도메인별 분리)
- `src-tauri/`: Tauri 설정 및 아이콘/권한 스키마
- `dist/`: 프론트 빌드 결과물
- `src-tauri/target/`: Rust 빌드 산출물(로컬 생성)

## 4. 라우팅 및 화면 구조

`App.tsx` 기준으로 `DashboardLayout` 하위에 11개 주요 화면이 연결되어 있다.

- 상품: 상품관리, 재고관리, 재고이력
- 주문/매출: 구매관리, 매출통계
- 사용자: 회원관리, 직원관리
- 시스템: 메뉴관리, 공통코드관리, 권한관리, 시스템설정

## 5. 기능 성숙도 평가

### 구현되어 있는 것

- 화면/레이아웃 구조 및 내비게이션
- 각 도메인별 테이블/폼/모달 UX
- 일부 클라이언트 상태 기반 CRUD 동작
- 다국어 전환 UI(사이드바) 및 리소스 파일

### 미구현/부분구현

- 실제 DB/서버 연동
- Tauri 커맨드 및 Rust 비즈니스 로직
- 인증/인가(실제 권한 검증)
- 영속 저장(대부분 메모리 상태, 일부만 `localStorage`)
- 테스트 코드(단위/통합/E2E)

## 6. 품질 점검 결과

### 빌드

- `npm run build`: 성공
- 경고: 단일 번들 청크가 큼(`~986KB`) -> 코드 스플리팅 필요

### 타입체크

- `npm run lint`(`tsc --noEmit`): 실패
- 실패 원인: `src-tauri/target/.../tauri-codegen-assets/*.js`(바이너리 성격 파일)가 TS 검사 범위에 포함됨
- 결론: 프론트 코드 자체라기보다 **TS include/exclude 경계 설정 문제**

## 7. 핵심 이슈(우선순위)

### High

1. 타입체크 파이프라인 불안정  
   - `tsconfig.json`에 `exclude`가 없어 Rust 산출물까지 검사됨
2. 번역 키 누락  
   - `MenuManagementPage`에서 사용하는 `common.path`, `common.order` 키가 locale에 없음
3. 실데이터 부재  
   - 업무 로직이 전부 더미 상태 기반이라 운영 전환 불가

### Medium

1. 다국어 적용 불균형  
   - 일부 페이지는 `t()` 사용, 다수 페이지는 한국어 하드코딩
2. 런타임 UX 비일관성  
   - 일부 이동에 `window.location.href` 사용(React Router 흐름 이탈)
3. 보안 기본값 완화  
   - `tauri.conf.json`의 `app.security.csp`가 `null`

### Low

1. 의존성 정리 필요  
   - `@google/genai`, `express`, `better-sqlite3`, `dotenv`, `@types/express` 사용 흔적 없음
2. 스크립트 이식성  
   - `package.json`의 `clean`이 `rm -rf`로 Windows 친화적이지 않음
3. 문서 불일치  
   - `README.md` 내용이 현재 앱 목적/구조와 불일치(AI Studio 템플릿 잔재)

## 8. 개선 권장 로드맵

### 1단계 (즉시, 1~2일)

- `tsconfig.json`에 `exclude` 추가  
  - `node_modules`, `dist`, `src-tauri/target`, `src-tauri/gen`
- locale에 `common.path`, `common.order` 추가
- `window.location.href` -> `useNavigate` 전환
- `README.md`를 현재 프로젝트 기준으로 재작성

### 2단계 (단기, 3~7일)

- API 계층 추상화(서비스/리포지토리 분리)
- 화면별 더미 데이터 제거 및 공통 상태관리 도입
- 알림/검증 메시지 i18n 전면 적용
- 번들 분할(Route-level lazy loading)로 초기 청크 축소

### 3단계 (중기)

- Tauri 커맨드 설계 및 Rust 백엔드 연동
- DB(예: SQLite) 스키마/마이그레이션 체계화
- 권한 모델을 UI 토글이 아닌 정책 기반으로 고도화
- 테스트 파이프라인 구축(Unit + E2E)

## 9. 최종 평가

현재 코드는 **UI 프로토타입 완성도는 높지만**, 데이터/권한/검증/배포 관점의 운영 준비도는 낮다.  
운영형 제품으로 전환하려면 우선 **타입체크 경계 정리, i18n 누락 보완, 데이터 연동 설계**를 먼저 해결하는 것이 가장 효율적이다.

