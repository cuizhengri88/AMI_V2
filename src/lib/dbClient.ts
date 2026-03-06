import { invoke } from '@tauri-apps/api/core';
import { DB_CONNECTION, type DbConnectionConfig } from '../config/dbConfig';
import { normalizeStoreCode, STORE_CODE_STORAGE_KEY } from '../constants/store';

type BasePayload = Record<string, unknown>;

export async function invokeDbCommand<TResponse>(
  command: string,
  payload: BasePayload = {},
): Promise<TResponse> {
  const storeCode = normalizeStoreCode(localStorage.getItem(STORE_CODE_STORAGE_KEY));
  return invoke<TResponse>(command, {
    payload: {
      connection: DB_CONNECTION,
      store_code: storeCode,
      ...payload,
    },
  });
}

export async function invokeDbConnectionTest<TResponse>(
  connection: DbConnectionConfig = DB_CONNECTION,
): Promise<TResponse> {
  return invoke<TResponse>('test_db_connection', {
    payload: connection,
  });
}
