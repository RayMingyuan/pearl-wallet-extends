import { err } from "./i18n.js";
export const PROVIDER_KEY = "pearlProviderEnabled";

export function createProvider({ enabled = async () => false, accounts = async () => [], signPsbt } = {}) {
  return {
    async request(method, params = {}, { userGesture = false } = {}) {
      if (await enabled() !== true) throw err("err.provider.disabled");
      if (!userGesture) throw err("err.provider.needUserGesture");
      if (method === "requestAccounts") return accounts();
      if (method === "signPsbt") {
        if (params.broadcast === true) throw err("err.provider.noBroadcast");
        if (typeof params.psbt !== "string" || params.psbt.length < 10) throw err("err.provider.missingPsbt");
        const signed = signPsbt ? await signPsbt(params.psbt) : params.psbt;
        return { psbt: signed, broadcast: false };
      }
      throw err("err.provider.unsupported");
    },
  };
}
