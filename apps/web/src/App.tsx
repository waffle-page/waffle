import { Library } from './library/Library';
import { DevHarness } from './DevHarness';

/** ?dev opens the spine harness; everything else is the library. */
export function App() {
  const isDev = new URLSearchParams(window.location.search).has('dev');
  return isDev ? <DevHarness /> : <Library />;
}
