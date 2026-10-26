import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

let db: PGlite;
// WASM/PostgreSQL の起動は DB テスト共通のセットアップ。5秒のテスト本体には含めない。
beforeAll(async () => {
	db = await PGlite.create();
}, 60_000);
afterAll(async () => {
	await db?.close();
});

it("ignores checkout line endings in function hashes while still detecting changed SQL", async () => {
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

	// PG18 で増えた NOT NULL の制約行に頼らず、PG17 と同じ列の事実で必須性を検査する。
	await db.exec("create table public.inventory_nullability(required integer not null)");
	const columnFacts = async () =>
		(await db.query<{ line: string }>(inventory)).rows.map(({ line }) => line);
	const required = await columnFacts();
	expect(required).toContain("COLUMN inventory_nullability.required integer null=NO default=-");
	expect(
		required.some(
			(line) => line.startsWith("CONSTRAINT inventory_nullability ") && line.includes("NOT NULL"),
		),
	).toBe(false);
	await db.exec("alter table public.inventory_nullability alter column required drop not null");
	expect(await columnFacts()).toContain(
		"COLUMN inventory_nullability.required integer null=YES default=-",
	);
});
