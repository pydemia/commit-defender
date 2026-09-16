import path from "node:path";
import {
  windowsNative,
  windowsNativeSync,
  checkWindowsStorage,
} from "@gcr/client-core/windows-native";

/** Native handles validate ACLs and reparse boundaries for hook/service files. */
export async function windowsPrivateDirectory(directory: string) {
  const result = checkWindowsStorage(await windowsNative({
    operation: "directory", path: path.resolve(directory),
  }));
  if (!result.path) throw Error("Private Windows directory unavailable.");
  return result.path;
}
export async function windowsReadPrivateFile(file: string, maximum = 1048576) {
  const result = checkWindowsStorage(await windowsNative({
    operation: "read", path: path.resolve(file), maximum,
  }));
  if (result.missing) return undefined;
  if (typeof result.bytes !== "string")
    throw Error("Private Windows file unavailable.");
  return Buffer.from(result.bytes, "base64");
}
export function windowsReadPrivateFileSync(file: string, maximum = 1048576) {
  const result = windowsNativeSync({
    operation: "read", path: path.resolve(file), maximum,
  });
  if (result.missing) return undefined;
  if (typeof result.bytes !== "string")
    throw Error("Private Windows file unavailable.");
  return Buffer.from(result.bytes, "base64");
}
export async function windowsWritePrivateFile(
  file: string, bytes: Uint8Array, replace = false,
) {
  const result = checkWindowsStorage(await windowsNative({
    operation: replace ? "replace-private" : "publish",
    path: path.resolve(file), bytes: Buffer.from(bytes).toString("base64"),
  }));
  if (typeof result.published !== "boolean")
    throw Error("Private Windows publication unconfirmed.");
  return result.published;
}
export function windowsRemovePrivateFile(file: string) {
  windowsNativeSync({ operation: "remove-private", path: path.resolve(file) });
}
