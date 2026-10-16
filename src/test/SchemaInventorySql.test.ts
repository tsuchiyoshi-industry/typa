import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("ignores checkout line endings in function hashes while still detecting changed SQL", async () => {
	const db = new PGlite();
	try {
		await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create role supabase_auth_admin;
      create schema auth;
      create table auth.users(id uuid);
    `);
		const inventory = readFileSync(
			new URL("../../security/schema-inventory.sql", import.meta.url),
			"utf8",
		);
		const functionFact = async (body: string) => {
			await db.exec(
				`create or replace function public.inventory_line_endings() returns integer language sql as $$${body}$$;`,
			);
			const { rows } = await db.query<{ line: string }>(inventory);
			const fact = rows.find(({ line }) => line.startsWith("FUNCTION inventory_line_endings() "));
			expect(fact).toBeDefined();
			return fact?.line;
		};
		const windows = await functionFact("\r\nselect 1;\r\n");
		expect(await functionFact("\nselect 1;\n")).toBe(windows);
		expect(await functionFact("\nselect 2;\n")).not.toBe(windows);
	} finally {
		await db.close();
	}
});
