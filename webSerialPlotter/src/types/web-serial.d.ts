// Minimal Web Serial type shims to avoid TS complaints in environments
// where lib.dom doesn't include Serial types.

interface Navigator {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serial?: any;
}


