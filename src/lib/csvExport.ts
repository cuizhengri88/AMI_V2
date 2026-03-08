import { invoke } from '@tauri-apps/api/core';

export type CsvCell = string | number | boolean | null | undefined;

type DownloadCsvOptions = {
  filename: string;
  headers: CsvCell[];
  rows: CsvCell[][];
  includeBom?: boolean;
};

type TauriExportTextFileResult = {
  success: boolean;
  cancelled: boolean;
  message: string;
  output_path: string | null;
  bytes: number;
};

export type CsvDownloadResult = {
  success: boolean;
  method: 'tauri' | 'browser' | 'none';
  cancelled?: boolean;
  outputPath?: string;
  message?: string;
  error?: string;
};

function escapeCsvCell(value: CsvCell) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function buildCsvContent(lines: CsvCell[][], includeBom = true) {
  const content = lines.map((line) => line.map(escapeCsvCell).join(',')).join('\n');
  return includeBom ? `\uFEFF${content}` : content;
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function trySaveViaTauri(filename: string, content: string) {
  if (!isTauriRuntime()) return null;

  try {
    const result = await invoke<TauriExportTextFileResult>('export_text_file', {
      payload: {
        file_name: filename,
        content,
        sub_dir: 'GovDataExports',
      },
    });
    return result;
  } catch (error) {
    console.error('Tauri file export failed:', error);
    return null;
  }
}

function downloadByBrowser(filename: string, content: string, mimeType: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Delay URL revocation for better compatibility with embedded webviews.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function downloadTextFile(filename: string, content: string, mimeType: string): Promise<CsvDownloadResult> {
  if (isTauriRuntime()) {
    const tauriResult = await trySaveViaTauri(filename, content);
    if (!tauriResult) {
      return {
        success: false,
        method: 'tauri',
        error: 'tauri_export_failed',
      };
    }

    if (tauriResult.success) {
      return {
        success: true,
        method: 'tauri',
        outputPath: tauriResult.output_path || undefined,
        message: tauriResult.message,
      };
    }

    return {
      success: false,
      cancelled: tauriResult.cancelled,
      method: 'tauri',
      message: tauriResult.message,
      error: tauriResult.cancelled ? 'cancelled' : 'tauri_export_failed',
    };
  }

  const browserSaved = downloadByBrowser(filename, content, mimeType);
  if (browserSaved) {
    return {
      success: true,
      method: 'browser',
    };
  }

  return {
    success: false,
    method: 'none',
    error: 'download_unavailable',
  };
}

export async function downloadCsvFile({
  filename,
  headers,
  rows,
  includeBom = true,
}: DownloadCsvOptions): Promise<CsvDownloadResult> {
  const csv = buildCsvContent([headers, ...rows], includeBom);
  return downloadTextFile(filename, csv, 'text/csv;charset=utf-8;');
}
