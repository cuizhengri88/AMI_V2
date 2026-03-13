import fs from 'node:fs';
import path from 'node:path';

/**
 * 버전 동기화 스크립트
 *
 * 목적:
 * - 버전의 단일 진실 공급원(Source of Truth)을 `package.json`으로 고정합니다.
 * - Tauri/Rust 관련 파일의 버전을 package.json 버전에 맞춰 자동 동기화합니다.
 *
 * 동기화 대상:
 * - src-tauri/tauri.conf.json   (Tauri 앱 버전)
 * - src-tauri/Cargo.toml        (Rust 패키지 버전)
 * - src-tauri/Cargo.lock        (잠금 파일의 govdata 패키지 버전)
 *
 * 설계 원칙:
 * - 파일이 실제로 달라질 때만 쓰기(write)합니다.
 * - 기존 파일의 개행 스타일(CRLF/LF)을 최대한 유지합니다.
 * - 실행 결과를 콘솔에 명확히 출력해 CI/로컬에서 추적 가능하게 합니다.
 */

// 현재 실행 디렉터리를 프로젝트 루트로 간주합니다.
const root = process.cwd();
// 각 동기화 대상 파일의 절대 경로를 미리 계산합니다.
const packageJsonPath = path.join(root, 'package.json');
const tauriConfPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(root, 'src-tauri', 'Cargo.toml');
const cargoLockPath = path.join(root, 'src-tauri', 'Cargo.lock');

/**
 * UTF-8 텍스트 파일을 읽어 문자열로 반환합니다.
 * @param {string} filePath - 읽을 파일 경로
 * @returns {string}
 */
function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * 파일의 개행 스타일을 감지합니다.
 * - Windows 스타일: \r\n
 * - Unix 스타일: \n
 *
 * 감지된 스타일은 다시 파일을 쓸 때 사용하여 불필요한 diff를 줄입니다.
 * @param {string} text
 * @returns {'\r\n' | '\n'}
 */
function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * 줄 단위 처리를 위해 텍스트를 정규화합니다.
 * - 맨 끝의 연속 개행을 제거하여 "매 실행마다 개행이 1줄씩 늘어나는 문제"를 방지합니다.
 * - 이후 CRLF/LF 구분 없이 라인 배열로 분리합니다.
 * @param {string} text
 * @returns {string[]}
 */
function toNormalizedLines(text) {
  const withoutTrailingEol = text.replace(/\r?\n+$/g, '');
  return withoutTrailingEol.split(/\r?\n/);
}

/**
 * 변경 사항이 있을 때만 파일을 씁니다.
 * - 내용이 동일하면 파일을 건드리지 않고 false 반환
 * - 내용이 다르면 파일을 저장하고 true 반환
 *
 * @param {string} filePath
 * @param {string} nextContent
 * @returns {boolean} 실제로 파일이 변경되었는지 여부
 */
function writeTextIfChanged(filePath, nextContent) {
  const current = readText(filePath);
  if (current === nextContent) {
    return false;
  }
  fs.writeFileSync(filePath, nextContent, 'utf8');
  return true;
}

/**
 * JSON 파일의 `version` 필드를 지정한 버전으로 맞춥니다.
 * - 현재는 tauri.conf.json 동기화에 사용합니다.
 * - 포맷은 2칸 들여쓰기로 통일합니다.
 *
 * @param {string} filePath
 * @param {string} version
 * @returns {boolean}
 */
function updateJsonVersion(filePath, version) {
  const original = readText(filePath);
  const eol = detectEol(original);
  const parsed = JSON.parse(original);
  parsed.version = version;
  const next = `${JSON.stringify(parsed, null, 2)}${eol}`;
  return writeTextIfChanged(filePath, next);
}

/**
 * Cargo.toml의 [package] 섹션에 있는 version 값을 교체합니다.
 *
 * 처리 방식:
 * 1) [package] 섹션 진입 여부를 추적
 * 2) 해당 섹션의 첫 번째 `version = ...` 줄을 찾아 교체
 * 3) 찾지 못하면 명시적으로 예외를 던져 설정 문제를 빠르게 드러냄
 *
 * @param {string} filePath
 * @param {string} version
 * @returns {boolean}
 */
function updateCargoTomlVersion(filePath, version) {
  const original = readText(filePath);
  const eol = detectEol(original);
  const lines = toNormalizedLines(original);
  let inPackage = false;
  let replaced = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === '[package]') {
      inPackage = true;
      continue;
    }
    if (line.startsWith('[') && line !== '[package]') {
      inPackage = false;
    }
    if (inPackage && /^version\s*=/.test(line)) {
      lines[i] = `version = "${version}"`;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    throw new Error('Could not find [package].version in Cargo.toml');
  }

  const next = `${lines.join(eol)}${eol}`;
  return writeTextIfChanged(filePath, next);
}

/**
 * Cargo.lock 안에서 특정 패키지의 버전을 교체합니다.
 *
 * 주의:
 * - Cargo.lock은 여러 패키지 블록([[package]])으로 구성됩니다.
 * - 여기서는 `name = "govdata"` 블록을 찾아 그 블록의 version만 수정합니다.
 * - Cargo.lock 파일이 없는 환경도 있으므로 존재 여부를 먼저 검사합니다.
 *
 * @param {string} filePath
 * @param {string} packageName - 예: "govdata"
 * @param {string} version
 * @returns {boolean}
 */
function updateCargoLockVersion(filePath, packageName, version) {
  if (!fs.existsSync(filePath)) return false;

  const original = readText(filePath);
  const eol = detectEol(original);
  const lines = toNormalizedLines(original);
  let updated = false;

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== `name = "${packageName}"`) continue;

    for (let j = i + 1; j < lines.length; j += 1) {
      const trimmed = lines[j].trim();
      if (trimmed === '[[package]]') break;
      if (trimmed.startsWith('version = ')) {
        lines[j] = `version = "${version}"`;
        updated = true;
        break;
      }
    }
    break;
  }

  if (!updated) return false;

  const next = `${lines.join(eol)}${eol}`;
  return writeTextIfChanged(filePath, next);
}

/**
 * 메인 실행 함수
 *
 * 흐름:
 * 1) package.json에서 기준 버전을 읽음
 * 2) 대상 파일들의 version 값을 기준 버전으로 동기화
 * 3) 변경 파일 목록을 사람이 읽기 쉬운 형태로 출력
 */
function main() {
  // 기준 버전은 package.json의 version입니다.
  const packageJson = JSON.parse(readText(packageJsonPath));
  const version = packageJson.version;
  if (!version || typeof version !== 'string') {
    throw new Error('package.json version is missing or invalid');
  }

  // 실제로 변경된 파일만 모아 마지막에 요약 출력합니다.
  const changedFiles = [];

  if (updateJsonVersion(tauriConfPath, version)) {
    changedFiles.push('src-tauri/tauri.conf.json');
  }
  if (updateCargoTomlVersion(cargoTomlPath, version)) {
    changedFiles.push('src-tauri/Cargo.toml');
  }
  if (updateCargoLockVersion(cargoLockPath, 'govdata', version)) {
    changedFiles.push('src-tauri/Cargo.lock');
  }

  if (changedFiles.length === 0) {
    console.log(`[sync-version] already aligned: ${version}`);
    return;
  }

  console.log(`[sync-version] synced to ${version}`);
  for (const file of changedFiles) {
    console.log(`[sync-version] updated ${file}`);
  }
}

// 스크립트 진입점
main();
