export class PointerOwnership {
  constructor() {
    this.gameplayId = null;
    this.voiceId = null;
    this.inventoryId = null;
    this.generation = 0;
  }

  get inventoryModal() {
    return this.inventoryId !== null;
  }

  claimGameplay(pointerId) {
    if (this.inventoryModal || this.gameplayId !== null || this.voiceId === pointerId) return false;
    this.gameplayId = pointerId;
    return true;
  }

  claimVoice(pointerId) {
    if (this.inventoryModal || this.voiceId !== null || this.gameplayId === pointerId) return false;
    this.voiceId = pointerId;
    return true;
  }

  claimInventory(pointerId) {
    if (this.inventoryModal || this.gameplayId === pointerId || this.voiceId === pointerId) return null;
    const displaced = { gameplay: this.gameplayId, voice: this.voiceId };
    this.gameplayId = null;
    this.voiceId = null;
    this.inventoryId = pointerId;
    return displaced;
  }

  release(owner, pointerId, generation = this.generation) {
    if (generation !== this.generation) return false;
    const property = `${owner}Id`;
    if (!Object.hasOwn(this, property) || this[property] !== pointerId) return false;
    this[property] = null;
    return true;
  }

  cancelAll() {
    this.generation += 1;
    const displaced = {
      gameplay: this.gameplayId,
      voice: this.voiceId,
      inventory: this.inventoryId,
    };
    this.gameplayId = null;
    this.voiceId = null;
    this.inventoryId = null;
    return displaced;
  }
}
