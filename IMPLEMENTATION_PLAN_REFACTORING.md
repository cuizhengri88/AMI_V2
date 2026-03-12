# 🛠️ 프로젝트 리팩터링 및 구조 개선 실행 계획

본 문서는 `PROJECT_IMPROVEMENT_TODO.md`에서 진단된 주요 기술 부채를 해결하기 위한 단계별 실행 계획을 담고 있습니다.

## 📅 단계별 목표 

| 단계 | 목표 | 우선순위 | 기대 효과 |
| :--- | :--- | :--- | :--- |
| **1단계** | 보안 및 환경 최적화 | **P0** | 민감정보 보호 및 빌드 안정성 확보 |
| **2단계** | 백엔드 모듈 구조 정규화 | **P1** | Rust 코드 가시성 및 컴파일 효율 향상 |
| **3단계** | 거대 페이지 리팩터링 | **P1** | 유지보수성, 가독성, 재사용성 극대화 |
| **4단계** | 퍼포먼스 최적화 | **P2** | 초기 로딩 속도 및 사용자 경험 개선 |

---

## 🏗️ 세부 작업 내용

### 1. 보안 및 기초 환경 개선 (P0)
- **DB 접속정보 하드코딩 제거**
    - [ ] `.env` 파일 도입 (Vite 환경 변수 활용)
    - [ ] `src/config/dbConfig.ts`를 환경 변수 참조 방식으로 변경
- **TypeScript 설정 보정**
    - [ ] `tsconfig.json`의 `exclude` 항목에 `src-tauri/target`, `dist` 등 추가

### 2. Rust 백엔드 모듈화 (P1)
- **`include!` 방식 탈피 및 `mod` 구조 전환**
    - [ ] `src-tauri/src/app/mod.rs`에서 `include!` 매크로 제거
    - [ ] 각 파일(`.rs`)을 독립된 모듈로 선언 및 `pub use` 등으로 가시성 조정
    - [ ] `main.rs`의 앱 초기화 로직 점검

### 3. 거대 페이지 컴포넌트 분리 (P1)
- **`ReservationCalendarPage` 리팩터링 (2,780줄 → 분산 추출)**
    - [ ] `src/pages/UserManagement/Reservation/` 관련 하위 폴더 및 파일 추출
- **`SalesEntryPage` 리팩터링 (2,263줄 → 분산 추출)**
    - [ ] `src/pages/UserManagement/Sales/` 관련 하위 폴더 및 파일 추출

### 4. 성능 및 일관성 개선 (P2)
- **라우트 코드 스플리팅 적용**
    - [ ] `App.tsx`에서 `React.lazy()` 및 `Suspense` 적용
    - [ ] 중복 경로 정리

---
