import { useMatches } from "react-router";
import type { Globals } from "./globals";

export default function useRootData() {
  const m = useMatches();
  const data = m[0].loaderData as { globals: Globals };
  return data;
}
