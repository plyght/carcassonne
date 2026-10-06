"use client";

import { CheckCircle, InfoCircle, Loader, CloseCircle, AlertTriangle } from "reicon-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CheckCircle className="size-4" />,
        info: <InfoCircle className="size-4" />,
        warning: <AlertTriangle className="size-4" />,
        error: <CloseCircle className="size-4" />,
        loading: <Loader className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--sheet)",
          "--normal-text": "var(--text-1)",
          "--normal-border": "transparent",
          "--border-radius": "var(--r-control)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
