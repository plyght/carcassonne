import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@carcassonne/ui/components/dropdown-menu";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { cn } from "@carcassonne/ui/lib/utils";

import { authClient } from "@/lib/auth-client";

export default function UserMenu({ className }: { className?: string }) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <span className={cn("carc-header-placeholder", className)} aria-hidden />;
  }

  if (!session) {
    return (
      <Link href="/login" className={cn("carc-nav-link carc-account", className)}>
        Sign in
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" className={cn("carc-nav-link carc-account carc-user-trigger", className)} />}>
        <span className="carc-user-initial" aria-hidden>
          {session.user.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="carc-user-name">{session.user.name}</span>
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{session.user.email}</DropdownMenuLabel>
          <DropdownMenuItem render={<Link href="/profile" />}>
            <UserRound /> Profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    router.push("/");
                  },
                },
              });
            }}
          >
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
