import { describe, expect, it } from "vitest";
import { PointerOwnership } from "../src/controller/PointerOwnership.js";

describe("PointerOwnership", () => {
  it("allows one gameplay and voice pointer until inventory becomes modal", () => {
    const owners = new PointerOwnership();

    expect(owners.claimGameplay(1)).toBe(true);
    expect(owners.claimVoice(2)).toBe(true);
    expect(owners.claimInventory(3)).toMatchObject({ gameplay: 1, voice: 2 });
    expect(owners.inventoryModal).toBe(true);
    expect(owners.claimGameplay(4)).toBe(false);

    owners.release("inventory", 3);

    expect(owners.inventoryModal).toBe(false);
    expect(owners.claimGameplay(4)).toBe(true);
  });

  it("invalidates stale releases when all ownership is cancelled and a pointer id is reused", () => {
    const owners = new PointerOwnership();
    owners.claimGameplay(7);
    const staleGeneration = owners.generation;

    owners.cancelAll();
    const currentGeneration = owners.generation;
    expect(currentGeneration).toBeGreaterThan(staleGeneration);
    expect(owners.claimGameplay(7)).toBe(true);

    owners.release("gameplay", 7, staleGeneration);

    expect(owners.gameplayId).toBe(7);
    owners.release("gameplay", 7, currentGeneration);
    expect(owners.gameplayId).toBeNull();
  });

  it("does not let an active pointer change owners", () => {
    const gameplayOwners = new PointerOwnership();
    gameplayOwners.claimGameplay(1);
    expect(gameplayOwners.claimVoice(1)).toBe(false);
    expect(gameplayOwners.claimInventory(1)).toBeNull();
    expect(gameplayOwners.gameplayId).toBe(1);

    const voiceOwners = new PointerOwnership();
    voiceOwners.claimVoice(2);
    expect(voiceOwners.claimGameplay(2)).toBe(false);
    expect(voiceOwners.voiceId).toBe(2);
  });
});
