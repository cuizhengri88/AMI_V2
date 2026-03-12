export type DbConnectionConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  schema: string;
};

export const DB_CONNECTION: DbConnectionConfig = {
  host: import.meta.env.VITE_DB_HOST || 'localhost',
  port: parseInt(import.meta.env.VITE_DB_PORT || '5432'),
  database: import.meta.env.VITE_DB_NAME || 'postgres',
  username: import.meta.env.VITE_DB_USER || 'postgres',
  password: import.meta.env.VITE_DB_PASSWORD || '',
  schema: import.meta.env.VITE_DB_SCHEMA || 'public',
};
