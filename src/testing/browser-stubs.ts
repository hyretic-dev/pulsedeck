import { SwPush } from '@angular/service-worker';
import { BehaviorSubject } from 'rxjs';

/**
 * Test-Stub für jsdom: window.matchMedia existiert dort nicht.
 * Implementiert nur die von ThemeService und SidebarRight genutzte Teilmenge.
 */
export function stubMatchMedia(): void {
  if (typeof window.matchMedia === 'function') return;

  const minimalList = {
    matches: false,
    media: '',
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  };
  // jsdom kennt keine MediaQueryList-Implementierung; Stub ist bewusst minimal.
  window.matchMedia = (query: string) =>
    ({ ...minimalList, media: query }) as MediaQueryList;
}

/** Test-Provider für SwPush ohne Service-Worker-Umgebung. */
export const SW_PUSH_STUB = {
  provide: SwPush,
  useValue: {
    subscription: new BehaviorSubject<PushSubscription | null>(null),
    requestSubscription: () => Promise.resolve(null),
    unsubscribe: () => Promise.resolve(),
  },
};
