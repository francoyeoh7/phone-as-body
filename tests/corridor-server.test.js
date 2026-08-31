import { describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCorridorServer } from "../server/create-corridor-server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("createCorridorServer", () => {
  test("serves config and production shell on an ephemeral port, then closes cleanly", async () => {
    const runtime = createCorridorServer({
      root,
      mode: "production",
      controllerOrigin: "https://initial.example",
      host: "127.0.0.1",
    });

    await runtime.listen(0);
    const address = runtime.address();
    expect(address).toEqual(expect.objectContaining({ address: "127.0.0.1" }));
    expect(address.port).toBeGreaterThan(0);

    const configResponse = await fetch(`http://127.0.0.1:${address.port}/api/config`);
    expect(configResponse.status).toBe(200);
    expect(await configResponse.json()).toEqual({
      controllerOrigin: "https://initial.example",
      aiConfigured: false,
    });

    runtime.setControllerOrigin("https://updated.example");
    expect(runtime.getControllerOrigin()).toBe("https://updated.example");
    expect((await (await fetch(`http://127.0.0.1:${address.port}/api/config`)).json()).controllerOrigin)
      .toBe("https://updated.example");

    const shellResponse = await fetch(`http://127.0.0.1:${address.port}/controller`);
    expect(shellResponse.status).toBe(200);
    expect(await shellResponse.text()).toContain("<html");

    await runtime.close();
    expect(runtime.address()).toBeNull();
  });
});
