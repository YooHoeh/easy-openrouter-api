import type { CatalogSnapshot } from "./catalogTypes.js";

export interface CatalogRepository {
  getSnapshot(): Promise<CatalogSnapshot | null>;
  replaceSnapshot(snapshot: CatalogSnapshot): Promise<void>;
}

export class InMemoryCatalogRepository implements CatalogRepository {
  #snapshot: CatalogSnapshot | null = null;

  async getSnapshot() {
    return this.#snapshot;
  }

  async replaceSnapshot(snapshot: CatalogSnapshot) {
    this.#snapshot = snapshot;
  }
}
