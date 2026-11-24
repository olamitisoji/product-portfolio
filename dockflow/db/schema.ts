import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const analystQuota = sqliteTable("analyst_quota", {
  day: text("day").primaryKey(),
  requests: integer("requests").notNull(),
});
