/**
 * Issue key column in list rows (issue list, search). At 200 % font a
 * fixed `w-16` column broke "MUL-88" into two lines: the
 * key now keeps at least that width, grows with the font and never wraps.
 */
import { Text } from "@/components/ui/text";

export function IssueIdentifier({ identifier }: { identifier: string }) {
  return (
    <Text className="text-xs text-muted-foreground shrink-0 min-w-16" numberOfLines={1}>
      {identifier}
    </Text>
  );
}
