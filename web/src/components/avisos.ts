/** Detecção do ambiente para os avisos de instalação (iOS e app já instalado). */

export function ehIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function instalado(): boolean {
  const mm = window.matchMedia;
  return (
    mm("(display-mode: standalone)").matches ||
    mm("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
