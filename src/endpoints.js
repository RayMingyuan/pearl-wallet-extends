import { err } from "./i18n.js";
export const DEFAULT_INDEXERS = ["https://blockbook.pearlresearch.ai"];

const ORIGIN_RE = /^https?:\/\/(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9.-]+)(?::\d{1,5})?$/;

export function isIndexerOrigin(origin) {
  return typeof origin === "string" && ORIGIN_RE.test(origin);
}

export function createEndpoints(origins = DEFAULT_INDEXERS) {
  const list = [];
  for (const origin of origins) {
    if (!isIndexerOrigin(origin)) {
      throw err("err.network.indexerOriginInvalid");
    }
    if (!list.includes(origin)) list.push(origin);
  }
  if (!list.length) throw err("err.network.noIndexers");
  let selected = 0;
  return {
    list() { return [...list]; },
    selected() { return list[selected]; },
    select(index) {
      if (!Number.isInteger(index) || !list[index]) throw err("err.network.indexerNotFound");
      selected = index;
    },
    async read(work) {
      let last;
      for (const origin of list) {
        try {
          return await work(origin);
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          last = error;
        }
      }
      throw last;
    },
    async broadcast(work) {
      return work(list[selected]);
    },
  };
}
