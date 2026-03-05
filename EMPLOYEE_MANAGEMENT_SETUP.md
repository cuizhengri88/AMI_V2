# 직원 관리 시스템 설정 가이드

## 개요
직원 관리 시스템은 데이터베이스 연결을 통해 직원 정보를 CRUD(Create, Read, Update, Delete) 기능으로 관리합니다.

## 구현 내용

### 1. 데이터베이스 테이블
**파일**: `src-tauri/sql/employee_management.sql`

```sql
CREATE TABLE IF NOT EXISTS czr_ami.employee_management (
  employee_id SERIAL PRIMARY KEY,
  employee_name VARCHAR(100) NOT NULL,
  employee_code VARCHAR(50) UNIQUE NOT NULL,
  department VARCHAR(100),
  position VARCHAR(100),
  email VARCHAR(100) UNIQUE NOT NULL,
  phone VARCHAR(20),
  hire_date DATE,
  status VARCHAR(20) DEFAULT '재직중',
  remarks TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**주요 필드**:
- `employee_id`: 직원 고유 ID (자동 증가)
- `employee_name`: 직원명 (필수)
- `employee_code`: 직원 코드 (필수, 중복 불가)
- `department`: 부서
- `position`: 직급
- `email`: 이메일 (필수, 중복 불가)
- `phone`: 전화번호
- `hire_date`: 입사일
- `status`: 상태 (재직중, 휴직, 퇴직)
- `remarks`: 비고

### 2. Rust 백엔드 핸들러
**파일**: `src-tauri/src/main.rs`

#### 데이터 구조
```rust
struct EmployeePayload {
    employee_id: Option<i32>,
    employee_name: String,
    employee_code: String,
    department: Option<String>,
    position: Option<String>,
    email: String,
    phone: Option<String>,
    hire_date: Option<String>,
    status: Option<String>,
    remarks: Option<String>,
}

struct EmployeeDto {
    employee_id: i32,
    employee_name: String,
    employee_code: String,
    department: Option<String>,
    position: Option<String>,
    email: String,
    phone: Option<String>,
    hire_date: Option<String>,
    status: Option<String>,
    remarks: Option<String>,
}
```

#### CRUD 명령어

**1. 조회 (READ)**
```rust
#[tauri::command]
async fn get_employee_management_data(payload: EmployeeQueryPayload) 
  -> Result<EmployeeDataResult, String>
```
- 모든 직원 정보 조회
- 최신 등록 순서로 정렬

**2. 추가/수정 (CREATE/UPDATE)**
```rust
#[tauri::command]
async fn upsert_employee_management(payload: UpsertEmployeePayload) 
  -> Result<MutationResult, String>
```
- `employee_id`가 없으면 새로운 직원 추가
- `employee_id`가 있으면 기존 직원 정보 수정
- 필수 필드: 직원명, 직원코드, 이메일

**3. 삭제 (DELETE)**
```rust
#[tauri::command]
async fn delete_employee_management(payload: DeleteEmployeePayload) 
  -> Result<MutationResult, String>
```
- 직원 ID로 직원 정보 삭제

### 3. TypeScript 프론트엔드
**파일**: `src/pages/UserManagement/EmployeeManagementPage.tsx`

#### 주요 기능
- **조회**: 모든 직원 정보 테이블 표시
- **검색**: 직원명, 직원코드, 이메일로 검색
- **추가**: 모달 폼으로 새 직원 추가
- **수정**: 기존 직원 정보 수정
- **삭제**: 직원 정보 삭제 (확인 필수)
- **DB 새로고침**: 데이터베이스에서 최신 정보 로드

#### 테이블 컬럼
| 컬럼 | 설명 |
|------|------|
| ID | 직원 고유 ID |
| 직원명 | 직원 이름 |
| 직원코드 | 직원 코드 |
| 부서 | 부서명 |
| 직급 | 직급 |
| 이메일 | 이메일 주소 |
| 전화 | 전화번호 |
| 입사일 | 입사 날짜 |
| 상태 | 재직중/휴직/퇴직 |
| 작업 | 수정/삭제 버튼 |

#### 모달 폼 필드
- **직원명** (필수)
- **직원코드** (필수)
- **이메일** (필수)
- **부서** (선택)
- **직급** (선택)
- **전화번호** (선택)
- **입사일** (선택)
- **상태** (선택, 기본값: 재직중)
- **비고** (선택)

## 사용 방법

### 1. 직원 추가
1. "직원 추가" 버튼 클릭
2. 필수 정보 입력 (직원명, 직원코드, 이메일)
3. 선택 정보 입력
4. "저장" 버튼 클릭

### 2. 직원 정보 수정
1. 테이블에서 수정할 직원의 "수정" 버튼 클릭
2. 정보 수정
3. "저장" 버튼 클릭

### 3. 직원 삭제
1. 테이블에서 삭제할 직원의 "삭제" 버튼 클릭
2. 확인 대화상자에서 "확인" 클릭

### 4. 직원 검색
1. 검색 입력창에 직원명, 직원코드, 또는 이메일 입력
2. 실시간으로 필터링된 결과 표시

## 기술 스택

- **백엔드**: Rust + Tauri + tokio-postgres
- **프론트엔드**: React + TypeScript + Tailwind CSS
- **데이터베이스**: PostgreSQL
- **상태 관리**: React Hooks
- **애니메이션**: Framer Motion

## 주요 특징

✅ 완전한 CRUD 기능
✅ 실시간 검색 필터링
✅ 드래그 가능한 모달
✅ 로딩 상태 표시
✅ 에러 처리
✅ 한국어 UI
✅ 반응형 디자인
✅ 데이터 유효성 검사

## 파일 구조

```
src-tauri/
├── sql/
│   └── employee_management.sql
└── src/
    └── main.rs (employee 관련 함수 추가)

src/
└── pages/
    └── UserManagement/
        └── EmployeeManagementPage.tsx
```

## 다음 단계

1. 라우팅에 EmployeeManagementPage 추가
2. 메뉴에 직원 관리 메뉴 항목 추가
3. 필요시 권한 관리 설정
4. 테스트 및 배포
