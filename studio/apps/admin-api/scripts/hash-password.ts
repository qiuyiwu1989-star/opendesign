import { randomBytes, scrypt } from "node:crypto";
import { stdin, stdout } from "node:process";

if (!stdin.isTTY || !stdout.isTTY) throw new Error("Run this command in an interactive terminal");

async function hidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      for (const text of chunk.toString("utf8")) {
        if (text === "\u0003") process.exit(130);
        if (text === "\r" || text === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (text === "\u007f") value = value.slice(0, -1);
        else if (!/[\u0000-\u001f]/u.test(text)) value += text;
      }
    };
    stdin.on("data", onData);
  }).finally(() => {
    stdin.setRawMode(false);
    stdin.pause();
  });
}

const password = await hidden("Choose a new Admin password (input hidden): ");
const confirmation = await hidden("Confirm password (input hidden): ");
if (password !== confirmation) throw new Error("Passwords do not match");
if (password.length < 14 || !/[A-Za-z]/u.test(password) || !/\d/u.test(password) || !/[^A-Za-z0-9]/u.test(password)) {
  throw new Error("Use at least 14 characters with letters, numbers, and a symbol");
}
const salt = randomBytes(16);
const digest = await new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 32, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
stdout.write(`ADMIN_API_PASSWORD_HASH=scrypt$32768$8$1$${salt.toString("base64url")}$${digest.toString("base64url")}\n`);
