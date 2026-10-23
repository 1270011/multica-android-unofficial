/**
 * Where the timeline cache lives. Android: the app's
 * noBackupFilesDir (`<dataDir>/no_backup`), which Auto Backup and device
 * transfer never copy, whatever the backup rules say. iOS: the caches
 * directory, which is not backed up either.
 *
 * `baseUri` is `Paths.document.uri` on Android (`file:///data/user/0/<pkg>/files/`)
 * and `Paths.cache.uri` on iOS. Returns a plain filesystem path for MMKV.
 */
export function cacheDirectoryFor(os: string, baseUri: string): string {
  const base = baseUri.replace(/^file:\/\//, "").replace(/\/+$/, "");
  if (os === "android") {
    const dataDir = base.slice(0, base.lastIndexOf("/"));
    return `${dataDir}/no_backup/timeline-cache`;
  }
  return `${base}/timeline-cache`;
}
