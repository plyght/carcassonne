"use client";

import { Toaster } from "@carcassonne/ui/components/sonner";
import { QueryClientProvider } from "@tanstack/react-query";

import { CoreProvider } from "@/lib/core";
import { queryClient } from "@/utils/trpc";

import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <CoreProvider>{children}</CoreProvider>
      </QueryClientProvider>
      <Toaster richColors />
    </ThemeProvider>
  );
}
