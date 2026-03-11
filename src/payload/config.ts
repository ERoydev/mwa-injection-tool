import { CHAINS } from "./constants.js";
import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
} from "@solana-mobile/wallet-standard-mobile";

export function buildConfig() {
  const name = document.title || location.hostname;
  const uri = location.origin;

  let icon: string | undefined;
  const linkEl = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  const href = linkEl?.getAttribute("href");
  if (href) {
    icon = new URL(href, location.origin).href;
  }

  return {
    appIdentity: { name, uri, icon },
    chains: [...CHAINS],
    authorizationCache: createDefaultAuthorizationCache(),
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: createDefaultWalletNotFoundHandler(),
  };
}
