import { expect, it } from "vitest";
import { memoryMailer } from "./memory-mailer.ts";

it("keeps each mail sent, in order", async () => {
  const mailer = memoryMailer();
  const first = { to: "a@example.test", subject: "Code", text: "123456" };
  const second = { to: "b@example.test", subject: "Code", text: "654321" };
  expect(await mailer.sendMail(first)).toEqual({ ok: true, value: null });
  await mailer.sendMail(second);
  expect(mailer.sent).toEqual([first, second]);
});
