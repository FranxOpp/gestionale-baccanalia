import postgres from "postgres";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL non configurata");
export const sql = postgres(connectionString, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 15 });
