import { invoke } from '@tauri-apps/api/core';
import { DB_CONNECTION, type DbConnectionConfig } from '../config/dbConfig';

type BasePayload = Record<string, unknown>;

export async function invokeDbCommand<TResponse>(
  command: string,
  payload: BasePayload = {},
): Promise<TResponse> {
  return invoke<TResponse>(command, {
    payload: {
      connection: DB_CONNECTION,
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
