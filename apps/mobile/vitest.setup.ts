import { vi } from "vitest";

// `@react-native-community/netinfo` ships a native-module wrapper that the
// node test environment cannot parse. `data/api.ts` reaches it through
// `lib/network-status`, so any suite that loads the real api module would
// otherwise blow up on import; unit tests never touch real connectivity.
vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: () => vi.fn() },
}));
