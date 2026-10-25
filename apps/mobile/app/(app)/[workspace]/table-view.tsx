/**
 * Full view of a markdown table, opened from a chat bubble or a
 * comment card:
 *
 *   /[workspace]/table-view?key=<key from putTableForView>
 *
 * The table itself stays in `table-view-store`; see `TableFullView`.
 */
import { useLocalSearchParams } from "expo-router";
import { getTableForView } from "@/lib/markdown/table-view-store";
import { TableFullView } from "@/lib/markdown/table-full-view";

export default function TableViewRoute() {
  const { key } = useLocalSearchParams<{ key?: string }>();
  return <TableFullView table={getTableForView(key)} />;
}
