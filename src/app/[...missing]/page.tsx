import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Page not found" };

// Addresses that match no page land here, so the not-found page gets its own
// tab title instead of the home page's.
export default function Missing() {
  notFound();
}
