/**
 * The OS reported to the server in `X-Client-OS` / `client_os`. Isolated in
 * its own module so the headless data-layer tests can mock it instead of
 * pulling react-native into Node.
 */
import { Platform } from "react-native";

export const CLIENT_OS: string = Platform.OS;
