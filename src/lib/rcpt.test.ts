import { parse } from "./rcpt";
import { readFile } from "node:fs/promises";
import test from "node:test";

await test("parse war", async () => {
  const path = new URL("../../assets/poem/themes/war.rcpt", import.meta.url);
  const source = await readFile(path, "utf8");
  const sections = parse(source);
  console.log(sections);
});
