export type DbConnectionConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  schema: string;
};

export const DB_CONNECTION: DbConnectionConfig = {
  host: '103.127.242.233',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: '12qwaszx',
  schema: 'czr_ami',
};
